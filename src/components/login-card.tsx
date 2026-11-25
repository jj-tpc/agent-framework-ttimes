"use client";

import { LoaderCircle, Workflow as WorkflowIcon } from "lucide-react";
import { useState } from "react";
import { browserClient } from "@/lib/supabase/browser";

/** 여러 사용자 모드의 로그인 화면. Google 계정으로 로그인하면 프로젝트 · 기억 · 커넥터가 그 계정에만 저장된다 */
export function LoginCard() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const supabase = browserClient();

  const signIn = async () => {
    if (!supabase) return;
    setBusy(true);
    setError(null);
    // 로그인은 계정 확인만 한다. Gmail · 캘린더 권한은 설정의 ‘커넥터’에서 서비스별로 따로 받는다.
    const { error } = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: `${window.location.origin}/auth/callback` } });
    if (error) {
      setError(error.message);
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-dvh items-center justify-center bg-paper px-4">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-7 shadow-[0_1px_2px_rgba(24,24,27,.05),0_16px_40px_-18px_rgba(24,24,27,.25)]">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-ink text-white">
            <WorkflowIcon size={18} />
          </span>
          <div className="text-[15px] font-bold tracking-tight text-ink">Node Trace</div>
        </div>
        <h1 className="mt-6 text-[15px] font-semibold text-ink">로그인</h1>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-3">프로젝트, 기억, 연결한 서비스는 로그인한 계정에만 저장됩니다.</p>
        {supabase ? (
          <button
            type="button"
            onClick={signIn}
            disabled={busy}
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-lg border border-line bg-surface px-3 py-2.5 text-[13px] font-semibold text-ink transition hover:bg-paper-2 disabled:opacity-50"
          >
            {busy ? <LoaderCircle size={15} className="animate-spin" /> : <GoogleMark />}
            Google 계정으로 로그인
          </button>
        ) : (
          <p className="mt-5 rounded-lg bg-paper px-3 py-2.5 text-[13px] leading-relaxed text-ink-2">이 서버는 로그인 없이 쓰도록 설정돼 있습니다.</p>
        )}
        {error && <p className="mt-3 text-[12px] leading-snug text-err">{error}</p>}
      </div>
    </main>
  );
}

function GoogleMark() {
  return (
    <svg width="15" height="15" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}
