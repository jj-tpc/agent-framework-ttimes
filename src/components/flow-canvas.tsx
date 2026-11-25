"use client";

import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  NodeResizer,
  NodeToolbar,
  Panel,
  Position,
  ReactFlow,
  type Connection,
  type Edge,
  type EdgeChangeset,
  type FinalConnectionState,
  type Node,
  type NodeChangeset,
  type NodeProps,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Brain, CircleAlert, CircleCheck, CircleX, Group, LoaderCircle, Plus, SquareDashed, Ungroup, Wrench, Braces, Search } from "lucide-react";
import { MEMORY_TOOL, readMemoryCommands, readTools } from "@/lib/tools/config";
import { createContext, memo, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  BLOCK_MIN,
  BLOCK_SIZE,
  NODE_SIZE,
  PORT,
  blockColor,
  blockWarnings,
  connectionError,
  exitIdOf,
  isBlock,
  isDarkColor,
  membersOf,
  type Placement,
  type Sizes,
} from "@/lib/dsl/blocks";
import { PALETTE, PALETTE_GROUPS } from "@/lib/dsl/edit";
import {
  MEMORY_KINDS,
  MEMORY_PORT,
  MEMORY_STORE,
  isAttachEdge,
  isMemoryBlock,
  memoryKindInfo,
  memoryOf,
  readEndId,
  readMemory,
  writeEndId,
  writeId,
  type MemoryKind,
} from "@/lib/dsl/memory";
import { SWITCH_ELSE, branchRuleSummary, readSwitch } from "@/lib/dsl/switch";
import { resolveModelConfig } from "@/lib/llm/catalog";
import type { DifyNode, Workflow } from "@/lib/dsl/types";
import type { NodeRun } from "@/lib/engine/types";
import { formatMs, refLabel } from "@/lib/client/labels";
import { needLabel, structuredNeedsOf, type StructuredNeed } from "@/lib/dsl/requirements";
import { BlockColorPicker } from "./block-config";
import { Help } from "./ui";
import { NodeIcon, nodeMeta } from "./node-meta";

type XY = { x: number; y: number };
type Rect = XY & { width: number; height: number };
type VisualState = "idle" | "running" | "succeeded" | "failed" | "unvisited";
/** partial: 블록에 들어갔지만 아웃 포인트까지 가지 않고 끝남 */
type BlockState = VisualState | "partial";

type FlowNodeData = {
  node: DifyNode;
  run?: NodeRun;
  state: VisualState;
  nodesById: Map<string, DifyNode>;
  /** LLM 노드에 붙은 메모리 모듈 이름 */
  memoryTitle?: string;
  /** 이 노드가 입력으로 요구하는 구조화 출력 */
  needs: StructuredNeed[];
};
type BlockNodeData = {
  node: DifyNode;
  state: BlockState;
  elapsedMs?: number;
  memberCount: number;
  warnings: string[];
  dropTarget: boolean;
};
type DifyFlowNodeT = Node<FlowNodeData, "dify">;
type BlockFlowNodeT = Node<BlockNodeData, "block">;
type MemoryFlowNodeT = Node<BlockNodeData, "memory">;
type FlowNode = DifyFlowNodeT | BlockFlowNodeT | MemoryFlowNodeT;

const BRANCHING = new Set(["if-else", "question-classifier", "switch"]);

interface Branch {
  id: string;
  tag: string;
  text: string;
}

function branchesOf(node: DifyNode, nodesById: Map<string, DifyNode>): Branch[] | null {
  const d = node.data as Record<string, unknown>;
  if (node.data.type === "switch") {
    const cfg = readSwitch(d);
    return [
      ...cfg.branches.map((b) => ({ id: b.id, tag: b.name || "(이름 없음)", text: branchRuleSummary(b, cfg.mode) })),
      { id: SWITCH_ELSE, tag: cfg.elseName, text: "어느 분기에도 맞지 않을 때" },
    ];
  }
  if (node.data.type === "question-classifier") {
    return ((d.classes as { id: string; name: string }[]) ?? []).map((c, i) => ({
      id: String(c.id),
      tag: `분류 ${i + 1}`,
      text: c.name || "(설명 없음)",
    }));
  }
  if (node.data.type === "if-else") {
    type Cond = { variable_selector: string[]; comparison_operator: string; value?: unknown };
    const cases: { case_id: string; conditions: Cond[]; logical_operator?: string }[] = Array.isArray(d.cases)
      ? (d.cases as never)
      : [{ case_id: "true", conditions: (d.conditions as Cond[]) ?? [], logical_operator: d.logical_operator as string }];
    const describe = (c: Cond) => {
      const l = refLabel((c.variable_selector ?? []).join("."), nodesById);
      const v = c.value !== undefined && c.value !== "" ? ` ${String(c.value)}` : "";
      return `${l.name || l.scope} ${c.comparison_operator}${v}`;
    };
    return [
      ...cases.map((c, i) => ({
        id: String(c.case_id),
        tag: i === 0 ? "IF" : "ELIF",
        text: c.conditions.map(describe).join(c.logical_operator === "or" ? " 또는 " : " 그리고 ") || "(조건 없음)",
      })),
      { id: "false", tag: "ELSE", text: "그 외" },
    ];
  }
  return null;
}

const StatusBadge = ({ state, run }: { state: VisualState; run?: NodeRun }) => {
  if (state === "running")
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-run">
        <LoaderCircle size={13} className="animate-spin" />
        실행 중
      </span>
    );
  if (state === "succeeded")
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-ok tabular-nums">
        <CircleCheck size={13} />
        {formatMs(run?.elapsedMs)}
      </span>
    );
  if (state === "failed")
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-err">
        <CircleX size={13} />
        실패
      </span>
    );
  return null;
};

const handleCls = "!h-3 !w-3 !border-2 !border-surface";

/** 카드 제목 아래 한 줄. 분기 노드는 방식(과 모델)까지 */
const STORE_OP_LABEL: Record<string, string> = {
  doc_get: "문서 읽기",
  doc_get_many: "문서 여러 개 읽기",
  doc_set: "문서 쓰기",
  doc_append: "문서에 덧붙이기",
  rec_search: "기록 검색",
  rec_similar: "비슷한 기록 찾기",
  rec_add: "기록 추가",
  rec_apply: "기록에 반영",
};

/** LLM 카드에 보여 줄 도구 요약. 켠 도구가 없으면 null */
function toolSummary(node: DifyNode): string | null {
  const t = readTools(node.data as Record<string, unknown>);
  if (!t.enabled) return null;
  const parts = [
    t.builtin.length ? `내장 ${t.builtin.length}` : "",
    t.custom.length ? `직접 만든 도구 ${t.custom.length}` : "",
    t.skills.length ? `스킬 ${t.skills.length}` : "",
    t.mcp.length ? `MCP ${t.mcp.map((m) => m.server).join(", ")}` : "",
    t.connectors.length ? `Google ${t.connectors.length}` : "",
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

function subLabel(node: DifyNode): string {
  const label = nodeMeta(node.data.type).label;
  if (node.data.type === MEMORY_STORE) {
    const op = String(node.data.op ?? "doc_get");
    const key = op.startsWith("doc_") && op !== "doc_get_many" ? ` · ${String(node.data.key ?? "").replace(/\{\{#[^.#]+\.([^#]+)#\}\}/g, "{$1}")}` : "";
    return `${STORE_OP_LABEL[op] ?? op}${key}`;
  }
  if (node.data.type === MEMORY_TOOL) return `모델이 직접 호출 · ${readMemoryCommands(node.data as Record<string, unknown>).join(" · ") || "명령 없음"}`;
  if (node.data.type === "llm" && node.data.structured_output_enabled) return `${label} · 구조화 출력`;
  if (node.data.type !== "switch") return label;
  const mode = readSwitch(node.data).mode;
  if (mode === "ai") return `${label} · AI 판단 · ${resolveModelConfig(node.data.model).model}`;
  if (mode === "code") return `${label} · 코드 (${node.data.code_language === "python3" ? "Python" : "JS"})`;
  return `${label} · 텍스트 포함`;
}

const DifyFlowNode = memo(function DifyFlowNode({ data, selected }: NodeProps<DifyFlowNodeT>) {
  const { node, run, state, nodesById, memoryTitle, needs } = data;
  const unmet = needs.filter((n) => !n.ok);
  const meta = nodeMeta(node.data.type);
  const branches = branchesOf(node, nodesById);
  const hasFailBranch = (node.data as Record<string, unknown>).error_strategy === "fail-branch";

  const ring =
    state === "running"
      ? "ring-2 ring-run/60 border-run"
      : state === "failed"
        ? "border-err/70"
        : unmet.length
          ? "border-err ring-2 ring-err/25"
          : state === "succeeded"
            ? "border-ok/45"
            : "border-line-2";

  return (
    <div
      className={`w-[236px] rounded-xl border bg-surface shadow-[0_1px_2px_rgba(24,24,27,.06),0_4px_14px_-6px_rgba(24,24,27,.12)] transition-[opacity,box-shadow] ${ring} ${
        state === "unvisited" ? "opacity-40" : ""
      } ${selected ? "outline-2 outline-offset-2 outline-accent" : ""}`}
    >
      {node.data.type !== "start" && node.data.type !== MEMORY_TOOL && (
        <Handle type="target" id="target" position={Position.Left} className={`${handleCls} !bg-ink-4`} />
      )}
      <div className="flex items-center gap-2 px-2.5 pt-2.5 pb-2">
        <NodeIcon type={node.data.type} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold leading-tight text-ink">{node.data.title || meta.label}</div>
          <div className="truncate text-[11px] leading-tight text-ink-3">{subLabel(node)}</div>
        </div>
        <StatusBadge state={state} run={run} />
      </div>

      {branches ? (
        <div className="space-y-1 px-2.5 pb-2.5">
          {branches.map((b) => {
            const chosen = run?.selectedHandle === b.id;
            return (
              <div
                key={b.id}
                className={`relative flex items-start gap-1.5 rounded-md border px-2 py-1 text-[11px] leading-snug ${
                  chosen ? "border-run/40 bg-run/8 text-ink" : "border-transparent bg-paper-2 text-ink-3"
                }`}
              >
                <span className={`max-w-[55%] shrink-0 truncate font-semibold ${chosen ? "text-run" : "text-ink-2"}`}>{b.tag}</span>
                <span className="line-clamp-2 min-w-0">{b.text}</span>
                <Handle
                  type="source"
                  id={b.id}
                  position={Position.Right}
                  className={`${handleCls} !-right-[16px]`}
                  style={{ background: chosen ? "var(--color-run)" : meta.color }}
                />
              </div>
            );
          })}
        </div>
      ) : (
        <>
          {node.data.desc ? (
            <div className="line-clamp-2 px-2.5 pb-2.5 text-[11px] leading-snug text-ink-3">{String(node.data.desc)}</div>
          ) : null}
          {node.data.type !== "end" && node.data.type !== MEMORY_TOOL && (
            <Handle type="source" id="source" position={Position.Right} className={handleCls} style={{ background: meta.color }} />
          )}
        </>
      )}
      {needs.length > 0 && (
        <div
          title={unmet.length ? unmet.map((n) => n.reason).join("\n") : "앞 노드의 구조화 출력을 입력으로 씁니다"}
          className={`mx-2.5 mb-2.5 rounded-md px-2 py-1 text-[11px] leading-snug ${unmet.length ? "bg-err/8 text-err" : "bg-paper-2 text-ink-3"}`}
        >
          <div className="flex items-center gap-1.5">
            <Braces size={12} className="shrink-0" />
            <span className="truncate">
              <span className="font-semibold">구조화 출력 필요</span> · {needs.map(needLabel).join(", ")}
            </span>
          </div>
          {unmet.map((n) => (
            <div key={`${n.sourceId}.${n.field ?? ""}`} className="mt-0.5 pl-[18px]">
              {n.reason}
            </div>
          ))}
        </div>
      )}
      {hasFailBranch && (
        <div className="relative mx-2.5 mb-2.5 rounded-md bg-err/8 px-2 py-1 text-[11px] text-err">
          실패 시 분기
          <Handle type="source" id="fail-branch" position={Position.Right} className={`${handleCls} !-right-[16px] !bg-err`} />
        </div>
      )}
      {node.data.type === "llm" && toolSummary(node) && (
        <div className="mx-2.5 mb-2.5 flex items-center gap-1.5 rounded-md bg-[#e0e7ff] px-2 py-1 text-[11px] text-[#3730a3]">
          <Wrench size={12} className="shrink-0" />
          <span className="truncate">{toolSummary(node)}</span>
        </div>
      )}
      {node.data.type === "llm" && (
        <>
          {memoryTitle && (
            <div className="mx-2.5 mb-2.5 flex items-center gap-1.5 rounded-md bg-[#fce7f3] px-2 py-1 text-[11px] text-[#9d174d]">
              <Brain size={12} className="shrink-0" />
              <span className="truncate">{memoryTitle}</span>
            </div>
          )}
          <Handle
            type="target"
            id={MEMORY_PORT.llm}
            position={Position.Bottom}
            title="메모리 점. 메모리 모듈 위쪽 점을 여기로 끌어 붙입니다"
            className="!h-3 !w-3 !rotate-45 !rounded-[2px] !border-2 !border-surface !bg-[#be185d]"
          />
        </>
      )}
    </div>
  );
});

// ───────────────────────── 블록 ─────────────────────────

interface BlockActions {
  rename: (id: string, title: string) => void;
  recolor: (id: string, color: string) => void;
  resizeEnd: (id: string, rect: Rect) => void;
  ungroup: (id: string) => void;
}
const BlockActionsContext = createContext<BlockActions | null>(null);

/**
 * 블록 벽에 걸친 포트. 바깥쪽 점과 안쪽 점이 한 쌍이다.
 * 엔트리: 바깥 선이 왼쪽 점(in)으로 들어와 오른쪽 점(entry)에서 안쪽 첫 노드로 나간다.
 * 아웃: 안쪽 마지막 노드가 왼쪽 점(exit)으로 들어와 오른쪽 점(out)에서 바깥으로 나간다.
 */
function Port({ side }: { side: "entry" | "out" }) {
  const entry = side === "entry";
  return (
    <div className={`absolute top-1/2 -translate-y-1/2 ${entry ? "left-0 -translate-x-1/2" : "right-0 translate-x-1/2"}`}>
      <div
        title={entry ? "엔트리 점. 바깥 선은 왼쪽 점으로, 안쪽 첫 노드는 오른쪽 점에서 연결" : "아웃 점. 안쪽 마지막 노드는 왼쪽 점으로, 바깥 노드는 오른쪽 점에서 연결"}
        className="relative flex h-[26px] items-center rounded-full border border-line-2 bg-surface px-3 text-[11px] font-semibold tracking-wide whitespace-nowrap text-ink-2 shadow-sm"
      >
        {entry ? "엔트리" : "아웃"}
        <Handle type="target" id={entry ? PORT.in : PORT.exit} position={Position.Left} className={`${handleCls} !bg-ink-4`} />
        <Handle type="source" id={entry ? PORT.entry : PORT.out} position={Position.Right} className={`${handleCls} !bg-ink-2`} />
      </div>
    </div>
  );
}

function BlockStatus({ state, elapsedMs, partialLabel = "아웃까지 가지 않음" }: { state: BlockState; elapsedMs?: number; partialLabel?: string }) {
  const pill = "inline-flex items-center gap-1 rounded-full bg-surface/90 px-2 py-0.5 text-[11px] font-medium shadow-sm";
  if (state === "running")
    return (
      <span className={`${pill} text-run`}>
        <LoaderCircle size={12} className="animate-spin" />
        실행 중
      </span>
    );
  if (state === "succeeded")
    return (
      <span className={`${pill} text-ok tabular-nums`}>
        <CircleCheck size={12} />
        {formatMs(elapsedMs)}
      </span>
    );
  if (state === "failed")
    return (
      <span className={`${pill} text-err`}>
        <CircleX size={12} />
        실패
      </span>
    );
  if (state === "partial") return <span className={`${pill} text-[#b45309]`}>{partialLabel}</span>;
  return null;
}

const BlockFlowNode = memo(function BlockFlowNode({ id, data, selected }: NodeProps<BlockFlowNodeT>) {
  const { node, state, elapsedMs, memberCount, warnings, dropTarget } = data;
  const actions = useContext(BlockActionsContext);
  const [editing, setEditing] = useState(false);
  const color = blockColor(node);
  const dark = isDarkColor(color);
  const ink = dark ? "#fafafa" : "#1c1c1f";
  const sub = dark ? "rgba(250,250,250,.72)" : "rgba(28,28,31,.58)";
  const title = node.data.title || "블록";

  const borderColor = dropTarget
    ? "var(--color-accent)"
    : state === "running"
      ? "var(--color-run)"
      : state === "failed"
        ? "var(--color-err)"
        : selected
          ? "var(--color-accent)"
          : `color-mix(in oklab, ${color} 62%, ${dark ? "#ffffff" : "#1c1c1f"})`;
  const glow = dropTarget ? "var(--color-accent)" : state === "running" ? "var(--color-run)" : null;

  return (
    <div
      className={`relative h-full w-full rounded-2xl border-2 transition-[opacity,box-shadow] ${state === "unvisited" ? "opacity-50" : ""}`}
      style={{
        background: color,
        borderColor,
        borderStyle: dropTarget ? "dashed" : "solid",
        boxShadow: glow ? `0 0 0 5px color-mix(in srgb, ${glow} 16%, transparent)` : undefined,
      }}
    >
      <NodeResizer
        isVisible={selected}
        minWidth={BLOCK_MIN.width}
        minHeight={BLOCK_MIN.height}
        color="var(--color-accent)"
        handleClassName="!h-2.5 !w-2.5 !rounded-[3px] !border-[1.5px] !border-accent !bg-surface"
        onResizeEnd={(_, p) => actions?.resizeEnd(id, p)}
      />
      <NodeToolbar isVisible={selected && !editing} position={Position.Top} align="start" offset={10}>
        <div className="nodrag nopan flex items-center gap-2 rounded-xl border border-line bg-surface py-1.5 pr-1.5 pl-2.5 shadow-lg">
          <button
            type="button"
            onClick={() => actions?.ungroup(id)}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[12px] font-medium text-ink-2 hover:bg-paper-2"
            title="블록만 없애고 안의 노드는 남깁니다"
          >
            <Ungroup size={13} />
            블록 풀기
          </button>
        </div>
      </NodeToolbar>

      <div className="flex items-center gap-2 px-3.5 pt-2.5" style={{ color: ink }}>
        <SquareDashed size={14} className="shrink-0" style={{ color: sub }} />
        {editing ? (
          <input
            autoFocus
            defaultValue={title}
            aria-label="블록 이름"
            className="nodrag nopan min-w-0 flex-1 rounded-md bg-surface px-1.5 py-0.5 text-[13px] font-semibold text-ink outline-2 outline-accent"
            onFocus={(e) => e.currentTarget.select()}
            onBlur={(e) => {
              setEditing(false);
              const v = e.currentTarget.value.trim();
              if (v && v !== title) actions?.rename(id, v);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") {
                e.currentTarget.value = title;
                e.currentTarget.blur();
              }
            }}
          />
        ) : (
          <span onDoubleClick={() => setEditing(true)} title="더블클릭해서 이름 바꾸기" className="min-w-0 truncate text-[13px] font-semibold">
            {title}
          </span>
        )}
        {!editing && (
          <span className="shrink-0 text-[11px]" style={{ color: sub }}>
            노드 {memberCount}개
          </span>
        )}
        {warnings.map((w) => (
          <span key={w} className="inline-flex shrink-0 items-center gap-1 rounded-full bg-surface/90 px-1.5 py-px text-[11px] font-medium text-[#b45309]">
            <CircleAlert size={11} />
            {w}
          </span>
        ))}
        <span className="ml-auto shrink-0">
          <BlockStatus state={state} elapsedMs={elapsedMs} />
        </span>
      </div>
      {node.data.desc ? (
        <div className="truncate px-3.5 pt-0.5 pl-[36px] text-[11px]" style={{ color: sub }}>
          {String(node.data.desc)}
        </div>
      ) : null}

      {memberCount === 0 && (
        <div className="pointer-events-none absolute inset-x-10 top-1/2 -translate-y-1/2 text-center text-[12px] leading-relaxed" style={{ color: sub }}>
          노드를 이 영역으로 끌어다 놓거나
          <br />
          블록을 선택한 채 ‘노드 추가’를 누르세요
        </div>
      )}

      <Port side="entry" />
      <Port side="out" />
    </div>
  );
});

// ───────────────────────── 메모리 모듈 ─────────────────────────

/** 구역 시작·끝 포트. 벽에 걸친 알약 모양 */
function ZonePort({ side, zone, top }: { side: "start" | "end"; zone: "read" | "write"; top: number }) {
  const start = side === "start";
  const label = `${zone === "read" ? "읽기" : "쓰기"} ${start ? "시작" : "끝"}`;
  const id = zone === "read" ? (start ? MEMORY_PORT.read : MEMORY_PORT.readEnd) : start ? MEMORY_PORT.write : MEMORY_PORT.writeEnd;
  return (
    <div className={`absolute -translate-y-1/2 ${start ? "left-0 -translate-x-1/2" : "right-0 translate-x-1/2"}`} style={{ top }}>
      <div
        title={start ? `${label} — 오른쪽 점에서 이 구역의 첫 노드로 연결` : `${label} — 이 구역의 마지막 노드를 왼쪽 점에 연결`}
        className="relative flex h-[26px] items-center rounded-full border border-line-2 bg-surface px-2.5 text-[11px] font-semibold tracking-wide whitespace-nowrap text-ink-2 shadow-sm"
      >
        {label}
        {start ? (
          <Handle type="source" id={id} position={Position.Right} className={`${handleCls} !bg-ink-2`} />
        ) : (
          <Handle type="target" id={id} position={Position.Left} className={`${handleCls} !bg-ink-4`} />
        )}
      </div>
    </div>
  );
}

const MemoryFlowNode = memo(function MemoryFlowNode({ id, data, selected, height }: NodeProps<MemoryFlowNodeT>) {
  const { node, state, elapsedMs, memberCount, warnings, dropTarget } = data;
  const actions = useContext(BlockActionsContext);
  const [editing, setEditing] = useState(false);
  const cfg = readMemory(node);
  const info = memoryKindInfo(cfg.kind);
  const color = blockColor(node);
  const dark = isDarkColor(color);
  const ink = dark ? "#fafafa" : "#1c1c1f";
  const sub = dark ? "rgba(250,250,250,.72)" : "rgba(28,28,31,.58)";
  const line = dark ? "rgba(250,250,250,.4)" : "rgba(28,28,31,.26)";
  const title = node.data.title || "메모리 모듈";
  const h = height ?? node.height ?? 400;
  const split = Math.min(Math.max(cfg.split, 120), h - 80);
  const readY = Math.max(72, split - 104);
  const writeY = Math.min(h - 40, split + 80);
  const attached = !warnings.includes("LLM 미연결");

  const borderColor = dropTarget
    ? "var(--color-accent)"
    : state === "running"
      ? "var(--color-run)"
      : state === "failed"
        ? "var(--color-err)"
        : selected
          ? "var(--color-accent)"
          : `color-mix(in oklab, ${color} 62%, ${dark ? "#ffffff" : "#1c1c1f"})`;
  const glow = dropTarget ? "var(--color-accent)" : state === "running" ? "var(--color-run)" : null;

  return (
    <div
      className={`relative h-full w-full rounded-2xl border-2 transition-[opacity,box-shadow] ${state === "unvisited" || !attached ? "opacity-60" : ""}`}
      style={{
        background: color,
        borderColor,
        borderStyle: dropTarget || !attached ? "dashed" : "solid",
        boxShadow: glow ? `0 0 0 5px color-mix(in srgb, ${glow} 16%, transparent)` : undefined,
      }}
    >
      <NodeResizer
        isVisible={selected}
        minWidth={BLOCK_MIN.width}
        minHeight={split + 120}
        color="var(--color-accent)"
        handleClassName="!h-2.5 !w-2.5 !rounded-[3px] !border-[1.5px] !border-accent !bg-surface"
        onResizeEnd={(_, p) => actions?.resizeEnd(id, p)}
      />
      <NodeToolbar isVisible={selected && !editing} position={Position.Top} align="start" offset={22}>
        <div className="nodrag nopan flex items-center gap-2 rounded-xl border border-line bg-surface px-2.5 py-1.5 shadow-lg">
          <BlockColorPicker value={color} onPick={(c) => actions?.recolor(id, c)} size={18} />
        </div>
      </NodeToolbar>

      {/* LLM 노드에 붙이는 단자 */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2">
        <div
          title="이 점을 LLM 노드 아래쪽 메모리 점으로 끌어 붙입니다. 선을 지우면 LLM 은 메모리 없이 동작합니다."
          className={`relative flex h-[24px] items-center gap-1 rounded-full border bg-surface px-2.5 text-[11px] font-semibold whitespace-nowrap shadow-sm ${
            attached ? "border-[#f9a8d4] text-[#9d174d]" : "border-[#fcd34d] text-[#b45309]"
          }`}
        >
          <Brain size={11} />
          {attached ? "LLM 에 붙음" : "LLM 에 붙이기"}
          <Handle
            type="source"
            id={MEMORY_PORT.attach}
            position={Position.Top}
            className="!h-3 !w-3 !rotate-45 !rounded-[2px] !border-2 !border-surface !bg-[#be185d]"
          />
        </div>
      </div>

      <div className="flex items-center gap-2 px-3.5 pt-3.5" style={{ color: ink }}>
        <Brain size={14} className="shrink-0" style={{ color: sub }} />
        {editing ? (
          <input
            autoFocus
            defaultValue={title}
            aria-label="메모리 모듈 이름"
            className="nodrag nopan min-w-0 flex-1 rounded-md bg-surface px-1.5 py-0.5 text-[13px] font-semibold text-ink outline-2 outline-accent"
            onFocus={(e) => e.currentTarget.select()}
            onBlur={(e) => {
              setEditing(false);
              const v = e.currentTarget.value.trim();
              if (v && v !== title) actions?.rename(id, v);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") {
                e.currentTarget.value = title;
                e.currentTarget.blur();
              }
            }}
          />
        ) : (
          <span onDoubleClick={() => setEditing(true)} title="더블클릭해서 이름 바꾸기" className="min-w-0 truncate text-[13px] font-semibold">
            {title}
          </span>
        )}
        {!editing && (
          <span className="shrink-0 truncate text-[11px]" style={{ color: sub }}>
            {info.horizon} · 저장소 ‘{cfg.store}’ · 노드 {memberCount}개
          </span>
        )}
        {warnings
          .filter((w) => w !== "LLM 미연결")
          .map((w) => (
            <span key={w} className="inline-flex shrink-0 items-center gap-1 rounded-full bg-surface/90 px-1.5 py-px text-[11px] font-medium text-[#b45309]">
              <CircleAlert size={11} />
              {w}
            </span>
          ))}
        <span className="ml-auto shrink-0">
          <BlockStatus state={state} elapsedMs={elapsedMs} partialLabel="쓰기까지 가지 않음" />
        </span>
      </div>

      {/* 구역 이름과 나누는 선 */}
      <div className="pointer-events-none absolute left-4 text-[11px] font-semibold tracking-wide" style={{ top: 42, color: sub }}>
        읽기 — LLM 호출 전에 실행 · 결과가 프롬프트에 들어감
      </div>
      <div className="pointer-events-none absolute inset-x-0 border-t-[1.5px] border-dashed" style={{ top: split, borderColor: line }} />
      <div className="pointer-events-none absolute left-4 text-[11px] font-semibold tracking-wide" style={{ top: split + 8, color: sub }}>
        쓰기 — LLM 응답 뒤에 실행 · 답변은 기다리지 않고 나감
      </div>

      <ZonePort side="start" zone="read" top={readY} />
      <ZonePort side="end" zone="read" top={readY} />
      <ZonePort side="start" zone="write" top={writeY} />
      <ZonePort side="end" zone="write" top={writeY} />
    </div>
  );
});

const nodeTypes = { dify: DifyFlowNode, block: BlockFlowNode, memory: MemoryFlowNode };

/** 노드 제목(13px)이 읽히는 가장 작은 배율. 처음 맞출 때 이보다 작아지면 여기서 멈춘다. */
const MIN_READABLE_ZOOM = 0.6;

// ───────────────────────── 노드 추가 메뉴 ─────────────────────────

interface MenuItem {
  type: string;
  label: string;
  sub: string;
  group: string;
}

/** 노드 추가: 묶음으로 나눠 보여 주고, 글자를 치면 바로 걸러진다. Enter 는 첫 항목. */
function AddNodeMenu({ onPick, where }: { onPick: (type: string) => void; where: string }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as globalThis.Node) && setOpen(false);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);

  const items: MenuItem[] = useMemo(
    () => [
      ...PALETTE.map((p) => ({ type: p.type, label: nodeMeta(p.type).label, sub: p.hint, group: p.group as string })),
      { type: "block", label: "블록", sub: "노드를 묶는 영역", group: "흐름" },
      ...MEMORY_KINDS.map((k) => ({ type: `memory:${k.kind}`, label: k.name, sub: `${k.hint} · ${k.horizon}`, group: "메모리 모듈" })),
    ],
    [],
  );
  const needle = q.trim().toLowerCase();
  const shown = needle ? items.filter((i) => `${i.label} ${i.sub} ${i.type}`.toLowerCase().includes(needle)) : items;
  const groups = [...PALETTE_GROUPS.slice(0, 4), "메모리 모듈", PALETTE_GROUPS[4]].filter((g) => shown.some((i) => i.group === g));
  const pick = (type: string) => {
    setOpen(false);
    setQ("");
    onPick(type);
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[13px] font-semibold text-ink shadow-sm hover:bg-paper-2"
      >
        <Plus size={14} />
        노드 추가
      </button>
      {open && (
        <div className="absolute top-full left-0 z-20 mt-1.5 w-72 overflow-hidden rounded-xl border border-line bg-surface shadow-xl">
          <label className="flex items-center gap-2 border-b border-line px-3 py-2">
            <Search size={14} className="shrink-0 text-ink-3" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && shown[0]) pick(shown[0].type);
                if (e.key === "Escape") setOpen(false);
              }}
              placeholder="노드 찾기"
              aria-label="노드 찾기"
              className="w-full bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-4"
            />
          </label>
          <div className="max-h-[60vh] overflow-auto py-1" role="menu">
            {groups.map((g) => (
              <div key={g} className="pb-1">
                <div className="px-3 pt-2 pb-1 text-[11px] font-semibold text-ink-3">{g}</div>
                {shown
                  .filter((i) => i.group === g)
                  .map((i) => (
                    <button
                      key={i.type}
                      type="button"
                      role="menuitem"
                      onClick={() => pick(i.type)}
                      className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left hover:bg-paper-2 focus-visible:bg-paper-2"
                    >
                      <NodeIcon type={i.type.startsWith("memory:") ? "memory" : i.type} size={22} />
                      <span className="min-w-0">
                        <span className="block text-[13px] font-medium text-ink">{i.label}</span>
                        <span className="block truncate text-[11px] text-ink-3">{i.sub}</span>
                      </span>
                    </button>
                  ))}
              </div>
            ))}
            {shown.length === 0 && <div className="px-3 py-4 text-center text-[12px] text-ink-3">‘{q}’에 맞는 노드가 없습니다</div>}
          </div>
          <div className="border-t border-line bg-paper px-3 py-1.5 text-[11px] text-ink-3">추가 위치 · {where}</div>
        </div>
      )}
    </div>
  );
}

// ───────────────────────── 캔버스 ─────────────────────────

export interface CanvasEditHandlers {
  /** 드래그가 끝났을 때 위치·소속 블록 반영 */
  onPlaceNodes: (moves: Placement[], sizes: Sizes) => void;
  onDeleteNodes: (ids: string[]) => void;
  onConnect: (c: { source: string; sourceHandle: string | null; target: string; targetHandle: string | null }) => void;
  onDeleteEdges: (ids: string[]) => void;
  onAddNode: (type: string, position: XY, opts?: { connectFrom?: { id: string; handle: string }; parentId?: string }) => void;
  onAddBlock: (position: XY) => void;
  /** 메모리 모듈 추가. llmId 를 주면 그 LLM 노드에 바로 붙인다 */
  onAddMemory: (kind: MemoryKind, position: XY, llmId?: string) => void;
  onGroup: (ids: string[], sizes: Sizes) => void;
  onUpdateNodeData: (id: string, patch: Record<string, unknown>) => void;
  onResizeBlock: (id: string, rect: Rect, sizes: Sizes) => void;
  onUngroup: (id: string) => void;
}

export function FlowCanvas({
  workflow,
  runs,
  finished,
  selectedNodeId,
  onSelectNode,
  focusRequest,
  edit,
}: {
  workflow: Workflow;
  runs: NodeRun[];
  finished: boolean;
  selectedNodeId?: string;
  onSelectNode: (nodeId: string) => void;
  /** 바뀔 때마다 해당 노드와 이웃이 보이도록 화면을 맞춘다 */
  focusRequest?: { nodeId: string; nonce: number };
  edit: CanvasEditHandlers;
}) {
  const nodesById = useMemo(() => new Map(workflow.nodes.map((n) => [n.id, n])), [workflow]);
  const runByNode = useMemo(() => new Map(runs.map((r) => [r.nodeId, r])), [runs]);
  const blocks = useMemo(() => workflow.nodes.filter(isBlock), [workflow]);
  const blockIds = useMemo(() => new Set(blocks.map((b) => b.id)), [blocks]);

  /** 드래그·크기 조절 중인 노드의 임시 위치/크기. 끝나면 문서에 반영하고 지운다. */
  const [overrides, setOverrides] = useState<Record<string, Partial<Rect>>>({});
  /** xyflow 선택 상태(Shift+드래그, Ctrl+클릭으로 여러 개) */
  const [multi, setMulti] = useState<Set<string>>(new Set());
  const [selectedEdges, setSelectedEdges] = useState<Set<string>>(new Set());
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const instance = useRef<ReactFlowInstance<FlowNode, Edge> | null>(null);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 3200);
    return () => clearTimeout(t);
  }, [notice]);

  const rectOf = (b: DifyNode): Rect => {
    const ov = overrides[b.id];
    return {
      x: ov?.x ?? b.position?.x ?? 0,
      y: ov?.y ?? b.position?.y ?? 0,
      width: ov?.width ?? b.width ?? BLOCK_SIZE.width,
      height: ov?.height ?? b.height ?? BLOCK_SIZE.height,
    };
  };

  /**
   * xyflow 가 잰 노드 크기. 노드 객체는 끌 때마다 새로 만들어지는데, 잰 크기를 함께 넘기지 않으면
   * xyflow 가 "아직 재지 않은 노드"로 보고 다시 잴 때까지 노드와 선을 숨긴다(끄는 동안 글씨·선이 사라지던 원인).
   */
  const [measured, setMeasured] = useState<Record<string, { width: number; height: number }>>({});

  const nodes: FlowNode[] = useMemo(() => {
    const isSel = (id: string) => id === selectedNodeId || multi.has(id);
    const out: FlowNode[] = [];
    // 블록(부모)을 안쪽 노드보다 먼저 둔다
    for (const b of blocks) {
      const ov = overrides[b.id];
      const mem = isMemoryBlock(b);
      const entry = runByNode.get(b.id);
      const exit = runByNode.get(mem ? writeEndId(b.id) : exitIdOf(b.id));
      const members = membersOf(workflow.nodes, b.id);
      let state: BlockState;
      if (!entry) state = runs.length > 0 && finished ? "unvisited" : "idle";
      else if (exit?.status === "succeeded") state = "succeeded";
      else if (entry.status === "failed" || exit?.status === "failed" || members.some((m) => runByNode.get(m.id)?.status === "failed")) state = "failed";
      else state = finished ? "partial" : "running";
      out.push({
        id: b.id,
        type: mem ? "memory" : "block",
        position: { x: ov?.x ?? b.position?.x ?? 0, y: ov?.y ?? b.position?.y ?? 0 },
        width: ov?.width ?? b.width ?? BLOCK_SIZE.width,
        height: ov?.height ?? b.height ?? BLOCK_SIZE.height,
        selected: isSel(b.id),
        ...(measured[b.id] ? { measured: measured[b.id] } : {}),
        data: {
          node: b,
          state,
          elapsedMs: entry && exit?.finishedAt ? exit.finishedAt - entry.startedAt : undefined,
          memberCount: members.length,
          warnings: blockWarnings(workflow.nodes, workflow.edges, b.id),
          dropTarget: dropTarget === b.id,
        },
      });
    }
    for (const n of workflow.nodes) {
      if (isBlock(n) || (n.parentId && !blockIds.has(n.parentId))) continue;
      const ov = overrides[n.id];
      const run = runByNode.get(n.id);
      const state: VisualState = run ? run.status : runs.length > 0 && finished && n.data.type !== MEMORY_TOOL ? "unvisited" : "idle";
      out.push({
        id: n.id,
        type: "dify",
        position: { x: ov?.x ?? n.position?.x ?? 0, y: ov?.y ?? n.position?.y ?? 0 },
        ...(n.parentId ? { parentId: n.parentId } : {}),
        selected: isSel(n.id),
        ...(measured[n.id] ? { measured: measured[n.id] } : {}),
        deletable: n.data.type !== "start",
        data: {
          node: n,
          run,
          state,
          nodesById,
          needs: structuredNeedsOf(n, nodesById),
          ...(n.data.type === "llm" ? { memoryTitle: nodesById.get(memoryOf(workflow.edges, n.id) ?? "")?.data.title } : {}),
        },
      });
    }
    return out;
  }, [workflow, blocks, blockIds, runByNode, runs.length, finished, selectedNodeId, multi, nodesById, overrides, dropTarget, measured]);

  const edges: Edge[] = useMemo(() => {
    // 블록 포트의 실행 여부: entry·in 쪽은 블록 진입 기록, exit·out 쪽은 블록 종료 기록으로 판단
    const runAt = (id: string, handle: string, side: "source" | "target") => {
      if (!blockIds.has(id)) return runByNode.get(id);
      if (isMemoryBlock(nodesById.get(id))) {
        if (handle === MEMORY_PORT.write) return runByNode.get(writeId(id));
        if (handle === MEMORY_PORT.readEnd) return runByNode.get(readEndId(id));
        if (handle === MEMORY_PORT.writeEnd) return runByNode.get(writeEndId(id));
        return runByNode.get(id);
      }
      const exitSide = side === "source" ? handle !== PORT.entry : handle === PORT.exit;
      return runByNode.get(exitSide ? exitIdOf(id) : id);
    };
    return workflow.edges.map((e) => {
      const sh = e.sourceHandle ?? "source";
      const th = e.targetHandle ?? "target";
      const s = runAt(e.source, sh, "source");
      const t = runAt(e.target, th, "target");
      const sourceType = nodesById.get(e.source)?.data.type ?? "";
      const taken = !!s && !!t && (!BRANCHING.has(sourceType) || s.selectedHandle === sh);
      const active = taken && t?.status === "running";
      const dimmed = runs.length > 0 && !taken;
      const sel = selectedEdges.has(e.id!);
      if (isAttachEdge(e)) {
        // 부착 선: 흐름이 아니라 '이 LLM 이 이 메모리를 쓴다'는 표시
        return {
          id: e.id!,
          source: e.source,
          target: e.target,
          sourceHandle: sh,
          targetHandle: th,
          selected: sel,
          interactionWidth: 18,
          animated: active,
          style: { stroke: sel ? "var(--color-accent)" : "#be185d", strokeWidth: sel ? 2.75 : 2, strokeDasharray: "2 5", strokeLinecap: "round" as const, opacity: dimmed ? 0.45 : 1 },
          zIndex: 1,
        };
      }
      return {
        id: e.id!,
        source: e.source,
        target: e.target,
        sourceHandle: sh,
        targetHandle: th,
        animated: active,
        selected: sel,
        interactionWidth: 18,
        style: {
          stroke: sel ? "var(--color-accent)" : taken ? "var(--color-run)" : dimmed ? "var(--color-line-2)" : "var(--color-ink-4)",
          strokeWidth: sel ? 2.75 : taken ? 2.25 : 1.6,
          strokeDasharray: dimmed && !sel ? "5 5" : undefined,
        },
        zIndex: taken || sel ? 1 : 0,
      };
    });
  }, [workflow, runByNode, nodesById, blockIds, runs.length, selectedEdges]);

  // 채팅의 실행 과정에서 노드를 고르면 그 노드와 이웃 노드가 보이도록 이동
  useEffect(() => {
    const rf = instance.current;
    if (!rf || !focusRequest) return;
    const ids = new Set([focusRequest.nodeId]);
    for (const e of workflow.edges) {
      if (e.source === focusRequest.nodeId) ids.add(e.target);
      if (e.target === focusRequest.nodeId) ids.add(e.source);
    }
    rf.fitView({ nodes: [...ids].map((id) => ({ id })), padding: 0.25, maxZoom: 1, duration: 350 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRequest?.nonce]);

  // 설정 패널이 열려 캔버스가 좁아지면, 고른 노드(와 들어갈 수 있으면 이웃)가 가려지지 않게 옆으로 민다
  useEffect(() => {
    const el = wrap.current;
    if (!el || !selectedNodeId) return;
    const reveal = () => {
      const rf = instance.current;
      const me = rf?.getInternalNode(selectedNodeId);
      if (!rf || !me) return;
      const vp = rf.getViewport();
      const box = (id: string) => {
        const n = rf.getInternalNode(id);
        if (!n) return null;
        const w = n.measured?.width ?? NODE_SIZE.width;
        const h = n.measured?.height ?? NODE_SIZE.height;
        return { l: n.internals.positionAbsolute.x * vp.zoom + vp.x, t: n.internals.positionAbsolute.y * vp.zoom + vp.y, r: (n.internals.positionAbsolute.x + w) * vp.zoom + vp.x, b: (n.internals.positionAbsolute.y + h) * vp.zoom + vp.y };
      };
      const own = box(selectedNodeId)!;
      const around = workflow.edges
        .filter((e) => e.source === selectedNodeId || e.target === selectedNodeId)
        .map((e) => box(e.source === selectedNodeId ? e.target : e.source))
        .filter((b): b is NonNullable<typeof b> => !!b);
      const pad = 32;
      const W = el.clientWidth;
      const H = el.clientHeight;
      const all = [own, ...around];
      const wide = { l: Math.min(...all.map((b) => b.l)), r: Math.max(...all.map((b) => b.r)), t: Math.min(...all.map((b) => b.t)), b: Math.max(...all.map((b) => b.b)) };
      const target = wide.r - wide.l <= W - pad * 2 && wide.b - wide.t <= H - pad * 2 ? wide : own;
      const dx = target.r > W - pad ? W - pad - target.r : target.l < pad ? pad - target.l : 0;
      const dy = target.b > H - pad ? H - pad - target.b : target.t < pad ? pad - target.t : 0;
      if (dx || dy) rf.setViewport({ x: vp.x + dx, y: vp.y + dy, zoom: vp.zoom }, { duration: 220 });
    };
    const t = setTimeout(reveal, 60);
    const ro = new ResizeObserver(() => reveal());
    ro.observe(el);
    return () => {
      clearTimeout(t);
      ro.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNodeId]);

  /** 화면에서 잰 노드 크기(블록 크기 계산용) */
  const measure = (): Sizes => {
    const out: Sizes = {};
    for (const n of workflow.nodes) {
      const m = instance.current?.getInternalNode(n.id)?.measured;
      if (m?.width && m.height) out[n.id] = { width: m.width, height: m.height };
    }
    return out;
  };
  const sizeOf = (id: string) => {
    const m = instance.current?.getInternalNode(id)?.measured;
    return m?.width && m.height ? { width: m.width, height: m.height } : NODE_SIZE;
  };

  /** 노드의 캔버스 절대 좌표(블록 안 노드는 상대 좌표 + 블록 좌표) */
  const absoluteOf = (id: string, pos: XY): XY => {
    const parent = nodesById.get(nodesById.get(id)?.parentId ?? "");
    if (!isBlock(parent)) return pos;
    const r = rectOf(parent);
    return { x: r.x + pos.x, y: r.y + pos.y };
  };

  const blockAt = (pt: XY): DifyNode | null => {
    for (const b of [...blocks].reverse()) {
      const r = rectOf(b);
      if (pt.x >= r.x && pt.x <= r.x + r.width && pt.y >= r.y && pt.y <= r.y + r.height) return b;
    }
    return null;
  };

  /** 드래그한 노드의 중심이 어느 블록 위에 있는지로 소속을 정한다(블록·시작 노드는 제외) */
  const placementOf = (n: FlowNode, size: { width: number; height: number }): Placement => {
    const docNode = nodesById.get(n.id);
    const current = docNode?.parentId ?? null;
    if (!docNode || n.type === "block" || n.type === "memory" || docNode.data.type === "start") return { id: n.id, position: n.position, parentId: current };
    const abs = absoluteOf(n.id, n.position);
    const target = blockAt({ x: abs.x + size.width / 2, y: abs.y + size.height / 2 });
    const targetId = target?.id ?? null;
    if (targetId === current) return { id: n.id, position: n.position, parentId: current };
    const origin = target ? rectOf(target) : { x: 0, y: 0 };
    return { id: n.id, position: { x: abs.x - origin.x, y: abs.y - origin.y }, parentId: targetId };
  };

  const clearOverrides = (ids: string[]) =>
    setOverrides((prev) => {
      const next = { ...prev };
      for (const id of ids) delete next[id];
      return next;
    });

  // v13: 변경 사항은 배열이 아니라 순회 가능한 Changeset 으로 들어온다
  const onNodesChange = (changes: NodeChangeset<FlowNode>) => {
    const removed: string[] = [];
    const patch: Record<string, Partial<Rect>> = {};
    const select: [string, boolean][] = [];
    const sizes: Record<string, { width: number; height: number }> = {};
    for (const c of changes) {
      if (c.type === "dimensions" && c.dimensions) sizes[c.id] = { width: c.dimensions.width, height: c.dimensions.height };
      if (c.type === "position" && c.position) patch[c.id] = { ...patch[c.id], x: c.position.x, y: c.position.y };
      else if (c.type === "dimensions" && c.resizing && c.dimensions) patch[c.id] = { ...patch[c.id], ...c.dimensions };
      else if (c.type === "select") select.push([c.id, c.selected]);
      else if (c.type === "remove") removed.push(c.id);
    }
    if (Object.keys(sizes).length) {
      setMeasured((prev) => {
        const changed = Object.entries(sizes).filter(([id, d]) => prev[id]?.width !== d.width || prev[id]?.height !== d.height);
        return changed.length ? { ...prev, ...Object.fromEntries(changed) } : prev;
      });
    }
    if (Object.keys(patch).length) {
      setOverrides((prev) => {
        const next = { ...prev };
        for (const [id, p] of Object.entries(patch)) next[id] = { ...next[id], ...p };
        return next;
      });
    }
    if (select.length) {
      setMulti((prev) => {
        const next = new Set(prev);
        for (const [id, on] of select) {
          if (on) next.add(id);
          else next.delete(id);
        }
        return next;
      });
    }
    if (removed.length) edit.onDeleteNodes(removed);
  };

  const onEdgesChange = (changes: EdgeChangeset<Edge>) => {
    const removed: string[] = [];
    let next: Set<string> | null = null;
    for (const c of changes) {
      if (c.type === "select") {
        next ??= new Set(selectedEdges);
        if (c.selected) next.add(c.id);
        else next.delete(c.id);
      }
      if (c.type === "remove") removed.push(c.id);
    }
    if (next) setSelectedEdges(next);
    if (removed.length) edit.onDeleteEdges(removed);
  };

  const onConnectEnd = (_: unknown, st: FinalConnectionState) => {
    if (st.isValid !== false || !st.fromHandle || !st.toHandle || !st.fromNode || !st.toNode) return;
    const forward = st.fromHandle.type === "source";
    const from = { id: st.fromNode.id, handle: st.fromHandle.id ?? null };
    const to = { id: st.toNode.id, handle: st.toHandle.id ?? null };
    const [s, t] = forward ? [from, to] : [to, from];
    const err = connectionError(workflow.nodes, { source: s.id, sourceHandle: s.handle, target: t.id, targetHandle: t.handle });
    if (err) setNotice(err);
  };

  const viewportCenter = (): XY => {
    const rf = instance.current;
    const box = wrap.current?.getBoundingClientRect();
    return rf && box ? rf.screenToFlowPosition({ x: box.left + box.width / 2, y: box.top + box.height / 2 }) : { x: 0, y: 0 };
  };

  /** base 오른쪽 빈자리(같은 블록 안의 형제 노드와 겹치지 않게) */
  const spotRightOf = (base: XY, parentId?: string): XY => {
    let y = base.y;
    const siblings = workflow.nodes.filter((n) => !isBlock(n) && n.parentId === parentId);
    while (siblings.some((n) => n.position && Math.abs(n.position.x - (base.x + 320)) < 200 && Math.abs(n.position.y - y) < 90)) y += 120;
    return { x: base.x + 320, y };
  };

  const selectedNode = selectedNodeId ? nodesById.get(selectedNodeId) : undefined;
  const canChain = !!selectedNode && !isBlock(selectedNode) && selectedNode.data.type !== "end" && !BRANCHING.has(selectedNode.data.type);

  const addNode = (type: string) => {
    const center = viewportCenter();
    if (type.startsWith("memory:")) {
      const kind = type.slice(7) as MemoryKind;
      const llm = selectedNode?.data.type === "llm" && !isMemoryBlock(nodesById.get(selectedNode.parentId ?? "")) ? selectedNode : null;
      if (llm) {
        // 고른 LLM 노드 아래에 두고 바로 붙인다(블록 안의 LLM 이면 그 블록 아래)
        const parent = nodesById.get(llm.parentId ?? "");
        const base = absoluteOf(llm.id, llm.position ?? { x: 0, y: 0 });
        const y = isBlock(parent) ? rectOf(parent).y + rectOf(parent).height + 70 : base.y + sizeOf(llm.id).height + 90;
        edit.onAddMemory(kind, { x: base.x - 200, y }, llm.id);
      } else edit.onAddMemory(kind, { x: center.x - 300, y: center.y - 180 });
      return;
    }
    if (type === "block") {
      edit.onAddBlock({ x: center.x - BLOCK_SIZE.width / 2, y: center.y - BLOCK_SIZE.height / 2 });
      return;
    }
    const sel = selectedNode;
    if (isBlock(sel)) {
      const kids = membersOf(workflow.nodes, sel.id);
      if (isMemoryBlock(sel)) {
        // 메모리 모듈 안: 맨 오른쪽 노드 옆에 두고, 선은 직접 잇게 한다
        const last = kids.length ? kids.reduce((a, b) => ((b.position?.x ?? 0) > (a.position?.x ?? 0) ? b : a)) : null;
        edit.onAddNode(type, last ? spotRightOf(last.position ?? { x: 0, y: 0 }, sel.id) : { x: 104, y: 78 }, { parentId: sel.id });
      } else if (kids.length === 0) {
        // 빈 블록: 엔트리 포인트 높이에 두고 바로 잇는다
        const h = sel.height ?? BLOCK_SIZE.height;
        edit.onAddNode(type, { x: 84, y: Math.max(56, Math.round(h / 2 - NODE_SIZE.height / 2)) }, { parentId: sel.id, connectFrom: { id: sel.id, handle: PORT.entry } });
      } else {
        const last = kids.reduce((a, b) => ((b.position?.x ?? 0) > (a.position?.x ?? 0) ? b : a));
        edit.onAddNode(type, spotRightOf(last.position ?? { x: 0, y: 0 }, sel.id), { parentId: sel.id });
      }
      return;
    }
    if (sel && canChain) {
      edit.onAddNode(type, spotRightOf(sel.position ?? { x: 0, y: 0 }, sel.parentId), {
        connectFrom: { id: sel.id, handle: "source" },
        parentId: sel.parentId,
      });
      return;
    }
    edit.onAddNode(type, { x: center.x - 118, y: center.y - 40 });
  };

  const addWhere = isMemoryBlock(selectedNode)
    ? `‘${selectedNode.data.title}’ 모듈 안`
    : isBlock(selectedNode)
      ? `‘${selectedNode.data.title}’ 블록 안`
      : canChain
        ? `‘${selectedNode!.data.title}’ 다음에 연결`
        : "화면 가운데";

  const groupable = [...multi].filter((id) => {
    const n = nodesById.get(id);
    return !!n && !isBlock(n) && !n.parentId && n.data.type !== "start";
  });

  const actions: BlockActions = {
    rename: (id, title) => edit.onUpdateNodeData(id, { title }),
    recolor: (id, color) => edit.onUpdateNodeData(id, { color }),
    resizeEnd: (id, rect) => {
      edit.onResizeBlock(id, rect, measure());
      clearOverrides([id, ...membersOf(workflow.nodes, id).map((n) => n.id)]);
    },
    ungroup: (id) => edit.onUngroup(id),
  };

  return (
    <div ref={wrap} className="h-full w-full">
      <BlockActionsContext.Provider value={actions}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onInit={(rf) => {
            instance.current = rf;
            requestAnimationFrame(() => {
              if (rf.getViewport().zoom >= MIN_READABLE_ZOOM) return;
              const b = rf.getNodesBounds(rf.getNodes());
              const h = wrap.current?.clientHeight ?? 600;
              rf.setViewport({ x: 48 - b.x * MIN_READABLE_ZOOM, y: h / 2 - (b.y + b.height / 2) * MIN_READABLE_ZOOM, zoom: MIN_READABLE_ZOOM });
            });
          }}
          fitView
          fitViewOptions={{ padding: 0.15, maxZoom: 1 }}
          minZoom={0.2}
          maxZoom={1.6}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeDrag={(_, n) => {
            const p = placementOf(n, sizeOf(n.id));
            const hover = p.parentId && p.parentId !== (nodesById.get(n.id)?.parentId ?? null) ? p.parentId : null;
            if (hover !== dropTarget) setDropTarget(hover);
          }}
          onNodeDragStop={(_, n, dragged) => {
            const list = dragged.length ? dragged : [n];
            const sizes = measure();
            edit.onPlaceNodes(
              list.map((d) => placementOf(d, sizes[d.id] ?? NODE_SIZE)),
              sizes,
            );
            clearOverrides(list.map((d) => d.id));
            setDropTarget(null);
          }}
          onBeforeDelete={async ({ nodes: ns, edges: es }) => {
            // xyflow 는 블록을 지울 때 안의 노드까지 함께 지우려 한다 → 직접 고른 노드만 지우고, 블록은 풀기로 처리한다(removeNodes).
            const ids = new Set(ns.map((n) => n.id));
            const keep = ns.filter((n) => n.selected || !(n.parentId && ids.has(n.parentId)));
            const keepIds = new Set(keep.map((n) => n.id));
            // 노드에 붙은 선은 노드 삭제에서 함께 정리하므로, 직접 고른 선만 넘긴다
            return { nodes: keep, edges: es.filter((e) => e.selected && !keepIds.has(e.source) && !keepIds.has(e.target)) };
          }}
          onConnect={(c: Connection) =>
            edit.onConnect({ source: c.source, sourceHandle: c.sourceHandle ?? null, target: c.target, targetHandle: c.targetHandle ?? null })
          }
          onConnectEnd={onConnectEnd}
          isValidConnection={(c) => connectionError(workflow.nodes, c) === null}
          onNodeClick={(_, n) => onSelectNode(n.id)}
          onPaneClick={() => setSelectedEdges(new Set())}
          deleteKeyCode={["Backspace", "Delete"]}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={18} size={1.2} color="var(--color-line-2)" />
          <Controls showInteractive={false} position="bottom-left" />
          <Panel position="top-left">
            <div className="flex items-center gap-1.5">
              <AddNodeMenu onPick={addNode} where={addWhere} />
              <span className="inline-flex h-[32px] w-[32px] items-center justify-center rounded-lg border border-line bg-surface shadow-sm">
                <Help label="조작법">
                  <span className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                    <b className="font-semibold text-ink">점 끌기</b>
                    <span>노드 연결</span>
                    <b className="font-semibold text-ink">Shift+드래그</b>
                    <span>여러 노드 선택, 블록으로 묶기</span>
                    <b className="font-semibold text-ink">Delete</b>
                    <span>선택한 노드·선 삭제</span>
                    <b className="font-semibold text-ink">Ctrl+Z</b>
                    <span>실행 취소 (Ctrl+Shift+Z 다시 실행)</span>
                    <b className="font-semibold text-ink">◆ 끼리</b>
                    <span>메모리 모듈을 LLM에 붙이기</span>
                  </span>
                </Help>
              </span>
            </div>
          </Panel>
          {(notice || (multi.size >= 2 && groupable.length > 0)) && (
            <Panel position="top-center">
              <div className="flex flex-col items-center gap-2">
                {multi.size >= 2 && groupable.length > 0 && (
                  <div className="flex items-center gap-2.5 rounded-xl border border-line bg-surface py-1.5 pr-1.5 pl-3 text-[12px] text-ink-2 shadow-md">
                    노드 {groupable.length}개 선택
                    <button
                      type="button"
                      onClick={() => {
                        edit.onGroup(groupable, measure());
                        setMulti(new Set());
                      }}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-2.5 py-1 text-[12px] font-semibold text-white hover:brightness-110"
                    >
                      <Group size={14} />
                      블록으로 묶기
                    </button>
                  </div>
                )}
                {notice && (
                  <div role="status" className="flex items-center gap-1.5 rounded-lg border border-warn/35 bg-surface px-3 py-1.5 text-[12px] text-warn shadow-sm">
                    <CircleAlert size={13} />
                    {notice}
                  </div>
                )}
              </div>
            </Panel>
          )}
          {runs.length > 0 && (
            <Panel position="bottom-right">
              <div className="flex items-center gap-3 rounded-lg border border-line bg-surface/90 px-3 py-1.5 text-[11px] text-ink-3 backdrop-blur">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-[2.5px] w-5 rounded bg-run" />
                  실행된 경로
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-5 border-t-[1.5px] border-dashed border-line-2" />
                  선택되지 않은 분기
                </span>
              </div>
            </Panel>
          )}
        </ReactFlow>
      </BlockActionsContext.Provider>
    </div>
  );
}
