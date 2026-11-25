import { dump, load } from "js-yaml";
import type { DifyEdge, DifyNode, DifyVariableDecl, DslDoc, Workflow } from "./types";

export class DslError extends Error {}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function declsToMap(list: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!Array.isArray(list)) return out;
  for (const item of list as DifyVariableDecl[]) {
    const key = item?.name ?? item?.variable;
    if (key) out[key] = item.value ?? null;
  }
  return out;
}

/** YAML 문자열을 DSL 문서 객체로 읽는다. */
export function loadDoc(yamlText: string): DslDoc {
  let doc: unknown;
  try {
    doc = load(yamlText);
  } catch (e) {
    throw new DslError(`YAML 파싱 실패: ${(e as Error).message}`);
  }
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) throw new DslError("Dify DSL 형식의 YAML이 아닙니다.");
  return doc as DslDoc;
}

export function dumpDoc(doc: DslDoc): string {
  return dump(doc, { noRefs: true });
}

/**
 * 편집하기 좋게 문서를 정리한다: 노드/엣지 ID를 문자열로, 엣지에 id·sourceHandle 을 채운다.
 * Dify에서 내보낸 원본 필드는 그대로 둔다.
 */
export function normalizeDoc(input: DslDoc): DslDoc {
  const doc = structuredClone(input);
  const workflow = asRecord((doc.workflow ??= {}));
  const graph = asRecord((workflow.graph ??= {}));
  const nodes = (Array.isArray(graph.nodes) ? graph.nodes : []) as DifyNode[];
  const edges = (Array.isArray(graph.edges) ? graph.edges : []) as DifyEdge[];
  graph.nodes = nodes.map((n) => ({ ...n, id: String(n.id), type: n.type ?? "custom", ...(n.parentId != null ? { parentId: String(n.parentId) } : {}) }));
  const used = new Set<string>();
  graph.edges = edges.map((e, i) => {
    let id = e.id ? String(e.id) : `${e.source}-${e.sourceHandle ?? "source"}-${e.target}`;
    while (used.has(id)) id = `${id}-${i}`;
    used.add(id);
    return {
      ...e,
      id,
      source: String(e.source),
      target: String(e.target),
      sourceHandle: e.sourceHandle ? String(e.sourceHandle) : "source",
      targetHandle: e.targetHandle ? String(e.targetHandle) : "target",
      type: e.type ?? "custom",
    };
  });
  doc.app = { mode: "advanced-chat", name: "이름 없는 워크플로", ...asRecord(doc.app) };
  doc.kind ??= "app";
  doc.version ??= "0.1.5";
  return doc;
}

/** Dify DSL(YAML 문자열 또는 문서 객체)을 실행용 Workflow로 변환한다. */
export function parseDsl(input: string | DslDoc): Workflow {
  const root = typeof input === "string" ? loadDoc(input) : input;
  const app = asRecord(root.app);
  const workflow = asRecord(root.workflow);
  const graph = asRecord(workflow.graph);
  const features = asRecord(workflow.features ?? root.features);

  const rawNodes = Array.isArray(graph.nodes) ? (graph.nodes as DifyNode[]) : [];
  const rawEdges = Array.isArray(graph.edges) ? (graph.edges as DifyEdge[]) : [];
  if (rawNodes.length === 0) {
    throw new DslError("workflow.graph.nodes 가 비어 있습니다. Dify DSL 형식인지 확인하세요.");
  }

  const nodes = rawNodes
    .filter((n) => n && n.data && typeof n.data.type === "string" && n.data.type !== "")
    .filter((n) => n.type !== "custom-note")
    .map((n) => ({ ...n, id: String(n.id) }));

  const nodeIds = new Set(nodes.map((n) => n.id));
  const edges = rawEdges
    .map((e, i) => ({
      ...e,
      id: e.id ? String(e.id) : `edge-${i}`,
      source: String(e.source),
      target: String(e.target),
      sourceHandle: e.sourceHandle ? String(e.sourceHandle) : "source",
      targetHandle: e.targetHandle ? String(e.targetHandle) : "target",
    }))
    .filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target));

  const starts = nodes.filter((n) => n.data.type === "start" && !n.parentId);
  if (starts.length !== 1) {
    throw new DslError(`start 노드가 정확히 1개 있어야 합니다 (현재 ${starts.length}개).`);
  }

  return {
    name: String(app.name ?? "이름 없는 워크플로"),
    description: String(app.description ?? ""),
    mode: String(app.mode ?? "advanced-chat"),
    icon: app.icon ? String(app.icon) : undefined,
    nodes,
    edges,
    environmentVariables: declsToMap(workflow.environment_variables),
    conversationVariables: declsToMap(workflow.conversation_variables),
    openingStatement: features.opening_statement ? String(features.opening_statement) : undefined,
    suggestedQuestions: Array.isArray(features.suggested_questions)
      ? (features.suggested_questions as unknown[]).map(String).filter(Boolean)
      : [],
  };
}
