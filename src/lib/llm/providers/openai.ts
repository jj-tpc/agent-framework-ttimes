import OpenAI from "openai";
import type { ToolCall, ToolCallRecord } from "../../tools/config";
import { CLEARED_NOTE, compactSlots, finalText, parseArgs, providerCall, runToolCalls, sumUsage, type ResultSlot } from "../tool-loop";
import type { LlmCallResult, LlmStep, ModelListItem, ProviderCall } from "../types";

const clients = new Map<string, OpenAI>();
const clientFor = (apiKey: string) => {
  let c = clients.get(apiKey);
  if (!c) clients.set(apiKey, (c = new OpenAI({ apiKey })));
  return c;
};

export function describeOpenAIError(error: unknown): string | null {
  if (error instanceof OpenAI.AuthenticationError) return "OpenAI 인증 실패(401) — API 키를 확인하세요.";
  if (error instanceof OpenAI.NotFoundError) return "OpenAI 모델을 찾을 수 없거나 접근 권한이 없습니다(404).";
  if (error instanceof OpenAI.RateLimitError) return "OpenAI 요청 한도 초과 또는 크레딧 부족(429).";
  if (error instanceof OpenAI.BadRequestError) return `OpenAI 잘못된 요청(400): ${error.message}`;
  if (error instanceof OpenAI.APIConnectionError) return "OpenAI API에 연결하지 못했습니다 — 네트워크/프록시를 확인하세요.";
  if (error instanceof OpenAI.APIError) return `OpenAI API 오류 ${error.status ?? ""}: ${error.message}`;
  return null;
}

type Effort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

/** OpenAI Responses API 호출 */
export async function callOpenAI(c: ProviderCall): Promise<LlmCallResult> {
  const p = c.params;
  const reasoning = {
    ...(p.reasoning_effort ? { effort: p.reasoning_effort as Effort } : {}),
    ...(p.reasoning_summary ? { summary: p.reasoning_summary as "auto" | "concise" | "detailed" } : {}),
  };
  const text = {
    ...(p.verbosity ? { verbosity: p.verbosity as "low" | "medium" | "high" } : {}),
    ...(c.jsonSchema ? { format: { type: "json_schema" as const, name: "output", schema: c.jsonSchema, strict: true } } : {}),
  };

  const fnTools = c.tools?.length && c.runTool ? c.tools.map((t) => ({ type: "function" as const, name: t.name, description: t.description, parameters: t.parameters, strict: false })) : [];
  // 웹 검색은 OpenAI 서버가 실행한다
  const serverTools = c.providerTools?.includes("web_search") ? [{ type: "web_search" as const }] : [];
  const tools = fnTools.length + serverTools.length ? [...fnTools, ...serverTools] : undefined;
  const maxSteps = c.maxSteps ?? 8;
  // 추론 파라미터를 켠 모델은 store:false 에서도 추론 항목을 이어 갈 수 있게 암호화된 추론 내용을 받는다
  const keepReasoning = !!tools && Object.keys(reasoning).length > 0;
  const input: OpenAI.Responses.ResponseInputItem[] = c.messages.map((m) => ({ role: m.role, content: m.content }));

  const bodyFor = (forceAnswer: boolean) => ({
    model: c.model,
    ...(c.system ? { instructions: c.system } : {}),
    input,
    ...(p.max_output_tokens != null ? { max_output_tokens: Number(p.max_output_tokens) } : {}),
    ...(Object.keys(reasoning).length ? { reasoning } : {}),
    ...(Object.keys(text).length ? { text } : {}),
    ...(p.temperature != null ? { temperature: Number(p.temperature) } : {}),
    ...(p.top_p != null ? { top_p: Number(p.top_p) } : {}),
    ...(tools ? { tools } : {}),
    ...(tools && forceAnswer ? { tool_choice: "none" as const } : {}),
    ...(keepReasoning ? { include: ["reasoning.encrypted_content" as const] } : {}),
    store: false,
  });

  const steps: LlmStep[] = [];
  const slots: ResultSlot[] = [];
  let request: Record<string, unknown> | null = null;
  let model = c.model;
  for (let i = 0; ; i++) {
    const body = bodyFor(i >= maxSteps);
    request ??= { ...body, input: [...input] };
    if (i > 0) c.onText?.("\n\n");
    const stream = clientFor(c.apiKey).responses.stream(body, { signal: c.signal });
    for await (const ev of stream) {
      if (ev.type === "response.output_text.delta") c.onText?.(ev.delta);
      else if (ev.type === "response.reasoning_summary_text.delta") c.onThinking?.(ev.delta);
    }
    const res = await stream.finalResponse();
    model = res.model;

    let thinking = "";
    const calls: ToolCall[] = [];
    const served: ToolCallRecord[] = [];
    for (const item of res.output ?? []) {
      if (item.type === "reasoning") thinking += item.summary.map((s) => s.text).join("\n");
      else if (item.type === "function_call") calls.push({ id: item.call_id, name: item.name, input: parseArgs(item.arguments) });
      else if (item.type === "web_search_call") served.push(providerCall(item.id, "web_search", item.action));
    }
    const refusal = res.output
      ?.flatMap((o) => (o.type === "message" ? o.content : []))
      .find((part) => part.type === "refusal");
    if (refusal && refusal.type === "refusal" && !res.output_text) throw new Error(`모델이 요청을 거절했습니다: ${refusal.refusal}`);

    const stopReason =
      res.status === "incomplete" ? `incomplete (${res.incomplete_details?.reason ?? "unknown"})` : calls.length ? "tool_calls" : (res.status ?? null);
    if (res.status === "incomplete" && !res.output_text && !calls.length) {
      throw new Error(`응답이 비어 있습니다 — ${stopReason}. max_output_tokens 를 늘려 보세요.`);
    }
    const step: LlmStep = {
      text: res.output_text,
      thinking,
      stopReason,
      usage: { inputTokens: res.usage?.input_tokens ?? 0, outputTokens: res.usage?.output_tokens ?? 0 },
      toolCalls: served,
    };
    steps.push(step);
    if (!calls.length || !tools) break;

    const ran = await runToolCalls(c, calls);
    step.toolCalls = [...served, ...ran];
    // 모델이 낸 항목을 다음 입력에 이어 붙인다. 암호화된 내용이 없는 추론 항목은 되돌려 보낼 수 없으므로 빼고,
    // 그때는 function_call 의 항목 ID 도 지워 추론 항목과의 짝 검사를 피한다.
    const droppedReasoning = (res.output ?? []).some((o) => o.type === "reasoning" && !o.encrypted_content);
    for (const item of res.output ?? []) {
      if (item.type === "reasoning") {
        if (item.encrypted_content) input.push({ type: "reasoning", id: item.id, summary: item.summary, encrypted_content: item.encrypted_content });
      } else if (item.type === "function_call") {
        input.push({
          type: "function_call",
          call_id: item.call_id,
          name: item.name,
          arguments: item.arguments,
          ...(droppedReasoning || !item.id ? {} : { id: item.id }),
        });
      } else if (item.type === "message") {
        const said = item.content.map((part) => (part.type === "output_text" ? part.text : "")).join("");
        if (said) input.push({ role: "assistant", content: said });
      }
    }
    for (const r of ran) {
      const out = { type: "function_call_output" as const, call_id: r.id, output: r.output };
      input.push(out);
      slots.push({ round: i, size: r.output.length, clear: () => void (out.output = CLEARED_NOTE) });
    }
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
    request: request!,
    ...(tools ? { steps } : {}),
    api: "OpenAI Responses API (responses.stream)",
  };
}

const EXCLUDE = /(audio|realtime|tts|transcribe|image|search|embedding|moderation|dall-e|whisper|instruct|davinci|babbage)/;

export async function listOpenAIModels(apiKey: string): Promise<ModelListItem[]> {
  const out: ModelListItem[] = [];
  for await (const m of clientFor(apiKey).models.list()) {
    if (/^(gpt-|o\d|chatgpt-)/.test(m.id) && !EXCLUDE.test(m.id)) out.push({ id: m.id });
  }
  return out.sort((a, b) => b.id.localeCompare(a.id));
}
