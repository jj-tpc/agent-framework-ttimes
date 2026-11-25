/**
 * Supabase 설정. 두 값이 모두 있으면 여러 사용자 모드(로그인 + 사용자별 저장)로 돈다.
 * 없으면 지금까지처럼 로그인 없이 data/ 폴더의 파일에 저장한다.
 *
 * 공개 키(publishable/anon)만 쓴다. 서버도 로그인한 사용자의 권한으로 DB 를 부르므로 service_role 키는 필요 없다.
 */
export interface SupabaseConfig {
  url: string;
  key: string;
}

export function supabaseConfig(): SupabaseConfig | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return url && key ? { url, key } : null;
}
