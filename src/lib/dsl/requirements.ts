import { rec, type Rec } from "./graph";
import type { DifyNode } from "./types";

/**
 * 노드가 입력으로 요구하는 구조화 출력.
 * 설정 어딘가에서 `{{#노드.structured_output.필드#}}` 나 [노드, "structured_output", 필드] 를 쓰면
 * 그 노드는 앞 LLM 의 구조화 출력이 켜져 있고 그 필드가 스키마에 있어야 제대로 돈다.
 * 실행 전에 캔버스와 설정 패널에서 알려 주려고 문서만 보고 판정한다.
 */
export interface StructuredNeed {
  sourceId: string;
  sourceTitle: string;
  /** 스키마 최상위 속성. 없으면 structured_output 전체를 쓴다 */
  field?: string;
  ok: boolean;
  /** ok 가 아닐 때의 이유 */
  reason?: string;
}

const TEMPLATE_REF = /\{\{#([^#{}]+)#\}\}/g;

/** data 안의 모든 [노드, "structured_output", …] 참조를 모은다 */
function collect(value: unknown, out: string[][], key?: string) {
  if (typeof value === "string") {
    for (const m of value.matchAll(TEMPLATE_REF)) {
      const path = m[1].split(".");
      if (path[1] === "structured_output") out.push(path);
    }
    return;
  }
  if (Array.isArray(value)) {
    if (value.length >= 2 && value[1] === "structured_output" && value.every((v) => typeof v === "string")) {
      out.push(value as string[]);
      return;
    }
    for (const v of value) collect(v, out);
    return;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      // 이 노드 자신의 스키마 정의는 참조가 아니다
      if (key === undefined && (k === "structured_output" || k === "structured_output_enabled")) continue;
      collect(v, out, k);
    }
  }
}

export function structuredNeedsOf(node: DifyNode, nodesById: Map<string, DifyNode>): StructuredNeed[] {
  const refs: string[][] = [];
  collect(node.data, refs);
  const seen = new Set<string>();
  const needs: StructuredNeed[] = [];
  for (const [sourceId, , field] of refs) {
    const id = `${sourceId}.${field ?? ""}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const source = nodesById.get(sourceId);
    const sourceTitle = String(source?.data.title || sourceId);
    if (!source) {
      needs.push({ sourceId, sourceTitle, field, ok: false, reason: `‘${sourceId}’ 노드가 없습니다` });
      continue;
    }
    const d = source.data as Rec;
    if (source.data.type !== "llm") {
      needs.push({ sourceId, sourceTitle, field, ok: false, reason: `‘${sourceTitle}’은(는) LLM 노드가 아니라 구조화 출력이 없습니다` });
      continue;
    }
    const schema = rec(d.structured_output).schema;
    if (!d.structured_output_enabled || !schema || typeof schema !== "object") {
      needs.push({ sourceId, sourceTitle, field, ok: false, reason: `‘${sourceTitle}’의 구조화 출력이 꺼져 있습니다` });
      continue;
    }
    if (field && !(field in rec(rec(schema).properties))) {
      needs.push({ sourceId, sourceTitle, field, ok: false, reason: `‘${sourceTitle}’의 스키마에 ‘${field}’ 속성이 없습니다` });
      continue;
    }
    needs.push({ sourceId, sourceTitle, field, ok: true });
  }
  return needs;
}

/** 이 LLM 의 구조화 출력을 쓰는 노드들 */
export function structuredDependents(sourceId: string, nodes: DifyNode[]): { id: string; title: string; fields: string[] }[] {
  const out: { id: string; title: string; fields: string[] }[] = [];
  for (const n of nodes) {
    if (n.id === sourceId) continue;
    const refs: string[][] = [];
    collect(n.data, refs);
    const mine = refs.filter((r) => r[0] === sourceId);
    if (mine.length) out.push({ id: n.id, title: String(n.data.title || n.id), fields: [...new Set(mine.map((r) => r[2]).filter(Boolean))] });
  }
  return out;
}

export const needLabel = (n: StructuredNeed) => `${n.sourceTitle}${n.field ? `.${n.field}` : ""}`;
