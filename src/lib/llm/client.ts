import type { LlmRuntime } from "../store/settings";
import { PROVIDERS, type ResolvedModel, type ProviderId } from "./catalog";
import { callAnthropic, describeAnthropicError, listAnthropicModels } from "./providers/anthropic";
import { callGoogle, describeGoogleError, listGoogleModels } from "./providers/google";
import { callOpenAI, describeOpenAIError, listOpenAIModels } from "./providers/openai";
import type { ToolCall, ToolCallRecord, ToolDef, ToolOutput } from "../tools/config";
import { runToolCalls, sumUsage } from "./tool-loop";
import type { LlmCallResult, LlmMessage, LlmStep, ModelListItem, ProviderCall } from "./types";

export type { LlmCallResult, LlmMessage, LlmStep };

const CALL: Record<ProviderId, (c: ProviderCall) => Promise<LlmCallResult>> = {
  anthropic: callAnthropic,
  openai: callOpenAI,
  google: callGoogle,
};
const LIST: Record<ProviderId, (key: string) => Promise<ModelListItem[]>> = {
  anthropic: listAnthropicModels,
  openai: listOpenAIModels,
  google: listGoogleModels,
};

export function describeError(error: unknown): string {
  return (
    describeAnthropicError(error) ??
    describeOpenAIError(error) ??
    describeGoogleError(error) ??
    ((error as Error)?.message || String(error))
  );
}

export interface LlmCallParams {
  runtime: LlmRuntime;
  resolved: ResolvedModel;
  /** 노드가 강제로 덧붙이는 파라미터(예: 분류기의 최대 토큰) — 사용자가 지정한 값이 우선 */
  baseParams?: Record<string, unknown>;
  system: string;
  messages: LlmMessage[];
  jsonSchema?: Record<string, unknown>;
  signal?: AbortSignal;
  onText?: (delta: string) => void;
  onThinking?: (delta: string) => void;
  tools?: ToolDef[];
  runTool?: (call: ToolCall) => Promise<ToolOutput>;
  maxSteps?: number;
  compactAfter?: number;
  providerTools?: string[];
  /** Mock 모드의 최종 답. 도구를 썼다면 그 결과를 받는다 */
  mock: (toolResults: ToolCallRecord[]) => string;
  /** Mock 모드에서 이번 단계에 부를 도구(없으면 답으로 넘어간다) */
  mockTools?: (state: { step: number; results: ToolCallRecord[] }) => { name: string; input: unknown }[] | null;
}

export async function callLlm(p: LlmCallParams): Promise<LlmCallResult> {
  const { provider, model } = p.resolved;
  const params = { ...(p.baseParams ?? {}), ...p.resolved.params };
  if (p.runtime.mock) return mockCall(p, params);

  const apiKey = p.runtime.keys[provider];
  if (!apiKey) {
    throw new Error(`${PROVIDERS[provider].label} API 키가 없습니다. 화면 위쪽 ‘API 키’에서 입력하세요.`);
  }
  try {
    return await CALL[provider]({
      apiKey,
      model,
      params,
      system: p.system,
      messages: p.messages,
      jsonSchema: p.jsonSchema,
      signal: p.signal,
      onText: p.onText,
      onThinking: p.onThinking,
      tools: p.tools,
      runTool: p.runTool,
      maxSteps: p.maxSteps,
      compactAfter: p.compactAfter,
      providerTools: p.providerTools,
    });
  } catch (error) {
    if (p.signal?.aborted) throw new Error("요청이 취소되었습니다.");
    throw new Error(describeError(error));
  }
}

/** 키 확인 — 모델 목록 API만 호출하므로 토큰 비용이 없다 */
export async function testConnection(provider: ProviderId, apiKey: string) {
  try {
    const models = await LIST[provider](apiKey);
    return { ok: true as const, count: models.length };
  } catch (error) {
    return { ok: false as const, error: describeError(error) };
  }
}

const listCache = new Map<string, { at: number; models: ModelListItem[] }>();
export async function listModels(provider: ProviderId, apiKey: string): Promise<ModelListItem[]> {
  const cacheKey = `${provider}:${apiKey.slice(-8)}`;
  const hit = listCache.get(cacheKey);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.models;
  const models = await LIST[provider](apiKey);
  listCache.set(cacheKey, { at: Date.now(), models });
  return models;
}

// ───────────────────────── Mock (LLM_MODE=mock) ─────────────────────────

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function mockCall(p: LlmCallParams, params: Record<string, unknown>): Promise<LlmCallResult> {
  const { provider, model } = p.resolved;
  const thinking = `[Mock] ${PROVIDERS[provider].short} 모델을 호출하지 않았습니다 (LLM_MODE=mock).`;
  p.onThinking?.(thinking);
  const chars = p.system.length + p.messages.reduce((n, m) => n + m.content.length, 0);
  const useTools = !!p.tools?.length && !!p.runTool;
  const names = new Set((p.tools ?? []).map((t) => t.name));
  const steps: LlmStep[] = [];
  const results: ToolCallRecord[] = [];
  const maxSteps = p.maxSteps ?? 8;
  for (let step = 0; useTools && step < maxSteps; step++) {
    const wanted = (p.mockTools?.({ step, results }) ?? []).filter((c) => names.has(c.name));
    if (!wanted.length) break;
    const done = await runToolCalls(p, wanted.map((c, k) => ({ id: `mock_${step}_${k}`, name: c.name, input: c.input })));
    results.push(...done);
    steps.push({ text: "", thinking: "", stopReason: "tool_use", usage: { inputTokens: Math.ceil(chars / 2), outputTokens: 20 }, toolCalls: done });
  }
  const text = p.mock(results);
  for (const chunk of text.match(/[\s\S]{1,6}/g) ?? []) {
    if (p.signal?.aborted) throw new Error("요청이 취소되었습니다.");
    p.onText?.(chunk);
    await sleep(12);
  }
  steps.push({ text, thinking, stopReason: "end_turn", usage: { inputTokens: Math.ceil(chars / 2), outputTokens: Math.ceil(text.length / 2) }, toolCalls: [] });
  return {
    text,
    thinking,
    model: `mock:${model}`,
    stopReason: "end_turn",
    usage: sumUsage(steps),
    request: {
      model,
      params,
      ...(p.system ? { system: p.system } : {}),
      messages: p.messages,
      ...(p.jsonSchema ? { json_schema: p.jsonSchema } : {}),
      ...(useTools ? { tools: p.tools } : {}),
    },
    ...(useTools ? { steps } : {}),
    api: `Mock (${PROVIDERS[provider].label})`,
  };
}
