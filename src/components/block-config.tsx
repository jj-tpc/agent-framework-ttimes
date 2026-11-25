"use client";

import { CircleAlert, Trash2, Ungroup } from "lucide-react";
import { useState } from "react";
import { BLOCK_COLORS, PORT, blockColor, blockWarnings, membersOf } from "@/lib/dsl/blocks";
import { graphOf } from "@/lib/dsl/edit";
import type { DifyNode, DslDoc } from "@/lib/dsl/types";
import { NodeIcon, nodeMeta } from "./node-meta";
import { Field, Help, inputCls } from "./ui";

const smallInput = `${inputCls} !py-1 !text-[13px]`;

/** 블록 배경색 고르기: 기본 팔레트 + 직접 고르기 */
export function BlockColorPicker({ value, onPick, size = 22 }: { value: string; onPick: (color: string) => void; size?: number }) {
  const custom = !BLOCK_COLORS.some((c) => c.value === value);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {BLOCK_COLORS.map((c) => (
        <button
          key={c.value}
          type="button"
          title={c.name}
          aria-label={`배경색 ${c.name}`}
          aria-pressed={value === c.value}
          onClick={() => onPick(c.value)}
          className={`shrink-0 rounded-full border border-black/10 transition ${value === c.value ? "ring-2 ring-accent ring-offset-2 ring-offset-surface" : "hover:scale-110"}`}
          style={{ background: c.value, width: size, height: size }}
        />
      ))}
      <label
        title="직접 고르기"
        className={`relative shrink-0 cursor-pointer overflow-hidden rounded-full border border-black/10 ${custom ? "ring-2 ring-accent ring-offset-2 ring-offset-surface" : ""}`}
        style={{
          width: size,
          height: size,
          background: custom ? value : "conic-gradient(#f87171, #facc15, #4ade80, #22d3ee, #818cf8, #f472b6, #f87171)",
        }}
      >
        <input type="color" value={value} onChange={(e) => onPick(e.target.value)} className="absolute inset-0 cursor-pointer opacity-0" aria-label="배경색 직접 고르기" />
      </label>
    </div>
  );
}

function NodeChip({ node, onClick }: { node: DifyNode; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-line bg-surface py-0.5 pr-2 pl-0.5 text-[12px] text-ink hover:border-accent/50"
    >
      <NodeIcon type={node.data.type} size={18} />
      <span className="truncate">{node.data.title || nodeMeta(node.data.type).label}</span>
    </button>
  );
}

function Group({ title, children, help }: { title: string; children: React.ReactNode; help?: React.ReactNode }) {
  return (
    <div className="border-b border-line px-4 py-3.5">
      <div className="mb-2.5 flex items-center gap-1 text-[12px] font-semibold tracking-wide text-ink">
        {title}
        {help && <Help label={`${title} 설명`}>{help}</Help>}
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

export function BlockConfig({
  node,
  doc,
  onChange,
  onUngroup,
  onDeleteAll,
  onSelectNode,
}: {
  node: DifyNode;
  doc: DslDoc;
  onChange: (patch: Record<string, unknown>) => void;
  onUngroup: () => void;
  onDeleteAll: () => void;
  onSelectNode: (id: string) => void;
}) {
  const { nodes, edges } = graphOf(doc);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const members = membersOf(nodes, node.id);
  const pick = (ids: string[]) => ids.map((id) => byId.get(id)).filter((n): n is DifyNode => !!n);
  const fromOutside = pick(edges.filter((e) => e.target === node.id && e.targetHandle !== PORT.exit).map((e) => e.source));
  const firstInside = pick(edges.filter((e) => e.source === node.id && e.sourceHandle === PORT.entry).map((e) => e.target));
  const lastInside = pick(edges.filter((e) => e.target === node.id && e.targetHandle === PORT.exit).map((e) => e.source));
  const toOutside = pick(edges.filter((e) => e.source === node.id && e.sourceHandle !== PORT.entry).map((e) => e.target));
  const warnings = blockWarnings(nodes, edges, node.id);
  const color = blockColor(node);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const chips = (list: DifyNode[], empty: string) =>
    list.length ? (
      <div className="flex flex-wrap gap-1">
        {list.map((n) => (
          <NodeChip key={n.id} node={n} onClick={() => onSelectNode(n.id)} />
        ))}
      </div>
    ) : (
      <span className="text-[12px] text-ink-4">{empty}</span>
    );

  return (
    <div>
      <Group title="블록">
        <Field label="이름">
          <input value={String(node.data.title ?? "")} onChange={(e) => onChange({ title: e.target.value })} className={smallInput} />
        </Field>
        <Field label="설명">
          <input value={String(node.data.desc ?? "")} onChange={(e) => onChange({ desc: e.target.value })} className={smallInput} placeholder="블록 제목 아래에 표시됩니다" />
        </Field>
        <div>
          <span className="mb-1.5 block text-[12px] font-semibold text-ink-2">배경색</span>
          <BlockColorPicker value={color} onPick={(c) => onChange({ color: c })} />
        </div>
      </Group>

      <Group title="엔트리 · 아웃 점" help="아웃 점에 연결된 노드 중 하나라도 실행되면 블록 다음 노드로 진행합니다.">
        {warnings.length > 0 && (
          <div className="flex items-start gap-1.5 rounded-lg bg-[#fef3c7] px-2.5 py-2 text-[12px] leading-snug text-[#92400e]">
            <CircleAlert size={13} className="mt-px shrink-0" />
            <span>
              {warnings.includes("엔트리 미연결") && "엔트리 점을 안쪽 첫 노드로 끌어 연결하세요. "}
              {warnings.includes("아웃 미연결") && "안쪽 마지막 노드를 아웃 점에 연결해야 블록 다음 노드가 실행됩니다."}
            </span>
          </div>
        )}
        <div className="overflow-hidden rounded-lg border border-line">
          {(
            [
              ["바깥 → 엔트리", fromOutside, "들어오는 선 없음"],
              ["엔트리 → 안쪽", firstInside, "연결 없음"],
              ["안쪽 → 아웃", lastInside, "연결 없음"],
              ["아웃 → 바깥", toOutside, "나가는 선 없음"],
            ] as const
          ).map(([label, list, empty]) => (
            <div key={label} className="grid grid-cols-[92px_minmax(0,1fr)] items-center gap-2 border-b border-line bg-surface px-3 py-2 last:border-b-0">
              <span className="text-[12px] font-medium text-ink-3">{label}</span>
              {chips([...list], empty)}
            </div>
          ))}
        </div>
      </Group>

      <Group title={`안의 노드 ${members.length}개`}>
        {members.length ? (
          chips(members, "")
        ) : (
          <span className="text-[12px] leading-snug text-ink-3">노드를 블록 영역으로 끌어다 놓거나, 블록을 선택한 채 왼쪽 위 ‘노드 추가’를 누르세요.</span>
        )}
      </Group>

      <div className="flex flex-wrap gap-2 px-4 py-4">
        <button
          type="button"
          onClick={onUngroup}
          className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 text-[12px] font-medium text-ink-2 hover:bg-paper-2"
        >
          <Ungroup size={13} />
          블록 풀기 (노드 유지)
        </button>
        {/* 되돌리기가 없으므로 안의 노드까지 지울 때는 한 번 더 확인한다 */}
        <button
          type="button"
          onClick={() => (confirmDelete || members.length === 0 ? onDeleteAll() : setConfirmDelete(true))}
          onBlur={() => setConfirmDelete(false)}
          className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[12px] font-medium ${
            confirmDelete ? "border-err bg-err text-white" : "border-err/30 text-err hover:bg-err/6"
          }`}
        >
          <Trash2 size={13} />
          {confirmDelete ? `노드 ${members.length}개까지 삭제합니다. 한 번 더 누르세요` : "블록과 안의 노드 삭제"}
        </button>
      </div>
    </div>
  );
}
