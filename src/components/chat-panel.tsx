"use client";

import { Brain, ChevronDown, CircleCheck, CircleX, Database, LoaderCircle, RotateCcw, Send, Square, SquareDashed } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { BLOCK, BLOCK_EXIT, blockColor, exitIdOf, isBlock } from "@/lib/dsl/blocks";
import { MEMORY_RUN, isMemoryRunType, readEndId, writeEndId } from "@/lib/dsl/memory";
import type { DifyNode, Workflow } from "@/lib/dsl/types";
import { PROVIDERS, type ProviderId } from "@/lib/llm/catalog";
import { branchLabel, formatMs } from "@/lib/client/labels";
import { NodeIcon } from "./node-meta";
import type { AssistantMessage, ChatMessage, Selection } from "./types";

interface StartVar {
  variable: string;
  label?: string;
  type?: string;
  options?: string[];
  required?: boolean;
  default?: unknown;
}

/** **굵게**, `코드` 정도만 처리하는 가벼운 마크다운 렌더러 */
function RichText({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > last) parts.push(text.slice(last, m.index));
    const tok = m[0];
    parts.push(
      tok.startsWith("**") ? (
        <strong key={m.index} className="font-semibold">
          {tok.slice(2, -2)}
        </strong>
      ) : (
        <code key={m.index} className="rounded bg-paper-2 px-1 font-mono text-[0.9em]">
          {tok.slice(1, -1)}
        </code>
      ),
    );
    last = m.index! + tok.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <div className="whitespace-pre-wrap break-words">{parts}</div>;
}

function ProcessList({
  message,
  nodes,
  selection,
  onSelect,
}: {
  message: AssistantMessage;
  nodes: Map<string, DifyNode>;
  selection: Selection;
  onSelect: (s: Selection) => void;
}) {
  const [open, setOpen] = useState(true);
  const failed = message.runs.filter((r) => r.status === "failed").length;
  // 블록 종료는 블록 머리줄의 상태·시간으로 합쳐 보여 준다
  // 메모리 모듈의 읽기 끝·쓰기 끝도 각 구역 머리줄의 시간으로 합친다
  const visible = message.runs.filter((r) => r.nodeType !== BLOCK_EXIT && r.nodeType !== MEMORY_RUN.readEnd && r.nodeType !== MEMORY_RUN.writeEnd);
  const nodeCount = message.runs.filter((r) => r.nodeType !== BLOCK && r.nodeType !== BLOCK_EXIT && !isMemoryRunType(r.nodeType)).length;
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-paper-2/60">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-[11px] font-semibold text-ink-2"
      >
        {message.status === "running" ? (
          <LoaderCircle size={13} className="animate-spin text-run" />
        ) : failed || message.status === "failed" ? (
          <CircleX size={13} className="text-err" />
        ) : (
          <CircleCheck size={13} className="text-ok" />
        )}
        워크플로 실행 과정
        <span className="font-normal text-ink-3">노드 {nodeCount}개</span>
        <ChevronDown size={13} className={`ml-auto text-ink-4 transition-transform ${open ? "" : "-rotate-90"}`} />
      </button>
      {open && (
        <ol className="border-t border-line px-1 py-1">
          {visible.map((r) => {
            const active = selection?.messageId === message.id && selection.nodeId === r.nodeId;
            const live = message.live[r.id];
            if (r.nodeType === MEMORY_RUN.read || r.nodeType === MEMORY_RUN.write) {
              const reading = r.nodeType === MEMORY_RUN.read;
              const blockId = r.nodeId.split("::")[0];
              const block = nodes.get(blockId);
              const end = message.runs.find((x) => x.nodeId === (reading ? readEndId(blockId) : writeEndId(blockId)));
              const picked = selection?.messageId === message.id && selection.nodeId === blockId;
              return (
                <li key={r.id} className="mt-1 first:mt-0">
                  <button
                    type="button"
                    onClick={() => onSelect({ messageId: message.id, nodeId: blockId })}
                    className={`flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-xs ${picked ? "bg-surface shadow-[0_0_0_1px_var(--color-accent)]" : "hover:bg-surface"}`}
                  >
                    <span className="w-4 shrink-0" />
                    <span className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded border border-black/10 text-ink-2" style={{ background: block ? blockColor(block) : "#fce7f3" }}>
                      <Brain size={11} />
                    </span>
                    <span className="min-w-0 flex-1 truncate font-semibold text-ink">
                      {r.title} <span className="font-normal text-ink-3">· {reading ? "읽기" : "쓰기"}</span>
                    </span>
                    {end?.status === "succeeded" ? (
                      <span className="shrink-0 font-mono text-[11px] tabular-nums text-ink-3">{formatMs((end.finishedAt ?? 0) - r.startedAt)}</span>
                    ) : end?.status === "failed" ? (
                      <CircleX size={12} className="shrink-0 text-err" />
                    ) : message.status === "running" ? (
                      <LoaderCircle size={12} className="shrink-0 animate-spin text-run" />
                    ) : (
                      <span className="shrink-0 text-[11px] text-[#b45309]">끝까지 가지 않음</span>
                    )}
                  </button>
                </li>
              );
            }
            if (r.nodeType === BLOCK) {
              const block = nodes.get(r.nodeId);
              const exit = message.runs.find((x) => x.nodeId === exitIdOf(r.nodeId));
              const color = block ? blockColor(block) : "#e4e4e7";
              const innerFailed = message.runs.some((x) => nodes.get(x.nodeId)?.parentId === r.nodeId && x.status === "failed");
              return (
                <li key={r.id} className="mt-1 first:mt-0">
                  <button
                    type="button"
                    onClick={() => onSelect({ messageId: message.id, nodeId: r.nodeId })}
                    className={`flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-xs ${
                      active ? "bg-surface shadow-[0_0_0_1px_var(--color-accent)]" : "hover:bg-surface"
                    }`}
                  >
                    <span className="w-4 shrink-0" />
                    <span className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded border border-black/10 text-ink-2" style={{ background: color }}>
                      <SquareDashed size={11} />
                    </span>
                    <span className="min-w-0 flex-1 truncate font-semibold text-ink">{r.title}</span>
                    {exit?.status === "succeeded" ? (
                      <span className="shrink-0 font-mono text-[11px] tabular-nums text-ink-3">{formatMs((exit.finishedAt ?? 0) - r.startedAt)}</span>
                    ) : innerFailed ? (
                      <CircleX size={12} className="shrink-0 text-err" />
                    ) : message.status === "running" ? (
                      <LoaderCircle size={12} className="shrink-0 animate-spin text-run" />
                    ) : (
                      <span className="shrink-0 text-[11px] text-[#b45309]">아웃 미도달</span>
                    )}
                  </button>
                </li>
              );
            }
            const parent = nodes.get(nodes.get(r.nodeId)?.parentId ?? "");
            const inBlock = isBlock(parent);
            return (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => onSelect({ messageId: message.id, nodeId: r.nodeId })}
                  className={`group flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-xs ${
                    active ? "bg-surface shadow-[0_0_0_1px_var(--color-accent)]" : "hover:bg-surface"
                  } ${inBlock ? "border-l-[3px] pl-3" : ""}`}
                  style={inBlock ? { borderLeftColor: blockColor(parent) } : undefined}
                >
                  <span className="w-4 shrink-0 text-right font-mono text-[11px] text-ink-4">{r.index}</span>
                  <NodeIcon type={r.nodeType} size={18} />
                  <span className="min-w-0 flex-1 truncate text-ink">{r.title}</span>
                  {r.selectedHandle && <span className="max-w-24 shrink-0 truncate rounded bg-run/10 px-1 font-mono text-[11px] text-run">→{branchLabel(r)}</span>}
                  {r.status === "running" ? (
                    <LoaderCircle size={12} className="shrink-0 animate-spin text-run" />
                  ) : r.status === "failed" ? (
                    <CircleX size={12} className="shrink-0 text-err" />
                  ) : (
                    <span className="shrink-0 font-mono text-[11px] tabular-nums text-ink-3">{formatMs(r.elapsedMs)}</span>
                  )}
                </button>
                {r.status === "running" && live?.text && (
                  <div className="ml-[46px] mr-2 mb-1 line-clamp-2 text-[11px] leading-snug text-ink-3">{live.text.slice(-160)}</div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

export function ChatPanel({
  workflow,
  messages,
  running,
  selection,
  onSelect,
  onSend,
  onStop,
  onReset,
  missingKeys,
  mock,
  onOpenSettings,
  conversationVariables,
}: {
  workflow: Workflow;
  messages: ChatMessage[];
  running: boolean;
  selection: Selection;
  onSelect: (s: Selection) => void;
  onSend: (query: string, inputs: Record<string, unknown>) => void;
  onStop: () => void;
  onReset: () => void;
  missingKeys: ProviderId[];
  mock: boolean;
  onOpenSettings?: () => void;
  conversationVariables: Record<string, unknown>;
}) {
  const startNode = workflow.nodes.find((n) => n.data.type === "start");
  const nodesById = useMemo(() => new Map(workflow.nodes.map((n) => [n.id, n])), [workflow]);
  const startVars = ((startNode?.data.variables as StartVar[]) ?? []).filter((v) => v.variable);
  // 워크플로가 바뀌면 부모가 key 로 이 컴포넌트를 새로 만들므로 초기값만 정하면 된다
  const [inputs, setInputs] = useState<Record<string, unknown>>(() =>
    Object.fromEntries(startVars.map((v) => [v.variable, v.default ?? ""])),
  );
  const [text, setText] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const [showInputs, setShowInputs] = useState(true);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [messages]);

  const send = (q: string) => {
    if (!q.trim() || running) return;
    onSend(q.trim(), inputs);
    setText("");
  };

  const convEntries = Object.entries(conversationVariables);

  // 키 안내는 가장 최근 실행이 실제로 키가 없어서 실패했을 때만 보여 준다
  const lastRun = messages.findLast((m): m is AssistantMessage => m.role === "assistant");
  const keyFailed =
    !mock &&
    missingKeys.length > 0 &&
    !!lastRun &&
    lastRun.status !== "running" &&
    [lastRun.error, ...lastRun.runs.map((r) => r.error)].some((e) => e?.includes("API 키가 없습니다"));

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-2 border-b border-line px-4 py-3">
        <div className="min-w-0 flex-1 text-sm font-semibold text-ink">채팅</div>
        <button
          type="button"
          onClick={onReset}
          disabled={running}
          className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-[11px] font-medium text-ink-2 hover:bg-paper-2 disabled:opacity-40"
        >
          <RotateCcw size={12} />새 대화
        </button>
      </header>

      {mock && (
        <div className="border-b border-[#fde68a] bg-[#fffbeb] px-4 py-2 text-[12px] leading-snug text-[#92400e]">
          <b>Mock 모드</b> · LLM 호출이 가짜 응답으로 대체됩니다.
        </div>
      )}

      {startVars.length > 0 && (
        <div className="border-b border-line bg-paper-2/50 px-4 py-2">
          <button type="button" onClick={() => setShowInputs(!showInputs)} className="flex w-full items-center gap-1 text-[11px] font-semibold text-ink-2">
            시작 노드 입력 변수
            <ChevronDown size={13} className={`ml-auto text-ink-4 transition-transform ${showInputs ? "" : "-rotate-90"}`} />
          </button>
          {showInputs && (
            <div className="mt-2 grid gap-2">
              {startVars.map((v) => (
                <label key={v.variable} className="grid grid-cols-[96px_1fr] items-center gap-2 text-xs">
                  <span className="truncate text-ink-3">
                    {v.label ?? v.variable}
                    {v.required && <span className="text-err"> *</span>}
                  </span>
                  {v.type === "select" ? (
                    <select
                      value={String(inputs[v.variable] ?? "")}
                      onChange={(e) => setInputs({ ...inputs, [v.variable]: e.target.value })}
                      className="rounded-md border border-line bg-surface px-2 py-1 text-xs text-ink"
                    >
                      {(v.options ?? []).map((o) => (
                        <option key={o}>{o}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type={v.type === "number" ? "number" : "text"}
                      value={String(inputs[v.variable] ?? "")}
                      onChange={(e) => setInputs({ ...inputs, [v.variable]: e.target.value })}
                      className="rounded-md border border-line bg-surface px-2 py-1 text-xs text-ink"
                    />
                  )}
                </label>
              ))}
            </div>
          )}
        </div>
      )}

      <div ref={scroller} className="flex-1 space-y-4 overflow-auto px-4 py-4">
        {messages.length === 0 && (
          <div className="space-y-3">
            {workflow.openingStatement && (
              <div className="rounded-xl rounded-tl-sm border border-line bg-surface px-3 py-2.5 text-[13px] leading-relaxed text-ink-2">
                {workflow.openingStatement}
              </div>
            )}
            {workflow.suggestedQuestions.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-[11px] font-semibold text-ink-3">예시 질문</div>
                {workflow.suggestedQuestions.map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => send(q)}
                    className="block w-full rounded-lg border border-line bg-surface px-3 py-2 text-left text-xs leading-snug text-ink-2 transition-colors hover:border-accent/50 hover:text-ink"
                  >
                    <span className="line-clamp-2">{q}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {messages.map((m) =>
          m.role === "user" ? (
            <div key={m.id} className="flex justify-end">
              <div className="max-w-[85%] rounded-xl rounded-tr-sm bg-ink px-3 py-2 text-[13px] leading-relaxed whitespace-pre-wrap text-paper">
                {m.content}
              </div>
            </div>
          ) : (
            <div key={m.id} className="space-y-2">
              <ProcessList message={m} nodes={nodesById} selection={selection} onSelect={onSelect} />
              {(m.content || m.status !== "running") && (
                <div className="rounded-xl rounded-tl-sm border border-line bg-surface px-3 py-2.5 text-[13px] leading-relaxed text-ink">
                  {m.content ? <RichText text={m.content} /> : <span className="text-ink-4">(답변 노드 출력 없음)</span>}
                </div>
              )}
              {m.error && (
                <div className="rounded-lg border border-err/30 bg-err/6 px-3 py-2 text-xs whitespace-pre-wrap text-err">{m.error}</div>
              )}
              {m.status !== "running" && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-[11px] text-ink-3">
                  {m.elapsedMs != null && <span className="tabular-nums">총 {formatMs(m.elapsedMs)}</span>}
                  {!!m.totalTokens && <span className="tabular-nums">토큰 {m.totalTokens.toLocaleString()}</span>}
                  {m.variablePool && (
                    <button
                      type="button"
                      onClick={() => onSelect({ messageId: m.id, pool: true })}
                      className={`inline-flex items-center gap-1 hover:text-ink ${
                        selection?.messageId === m.id && selection.pool ? "font-semibold text-accent" : ""
                      }`}
                    >
                      <Database size={11} />
                      변수 풀 보기
                    </button>
                  )}
                </div>
              )}
            </div>
          ),
        )}
      </div>

      {convEntries.length > 0 && (
        <div className="flex flex-wrap gap-1.5 border-t border-line px-4 py-1.5 text-[11px] text-ink-3">
          대화 변수
          {convEntries.map(([k, v]) => (
            <code key={k} className="rounded bg-paper-2 px-1 font-mono text-ink-2">
              {k}={JSON.stringify(v)}
            </code>
          ))}
        </div>
      )}

      {keyFailed && (
        <div className="flex items-center gap-2 border-t border-line px-4 py-1.5 text-[12px] leading-snug text-ink-3">
          <span className="min-w-0 flex-1">{missingKeys.map((p) => PROVIDERS[p].label).join(", ")} 키가 없어 실행이 멈췄습니다.</span>
          {onOpenSettings && (
            <button type="button" onClick={onOpenSettings} className="shrink-0 font-semibold text-accent hover:underline">
              API 키
            </button>
          )}
        </div>
      )}

      <form
        className="border-t border-line p-3"
        onSubmit={(e) => {
          e.preventDefault();
          send(text);
        }}
      >
        <div className="flex items-end gap-2 rounded-xl border border-line-2 bg-surface px-3 py-2 focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/15">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send(text);
              }
            }}
            rows={Math.min(6, Math.max(1, text.split("\n").length))}
            placeholder="메시지를 입력하세요 (Shift+Enter 줄바꿈)"
            className="max-h-40 min-h-[22px] flex-1 resize-none bg-transparent text-[13px] leading-relaxed text-ink outline-none placeholder:text-ink-4"
          />
          {running ? (
            <button
              type="button"
              onClick={onStop}
              aria-label="실행 중단"
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-ink text-paper hover:bg-ink-2"
            >
              <Square size={13} fill="currentColor" />
            </button>
          ) : (
            <button
              type="submit"
              aria-label="보내기"
              disabled={!text.trim()}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent text-white hover:brightness-110 disabled:opacity-30"
            >
              <Send size={14} />
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
