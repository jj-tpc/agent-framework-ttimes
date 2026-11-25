import { NextResponse } from "next/server";
import { serverClient } from "@/lib/supabase/server";

/** Google 로그인에서 돌아오는 곳. 코드를 세션으로 바꿔 쿠키에 넣고 첫 화면으로 보낸다 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const back = (path: string) => NextResponse.redirect(new URL(path, url.origin));
  if (!code) return back("/login");
  try {
    const supabase = await serverClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    return back(error ? "/login" : "/");
  } catch {
    return back("/login");
  }
}
