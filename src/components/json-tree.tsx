"use client";

import { ChevronRight } from "lucide-react";
import { useState } from "react";

const LONG_TEXT = 140;

function Scalar({ value }: { value: unknown }) {
  const [open, setOpen] = useState(false);
  if (value === null || value === undefined) return <span className="text-ink-4 italic">null</span>;
  if (typeof value === "number") return <span className="text-[#0369a1]">{value}</span>;
  if (typeof value === "boolean") return <span className="text-[#b45309]">{String(value)}</span>;
  const s = String(value);
  const long = s.length > LONG_TEXT || s.includes("\n");
  if (!long) return <span className="text-[#15803d] break-words">&quot;{s}&quot;</span>;
  return (
    <span className="block">
      <span
        className={`block whitespace-pre-wrap break-words rounded-md border border-line bg-paper-2 px-2 py-1.5 text-ink-2 ${
          open ? "" : "max-h-[7.5em] overflow-hidden [mask-image:linear-gradient(to_bottom,black_70%,transparent)]"
        }`}
      >
        {s}
      </span>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="mt-0.5 text-[11px] font-medium text-accent hover:underline"
      >
        {open ? "접기" : `전체 보기 (${s.length.toLocaleString()}자)`}
      </button>
    </span>
  );
}

function Entry({ name, value, depth }: { name: string | null; value: unknown; depth: number }) {
  const isObj = value !== null && typeof value === "object";
  const [open, setOpen] = useState(depth < 2);
  const label = name !== null ? <span className="text-ink-2 font-medium">{name}</span> : null;

  if (!isObj) {
    return (
      <div className="flex gap-1.5 py-[3px] pl-[18px] leading-5">
        {label && <span className="shrink-0">{label}:</span>}
        <span className="min-w-0 flex-1">
          <Scalar value={value} />
        </span>
      </div>
    );
  }
  const entries = Array.isArray(value)
    ? value.map((v, i) => [String(i), v] as const)
    : Object.entries(value as Record<string, unknown>);
  const summary = Array.isArray(value) ? `[${entries.length}]` : `{${entries.length}}`;
  return (
    <div className="leading-5">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 py-[3px] text-left hover:text-ink"
      >
        <ChevronRight size={13} className={`shrink-0 text-ink-4 transition-transform ${open ? "rotate-90" : ""}`} />
        {label}
        <span className="text-ink-4">{summary}</span>
      </button>
      {open && (
        <div className="ml-[6px] border-l border-line pl-2">
          {entries.length === 0 ? (
            <div className="py-[3px] pl-[18px] text-ink-4 italic">비어 있음</div>
          ) : (
            entries.map(([k, v]) => <Entry key={k} name={k} value={v} depth={depth + 1} />)
          )}
        </div>
      )}
    </div>
  );
}

export function JsonTree({ value, rootOpen = true }: { value: unknown; rootOpen?: boolean }) {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return <div className="font-mono text-xs text-ink-4 italic">비어 있음</div>;
    return (
      <div className="font-mono text-xs">
        {entries.map(([k, v]) => (
          <Entry key={k} name={k} value={v} depth={rootOpen ? 1 : 2} />
        ))}
      </div>
    );
  }
  return (
    <div className="font-mono text-xs">
      <Entry name={null} value={value} depth={1} />
    </div>
  );
}

export function ValuePreview({ value }: { value: unknown }) {
  if (value !== null && typeof value === "object") return <JsonTree value={value} rootOpen={false} />;
  return (
    <div className="font-mono text-xs">
      <Scalar value={value} />
    </div>
  );
}
