import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { supabaseConfig } from "@/lib/supabase/config";

/**
 * 여러 사용자 모드(Supabase 설정됨)에서만 일한다.
 * 요청마다 세션을 갱신해 쿠키에 되돌려 쓰고, 로그인하지 않은 요청은 로그인 화면으로 보낸다.
 * Supabase 설정이 없으면 그대로 통과시킨다(혼자 쓰는 파일 모드).
 */
export async function proxy(request: NextRequest) {
  const cfg = supabaseConfig();
  if (!cfg) return NextResponse.next();

  let response = NextResponse.next({ request });
  const supabase = createServerClient(cfg.url, cfg.key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(list, headers) {
        for (const { name, value } of list) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of list) response.cookies.set(name, value, options);
        for (const [k, v] of Object.entries(headers ?? {})) response.headers.set(k, v);
      },
    },
  });
  const { data } = await supabase.auth.getClaims();
  const signedIn = !!data?.claims?.sub;

  const { pathname } = request.nextUrl;
  const open = pathname === "/login" || pathname.startsWith("/auth/");
  // Supabase 의 Redirect URLs 에 /auth/callback 이 빠져 있으면 로그인 코드가 Site URL(첫 화면)로 온다. 버리지 말고 콜백으로 넘긴다.
  const code = request.nextUrl.searchParams.get("code");
  if (!signedIn && code && !pathname.startsWith("/auth/") && !pathname.startsWith("/api/")) {
    const callback = request.nextUrl.clone();
    callback.pathname = "/auth/callback";
    callback.search = `?code=${encodeURIComponent(code)}`;
    return NextResponse.redirect(callback);
  }
  if (signedIn && pathname === "/login") {
    const home = request.nextUrl.clone();
    home.pathname = "/";
    home.search = "";
    return NextResponse.redirect(home);
  }
  if (signedIn || open) return response;
  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  const login = request.nextUrl.clone();
  login.pathname = "/login";
  login.search = "";
  return NextResponse.redirect(login);
}

export const config = {
  // 정적 파일은 건너뛴다
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
