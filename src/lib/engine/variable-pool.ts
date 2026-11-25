import type { ValueSelector } from "../dsl/types";

/** Dify 변수 참조 문법: {{#노드ID.변수.하위키#}} — sys/env/conversation 도 같은 방식으로 참조한다. */
export const VAR_REF_PATTERN = /\{\{#([^#{}]+?)#\}\}/g;

export class VariablePool {
  private store = new Map<string, Record<string, unknown>>();

  setNode(nodeId: string, values: Record<string, unknown>) {
    this.store.set(nodeId, { ...(this.store.get(nodeId) ?? {}), ...values });
  }

  setVar(nodeId: string, key: string, value: unknown) {
    this.setNode(nodeId, { [key]: value });
  }

  get(selector: ValueSelector | undefined | null): unknown {
    if (!selector || selector.length < 2) return undefined;
    const [nodeId, key, ...rest] = selector.map(String);
    let value: unknown = this.store.get(nodeId)?.[key];
    for (const part of rest) {
      if (value == null) return undefined;
      if (Array.isArray(value) && /^\d+$/.test(part)) value = value[Number(part)];
      else if (typeof value === "object") value = (value as Record<string, unknown>)[part];
      else return undefined;
    }
    return value;
  }

  snapshot(): Record<string, Record<string, unknown>> {
    return Object.fromEntries(this.store.entries());
  }
}

export function selectorKey(selector: ValueSelector | undefined | null): string {
  return (selector ?? []).map(String).join(".");
}

export function stringifyValue(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value, null, 2);
}

export interface RenderResult {
  text: string;
  /** 템플릿에서 치환된 참조 — "노드ID.변수" → 값 */
  refs: Record<string, unknown>;
}

/**
 * {{#...#}} 참조를 변수 풀의 값으로 치환한다.
 * extra 는 LLM 노드의 {{#context#}} 처럼 풀 밖의 특수 변수를 넘길 때 쓴다.
 */
export function renderTemplate(
  template: string,
  pool: VariablePool,
  extra: Record<string, unknown> = {},
): RenderResult {
  const refs: Record<string, unknown> = {};
  const text = String(template ?? "").replace(VAR_REF_PATTERN, (_m, path: string) => {
    const key = path.trim();
    const value = key in extra ? extra[key] : pool.get(key.split("."));
    refs[key] = value ?? null;
    return stringifyValue(value);
  });
  return { text, refs };
}

/** 템플릿이 참조하는 변수 경로 목록(중복 제거). */
export function extractRefs(template: string): string[] {
  const found = new Set<string>();
  for (const m of String(template ?? "").matchAll(VAR_REF_PATTERN)) found.add(m[1].trim());
  return [...found];
}
