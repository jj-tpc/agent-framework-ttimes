import { DEFAULT_MODEL, defaultParams, specFor } from "../llm/catalog";
import { connectionError, deleteBlockWithMembers, expandBlocks, fitBlock, isBlock, ungroupBlock } from "./blocks";
import { graphOf, newNodeId, rec, uniqueTitle, withGraph, type Rec } from "./graph";
import { MEMORY_PORT, MEMORY_READ_VARS, MEMORY_RUN, MEMORY_STORE, MEMORY_WRITE_VARS, isMemoryBlock, isMemoryRunType } from "./memory";
import { MEMORY_COMMANDS } from "../tools/config";
import { DEFAULT_SWITCH_CODE, switchHandles } from "./switch";
import type { DifyEdge, DifyNode, DifyNodeData, DslDoc, ValueSelector } from "./types";

/** 편집기에서 쓰는 DSL 문서 조작 함수들. 모두 새 문서를 돌려준다(불변). 블록 관련 조작은 blocks.ts */

export { graphOf };

const BRANCHING = new Set(["if-else", "question-classifier", "switch"]);

/** 분기 노드가 가진 출력 핸들 ID 목록. 일반 노드는 null. */
export function handlesOf(data: DifyNodeData): string[] | null {
  if (data.type === "question-classifier") return ((data.classes as { id: string }[]) ?? []).map((c) => String(c.id));
  if (data.type === "switch") return switchHandles(data);
  if (data.type === "if-else") {
    const cases = Array.isArray(data.cases) ? (data.cases as { case_id: string }[]) : [{ case_id: "true" }];
    return [...cases.map((c) => String(c.case_id)), "false"];
  }
  return null;
}

export function updateNodeData(doc: DslDoc, id: string, data: DifyNodeData): DslDoc {
  const { nodes, edges } = graphOf(doc);
  const nextNodes = nodes.map((n) => (n.id === id ? { ...n, data } : n));
  const handles = handlesOf(data);
  // 분기 항목이 지워졌다면 그 핸들에 붙어 있던 선도 지운다
  const nextEdges = handles
    ? edges.filter((e) => e.source !== id || handles.includes(e.sourceHandle ?? "source") || e.sourceHandle === "fail-branch")
    : edges;
  return withGraph(doc, nextNodes, nextEdges);
}

export function moveNode(doc: DslDoc, id: string, position: { x: number; y: number }): DslDoc {
  const { nodes, edges } = graphOf(doc);
  return withGraph(
    doc,
    nodes.map((n) => (n.id === id ? { ...n, position: { x: Math.round(position.x), y: Math.round(position.y) } } : n)),
    edges,
  );
}

/**
 * 노드 삭제. 블록은 지우지 않고 풀어서(안의 노드는 남기고) 없앤다 — 블록째 지우기는 deleteBlockWithMembers.
 * 메모리 모듈은 안의 노드가 모듈 없이는 뜻이 없으므로 통째로 지운다.
 */
export function removeNodes(doc: DslDoc, ids: string[]): DslDoc {
  const blocks = ids.filter((id) => isBlock(graphOf(doc).nodes.find((n) => n.id === id)));
  for (const b of blocks) doc = isMemoryBlock(graphOf(doc).nodes.find((n) => n.id === b)) ? deleteBlockWithMembers(doc, b) : ungroupBlock(doc, b);
  const { nodes, edges } = graphOf(doc);
  const drop = new Set(ids.filter((id) => !blocks.includes(id) && nodes.some((n) => n.id === id && n.data.type !== "start")));
  return withGraph(
    doc,
    nodes.filter((n) => !drop.has(n.id)),
    edges.filter((e) => !drop.has(e.source) && !drop.has(e.target)),
  );
}

export function addEdge(
  doc: DslDoc,
  c: { source: string; sourceHandle?: string | null; target: string; targetHandle?: string | null },
): DslDoc {
  const graph = graphOf(doc);
  const nodes = graph.nodes;
  const handle = c.sourceHandle || "source";
  const targetHandle = c.targetHandle || "target";
  if (connectionError(nodes, c)) return doc;
  // 메모리 부착 선은 모듈 하나 ↔ LLM 하나: 새로 붙이면 양쪽의 기존 부착 선을 바꿔 낀다
  const attach = handle === MEMORY_PORT.attach && targetHandle === MEMORY_PORT.llm;
  const edges = attach
    ? graph.edges.filter(
        (e) => !((e.source === c.source && e.sourceHandle === MEMORY_PORT.attach) || (e.target === c.target && e.targetHandle === MEMORY_PORT.llm)),
      )
    : graph.edges;
  const target = nodes.find((n) => n.id === c.target)!;
  const source = nodes.find((n) => n.id === c.source)!;
  if (
    edges.some(
      (e) => e.source === c.source && (e.sourceHandle ?? "source") === handle && e.target === c.target && (e.targetHandle ?? "target") === targetHandle,
    )
  )
    return doc;
  let id = targetHandle === "target" ? `${c.source}-${handle}-${c.target}` : `${c.source}-${handle}-${c.target}-${targetHandle}`;
  while (edges.some((e) => e.id === id)) id += "_";
  const edge: DifyEdge = {
    id,
    source: c.source,
    sourceHandle: handle,
    target: c.target,
    targetHandle,
    type: "custom",
    data: { sourceType: source.data.type, targetType: target.data.type },
  } as DifyEdge;
  return withGraph(doc, nodes, [...edges, edge]);
}

export function removeEdges(doc: DslDoc, ids: string[]): DslDoc {
  const { nodes, edges } = graphOf(doc);
  return withGraph(doc, nodes, edges.filter((e) => !ids.includes(e.id ?? "")));
}

/** 새 노드 추가. parentId 를 주면 그 블록 안(상대 좌표)에 넣고 블록을 넓힌다. */
export function addNode(doc: DslDoc, type: string, position: { x: number; y: number }, parentId?: string): { doc: DslDoc; id: string } {
  const { nodes, edges } = graphOf(doc);
  const id = newNodeId(nodes);
  const node: DifyNode = {
    id,
    type: "custom",
    position: { x: Math.round(position.x), y: Math.round(position.y) },
    data: defaultNodeData(type, nodes),
  };
  const inBlock = parentId && isBlock(nodes.find((n) => n.id === parentId));
  if (inBlock) node.parentId = parentId;
  const next = withGraph(doc, [...nodes, node], edges);
  return { doc: inBlock ? fitBlock(next, parentId) : next, id };
}

export function updateApp(doc: DslDoc, patch: Rec): DslDoc {
  return { ...doc, app: { ...rec(doc.app), ...patch } };
}

export function updateWorkflowField(doc: DslDoc, key: string, value: unknown): DslDoc {
  return { ...doc, workflow: { ...rec(doc.workflow), [key]: value } };
}

// ───────────────────────── 새 노드 기본값 ─────────────────────────

export type PaletteGroup = "모델" | "흐름" | "데이터" | "메모리" | "Dify 호환";
export const PALETTE_GROUPS: PaletteGroup[] = ["모델", "흐름", "데이터", "메모리", "Dify 호환"];

export const PALETTE: { type: string; hint: string; group: PaletteGroup }[] = [
  { type: "llm", hint: "Claude · GPT · Gemini 호출", group: "모델" },
  { type: "knowledge-retrieval", hint: "로컬 지식베이스 검색", group: "모델" },
  { type: "parameter-extractor", hint: "글에서 값 뽑기", group: "모델" },
  { type: "switch", hint: "텍스트 · 코드 · AI 판단으로 나누기", group: "흐름" },
  { type: "variable-aggregator", hint: "갈라진 결과 합치기", group: "흐름" },
  { type: "answer", hint: "채팅으로 답변", group: "흐름" },
  { type: "code", hint: "JS · Python 실행", group: "데이터" },
  { type: "template-transform", hint: "Jinja2 템플릿", group: "데이터" },
  { type: "http-request", hint: "외부 API 호출", group: "데이터" },
  { type: "assigner", hint: "대화 변수 갱신", group: "데이터" },
  { type: "memory-store", hint: "기억 읽기 · 쓰기 · 검색", group: "메모리" },
  { type: "memory-tool", hint: "모델이 직접 부르는 메모리 도구", group: "메모리" },
  { type: "question-classifier", hint: "질문 유형별 분기 (Dify 노드)", group: "Dify 호환" },
  { type: "if-else", hint: "조건 분기 (Dify 노드)", group: "Dify 호환" },
];

const DEFAULT_TITLES: Record<string, string> = {
  llm: "LLM",
  "knowledge-retrieval": "지식 검색",
  "question-classifier": "질문 분류",
  "if-else": "조건 분기",
  switch: "분기",
  "parameter-extractor": "파라미터 추출",
  code: "코드",
  "template-transform": "템플릿",
  "http-request": "HTTP 요청",
  "variable-aggregator": "변수 집계",
  assigner: "변수 할당",
  "memory-store": "메모리 저장소",
  "memory-tool": "메모리 도구",
  answer: "답변",
  end: "종료",
};

/** 새 LLM 노드의 기본 모델. light 는 분류·추출·메모리 관리처럼 가벼운 작업용(effort low) */
export function defaultModel(light = false) {
  const base = DEFAULT_MODEL.anthropic;
  const llmModel = { provider: "anthropic", name: base, mode: "chat", completion_params: defaultParams(specFor("anthropic", base)) };
  return light ? { ...llmModel, completion_params: { ...llmModel.completion_params, max_tokens: 4000, effort: "low" } } : llmModel;
}

export function defaultNodeData(type: string, nodes: DifyNode[] = []): DifyNodeData {
  const title = uniqueTitle(DEFAULT_TITLES[type] ?? type, nodes);
  // 새 노드는 Claude Opus 5.5 + 카탈로그 기본 파라미터로 시작. 분류·추출은 effort low.
  const llmModel = defaultModel();
  const model = defaultModel(true);
  switch (type) {
    case "llm":
      return {
        type,
        title,
        model: llmModel,
        prompt_template: [
          { role: "system", text: "너는 친절한 한국어 어시스턴트다." },
          { role: "user", text: "{{#sys.query#}}" },
        ],
        context: { enabled: false, variable_selector: [] },
        vision: { enabled: false },
      };
    case "knowledge-retrieval":
      return {
        type,
        title,
        query_variable_selector: ["sys", "query"],
        dataset_ids: [],
        retrieval_mode: "multiple",
        multiple_retrieval_config: { top_k: 3, score_threshold: null },
      };
    case "question-classifier":
      return {
        type,
        title,
        query_variable_selector: ["sys", "query"],
        model,
        classes: [
          { id: "1", name: "분류 1 설명" },
          { id: "2", name: "분류 2 설명" },
        ],
        instruction: "",
      };
    case "if-else":
      return {
        type,
        title,
        cases: [{ case_id: "true", logical_operator: "and", conditions: [] }],
      };
    case "switch": {
      // AI 판단 기본 모델: 대량·저비용 GPT + 낮은 추론 강도
      const fast = "gpt-6-luna";
      return {
        type,
        title,
        mode: "text",
        input: ["sys", "query"],
        branches: [
          { id: "b1", name: "분기 1", operator: "contains_any", keywords: ["환불", "취소"], description: "환불·결제 취소 요청" },
          { id: "b2", name: "분기 2", operator: "contains_any", keywords: [], description: "" },
        ],
        else_name: "그 외",
        case_sensitive: false,
        code_language: "javascript",
        code: DEFAULT_SWITCH_CODE.javascript,
        variables: [],
        model: {
          provider: "openai",
          name: fast,
          mode: "chat",
          completion_params: { ...defaultParams(specFor("openai", fast)), reasoning_effort: "low" },
        },
        instruction: "",
      };
    }
    case "parameter-extractor":
      return {
        type,
        title,
        query: ["sys", "query"],
        model,
        reasoning_mode: "prompt",
        instruction: "",
        parameters: [{ name: "param", type: "string", description: "", required: false }],
      };
    case "code":
      return {
        type,
        title,
        code_language: "javascript",
        variables: [{ variable: "arg1", value_selector: ["sys", "query"] }],
        code: "function main({ arg1 }) {\n  return { result: String(arg1).length };\n}",
        outputs: { result: { type: "number", children: null } },
      };
    case "template-transform":
      return {
        type,
        title,
        variables: [{ variable: "arg1", value_selector: ["sys", "query"] }],
        template: "{{ arg1 }}",
      };
    case "http-request":
      return {
        type,
        title,
        method: "get",
        url: "https://httpbin.org/get",
        headers: "",
        params: "",
        body: { type: "none", data: [] },
        authorization: { type: "no-auth", config: null },
        timeout: { read: 30 },
      };
    case "variable-aggregator":
      return { type, title, output_type: "string", variables: [] };
    case "assigner":
      return { type, title, version: "2", items: [] };
    case "memory-store":
      return { type, title, op: "doc_get", key: "notes", value: "", query: "{{#sys.query#}}", top_k: 5, valid_only: true, include_unmatched: false, list: [], importance: "", store: "" };
    case "memory-tool":
      return { type, title, desc: "모델이 응답 도중에 직접 호출한다", commands: [...MEMORY_COMMANDS] };
    case "answer":
      return { type, title, answer: "" };
    case "end":
      return { type, title, outputs: [] };
    default:
      return { type, title };
  }
}

export function newBlankDoc(name: string): DslDoc {
  return {
    app: { name, description: "", icon: "🤖", mode: "advanced-chat" },
    kind: "app",
    version: "0.1.5",
    workflow: {
      conversation_variables: [],
      environment_variables: [],
      features: { opening_statement: "", suggested_questions: [] },
      graph: {
        nodes: [
          {
            id: "start",
            type: "custom",
            position: { x: 0, y: 200 },
            data: { type: "start", title: "시작", variables: [] },
          },
          {
            id: "llm",
            type: "custom",
            position: { x: 320, y: 200 },
            data: { ...defaultNodeData("llm"), title: "LLM" },
          },
          {
            id: "answer",
            type: "custom",
            position: { x: 640, y: 200 },
            data: { type: "answer", title: "답변", answer: "{{#llm.text#}}" },
          },
        ],
        edges: [
          { id: "start-source-llm", source: "start", sourceHandle: "source", target: "llm", targetHandle: "target", type: "custom" },
          { id: "llm-source-answer", source: "llm", sourceHandle: "source", target: "answer", targetHandle: "target", type: "custom" },
        ],
      },
    },
  };
}

// ───────────────────────── 변수 카탈로그 ─────────────────────────

export interface VarOption {
  selector: ValueSelector;
  scope: string;
  name: string;
  type: string;
  nodeType?: string;
}

export const SYS_VARS: [string, string][] = [
  ["query", "string"],
  ["files", "array[file]"],
  ["conversation_id", "string"],
  ["user_id", "string"],
  ["dialogue_count", "number"],
];

/** 노드가 변수 풀에 남기는 출력 변수 목록 */
export function outputsOf(node: DifyNode): { name: string; type: string }[] {
  const d = node.data as Rec;
  switch (node.data.type) {
    case "start":
      return ((d.variables as { variable: string; type?: string }[]) ?? []).map((v) => ({
        name: v.variable,
        type: v.type === "number" ? "number" : "string",
      }));
    case "llm":
      return [
        { name: "text", type: "string" },
        ...(d.structured_output_enabled ? structuredVars(rec(rec(d.structured_output).schema)) : []),
        ...(rec(d.tools).enabled ? [{ name: "tool_calls", type: "array[object]" }] : []),
        { name: "usage", type: "object" },
      ];
    case MEMORY_RUN.read:
      return MEMORY_READ_VARS.map(([name, type]) => ({ name, type }));
    case MEMORY_RUN.write:
      return MEMORY_WRITE_VARS.map(([name, type]) => ({ name, type }));
    case MEMORY_STORE:
      return MEMORY_STORE_OUTPUTS[String(d.op ?? "doc_get")] ?? [];
    case "knowledge-retrieval":
      return [{ name: "result", type: "array[object]" }];
    case "question-classifier":
      return [{ name: "class_name", type: "string" }];
    case "parameter-extractor":
      return [
        ...((d.parameters as { name: string; type: string }[]) ?? []).map((p) => ({ name: p.name, type: p.type })),
        { name: "__is_success", type: "number" },
        { name: "__reason", type: "string" },
      ];
    case "code":
      return Object.entries(rec(d.outputs)).map(([name, v]) => ({ name, type: String(rec(v).type ?? "string") }));
    case "template-transform":
      return [{ name: "output", type: "string" }];
    case "http-request":
      return [
        { name: "body", type: "string" },
        { name: "status_code", type: "number" },
        { name: "headers", type: "object" },
      ];
    case "variable-aggregator":
    case "variable-assigner": {
      const adv = rec(d.advanced_settings);
      if (adv.group_enabled && Array.isArray(adv.groups)) {
        return (adv.groups as { group_name: string }[]).map((g) => ({ name: `${g.group_name}.output`, type: "any" }));
      }
      return [{ name: "output", type: String(d.output_type ?? "any") }];
    }
    case "if-else":
      return [{ name: "result", type: "boolean" }];
    case "switch":
      return [
        { name: "branch", type: "string" },
        { name: "branch_id", type: "string" },
        { name: "reason", type: "string" },
      ];
    case "answer":
      return [{ name: "answer", type: "string" }];
    case "end":
      return ((d.outputs as { variable: string }[]) ?? []).map((o) => ({ name: o.variable, type: "any" }));
    default:
      return [];
  }
}

const MEMORY_STORE_OUTPUTS: Record<string, { name: string; type: string }[]> = {
  doc_get: [
    { name: "text", type: "string" },
    { name: "exists", type: "boolean" },
  ],
  doc_get_many: [
    { name: "text", type: "string" },
    { name: "docs", type: "array[object]" },
    { name: "missing", type: "array[string]" },
  ],
  doc_set: [
    { name: "text", type: "string" },
    { name: "changed", type: "boolean" },
  ],
  doc_append: [
    { name: "text", type: "string" },
    { name: "changed", type: "boolean" },
  ],
  rec_search: [
    { name: "records", type: "array[object]" },
    { name: "text", type: "string" },
    { name: "count", type: "number" },
  ],
  rec_similar: [
    { name: "records", type: "array[object]" },
    { name: "text", type: "string" },
    { name: "count", type: "number" },
  ],
  rec_add: [
    { name: "id", type: "string" },
    { name: "text", type: "string" },
  ],
  rec_apply: [
    { name: "applied", type: "array[object]" },
    { name: "summary", type: "string" },
    { name: "changed", type: "number" },
  ],
};

/** 구조화 출력 스키마의 최상위 속성을 변수로 */
function structuredVars(schema: Rec): { name: string; type: string }[] {
  const typeOf = (s: Rec): string => {
    const t = Array.isArray(s.type) ? String(s.type[0]) : String(s.type ?? "any");
    if (t === "array") return `array[${typeOf(rec(s.items))}]`;
    return t === "integer" ? "number" : t;
  };
  return [
    { name: "structured_output", type: "object" },
    ...Object.entries(rec(schema.properties)).map(([k, v]) => ({ name: `structured_output.${k}`, type: typeOf(rec(v)) })),
  ];
}

/** nodeId 보다 앞에서 실행되는(조상) 노드들 */
export function upstreamOf(nodes: DifyNode[], edges: DifyEdge[], nodeId: string): DifyNode[] {
  const seen = new Set<string>();
  const stack = [nodeId];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const e of edges) {
      if (e.target === cur && !seen.has(e.source)) {
        seen.add(e.source);
        stack.push(e.source);
      }
    }
  }
  seen.delete(nodeId);
  return nodes.filter((n) => seen.has(n.id));
}

/** 노드 설정에서 고를 수 있는 변수 목록: 상류 노드 출력 + sys + env + conversation */
export function availableVars(doc: DslDoc, nodeId: string): VarOption[] {
  // 블록은 진입·종료로 펼쳐서 따라가야 '블록 안쪽 → 블록 다음 노드' 순서가 맞다
  const graph = graphOf(doc);
  const { nodes, edges } = expandBlocks(graph.nodes, graph.edges);
  const workflow = rec(doc.workflow);
  const out: VarOption[] = [];
  for (const n of upstreamOf(nodes, edges, nodeId)) {
    // 메모리 모듈의 네 지점은 모두 모듈 ID 아래에 값을 둔다
    const owner = isMemoryRunType(n.data.type) ? String(n.data.block_id) : n.id;
    for (const o of outputsOf(n)) {
      out.push({ selector: [owner, ...o.name.split(".")], scope: n.data.title || n.data.type, name: o.name, type: o.type, nodeType: n.data.type });
    }
  }
  for (const [name, type] of SYS_VARS) out.push({ selector: ["sys", name], scope: "시스템", name, type });
  for (const v of (workflow.environment_variables as { name: string; value_type?: string }[]) ?? []) {
    out.push({ selector: ["env", v.name], scope: "환경변수", name: v.name, type: v.value_type ?? "string" });
  }
  for (const v of (workflow.conversation_variables as { name: string; value_type?: string }[]) ?? []) {
    out.push({ selector: ["conversation", v.name], scope: "대화변수", name: v.name, type: v.value_type ?? "string" });
  }
  return out;
}

export function isBranching(type: string) {
  return BRANCHING.has(type);
}
