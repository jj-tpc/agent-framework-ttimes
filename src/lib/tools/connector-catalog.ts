import type { ToolDef } from "./config";

/**
 * 커넥터 도구 목록(이름 · 설명 · 입력 스키마). 서버(실행)와 클라이언트(설정 폼)가 함께 쓴다.
 * 실행은 서버의 tools/connectors/google.ts.
 *
 * 커넥터는 외부 서비스에 사용자 계정으로 로그인해 두고, 모델이 그 서비스의 기능을 도구로 부르게 하는 것이다.
 * 한 번의 LLM 실행에서 여러 도구를 이어 부를 수 있어(일정 조회 → 시트에 기록 → 문서 작성 → 메일 초안) 다단계 작업이 된다.
 */

export type ConnectorService = "gmail" | "calendar" | "drive" | "sheets" | "docs";

export interface ConnectorTool extends ToolDef {
  label: string;
  service: ConnectorService;
  /** 외부 서비스의 내용을 바꾼다 */
  writes?: boolean;
  /** 다른 사람에게 닿는다(메일 발송, 초대). 켤 때 한 번 더 생각할 것 */
  outward?: boolean;
}

export const CONNECTOR_SERVICES: { id: ConnectorService; label: string }[] = [
  { id: "gmail", label: "Gmail" },
  { id: "calendar", label: "캘린더" },
  { id: "drive", label: "드라이브 (파일 찾기)" },
  { id: "sheets", label: "스프레드시트" },
  { id: "docs", label: "문서" },
];

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required });
const str = (description: string) => ({ type: "string", description });
const int = (description: string) => ({ type: "integer", description });

export const GOOGLE_TOOLS: ConnectorTool[] = [
  {
    name: "gmail_search",
    label: "메일 검색",
    service: "gmail",
    description: "Gmail 에서 메일을 찾는다. Gmail 검색 문법을 쓴다(from:, subject:, newer_than:7d, is:unread, has:attachment). 보낸 사람·제목·날짜·앞부분만 돌려준다. 본문 전체는 gmail_read 로 읽는다.",
    parameters: obj({ query: str("Gmail 검색어 (예: from:kim@example.com newer_than:7d)"), max_results: int("가져올 메일 수 (기본 8, 최대 20)") }, ["query"]),
  },
  {
    name: "gmail_read",
    label: "메일 읽기",
    service: "gmail",
    description: "메일 한 통의 본문을 읽는다. id 는 gmail_search 결과에서 얻는다.",
    parameters: obj({ id: str("메일 ID") }, ["id"]),
  },
  {
    name: "gmail_create_draft",
    label: "메일 초안 만들기",
    service: "gmail",
    writes: true,
    description: "메일 초안을 만든다. 보내지 않고 초안함에 넣는다. 사용자가 확인하고 직접 보낸다.",
    parameters: obj({ to: str("받는 사람 주소. 여럿이면 쉼표로 구분"), subject: str("제목"), body: str("본문 (일반 글)") }, ["to", "subject", "body"]),
  },
  {
    name: "gmail_send",
    label: "메일 보내기",
    service: "gmail",
    writes: true,
    outward: true,
    description: "메일을 바로 보낸다. 되돌릴 수 없다. 사용자가 보내라고 분명히 말했을 때만 쓴다. 그렇지 않으면 gmail_create_draft 를 쓴다.",
    parameters: obj({ to: str("받는 사람 주소. 여럿이면 쉼표로 구분"), subject: str("제목"), body: str("본문 (일반 글)") }, ["to", "subject", "body"]),
  },
  {
    name: "calendar_list",
    label: "일정 조회",
    service: "calendar",
    description: "기본 캘린더에서 기간 안의 일정을 시간순으로 가져온다. 시각은 ISO 8601 (예: 2026-11-20T00:00:00+09:00). 오늘 날짜가 필요하면 current_time 을 먼저 쓴다.",
    parameters: obj({ time_min: str("시작 시각 (ISO 8601)"), time_max: str("끝 시각 (ISO 8601)"), query: str("제목·설명에서 찾을 말 (선택)"), max_results: int("가져올 일정 수 (기본 20, 최대 50)") }, ["time_min", "time_max"]),
  },
  {
    name: "calendar_create",
    label: "일정 만들기",
    service: "calendar",
    writes: true,
    description: "기본 캘린더에 일정을 만든다. 참석자에게 초대 메일은 보내지 않는다.",
    parameters: obj(
      { summary: str("일정 제목"), start: str("시작 시각 (ISO 8601, 시간대 포함)"), end: str("끝 시각 (ISO 8601, 시간대 포함)"), description: str("설명 (선택)"), location: str("장소 (선택)") },
      ["summary", "start", "end"],
    ),
  },
  {
    name: "drive_search",
    label: "파일 찾기",
    service: "drive",
    description: "드라이브에서 이름으로 스프레드시트나 문서를 찾아 ID 를 얻는다. 시트·문서 도구는 ID 가 필요하다.",
    parameters: obj({ name: str("파일 이름에 들어 있는 말"), type: { type: "string", enum: ["any", "sheet", "doc"], description: "찾을 종류 (기본 any)" } }, ["name"]),
  },
  {
    name: "sheets_read",
    label: "시트 읽기",
    service: "sheets",
    description: "스프레드시트의 범위를 읽는다. 범위는 A1 표기 (예: Sheet1!A1:D20, 시트 이름만 쓰면 전체).",
    parameters: obj({ spreadsheet_id: str("스프레드시트 ID"), range: str("읽을 범위 (A1 표기)") }, ["spreadsheet_id", "range"]),
  },
  {
    name: "sheets_append",
    label: "시트에 행 추가",
    service: "sheets",
    writes: true,
    description: "스프레드시트의 표 끝에 행을 덧붙인다. 기존 내용은 건드리지 않는다.",
    parameters: obj(
      { spreadsheet_id: str("스프레드시트 ID"), range: str("표가 있는 범위 (예: Sheet1!A1)"), rows: { type: "array", description: "덧붙일 행들. 행마다 셀 값 배열", items: { type: "array", items: { type: "string" } } } },
      ["spreadsheet_id", "range", "rows"],
    ),
  },
  {
    name: "sheets_create",
    label: "시트 새로 만들기",
    service: "sheets",
    writes: true,
    description: "새 스프레드시트를 만들고, 행을 주면 첫 시트에 채운다. 만든 파일의 ID 와 주소를 돌려준다.",
    parameters: obj({ title: str("파일 제목"), rows: { type: "array", description: "채울 행들 (선택). 첫 행은 머리글", items: { type: "array", items: { type: "string" } } } }, ["title"]),
  },
  {
    name: "docs_read",
    label: "문서 읽기",
    service: "docs",
    description: "Google 문서의 글을 읽는다.",
    parameters: obj({ document_id: str("문서 ID") }, ["document_id"]),
  },
  {
    name: "docs_create",
    label: "문서 새로 만들기",
    service: "docs",
    writes: true,
    description: "새 Google 문서를 만들고 내용을 넣는다. 만든 파일의 ID 와 주소를 돌려준다.",
    parameters: obj({ title: str("문서 제목"), content: str("넣을 글 (일반 글. 줄바꿈으로 문단 구분)") }, ["title", "content"]),
  },
  {
    name: "docs_append",
    label: "문서에 덧붙이기",
    service: "docs",
    writes: true,
    description: "Google 문서 끝에 글을 덧붙인다. 기존 내용은 건드리지 않는다.",
    parameters: obj({ document_id: str("문서 ID"), text: str("덧붙일 글") }, ["document_id", "text"]),
  },
];

export const connectorTool = (name: string) => GOOGLE_TOOLS.find((t) => t.name === name);

/** '연결' 버튼이 하나씩 붙는 단위. 드라이브(파일 찾기)는 시트나 문서를 연결하면 함께 열린다 */
export type ConnectableService = "gmail" | "calendar" | "sheets" | "docs";
export const CONNECTABLE: { id: ConnectableService; label: string; desc: string }[] = [
  { id: "gmail", label: "Gmail", desc: "메일 검색 · 읽기 · 초안 · 발송" },
  { id: "calendar", label: "Google 캘린더", desc: "일정 조회 · 만들기" },
  { id: "sheets", label: "Google 스프레드시트", desc: "읽기 · 행 추가 · 새로 만들기" },
  { id: "docs", label: "Google 문서", desc: "읽기 · 새로 만들기 · 덧붙이기" },
];

/** 도구의 서비스가 연결돼 있는지. 드라이브는 시트나 문서 중 하나가 연결돼 있으면 된다 */
export function serviceConnected(services: Partial<Record<ConnectableService, boolean>>, service: ConnectorService): boolean {
  return service === "drive" ? !!(services.sheets || services.docs) : !!services[service];
}

/** 커넥터 상태(화면용). 비밀값은 담지 않는다 */
export interface ConnectorStatus {
  /** OAuth 클라이언트 ID·비밀이 저장돼 있는지 */
  configured: boolean;
  clientIdHint: string;
  /** 하나라도 연결돼 있으면 true */
  connected: boolean;
  /** 서비스별 연결 여부 */
  services: Partial<Record<ConnectableService, boolean>>;
  email: string;
  /** 연결 없이 예시 데이터를 돌려주는 시연 모드 */
  demo: boolean;
}
