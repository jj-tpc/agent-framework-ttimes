import { connection } from "next/server";
import { supabaseConfig } from "@/lib/supabase/config";
import { serverClient } from "@/lib/supabase/server";
import { rejectCrossSite } from "@/lib/tools/guard";

/** 지금 로그인한 계정. 로그인 없는 파일 모드면 multiUser: false */
export async function GET() {
  await connection();
  if (!supabaseConfig()) return Response.json({ multiUser: false, email: "" });
  const supabase = await serverClient();
  const { data } = await supabase.auth.getClaims();
  return Response.json({ multiUser: true, email: String(data?.claims?.email ?? "") });
}

/** 로그아웃 */
export async function DELETE(req: Request) {
  const blocked = rejectCrossSite(req);
  if (blocked) return blocked;
  if (!supabaseConfig()) return Response.json({ ok: true });
  const supabase = await serverClient();
  await supabase.auth.signOut();
  return Response.json({ ok: true });
}
