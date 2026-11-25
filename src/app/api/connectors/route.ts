import { connection } from "next/server";
import { disconnectGoogle, googleStatus, saveGoogleClient, setGoogleDemo, startGoogleLogin, testGoogle } from "@/lib/tools/connectors/google";
import { CONNECTABLE, type ConnectableService } from "@/lib/tools/connector-catalog";
import { rejectCrossSite } from "@/lib/tools/guard";
import { bind, signedIn } from "@/lib/store/backend";

const fail = (e: unknown, status = 400) => Response.json({ error: (e as Error).message }, { status });
/** 로그인 창이 돌아올 주소. Google Cloud 콘솔의 '승인된 리디렉션 URI'에 이 값을 그대로 등록해야 한다 */
const redirectOf = (req: Request) => `${new URL(req.url).origin}/api/connectors/google/callback`;

/** 커넥터 상태. 비밀값은 내보내지 않는다 */
export async function GET(req: Request) {
  const denied = bind(await signedIn());
  if (denied) return denied;
  await connection();
  return Response.json({ google: await googleStatus(), redirectUri: redirectOf(req) });
}

/** OAuth 클라이언트 저장 */
export async function PUT(req: Request) {
  const denied = bind(await signedIn());
  if (denied) return denied;
  const blocked = rejectCrossSite(req);
  if (blocked) return blocked;
  const body = (await req.json().catch(() => ({}))) as { clientId?: string; clientSecret?: string };
  try {
    await saveGoogleClient(String(body.clientId ?? ""), String(body.clientSecret ?? ""));
    return Response.json({ google: await googleStatus() });
  } catch (e) {
    return fail(e);
  }
}

/** 로그인 시작 · 연결 확인 · 연결 끊기 · 시연 모드 */
export async function POST(req: Request) {
  const denied = bind(await signedIn());
  if (denied) return denied;
  const blocked = rejectCrossSite(req);
  if (blocked) return blocked;
  const body = (await req.json().catch(() => ({}))) as { action?: string; on?: boolean; service?: string };
  const service = CONNECTABLE.find((c) => c.id === body.service)?.id as ConnectableService | undefined;
  try {
    if (body.action === "login") {
      if (!service) return fail(new Error("연결할 서비스를 고르세요."));
      return Response.json({ url: await startGoogleLogin(redirectOf(req), service) });
    }
    if (body.action === "test") return Response.json({ ok: true, email: await testGoogle() });
    if (body.action === "logout") await disconnectGoogle(service);
    else if (body.action === "demo") await setGoogleDemo(!!body.on);
    else return fail(new Error("모르는 동작입니다."));
    return Response.json({ google: await googleStatus() });
  } catch (e) {
    // OAuth 앱이 아직 없으면 화면이 등록 폼을 펼치도록 알려 준다
    if ((e as Error).message === "OAUTH_APP_REQUIRED") return Response.json({ error: "먼저 Google OAuth 앱을 한 번 등록해야 합니다.", needsApp: true }, { status: 409 });
    return fail(e);
  }
}
