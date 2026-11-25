import { finishLogin } from "@/lib/tools/mcp";
import { bind, signedIn } from "@/lib/store/backend";

const page = (title: string, body: string, ok: boolean) =>
  new Response(
    `<!doctype html><html lang="ko"><meta charset="utf-8"><title>${title}</title><body style="font-family:system-ui;max-width:28rem;margin:18vh auto;padding:0 1.5rem;color:#1c1c1f"><h1 style="font-size:1.1rem;color:${ok ? "#15803d" : "#dc2626"}">${title}</h1><p style="font-size:.9rem;line-height:1.6;color:#3f3f46">${body}</p></body></html>`,
    { status: ok ? 200 : 400, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** MCP 서버의 로그인 창이 돌아오는 곳. state 로 어느 서버의 로그인인지 찾아 토큰을 저장한다 */
export async function GET(req: Request) {
  const denied = bind(await signedIn());
  if (denied) return denied;
  const q = new URL(req.url).searchParams;
  if (q.get("error")) return page("로그인하지 못했습니다", esc(`${q.get("error")} ${q.get("error_description") ?? ""}`), false);
  try {
    const name = await finishLogin(q.get("code") ?? "", q.get("state") ?? "");
    return page("로그인되었습니다", `MCP 서버 <b>${esc(name)}</b> 에 로그인했습니다. 이 창을 닫고 편집기로 돌아가 ‘연결 시험’을 눌러 보세요.`, true);
  } catch (e) {
    return page("로그인하지 못했습니다", esc((e as Error).message.slice(0, 300)), false);
  }
}
