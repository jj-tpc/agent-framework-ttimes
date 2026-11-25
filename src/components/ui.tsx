"use client";

import { Info, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

export function Modal({
  title,
  onClose,
  children,
  width = "max-w-2xl",
  footer,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  width?: string;
  footer?: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  // 열릴 때 초점을 안으로 옮기고, 닫히면 열기 전 자리로 돌려준다
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    box.current?.focus();
    return () => before?.focus?.();
  }, []);
  /** Tab 이 모달 밖으로 나가지 않게 처음·끝에서 되돌린다 */
  const trap = (e: React.KeyboardEvent) => {
    if (e.key !== "Tab" || !box.current) return;
    const items = [...box.current.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')].filter(
      (el) => el.offsetParent !== null,
    );
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === box.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/35 p-4" onMouseDown={onClose}>
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={trap}
        className={`flex max-h-[88vh] w-full ${width} flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-2xl`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center border-b border-line px-5 py-3.5">
          <div id={titleId} className="text-[15px] font-semibold text-ink">{title}</div>
          <button type="button" onClick={onClose} className="ml-auto rounded-md p-1 text-ink-3 hover:bg-paper-2" aria-label="닫기">
            <X size={16} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

const BTN = {
  primary: "bg-accent text-white hover:brightness-110",
  secondary: "border border-line bg-surface text-ink-2 hover:bg-paper-2",
  danger: "bg-err text-white hover:brightness-110",
  ghost: "text-ink-3 hover:bg-paper-2 hover:text-ink",
};

export function Button({
  kind = "secondary",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { kind?: keyof typeof BTN }) {
  return (
    <button
      type="button"
      {...props}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium transition disabled:pointer-events-none disabled:opacity-40 ${BTN[kind]} ${className}`}
    />
  );
}

/**
 * ⓘ 도움말. 동작 원리처럼 "알고 싶을 때만" 필요한 설명은 화면에 늘어놓지 않고 여기에 둔다.
 * 항상 보여야 하는 것은 레이블과 상태뿐이다.
 */
export function Help({ children, label = "설명", align = "left" }: { children: ReactNode; label?: string; align?: "left" | "right" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setOpen(false);
    };
    window.addEventListener("mousedown", away);
    window.addEventListener("keydown", esc, true);
    return () => {
      window.removeEventListener("mousedown", away);
      window.removeEventListener("keydown", esc, true);
    };
  }, [open]);
  return (
    <span ref={ref} className="relative inline-flex align-middle">
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className={`inline-flex h-[18px] w-[18px] items-center justify-center rounded-full transition ${open ? "bg-accent/10 text-accent" : "text-ink-4 hover:bg-paper-2 hover:text-ink-2"}`}
      >
        <Info size={13} />
      </button>
      {open && (
        <span
          id={id}
          role="note"
          className={`absolute top-[22px] z-40 block w-[280px] max-w-[calc(100vw-48px)] rounded-lg border border-line bg-surface p-3 text-left text-[12px] font-normal leading-relaxed tracking-normal text-ink-2 shadow-[0_2px_4px_rgba(24,24,27,.06),0_12px_28px_-8px_rgba(24,24,27,.22)] ${align === "right" ? "right-0" : "left-0"}`}
        >
          {children}
        </span>
      )}
    </span>
  );
}

export function Field({ label, hint, help, children }: { label: ReactNode; hint?: ReactNode; help?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 flex items-center gap-1 text-[12px] font-semibold text-ink-2">
        {label}
        {help && <Help>{help}</Help>}
      </span>
      {children}
      {hint && <span className="mt-1 block text-[11px] leading-snug text-ink-3">{hint}</span>}
    </label>
  );
}

export const inputCls =
  "w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[13px] text-ink outline-none transition placeholder:text-ink-4 focus:border-accent focus:ring-2 focus:ring-accent/15";

export function timeAgo(ts: number) {
  const s = Math.max(1, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return "방금 전";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}분 전`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}시간 전`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}일 전`;
  return new Date(ts).toLocaleDateString("ko-KR");
}
