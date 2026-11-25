import path from "node:path";
import { UnauthorizedError, auth } from "@modelcontextprotocol/sdk/client/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { mcpToolName, objectSchema, type McpRef, type ToolDef, type ToolOutput } from "./config";
import { FileOAuthProvider, clearAuth, isLoggedIn, serverByState } from "./mcp-auth";
import { files, multiUser } from "../store/backend";
import { PLUGIN_ROOT, listPlugins, pluginMcpServers } from "./skills";

/**
 * 외부 MCP 서버 연결(공식 SDK 클라이언트).
 *
 * 서버 목록은 data/mcp.json 에 표준 형식({"mcpServers": {...}})으로 둔다. 인증 헤더가 들어가므로 .gitignore 대상이다.
 *   원격:  { "type": "http", "url": "https://…/mcp", "headers": { "Authorization": "Bearer ${MY_TOKEN}" } }   (type: "sse" 도 가능)
 *   로컬:  { "command": "npx", "args": ["-y", "…"], "env": { … } }
 *   OAuth: { "type": "http", "url": "https://…/mcp", "auth": "oauth" }  — 화면에서 로그인하면 토큰을 data/mcp-auth.json 에 둔다
 * 값 안의 ${이름} 은 환경변수로 바꿔 넣는다.
 *
 * 로컬(stdio) 서버는 이 PC에서 명령을 실행하므로 화면·API 로는 등록할 수 없고, 파일을 직접 고쳐야 한다.
 * 플러그인의 .mcp.json 에 든 서버는 "플러그인:서버" 이름으로 함께 나온다.
 */

const FILE = "mcp.json";
const NAME = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,39}$/;

export interface McpServerConfig {
  type: "http" | "sse" | "stdio";
  url?: string;
  headers?: Record<string, string>;
  /** oauth 면 헤더 대신 브라우저 로그인으로 받은 토큰을 쓴다 */
  auth?: "oauth";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

export interface McpServerInfo {
  name: string;
  type: McpServerConfig["type"];
  /** 원격은 주소, 로컬은 명령 */
  target: string;
  headerNames: string[];
  source: "settings" | "plugin";
  /** 화면에서 지울 수 있는지(화면에서 추가한 원격 서버만) */
  editable: boolean;
  auth: "oauth" | "header" | "none";
  /** OAuth 서버: 로그인해서 받은 토큰이 있는지 */
  loggedIn?: boolean;
}

const stringMap = (v: unknown): Record<string, string> =>
  v && typeof v === "object" ? Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, String(x)])) : {};

function normalize(raw: unknown): McpServerConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.command === "string" && r.command) {
    return { type: "stdio", command: r.command, args: Array.isArray(r.args) ? r.args.map(String) : [], env: stringMap(r.env), ...(r.cwd ? { cwd: String(r.cwd) } : {}) };
  }
  if (typeof r.url === "string" && r.url) {
    const type = r.type === "sse" ? "sse" : "http";
    return { type, url: r.url, headers: stringMap(r.headers), ...(r.auth === "oauth" ? { auth: "oauth" as const } : {}) };
  }
  return null;
}

async function readFileServers(): Promise<Record<string, unknown>> {
  const raw = (await files().read(FILE)) as Record<string, unknown> | null;
  const servers = raw?.mcpServers && typeof raw.mcpServers === "object" ? (raw.mcpServers as Record<string, unknown>) : {};
  // 여러 사용자가 쓰는 서버에서는 서버에서 명령을 실행하는 로컬(stdio) 서버를 받지 않는다
  return multiUser() ? Object.fromEntries(Object.entries(servers).filter(([, v]) => normalize(v)?.type !== "stdio")) : servers;
}

async function allServers(): Promise<Map<string, { cfg: McpServerConfig; source: "settings" | "plugin"; cwd?: string }>> {
  const out = new Map<string, { cfg: McpServerConfig; source: "settings" | "plugin"; cwd?: string }>();
  for (const [name, raw] of Object.entries(await readFileServers())) {
    const cfg = normalize(raw);
    if (cfg) out.set(name, { cfg, source: "settings" });
  }
  for (const plugin of await listPlugins()) {
    for (const [name, raw] of Object.entries(await pluginMcpServers(plugin.name))) {
      const cfg = normalize(raw);
      if (cfg) out.set(`${plugin.name}:${name}`, { cfg, source: "plugin", cwd: path.join(PLUGIN_ROOT, plugin.name) });
    }
  }
  return out;
}

export async function listMcpServers(): Promise<McpServerInfo[]> {
  return Promise.all(
    [...(await allServers())].map(async ([name, { cfg, source }]) => ({
      name,
      type: cfg.type,
      target: cfg.type === "stdio" ? [cfg.command, ...(cfg.args ?? [])].join(" ") : String(cfg.url),
      headerNames: Object.keys(cfg.headers ?? {}),
      source,
      editable: source === "settings" && cfg.type !== "stdio",
      auth: cfg.auth === "oauth" ? ("oauth" as const) : Object.keys(cfg.headers ?? {}).length ? ("header" as const) : ("none" as const),
      ...(cfg.auth === "oauth" ? { loggedIn: await isLoggedIn(name) } : {}),
    })),
  );
}

/** 화면에서 원격 서버 추가·수정. 로컬 명령은 받지 않는다 */
export async function saveRemoteServer(name: string, input: { url: string; type?: string; headers?: Record<string, string>; auth?: string }): Promise<void> {
  if (!NAME.test(name)) throw new Error("서버 이름은 영문·숫자·-·_ 로 40자 이내여야 합니다.");
  let url: URL;
  try {
    url = new URL(input.url);
  } catch {
    throw new Error("올바른 주소가 아닙니다.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("http/https 주소만 등록할 수 있습니다.");
  const servers = await readFileServers();
  const before = normalize(servers[name]);
  if (before?.type === "stdio") throw new Error("같은 이름의 로컬(stdio) 서버가 파일에 있습니다. 다른 이름을 쓰세요.");
  const headers = Object.fromEntries(Object.entries(stringMap(input.headers)).filter(([k, v]) => k.trim() && v.trim()));
  servers[name] = {
    type: input.type === "sse" ? "sse" : "http",
    url: url.toString(),
    ...(Object.keys(headers).length ? { headers } : {}),
    ...(input.auth === "oauth" ? { auth: "oauth" } : {}),
  };
  // 주소가 바뀌면 예전 서버에서 받은 토큰을 새 주소로 보내지 않는다
  if (before?.url !== url.toString()) await clearAuth(name);
  await files().write(FILE, { mcpServers: servers });
}

export async function removeServer(name: string): Promise<void> {
  const servers = await readFileServers();
  if (normalize(servers[name])?.type === "stdio") throw new Error("로컬(stdio) 서버는 data/mcp.json 파일에서 직접 지우세요.");
  delete servers[name];
  await clearAuth(name);
  await files().write(FILE, { mcpServers: servers });
}

// ───────────────────────── 연결 ─────────────────────────

const expand = (s: string) => s.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, k: string) => process.env[k] ?? "");
const expandMap = (m: Record<string, string> = {}) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, expand(v)]));

const CONNECT_TIMEOUT = 20_000;
const CALL_TIMEOUT = 60_000;
const clientInfo = { name: "workflow-runner", version: "1.0.0" };

async function connect(cfg: McpServerConfig, cwd?: string, name = ""): Promise<Client> {
  if (cfg.type === "stdio") {
    const client = new Client(clientInfo);
    await client.connect(
      new StdioClientTransport({
        command: expand(cfg.command!),
        args: (cfg.args ?? []).map(expand),
        env: { ...getDefaultEnvironment(), ...expandMap(cfg.env) },
        stderr: "ignore",
        ...(cfg.cwd || cwd ? { cwd: cfg.cwd ?? cwd } : {}),
      }),
      { timeout: CONNECT_TIMEOUT },
    );
    return client;
  }
  const url = new URL(expand(cfg.url!));
  const authProvider = cfg.auth === "oauth" ? await FileOAuthProvider.open(name) : undefined;
  const options = { requestInit: { headers: expandMap(cfg.headers) }, ...(authProvider ? { authProvider } : {}) };
  if (cfg.type === "sse") {
    const client = new Client(clientInfo);
    await client.connect(new SSEClientTransport(url, options), { timeout: CONNECT_TIMEOUT });
    return client;
  }
  try {
    const client = new Client(clientInfo);
    await client.connect(new StreamableHTTPClientTransport(url, options), { timeout: CONNECT_TIMEOUT });
    return client;
  } catch (first) {
    // 예전 방식(HTTP+SSE)만 받는 서버를 위한 재시도. 인증 오류는 그대로 알린다
    if (first instanceof UnauthorizedError || /401|403|unauthorized|forbidden/i.test(String((first as Error).message))) throw first;
    try {
      const client = new Client(clientInfo);
      await client.connect(new SSEClientTransport(url, options), { timeout: CONNECT_TIMEOUT });
      return client;
    } catch {
      throw first;
    }
  }
}

interface RemoteTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

async function fetchTools(client: Client): Promise<RemoteTool[]> {
  const out: RemoteTool[] = [];
  let cursor: string | undefined;
  do {
    const page = await client.listTools(cursor ? { cursor } : undefined, { timeout: CONNECT_TIMEOUT });
    out.push(...(page.tools as RemoteTool[]));
    cursor = page.nextCursor;
  } while (cursor && out.length < 500);
  return out;
}

const describe = (e: unknown, cfg?: McpServerConfig) => {
  const msg = (e as Error)?.message || String(e);
  if (cfg?.auth === "oauth" && (e instanceof UnauthorizedError || /401|unauthorized/i.test(msg))) return "로그인이 필요합니다 — 도구 설정의 MCP 서버 ‘관리’에서 이 서버에 로그인하세요.";
  if (/401|unauthorized/i.test(msg)) return `인증 실패 — 서버가 요구하는 헤더(Authorization 등)를 확인하세요. OAuth 로그인 방식 서버라면 인증을 ‘OAuth 로그인’으로 다시 등록하세요. (${msg.slice(0, 160)})`;
  if (/ENOENT/.test(msg)) return `명령을 찾지 못했습니다 — command 가 설치되어 있고 PATH 에 있는지 확인하세요. (${msg.slice(0, 160)})`;
  return msg.slice(0, 300);
};

/** 연결 시험: 서버가 내놓는 도구 목록을 돌려준다 */
export async function testMcpServer(name: string): Promise<{ ok: true; server?: string; tools: { name: string; description: string }[] } | { ok: false; error: string }> {
  const entry = (await allServers()).get(name);
  if (!entry) return { ok: false, error: `등록되지 않은 서버: ${name}` };
  let client: Client | null = null;
  try {
    client = await connect(entry.cfg, entry.cwd, name);
    const tools = await fetchTools(client);
    const v = client.getServerVersion();
    return { ok: true, ...(v ? { server: `${v.name} ${v.version}` } : {}), tools: tools.map((t) => ({ name: t.name, description: String(t.description ?? "").slice(0, 300) })) };
  } catch (e) {
    return { ok: false, error: describe(e, entry.cfg) };
  } finally {
    await client?.close().catch(() => {});
  }
}

// ───────────────────────── OAuth 로그인 ─────────────────────────

/**
 * 로그인 시작: 사용자가 브라우저로 열 주소를 돌려준다. 이미 유효한 토큰이 있으면 url 없이 끝난다.
 * redirectUrl 은 이 앱의 /api/mcp/oauth/callback 주소다.
 */
export async function startLogin(name: string, redirectUrl: string): Promise<{ url?: string; authorized: boolean }> {
  const entry = (await allServers()).get(name);
  if (!entry || entry.cfg.auth !== "oauth" || !entry.cfg.url) throw new Error("OAuth 로그인을 쓰는 원격 서버가 아닙니다.");
  const provider = await FileOAuthProvider.open(name, redirectUrl);
  const result = await auth(provider, { serverUrl: expand(entry.cfg.url) });
  if (result === "AUTHORIZED") return { authorized: true };
  if (!provider.pendingUrl) throw new Error("서버가 로그인 주소를 주지 않았습니다.");
  return { url: provider.pendingUrl, authorized: false };
}

/** 로그인 창에서 돌아왔을 때: 받은 코드를 토큰으로 바꿔 저장한다 */
export async function finishLogin(code: string, state: string): Promise<string> {
  const name = await serverByState(state);
  if (!name) throw new Error("로그인 요청을 찾지 못했습니다(state 불일치). 로그인을 다시 시작하세요.");
  const entry = (await allServers()).get(name);
  if (!entry?.cfg.url) throw new Error(`등록되지 않은 서버: ${name}`);
  const provider = await FileOAuthProvider.open(name);
  const result = await auth(provider, { serverUrl: expand(entry.cfg.url), authorizationCode: code });
  if (result !== "AUTHORIZED") throw new Error("토큰을 받지 못했습니다.");
  return name;
}

export async function logout(name: string): Promise<void> {
  await clearAuth(name);
}

export interface McpSession {
  defs: ToolDef[];
  /** 도구 이름 → 어느 서버의 어느 도구인지 */
  origin: Map<string, { server: string; tool: string }>;
  run: (toolName: string, input: unknown, signal: AbortSignal) => Promise<ToolOutput>;
  /** 서버별 연결 결과(실행 기록용) */
  status: { server: string; ok: boolean; tools?: string[]; error?: string }[];
  close: () => Promise<void>;
}

/** LLM 노드 한 번의 실행 동안 쓸 서버들에 연결해 도구를 모은다. 연결에 실패한 서버는 빼고 계속한다 */
export async function openMcp(refs: McpRef[]): Promise<McpSession | null> {
  if (!refs.length) return null;
  const servers = await allServers();
  const clients = new Map<string, Client>();
  const defs: ToolDef[] = [];
  const origin = new Map<string, { server: string; tool: string }>();
  const status: McpSession["status"] = [];

  await Promise.all(
    refs.map(async (ref) => {
      const entry = servers.get(ref.server);
      if (!entry) return void status.push({ server: ref.server, ok: false, error: "등록되지 않은 서버" });
      try {
        const client = await connect(entry.cfg, entry.cwd, ref.server);
        clients.set(ref.server, client);
        const tools = (await fetchTools(client)).filter((t) => !ref.tools?.length || ref.tools.includes(t.name));
        for (const t of tools) {
          const name = mcpToolName(ref.server, t.name);
          if (origin.has(name)) continue;
          origin.set(name, { server: ref.server, tool: t.name });
          defs.push({ name, description: `[MCP · ${ref.server}] ${String(t.description ?? t.name)}`.slice(0, 1000), parameters: objectSchema(t.inputSchema) });
        }
        status.push({ server: ref.server, ok: true, tools: tools.map((t) => t.name) });
      } catch (e) {
        status.push({ server: ref.server, ok: false, error: describe(e, entry.cfg) });
      }
    }),
  );

  return {
    defs,
    origin,
    status,
    run: async (toolName, input, signal) => {
      const o = origin.get(toolName);
      const client = o && clients.get(o.server);
      if (!o || !client) return { output: `모르는 MCP 도구: ${toolName}`, isError: true };
      const res = await client.callTool({ name: o.tool, arguments: (input && typeof input === "object" ? input : {}) as Record<string, unknown> }, undefined, {
        signal,
        timeout: CALL_TIMEOUT,
      });
      const parts = Array.isArray(res.content) ? (res.content as Record<string, unknown>[]) : [];
      const text = parts
        .map((p) => {
          if (p.type === "text") return String(p.text ?? "");
          if (p.type === "resource") return String((p.resource as { text?: unknown })?.text ?? `[리소스 ${(p.resource as { uri?: unknown })?.uri ?? ""}]`);
          if (p.type === "resource_link") return `[링크 ${String(p.uri ?? "")}]`;
          return `[${String(p.type)} 내용은 글로 옮기지 못했습니다]`;
        })
        .join("\n");
      const output = text || (res.structuredContent ? JSON.stringify(res.structuredContent) : "(빈 결과)");
      return { output, isError: !!res.isError };
    },
    close: async () => {
      await Promise.all([...clients.values()].map((c) => c.close().catch(() => {})));
    },
  };
}
