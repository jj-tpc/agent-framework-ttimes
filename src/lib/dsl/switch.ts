import type { ValueSelector } from "./types";

/**
 * 분기(switch) 노드 — 이 앱 전용 확장. 분기마다 출력 핸들이 하나씩 생기고, 어느 분기에도 맞지 않으면 'else' 핸들로 간다.
 *
 * 방식(mode) 세 가지
 *   text : 입력 텍스트에 특정 문구가 들어 있는지(포함·모두 포함·미포함·시작·일치·정규식). 위에서부터 처음 맞는 분기.
 *   code : main({ text, …}) 이 돌려준 분기 이름(또는 ID)으로 진행. JavaScript / Python.
 *   ai   : LLM(OpenAI · Gemini · Claude)이 분기 설명을 보고 하나를 고른다(구조화 출력).
 *
 * 세 방식이 같은 분기 목록(id·이름)을 공유하므로 방식을 바꿔도 연결된 선이 유지된다.
 * 출력 변수: branch(분기 이름), branch_id, reason(고른 이유)
 */

export const SWITCH = "switch";
export const SWITCH_ELSE = "else";

export type SwitchMode = "text" | "code" | "ai";
export type TextOperator = "contains_any" | "contains_all" | "not_contains" | "starts_with" | "equals" | "regex";

export interface SwitchBranch {
  id: string;
  name: string;
  /** text 방식: 비교 방법과 문구 목록 */
  operator?: TextOperator;
  keywords?: string[];
  /** ai 방식: 이 분기를 고를 조건 설명 */
  description?: string;
}

export const SWITCH_MODES: { value: SwitchMode; label: string; hint: string }[] = [
  { value: "text", label: "텍스트 포함", hint: "입력에 특정 문구가 있는지 위에서부터 검사해 처음 맞는 분기로" },
  { value: "code", label: "코드", hint: "main() 이 돌려준 분기 이름으로 (JavaScript · Python)" },
  { value: "ai", label: "AI 판단", hint: "LLM이 분기 설명을 읽고 하나를 고름 (OpenAI · Gemini · Claude)" },
];

export const TEXT_OPERATORS: { value: TextOperator; label: string; short: string }[] = [
  { value: "contains_any", label: "하나라도 포함", short: "포함" },
  { value: "contains_all", label: "모두 포함", short: "모두 포함" },
  { value: "not_contains", label: "하나도 포함 안 함", short: "없음" },
  { value: "starts_with", label: "~로 시작", short: "시작" },
  { value: "equals", label: "정확히 일치", short: "일치" },
  { value: "regex", label: "정규식과 일치", short: "정규식" },
];

export const operatorLabel = (op?: string) => TEXT_OPERATORS.find((o) => o.value === op) ?? TEXT_OPERATORS[0];

export const DEFAULT_SWITCH_CODE: Record<string, string> = {
  javascript: `function main({ text }) {
  // 갈 분기의 이름을 돌려주세요. null 이면 '그 외'로 갑니다.
  // { branch: "이름", reason: "근거" } 형태로 돌려주면 근거가 실행 기록에 남습니다.
  if (/환불|취소/.test(text)) return { branch: "분기 1", reason: "환불·취소 문구 발견" };
  if (text.trim().length > 100) return "분기 2";
  return null;
}`,
  python3: `def main(text: str):
    # 갈 분기의 이름을 돌려주세요. None 이면 '그 외'로 갑니다.
    # {"branch": "이름", "reason": "근거"} 형태로 돌려주면 근거가 실행 기록에 남습니다.
    if "환불" in text or "취소" in text:
        return {"branch": "분기 1", "reason": "환불·취소 문구 발견"}
    if len(text.strip()) > 100:
        return "분기 2"
    return None`,
};

/** DSL data 블록을 읽기 좋은 형태로 정리 */
export function readSwitch(data: Record<string, unknown>) {
  const mode = (["text", "code", "ai"].includes(String(data.mode)) ? data.mode : "text") as SwitchMode;
  const branches = ((Array.isArray(data.branches) ? data.branches : []) as SwitchBranch[]).map((b) => ({
    ...b,
    id: String(b.id),
    name: String(b.name ?? ""),
    keywords: (b.keywords ?? []).map(String),
  }));
  return {
    mode,
    input: (Array.isArray(data.input) ? data.input : ["sys", "query"]) as ValueSelector,
    branches,
    elseName: String(data.else_name || "그 외"),
    caseSensitive: !!data.case_sensitive,
    language: String(data.code_language ?? "javascript"),
    code: String(data.code ?? ""),
    variables: ((data.variables as { variable: string; value_selector: ValueSelector }[]) ?? []).filter((v) => v.variable),
    instruction: String(data.instruction ?? ""),
  };
}

export function switchHandles(data: Record<string, unknown>): string[] {
  return [...readSwitch(data).branches.map((b) => b.id), SWITCH_ELSE];
}

export function nextBranchId(branches: SwitchBranch[]): string {
  let n = branches.length + 1;
  while (branches.some((b) => b.id === `b${n}`)) n++;
  return `b${n}`;
}

/** 캔버스 카드에 쓰는 한 줄 요약 */
export function branchRuleSummary(b: SwitchBranch, mode: SwitchMode): string {
  if (mode === "ai") return b.description || "";
  if (mode === "code") return "";
  const kws = (b.keywords ?? []).filter(Boolean);
  if (!kws.length) return "(문구 없음)";
  const shown = b.operator === "regex" ? kws.map((k) => `/${k}/`) : kws.map((k) => `"${k}"`);
  return `${operatorLabel(b.operator).short} ${shown.join(", ")}`;
}

// ───────────────────────── text 방식 평가 ─────────────────────────

export interface KeywordHit {
  keyword: string;
  found: boolean;
  /** 원문에서 찾은 위치(없으면 -1)와 길이 — 화면에서 강조할 때 쓴다 */
  index: number;
  length: number;
  error?: string;
}
export interface BranchEvaluation {
  id: string;
  name: string;
  operator: TextOperator;
  hits: KeywordHit[];
  matched: boolean;
}

export function evaluateText(text: string, branches: SwitchBranch[], caseSensitive: boolean) {
  const norm = (s: string) => (caseSensitive ? s : s.toLocaleLowerCase());
  const t = norm(text);
  const evaluations: BranchEvaluation[] = branches.map((b) => {
    const operator = (b.operator ?? "contains_any") as TextOperator;
    const kws = (b.keywords ?? []).map(String).filter((k) => k.length > 0);
    const hits: KeywordHit[] = kws.map((k) => {
      if (operator === "regex") {
        try {
          const m = new RegExp(k, caseSensitive ? "u" : "iu").exec(text);
          return { keyword: k, found: !!m, index: m?.index ?? -1, length: m?.[0].length ?? 0 };
        } catch (e) {
          return { keyword: k, found: false, index: -1, length: 0, error: `정규식 오류: ${(e as Error).message}` };
        }
      }
      if (operator === "starts_with") {
        const found = t.trimStart().startsWith(norm(k));
        return { keyword: k, found, index: found ? text.length - text.trimStart().length : -1, length: k.length };
      }
      if (operator === "equals") {
        const found = t.trim() === norm(k).trim();
        return { keyword: k, found, index: found ? text.indexOf(text.trim()) : -1, length: text.trim().length };
      }
      const index = t.indexOf(norm(k));
      return { keyword: k, found: index >= 0, index, length: k.length };
    });
    const matched =
      hits.length > 0 &&
      (operator === "contains_all" ? hits.every((h) => h.found) : operator === "not_contains" ? hits.every((h) => !h.found && !h.error) : hits.some((h) => h.found));
    return { id: b.id, name: b.name, operator, hits, matched };
  });
  const selected = evaluations.find((e) => e.matched) ?? null;
  return { evaluations, selected };
}

/** text 방식에서 고른 이유를 한 문장으로 */
export function textReason(e: BranchEvaluation | null): string {
  if (!e) return "어느 분기 조건에도 맞지 않음";
  const found = e.hits.filter((h) => h.found).map((h) => (e.operator === "regex" ? `/${h.keyword}/` : `"${h.keyword}"`));
  const all = e.hits.map((h) => `"${h.keyword}"`);
  switch (e.operator) {
    case "contains_all":
      return `${all.join(", ")} 모두 포함`;
    case "not_contains":
      return `${all.join(", ")} 중 어느 것도 없음`;
    case "starts_with":
      return `${found[0]}(으)로 시작`;
    case "equals":
      return `${found[0]}와(과) 일치`;
    case "regex":
      return `정규식 ${found[0]} 일치`;
    default:
      return `${found.join(", ")} 포함`;
  }
}

// ───────────────────────── code 방식 반환값 해석 ─────────────────────────

/**
 * main() 반환값 → 분기.
 *   "이름" 또는 "ID"         → 그 분기
 *   { branch, reason }       → branch 로 판단, reason 기록
 *   true                     → 첫 번째 분기
 *   null / false / "" / 없음 → 그 외
 * 이름이 어느 분기와도 맞지 않으면 오류(오타를 조용히 '그 외'로 보내지 않기 위해).
 */
export function interpretCodeResult(ret: unknown, branches: SwitchBranch[]): { id: string | null; reason: string; value: unknown } {
  let value = ret;
  let reason = "";
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const o = value as Record<string, unknown>;
    reason = o.reason != null ? String(o.reason) : "";
    value = o.branch ?? o.name ?? o.id ?? null;
  }
  if (value === true) return { id: branches[0]?.id ?? null, reason: reason || "코드가 true 반환 → 첫 번째 분기", value };
  if (value === null || value === undefined || value === false || value === "") {
    return { id: null, reason: reason || "코드가 분기를 고르지 않음", value };
  }
  const s = String(value).trim();
  const hit =
    branches.find((b) => b.name === s) ?? branches.find((b) => b.id === s) ?? branches.find((b) => b.name.trim().toLowerCase() === s.toLowerCase());
  if (!hit) {
    throw new Error(`코드가 돌려준 "${s}" 와 같은 이름의 분기가 없습니다. 분기 이름: ${branches.map((b) => `"${b.name}"`).join(", ")}`);
  }
  return { id: hit.id, reason: reason || `코드가 "${s}" 반환`, value };
}
