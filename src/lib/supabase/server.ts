import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { supabaseConfig } from "./config";

/**
 * 라우트 핸들러용 Supabase 클라이언트. 요청의 쿠키에 든 세션으로 동작한다(로그인한 사용자의 권한).
 * 세션 갱신은 proxy.ts 가 요청마다 먼저 해 둔다.
 */
export async function serverClient() {
  const cfg = supabaseConfig();
  if (!cfg) throw new Error("Supabase 가 설정되지 않았습니다.");
  const store = await cookies();
  return createServerClient(cfg.url, cfg.key, {
    cookies: {
      getAll: () => store.getAll(),
      setAll(list) {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // 응답을 이미 보내기 시작한 뒤(스트리밍)에는 쿠키를 못 쓴다. 갱신은 proxy 가 맡는다.
        }
      },
    },
  });
}
