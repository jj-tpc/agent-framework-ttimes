"use client";

import { LogOut } from "lucide-react";
import { useEffect, useState } from "react";

/** 로그인한 계정과 로그아웃. 로그인 없는 파일 모드에서는 아무것도 그리지 않는다 */
export function AccountButton() {
  const [email, setEmail] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/me")
      .then((r) => r.json())
      .then((j: { multiUser: boolean; email: string }) => setEmail(j.multiUser ? j.email : null))
      .catch(() => {});
  }, []);
  if (email === null) return null;
  return (
    <button
      type="button"
      title={`${email} · 로그아웃`}
      aria-label={`${email} 로그아웃`}
      onClick={async () => {
        await fetch("/api/me", { method: "DELETE" });
        window.location.replace("/login");
      }}
      className="inline-flex max-w-[11rem] shrink-0 items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[12px] font-medium text-ink-2 hover:bg-paper-2"
    >
      <span className="hidden truncate sm:inline">{email}</span>
      <LogOut size={13} className="shrink-0" />
    </button>
  );
}
