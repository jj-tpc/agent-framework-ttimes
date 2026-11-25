"use client";

import { ArrowRight, ChevronRight, CircleAlert, Lock, Pencil, RefreshCw, Trash2, Unlink } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { blockColor, membersOf } from "@/lib/dsl/blocks";
import { graphOf, outputsOf } from "@/lib/dsl/edit";
import { DEFAULT_MEMORY_HEADER, MEMORY_KINDS, attachedLlm, memoryKindInfo, memoryWarnings, readMemory, zonesOf, type MemoryConfig as MemoryCfg, type MemoryKind } from "@/lib/dsl/memory";
import type { DifyNode, DslDoc, ValueSelector } from "@/lib/dsl/types";
import { MEMORY_TOOL } from "@/lib/tools/config";
import { BlockColorPicker } from "./block-config";
import { NodeIcon, nodeMeta } from "./node-meta";
import { Field, Help, inputCls } from "./ui";

const smallInput = `${inputCls} !py-1 !text-[13px]`;

function Group({ title, children, action, help }: { title: string; children: React.ReactNode; action?: React.ReactNode; help?: React.ReactNode }) {
  return (
    <div className="border-b border-line px-4 py-3.5">
      <div className="mb-2.5 flex items-center gap-1">
        <span className="text-[12px] font-semibold tracking-wide text-ink">{title}</span>
        {help && <Help label={`${title} 설명`}>{help}</Help>}
        <span className="ml-auto">{action}</span>
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

/** 모듈 안의 노드 한 줄. 누르면 그 노드의 설정이 열린다 */
function NodeRow({ node, step, onClick }: { node: DifyNode; step?: number; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex w-full items-center gap-1.5 rounded-md border border-line bg-surface py-1 pr-1.5 pl-1 text-left text-[12px] text-ink hover:border-accent/50 hover:bg-paper-2"
    >
      {step != null && <span className="w-3.5 shrink-0 text-center font-mono text-[11px] text-ink-4">{step}</span>}
      <NodeIcon type={node.data.type} size={18} />
      <span className="min-w-0 flex-1 truncate">{node.data.title || nodeMeta(node.data.type).label}</span>
      <ChevronRight size={13} className="shrink-0 text-ink-4 group-hover:text-accent" aria-hidden />
    </button>
  );
}

// ───────────────────────── LLM 이 받는 전체 프롬프트 ─────────────────────────

type PromptItem = { role?: string; text?: string; edition_type?: string; jinja2_text?: string };

/** 프롬프트의 한 조각. 고칠 수 있는 조각은 입력란으로, 실행할 때 정해지는 조각은 잠긴 상자로 보여 준다 */
function Part({ label, editable, note, help, children }: { label: string; editable: boolean; note?: React.ReactNode; help?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className={`rounded-lg border ${editable ? "border-line bg-surface" : "border-dashed border-line-2 bg-paper-2/70"}`}>
      <div className="flex items-center gap-1.5 px-2.5 pt-1.5 text-[11px] font-semibold tracking-wide">
        {editable ? <Pencil size={10} className="text-accent" /> : <Lock size={10} className="text-ink-4" />}
        <span className={editable ? "text-ink-2" : "text-ink-3"}>{label}</span>
        {help && <Help label={`${label} 설명`}>{help}</Help>}
        <span className={`ml-auto font-medium ${editable ? "text-accent" : "text-ink-4"}`}>{editable ? "편집 가능" : "실행 시 결정"}</span>
      </div>
      <div className="px-2.5 pt-1 pb-2">{children}</div>
      {note && <div className="border-t border-line/70 px-2.5 py-1.5 text-[11px] leading-snug text-ink-3">{note}</div>}
    </div>
  );
}

const editCls = "w-full resize-y rounded-md border border-line bg-surface px-2 py-1.5 font-mono text-[12px] leading-relaxed text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/15";
const lockedCls = "max-h-40 overflow-auto font-mono text-[12px] leading-relaxed whitespace-pre-wrap break-words text-ink-2";

/**
 * 붙은 LLM 노드가 실제로 받는 프롬프트를 들어가는 순서대로 보여 준다.
 * LLM 노드의 프롬프트와 머리말은 여기서 바로 고치고, 기억 내용·대화 이력처럼 실행할 때 정해지는 부분은 잠가 둔다.
 */
function FullPrompt({
  llm,
  cfg,
  contextSource,
  lastRun,
  onPatchLlm,
  onHeader,
  onOpenSource,
}: {
  llm: DifyNode;
  cfg: MemoryCfg;
  /** 기억 내용을 만드는 읽기 구역 노드 */
  contextSource?: DifyNode;
  /** 고른 대화 턴에서 실제로 들어간 값 */
  lastRun?: { context: string; messages: number | null };
  onPatchLlm: (patch: Record<string, unknown>) => void;
  onHeader: (header: string) => void;
  onOpenSource: (id: string) => void;
}) {
  const raw = llm.data.prompt_template;
  const isChat = Array.isArray(raw);
  const items: PromptItem[] = isChat ? (raw as PromptItem[]) : [{ role: "user", ...((raw as PromptItem) ?? {}) }];
  const setItem = (i: number, text: string) => {
    const next = items.map((x, j) => (j === i ? { ...x, text } : x));
    onPatchLlm({ prompt_template: isChat ? next : next[0] });
  };
  const builtin = llm.data.memory as { window?: { enabled?: boolean; size?: number }; query_prompt_template?: string } | undefined;
  const indexed = items.map((item, i) => ({ item, i }));
  const systems = indexed.filter((x) => (x.item.role ?? "user") === "system");
  const others = indexed.filter((x) => (x.item.role ?? "user") !== "system");
  const llmTitle = String(llm.data.title ?? "LLM");

  const promptPart = ({ item, i }: { item: PromptItem; i: number }) => {
    const jinja = item.edition_type === "jinja2";
    return (
      <Part key={i} label={`${(item.role ?? "user").toUpperCase()} · ‘${llmTitle}’ 노드의 프롬프트`} editable={!jinja} note={jinja ? "Jinja2 프롬프트는 LLM 노드 설정에서 고칩니다." : undefined}>
        {jinja ? (
          <div className={lockedCls}>{item.jinja2_text}</div>
        ) : (
          <textarea value={item.text ?? ""} rows={(item.role ?? "user") === "system" ? 4 : 2} spellCheck={false} onChange={(e) => setItem(i, e.target.value)} className={editCls} aria-label={`${item.role ?? "user"} 프롬프트`} />
        )}
      </Part>
    );
  };

  return (
    <div className="space-y-1.5">
      <div className="text-[11px] font-semibold tracking-wide text-ink-3">시스템 프롬프트 (위에서부터 순서대로)</div>
      {systems.length ? systems.map(promptPart) : <p className="text-[12px] text-ink-4">LLM 노드에 system 프롬프트가 없어 기억만 들어갑니다.</p>}
      {cfg.context.length > 0 ? (
        <>
          <Part label="머리말" editable help="기억 내용 바로 위에 붙는 한 줄입니다. 비우면 머리말 없이 붙고, 기억이 없는 턴에는 머리말도 들어가지 않습니다.">
            <input value={cfg.header} onChange={(e) => onHeader(e.target.value)} placeholder="(머리말 없음)" className={`${editCls} !resize-none`} aria-label="메모리 머리말" />
            {cfg.header !== DEFAULT_MEMORY_HEADER && (
              <button type="button" onClick={() => onHeader(DEFAULT_MEMORY_HEADER)} title={DEFAULT_MEMORY_HEADER} className="mt-1 text-[11px] font-medium text-accent hover:underline">
                기본값으로 되돌리기
              </button>
            )}
          </Part>
          <Part
            label="기억 내용"
            editable={false}
            help={contextSource ? "읽기 구역의 출처 노드가 매 턴 만듭니다. 문구나 형식은 그 노드에서 고칩니다." : "읽기 결과로 지정한 변수가 매 턴 들어갑니다."}
            note={
              contextSource ? (
                <button type="button" onClick={() => onOpenSource(contextSource.id)} className="inline-flex max-w-full items-center gap-0.5 font-medium text-accent hover:underline">
                  <span className="truncate">출처 노드 ‘{contextSource.data.title}’ 열기</span>
                  <ChevronRight size={12} className="shrink-0" aria-hidden />
                </button>
              ) : undefined
            }
          >
            {lastRun ? (
              lastRun.context ? (
                <div className={lockedCls}>{lastRun.context}</div>
              ) : (
                <div className="text-[12px] text-ink-4">고른 턴에는 넣을 기억이 없어 생략됐습니다.</div>
              )
            ) : (
              <div className="text-[12px] text-ink-4">
                <span className="font-mono">{`{{#${cfg.context.join(".")}#}}`}</span> · 채팅을 한 번 실행하면 실제 내용이 보입니다.
              </div>
            )}
          </Part>
        </>
      ) : (
        <p className="text-[12px] text-ink-4">이 모듈은 시스템 프롬프트에 글을 넣지 않고 이전 대화만 고릅니다.</p>
      )}

      <div className="pt-2 text-[11px] font-semibold tracking-wide text-ink-3">메시지 (위에서부터 순서대로)</div>
      <Part label="이전 대화" editable={false} help={cfg.history.length ? "읽기 구역이 고른 메시지가 들어갑니다. 몇 턴을 남길지는 읽기 구역의 코드 노드에서 고칩니다." : "이 모듈은 이전 대화를 건드리지 않습니다. LLM 노드의 ‘이전 대화 포함’ 설정을 따릅니다."}>
        <div className="text-[12px] text-ink-2">
          {cfg.history.length
            ? lastRun?.messages != null
              ? `모듈이 고른 메시지 ${lastRun.messages}개 (고른 턴 기준)`
              : `모듈이 고른 메시지 · {{#${cfg.history.join(".")}#}}`
            : builtin
              ? `최근 ${builtin.window?.enabled ? `${builtin.window.size ?? 10}턴` : "전체"} (LLM 노드 설정)`
              : "LLM 노드의 ‘이전 대화 포함’이 꺼져 있어 이전 대화 없이 호출됩니다."}
        </div>
      </Part>
      {others.map(promptPart)}
      {builtin && (
        <Part label="USER · 질의 템플릿" editable>
          <textarea
            value={builtin.query_prompt_template ?? "{{#sys.query#}}"}
            rows={1}
            spellCheck={false}
            onChange={(e) => onPatchLlm({ memory: { ...builtin, query_prompt_template: e.target.value } })}
            className={editCls}
            aria-label="질의 템플릿"
          />
        </Part>
      )}
    </div>
  );
}

interface StoreView {
  docs: { key: string; text: string; updatedAt: string; prov?: { via: "tool" | "node" | "dream"; conversationId?: string; external?: boolean } }[];
  records: { id: string; text: string; createdAt: string; importance?: number; validFrom?: string; invalidAt?: string | null }[];
}

/** 저장소에 지금 들어 있는 기억. 실행이 끝날 때마다(refreshKey) 다시 읽는다 */
interface DreamChange {
  path: string;
  status: "added" | "changed" | "removed" | "same";
  before: string;
  after: string;
}
interface DreamState {
  review: { createdAt: string; notes: string; model: string; changes: DreamChange[] } | null;
  hasBackup: boolean;
  backupAt?: string;
  error?: string;
}
const CHANGE_LABEL: Record<DreamChange["status"], [string, string]> = {
  added: ["새 파일", "text-ok"],
  changed: ["바뀜", "text-[#b45309]"],
  removed: ["삭제", "text-err"],
  same: ["그대로", "text-ink-4"],
};

/**
 * 기억 정리(드리밍): 대화 밖에서 메모리 파일 전체와 최근 대화 기록을 읽어 정리안을 만든다.
 * 정리안은 검토용 사본에만 쓰이고, 여기서 바뀐 점을 보고 적용해야 실제 기억이 바뀐다.
 */
function DreamGroup({ scope, store, model, onChanged }: { scope: string; store: string; model: unknown; onChanged: () => void }) {
  const [state, setState] = useState<DreamState | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const q = `scope=${encodeURIComponent(scope)}&store=${encodeURIComponent(store)}`;
  useEffect(() => {
    fetch(`/api/memory/dream?${q}`)
      .then((r) => r.json())
      .then(setState)
      .catch(() => {});
  }, [q]);
  const act = async (action: string) => {
    setBusy(action);
    setError(null);
    const res = (await fetch("/api/memory/dream", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scope, store, action, model }) })
      .then((r) => r.json())
      .catch((e) => ({ error: String(e) }))) as DreamState;
    setBusy(null);
    if (res.error) return setError(res.error);
    setState(res);
    if (action !== "propose" && action !== "discard") onChanged();
  };
  const review = state?.review;
  const changed = review?.changes.filter((c) => c.status !== "same") ?? [];
  const btn = "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[12px] font-medium disabled:opacity-40";

  return (
    <Group
      title="기억 정리 (드리밍)"
      help="메모리 파일 전체와 최근 대화 기록을 읽어 중복을 합치고, 어긋난 내용을 최신으로 고치고, 인덱스를 다시 짭니다. 정리안은 검토용 사본에만 쓰이며, 바뀐 점을 보고 적용해야 실제 기억이 바뀝니다. 붙은 LLM 노드의 모델을 한 번 호출합니다."
    >
      {error && <p className="text-[12px] text-err">{error}</p>}
      {!review && (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" disabled={!!busy} onClick={() => act("propose")} className={`${btn} border-line text-ink-2 hover:bg-paper-2`}>
            <RefreshCw size={12} className={busy === "propose" ? "animate-spin" : ""} />
            {busy === "propose" ? "정리안 만드는 중…" : "정리안 만들기"}
          </button>
          {state?.hasBackup && (
            <button type="button" disabled={!!busy} onClick={() => act("restore")} className={`${btn} border-line text-ink-3 hover:bg-paper-2`}>
              마지막 정리 되돌리기{state.backupAt ? ` (${state.backupAt.slice(0, 10)})` : ""}
            </button>
          )}
        </div>
      )}
      {review && (
        <div className="space-y-2">
          <div className="rounded-lg border border-line bg-paper px-2.5 py-2 text-[12px] leading-relaxed whitespace-pre-wrap text-ink-2">
            <div className="mb-1 text-[11px] font-semibold tracking-wide text-ink-4">
              정리안 · {review.createdAt.slice(0, 16).replace("T", " ")} · {review.model}
            </div>
            {review.notes || "(요약 없음)"}
          </div>
          {changed.length === 0 && <p className="text-[12px] text-ink-3">바꿀 것이 없습니다.</p>}
          {review.changes.map((c) => (
            <details key={c.path} className="overflow-hidden rounded-lg border border-line" open={c.status !== "same" && changed.length <= 3}>
              <summary className="flex cursor-pointer items-center gap-2 bg-paper-2 px-2.5 py-1 text-[12px]">
                <span className="font-mono font-semibold text-ink-2">{c.path}</span>
                <span className={`ml-auto font-medium ${CHANGE_LABEL[c.status][1]}`}>{CHANGE_LABEL[c.status][0]}</span>
              </summary>
              {c.status !== "same" && (
                <div className="grid grid-cols-2 divide-x divide-line bg-surface">
                  {(
                    [
                      ["지금", c.before],
                      ["정리안", c.after],
                    ] as const
                  ).map(([label, text]) => (
                    <div key={label} className="min-w-0 px-2.5 py-2">
                      <div className="mb-1 text-[11px] font-semibold tracking-wide text-ink-4">{label}</div>
                      <pre className="max-h-48 overflow-auto font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-words text-ink">{text || "(없음)"}</pre>
                    </div>
                  ))}
                </div>
              )}
            </details>
          ))}
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" disabled={!!busy || changed.length === 0} onClick={() => act("apply")} className={`${btn} border-accent bg-accent text-white hover:brightness-110`}>
              적용 ({changed.length}개 파일)
            </button>
            <button type="button" disabled={!!busy} onClick={() => act("discard")} className={`${btn} border-line text-ink-2 hover:bg-paper-2`}>
              버리기
            </button>
            <span className="text-[11px] text-ink-4">적용해도 직전 내용은 남아 한 번 되돌릴 수 있습니다.</span>
          </div>
        </div>
      )}
    </Group>
  );
}

function StoreContents({ scope, store, refreshKey }: { scope: string; store: string; refreshKey: number }) {
  const [view, setView] = useState<StoreView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const url = `/api/memory?scope=${encodeURIComponent(scope)}&store=${encodeURIComponent(store)}`;
  const load = useCallback(() => {
    fetch(url)
      .then((r) => r.json())
      .then((j: StoreView & { error?: string }) => {
        if (j.error) throw new Error(j.error);
        setView(j);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  }, [url]);
  useEffect(() => {
    load();
  }, [load, refreshKey]);
  const clear = async () => {
    await fetch(url, { method: "DELETE" });
    setConfirm(false);
    load();
  };
  const empty = view && view.docs.length === 0 && view.records.length === 0;
  const day = (s?: string | null) => (s ? s.slice(0, 10) : "");

  return (
    <Group
      title={`저장소 내용${view ? ` · 문서 ${view.docs.length} · 기록 ${view.records.length}` : ""}`}
      action={
        <button type="button" onClick={load} className="inline-flex items-center gap-1 text-[12px] font-medium text-accent hover:underline">
          <RefreshCw size={11} />
          새로 고침
        </button>
      }
    >
      {error && <p className="text-[12px] text-err">저장소를 읽지 못했습니다: {error}</p>}
      {empty && <p className="text-[12px] leading-snug text-ink-3">아직 기억이 없습니다. 채팅에서 몇 턴 대화하면 쓰기 구역이 여기에 쌓습니다.</p>}
      {view?.docs.map((d) => (
        <div key={d.key} className="overflow-hidden rounded-lg border border-line">
          <div className="flex items-center gap-2 border-b border-line bg-paper-2 px-2.5 py-1">
            <span className="min-w-0 truncate font-mono text-[12px] font-semibold text-ink-2">{d.key}</span>
            {d.prov?.external && (
              <span className="shrink-0 rounded-full bg-[#fef3c7] px-1.5 py-px text-[11px] font-medium text-[#92400e]" title="웹 페이지나 MCP 서버 결과를 본 대화에서 저장되었습니다. 그 자료의 문장이 섞였을 수 있습니다.">
                외부 자료를 본 뒤 저장
              </span>
            )}
            <span className="ml-auto shrink-0 text-[11px] text-ink-4" title={d.prov?.conversationId ? `대화 ${d.prov.conversationId}` : undefined}>
              {d.prov ? `${d.prov.via === "tool" ? "모델이 도구로" : d.prov.via === "dream" ? "정리" : "모듈 노드"} · ` : ""}
              {d.text.length}자 · {day(d.updatedAt)}
            </span>
          </div>
          <pre className="max-h-44 overflow-auto bg-surface px-2.5 py-2 font-mono text-[12px] leading-relaxed whitespace-pre-wrap break-words text-ink">{d.text || "(빈 문서)"}</pre>
        </div>
      ))}
      {view && view.records.length > 0 && (
        <ul className="max-h-72 space-y-1 overflow-auto">
          {view.records.map((r) => (
            <li key={r.id} className={`rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[12px] leading-snug ${r.invalidAt ? "opacity-60" : ""}`}>
              <div className={`text-ink ${r.invalidAt ? "line-through" : ""}`}>{r.text}</div>
              <div className="mt-0.5 flex flex-wrap gap-x-2 font-mono text-[11px] text-ink-3">
                <span>{r.id}</span>
                {r.importance != null && <span>중요도 {r.importance}</span>}
                <span>
                  {day(r.validFrom ?? r.createdAt)} ~ {r.invalidAt ? day(r.invalidAt) : "지금"}
                </span>
                {r.invalidAt && <span className="text-[#b45309]">무효</span>}
              </div>
            </li>
          ))}
        </ul>
      )}
      {view && !empty && (
        <button
          type="button"
          onClick={() => (confirm ? clear() : setConfirm(true))}
          onBlur={() => setConfirm(false)}
          className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[12px] font-medium ${confirm ? "border-err bg-err text-white" : "border-err/30 text-err hover:bg-err/6"}`}
        >
          <Trash2 size={13} />
          {confirm ? "되돌릴 수 없습니다. 한 번 더 누르세요" : "기억 모두 비우기"}
        </button>
      )}
    </Group>
  );
}

export function MemoryConfig({
  node,
  doc,
  scope,
  refreshKey,
  onChange,
  onChangeKind,
  onAttach,
  onDelete,
  onSelectNode,
  onPatchNode,
  lastRun,
}: {
  node: DifyNode;
  doc: DslDoc;
  /** 저장소 범위(프로젝트 ID) */
  scope: string;
  refreshKey: number;
  onChange: (patch: Record<string, unknown>) => void;
  onChangeKind: (kind: MemoryKind) => void;
  /** LLM 노드에 붙이기. null 이면 떼기 */
  onAttach: (llmId: string | null) => void;
  onDelete: () => void;
  onSelectNode: (id: string) => void;
  /** 다른 노드(붙은 LLM)의 설정을 고친다 */
  onPatchNode: (id: string, patch: Record<string, unknown>) => void;
  /** 고른 대화 턴에서 이 모듈이 LLM 에 실제로 넘긴 값 */
  lastRun?: { context: string; messages: number | null };
}) {
  const { nodes, edges } = graphOf(doc);
  const cfg = readMemory(node);
  const info = memoryKindInfo(cfg.kind);
  const members = membersOf(nodes, node.id);
  const zones = zonesOf(nodes, edges, node.id);
  const [dreamTick, setDreamTick] = useState(0);
  const llmId = attachedLlm(edges, node.id);
  const llm = nodes.find((n) => n.id === llmId);
  const llms = nodes.filter((n) => n.data.type === "llm" && n.parentId !== node.id);
  const warnings = memoryWarnings(nodes, edges, node.id);
  const [pendingKind, setPendingKind] = useState<MemoryKind | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const setMemory = (patch: Record<string, unknown>) => onChange({ memory: { ...(node.data.memory as object), ...patch } });

  // 읽기 결과로 고를 수 있는 변수: 읽기 구역 노드의 출력
  const readVars = members
    .filter((m) => zones.get(m.id) === "read")
    .flatMap((m) => outputsOf(m).map((o) => ({ selector: [m.id, ...o.name.split(".")], label: `${m.data.title || m.data.type} › ${o.name}`, type: o.type })));
  const varSelect = (value: ValueSelector, onPick: (sel: ValueSelector) => void, filter: (type: string) => boolean, none: string) => {
    const key = value.join(".");
    const options = readVars.filter((v) => filter(v.type));
    return (
      <select value={key} onChange={(e) => onPick(e.target.value ? e.target.value.split(".") : [])} className={smallInput}>
        <option value="">{none}</option>
        {key && !options.some((o) => o.selector.join(".") === key) && <option value={key}>{key} (읽기 구역에 없음)</option>}
        {options.map((o) => (
          <option key={o.selector.join(".")} value={o.selector.join(".")}>
            {o.label} ({o.type})
          </option>
        ))}
      </select>
    );
  };
  const zoneChips = (zone: "read" | "write" | null, empty: string) => {
    const list = members.filter((m) => (zones.get(m.id) ?? null) === zone).sort((a, b) => (a.position?.x ?? 0) - (b.position?.x ?? 0));
    return list.length ? (
      <div className="space-y-1">
        {list.map((m, i) => (
          <NodeRow key={m.id} node={m} step={zone ? i + 1 : undefined} onClick={() => onSelectNode(m.id)} />
        ))}
      </div>
    ) : (
      <span className="text-[12px] text-ink-4">{empty}</span>
    );
  };
  const toolNodes = members.filter((m) => m.data.type === MEMORY_TOOL);
  const strays = members.filter((m) => !zones.has(m.id) && m.data.type !== MEMORY_TOOL);

  return (
    <div>
      <Group title="메모리 모듈">
        <Field label="이름">
          <input value={String(node.data.title ?? "")} onChange={(e) => onChange({ title: e.target.value })} className={smallInput} />
        </Field>
        <Field label="종류">
          <select
            value={pendingKind ?? cfg.kind}
            onChange={(e) => setPendingKind(e.target.value === cfg.kind ? null : (e.target.value as MemoryKind))}
            className={smallInput}
          >
            {MEMORY_KINDS.map((k) => (
              <option key={k.kind} value={k.kind}>
                {k.name} · {k.horizon}
              </option>
            ))}
          </select>
        </Field>
        {pendingKind ? (
          <div className="rounded-lg bg-[#fef3c7] px-2.5 py-2 text-[12px] leading-snug text-[#92400e]">
            ‘{memoryKindInfo(pendingKind).name}’(으)로 바꾸면 안의 노드 {members.length}개를 지우고 새 종류의 구현으로 갈아 끼웁니다. 고쳐 둔 내용은 사라집니다. 저장된 기억은 지우지 않습니다.
            <div className="mt-1.5 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  onChangeKind(pendingKind);
                  setPendingKind(null);
                }}
                className="rounded-md bg-[#92400e] px-2 py-0.5 text-[12px] font-semibold text-white hover:brightness-110"
              >
                바꾸기
              </button>
              <button type="button" onClick={() => setPendingKind(null)} className="rounded-md px-2 py-0.5 text-[12px] font-medium text-[#92400e] hover:bg-[#fde68a]">
                취소
              </button>
            </div>
          </div>
        ) : (
          <dl className="grid grid-cols-[76px_minmax(0,1fr)] gap-x-2 gap-y-1 text-[12px] leading-snug">
            <dt className="text-ink-3">하는 일</dt>
            <dd className="text-ink-2">{info.hint}</dd>
            <dt className="text-ink-3">기억 범위</dt>
            <dd className="text-ink-2">{info.horizon}</dd>
            <dt className="text-ink-3">추가 LLM 호출</dt>
            <dd className="text-ink-2">{info.cost}</dd>
            <dt className="text-ink-3">대표 구현</dt>
            <dd className="text-ink-2">{info.source}</dd>
          </dl>
        )}
      </Group>

      <Group title="붙은 LLM 노드" help="아래에서 고르거나, 모듈 위쪽 ◆ 점을 LLM 노드 아래쪽 ◆ 점으로 끌어 붙입니다. 떼거나 모듈을 지워도 LLM은 원래대로 동작합니다.">
        {warnings.includes("LLM 미연결") && (
          <div className="flex items-start gap-1.5 rounded-lg bg-[#fef3c7] px-2.5 py-2 text-[12px] leading-snug text-[#92400e]">
            <CircleAlert size={13} className="mt-px shrink-0" />
            <span>아직 어느 LLM에도 붙지 않아 실행되지 않습니다.</span>
          </div>
        )}
        <div className="flex items-center gap-2">
          <select value={llmId ?? ""} onChange={(e) => onAttach(e.target.value || null)} className={smallInput} aria-label="붙일 LLM 노드">
            <option value="">(붙이지 않음)</option>
            {llms.map((n) => (
              <option key={n.id} value={n.id}>
                {n.data.title || "LLM"}
              </option>
            ))}
          </select>
          {llm && (
            <button
              type="button"
              onClick={() => onAttach(null)}
              className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-line px-2 py-1 text-[12px] font-medium text-ink-2 hover:bg-paper-2"
              title="선만 끊습니다. 모듈과 저장된 기억은 남습니다."
            >
              <Unlink size={12} />
              떼기
            </button>
          )}
        </div>
        {/* 실행 순서: LLM 호출 앞에 읽기 구역, 응답 뒤에 쓰기 구역이 끼워진다 */}
        <div className="flex items-center gap-1.5 text-[12px]" role="img" aria-label={`실행 순서: 읽기 구역, ${llm ? String(llm.data.title || "LLM") : "LLM"}, 쓰기 구역`}>
          <span className="shrink-0 rounded-md border border-line bg-paper-2 px-1.5 py-0.5 text-ink-2">읽기 구역</span>
          <ArrowRight size={12} className="shrink-0 text-ink-4" aria-hidden />
          <span className={`min-w-0 truncate rounded-md border px-1.5 py-0.5 ${llm ? "border-line bg-surface font-medium text-ink" : "border-dashed border-line text-ink-4"}`}>{llm ? String(llm.data.title || "LLM") : "LLM"}</span>
          <ArrowRight size={12} className="shrink-0 text-ink-4" aria-hidden />
          <span className="shrink-0 rounded-md border border-line bg-paper-2 px-1.5 py-0.5 text-ink-2">쓰기 구역</span>
        </div>
      </Group>

      {llm && (
        <Group title="LLM이 받는 전체 프롬프트" help={<>변수 참조({"{{#…#}}"})는 실행할 때 값으로 바뀝니다. 사실 추출, 통합 판단 같은 모듈 안의 판단용 프롬프트는 아래 ‘구현 · 안의 노드’에서 해당 노드를 눌러 고칩니다.</>}>
          <FullPrompt
            llm={llm}
            cfg={cfg}
            contextSource={members.find((m) => m.id === cfg.context[0])}
            lastRun={lastRun}
            onPatchLlm={(patch) => onPatchNode(llm.id, patch)}
            onHeader={(header) => setMemory({ header })}
            onOpenSource={onSelectNode}
          />
        </Group>
      )}

      <Group title="LLM에 넘길 읽기 결과">
        <Field label="프롬프트에 넣을 글" help="시스템 프롬프트 끝에 머리말과 함께 붙습니다.">
          {varSelect(cfg.context, (sel) => setMemory({ context: sel }), (t) => !t.startsWith("array"), "(넣지 않음)")}
        </Field>
        <Field
          label="이전 대화"
          help="지정하면 LLM 노드의 ‘이전 대화 포함’ 설정 대신 이 메시지 배열이 들어갑니다. 지정하지 않으면 그 설정을 그대로 씁니다. 긴 기억 종류는 최근 대화를 따로 넣지 않으니 그 설정을 함께 켜 두세요."
        >
          {varSelect(cfg.history, (sel) => setMemory({ history: sel }), (t) => t.startsWith("array"), "(LLM 노드 설정 사용)")}
        </Field>
        {(warnings.includes("읽기 결과 미지정") || warnings.includes("읽기 결과 변수 없음")) && (
          <p className="text-[12px] text-[#b45309]">읽기 결과가 지정되지 않았거나 가리키는 노드가 없습니다. 이대로면 LLM에 아무 기억도 들어가지 않습니다.</p>
        )}
      </Group>

      <Group
        title="구현 · 안의 노드"
        help={
          <>
            노드를 누르면 프롬프트·코드·상수(턴 수, 상위 개수 등)를 고칠 수 있습니다. 모듈 안에서 쓰는 변수는 <span className="font-mono text-[11px]">query</span>(질문), <span className="font-mono text-[11px]">history</span>(이전 대화), <span className="font-mono text-[11px]">answer</span>(응답, 쓰기 구역만), <span className="font-mono text-[11px]">today</span>, <span className="font-mono text-[11px]">now</span>입니다.
          </>
        }
      >
        <div className="space-y-2">
          <div>
            <div className="mb-1 text-[12px] font-medium text-ink-3">읽기 (LLM 호출 전)</div>
            {zoneChips("read", "읽기 시작에 이어진 노드가 없습니다.")}
          </div>
          <div>
            <div className="mb-1 text-[12px] font-medium text-ink-3">쓰기 (LLM 응답 뒤)</div>
            {zoneChips("write", toolNodes.length ? "쓰기 구역 없이 모델이 메모리 도구로 직접 저장합니다." : "저장하지 않는 종류입니다.")}
          </div>
          {toolNodes.length > 0 && (
            <div>
              <div className="mb-1 text-[12px] font-medium text-ink-3">모델이 응답 도중 직접 호출하는 도구</div>
              <div className="space-y-1">
                {toolNodes.map((m) => (
                  <NodeRow key={m.id} node={m} onClick={() => onSelectNode(m.id)} />
                ))}
              </div>
            </div>
          )}
          {strays.length > 0 && (
            <div>
              <div className="mb-1 text-[12px] font-medium text-[#b45309]">어느 구역에도 이어지지 않아 실행되지 않습니다</div>
              <div className="space-y-1">
                {strays.map((m) => (
                  <NodeRow key={m.id} node={m} onClick={() => onSelectNode(m.id)} />
                ))}
              </div>
            </div>
          )}
        </div>
      </Group>

      <Group title="저장소">
        <Field label="저장소 이름" help="같은 프로젝트에서 이름이 같으면 같은 기억을 씁니다. 대화를 새로 시작해도 남습니다.">
          <input value={cfg.store} onChange={(e) => setMemory({ store: e.target.value })} className={smallInput} />
        </Field>
      </Group>
      <StoreContents scope={scope} store={cfg.store} refreshKey={refreshKey + dreamTick} />
      <DreamGroup key={cfg.store} scope={scope} store={cfg.store} model={llm?.data.model} onChanged={() => setDreamTick((t) => t + 1)} />

      <Group title="모양">
        <BlockColorPicker value={blockColor(node)} onPick={(c) => onChange({ color: c })} />
      </Group>

      <div className="px-4 py-4">
        <button
          type="button"
          onClick={() => (confirmDelete ? onDelete() : setConfirmDelete(true))}
          onBlur={() => setConfirmDelete(false)}
          className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[12px] font-medium ${
            confirmDelete ? "border-err bg-err text-white" : "border-err/30 text-err hover:bg-err/6"
          }`}
        >
          <Trash2 size={13} />
          {confirmDelete ? `안의 노드 ${members.length}개까지 삭제합니다. 한 번 더 누르세요` : "메모리 모듈 삭제"}
        </button>
        <p className="mt-1.5 text-[11px] leading-snug text-ink-3">모듈을 지워도 저장된 기억은 남습니다.</p>
      </div>
    </div>
  );
}
