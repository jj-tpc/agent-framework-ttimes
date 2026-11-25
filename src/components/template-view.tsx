"use client";

import type { DifyNode } from "@/lib/dsl/types";
import { refLabel } from "@/lib/client/labels";
import { nodeMeta } from "./node-meta";

const PATTERN = /\{\{#([^#{}]+?)#\}\}/g;

export function RefChip({ path, nodesById }: { path: string; nodesById: Map<string, DifyNode> }) {
  const label = refLabel(path, nodesById);
  const color = label.nodeType ? nodeMeta(label.nodeType).color : "#64748b";
  return (
    <span
      title={`{{#${path}#}}`}
      className="mx-[1px] inline-flex max-w-full items-center gap-1 rounded border px-1 align-baseline font-sans text-[11px] leading-[18px] whitespace-nowrap"
      style={{ borderColor: `${color}55`, background: `${color}12`, color }}
    >
      <span className="font-semibold">{label.scope}</span>
      {label.name && (
        <>
          <span className="opacity-50">›</span>
          <span className="truncate font-mono">{label.name}</span>
        </>
      )}
    </span>
  );
}

/** {{#...#}} 참조를 칩으로 강조해서 템플릿 원문을 보여준다. */
export function TemplateView({ template, nodesById }: { template: string; nodesById: Map<string, DifyNode> }) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const m of template.matchAll(PATTERN)) {
    if (m.index! > last) parts.push(template.slice(last, m.index));
    parts.push(<RefChip key={`${m.index}`} path={m[1].trim()} nodesById={nodesById} />);
    last = m.index! + m[0].length;
  }
  if (last < template.length) parts.push(template.slice(last));
  return <div className="whitespace-pre-wrap break-words font-mono text-xs leading-[1.7] text-ink-2">{parts}</div>;
}
