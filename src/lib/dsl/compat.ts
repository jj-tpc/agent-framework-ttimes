import { deleteBlockWithMembers, flattenBlocks, isBlock } from "./blocks";
import { graphOf, withGraph } from "./graph";
import { MEMORY_STORE, isMemoryBlock } from "./memory";
import { SWITCH_ELSE, readSwitch, type TextOperator } from "./switch";
import { MEMORY_TOOL, hasAnyTool, readTools } from "../tools/config";
import type { DifyEdge, DifyNode, DslDoc } from "./types";

/**
 * 이 앱 전용 확장(블록·분기 노드)을 Dify가 읽을 수 있는 노드로 바꾼다 — "Dify 호환으로 내보내기".
 *   블록            → 풀기(포트를 거치던 선은 직접 연결)
 *   LLM 의 도구 설정 → 뺀다(Dify 의 LLM 노드는 도구를 부르지 않는다)
 *   메모리 모듈     → 뺀다(Dify 에는 대화를 넘어 남는 저장소와 LLM 앞뒤에 끼우는 방식이 없다)
 *   분기 · 텍스트   → IF/ELSE (정규식은 '포함'으로 근사)
 *   분기 · AI 판단  → 질문 분류기 ('그 외'는 마지막 클래스, branch 참조는 class_name 으로)
 *   분기 · 코드     → 코드 노드(branch·branch_id·reason 출력) + IF/ELSE(branch_id 로 분기)
 * 바꾸면서 잃는 것이 있으면 notes 에 사람이 읽을 문장으로 남긴다.
 */
export function toDifyCompatible(doc: DslDoc): { doc: DslDoc; notes: string[] } {
  const notes: string[] = [];
  let out = doc;
  const modules = graphOf(doc).nodes.filter(isMemoryBlock);
  for (const m of modules) out = deleteBlockWithMembers(out, m.id);
  if (modules.length) {
    notes.push(`메모리 모듈 ${modules.length}개(${modules.map((m) => `‘${m.data.title}’`).join(", ")})를 뺐습니다. 붙어 있던 LLM 노드는 메모리 없이 동작합니다 — Dify 에서는 LLM 노드의 메모리 옵션이나 대화 변수로 다시 구성하세요.`);
  }
  const strays = graphOf(out).nodes.filter((n) => n.data.type === MEMORY_STORE);
  if (strays.length) notes.push(`메모리 저장소 노드 ${strays.length}개는 Dify 에 없는 노드라 그대로 두었습니다. 가져간 뒤 다른 노드로 바꿔야 합니다.`);
  const strayTools = graphOf(out).nodes.filter((n) => n.data.type === MEMORY_TOOL);
  if (strayTools.length) {
    const ids = new Set(strayTools.map((n) => n.id));
    const g = graphOf(out);
    out = withGraph(out, g.nodes.filter((n) => !ids.has(n.id)), g.edges.filter((e) => !ids.has(e.source) && !ids.has(e.target)));
    notes.push(`메모리 도구 노드 ${strayTools.length}개를 뺐습니다(Dify 에 없는 노드).`);
  }
  const withTools = graphOf(out).nodes.filter((n) => n.data.type === "llm" && n.data.tools);
  if (withTools.length) {
    const g = graphOf(out);
    out = withGraph(
      out,
      g.nodes.map((n) => {
        if (n.data.type !== "llm" || !n.data.tools) return n;
        const data = { ...n.data };
        delete data.tools;
        return { ...n, data };
      }),
      g.edges,
    );
    const used = withTools.filter((n) => hasAnyTool(readTools(n.data as Record<string, unknown>)));
    if (used.length) {
      notes.push(`LLM 노드 ${used.length}개(${used.map((n) => `‘${n.data.title}’`).join(", ")})의 도구 설정(내장 도구·직접 만든 도구·스킬·MCP)을 뺐습니다. Dify 의 LLM 노드는 도구를 부르지 않습니다 — Dify 에서는 Agent 노드로 다시 구성하세요.`);
    }
  }
  const blockCount = graphOf(out).nodes.filter(isBlock).length;
  out = flattenBlocks(out);
  if (blockCount) notes.push(`블록 ${blockCount}개를 풀었습니다. 포트를 거치던 선은 직접 연결했습니다.`);

  for (const sw of graphOf(out).nodes.filter((n) => n.data.type === "switch")) {
    const mode = readSwitch(sw.data).mode;
    if (mode === "text") out = textToIfElse(out, sw, notes);
    else if (mode === "ai") out = aiToClassifier(out, sw, notes);
    else out = codeToCodeAndIfElse(out, sw, notes);
  }
  return { doc: out, notes };
}

// ───────────────────────── 공용 ─────────────────────────

function replaceNode(doc: DslDoc, id: string, data: DifyNode["data"], edgeMap?: (e: DifyEdge) => DifyEdge): DslDoc {
  const { nodes, edges } = graphOf(doc);
  return withGraph(
    doc,
    nodes.map((n) => (n.id === id ? { ...n, data } : n)),
    edgeMap ? edges.map(edgeMap) : edges,
  );
}

/** 다른 노드 설정에서 {{#id.key#}} 또는 [id, key] 로 이 출력을 참조하는 노드 제목 */
function referrers(doc: DslDoc, id: string, key: string): string[] {
  const token = `{{#${id}.${key}`;
  const hit = (v: unknown): boolean => {
    if (typeof v === "string") return v.includes(token);
    if (Array.isArray(v)) return (v[0] === id && v[1] === key) || v.some(hit);
    if (v && typeof v === "object") return Object.values(v).some(hit);
    return false;
  };
  return graphOf(doc)
    .nodes.filter((n) => n.id !== id && hit(n.data))
    .map((n) => n.data.title || n.id);
}

/** 다른 노드의 참조 id.from → id.to */
function renameRefs(doc: DslDoc, id: string, from: string, to: string): DslDoc {
  const re = new RegExp(`\\{\\{#${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.${from}(?=[.#])`, "g");
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return v.replace(re, `{{#${id}.${to}`);
    if (Array.isArray(v)) return v[0] === id && v[1] === from ? [id, to, ...v.slice(2)] : v.map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  const { nodes, edges } = graphOf(doc);
  return withGraph(
    doc,
    nodes.map((n) => (n.id === id ? n : { ...n, data: walk(n.data) as DifyNode["data"] })),
    edges,
  );
}

function lostOutputs(doc: DslDoc, sw: DifyNode, keys: string[], notes: string[], what: string) {
  for (const key of keys) {
    const users = referrers(doc, sw.id, key);
    if (users.length) notes.push(`'${sw.data.title}'의 ${key} 출력은 ${what}에 없어 ${users.map((u) => `'${u}'`).join(", ")}의 참조가 비게 됩니다.`);
  }
}

// ───────────────────────── 텍스트 → IF/ELSE ─────────────────────────

const DIFY_OPERATOR: Record<TextOperator, string> = {
  contains_any: "contains",
  contains_all: "contains",
  not_contains: "not contains",
  starts_with: "start with",
  equals: "is",
  regex: "contains",
};

function textToIfElse(doc: DslDoc, sw: DifyNode, notes: string[]): DslDoc {
  const cfg = readSwitch(sw.data);
  const name = sw.data.title || "분기";
  const cases = cfg.branches.map((b) => {
    const op = (b.operator ?? "contains_any") as TextOperator;
    return {
      id: b.id,
      case_id: b.id,
      logical_operator: op === "contains_all" || op === "not_contains" ? "and" : "or",
      conditions: (b.keywords ?? []).filter(Boolean).map((k, i) => ({
        id: `${b.id}-${i + 1}`,
        varType: "string",
        variable_selector: cfg.input,
        comparison_operator: DIFY_OPERATOR[op],
        value: k,
      })),
    };
  });
  if (cfg.branches.some((b) => b.operator === "regex")) notes.push(`'${name}': Dify IF/ELSE에는 정규식이 없어 정규식 조건을 '포함'으로 바꿨습니다.`);
  if (cfg.branches.some((b) => !(b.keywords ?? []).some(Boolean))) notes.push(`'${name}': 문구가 없는 분기는 조건이 빈 케이스가 됩니다. Dify에서 조건을 채우세요.`);
  if (!cfg.caseSensitive && cfg.branches.some((b) => (b.keywords ?? []).some((k) => /[A-Za-z]/.test(k)))) {
    notes.push(`'${name}': Dify 조건은 영문 대소문자를 구분합니다(이 앱 설정은 구분 안 함).`);
  }
  lostOutputs(doc, sw, ["branch", "branch_id", "reason"], notes, "IF/ELSE");
  return replaceNode(doc, sw.id, { type: "if-else", title: sw.data.title, desc: sw.data.desc ?? "", cases }, (e) =>
    e.source === sw.id && e.sourceHandle === SWITCH_ELSE ? { ...e, sourceHandle: "false", data: { ...e.data, sourceType: "if-else" } } : e,
  );
}

// ───────────────────────── AI 판단 → 질문 분류기 ─────────────────────────

function aiToClassifier(doc: DslDoc, sw: DifyNode, notes: string[]): DslDoc {
  const cfg = readSwitch(sw.data);
  const classes = [
    ...cfg.branches.map((b) => ({ id: b.id, name: b.description?.trim() ? `${b.name}: ${b.description.trim()}` : b.name })),
    { id: SWITCH_ELSE, name: `${cfg.elseName}: 위 어느 것에도 해당하지 않음` },
  ];
  lostOutputs(doc, sw, ["reason", "branch_id"], notes, "질문 분류기");
  let out = replaceNode(doc, sw.id, {
    type: "question-classifier",
    title: sw.data.title,
    desc: sw.data.desc ?? "",
    query_variable_selector: cfg.input,
    model: sw.data.model,
    classes,
    instruction: cfg.instruction,
  }, (e) => (e.source === sw.id ? { ...e, data: { ...e.data, sourceType: "question-classifier" } } : e));
  if (referrers(out, sw.id, "branch").length) {
    out = renameRefs(out, sw.id, "branch", "class_name");
    notes.push(`'${sw.data.title}': branch 참조를 질문 분류기의 class_name 으로 바꿨습니다(값은 '이름: 설명' 형태).`);
  }
  return out;
}

// ───────────────────────── 코드 → 코드 + IF/ELSE ─────────────────────────

function wrapJs(code: string, branches: { id: string; name: string }[], elseName: string): string {
  const renamed = /\bfunction\s+main\s*\(/.test(code)
    ? code.replace(/\bfunction\s+main\s*\(/, "function __branch_main(")
    : code.replace(/\b(const|let|var)\s+main\s*=/, "$1 __branch_main =");
  return `${renamed}

// ── 분기 앱에서 내보낼 때 붙인 래퍼: 반환값을 branch / branch_id / reason 으로 정리 ──
function main(args) {
  const branches = ${JSON.stringify(branches)};
  let r = __branch_main(args);
  let reason = "";
  if (r && typeof r === "object" && !Array.isArray(r)) {
    reason = r.reason == null ? "" : String(r.reason);
    r = r.branch ?? r.name ?? r.id ?? null;
  }
  if (r === true) r = branches.length ? branches[0].id : null;
  let hit = null;
  if (r !== null && r !== undefined && r !== false && r !== "") {
    const s = String(r).trim();
    hit = branches.find((b) => b.name === s) || branches.find((b) => b.id === s) || branches.find((b) => b.name.toLowerCase() === s.toLowerCase());
    if (!hit) throw new Error("no branch named " + s);
  }
  return { branch: hit ? hit.name : ${JSON.stringify(elseName)}, branch_id: hit ? hit.id : "${SWITCH_ELSE}", reason };
}`;
}

function wrapPython(code: string, branches: { id: string; name: string }[], elseName: string): string {
  return `${code.replace(/\bdef\s+main\s*\(/, "def __branch_main(")}


# ── 분기 앱에서 내보낼 때 붙인 래퍼: 반환값을 branch / branch_id / reason 으로 정리 ──
def main(**kwargs) -> dict:
    branches = ${JSON.stringify(branches)}
    r = __branch_main(**kwargs)
    reason = ""
    if isinstance(r, dict):
        reason = "" if r.get("reason") is None else str(r.get("reason"))
        r = r.get("branch", r.get("name", r.get("id")))
    if r is True:
        r = branches[0]["id"] if branches else None
    hit = None
    if r is not None and r is not False and r != "":
        s = str(r).strip()
        hit = (next((b for b in branches if b["name"] == s), None)
               or next((b for b in branches if b["id"] == s), None)
               or next((b for b in branches if b["name"].lower() == s.lower()), None))
        if hit is None:
            raise ValueError("no branch named " + s)
    return {"branch": hit["name"] if hit else ${JSON.stringify(elseName)}, "branch_id": hit["id"] if hit else "${SWITCH_ELSE}", "reason": reason}`;
}

export function wrapSwitchCode(language: string, code: string, branches: { id: string; name: string }[], elseName: string) {
  return language === "python3" ? wrapPython(code, branches, elseName) : wrapJs(code, branches, elseName);
}

function codeToCodeAndIfElse(doc: DslDoc, sw: DifyNode, notes: string[]): DslDoc {
  const cfg = readSwitch(sw.data);
  const branches = cfg.branches.map((b) => ({ id: b.id, name: b.name }));
  const { nodes, edges } = graphOf(doc);
  let routeId = `${sw.id}_route`;
  while (nodes.some((n) => n.id === routeId)) routeId += "_";

  const codeData = {
    type: "code",
    title: sw.data.title,
    desc: sw.data.desc ?? "",
    code_language: cfg.language === "python3" ? "python3" : "javascript",
    code: wrapSwitchCode(cfg.language, cfg.code, branches, cfg.elseName),
    variables: [{ variable: "text", value_selector: cfg.input }, ...cfg.variables],
    outputs: {
      branch: { type: "string", children: null },
      branch_id: { type: "string", children: null },
      reason: { type: "string", children: null },
    },
  };
  const route: DifyNode = {
    id: routeId,
    type: "custom",
    position: { x: (sw.position?.x ?? 0) + 300, y: sw.position?.y ?? 0 },
    ...(sw.parentId ? { parentId: sw.parentId } : {}),
    data: {
      type: "if-else",
      title: `${sw.data.title || "분기"} · 분기`,
      desc: "",
      cases: branches.map((b) => ({
        id: b.id,
        case_id: b.id,
        logical_operator: "and",
        conditions: [{ id: `${b.id}-1`, varType: "string", variable_selector: [sw.id, "branch_id"], comparison_operator: "is", value: b.id }],
      })),
    },
  };
  const nextEdges: DifyEdge[] = edges.map((e) =>
    e.source === sw.id
      ? {
          ...e,
          id: `${e.id}-route`,
          source: routeId,
          sourceHandle: e.sourceHandle === SWITCH_ELSE ? "false" : e.sourceHandle,
          data: { ...e.data, sourceType: "if-else" },
        }
      : e,
  );
  nextEdges.push({
    id: `${sw.id}-source-${routeId}`,
    source: sw.id,
    sourceHandle: "source",
    target: routeId,
    targetHandle: "target",
    type: "custom",
    data: { sourceType: "code", targetType: "if-else" },
  });
  notes.push(`'${sw.data.title}': 코드 노드(branch·branch_id·reason 출력)와 IF/ELSE 노드 '${route.data.title}'로 나눴습니다.`);
  return withGraph(
    doc,
    [...nodes.map((n) => (n.id === sw.id ? { ...n, data: codeData } : n)), route],
    nextEdges,
  );
}
