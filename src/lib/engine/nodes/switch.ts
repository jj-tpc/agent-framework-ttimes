import { SWITCH_ELSE, evaluateText, interpretCodeResult, operatorLabel, readSwitch, textReason, type SwitchBranch } from "../../dsl/switch";
import { resolveModelConfig } from "../../llm/catalog";
import { callLlm } from "../../llm/client";
import type { NodeContext, NodeExecutor } from "../context";
import type { TokenUsage } from "../types";
import { renderTemplate, selectorKey, stringifyValue } from "../variable-pool";
import { runCode } from "./code-runner";
import { modelInfo, responseInfo } from "./llm";

/** 분기 노드 실행 — 방식(text / code / ai)별로 분기 하나를 고르고 그 핸들로 진행한다. (dsl/switch.ts) */

type Decision = { id: string | null; reason: string; usage?: TokenUsage };

export const switchNode: NodeExecutor = async (ctx) => {
  const cfg = readSwitch(ctx.data);
  if (cfg.branches.length === 0) throw new Error("분기가 하나도 없습니다. 설정에서 분기를 추가하세요.");
  const value = ctx.pool.get(cfg.input);
  const text = stringifyValue(value);
  ctx.trace.inputs = { [selectorKey(cfg.input)]: value ?? null };
  ctx.trace.processData = {
    mode: cfg.mode,
    input: selectorKey(cfg.input),
    branches: cfg.branches,
    else_name: cfg.elseName,
  };

  const decision =
    cfg.mode === "code" ? await byCode(ctx, cfg, text) : cfg.mode === "ai" ? await byAi(ctx, cfg, text) : byText(ctx, cfg, text);

  const branch = cfg.branches.find((b) => b.id === decision.id);
  const handle = branch?.id ?? SWITCH_ELSE;
  const name = branch?.name ?? cfg.elseName;
  ctx.trace.processData = { ...ctx.trace.processData, decision: { branch_id: handle, branch: name, reason: decision.reason } };
  return {
    outputs: { branch: name, branch_id: handle, reason: decision.reason },
    selectedHandle: handle,
    usage: decision.usage,
  };
};

type Cfg = ReturnType<typeof readSwitch>;

// ───────────────────────── 텍스트 포함 ─────────────────────────

function byText(ctx: NodeContext, cfg: Cfg, text: string): Decision {
  const { evaluations, selected } = evaluateText(text, cfg.branches, cfg.caseSensitive);
  ctx.trace.processData = {
    ...ctx.trace.processData,
    case_sensitive: cfg.caseSensitive,
    rule: "위에서부터 차례로 검사해 처음 맞는 분기로 진행",
    evaluations: evaluations.map((e) => ({ ...e, operator_label: operatorLabel(e.operator).label })),
  };
  return { id: selected?.id ?? null, reason: textReason(selected) };
}

// ───────────────────────── 코드 ─────────────────────────

async function byCode(ctx: NodeContext, cfg: Cfg, text: string): Promise<Decision> {
  const args: Record<string, unknown> = { text };
  for (const v of cfg.variables) {
    args[v.variable] = ctx.pool.get(v.value_selector) ?? null;
    ctx.trace.inputs[selectorKey(v.value_selector)] = args[v.variable];
  }
  const bindings = [{ arg: "text", from: selectorKey(cfg.input) }, ...cfg.variables.map((v) => ({ arg: v.variable, from: selectorKey(v.value_selector) }))];
  ctx.trace.processData = { ...ctx.trace.processData, language: cfg.language, bindings, code: cfg.code };

  const { result, logs } = await runCode(cfg.language, cfg.code, args);
  ctx.trace.processData = { ...ctx.trace.processData, returned: result, ...(logs.length ? { logs } : {}) };
  const r = interpretCodeResult(result, cfg.branches);
  return { id: r.id, reason: r.reason };
}

// ───────────────────────── AI 판단 ─────────────────────────

async function byAi(ctx: NodeContext, cfg: Cfg, text: string): Promise<Decision> {
  const instruction = renderTemplate(cfg.instruction, ctx.pool);
  Object.assign(ctx.trace.inputs, instruction.refs);
  const options = [
    ...cfg.branches.map((b) => ({ id: b.id, name: b.name, when: b.description?.trim() || b.name })),
    { id: SWITCH_ELSE, name: cfg.elseName, when: "위 어느 분기에도 해당하지 않을 때" },
  ];
  const system = [
    "너는 워크플로의 분기 판단기다. 사용자 입력을 읽고 아래 분기 중 가장 알맞은 하나를 고른다.",
    "분기:",
    ...options.map((o) => `- id=${o.id} | 이름: ${o.name} | 고르는 조건: ${o.when}`),
    instruction.text ? `\n추가 지시:\n${instruction.text}` : "",
    "\nbranch_id 에는 위 id 중 하나를, reason 에는 한 문장 근거를, confidence 에는 0~1 사이 확신도를 쓴다.",
  ]
    .filter(Boolean)
    .join("\n");
  const schema = {
    type: "object",
    properties: {
      branch_id: { type: "string", enum: options.map((o) => o.id) },
      reason: { type: "string" },
      confidence: { type: "number" },
    },
    required: ["branch_id", "reason", "confidence"],
    additionalProperties: false,
  };
  const resolved = resolveModelConfig(ctx.data.model);
  ctx.trace.processData = {
    ...ctx.trace.processData,
    model: modelInfo(resolved),
    instruction: instruction.text || undefined,
    prompt: { system, user: text },
    json_schema: schema,
  };

  const result = await callLlm({
    runtime: ctx.llm,
    resolved,
    system,
    messages: [{ role: "user", content: text || "(빈 입력)" }],
    jsonSchema: schema,
    signal: ctx.signal,
    onThinking: (d) => ctx.progress("thinking", d),
    onText: (d) => ctx.progress("text", d),
    mock: () => JSON.stringify(mockDecide(text, cfg.branches)),
  });

  let parsed: { branch_id?: string; reason?: string; confidence?: number } = {};
  try {
    parsed = JSON.parse(result.text);
  } catch {
    throw new Error(`분기 판단 결과를 JSON으로 해석하지 못했습니다: ${result.text.slice(0, 200)}`);
  }
  const known = options.some((o) => o.id === parsed.branch_id);
  ctx.trace.processData = {
    ...ctx.trace.processData,
    request: result.request,
    response: responseInfo(result, { raw: result.text }),
    ai: { branch_id: parsed.branch_id, reason: parsed.reason, confidence: parsed.confidence },
  };
  if (!known) throw new Error(`모델이 없는 분기 ID를 골랐습니다: ${String(parsed.branch_id)}`);
  return {
    id: parsed.branch_id === SWITCH_ELSE ? null : parsed.branch_id!,
    reason: String(parsed.reason ?? ""),
    usage: result.usage,
  };
}

/** LLM_MODE=mock: 분기 이름·설명의 단어가 입력에 얼마나 들어 있는지로 고른다 */
function mockDecide(text: string, branches: SwitchBranch[]) {
  const q = text.toLowerCase();
  const scored = branches.map((b) => {
    const words = `${b.name} ${b.description ?? ""}`
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length > 1);
    return { b, hits: words.filter((w) => q.includes(w)).length };
  });
  const best = [...scored].sort((a, b) => b.hits - a.hits)[0];
  if (!best || best.hits === 0) return { branch_id: SWITCH_ELSE, reason: "[Mock] 분기 설명의 단어가 입력에 없어 '그 외'", confidence: 0.3 };
  return { branch_id: best.b.id, reason: `[Mock] 분기 설명의 단어 ${best.hits}개가 입력에 포함됨`, confidence: Math.min(0.95, 0.5 + best.hits * 0.15) };
}
