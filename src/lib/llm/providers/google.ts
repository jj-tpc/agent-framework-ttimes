import { ApiError, FunctionCallingConfigMode, GoogleGenAI, ThinkingLevel, type Content, type GenerateContentConfig, type Part } from "@google/genai";
import type { ToolCall } from "../../tools/config";
import { CLEARED_NOTE, compactSlots, finalText, providerCall, runToolCalls, sumUsage, type ResultSlot } from "../tool-loop";
import type { LlmCallResult, LlmStep, ModelListItem, ProviderCall } from "../types";

const clients = new Map<string, GoogleGenAI>();
const clientFor = (apiKey: string) => {
  let c = clients.get(apiKey);
  if (!c) clients.set(apiKey, (c = new GoogleGenAI({ apiKey })));
  return c;
};

export function describeGoogleError(error: unknown): string | null {
  if (!(error instanceof ApiError)) return null;
  const msg = error.message.slice(0, 400);
  if (error.status === 400 && /api key/i.test(msg)) return "Gemini API 키가 올바르지 않습니다(400) — 키를 확인하세요.";
  if (error.status === 401 || error.status === 403) return `Gemini 인증/권한 오류(${error.status}) — 키와 프로젝트 권한을 확인하세요.`;
  if (error.status === 404) return "Gemini 모델을 찾을 수 없습니다(404) — 모델 이름을 확인하세요.";
  if (error.status === 429) return "Gemini 요청 한도 초과(429) — 잠시 후 다시 시도하세요.";
  return `Gemini API 오류 ${error.status}: ${msg}`;
}

const LEVELS: Record<string, ThinkingLevel> = {
  minimal: ThinkingLevel.MINIMAL,
  low: ThinkingLevel.LOW,
  medium: ThinkingLevel.MEDIUM,
  high: ThinkingLevel.HIGH,
  xhigh: ThinkingLevel.XHIGH,
};

/** Gemini의 responseJsonSchema 는 additionalProperties 를 받지 않을 수 있어 지운다 */
function stripAdditional(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(stripAdditional);
  if (!schema || typeof schema !== "object") return schema;
  return Object.fromEntries(
    Object.entries(schema as Record<string, unknown>)
      .filter(([k]) => k !== "additionalProperties" && k !== "$schema")
      .map(([k, v]) => [k, stripAdditional(v)]),
  );
}

/** Gemini generateContentStream 호출 */
export async function callGoogle(c: ProviderCall): Promise<LlmCallResult> {
  const p = c.params;
  const thinkingConfig = {
    ...(p.thinking_level && LEVELS[String(p.thinking_level)] ? { thinkingLevel: LEVELS[String(p.thinking_level)] } : {}),
    ...(p.include_thoughts != null ? { includeThoughts: Boolean(p.include_thoughts) } : {}),
  };
  const stop = Array.isArray(p.stop_sequences) && p.stop_sequences.length ? (p.stop_sequences as string[]) : undefined;
  const config: GenerateContentConfig = {
    ...(c.system ? { systemInstruction: c.system } : {}),
    ...(p.temperature != null ? { temperature: Number(p.temperature) } : {}),
    ...(p.top_p != null ? { topP: Number(p.top_p) } : {}),
    ...(p.top_k != null ? { topK: Number(p.top_k) } : {}),
    ...(p.max_output_tokens != null ? { maxOutputTokens: Number(p.max_output_tokens) } : {}),
    ...(stop ? { stopSequences: stop } : {}),
    ...(Object.keys(thinkingConfig).length ? { thinkingConfig } : {}),
    ...(c.jsonSchema ? { responseMimeType: "application/json", responseJsonSchema: stripAdditional(c.jsonSchema) } : {}),
  };
  const hasFn = !!c.tools?.length && !!c.runTool;
  // 웹 검색은 Google 검색 그라운딩으로 Google 서버가 실행한다
  const search = !!c.providerTools?.includes("web_search");
  const tools =
    hasFn || search
      ? [
          ...(hasFn ? [{ functionDeclarations: c.tools!.map((t) => ({ name: t.name, description: t.description, parametersJsonSchema: stripAdditional(t.parameters) })) }] : []),
          ...(search ? [{ googleSearch: {} }] : []),
        ]
      : undefined;
  // 함수 도구와 서버 도구를 함께 쓸 때는 서버 쪽 호출 내역을 응답에 포함시켜 그대로 되돌려 보낸다
  const mixed = hasFn && search;
  const maxSteps = c.maxSteps ?? 8;
  if (tools) config.tools = tools;
  // 모델이 낸 parts(thoughtSignature 포함)를 그대로 되돌려 보내야 하므로 원본 형식으로 쌓는다
  const contents: Content[] = c.messages.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));
  const shown = {
    ...config,
    ...(config.thinkingConfig?.thinkingLevel ? { thinkingConfig: { ...thinkingConfig, thinkingLevel: String(p.thinking_level).toUpperCase() } } : {}),
  };
  const request = { model: c.model, contents: [...contents], config: shown };

  const steps: LlmStep[] = [];
  const slots: ResultSlot[] = [];
  let modelVersion = c.model;
  for (let i = 0; ; i++) {
    const forceAnswer = !!tools && i >= maxSteps;
    if (i > 0) c.onText?.("\n\n");
    const stream = await clientFor(c.apiKey).models.generateContentStream({
      model: c.model,
      contents,
      config: {
        ...config,
        ...(forceAnswer || mixed
          ? { toolConfig: { ...(mixed ? { includeServerSideToolInvocations: true } : {}), ...(forceAnswer && hasFn ? { functionCallingConfig: { mode: FunctionCallingConfigMode.NONE } } : {}) } }
          : {}),
        abortSignal: c.signal,
      },
    });

    let text = "";
    let thinking = "";
    let finish: string | null = null;
    let usage = { inputTokens: 0, outputTokens: 0 };
    const parts: Part[] = [];
    const calls: ToolCall[] = [];
    const callIds: (string | undefined)[] = [];
    const queries: string[] = [];
    for await (const chunk of stream) {
      const cand = chunk.candidates?.[0];
      for (const part of cand?.content?.parts ?? []) {
        parts.push(part);
        if (part.functionCall?.name) {
          callIds.push(part.functionCall.id);
          calls.push({ id: part.functionCall.id ?? `call_${i}_${calls.length}`, name: part.functionCall.name, input: part.functionCall.args ?? {} });
        }
        if (!part.text) continue;
        if (part.thought) {
          thinking += part.text;
          c.onThinking?.(part.text);
        } else {
          text += part.text;
          c.onText?.(part.text);
        }
      }
      for (const q of cand?.groundingMetadata?.webSearchQueries ?? []) if (!queries.includes(q)) queries.push(q);
      if (cand?.finishReason) finish = cand.finishReason;
      if (chunk.modelVersion) modelVersion = chunk.modelVersion;
      if (chunk.usageMetadata) {
        const u = chunk.usageMetadata;
        usage = { inputTokens: u.promptTokenCount ?? 0, outputTokens: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0) };
      }
    }
    if (finish === "SAFETY" || finish === "PROHIBITED_CONTENT" || finish === "BLOCKLIST") {
      throw new Error(`Gemini 안전 필터로 응답이 차단되었습니다 (${finish}).`);
    }
    const served = queries.map((q, k) => providerCall(`search_${i}_${k}`, "web_search", { query: q }));
    const step: LlmStep = { text, thinking, stopReason: calls.length ? "tool_calls" : finish, usage, toolCalls: served };
    steps.push(step);
    if (!calls.length || !hasFn || forceAnswer) break;

    const ran = await runToolCalls(c, calls);
    step.toolCalls = [...served, ...ran];
    const responses = ran.map((r, k) => ({
      functionResponse: { ...(callIds[k] ? { id: callIds[k] } : {}), name: r.name, response: (r.isError ? { error: r.output } : { output: r.output }) as Record<string, unknown> },
    }));
    contents.push({ role: "model", parts }, { role: "user", parts: responses });
    responses.forEach((b, k) => slots.push({ round: i, size: ran[k].output.length, clear: () => void (b.functionResponse.response = { output: CLEARED_NOTE }) }));
    const cleared = compactSlots(slots, i, c.compactAfter);
    if (cleared) step.clearedResults = cleared;
  }
  const last = steps[steps.length - 1];
  return {
    text: finalText(steps),
    thinking: steps.map((s) => s.thinking).filter(Boolean).join("\n\n"),
    model: modelVersion,
    stopReason: last.stopReason,
    usage: sumUsage(steps),
    request,
    ...(tools ? { steps } : {}),
    api: "Gemini API (models.generateContentStream)",
  };
}

const EXCLUDE = /(embedding|image|tts|live|audio|robotics|aqa|imagen|veo)/;

export async function listGoogleModels(apiKey: string): Promise<ModelListItem[]> {
  const out: ModelListItem[] = [];
  const pager = await clientFor(apiKey).models.list();
  for await (const m of pager) {
    const id = (m.name ?? "").replace(/^models\//, "");
    if (id.startsWith("gemini") && !EXCLUDE.test(id) && (m.supportedActions ?? ["generateContent"]).includes("generateContent")) {
      out.push({ id, label: m.displayName });
    }
  }
  return out;
}
