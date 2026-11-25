import type { DifyEdge, DifyNode, DslDoc } from "./types";

/** DSL 문서에서 그래프를 꺼내고 되돌려 넣는 공용 함수 */

export type Rec = Record<string, unknown>;
export const rec = (v: unknown): Rec => (v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : {});

export function graphOf(doc: DslDoc): { nodes: DifyNode[]; edges: DifyEdge[] } {
  const graph = rec(rec(doc.workflow).graph);
  return {
    nodes: (Array.isArray(graph.nodes) ? graph.nodes : []) as DifyNode[],
    edges: (Array.isArray(graph.edges) ? graph.edges : []) as DifyEdge[],
  };
}

export function withGraph(doc: DslDoc, nodes: DifyNode[], edges: DifyEdge[]): DslDoc {
  const workflow = rec(doc.workflow);
  return { ...doc, workflow: { ...workflow, graph: { ...rec(workflow.graph), nodes, edges } } };
}

/** 문서 안에서 겹치지 않는 새 노드 ID (Dify처럼 타임스탬프 문자열) */
export function newNodeId(nodes: DifyNode[]): string {
  let id = String(Date.now());
  while (nodes.some((n) => n.id === id)) id = String(Number(id) + 1);
  return id;
}

export function uniqueTitle(base: string, nodes: DifyNode[]) {
  const titles = new Set(nodes.map((n) => n.data.title));
  if (!titles.has(base)) return base;
  let i = 2;
  while (titles.has(`${base} ${i}`)) i++;
  return `${base} ${i}`;
}
