import { createHash, randomBytes } from "node:crypto";
import { files } from "../../store/backend";
import { clip, type ToolOutput } from "../config";
import { CONNECTABLE, connectorTool, serviceConnected, type ConnectableService, type ConnectorStatus } from "../connector-catalog";

/**
 * Google 커넥터: Gmail · 캘린더 · 드라이브(찾기) · 스프레드시트 · 문서.
 *
 * - 로그인은 OAuth 2.0 인증 코드 방식(PKCE). 사용자가 Google Cloud 콘솔에서 만든 OAuth 클라이언트를 쓴다.
 * - 클라이언트 비밀과 토큰은 data/connectors.json 에만 둔다(.gitignore). 모델과 브라우저에는 보내지 않는다.
 * - 도구는 Google REST API 를 직접 부른다. 액세스 토큰이 만료되면 리프레시 토큰으로 갱신한다.
 */

const FILE = "connectors.json";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";

/**
 * 서비스마다 필요한 권한. '연결'을 누른 서비스의 권한만 요청하고, 이미 받은 권한은 그대로 둔다(점진적 동의).
 * 시트·문서는 이름으로 파일을 찾을 수 있게 드라이브 목록 읽기 권한을 함께 받는다.
 */
const G = "https://www.googleapis.com/auth/";
export const SERVICE_SCOPES: Record<ConnectableService, string[]> = {
  gmail: [`${G}gmail.readonly`, `${G}gmail.compose`],
  calendar: [`${G}calendar.events`],
  sheets: [`${G}spreadsheets`, `${G}drive.metadata.readonly`],
  docs: [`${G}documents`, `${G}drive.metadata.readonly`],
};
const BASE_SCOPES = ["openid", "email"];

interface GoogleState {
  clientId?: string;
  clientSecret?: string;
  demo?: boolean;
  email?: string;
  accessToken?: string;
  refreshToken?: string;
  /** 액세스 토큰 만료 시각(ms) */
  expiresAt?: number;
  /** Google 이 실제로 허용해 준 권한 */
  scopes?: string[];
  /** 사용자가 연결해 둔 서비스 */
  services?: ConnectableService[];
  /** 지금 로그인 창에서 연결하려는 서비스 */
  pendingService?: ConnectableService;
  /** 로그인 창을 연 요청과 돌아온 요청을 잇는 값 */
  state?: string;
  verifier?: string;
  redirectUri?: string;
}
interface ConnectorsFile {
  google?: GoogleState;
}

/** 사용자마다 한 줄씩 세운다(읽고 고쳐 쓰는 동안 끼어들지 않게) */
const queues = new Map<string, Promise<unknown>>();
const locked = <T>(fn: () => Promise<T>): Promise<T> => {
  const store = files();
  // 줄을 서 있다가 실행될 때도 같은 사용자의 저장소를 쓰도록 붙잡아 둔다
  const run = () => fn();
  const next = (queues.get(store.id) ?? Promise.resolve()).then(run, run);
  queues.set(
    store.id,
    next.catch(() => {}),
  );
  return next;
};
async function readAll(): Promise<ConnectorsFile> {
  return ((await files().read(FILE)) as ConnectorsFile | null) ?? {};
}
/** OAuth 앱은 화면에서 저장하거나 환경 변수(GOOGLE_OAUTH_CLIENT_ID / _SECRET)로 준다 */
const load = async (): Promise<GoogleState> => {
  const g = (await locked(readAll)).google ?? {};
  return { ...g, clientId: g.clientId ?? process.env.GOOGLE_OAUTH_CLIENT_ID, clientSecret: g.clientSecret ?? process.env.GOOGLE_OAUTH_CLIENT_SECRET };
};
const has = (g: GoogleState, service: ConnectableService) => !!g.refreshToken && (g.services ?? []).includes(service) && SERVICE_SCOPES[service].every((sc) => (g.scopes ?? []).includes(sc));
const servicesOf = (g: GoogleState) => Object.fromEntries(CONNECTABLE.map((c) => [c.id, has(g, c.id)])) as Record<ConnectableService, boolean>;
const update = (fn: (g: GoogleState) => void) =>
  locked(async () => {
    const all = await readAll();
    const g = all.google ?? {};
    fn(g);
    all.google = g;
    await files().write(FILE, all);
  });

// ───────────────────────── 설정 · 로그인 ─────────────────────────

export async function googleStatus(): Promise<ConnectorStatus> {
  const g = await load();
  return {
    configured: !!(g.clientId && g.clientSecret),
    clientIdHint: g.clientId ? `${g.clientId.slice(0, 12)}…` : "",
    connected: Object.values(servicesOf(g)).some(Boolean),
    services: servicesOf(g),
    email: g.email ?? "",
    demo: !!g.demo,
  };
}

export async function saveGoogleClient(clientId: string, clientSecret: string) {
  const id = clientId.trim();
  const secret = clientSecret.trim();
  if (!/\.apps\.googleusercontent\.com$/.test(id)) throw new Error("클라이언트 ID 는 ‘….apps.googleusercontent.com’ 으로 끝납니다.");
  if (!secret) throw new Error("클라이언트 보안 비밀번호를 넣어 주세요.");
  await update((g) => {
    // 클라이언트가 바뀌면 이전 토큰은 쓸 수 없다
    if (g.clientId !== id) {
      delete g.accessToken;
      delete g.refreshToken;
      delete g.expiresAt;
      delete g.email;
      delete g.scopes;
      delete g.services;
    }
    g.clientId = id;
    g.clientSecret = secret;
  });
}

export const setGoogleDemo = (on: boolean) => update((g) => void (g.demo = on));

const b64url = (b: Buffer) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** 로그인 주소를 만든다. 사용자가 이 주소를 새 창에서 열어 직접 로그인하고 동의한다 */
export async function startGoogleLogin(redirectUri: string, service: ConnectableService): Promise<string> {
  const g = await load();
  if (!SERVICE_SCOPES[service]) throw new Error("모르는 서비스입니다.");
  if (!g.clientId || !g.clientSecret) throw new Error("OAUTH_APP_REQUIRED");
  const state = randomBytes(16).toString("hex");
  const verifier = b64url(randomBytes(32));
  await update((x) => {
    x.state = state;
    x.verifier = verifier;
    x.redirectUri = redirectUri;
    x.pendingService = service;
  });
  const q = new URLSearchParams({
    client_id: g.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: [...BASE_SCOPES, ...SERVICE_SCOPES[service]].join(" "),
    // 앞서 연결한 서비스의 권한을 그대로 둔 채 이번 서비스만 더한다
    include_granted_scopes: "true",
    state,
    code_challenge: b64url(createHash("sha256").update(verifier).digest()),
    code_challenge_method: "S256",
    // 리프레시 토큰을 받으려면 offline + consent 가 필요하다
    access_type: "offline",
    prompt: "consent",
  });
  return `${AUTH_URL}?${q}`;
}

async function tokenRequest(body: Record<string, string>): Promise<Record<string, unknown>> {
  const res = await fetch(TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body) });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(`Google 토큰 요청 실패: ${String(json.error_description ?? json.error ?? res.status)}`);
  return json;
}

/** 로그인 창이 돌아왔을 때: 코드를 토큰으로 바꿔 저장한다 */
export async function finishGoogleLogin(code: string, state: string): Promise<{ email: string; service: string }> {
  const g = await load();
  if (!state || state !== g.state || !g.verifier || !g.redirectUri) throw new Error("로그인을 처음부터 다시 시작하세요(요청이 맞지 않습니다).");
  if (!code) throw new Error("인증 코드가 없습니다.");
  const t = await tokenRequest({ grant_type: "authorization_code", code, client_id: g.clientId!, client_secret: g.clientSecret!, redirect_uri: g.redirectUri, code_verifier: g.verifier });
  const access = String(t.access_token ?? "");
  let email = "";
  try {
    const me = (await (await fetch("https://www.googleapis.com/oauth2/v2/userinfo", { headers: { Authorization: `Bearer ${access}` } })).json()) as { email?: string };
    email = me.email ?? "";
  } catch {
    /* 주소를 못 읽어도 연결은 된다 */
  }
  const service = g.pendingService;
  const granted = String(t.scope ?? "").split(/\s+/).filter(Boolean);
  // 동의 창에서 체크를 빼면 권한이 빠진 채 돌아온다
  const complete = !!service && SERVICE_SCOPES[service].every((sc) => granted.includes(sc));
  await update((x) => {
    x.accessToken = access;
    if (t.refresh_token) x.refreshToken = String(t.refresh_token);
    x.expiresAt = Date.now() + (Number(t.expires_in) || 3600) * 1000;
    x.email = email;
    x.scopes = granted;
    if (service && complete) x.services = [...new Set([...(x.services ?? []), service])];
    delete x.state;
    delete x.verifier;
    delete x.pendingService;
  });
  if (!t.refresh_token && !g.refreshToken) throw new Error("리프레시 토큰을 받지 못했습니다. Google 계정의 ‘서드 파티 액세스’에서 이 앱을 지운 뒤 다시 연결하세요.");
  const label = CONNECTABLE.find((c) => c.id === service)?.label ?? "Google";
  if (!complete) throw new Error(`${label}에 필요한 권한이 허용되지 않았습니다. 동의 창에서 모든 항목을 체크해 다시 연결하세요.`);
  return { email, service: label };
}

/**
 * 연결 끊기. 서비스 하나만 끊으면 그 서비스의 도구만 막는다(Google 은 권한을 하나씩 거두는 길을 주지 않는다).
 * 마지막 서비스를 끊거나 service 를 주지 않으면 토큰을 취소하고 지운다.
 */
export async function disconnectGoogle(service?: ConnectableService) {
  const g = await load();
  const left = service ? (g.services ?? []).filter((x) => x !== service) : [];
  if (left.length) return update((x) => void (x.services = left));
  const token = g.refreshToken ?? g.accessToken;
  if (token) await fetch(`${REVOKE_URL}?token=${encodeURIComponent(token)}`, { method: "POST" }).catch(() => {});
  await update((x) => {
    delete x.accessToken;
    delete x.refreshToken;
    delete x.expiresAt;
    delete x.email;
    delete x.scopes;
    delete x.services;
  });
}

async function accessToken(force = false): Promise<string> {
  const g = await load();
  if (!g.refreshToken) throw new Error("Google 계정이 연결되지 않았습니다. 도구 관리의 ‘커넥터’에서 연결하세요.");
  if (!force && g.accessToken && (g.expiresAt ?? 0) > Date.now() + 60_000) return g.accessToken;
  const t = await tokenRequest({ grant_type: "refresh_token", refresh_token: g.refreshToken, client_id: g.clientId!, client_secret: g.clientSecret! });
  const access = String(t.access_token ?? "");
  await update((x) => {
    x.accessToken = access;
    x.expiresAt = Date.now() + (Number(t.expires_in) || 3600) * 1000;
  });
  return access;
}

/** Google API 호출. 401 이면 토큰을 갱신해 한 번 더 한다 */
async function api(url: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<Record<string, unknown>> {
  const call = async (token: string) =>
    fetch(url, {
      method: init.method ?? "GET",
      headers: { Authorization: `Bearer ${token}`, ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}) },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      signal: init.signal,
    });
  let res = await call(await accessToken());
  if (res.status === 401) res = await call(await accessToken(true));
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const err = json.error as { message?: string; status?: string } | undefined;
    throw new Error(`Google API ${res.status}${err?.status ? ` ${err.status}` : ""}: ${err?.message ?? "요청 실패"}`);
  }
  return json;
}

/** 연결 확인: 계정 주소를 읽어 본다(어느 서비스를 연결했든 받는 기본 권한으로) */
export async function testGoogle(): Promise<string> {
  const me = await api("https://www.googleapis.com/oauth2/v2/userinfo");
  return String(me.email ?? "");
}

// ───────────────────────── 도구 실행 ─────────────────────────

type In = Record<string, unknown>;
const s = (v: unknown) => (v == null ? "" : String(v));
const need = (input: In, key: string) => {
  const v = s(input[key]).trim();
  if (!v) throw new Error(`${key} 값이 필요합니다.`);
  return v;
};
const enc = encodeURIComponent;
const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";

const decode = (data: string) => Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
const stripHtml = (html: string) =>
  html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

interface Part {
  mimeType?: string;
  body?: { data?: string };
  parts?: Part[];
  headers?: { name: string; value: string }[];
}
/** 메일 본문: text/plain 을 먼저, 없으면 HTML 에서 글만 */
function bodyOf(part: Part): string {
  const find = (p: Part, mime: string): string | null => {
    if (p.mimeType === mime && p.body?.data) return decode(p.body.data);
    for (const c of p.parts ?? []) {
      const hit = find(c, mime);
      if (hit) return hit;
    }
    return null;
  };
  const plain = find(part, "text/plain");
  if (plain) return plain.trim();
  const html = find(part, "text/html");
  return html ? stripHtml(html) : "";
}
const header = (p: Part | undefined, name: string) => p?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";

/** RFC 2822 메시지를 Gmail 이 받는 base64url 로 */
function rawMail(to: string, subject: string, body: string) {
  const lines = [`To: ${to}`, `Subject: =?UTF-8?B?${Buffer.from(subject, "utf8").toString("base64")}?=`, "MIME-Version: 1.0", "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "", Buffer.from(body, "utf8").toString("base64")];
  return b64url(Buffer.from(lines.join("\r\n"), "utf8"));
}

const text = (node: unknown): string => {
  // Google 문서 본문에서 글만 뽑는다(문단 · 표)
  const out: string[] = [];
  const walk = (content: unknown) => {
    for (const el of (Array.isArray(content) ? content : []) as Record<string, unknown>[]) {
      const para = el.paragraph as { elements?: { textRun?: { content?: string } }[] } | undefined;
      if (para) out.push((para.elements ?? []).map((e) => e.textRun?.content ?? "").join(""));
      const table = el.table as { tableRows?: { tableCells?: { content?: unknown }[] }[] } | undefined;
      for (const row of table?.tableRows ?? []) for (const cell of row.tableCells ?? []) walk(cell.content);
    }
  };
  walk(node);
  return out.join("").trim();
};

const table = (rows: unknown) => ((Array.isArray(rows) ? rows : []) as unknown[][]).map((r) => (Array.isArray(r) ? r.map(s).join("\t") : s(r))).join("\n");
const rowsOf = (v: unknown): string[][] => ((Array.isArray(v) ? v : []) as unknown[]).map((r) => (Array.isArray(r) ? r.map(s) : [s(r)]));

const RUN: Record<string, (input: In, signal: AbortSignal) => Promise<string>> = {
  async gmail_search(input, signal) {
    const max = Math.min(20, Math.max(1, Number(input.max_results) || 8));
    const list = await api(`${GMAIL}/messages?q=${enc(need(input, "query"))}&maxResults=${max}`, { signal });
    const ids = ((list.messages as { id: string }[]) ?? []).map((m) => m.id);
    if (!ids.length) return "찾은 메일이 없습니다.";
    const items = await Promise.all(
      ids.map(async (id) => {
        const m = await api(`${GMAIL}/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`, { signal });
        const p = m.payload as Part;
        return `- id: ${id}\n  보낸 사람: ${header(p, "From")}\n  제목: ${header(p, "Subject")}\n  날짜: ${header(p, "Date")}\n  앞부분: ${s(m.snippet)}`;
      }),
    );
    return `메일 ${items.length}통\n${items.join("\n")}`;
  },
  async gmail_read(input, signal) {
    const m = await api(`${GMAIL}/messages/${enc(need(input, "id"))}?format=full`, { signal });
    const p = m.payload as Part;
    return `보낸 사람: ${header(p, "From")}\n받는 사람: ${header(p, "To")}\n제목: ${header(p, "Subject")}\n날짜: ${header(p, "Date")}\n\n${clip(bodyOf(p) || s(m.snippet), 6000)}`;
  },
  async gmail_create_draft(input, signal) {
    const d = await api(`${GMAIL}/drafts`, { method: "POST", body: { message: { raw: rawMail(need(input, "to"), need(input, "subject"), need(input, "body")) } }, signal });
    return `초안을 만들었습니다(보내지 않음). 초안 ID: ${s(d.id)}. Gmail 초안함에서 확인하고 보낼 수 있습니다.`;
  },
  async gmail_send(input, signal) {
    const to = need(input, "to");
    const m = await api(`${GMAIL}/messages/send`, { method: "POST", body: { raw: rawMail(to, need(input, "subject"), need(input, "body")) }, signal });
    return `${to} 에게 보냈습니다. 메일 ID: ${s(m.id)}`;
  },
  async calendar_list(input, signal) {
    const max = Math.min(50, Math.max(1, Number(input.max_results) || 20));
    const q = new URLSearchParams({ timeMin: need(input, "time_min"), timeMax: need(input, "time_max"), singleEvents: "true", orderBy: "startTime", maxResults: String(max) });
    if (s(input.query).trim()) q.set("q", s(input.query).trim());
    const r = await api(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${q}`, { signal });
    const items = ((r.items as Record<string, unknown>[]) ?? []).map((e) => {
      const at = (v: unknown) => s((v as { dateTime?: string; date?: string })?.dateTime ?? (v as { date?: string })?.date);
      return `- ${at(e.start)} ~ ${at(e.end)} | ${s(e.summary) || "(제목 없음)"}${e.location ? ` | 장소: ${s(e.location)}` : ""}${e.description ? ` | ${clip(s(e.description), 160)}` : ""} | id: ${s(e.id)}`;
    });
    return items.length ? `일정 ${items.length}건\n${items.join("\n")}` : "그 기간에 일정이 없습니다.";
  },
  async calendar_create(input, signal) {
    const e = await api("https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=none", {
      method: "POST",
      body: { summary: need(input, "summary"), start: { dateTime: need(input, "start") }, end: { dateTime: need(input, "end") }, ...(s(input.description) ? { description: s(input.description) } : {}), ...(s(input.location) ? { location: s(input.location) } : {}) },
      signal,
    });
    return `일정을 만들었습니다: ${s(e.summary)} (${s(e.htmlLink)})`;
  },
  async drive_search(input, signal) {
    const name = need(input, "name").replace(/['\\]/g, " ");
    const mime = { sheet: "application/vnd.google-apps.spreadsheet", doc: "application/vnd.google-apps.document" }[s(input.type)];
    const types = mime ? `mimeType = '${mime}'` : "(mimeType = 'application/vnd.google-apps.spreadsheet' or mimeType = 'application/vnd.google-apps.document')";
    const q = `name contains '${name}' and ${types} and trashed = false`;
    const r = await api(`https://www.googleapis.com/drive/v3/files?q=${enc(q)}&pageSize=10&orderBy=modifiedTime desc&fields=${enc("files(id,name,mimeType,modifiedTime)")}`, { signal });
    const files = ((r.files as Record<string, unknown>[]) ?? []).map((f) => `- ${s(f.name)} | ${s(f.mimeType).endsWith("spreadsheet") ? "스프레드시트" : "문서"} | id: ${s(f.id)} | 수정: ${s(f.modifiedTime)}`);
    return files.length ? `파일 ${files.length}개\n${files.join("\n")}` : "그 이름의 파일을 찾지 못했습니다.";
  },
  async sheets_read(input, signal) {
    const r = await api(`https://sheets.googleapis.com/v4/spreadsheets/${enc(need(input, "spreadsheet_id"))}/values/${enc(need(input, "range"))}`, { signal });
    const rows = (r.values as unknown[][]) ?? [];
    return rows.length ? `${s(r.range)} · ${rows.length}행 (탭으로 구분)\n${clip(table(rows), 8000)}` : "그 범위는 비어 있습니다.";
  },
  async sheets_append(input, signal) {
    const rows = rowsOf(input.rows);
    if (!rows.length) throw new Error("rows 값이 필요합니다.");
    const r = await api(`https://sheets.googleapis.com/v4/spreadsheets/${enc(need(input, "spreadsheet_id"))}/values/${enc(need(input, "range"))}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, { method: "POST", body: { values: rows }, signal });
    const u = r.updates as { updatedRange?: string; updatedRows?: number } | undefined;
    return `${u?.updatedRows ?? rows.length}행을 덧붙였습니다 (${u?.updatedRange ?? ""}).`;
  },
  async sheets_create(input, signal) {
    const sheet = await api("https://sheets.googleapis.com/v4/spreadsheets", { method: "POST", body: { properties: { title: need(input, "title") } }, signal });
    const id = s(sheet.spreadsheetId);
    const rows = rowsOf(input.rows);
    if (rows.length) await api(`https://sheets.googleapis.com/v4/spreadsheets/${enc(id)}/values/A1?valueInputOption=USER_ENTERED`, { method: "PUT", body: { values: rows }, signal });
    return `스프레드시트를 만들었습니다${rows.length ? ` (${rows.length}행 채움)` : ""}. id: ${id} · ${s(sheet.spreadsheetUrl)}`;
  },
  async docs_read(input, signal) {
    const d = await api(`https://docs.googleapis.com/v1/documents/${enc(need(input, "document_id"))}`, { signal });
    return `제목: ${s(d.title)}\n\n${clip(text((d.body as { content?: unknown })?.content), 8000) || "(빈 문서)"}`;
  },
  async docs_create(input, signal) {
    const d = await api("https://docs.googleapis.com/v1/documents", { method: "POST", body: { title: need(input, "title") }, signal });
    const id = s(d.documentId);
    const content = s(input.content);
    if (content) await api(`https://docs.googleapis.com/v1/documents/${enc(id)}:batchUpdate`, { method: "POST", body: { requests: [{ insertText: { location: { index: 1 }, text: content } }] }, signal });
    return `문서를 만들었습니다. id: ${id} · https://docs.google.com/document/d/${id}/edit`;
  },
  async docs_append(input, signal) {
    const id = need(input, "document_id");
    await api(`https://docs.googleapis.com/v1/documents/${enc(id)}:batchUpdate`, { method: "POST", body: { requests: [{ insertText: { endOfSegmentLocation: {}, text: `\n${need(input, "text")}` } }] }, signal });
    return `문서 끝에 덧붙였습니다. https://docs.google.com/document/d/${id}/edit`;
  },
};

// ───────────────────────── 시연용 예시 데이터 ─────────────────────────

const DEMO_NOTE = "[예시 데이터 · Google 에 연결하지 않은 시연 모드]\n";
const DEMO: Record<string, (input: In) => string> = {
  gmail_search: () =>
    "메일 3통\n- id: demo-m1\n  보낸 사람: 박지훈 <jihoon@partner.example>\n  제목: [견적] 12월 워크숍 장소 견적 보내드립니다\n  날짜: Thu, 19 Nov 2026 09:12:00 +0900\n  앞부분: 안녕하세요, 요청하신 30명 기준 견적입니다. 1안 성수 스튜디오 180만원…\n- id: demo-m2\n  보낸 사람: 이서연 <seoyeon@acme.example>\n  제목: 주간 회의 안건 취합\n  날짜: Wed, 18 Nov 2026 17:40:00 +0900\n  앞부분: 금요일 주간 회의 안건을 목요일까지 보내 주세요…\n- id: demo-m3\n  보낸 사람: billing@cloud.example\n  제목: 11월 청구서가 발행되었습니다\n  날짜: Tue, 17 Nov 2026 08:00:00 +0900\n  앞부분: 이번 달 사용 금액은 412,000원입니다…",
  gmail_read: (i) =>
    `보낸 사람: 박지훈 <jihoon@partner.example>\n받는 사람: me@example.com\n제목: [견적] 12월 워크숍 장소 견적 보내드립니다\n날짜: Thu, 19 Nov 2026 09:12:00 +0900\n\n(id ${s(i.id)})\n안녕하세요, 요청하신 30명 기준 견적입니다.\n1안 성수 스튜디오: 180만원 (12/11 금, 10~18시, 빔프로젝터 포함)\n2안 판교 세미나룸: 140만원 (12/11 금, 13~18시, 케이터링 별도 45만원)\n이번 주 금요일까지 회신 부탁드립니다.`,
  gmail_create_draft: (i) => `초안을 만들었습니다(보내지 않음). 받는 사람: ${s(i.to)} · 제목: ${s(i.subject)} · 초안 ID: demo-d1`,
  gmail_send: (i) => `${s(i.to)} 에게 보냈습니다(시연 모드라 실제로는 보내지 않음). 메일 ID: demo-s1`,
  calendar_list: () =>
    "일정 4건\n- 2026-11-20T10:00:00+09:00 ~ 2026-11-20T11:00:00+09:00 | 주간 회의 | 장소: 3층 회의실 | id: demo-e1\n- 2026-11-20T14:00:00+09:00 ~ 2026-11-20T15:00:00+09:00 | 거래처 미팅 (박지훈) | id: demo-e2\n- 2026-11-23T09:30:00+09:00 ~ 2026-11-23T10:00:00+09:00 | 1:1 (이서연) | id: demo-e3\n- 2026-11-24T16:00:00+09:00 ~ 2026-11-24T17:30:00+09:00 | 분기 계획 검토 | id: demo-e4",
  calendar_create: (i) => `일정을 만들었습니다: ${s(i.summary)} (${s(i.start)} ~ ${s(i.end)})`,
  drive_search: (i) => `파일 2개\n- ${s(i.name)} 관리 | 스프레드시트 | id: demo-sheet-1 | 수정: 2026-11-18T08:21:00Z\n- ${s(i.name)} 회의록 | 문서 | id: demo-doc-1 | 수정: 2026-11-17T02:05:00Z`,
  sheets_read: () => "Sheet1!A1:D4 · 4행 (탭으로 구분)\n항목\t담당\t기한\t상태\n워크숍 장소 확정\t김하늘\t2026-11-20\t진행 중\n케이터링 견적\t이서연\t2026-11-24\t대기\n참가자 명단\t박지훈\t2026-11-27\t완료",
  sheets_append: (i) => `${rowsOf(i.rows).length}행을 덧붙였습니다 (Sheet1!A5:D${4 + rowsOf(i.rows).length}).`,
  sheets_create: (i) => `스프레드시트를 만들었습니다${rowsOf(i.rows).length ? ` (${rowsOf(i.rows).length}행 채움)` : ""}. id: demo-sheet-new · https://docs.google.com/spreadsheets/d/demo-sheet-new`,
  docs_read: () => "제목: 워크숍 회의록\n\n일시: 2026-11-17\n결정: 워크숍은 12/11(금)에 한다. 장소는 견적을 받아 이번 주 안에 정한다.\n할 일: 견적 비교(김하늘), 참가자 확정(박지훈)",
  docs_create: (i) => `문서를 만들었습니다(${s(i.content).length}자). id: demo-doc-new · https://docs.google.com/document/d/demo-doc-new/edit`,
  docs_append: (i) => `문서 끝에 덧붙였습니다(${s(i.text).length}자). https://docs.google.com/document/d/${s(i.document_id)}/edit`,
};

/** 커넥터 도구 실행. 오류는 모델이 읽고 대응하도록 결과로 돌려준다 */
export async function runGoogleTool(name: string, input: unknown, signal: AbortSignal): Promise<ToolOutput> {
  const args = (input && typeof input === "object" ? input : {}) as In;
  const g = await load();
  try {
    const def = connectorTool(name);
    const run = RUN[name];
    if (!def || !run) return { output: `모르는 커넥터 도구입니다: ${name}`, isError: true };
    if (!serviceConnected(servicesOf(g), def.service)) {
      if (g.demo && DEMO[name]) return { output: DEMO_NOTE + DEMO[name](args) };
      const label = def.service === "drive" ? "Google 스프레드시트 또는 문서" : (CONNECTABLE.find((c) => c.id === def.service)?.label ?? "Google");
      return { output: `${label}가 연결되지 않았습니다. 설정의 ‘커넥터’에서 연결하세요.`, isError: true };
    }
    return { output: await run(args, signal) };
  } catch (e) {
    return { output: (e as Error).message, isError: true };
  }
}
