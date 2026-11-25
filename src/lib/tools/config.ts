/**
 * LLM 노드의 도구 호출 설정(이 앱 전용 확장). 서버(실행)와 클라이언트(설정 폼)가 함께 쓴다.
 *
 * LLM 노드의 `data.tools` 에 저장한다. 도구가 하나라도 있으면 LLM 노드는 한 번 호출로 끝나지 않고
 * "모델 호출 → 도구 실행 → 결과를 돌려주고 다시 호출"을 모델이 도구를 그만 부를 때까지 되풀이한다.
 *
 * 도구가 오는 곳은 여섯 가지다.
 *   내장 도구 · 직접 만든 도구(코드) · 스킬 · 외부 MCP 서버 · 커넥터(Google) · 붙어 있는 메모리 모듈의 메모리 도구
 */

export interface ToolDef {
  name: string;
  description: string;
  /** JSON Schema (type: object) */
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
}

export interface ToolOutput {
  output: string;
  isError?: boolean;
}

/** 실행 기록에 남는 도구 호출 1건 */
export interface ToolCallRecord extends ToolCall {
  output: string;
  isError: boolean;
  elapsedMs: number;
  /** 도구가 온 곳: builtin | custom | skill | mcp:<서버> | connector:google | memory:<모듈> */
  source?: string;
}

export interface CustomTool {
  name: string;
  description: string;
  /** JSON Schema 문자열 또는 객체 */
  parameters: string | Record<string, unknown>;
  /** function main(args) { … } — 코드 노드와 같은 JavaScript 실행기 */
  code: string;
}

export interface McpRef {
  server: string;
  /** 비어 있으면 서버의 도구 전부 */
  tools?: string[];
}

export interface ToolsConfig {
  enabled: boolean;
  /** 도구를 부르고 다시 호출하는 왕복의 최대 횟수 */
  max_steps: number;
  builtin: string[];
  custom: CustomTool[];
  skills: string[];
  mcp: McpRef[];
  /** 커넥터 도구 이름 (gmail_search, calendar_list …). 목록은 connector-catalog.ts */
  connectors: string[];
  /** 공급자가 서버에서 실행하는 도구 (web_search) */
  provider: string[];
  /** 쌓인 도구 결과가 이 글자 수를 넘으면 오래된 결과부터 비운다. 0 이면 비우지 않는다 */
  compact_after: number;
}

export const DEFAULT_MAX_STEPS = 8;
export const DEFAULT_COMPACT_AFTER = 60_000;
/** 비우지 않고 남겨 두는 최근 도구 왕복 수 */
export const COMPACT_KEEP_ROUNDS = 2;

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.map(String).filter(Boolean) : []);

export function readTools(data: Record<string, unknown>): ToolsConfig {
  const t = (data.tools && typeof data.tools === "object" ? data.tools : {}) as Record<string, unknown>;
  return {
    enabled: !!t.enabled,
    max_steps: Math.min(30, Math.max(1, Number(t.max_steps) || DEFAULT_MAX_STEPS)),
    builtin: strings(t.builtin),
    custom: (Array.isArray(t.custom) ? t.custom : [])
      .filter((c): c is Record<string, unknown> => !!c && typeof c === "object")
      .map((c) => ({
        name: String(c.name ?? ""),
        description: String(c.description ?? ""),
        parameters: (c.parameters as CustomTool["parameters"]) ?? "",
        code: String(c.code ?? ""),
      })),
    skills: strings(t.skills),
    mcp: (Array.isArray(t.mcp) ? t.mcp : [])
      .filter((m): m is Record<string, unknown> => !!m && typeof m === "object" && !!m.server)
      .map((m) => ({ server: String(m.server), tools: strings(m.tools) })),
    connectors: strings(t.connectors),
    provider: strings(t.provider).filter((p) => PROVIDER_TOOLS.some((x) => x.name === p)),
    compact_after: t.compact_after == null ? DEFAULT_COMPACT_AFTER : Math.max(0, Number(t.compact_after) || 0),
  };
}

export const hasAnyTool = (c: ToolsConfig) => c.enabled && c.builtin.length + c.custom.length + c.skills.length + c.mcp.length + c.connectors.length + c.provider.length > 0;

/** 공급자 3사가 모두 받는 도구 이름: 영문·숫자·_·- , 64자 이내 */
export function safeToolName(name: string): string {
  const v = name.replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60);
  return /^[a-zA-Z_]/.test(v) ? v : `t_${v}`;
}

export const mcpToolName = (server: string, tool: string) => safeToolName(`mcp__${server}__${tool}`);

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required });

/** 내장 도구 목록(설명과 입력 스키마). 실행은 서버의 tools/builtin.ts */
export const BUILTIN_TOOLS: (ToolDef & { label: string })[] = [
  {
    name: "current_time",
    label: "현재 시각",
    description: "지금 날짜와 시각을 돌려준다. 오늘 날짜, 요일, 기간 계산이 필요할 때 쓴다.",
    parameters: obj({ timezone: { type: "string", description: "IANA 시간대 (예: Asia/Seoul). 생략하면 Asia/Seoul" } }),
  },
  {
    name: "calculator",
    label: "계산기",
    description: "수식을 정확히 계산한다. 사칙연산, 괄호, 거듭제곱(^), sqrt·round·min·max·log 같은 수학 함수를 쓸 수 있다. 암산하지 말고 이 도구를 쓴다.",
    parameters: obj({ expression: { type: "string", description: "계산할 식 (예: (1200 * 3 + 450) * 1.1)" } }, ["expression"]),
  },
  {
    name: "web_fetch",
    label: "웹 페이지 가져오기",
    description: "공개 웹 주소(http/https)의 내용을 글로 가져온다. 사용자가 준 링크나 문서 페이지를 읽을 때 쓴다. 검색 엔진이 아니다.",
    parameters: obj(
      { url: { type: "string", description: "가져올 주소" }, max_chars: { type: "integer", description: "가져올 최대 글자 수 (기본 8000)" } },
      ["url"],
    ),
  },
  {
    name: "knowledge_search",
    label: "지식 검색",
    description: "이 앱에 등록된 지식베이스에서 질문과 관련된 문단을 찾는다. 회사 정책·제품 정보처럼 등록된 자료에 답이 있을 만한 질문에 쓴다.",
    parameters: obj(
      {
        query: { type: "string", description: "찾을 내용" },
        dataset_id: { type: "string", description: "지식베이스 ID. 생략하면 전체에서 찾는다" },
        top_k: { type: "integer", description: "가져올 문단 수 (기본 4)" },
      },
      ["query"],
    ),
  },
  {
    name: "conversation_search",
    label: "지난 대화 검색",
    description:
      "지난 대화 기록에서 질문과 관련된 턴을 찾아 원문으로 돌려준다. 사용자가 예전에 한 말, 전에 내린 결정, 메모리에 저장해 두지 않은 세부를 확인할 때 쓴다. 이 도구를 켠 뒤의 대화만 쌓인다.",
    parameters: obj({ query: { type: "string", description: "찾을 내용" }, top_k: { type: "integer", description: "가져올 턴 수 (기본 5)" } }, ["query"]),
  },
];

/** 공급자가 자기 서버에서 실행하는 도구. 이 앱은 켜기만 하고, 실행과 결과 주입은 공급자가 한다 */
export const PROVIDER_TOOLS: { name: string; label: string; description: string }[] = [
  {
    name: "web_search",
    label: "웹 검색",
    description: "모델이 웹을 검색해 최신 정보를 찾는다. 공급자(Anthropic · OpenAI · Google)가 서버에서 실행하며 검색 요금이 따로 붙는다.",
  },
];

export const MEMORY_TOOL = "memory-tool";
export const MEMORY_COMMANDS = ["view", "create", "str_replace", "insert", "delete", "rename"] as const;
export const MEMORY_COMMAND_LABEL: Record<string, string> = {
  view: "보기 (폴더·파일)",
  create: "파일 만들기·덮어쓰기",
  str_replace: "글 일부 바꾸기",
  insert: "줄 끼워 넣기",
  delete: "지우기",
  rename: "이름 바꾸기·옮기기",
};
export const readMemoryCommands = (data: Record<string, unknown>): string[] => {
  const picked = strings(data.commands).filter((c) => (MEMORY_COMMANDS as readonly string[]).includes(c));
  return data.commands == null ? [...MEMORY_COMMANDS] : picked;
};

/** 도구 결과가 너무 길면 컨텍스트를 지키기 위해 자른다 */
export const MAX_TOOL_OUTPUT = 30_000;
export function clip(text: string, max = MAX_TOOL_OUTPUT): string {
  return text.length > max ? `${text.slice(0, max)}\n…(뒤 ${text.length - max}자 생략)` : text;
}

/** 어떤 스키마가 와도 공급자가 받는 object 스키마로 맞춘다 */
export function objectSchema(raw: unknown): Record<string, unknown> {
  let s: unknown = raw;
  if (typeof s === "string") {
    try {
      s = s.trim() ? JSON.parse(s) : {};
    } catch {
      throw new Error("입력 스키마가 올바른 JSON 이 아닙니다.");
    }
  }
  const o = (s && typeof s === "object" && !Array.isArray(s) ? { ...(s as Record<string, unknown>) } : {}) as Record<string, unknown>;
  delete o.$schema;
  if (o.type !== "object") o.type = "object";
  if (!o.properties || typeof o.properties !== "object") o.properties = {};
  return o;
}
