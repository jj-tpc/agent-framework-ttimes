import { rejectCrossSite } from "@/lib/tools/guard";
import { listMcpServers, logout, removeServer, saveRemoteServer, startLogin, testMcpServer } from "@/lib/tools/mcp";
import { bind, signedIn } from "@/lib/store/backend";

export const maxDuration = 60;

/** { name, url, type?, headers? } — 원격(http/sse) 서버 등록. 로컬 명령(stdio)은 data/mcp.json 을 직접 고친다 */
export async function PUT(req: Request) {
  const denied = bind(await signedIn());
  if (denied) return denied;
  const blocked = rejectCrossSite(req);
  if (blocked) return blocked;
  const b = (await req.json().catch(() => ({}))) as { name?: string; url?: string; type?: string; headers?: Record<string, string>; auth?: string };
  try {
    await saveRemoteServer(String(b.name ?? "").trim(), { url: String(b.url ?? "").trim(), type: b.type, headers: b.headers, auth: b.auth });
    return Response.json({ servers: await listMcpServers() });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}

/**
 * { name } — 연결해서 도구 목록을 받아 본다
 * { name, action: "login" } — OAuth 로그인 주소를 받는다 · { name, action: "logout" } — 받은 토큰을 지운다
 */
export async function POST(req: Request) {
  const denied = bind(await signedIn());
  if (denied) return denied;
  const blocked = rejectCrossSite(req);
  if (blocked) return blocked;
  const b = (await req.json().catch(() => ({}))) as { name?: string; action?: string };
  const name = String(b.name ?? "");
  try {
    if (b.action === "login") return Response.json(await startLogin(name, new URL("/api/mcp/oauth/callback", req.url).toString()));
    if (b.action === "logout") {
      await logout(name);
      return Response.json({ servers: await listMcpServers() });
    }
  } catch (e) {
    return Response.json({ error: (e as Error).message.slice(0, 300) }, { status: 400 });
  }
  return Response.json(await testMcpServer(name));
}

export async function DELETE(req: Request) {
  const denied = bind(await signedIn());
  if (denied) return denied;
  const blocked = rejectCrossSite(req);
  if (blocked) return blocked;
  try {
    await removeServer(new URL(req.url).searchParams.get("name") ?? "");
    return Response.json({ servers: await listMcpServers() });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
