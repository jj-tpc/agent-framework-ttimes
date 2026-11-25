import { AsyncLocalStorage } from "node:async_hooks";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { supabaseConfig } from "../supabase/config";

/**
 * 저장 계층. 프로젝트 · 메모리 · API 키 · 커넥터 토큰 · MCP 서버는 모두 "경로 → JSON" 으로 저장한다.
 *
 * - 파일(기본): data/<경로>. 혼자 쓰는 PC 용. 사용자 구분이 없다.
 * - Supabase: 환경 변수에 Supabase 가 설정돼 있으면 app_files 테이블에 (사용자, 경로) 별로 저장한다.
 *   로그인한 사용자의 권한으로 읽고 쓰므로, DB 의 행 수준 보안(RLS)이 남의 행을 막는다.
 *
 * 스킬 · 플러그인 · 지식베이스 · 템플릿은 배포물과 함께 가는 공용 파일이라 여기를 거치지 않는다.
 */
export interface Files {
  /** 잠금 키에 붙일 구분자(사용자마다 다르다) */
  id: string;
  read(file: string): Promise<unknown | null>;
  write(file: string, value: unknown): Promise<void>;
  remove(file: string): Promise<void>;
  /** dir 바로 아래의 파일 이름들 */
  list(dir: string): Promise<string[]>;
}

const ROOT = path.join(process.cwd(), "data");
const local = (file: string) => {
  const p = path.join(ROOT, file);
  if (!p.startsWith(ROOT)) throw new Error("잘못된 경로");
  return p;
};

export const fileBackend: Files = {
  id: "local",
  async read(file) {
    try {
      return JSON.parse(await readFile(local(file), "utf8"));
    } catch {
      return null;
    }
  },
  async write(file, value) {
    await mkdir(path.dirname(local(file)), { recursive: true });
    await writeFile(local(file), JSON.stringify(value, null, 2), "utf8");
  },
  async remove(file) {
    await rm(local(file), { force: true });
  },
  async list(dir) {
    try {
      return (await readdir(local(dir), { withFileTypes: true })).filter((e) => e.isFile()).map((e) => e.name);
    } catch {
      return [];
    }
  },
};

/** supabase-js 클라이언트에서 쓰는 부분만(테스트에서 가짜로 바꿀 수 있게) */
export interface TableClient {
  from(table: string): {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [method: string]: (...args: any[]) => any;
  };
}

const TABLE = "app_files";
/** LIKE 의 와일드카드(% _)를 글자 그대로 찾게 한다 */
const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export function supabaseBackend(client: TableClient, userId: string): Files {
  const fail = (what: string, error: { message?: string } | null) => {
    if (error) throw new Error(`저장소 ${what} 실패: ${error.message ?? "알 수 없는 오류"}`);
  };
  return {
    id: `u:${userId}`,
    async read(file) {
      const { data, error } = await client.from(TABLE).select("content").eq("user_id", userId).eq("path", file).maybeSingle();
      fail("읽기", error);
      return data ? ((data as { content: unknown }).content ?? null) : null;
    },
    async write(file, value) {
      const { error } = await client.from(TABLE).upsert({ user_id: userId, path: file, content: value, updated_at: new Date().toISOString() }, { onConflict: "user_id,path" });
      fail("쓰기", error);
    },
    async remove(file) {
      const { error } = await client.from(TABLE).delete().eq("user_id", userId).eq("path", file);
      fail("지우기", error);
    },
    async list(dir) {
      const prefix = `${dir.replace(/\/+$/, "")}/`;
      const { data, error } = await client.from(TABLE).select("path").eq("user_id", userId).like("path", `${likeEscape(prefix)}%`);
      fail("목록", error);
      return ((data ?? []) as { path: string }[])
        .map((r) => r.path)
        .filter((p) => p.startsWith(prefix) && !p.slice(prefix.length).includes("/"))
        .map((p) => p.slice(prefix.length));
    },
  };
}

// ───────────────────────── 지금 요청의 저장소 ─────────────────────────

const current = new AsyncLocalStorage<Files>();

/** Supabase 가 설정돼 있으면 여러 사용자가 쓰는 서버다 */
export const multiUser = () => !!supabaseConfig();

export class AuthRequired extends Error {
  constructor() {
    super("로그인이 필요합니다.");
  }
}

/** 지금 요청이 쓸 저장소. 여러 사용자 모드에서 사용자가 정해지지 않았으면 던진다(공용 파일로 새지 않게). */
export function files(): Files {
  const bound = current.getStore();
  if (bound) return bound;
  if (multiUser()) throw new AuthRequired();
  return fileBackend;
}

/** 주어진 저장소로 fn 을 실행한다(테스트 · 백그라운드 작업) */
export const runAs = <T>(backend: Files, fn: () => Promise<T>): Promise<T> => current.run(backend, fn);

/**
 * 지금 요청의 사용자 저장소를 찾는다. 파일 모드면 null, 로그인이 없으면 401 응답.
 * 찾은 저장소는 bind() 로 요청에 묶는다.
 */
export async function signedIn(): Promise<Files | Response | null> {
  const cfg = supabaseConfig();
  if (!cfg) return null;
  const { serverClient } = await import("../supabase/server");
  const client = await serverClient();
  const { data, error } = await client.auth.getClaims();
  const userId = data?.claims?.sub;
  if (error || !userId) return Response.json({ error: "로그인이 필요합니다." }, { status: 401 });
  return supabaseBackend(client as unknown as TableClient, userId);
}

/**
 * 라우트 핸들러 맨 앞에서 `const denied = bind(await signedIn()); if (denied) return denied;` 로 쓴다.
 * 반드시 핸들러 안에서 동기로 불러야 한다. await 한 함수 안에서 enterWith 를 하면
 * 그 함수가 끝날 때 묶음이 사라져(Node 24) 핸들러의 나머지가 사용자를 잃는다.
 */
export function bind(user: Files | Response | null): Response | null {
  if (user instanceof Response) return user;
  if (user) current.enterWith(user);
  return null;
}
