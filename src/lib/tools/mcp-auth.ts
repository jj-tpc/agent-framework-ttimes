import { randomBytes } from "node:crypto";
import { files } from "../store/backend";
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type { OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";

/**
 * MCP 서버의 OAuth 로그인 상태. data/mcp-auth.json 에 서버별로 둔다(.gitignore — 토큰이 들어간다).
 * 흐름은 SDK 가 맡는다(서버 메타데이터 찾기, 클라이언트 동적 등록, PKCE, 토큰 갱신). 여기서는 저장만 한다.
 */

const FILE = "mcp-auth.json";

interface Entry {
  client?: OAuthClientInformationMixed;
  tokens?: OAuthTokens;
  verifier?: string;
  /** 로그인 창을 연 요청과 돌아온 요청을 잇는 값 */
  state?: string;
  redirectUrl?: string;
}
type AuthFile = Record<string, Entry>;

const queues = new Map<string, Promise<unknown>>();
const locked = <T>(fn: () => Promise<T>): Promise<T> => {
  const id = files().id;
  const next = (queues.get(id) ?? Promise.resolve()).then(fn, fn);
  queues.set(
    id,
    next.catch(() => {}),
  );
  return next;
};

async function read(): Promise<AuthFile> {
  return ((await files().read(FILE)) as AuthFile | null) ?? {};
}
const update = (server: string, fn: (e: Entry) => void) =>
  locked(async () => {
    const all = await read();
    const entry = all[server] ?? {};
    fn(entry);
    all[server] = entry;
    await files().write(FILE, all);
  });
const entryOf = async (server: string): Promise<Entry> => (await locked(read))[server] ?? {};

export async function isLoggedIn(server: string): Promise<boolean> {
  return !!(await entryOf(server)).tokens?.access_token;
}

export async function serverByState(state: string): Promise<string | null> {
  if (!state) return null;
  const all = await locked(read);
  return Object.keys(all).find((k) => all[k].state === state) ?? null;
}

export function clearAuth(server: string): Promise<void> {
  return locked(async () => {
    const all = await read();
    delete all[server];
    await files().write(FILE, all);
  });
}

/**
 * SDK 가 부르는 저장소 인터페이스.
 * redirectUrl 은 로그인을 시작할 때만 필요하다. 실행 중(토큰 갱신)에는 저장해 둔 값을 쓴다.
 */
export class FileOAuthProvider implements OAuthClientProvider {
  /** 사용자가 열어야 할 로그인 주소(SDK 가 redirectToAuthorization 으로 알려 준다) */
  pendingUrl: string | null = null;
  private nextState: string | null = null;

  private server: string;
  private redirect: string;

  private constructor(server: string, redirect: string) {
    this.server = server;
    this.redirect = redirect;
  }

  static async open(server: string, redirectUrl?: string): Promise<FileOAuthProvider> {
    const saved = (await entryOf(server)).redirectUrl;
    if (redirectUrl && redirectUrl !== saved) await update(server, (e) => void (e.redirectUrl = redirectUrl));
    return new FileOAuthProvider(server, redirectUrl ?? saved ?? "http://localhost:3000/api/mcp/oauth/callback");
  }

  get redirectUrl() {
    return this.redirect;
  }
  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: "Node Trace (workflow runner)",
      redirect_uris: [this.redirect],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    };
  }
  async state() {
    this.nextState = randomBytes(16).toString("hex");
    await update(this.server, (e) => void (e.state = this.nextState!));
    return this.nextState;
  }
  async clientInformation() {
    return (await entryOf(this.server)).client;
  }
  async saveClientInformation(client: OAuthClientInformationMixed) {
    await update(this.server, (e) => void (e.client = client));
  }
  async tokens() {
    return (await entryOf(this.server)).tokens;
  }
  async saveTokens(tokens: OAuthTokens) {
    await update(this.server, (e) => {
      e.tokens = tokens;
      delete e.state;
      delete e.verifier;
    });
  }
  redirectToAuthorization(url: URL) {
    this.pendingUrl = url.toString();
  }
  async saveCodeVerifier(verifier: string) {
    await update(this.server, (e) => void (e.verifier = verifier));
  }
  async codeVerifier() {
    const v = (await entryOf(this.server)).verifier;
    if (!v) throw new Error("로그인을 처음부터 다시 시작하세요(인증 상태가 없습니다).");
    return v;
  }
  async invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier" | "discovery") {
    await update(this.server, (e) => {
      if (scope === "all" || scope === "tokens") delete e.tokens;
      if (scope === "all" || scope === "client") delete e.client;
      if (scope === "all" || scope === "verifier") delete e.verifier;
    });
  }
}
