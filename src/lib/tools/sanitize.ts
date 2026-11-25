/**
 * 모델에 넣기 전에 글을 정화한다. 메모리에 저장된 글과 외부(웹·MCP)에서 온 글은 지시가 아니라 자료다.
 * - 보이지 않는 문자(폭 0 문자, 방향 전환 문자, 태그 문자, 제어 문자)를 지운다. 사람 눈에 안 보이는 지시를 숨기는 데 쓰인다.
 * - 대화 구조를 흉내 내는 표시(<system>, <|im_start|>, [INST] …)는 모양만 남기고 꺾쇠를 바꿔 힘을 뺀다.
 */

const INVISIBLE = /[​-‏‪-‮⁠-⁤⁦-⁯﻿­]|[\u{E0000}-\u{E007F}]|[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu;
const MARKUP = /<\/?\s*(?:system|assistant|user|human|developer|tool|tool_result|function_results?|instructions?|system-reminder|memory)\b[^>]*>|<\|[^|>\n]{1,40}\|>|\[\/?(?:INST|SYSTEM|SYS)\]/gi;

export interface Sanitized {
  text: string;
  /** 지운 보이지 않는 문자 수 */
  invisible: number;
  /** 힘을 뺀 위조 표시 수 */
  markup: number;
}

export function sanitize(raw: string): Sanitized {
  let invisible = 0;
  let markup = 0;
  const text = String(raw ?? "")
    .replace(INVISIBLE, () => (invisible++, ""))
    .replace(MARKUP, (m) => (markup++, m.replace(/</g, "‹").replace(/>/g, "›").replace(/\[/g, "⟦").replace(/\]/g, "⟧")));
  return { text, invisible, markup };
}

export const sanitizeText = (raw: string) => sanitize(raw).text;
