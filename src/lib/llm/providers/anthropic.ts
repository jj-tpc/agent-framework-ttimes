import Anthropic from "@anthropic-ai/sdk";
import type { ToolCall, ToolCallRecord } from "../../tools/config";
import { CLEARED_NOTE, compactSlots, finalText, providerCall, runToolCalls, sumUsage, type ResultSlot } from "../tool-loop";
import type { LlmCallResult, LlmStep, ModelListItem, ProviderCall } from "../types";

const FALLBACK_BETA = "server-side-fallback-2026-07-01";
/** 서버 측 거절 대체(fallbacks: "default")를 받는 모델. Haiku 등은 보내지 않는다. */
const FALLBACK_MODELS = new Set(["claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5", "claude-fable-5-2", "claude-fable-5-1"]);
type Effort = "low" | "medium" | "high" | "xhigh" | "max";

const clients = new Map<string, Anthropic>();
const clientFor = (apiKey: string) => {
  let c = clients.get(apiKey);
  if (!c) clients.set(apiKey, (c = new Anthropic({ apiKey })));
  return c;
};

export function describeAnthropicError(error: unknown): string | null {
  if (error instanceof Anthropic.AuthenticationError) return "Anthropic 인증 실패(401) — API 키를 확인하세요.";
  if (error instanceof Anthropic.PermissionDeniedError) return "Anthropic 권한 없음(403) — 이 키로 해당 모델을 쓸 수 없습니다.";
  if (error instanceof Anthropic.NotFoundError) return "Anthropic 모델을 찾을 수 없습니다(404) — 모델 이름을 확인하세요.";
  if (error instanceof Anthropic.RateLimitError) return "Anthropic 요청 한도 초과(429) — 잠시 후 다시 시도하세요.";
  if (error instanceof Anthropic.BadRequestError) return `Anthropic 잘못된 요청(400): ${error.message}`;
  if (error instanceof Anthropic.APIConnectionError) return "Anthropic API에 연결하지 못했습니다 — 네트워크/프록시를 확인하세요.";
  if (error instanceof Anthropic.APIError) return `Anthropic API 오류 ${error.status ?? ""}: ${error.message}`;
  return null;
}

export async function callAnthropic(c: ProviderCall): Promise<LlmCallResult> {
  const p = c.params;
  const useFallback = FALLBACK_MODELS.has(c.model);
  const effort = p.effort as Effort | undefined;
  const outputConfig = {
    ...(effort ? { effort } : {}),
    ...(c.jsonSchema ? { format: { type: "json_schema" as const, schema: c.jsonSchema } } : {}),
  };
  const display = p.thinking_display === "omitted" ? "omitted" : "summarized";
  const stop = Array.isArray(p.stop_sequences) && p.stop_sequences.length ? (p.stop_sequences as string[]) : undefined;
  const fnTools = c.tools?.length && c.runTool ? c.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters as Anthropic.Beta.BetaTool.InputSchema })) : [];
  // 웹 검색은 Anthropic 서버가 실행한다. 코드 실행 없이 도는 기본형을 쓴다
  const serverTools = c.providerTools?.includes("web_search") ? [{ type: "web_search_20250305" as const, name: "web_search" as const, max_uses: 5 }] : [];
  const tools = fnTools.length + serverTools.length ? [...fnTools, ...serverTools] : undefined;
  const maxSteps = c.maxSteps ?? 8;
  // 도구 루프 동안 모델이 낸 블록(thinking 포함)을 그대로 되돌려 보내야 하므로 원본 형식으로 쌓는다
  const messages: Anthropic.Beta.BetaMessageParam[] = c.messages.map((m) => ({ role: m.role, content: m.content }));

  const bodyFor = (forceAnswer: boolean) => ({
    model: c.model,
    max_tokens: Number(p.max_tokens ?? 16000),
    thinking: { type: "adaptive" as const, display: display as "summarized" | "omitted" },
    ...(Object.keys(outputConfig).length ? { output_config: outputConfig } : {}),
    ...(stop ? { stop_sequences: stop } : {}),
    ...(c.system ? { system: c.system } : {}),
    messages,
    ...(tools ? { tools } : {}),
    ...(tools && forceAnswer ? { tool_choice: { type: "none" as const } } : {}),
    ...(useFallback ? { betas: [FALLBACK_BETA], fallbacks: "default" as const } : {}),
  });

  const steps: LlmStep[] = [];
  const slots: ResultSlot[] = [];
  let request: Record<string, unknown> | null = null;
  let model = c.model;
  let fallback: string | undefined;
  for (let i = 0; ; i++) {
    const body = bodyFor(i >= maxSteps);
    request ??= { ...body, messages: [...messages] };
    if (i > 0) c.onText?.("\n\n");
    const stream = clientFor(c.apiKey).beta.messages.stream(body, { signal: c.signal });
    for await (const event of stream) {
      if (event.type !== "content_block_delta") continue;
      if (event.delta.type === "text_delta") c.onText?.(event.delta.text);
      else if (event.delta.type === "thinking_delta") c.onThinking?.(event.delta.thinking);
    }
    const message = await stream.finalMessage();

    if (message.stop_reason === "refusal") {
      const d = message.stop_details;
      throw new Error(`모델이 요청을 거절했습니다${d?.category ? ` (${d.category})` : ""}${d?.explanation ? `: ${d.explanation}` : ""}`);
    }
    let text = "";
    let thinking = "";
    const calls: ToolCall[] = [];
    const served: ToolCallRecord[] = [];
    for (const block of message.content) {
      if (block.type === "text") text += block.text;
      else if (block.type === "thinking") thinking += block.thinking;
      else if (block.type === "tool_use") calls.push({ id: block.id, name: block.name, input: block.input });
      else if (block.type === "fallback") fallback = `${block.from.model} → ${block.to.model}`;
      else if (block.type === "server_tool_use") served.push(providerCall(block.id, block.name, block.input));
    }
    model = message.model;
    const step: LlmStep = {
      text,
      thinking,
      stopReason: message.stop_reason,
      usage: { inputTokens: message.usage.input_tokens, outputTokens: message.usage.output_tokens },
      toolCalls: served,
    };
    steps.push(step);
    // 서버 도구가 길어져 응답이 잠시 끊긴 경우: 받은 내용을 그대로 돌려보내 이어서 하게 한다
    if (message.stop_reason === "pause_turn" && i < maxSteps + 3) {
      messages.push({ role: "assistant", content: message.content as Anthropic.Beta.BetaContentBlockParam[] });
      continue;
    }
    if (message.stop_reason !== "tool_use" || !calls.length || !tools) break;

    step.toolCalls = [...served, ...(await runToolCalls(c, calls))];
    const results = step.toolCalls.slice(served.length).map((r) => ({ type: "tool_result" as const, tool_use_id: r.id, content: r.output, ...(r.isError ? { is_error: true } : {}) }));
    messages.push({ role: "assistant", content: message.content as Anthropic.Beta.BetaContentBlockParam[] }, { role: "user", content: results });
    for (const b of results) slots.push({ round: i, size: b.content.length, clear: () => void (b.content = CLEARED_NOTE) });
    const cleared = compactSlots(slots, i, c.compactAfter);
    if (cleared) step.clearedResults = cleared;
  }
  const last = steps[steps.length - 1];
  return {
    text: finalText(steps),
    thinking: steps.map((s) => s.thinking).filter(Boolean).join("\n\n"),
    model,
    stopReason: last.stopReason,
    usage: sumUsage(steps),
    fallback,
    request: request!,
    ...(tools ? { steps } : {}),
    api: "Anthropic Messages API (beta.messages.stream)",
  };
}

export async function listAnthropicModels(apiKey: string): Promise<ModelListItem[]> {
  const out: ModelListItem[] = [];
  for await (const m of clientFor(apiKey).models.list()) out.push({ id: m.id, label: m.display_name });
  return out;
}
