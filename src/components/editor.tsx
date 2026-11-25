"use client";

import { ArrowLeft, Check, Cloud, CloudOff, Download, FileCode, LoaderCircle, Redo2, Settings2, Undo2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { addBlock, deleteBlockWithMembers, groupIntoBlock, isBlock, placeNodes, resizeBlock, ungroupBlock } from "@/lib/dsl/blocks";
import { toDifyCompatible } from "@/lib/dsl/compat";
import { addEdge, addNode, graphOf, removeEdges, removeNodes, updateNodeData } from "@/lib/dsl/edit";
import { ErrorBoundary } from "./error-boundary";
import { MEMORY_PORT, MEMORY_STORE, attachedLlm, isAttachEdge, isMemoryBlock, readEndId } from "@/lib/dsl/memory";
import { addMemoryModule, changeMemoryKind } from "@/lib/dsl/memory-presets";
import { dumpDoc, parseDsl } from "@/lib/dsl/parse";
import type { DslDoc, Workflow } from "@/lib/dsl/types";
import type { ChatTurn } from "@/lib/engine/types";
import { PROVIDER_IDS, resolveModelConfig, type ProviderId } from "@/lib/llm/catalog";
import { streamRun } from "@/lib/client/run-stream";
import { AppSettingsModal } from "./app-settings-modal";
import { BlockConfig } from "./block-config";
import { ChatPanel } from "./chat-panel";
import { FlowCanvas, type CanvasEditHandlers } from "./flow-canvas";
import { Inspector, type InspectorTab } from "./inspector";
import { NodeConfig } from "./node-config";
import { MemoryConfig } from "./memory-config";
import { LlmStatusPill, SettingsModal, useLlmSettings } from "./settings-modal";
import type { AssistantMessage, ChatMessage, Selection } from "./types";
import { Button, Help, Modal } from "./ui";

const uid = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Math.random()).slice(2));
type SaveState = "saved" | "dirty" | "saving" | "error";

function SaveIndicator({ state, error }: { state: SaveState; error?: string }) {
  if (state === "saving" || state === "dirty")
    return (
      <span className="inline-flex items-center gap-1 text-[12px] text-ink-3">
        <LoaderCircle size={12} className="animate-spin" /> 저장 중
      </span>
    );
  if (state === "error")
    return (
      <span className="inline-flex items-center gap-1 text-[12px] text-err" title={error}>
        <CloudOff size={12} /> 저장 실패{error ? `: ${error}` : ""}
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 text-[12px] text-ink-3">
      <Cloud size={12} /> 저장됨
    </span>
  );
}

export function Editor({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [doc, setDoc] = useState<DslDoc | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [saveError, setSaveError] = useState<string>();
  const latest = useRef<DslDoc | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const { settings, setSettings } = useLlmSettings();
  const [datasets, setDatasets] = useState<{ id: string; name: string; chunkCount: number }[]>([]);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [selection, setSelection] = useState<Selection>(null);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("config");
  const [focusRequest, setFocusRequest] = useState<{ nodeId: string; nonce: number }>();
  const [running, setRunning] = useState(false);
  const [conversationVariables, setConversationVariables] = useState<Record<string, unknown>>({});
  const conversationId = useRef("");
  const abortRef = useRef<AbortController | null>(null);

  const [tab, setTab] = useState<"graph" | "inspector" | "chat">("graph");
  const [modal, setModal] = useState<"app" | "api" | "yaml" | null>(null);
  const [flatExport, setFlatExport] = useState(false);

  useEffect(() => {
    fetch(`/api/projects/${projectId}`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
        latest.current = j.dsl;
        setDoc(j.dsl);
      })
      .catch((e) => setLoadError((e as Error).message));
    fetch("/api/datasets")
      .then((r) => r.json())
      .then((j) => setDatasets(j.datasets ?? []))
      .catch(() => {});
  }, [projectId]);

  // ── 저장 ──
  const flush = useCallback(async () => {
    clearTimeout(saveTimer.current);
    if (!latest.current) return;
    setSaveState("saving");
    try {
      const r = await fetch(`/api/projects/${projectId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dsl: latest.current }),
      });
      if (!r.ok) throw new Error((await r.json()).error ?? `HTTP ${r.status}`);
      setSaveState("saved");
      setSaveError(undefined);
    } catch (e) {
      setSaveState("error");
      setSaveError((e as Error).message);
    }
  }, [projectId]);

  // ── 실행 취소 이력 ── 자동 저장이라 실수가 바로 파일에 남는다. 되돌릴 길을 항상 둔다.
  const past = useRef<DslDoc[]>([]);
  const future = useRef<DslDoc[]>([]);
  const lastPush = useRef(0);
  const [historyTick, setHistoryTick] = useState(0);
  const [toast, setToast] = useState<string | null>(null);

  const write = (next: DslDoc) => {
    latest.current = next;
    setDoc(next);
    setSaveState("dirty");
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(flush, 600);
  };
  const commit = (next: DslDoc) => {
    const now = Date.now();
    // 글자를 이어서 치는 동안은 한 단계로 묶는다
    if (latest.current && latest.current !== next && now - lastPush.current > 700) {
      past.current.push(latest.current);
      if (past.current.length > 100) past.current.shift();
    }
    lastPush.current = now;
    future.current = [];
    setHistoryTick((t) => t + 1);
    write(next);
  };
  const step = (from: DslDoc[], to: DslDoc[]) => {
    const target = from.pop();
    if (!target || !latest.current) return;
    to.push(latest.current);
    lastPush.current = 0;
    setHistoryTick((t) => t + 1);
    setToast(null);
    write(target);
    // 되돌린 문서에 없는 노드를 고르고 있었다면 선택을 푼다
    setSelection((sel) => (sel?.nodeId && !graphOf(target).nodes.some((n) => n.id === sel.nodeId) ? null : sel));
  };
  const undo = () => step(past.current, future.current);
  const redo = () => step(future.current, past.current);
  const undoRef = useRef({ undo, redo });
  undoRef.current = { undo, redo };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k !== "z" && k !== "y") return;
      // 입력란 안에서는 브라우저의 글자 되돌리기를 그대로 둔다
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      e.preventDefault();
      if (k === "y" || e.shiftKey) undoRef.current.redo();
      else undoRef.current.undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  const parsed = useMemo((): { wf?: Workflow; error?: string } => {
    if (!doc) return {};
    try {
      return { wf: parseDsl(doc) };
    } catch (e) {
      return { error: (e as Error).message };
    }
  }, [doc]);
  const workflow = parsed.wf;
  const nodesById = useMemo(() => new Map((workflow?.nodes ?? []).map((n) => [n.id, n])), [workflow]);

  // 공급자별 키 보유 여부와, 이 워크플로가 쓰는데 키가 없는 공급자
  const keys = useMemo(
    () => Object.fromEntries(PROVIDER_IDS.map((p) => [p, !!settings?.providers[p]?.hasKey])) as Record<ProviderId, boolean>,
    [settings],
  );
  const missingKeys = useMemo(() => {
    if (!workflow || !settings || settings.mock) return [];
    const used = new Set<ProviderId>();
    for (const n of workflow.nodes) {
      const usesLlm = ["llm", "question-classifier", "parameter-extractor"].includes(n.data.type) || (n.data.type === "switch" && n.data.mode === "ai");
      if (usesLlm) used.add(resolveModelConfig(n.data.model).provider);
    }
    return [...used].filter((p) => !keys[p]);
  }, [workflow, settings, keys]);

  // ── 대화 ──
  const resetConversation = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]);
    setSelection((s) => (s?.nodeId ? { messageId: "", nodeId: s.nodeId } : null));
    setConversationVariables({});
    conversationId.current = "";
  }, []);

  const assistantMessages = messages.filter((m): m is AssistantMessage => m.role === "assistant");
  const focused: AssistantMessage | undefined =
    (selection?.messageId ? assistantMessages.find((m) => m.id === selection.messageId) : undefined) ??
    assistantMessages[assistantMessages.length - 1];

  const send = async (query: string, inputs: Record<string, unknown>) => {
    if (!doc || !workflow || running) return;
    const history: ChatTurn[] = messages.filter((m) => m.content).map((m) => ({ role: m.role, content: m.content }));
    const hadSelection = !!selection?.nodeId || !!selection?.pool;
    conversationId.current ||= uid();
    const asstId = uid();
    const assistant: AssistantMessage = { id: asstId, role: "assistant", content: "", status: "running", runs: [], live: {} };
    setMessages((prev) => [...prev, { id: uid(), role: "user", content: query, inputs }, assistant]);
    setSelection((prev) => (prev?.nodeId ? { messageId: asstId, nodeId: prev.nodeId } : null));
    setRunning(true);

    const update = (fn: (m: AssistantMessage) => AssistantMessage) =>
      setMessages((prev) => prev.map((m) => (m.id === asstId ? fn(m as AssistantMessage) : m)));
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    let finalRuns: AssistantMessage["runs"] = [];
    try {
      await streamRun(
        { dsl: doc, query, inputs, history, conversationId: conversationId.current, conversationVariables, memoryScope: projectId },
        (ev) => {
          switch (ev.event) {
            case "workflow_started":
              update((m) => ({ ...m, llmMode: ev.llmMode }));
              break;
            case "node_started":
              update((m) => ({ ...m, runs: [...m.runs, ev.run] }));
              break;
            case "node_progress":
              update((m) => {
                const cur = m.live[ev.runId] ?? { text: "", thinking: "" };
                const next = ev.kind === "text" ? { ...cur, text: cur.text + ev.delta } : { ...cur, thinking: cur.thinking + ev.delta };
                return { ...m, live: { ...m.live, [ev.runId]: next } };
              });
              break;
            case "node_finished":
              update((m) => {
                const runs = m.runs.map((r) => (r.id === ev.run.id ? ev.run : r));
                finalRuns = runs;
                return { ...m, runs };
              });
              break;
            case "message":
              update((m) => ({ ...m, content: m.content ? `${m.content}\n\n${ev.answer}` : ev.answer }));
              break;
            case "workflow_finished":
              update((m) => ({
                ...m,
                status: ev.status,
                error: ev.error,
                elapsedMs: ev.elapsedMs,
                totalTokens: ev.totalTokens,
                variablePool: ev.variablePool,
                content: m.content || (ev.status === "succeeded" && !("answer" in ev.outputs) ? JSON.stringify(ev.outputs, null, 2) : m.content),
              }));
              setConversationVariables(ev.conversationVariables);
              break;
          }
        },
        ctrl.signal,
      );
    } catch (e) {
      const aborted = ctrl.signal.aborted;
      update((m) => ({
        ...m,
        status: aborted ? "stopped" : "failed",
        error: aborted ? "실행을 중단했습니다." : (e as Error).message,
        runs: m.runs.map((r) => (r.status === "running" ? { ...r, status: "failed", error: "중단됨" } : r)),
      }));
    } finally {
      setRunning(false);
      abortRef.current = null;
      // 보고 있던 노드가 없으면 실패한 노드나 마지막 LLM 계열 노드의 실행 기록을 열어 준다
      if (!hadSelection) {
        const failed = finalRuns.find((r) => r.status === "failed");
        const pick = failed ?? [...finalRuns].reverse().find((r) => ["llm", "question-classifier", "parameter-extractor"].includes(r.nodeType));
        if (pick) {
          setSelection({ messageId: asstId, nodeId: pick.nodeId });
          setInspectorTab("trace");
        }
      }
    }
  };

  // ── 편집 핸들러 ──
  const selectFromCanvas = (nodeId: string) => {
    const hasRun = focused?.runs.some((r) => r.nodeId === nodeId);
    if (!hasRun) setInspectorTab("config");
    setSelection({ messageId: focused?.id ?? "", nodeId });
    setTab("inspector");
  };

  const selectFromChat = (s: Selection) => {
    setSelection(s);
    if (s?.nodeId) {
      setInspectorTab("trace");
      setFocusRequest({ nodeId: s.nodeId, nonce: Date.now() });
    }
    setTab("inspector");
  };

  /** 최신 문서에 변경을 적용한다 — 한 번의 조작에서 핸들러가 여러 번 불려도(노드·선 동시 삭제 등) 서로 덮어쓰지 않는다 */
  const apply = (fn: (d: DslDoc) => DslDoc) => {
    if (latest.current) commit(fn(latest.current));
  };
  const openConfig = (nodeId: string) => {
    setSelection({ messageId: focused?.id ?? "", nodeId });
    setInspectorTab("config");
    setTab("inspector");
  };
  const patchNode = (id: string, patch: Record<string, unknown>) =>
    apply((d) => {
      const n = graphOf(d).nodes.find((x) => x.id === id);
      return n ? updateNodeData(d, id, { ...n.data, ...patch }) : d;
    });
  const dropSelectionIf = (ids: string[]) => {
    if (selection?.nodeId && ids.includes(selection.nodeId)) setSelection(null);
  };

  const edit: CanvasEditHandlers = {
    onPlaceNodes: (moves, sizes) => apply((d) => placeNodes(d, moves, sizes)),
    onDeleteNodes: (ids) => {
      const before = latest.current ? graphOf(latest.current).nodes.length : 0;
      apply((d) => removeNodes(d, ids));
      dropSelectionIf(ids);
      const gone = before - (latest.current ? graphOf(latest.current).nodes.length : 0);
      if (gone > 0) setToast(`노드 ${gone}개 삭제`);
    },
    onConnect: (c) => apply((d) => addEdge(d, c)),
    onDeleteEdges: (ids) => apply((d) => removeEdges(d, ids)),
    onAddNode: (type, position, opts) => {
      if (!latest.current) return;
      const r = addNode(latest.current, type, position, opts?.parentId);
      commit(opts?.connectFrom ? addEdge(r.doc, { source: opts.connectFrom.id, sourceHandle: opts.connectFrom.handle, target: r.id }) : r.doc);
      openConfig(r.id);
      setTimeout(() => setFocusRequest({ nodeId: r.id, nonce: Date.now() }), 50);
    },
    onAddBlock: (position) => {
      if (!latest.current) return;
      const r = addBlock(latest.current, position);
      commit(r.doc);
      openConfig(r.id);
    },
    onAddMemory: (kind, position, llmId) => {
      if (!latest.current) return;
      const r = addMemoryModule(latest.current, kind, position, llmId);
      commit(r.doc);
      openConfig(r.id);
      setTimeout(() => setFocusRequest({ nodeId: r.id, nonce: Date.now() }), 50);
    },
    onGroup: (ids, sizes) => {
      if (!latest.current) return;
      const r = groupIntoBlock(latest.current, ids, sizes);
      if (!r) return;
      commit(r.doc);
      openConfig(r.id);
    },
    onUpdateNodeData: patchNode,
    onResizeBlock: (id, rect, sizes) => apply((d) => resizeBlock(d, id, rect, sizes)),
    onUngroup: (id) => {
      apply((d) => ungroupBlock(d, id));
      dropSelectionIf([id]);
    },
  };

  const back = async () => {
    if (saveState !== "saved") await flush();
    router.push("/");
  };

  /** 블록·분기 노드는 이 앱 전용 확장 — Dify로 가져갈 때는 Dify 노드로 바꿔서 내보낸다 */
  const hasExtensions = !!doc && graphOf(doc).nodes.some((n) => isBlock(n) || n.data.type === "switch" || n.data.type === MEMORY_STORE || n.data.type === "memory-tool" || (n.data.type === "llm" && !!n.data.tools));
  const compat = modal === "yaml" && doc && hasExtensions && flatExport ? toDifyCompatible(doc) : null;
  const exportText = () => (doc ? dumpDoc(compat ? compat.doc : doc) : "");
  const exportYaml = () => {
    if (!doc) return;
    const blob = new Blob([exportText()], { type: "text/yaml;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${workflow?.name ?? "workflow"}.yml`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  if (loadError) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-3 bg-paper text-sm text-ink-2">
        <div>프로젝트를 열 수 없습니다: {loadError}</div>
        <Link href="/" className="text-accent hover:underline">
          ← 프로젝트 목록으로
        </Link>
      </div>
    );
  }
  if (!doc) {
    return (
      <div className="flex h-dvh items-center justify-center gap-2 bg-paper text-sm text-ink-3">
        <LoaderCircle size={16} className="animate-spin" /> 프로젝트 여는 중…
      </div>
    );
  }

  const selectedNode = selection?.nodeId ? graphOf(doc).nodes.find((n) => n.id === selection.nodeId) : undefined;
  const inspectorOpen = !!selection && (!!selectedNode || !!selection.pool);
  const finished = !!focused && focused.status !== "running";
  const app = (doc.app ?? {}) as Record<string, unknown>;

  return (
    <div className="flex h-dvh flex-col bg-paper text-ink">
      {/* ── 헤더 ── */}
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line bg-surface px-3 py-2">
        <button type="button" onClick={back} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[13px] text-ink-3 hover:bg-paper-2 hover:text-ink">
          <ArrowLeft size={15} />
          프로젝트
        </button>
        <div className="h-5 w-px bg-line" />
        <button type="button" onClick={() => setModal("app")} className="flex min-w-0 items-center gap-2 rounded-md px-1.5 py-1 hover:bg-paper-2" title="앱 설정">
          <span className="text-lg leading-none">{String(app.icon ?? "🤖")}</span>
          <span className="truncate text-[15px] font-semibold">{String(app.name ?? "")}</span>
        </button>
        <SaveIndicator state={saveState} error={saveError} />
        <div className="flex items-center" data-history={historyTick}>
          <button
            type="button"
            onClick={undo}
            disabled={past.current.length === 0}
            aria-label="실행 취소"
            title="실행 취소 (Ctrl+Z)"
            className="rounded-md p-1.5 text-ink-3 hover:bg-paper-2 hover:text-ink disabled:pointer-events-none disabled:opacity-35"
          >
            <Undo2 size={15} />
          </button>
          <button
            type="button"
            onClick={redo}
            disabled={future.current.length === 0}
            aria-label="다시 실행"
            title="다시 실행 (Ctrl+Shift+Z)"
            className="rounded-md p-1.5 text-ink-3 hover:bg-paper-2 hover:text-ink disabled:pointer-events-none disabled:opacity-35"
          >
            <Redo2 size={15} />
          </button>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button onClick={() => setModal("app")} className="hidden md:inline-flex">
            <Settings2 size={14} />앱 설정
          </Button>
          <Button onClick={() => setModal("yaml")} className="hidden md:inline-flex">
            <FileCode size={14} />
            DSL
          </Button>
          <LlmStatusPill settings={settings} onClick={() => setModal("api")} />
        </div>
      </header>

      <nav className="flex border-b border-line bg-surface text-xs font-medium lg:hidden">
        {(
          [
            ["graph", "워크플로"],
            ["inspector", "노드"],
            ["chat", "채팅"],
          ] as const
        ).map(([k, label]) => (
          <button key={k} type="button" onClick={() => setTab(k)} className={`flex-1 border-b-2 py-2 ${tab === k ? "border-accent text-ink" : "border-transparent text-ink-3"}`}>
            {label}
          </button>
        ))}
      </nav>

      <main className="flex min-h-0 flex-1">
        <section className={`relative min-w-0 flex-1 ${tab === "graph" ? "block" : "hidden"} lg:block`}>
          {parsed.error && <div className="m-4 rounded-lg border border-err/30 bg-err/6 p-3 text-sm text-err">DSL 오류: {parsed.error}</div>}
          {toast && (
            <div role="status" className="absolute bottom-4 left-1/2 z-30 flex -translate-x-1/2 items-center gap-3 rounded-lg bg-ink py-1.5 pr-1.5 pl-3 text-[13px] text-white shadow-lg">
              {toast}
              <button type="button" onClick={undo} className="rounded-md bg-white/15 px-2.5 py-1 text-[12px] font-semibold hover:bg-white/25">
                실행 취소
              </button>
            </div>
          )}
          {workflow && (
            <ErrorBoundary label="캔버스">
              <FlowCanvas
                workflow={workflow}
                runs={focused?.runs ?? []}
                finished={finished}
                selectedNodeId={selection?.nodeId}
                onSelectNode={selectFromCanvas}
                focusRequest={focusRequest}
                edit={edit}
              />
            </ErrorBoundary>
          )}
        </section>

        <aside
          className={`min-h-0 w-full border-l border-line bg-surface lg:w-[440px] lg:shrink-0 ${tab === "inspector" ? "block" : "hidden"} ${
            inspectorOpen ? "lg:block" : "lg:hidden"
          }`}
        >
          {inspectorOpen ? (
            <ErrorBoundary key={selection?.nodeId ?? "pool"} label="설정 패널">
            <Inspector
              key={selection?.nodeId ?? "pool"}
              nodes={nodesById}
              message={selection?.messageId ? assistantMessages.find((m) => m.id === selection.messageId) : undefined}
              nodeId={selection?.nodeId}
              showPool={!!selection?.pool}
              onClose={() => setSelection(null)}
              tab={inspectorTab}
              onTabChange={setInspectorTab}
              onJump={(nodeId) => selectFromChat({ messageId: selection?.messageId || focused?.id || "", nodeId })}
              config={
                selectedNode &&
                (isMemoryBlock(selectedNode) ? (
                  <MemoryConfig
                    key={selectedNode.id}
                    node={selectedNode}
                    doc={doc}
                    scope={projectId}
                    refreshKey={messages.filter((m) => m.role === "assistant" && m.status !== "running").length}
                    onChange={(patch) => patchNode(selectedNode.id, patch)}
                    onChangeKind={(kind) => apply((d) => changeMemoryKind(d, selectedNode.id, kind))}
                    onAttach={(llmId) =>
                      apply((d) => {
                        if (llmId) return addEdge(d, { source: selectedNode.id, sourceHandle: MEMORY_PORT.attach, target: llmId, targetHandle: MEMORY_PORT.llm });
                        const g = graphOf(d);
                        return attachedLlm(g.edges, selectedNode.id)
                          ? removeEdges(d, g.edges.filter((e) => e.source === selectedNode.id && isAttachEdge(e)).map((e) => e.id ?? ""))
                          : d;
                      })
                    }
                    onDelete={() => {
                      apply((d) => deleteBlockWithMembers(d, selectedNode.id));
                      setSelection(null);
                    }}
                    onSelectNode={openConfig}
                    onPatchNode={patchNode}
                    lastRun={(() => {
                      const out = focused?.runs.findLast((r) => r.nodeId === readEndId(selectedNode.id) && r.status === "succeeded")?.outputs;
                      return out ? { context: String(out.context ?? ""), messages: Array.isArray(out.messages) ? out.messages.length : null } : undefined;
                    })()}
                  />
                ) : isBlock(selectedNode) ? (
                  <BlockConfig
                    key={selectedNode.id}
                    node={selectedNode}
                    doc={doc}
                    onChange={(patch) => patchNode(selectedNode.id, patch)}
                    onUngroup={() => edit.onUngroup(selectedNode.id)}
                    onDeleteAll={() => {
                      apply((d) => deleteBlockWithMembers(d, selectedNode.id));
                      setSelection(null);
                    }}
                    onSelectNode={openConfig}
                  />
                ) : (
                  <NodeConfig
                    key={selectedNode.id}
                    node={selectedNode}
                    doc={doc}
                    keys={keys}
                    datasets={datasets}
                    onChange={(data) => commit(updateNodeData(doc, selectedNode.id, data))}
                    onDelete={() => edit.onDeleteNodes([selectedNode.id])}
                  />
                ))
              }
            />
            </ErrorBoundary>
          ) : (
            <div className="p-6 text-center text-xs text-ink-3">캔버스에서 노드를 선택하면 설정과 실행 기록이 표시됩니다.</div>
          )}
        </aside>

        <aside className={`min-h-0 w-full border-l border-line bg-surface lg:w-[390px] lg:shrink-0 ${tab === "chat" ? "block" : "hidden"} lg:block`}>
          {workflow && (
            <ChatPanel
              key={projectId}
              workflow={workflow}
              messages={messages}
              running={running}
              selection={selection}
              onSelect={selectFromChat}
              onSend={send}
              onStop={() => abortRef.current?.abort()}
              onReset={resetConversation}
              missingKeys={missingKeys}
              mock={!!settings?.mock}
              onOpenSettings={() => setModal("api")}
              conversationVariables={conversationVariables}
            />
          )}
        </aside>
      </main>

      {modal === "app" && <AppSettingsModal doc={doc} onClose={() => setModal(null)} onSave={commit} />}
      {modal === "api" && settings && <SettingsModal settings={settings} onClose={() => setModal(null)} onSaved={setSettings} />}
      {modal === "yaml" && (
        <Modal
          title="Dify DSL (YAML)"
          onClose={() => setModal(null)}
          footer={
            <>
              {hasExtensions && (
                <span className="mr-auto flex items-center gap-1.5 text-[12px] text-ink-2">
                  <label className="flex cursor-pointer items-center gap-2 whitespace-nowrap">
                    <input type="checkbox" checked={flatExport} onChange={(e) => setFlatExport(e.target.checked)} className="accent-accent" />
                    Dify 호환으로 내보내기
                  </label>
                  <Help>블록·분기 노드·메모리 모듈은 이 앱 전용입니다. 켜면 블록은 풀고, 분기 노드는 IF/ELSE·질문 분류기·코드 노드로 바꾸고, 메모리 모듈은 뺍니다.</Help>
                </span>
              )}
              <Button
                onClick={() => {
                  navigator.clipboard?.writeText(exportText());
                }}
              >
                <Check size={14} />
                복사
              </Button>
              <Button kind="primary" onClick={exportYaml}>
                <Download size={14} />
                .yml 내려받기
              </Button>
            </>
          }
        >
          {compat && compat.notes.length > 0 && (
            <div className="border-b border-line bg-paper px-5 py-3 text-[12px] leading-relaxed text-warn">
              <div className="mb-1 font-semibold">변환하면서 바뀐 점</div>
              <ul className="list-disc space-y-0.5 pl-4">
                {compat.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </div>
          )}
          <pre className="bg-[#18181b] p-4 font-mono text-[12px] leading-relaxed text-[#e4e4e7]">{exportText()}</pre>
        </Modal>
      )}
    </div>
  );
}
