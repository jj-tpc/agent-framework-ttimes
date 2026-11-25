"use client";

import { Brain, Check, ChevronDown, CircleCheck, CircleX, Copy, LoaderCircle, SquareDashed, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { blockColor, exitIdOf, isBlock, isBlockRunType } from "@/lib/dsl/blocks";
import { isMemoryBlock, memoryKindInfo, readEndId, readMemory, writeEndId, writeId } from "@/lib/dsl/memory";
import { SWITCH_ELSE, SWITCH_MODES, type BranchEvaluation, type SwitchBranch, type SwitchMode } from "@/lib/dsl/switch";
import type { DifyNode } from "@/lib/dsl/types";
import type { NodeRun } from "@/lib/engine/types";
import { branchLabel, formatMs } from "@/lib/client/labels";
import { JsonTree, ValuePreview } from "./json-tree";
import { NodeIcon, nodeMeta } from "./node-meta";
import { RefChip, TemplateView } from "./template-view";
import type { AssistantMessage, LiveStream } from "./types";
import { Help } from "./ui";

type Nodes = Map<string, DifyNode>;
type Rec = Record<string, unknown>;

// ───────────────────────── 공통 조각 ─────────────────────────

function Section({
  title,
  caption,
  help,
  children,
  defaultOpen = true,
  tone,
}: {
  title: string;
  caption?: string;
  /** ⓘ 뒤에 두는 설명. 머리줄 버튼 밖에 그린다 */
  help?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  tone?: "input" | "process" | "output" | "error";
}) {
  const [open, setOpen] = useState(defaultOpen);
  const bar = {
    input: "bg-[#2563eb]",
    process: "bg-[#7c3aed]",
    output: "bg-[#16a34a]",
    error: "bg-err",
  }[tone ?? "process"];
  return (
    <section className="border-b border-line">
      <div className="flex items-center gap-2 px-4 hover:bg-paper-2/60">
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex shrink-0 items-center gap-2 py-2.5 text-left">
          {tone && <span className={`h-3.5 w-[3px] rounded-full ${bar}`} />}
          <span className="text-[12px] font-semibold tracking-wide text-ink">{title}</span>
        </button>
        {help && <Help label={`${title} 설명`}>{help}</Help>}
        {/* 머리줄 나머지 영역도 눌러서 접을 수 있게 한다. 키보드·스크린리더는 위 버튼을 쓴다 */}
        <button type="button" tabIndex={-1} aria-hidden onClick={() => setOpen(!open)} className="flex min-w-0 flex-1 items-center gap-2 py-2.5 text-left">
          {caption && <span className="truncate text-[11px] text-ink-3">{caption}</span>}
          <ChevronDown size={14} className={`ml-auto shrink-0 text-ink-4 transition-transform ${open ? "" : "-rotate-90"}`} />
        </button>
      </div>
      {open && <div className="px-4 pb-4">{children}</div>}
    </section>
  );
}

function SubHead({ children }: { children: ReactNode }) {
  return <div className="mt-3 mb-1.5 text-[11px] font-semibold text-ink-3 first:mt-0">{children}</div>;
}

function Collapsible({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 text-[11px] font-semibold text-ink-3 hover:text-ink"
      >
        <ChevronDown size={13} className={`transition-transform ${open ? "" : "-rotate-90"}`} />
        {label}
      </button>
      {open && <div className="mt-1.5 rounded-lg border border-line bg-paper-2/50 p-2">{children}</div>}
    </div>
  );
}

function TextBlock({ children, mono = false, tone }: { children: ReactNode; mono?: boolean; tone?: "muted" }) {
  return (
    <div
      className={`whitespace-pre-wrap break-words rounded-lg border border-line px-3 py-2 text-[13px] leading-relaxed ${
        mono ? "font-mono text-xs" : ""
      } ${tone === "muted" ? "bg-paper-2 text-ink-2" : "bg-surface text-ink"}`}
    >
      {children}
    </div>
  );
}

function isRefPath(key: string, nodes: Nodes) {
  const head = key.split(".")[0];
  return ["sys", "env", "conversation", "context"].includes(head) || nodes.has(head);
}

function VarTable({ entries, nodes }: { entries: [string, unknown][]; nodes: Nodes }) {
  if (entries.length === 0) return <div className="text-xs text-ink-4">읽어 들인 변수가 없습니다.</div>;
  return (
    <div className="divide-y divide-line overflow-hidden rounded-lg border border-line">
      {entries.map(([k, v]) => (
        <div key={k} className="grid grid-cols-[minmax(0,38%)_minmax(0,1fr)] gap-3 bg-surface px-3 py-2">
          <div className="min-w-0 pt-px">
            {isRefPath(k, nodes) ? <RefChip path={k} nodesById={nodes} /> : <code className="font-mono text-xs text-ink-2">{k}</code>}
          </div>
          <div className="min-w-0">
            <ValuePreview value={v} />
          </div>
        </div>
      ))}
    </div>
  );
}

function KeyVal({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="flex gap-2 py-0.5 text-xs">
      <span className="w-24 shrink-0 text-ink-3">{k}</span>
      <span className="min-w-0 flex-1 text-ink-2">{children}</span>
    </div>
  );
}

// ───────────────────────── 노드 타입별 처리 과정 ─────────────────────────

type PromptRec = { role: string; template: string; text: string; engine: string };
type ModelRec = { provider?: string; name?: string; spec?: string; params?: Rec; ignored_params?: Rec };
type ResponseRec = { api?: string; model?: string; stop_reason?: string; thinking_summary?: string; fallback?: string; raw?: string };

type ToolCallRec = { name: string; source?: string; input: unknown; output: string; is_error?: boolean; elapsed_ms?: number };
type StepRec = { step: number; stop_reason?: string | null; text?: string; tool_calls: ToolCallRec[]; cleared_results?: number };
type ToolsRec = {
  max_steps?: number;
  available?: { name: string; source?: string }[];
  mcp?: { server: string; ok: boolean; tools?: string[]; error?: string }[];
  skills?: { available?: string[]; missing?: string[] };
  notes?: string[];
  saw_external?: boolean;
  sanitized?: { invisible: number; markup: number };
};

const SOURCE_LABEL = (source?: string) =>
  !source ? "" : source === "builtin" ? "내장" : source === "custom" ? "직접 만든 도구" : source === "skill" ? "스킬" : source === "provider" ? "공급자 실행" : source.startsWith("mcp:") ? `MCP · ${source.slice(4)}` : source === "connector:google" ? "커넥터 · Google" : source.startsWith("memory:") ? `메모리 · ${source.slice(7)}` : source;

/** 도구 호출 과정: 어떤 도구가 주어졌고, 모델이 단계마다 무엇을 불러 무엇을 받았는지 */
function ToolSteps({ pd }: { pd: Rec }) {
  const tools = pd.tools as ToolsRec | undefined;
  const steps = (pd.steps as StepRec[] | undefined) ?? [];
  if (!tools) return null;
  const calls = steps.flatMap((s) => s.tool_calls);
  const problems = [
    ...(tools.mcp ?? []).filter((m) => !m.ok).map((m) => `MCP 서버 ‘${m.server}’ 연결 실패: ${m.error ?? ""}`),
    ...(tools.skills?.missing ?? []).map((id) => `찾지 못한 스킬: ‘${id}’`),
    ...(tools.notes ?? []),
  ];
  return (
    <>
      <SubHead>
        도구 ({tools.available?.length ?? 0}개 제공 · {calls.length}회 호출{steps.length ? ` · 모델 호출 ${steps.length}회` : ""})
      </SubHead>
      <div className="flex flex-wrap gap-1">
        {(tools.available ?? []).map((t) => {
          const used = calls.filter((c) => c.name === t.name).length;
          return (
            <span
              key={t.name}
              title={SOURCE_LABEL(t.source)}
              className={`rounded-md border px-1.5 py-0.5 font-mono text-[11px] ${used ? "border-accent/40 bg-accent/8 text-ink" : "border-line bg-surface text-ink-3"}`}
            >
              {t.name}
              {used > 0 && <span className="ml-1 font-sans text-accent">×{used}</span>}
            </span>
          );
        })}
        {(tools.available ?? []).length === 0 && <span className="text-[12px] text-ink-3">쓸 수 있는 도구가 없어 도구 없이 호출했습니다.</span>}
      </div>
      {tools.sanitized && (
        <p className="mt-1.5 text-[12px] leading-snug text-[#b45309]">
          외부에서 온 도구 결과를 정화했습니다. 보이지 않는 문자 {tools.sanitized.invisible}개 제거, 대화 구조를 흉내 낸 표시 {tools.sanitized.markup}개 무력화.
        </p>
      )}
      {tools.saw_external && tools.available?.some((t) => t.source?.startsWith("memory:")) && (
        <p className="mt-1 text-[12px] leading-snug text-ink-3">이 실행은 외부 자료(웹·MCP)를 봤습니다. 그 뒤에 저장한 기억에는 ‘외부 자료를 본 대화에서 저장됨’ 표시가 붙습니다.</p>
      )}
      {problems.length > 0 && (
        <ul className="mt-1.5 list-disc pl-5 text-[12px] text-err">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      {steps.length > 0 && (
        <ol className="mt-2 space-y-2">
          {steps.map((s) => (
            <li key={s.step} className="rounded-lg border border-line bg-surface">
              <div className="flex items-center gap-2 border-b border-line bg-paper-2/70 px-3 py-1.5 text-[11px] text-ink-3">
                <span className="font-semibold text-ink-2">모델 호출 {s.step}</span>
                <span>{s.tool_calls.length ? `도구 ${s.tool_calls.length}개 요청` : "최종 답"}</span>
                <span className="ml-auto font-mono">{s.stop_reason ?? ""}</span>
              </div>
              <div className="space-y-2 px-3 py-2">
                {s.text && s.tool_calls.length > 0 && <div className="whitespace-pre-wrap text-[12px] leading-relaxed text-ink-2">{s.text}</div>}
                {s.tool_calls.map((c, i) => (
                  <div key={i} className={`rounded-md border px-2.5 py-2 ${c.is_error ? "border-err/30 bg-err/5" : "border-line bg-paper"}`}>
                    <div className="flex items-center gap-2 text-[12px]">
                      <span className="font-mono font-semibold text-ink">{c.name}</span>
                      <span className="text-ink-4">{SOURCE_LABEL(c.source)}</span>
                      {c.is_error && <span className="font-semibold text-err">오류</span>}
                      <span className="ml-auto tabular-nums text-ink-4">{c.elapsed_ms ?? 0}ms</span>
                    </div>
                    <div className="mt-1 text-[11px] font-semibold tracking-wide text-ink-4">입력</div>
                    <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-ink-2">{JSON.stringify(c.input, null, 2)}</pre>
                    <div className="mt-1 text-[11px] font-semibold tracking-wide text-ink-4">결과 → 모델에 전달</div>
                    <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-ink">{c.output}</pre>
                  </div>
                ))}
                {s.tool_calls.length === 0 && <div className="text-[12px] text-ink-3">도구를 더 부르지 않고 답했습니다 (아래 출력 참고).</div>}
                {s.cleared_results ? <div className="text-[12px] text-[#b45309]">컨텍스트를 아끼려고 예전 도구 결과 {s.cleared_results}개를 비운 뒤 다음 호출로 넘어갔습니다.</div> : null}
              </div>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}

/** 어떤 공급자·모델·하이퍼파라미터로 호출했는지 */
function ModelSummary({ model, children }: { model?: ModelRec; children?: ReactNode }) {
  if (!model) return null;
  const params = Object.entries(model.params ?? {});
  const ignored = Object.entries(model.ignored_params ?? {});
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2">
      <KeyVal k="모델">
        <span className="font-mono">{model.name}</span>
        <span className="text-ink-4">
          {" "}
          · {model.provider}
          {model.spec && model.spec !== model.name ? ` · ${model.spec}` : ""}
        </span>
      </KeyVal>
      <KeyVal k="파라미터">
        {params.length === 0 ? (
          <span className="text-ink-4">모두 모델 기본값</span>
        ) : (
          <span className="flex flex-wrap gap-1">
            {params.map(([k, v]) => (
              <code key={k} className="rounded bg-paper-2 px-1 font-mono text-[11px] text-ink-2">
                {k}={typeof v === "string" ? v : JSON.stringify(v)}
              </code>
            ))}
          </span>
        )}
      </KeyVal>
      {ignored.length > 0 && (
        <KeyVal k="무시됨">
          <span className="text-[11px] text-[#92400e]">
            {ignored.map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(", ")} (이 모델이 받지 않는 값)
          </span>
        </KeyVal>
      )}
      {children}
    </div>
  );
}

function ResponseSummary({ response }: { response?: ResponseRec }) {
  if (!response) return null;
  return (
    <div className="mt-3 rounded-lg border border-line bg-surface px-3 py-2">
      <KeyVal k="API">{response.api}</KeyVal>
      <KeyVal k="응답 모델">
        <span className="font-mono">{response.model}</span>
      </KeyVal>
      <KeyVal k="종료 사유">
        <span className="font-mono">{response.stop_reason ?? "-"}</span>
      </KeyVal>
      {response.fallback && <KeyVal k="fallback">{response.fallback}</KeyVal>}
    </div>
  );
}

function LlmProcess({ pd, nodes, live, running }: { pd: Rec; nodes: Nodes; live?: LiveStream; running: boolean }) {
  const [view, setView] = useState<"both" | "rendered" | "template">("both");
  const model = pd.model as ModelRec | undefined;
  const memory = pd.memory as { enabled?: boolean; window_size?: unknown; included_messages?: number } | undefined;
  const context = pd.context as { from?: string; text?: string } | undefined;
  const prompts = (pd.prompts as PromptRec[]) ?? [];
  const response = pd.response as ResponseRec | undefined;

  return (
    <div>
      <ModelSummary model={model}>
        <KeyVal k="이전 대화 포함">
          {memory?.enabled ? `사용 · 창 ${String(memory.window_size)} · 이전 메시지 ${memory.included_messages}개 포함` : "사용 안 함"}
        </KeyVal>
        {context && (
          <KeyVal k="컨텍스트">
            <RefChip path={context.from ?? ""} nodesById={nodes} /> → <code className="font-mono">{"{{#context#}}"}</code>
          </KeyVal>
        )}
      </ModelSummary>

      <div className="mt-3 mb-1.5 flex items-center justify-between">
        <span className="text-[11px] font-semibold text-ink-3">프롬프트 구성 ({prompts.length})</span>
        <div className="flex rounded-md border border-line bg-paper-2 p-0.5 text-[11px]">
          {(
            [
              ["both", "비교"],
              ["template", "템플릿"],
              ["rendered", "렌더링"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setView(k)}
              className={`rounded px-2 py-0.5 ${view === k ? "bg-surface font-semibold text-ink shadow-sm" : "text-ink-3"}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="space-y-2">
        {prompts.map((p, i) => (
          <div key={i} className="overflow-hidden rounded-lg border border-line bg-surface">
            <div className="flex items-center gap-2 border-b border-line bg-paper-2/70 px-3 py-1.5">
              <span
                className={`rounded px-1.5 py-px font-mono text-[11px] font-bold uppercase ${
                  p.role === "system" ? "bg-ink text-paper" : p.role === "assistant" ? "bg-[#d97706] text-white" : "bg-[#2563eb] text-white"
                }`}
              >
                {p.role}
              </span>
              <span className="text-[11px] text-ink-3">
                {p.engine === "memory.query_prompt_template"
                  ? "메모리 질의 템플릿 (이전 대화 뒤에 추가)"
                  : p.engine === "jinja2"
                    ? "Jinja2 템플릿"
                    : p.engine === "skills"
                      ? "스킬 목록 (도구 설정에서 자동 추가)"
                      : p.engine === "memory-module"
                        ? "메모리 모듈이 넣은 내용"
                        : `메시지 ${i + 1}`}
              </span>
              <span className="ml-auto text-[11px] tabular-nums text-ink-4">{p.text.length.toLocaleString()}자</span>
            </div>
            <div className="space-y-2 px-3 py-2">
              {view !== "rendered" && (
                <div>
                  {view === "both" && <div className="mb-1 text-[11px] font-semibold tracking-wide text-ink-4">템플릿</div>}
                  <TemplateView template={p.template} nodesById={nodes} />
                </div>
              )}
              {view !== "template" && (
                <div>
                  {view === "both" && <div className="mb-1 text-[11px] font-semibold tracking-wide text-ink-4">렌더링 결과 → 모델에 전달</div>}
                  <div className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md bg-paper-2 px-2 py-1.5 text-[13px] leading-relaxed text-ink">
                    {p.text || <span className="text-ink-4 italic">(비어 있어 전송에서 제외)</span>}
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      <ToolSteps pd={pd} />
      {(running || response) && (
        <>
          <SubHead>추론 요약</SubHead>
          <TextBlock tone="muted">
            {(running ? live?.thinking : response?.thinking_summary) || (running ? "생각하는 중…" : "(요약 없음)")}
          </TextBlock>
        </>
      )}
      {running && (
        <>
          <SubHead>실시간 생성</SubHead>
          <TextBlock>
            {live?.text || <span className="text-ink-4">첫 토큰을 기다리는 중…</span>}
            <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-run align-middle" />
          </TextBlock>
        </>
      )}
      <ResponseSummary response={response} />
      {Array.isArray(pd.notes) && (pd.notes as string[]).length > 0 && (
        <ul className="mt-2 list-disc pl-5 text-[11px] text-ink-3">
          {(pd.notes as string[]).map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
      {pd.request ? (
        <Collapsible label={`실제 API 요청 본문 · ${response?.api ?? ""}`}>
          <JsonTree value={pd.request} rootOpen={false} />
        </Collapsible>
      ) : null}
    </div>
  );
}

function ClassifierProcess({ pd }: { pd: Rec }) {
  const classes = (pd.classes as { id: string; name: string }[]) ?? [];
  const decision = pd.decision as { class_id?: string; reason?: string } | undefined;
  return (
    <div>
      <div className="space-y-1">
        {classes.map((c, i) => {
          const chosen = decision?.class_id === c.id;
          return (
            <div
              key={c.id}
              className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs ${
                chosen ? "border-run/40 bg-run/8 font-semibold text-ink" : "border-line bg-surface text-ink-3"
              }`}
            >
              <span className="w-12 shrink-0 font-mono text-[11px]">분류 {i + 1}</span>
              <span className="flex-1">{c.name}</span>
              {chosen && <CircleCheck size={14} className="text-run" />}
            </div>
          );
        })}
      </div>
      {decision?.reason && (
        <>
          <SubHead>분류 근거 (모델 응답)</SubHead>
          <TextBlock tone="muted">{decision.reason}</TextBlock>
        </>
      )}
      {pd.instruction ? (
        <>
          <SubHead>추가 지시</SubHead>
          <TextBlock tone="muted">{String(pd.instruction)}</TextBlock>
        </>
      ) : null}
      <ModelCallFooter pd={pd} />
    </div>
  );
}

function ModelCallFooter({ pd }: { pd: Rec }) {
  const response = pd.response as ResponseRec | undefined;
  return (
    <>
      <div className="mt-3">
        <ModelSummary model={pd.model as ModelRec | undefined} />
      </div>
      {response?.thinking_summary && (
        <>
          <SubHead>추론 요약</SubHead>
          <TextBlock tone="muted">{response.thinking_summary}</TextBlock>
        </>
      )}
      {response?.raw && (
        <>
          <SubHead>원시 응답 (구조화 출력 JSON)</SubHead>
          <TextBlock mono>{response.raw}</TextBlock>
        </>
      )}
      {pd.json_schema ? (
        <Collapsible label="출력 JSON 스키마">
          <JsonTree value={pd.json_schema} />
        </Collapsible>
      ) : null}
      <ResponseSummary response={response} />
      {pd.request ? (
        <Collapsible label={`실제 API 요청 본문 · ${response?.api ?? ""}`}>
          <JsonTree value={pd.request} rootOpen={false} />
        </Collapsible>
      ) : null}
    </>
  );
}

function IfElseProcess({ pd, nodes }: { pd: Rec; nodes: Nodes }) {
  type Cond = { variable: string; actual: unknown; operator: string; expected?: unknown; result: boolean };
  const cases = (pd.cases as { case_id: string; logical_operator: string; conditions: Cond[]; result: boolean }[]) ?? [];
  return (
    <div className="space-y-2">
      {cases.map((c, i) => (
        <div key={c.case_id} className="overflow-hidden rounded-lg border border-line bg-surface">
          <div className="flex items-center gap-2 border-b border-line bg-paper-2/70 px-3 py-1.5 text-[11px]">
            <span className="font-bold text-ink">{i === 0 ? "IF" : "ELIF"}</span>
            <span className="text-ink-3">조건 {c.conditions.length}개 · {c.logical_operator.toUpperCase()}</span>
            <span className={`ml-auto font-semibold ${c.result ? "text-ok" : "text-ink-4"}`}>{c.result ? "참 → 이 분기 선택" : "거짓"}</span>
          </div>
          <div className="divide-y divide-line">
            {c.conditions.map((cond, j) => (
              <div key={j} className="flex items-start gap-2 px-3 py-2 text-xs">
                {cond.result ? <CircleCheck size={14} className="mt-0.5 shrink-0 text-ok" /> : <CircleX size={14} className="mt-0.5 shrink-0 text-ink-4" />}
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-1">
                    <RefChip path={cond.variable} nodesById={nodes} />
                    <span className="font-mono font-semibold text-ink-2">{cond.operator}</span>
                    {cond.expected !== undefined && <span className="font-mono text-ink-2">{JSON.stringify(cond.expected)}</span>}
                  </div>
                  <div className="text-ink-3">
                    실제 값: <span className="font-mono text-ink-2">{JSON.stringify(cond.actual)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
      <div className="rounded-lg border border-run/30 bg-run/6 px-3 py-2 text-xs text-ink">
        선택된 분기: <b>{String(pd.selected_branch)}</b>
      </div>
    </div>
  );
}

function RetrievalProcess({ pd }: { pd: Rec }) {
  const retrieval = pd.retrieval as { method?: string; top_k?: number; score_threshold?: number } | undefined;
  const datasets = (pd.datasets as { id: string; name: string | null; found: boolean; chunk_count: number }[]) ?? [];
  const candidates = (pd.candidates as { title: string; position: number; score: number; selected: boolean; preview: string }[]) ?? [];
  const max = Math.max(0.0001, ...candidates.map((c) => c.score));
  return (
    <div>
      <div className="rounded-lg border border-line bg-surface px-3 py-2">
        <KeyVal k="방식">{retrieval?.method}</KeyVal>
        <KeyVal k="Top K / 임계값">
          {retrieval?.top_k} / {retrieval?.score_threshold || "없음"}
        </KeyVal>
        {datasets.map((d) => (
          <KeyVal key={d.id} k="데이터셋">
            {d.found ? `${d.name} · 청크 ${d.chunk_count}개` : <span className="text-err">{d.id} (로컬에 없음)</span>}
          </KeyVal>
        ))}
      </div>
      <SubHead>후보 청크 점수 (상위)</SubHead>
      <div className="space-y-1.5">
        {candidates.map((c, i) => (
          <div
            key={i}
            className={`rounded-lg border px-3 py-2 text-xs ${c.selected ? "border-ok/40 bg-ok/6" : "border-line bg-surface opacity-75"}`}
          >
            <div className="flex items-center gap-2">
              <span className="font-semibold text-ink">{c.title}</span>
              <span className="text-ink-4">#{c.position}</span>
              {c.selected && <span className="rounded bg-ok px-1.5 py-px text-[11px] font-bold text-white">선택</span>}
              <span className="ml-auto font-mono tabular-nums text-ink-2">{c.score.toFixed(3)}</span>
            </div>
            <div className="mt-1 h-1 overflow-hidden rounded-full bg-paper-2">
              <div className={`h-full rounded-full ${c.selected ? "bg-ok" : "bg-ink-4"}`} style={{ width: `${(c.score / max) * 100}%` }} />
            </div>
            <div className="mt-1 line-clamp-2 text-ink-3">{c.preview}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function CodeProcess({ pd, nodes }: { pd: Rec; nodes: Nodes }) {
  const bindings = (pd.bindings as { arg: string; from: string }[]) ?? [];
  return (
    <div>
      <SubHead>인자 바인딩</SubHead>
      <div className="space-y-1">
        {bindings.map((b) => (
          <div key={b.arg} className="flex items-center gap-2 text-xs">
            <code className="font-mono font-semibold text-ink">{b.arg}</code>
            <span className="text-ink-4">←</span>
            <RefChip path={b.from} nodesById={nodes} />
          </div>
        ))}
      </div>
      <SubHead>코드 ({String(pd.language)})</SubHead>
      <pre className="max-h-80 overflow-auto rounded-lg bg-[#18181b] p-3 font-mono text-[12px] leading-relaxed text-[#e4e4e7]">{String(pd.code ?? "")}</pre>
      {Array.isArray(pd.logs) && (
        <>
          <SubHead>표준 출력</SubHead>
          <TextBlock mono tone="muted">
            {(pd.logs as string[]).join("\n")}
          </TextBlock>
        </>
      )}
    </div>
  );
}

// ───────────────────────── 분기 ─────────────────────────

/** 원문에서 찾은 문구를 강조 */
function Highlighted({ text, ranges }: { text: string; ranges: { index: number; length: number }[] }) {
  const sorted = ranges.filter((r) => r.index >= 0 && r.length > 0).sort((a, b) => a.index - b.index);
  const parts: ReactNode[] = [];
  let pos = 0;
  for (const r of sorted) {
    if (r.index < pos) continue;
    parts.push(text.slice(pos, r.index));
    parts.push(
      <mark key={r.index} className="rounded-sm bg-[#fde68a] px-0.5 text-ink">
        {text.slice(r.index, r.index + r.length)}
      </mark>,
    );
    pos = r.index + r.length;
  }
  parts.push(text.slice(pos));
  return (
    <div className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-line bg-surface px-3 py-2 text-[13px] leading-relaxed text-ink">
      {text ? parts : <span className="text-ink-4">(빈 텍스트)</span>}
    </div>
  );
}

function SwitchProcess({ run, pd, nodes }: { run: NodeRun; pd: Rec; nodes: Nodes }) {
  const mode = (pd.mode as SwitchMode) ?? "text";
  const branches = (pd.branches as SwitchBranch[]) ?? [];
  const decision = pd.decision as { branch_id?: string; branch?: string; reason?: string } | undefined;
  const chosen = decision?.branch_id ?? run.selectedHandle;
  const evals = (pd.evaluations as (BranchEvaluation & { operator_label?: string })[]) ?? [];
  const evalOf = (id: string) => evals.find((e) => e.id === id);
  const inputValue = run.inputs?.[String(pd.input)];
  const text = typeof inputValue === "string" ? inputValue : inputValue == null ? "" : JSON.stringify(inputValue, null, 2);
  const ai = pd.ai as { reason?: string; confidence?: number } | undefined;
  const prompt = pd.prompt as { system?: string; user?: string } | undefined;
  const chosenHits = evalOf(chosen ?? "")?.hits.filter((h) => h.found) ?? [];

  return (
    <div>
      <div className="mb-2.5 flex flex-wrap items-center gap-2 text-[12px] text-ink-3">
        <span className="rounded bg-[#ea580c]/10 px-1.5 py-0.5 font-semibold text-[#c2410c]">{SWITCH_MODES.find((m) => m.value === mode)?.label}</span>
        {mode === "text" && <span>{pd.case_sensitive ? "대소문자 구분" : "대소문자 무시"} · 위에서부터 처음 맞는 분기</span>}
        {mode === "code" && <span>{pd.language === "python3" ? "Python 3" : "JavaScript"}</span>}
      </div>

      {mode === "text" && (
        <>
          <SubHead>검사한 텍스트{chosenHits.length ? " · 선택된 분기의 문구 강조" : ""}</SubHead>
          <Highlighted text={text} ranges={chosenHits} />
        </>
      )}

      <SubHead>분기</SubHead>
      <div className="space-y-1">
        {branches.map((b, i) => {
          const isChosen = chosen === b.id;
          const ev = evalOf(b.id);
          return (
            <div key={b.id} className={`rounded-lg border px-3 py-1.5 text-xs ${isChosen ? "border-run/40 bg-run/8" : "border-line bg-surface"}`}>
              <div className="flex items-center gap-2">
                <span className="w-4 shrink-0 font-mono text-[11px] text-ink-4">{i + 1}</span>
                <span className={`min-w-0 flex-1 truncate ${isChosen ? "font-semibold text-ink" : "text-ink-2"}`}>{b.name}</span>
                {mode === "text" && ev && (ev.matched ? <span className="shrink-0 text-[11px] font-semibold text-ok">조건 맞음</span> : <span className="shrink-0 text-[11px] text-ink-4">안 맞음</span>)}
                {isChosen && <CircleCheck size={14} className="shrink-0 text-run" />}
              </div>
              {mode === "text" && ev && (
                <div className="mt-1 flex flex-wrap items-center gap-1 pl-6">
                  <span className="text-[11px] text-ink-3">{ev.operator_label}</span>
                  {ev.hits.length === 0 && <span className="text-[11px] text-ink-4">(문구 없음)</span>}
                  {ev.hits.map((h, j) => {
                    const good = ev.operator === "not_contains" ? !h.found : h.found;
                    return (
                      <span
                        key={j}
                        title={h.error ?? (h.found ? "찾음" : "없음")}
                        className={`rounded px-1 font-mono text-[11px] ${h.error ? "bg-err/10 text-err" : good ? "bg-ok/12 text-ok" : "bg-paper-2 text-ink-4"}`}
                      >
                        {ev.operator === "regex" ? `/${h.keyword}/` : h.keyword}
                        {h.error ? " ⚠" : h.found ? " ✓" : ""}
                      </span>
                    );
                  })}
                </div>
              )}
              {mode === "ai" && b.description && <div className="mt-0.5 pl-6 text-[11px] text-ink-3">{b.description}</div>}
            </div>
          );
        })}
        <div className={`flex items-center gap-2 rounded-lg border border-dashed px-3 py-1.5 text-xs ${chosen === SWITCH_ELSE ? "border-run/50 bg-run/8 font-semibold text-ink" : "border-line-2 text-ink-3"}`}>
          <span className="w-4 shrink-0" />
          <span className="flex-1">{String(pd.else_name ?? "그 외")} (어느 분기에도 안 맞을 때)</span>
          {chosen === SWITCH_ELSE && <CircleCheck size={14} className="text-run" />}
        </div>
      </div>

      {mode === "code" && (
        <>
          <CodeProcess pd={pd} nodes={nodes} />
          {"returned" in pd && (
            <>
              <SubHead>main() 반환값</SubHead>
              <TextBlock mono>{JSON.stringify(pd.returned, null, 2)}</TextBlock>
            </>
          )}
        </>
      )}

      {mode === "ai" && (
        <>
          {ai && (
            <>
              <SubHead>모델 판단</SubHead>
              <div className="rounded-lg border border-line bg-surface px-3 py-2 text-xs">
                <div className="text-ink">{ai.reason}</div>
                {typeof ai.confidence === "number" && (
                  <div className="mt-1.5 flex items-center gap-2 text-[11px] text-ink-3">
                    확신도
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-paper-2">
                      <div className="h-full rounded-full bg-run" style={{ width: `${Math.max(0, Math.min(1, ai.confidence)) * 100}%` }} />
                    </div>
                    <span className="font-mono tabular-nums">{ai.confidence.toFixed(2)}</span>
                  </div>
                )}
              </div>
            </>
          )}
          {prompt?.system && (
            <Collapsible label="모델에 보낸 시스템 프롬프트">
              <pre className="whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-ink-2">{prompt.system}</pre>
            </Collapsible>
          )}
          <ModelCallFooter pd={pd} />
        </>
      )}

      {decision && (
        <div className="mt-3 rounded-lg border border-run/30 bg-run/6 px-3 py-2 text-xs text-ink">
          선택된 분기: <b>{decision.branch}</b>
          {decision.reason && <span className="text-ink-3"> · {decision.reason}</span>}
        </div>
      )}
    </div>
  );
}

function ProcessView({ run, nodes, live }: { run: NodeRun; nodes: Nodes; live?: LiveStream }) {
  const pd = run.processData ?? {};
  const running = run.status === "running";
  switch (run.nodeType) {
    case "llm":
      return <LlmProcess pd={pd} nodes={nodes} live={live} running={running} />;
    case "question-classifier":
      return <ClassifierProcess pd={pd} />;
    case "parameter-extractor":
      return (
        <div>
          <SubHead>추출 대상 파라미터</SubHead>
          <div className="divide-y divide-line overflow-hidden rounded-lg border border-line">
            {((pd.parameters as { name: string; type: string; description?: string; required?: boolean }[]) ?? []).map((p) => (
              <div key={p.name} className="bg-surface px-3 py-1.5 text-xs">
                <code className="font-mono font-semibold text-ink">{p.name}</code>
                <span className="ml-1.5 text-ink-4">
                  {p.type}
                  {p.required ? " · 필수" : ""}
                </span>
                {p.description && <div className="text-ink-3">{p.description}</div>}
              </div>
            ))}
          </div>
          <ModelCallFooter pd={pd} />
        </div>
      );
    case "if-else":
      return <IfElseProcess pd={pd} nodes={nodes} />;
    case "switch":
      return <SwitchProcess run={run} pd={pd} nodes={nodes} />;
    case "knowledge-retrieval":
      return <RetrievalProcess pd={pd} />;
    case "code":
      return <CodeProcess pd={pd} nodes={nodes} />;
    case "template-transform":
      return (
        <div>
          <SubHead>{String(pd.engine ?? "템플릿")}</SubHead>
          <pre className="overflow-auto rounded-lg bg-[#18181b] p-3 font-mono text-[12px] leading-relaxed text-[#e4e4e7]">{String(pd.template ?? "")}</pre>
        </div>
      );
    case "answer":
      return (
        <div>
          <SubHead>답변 템플릿</SubHead>
          <div className="rounded-lg border border-line bg-surface px-3 py-2">
            <TemplateView template={String(pd.template ?? "")} nodesById={nodes} />
          </div>
        </div>
      );
    default:
      return <JsonTree value={pd} />;
  }
}

function OutputView({ run }: { run: NodeRun }) {
  const out = run.outputs ?? {};
  if ((run.nodeType === "llm" || run.nodeType === "answer" || run.nodeType === "template-transform") && typeof (out.text ?? out.answer ?? out.output) === "string") {
    const key = "text" in out ? "text" : "answer" in out ? "answer" : "output";
    const rest = Object.fromEntries(Object.entries(out).filter(([k]) => k !== key));
    return (
      <div>
        <div className="mb-1 font-mono text-[11px] text-ink-3">{key}</div>
        <TextBlock>{String(out[key])}</TextBlock>
        {Object.keys(rest).length > 0 && (
          <div className="mt-2">
            <JsonTree value={rest} />
          </div>
        )}
      </div>
    );
  }
  return <JsonTree value={out} />;
}

// ───────────────────────── 블록 ─────────────────────────

type BlockStatus = "running" | "succeeded" | "failed" | "partial";

function blockSummary(block: DifyNode, nodes: Nodes, message?: AssistantMessage) {
  const runs = message?.runs ?? [];
  const memberIds = new Set([...nodes.values()].filter((n) => n.parentId === block.id).map((n) => n.id));
  const entry = runs.findLast((r) => r.nodeId === block.id);
  // 메모리 모듈은 쓰기 끝까지 가면 끝난 것
  const exit = runs.findLast((r) => r.nodeId === (isMemoryBlock(block) ? writeEndId(block.id) : exitIdOf(block.id)));
  const inner = runs.filter((r) => memberIds.has(r.nodeId));
  let status: BlockStatus | null = null;
  if (entry) {
    if (exit?.status === "succeeded") status = "succeeded";
    else if (inner.some((r) => r.status === "failed") || exit?.status === "failed") status = "failed";
    else status = message?.status === "running" ? "running" : "partial";
  }
  const lastEnd = Math.max(0, ...inner.map((r) => r.finishedAt ?? 0), exit?.finishedAt ?? 0);
  const elapsedMs = entry && lastEnd ? lastEnd - entry.startedAt : undefined;
  const usage = inner.reduce(
    (a, r) => (r.usage ? { inputTokens: a.inputTokens + r.usage.inputTokens, outputTokens: a.outputTokens + r.usage.outputTokens } : a),
    { inputTokens: 0, outputTokens: 0 },
  );
  return { memberIds, entry, exit, inner, status, elapsedMs, usage };
}

/** 메모리 모듈 실행 기록: LLM 에 넘긴 것 → 읽기·쓰기 구역에서 돈 노드 → 턴이 끝난 뒤의 저장소 */
function MemoryTrace({ block, nodes, message, onJump }: { block: DifyNode; nodes: Nodes; message?: AssistantMessage; onJump?: (nodeId: string) => void }) {
  const { memberIds, entry, inner } = blockSummary(block, nodes, message);
  const runs = message?.runs ?? [];
  if (!entry) {
    return (
      <div className="m-4 rounded-lg border border-dashed border-line-2 bg-paper-2/60 px-4 py-3 text-xs leading-relaxed text-ink-3">
        {message
          ? "이 턴에서는 이 메모리 모듈이 실행되지 않았습니다."
          : "아직 실행 기록이 없습니다. 채팅에서 메시지를 보내 보세요."}
      </div>
    );
  }
  const readEnd = runs.findLast((r) => r.nodeId === readEndId(block.id));
  const write = runs.findLast((r) => r.nodeId === writeId(block.id));
  const writeEnd = runs.findLast((r) => r.nodeId === writeEndId(block.id));
  const llm = nodes.get(String((entry.processData as Rec).llm_id ?? ""));
  const sorted = [...inner].sort((a, b) => a.index - b.index);
  const reading = sorted.filter((r) => !write || r.startedAt < write.startedAt);
  const writing = sorted.filter((r) => write && r.startedAt >= write.startedAt);
  const context = String((readEnd?.outputs as Rec | undefined)?.context ?? "");
  const messages = (readEnd?.outputs as Rec | undefined)?.messages;
  const live = message?.status === "running";
  const wpd = (writeEnd?.processData ?? {}) as { docs?: Record<string, string>; records?: { total: number; valid: number }; store?: string };
  const notRun = [...memberIds].filter((id) => !inner.some((r) => r.nodeId === id)).map((id) => nodes.get(id)!);

  const row = (r: NodeRun) => (
    <li key={r.id} className="relative">
      <button type="button" onClick={() => onJump?.(r.nodeId)} className="flex w-full items-center gap-2 rounded-md py-1 pr-1.5 text-left text-xs hover:bg-paper-2">
        <span className="z-10">
          <NodeIcon type={r.nodeType} size={23} />
        </span>
        <span className="min-w-0 flex-1 truncate text-ink">{r.title}</span>
        {r.selectedHandle && <span className="max-w-28 shrink-0 truncate rounded bg-run/10 px-1 font-mono text-[11px] text-run">→{branchLabel(r)}</span>}
        {r.status === "running" ? (
          <LoaderCircle size={12} className="shrink-0 animate-spin text-run" />
        ) : r.status === "failed" ? (
          <CircleX size={12} className="shrink-0 text-err" />
        ) : (
          <span className="shrink-0 font-mono text-[11px] tabular-nums text-ink-3">{formatMs(r.elapsedMs)}</span>
        )}
      </button>
    </li>
  );
  const mark = (label: string, text: string, done: boolean) => (
    <li className="relative flex items-center gap-2 py-0.5 text-[12px] font-semibold text-ink-3">
      <span className={`z-10 grid h-[23px] w-[23px] place-items-center rounded-full border bg-surface text-[10px] ${done ? "border-ok/50 text-ok" : "border-line-2"}`}>{label}</span>
      {text}
    </li>
  );

  return (
    <>
      <Section title="LLM에 넘긴 것" caption={llm ? `‘${llm.data.title ?? "LLM"}’ 호출에 포함` : undefined} help="읽기 구역이 만든 결과입니다. 연결된 LLM 노드의 프롬프트와 이전 대화에 들어갑니다." tone="output">
        {context ? <TextBlock>{context}</TextBlock> : <TextBlock tone="muted">프롬프트에 넣은 글이 없습니다.</TextBlock>}
        <div className="mt-2 text-[12px] text-ink-3">
          이전 대화: {Array.isArray(messages) ? `모듈이 고른 메시지 ${messages.length}개` : "LLM 노드의 ‘이전 대화 포함’ 설정을 따릅니다."}
        </div>
      </Section>
      <Section title="처리 과정" tone="process">
        <ol className="relative space-y-1 before:absolute before:top-3 before:bottom-3 before:left-[11px] before:w-px before:bg-line-2">
          {mark("읽기", "읽기 시작 · 질문과 이전 대화 수신", true)}
          {reading.map(row)}
          {mark("LLM", readEnd ? `읽기 끝 → ${llm?.data.title ?? "LLM"} 호출` : live ? "읽기 중" : "읽기 끝까지 가지 않음", !!readEnd)}
          {write && mark("쓰기", "쓰기 시작 · LLM 응답 수신", true)}
          {writing.map(row)}
          {mark("끝", writeEnd ? "쓰기 끝" : write ? (live ? "쓰기 중" : "쓰기 끝까지 가지 않음") : live ? "LLM 응답 대기" : "쓰기 시작 전 (LLM 실패 또는 중단)", !!writeEnd)}
        </ol>
        {notRun.length > 0 && !live && (
          <div className="mt-3 text-[11px] leading-snug text-ink-3">이번 턴에 실행되지 않은 노드: {notRun.map((n) => n.data.title || n.data.type).join(", ")}</div>
        )}
      </Section>
      {writeEnd && (
        <Section title="이 턴이 끝난 뒤의 저장소" caption={`‘${wpd.store ?? ""}’`} tone="input">
          <div className="space-y-1 text-[12px] text-ink-2">
            <div>
              기록 {wpd.records?.total ?? 0}개{wpd.records && wpd.records.total !== wpd.records.valid ? ` (유효 ${wpd.records.valid}개)` : ""}
            </div>
            {Object.entries(wpd.docs ?? {}).map(([k, v]) => (
              <div key={k} className="flex gap-2">
                <span className="min-w-0 truncate font-mono text-[12px]">{k}</span>
                <span className="shrink-0 text-ink-3">{v}</span>
              </div>
            ))}
            {Object.keys(wpd.docs ?? {}).length === 0 && !wpd.records?.total && <div className="text-ink-3">비어 있음</div>}
          </div>
          <p className="mt-2 text-[11px] leading-snug text-ink-3">내용 전체는 ‘설정’ 탭의 저장소 내용에서 볼 수 있습니다.</p>
        </Section>
      )}
    </>
  );
}

/** 블록 실행 기록: 블록 경계를 넘나든 값으로 입력·출력을 보여 준다 */
function BlockTrace({
  block,
  nodes,
  message,
  onJump,
}: {
  block: DifyNode;
  nodes: Nodes;
  message?: AssistantMessage;
  onJump?: (nodeId: string) => void;
}) {
  const { memberIds, entry, exit, inner } = blockSummary(block, nodes, message);
  if (!entry) {
    return (
      <div className="m-4 rounded-lg border border-dashed border-line-2 bg-paper-2/60 px-4 py-3 text-xs leading-relaxed text-ink-3">
        {message
          ? "이 턴에서는 이 블록에 들어가지 않았습니다."
          : "아직 실행 기록이 없습니다. 채팅에서 메시지를 보내 보세요."}
      </div>
    );
  }

  // 입력: 안쪽 노드가 블록 바깥(앞 노드·시스템·환경 변수 등)에서 읽어 온 값
  const inputs = new Map<string, unknown>();
  for (const r of inner) {
    for (const [k, v] of Object.entries(r.inputs ?? {})) {
      const head = k.split(".")[0];
      if (memberIds.has(head) || head === "context" || !isRefPath(k, nodes) || inputs.has(k)) continue;
      inputs.set(k, v);
    }
  }
  // 출력: 블록 다음 노드들이 읽어 간 안쪽 값. 아직 없으면 아웃 포인트에 연결된 노드의 출력
  const outputs = new Map<string, unknown>();
  for (const r of message?.runs ?? []) {
    if (memberIds.has(r.nodeId) || isBlockRunType(r.nodeType)) continue;
    for (const [k, v] of Object.entries(r.inputs ?? {})) if (memberIds.has(k.split(".")[0]) && !outputs.has(k)) outputs.set(k, v);
  }
  const usedOutside = outputs.size > 0;
  if (!usedOutside) for (const [k, v] of Object.entries(exit?.inputs ?? {})) outputs.set(k, v);

  const notRun = [...memberIds].filter((id) => !inner.some((r) => r.nodeId === id)).map((id) => nodes.get(id)!);
  const live = message?.status === "running";

  return (
    <>
      <Section title="입력" help="블록 안 노드가 블록 바깥에서 읽어 온 값입니다." tone="input">
        <VarTable entries={[...inputs.entries()]} nodes={nodes} />
      </Section>
      <Section title="처리 과정" tone="process">
        <ol className="relative space-y-1 before:absolute before:top-3 before:bottom-3 before:left-[11px] before:w-px before:bg-line-2">
          <li className="relative flex items-center gap-2 py-0.5 text-[12px] font-semibold text-ink-3">
            <span className="z-10 grid h-[23px] w-[23px] place-items-center rounded-full border border-line-2 bg-surface text-[10px]">IN</span>
            엔트리
          </li>
          {[...inner].sort((a, b) => a.index - b.index).map((r) => (
            <li key={r.id} className="relative">
              <button
                type="button"
                onClick={() => onJump?.(r.nodeId)}
                className="flex w-full items-center gap-2 rounded-md py-1 pr-1.5 text-left text-xs hover:bg-paper-2"
              >
                <span className="z-10">
                  <NodeIcon type={r.nodeType} size={23} />
                </span>
                <span className="min-w-0 flex-1 truncate text-ink">{r.title}</span>
                {r.selectedHandle && <span className="max-w-28 shrink-0 truncate rounded bg-run/10 px-1 font-mono text-[11px] text-run">→{branchLabel(r)}</span>}
                {r.status === "running" ? (
                  <LoaderCircle size={12} className="shrink-0 animate-spin text-run" />
                ) : r.status === "failed" ? (
                  <CircleX size={12} className="shrink-0 text-err" />
                ) : (
                  <span className="shrink-0 font-mono text-[11px] tabular-nums text-ink-3">{formatMs(r.elapsedMs)}</span>
                )}
              </button>
            </li>
          ))}
          <li className="relative flex items-center gap-2 py-0.5 text-[12px] font-semibold text-ink-3">
            <span
              className={`z-10 grid h-[23px] w-[23px] place-items-center rounded-full border text-[10px] ${
                exit ? "border-ok/50 bg-surface text-ok" : "border-dashed border-line-2 bg-surface"
              }`}
            >
              OUT
            </span>
            {exit ? "아웃" : live ? "아웃 (대기 중)" : "아웃까지 가지 않음"}
          </li>
        </ol>
        {notRun.length > 0 && !live && (
          <div className="mt-3 text-[11px] leading-snug text-ink-3">
            실행되지 않은 안쪽 노드: {notRun.map((n) => n.data.title || n.data.type).join(", ")}
          </div>
        )}
      </Section>
      <Section title="출력" help={usedOutside ? "블록 다음 노드가 읽어 간 안쪽 값입니다." : "아직 읽어 간 노드가 없어 아웃 점에 연결된 노드의 출력을 보여 줍니다."} tone="output">
        <VarTable entries={[...outputs.entries()]} nodes={nodes} />
      </Section>
    </>
  );
}

// ───────────────────────── 패널 ─────────────────────────

function CopyButton({ value }: { value: unknown }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      title="실행 기록 JSON 복사"
      onClick={() => {
        navigator.clipboard?.writeText(JSON.stringify(value, null, 2)).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1200);
        });
      }}
      className="rounded-md p-1.5 text-ink-3 hover:bg-paper-2 hover:text-ink"
    >
      {done ? <Check size={15} /> : <Copy size={15} />}
    </button>
  );
}

export type InspectorTab = "config" | "trace";

export function Inspector({
  nodes,
  message,
  nodeId,
  showPool,
  onClose,
  tab = "trace",
  onTabChange,
  config,
  onJump,
}: {
  nodes: Nodes;
  message?: AssistantMessage;
  nodeId?: string;
  showPool?: boolean;
  onClose: () => void;
  tab?: InspectorTab;
  onTabChange?: (t: InspectorTab) => void;
  /** 설정 탭 내용(편집 폼) */
  config?: ReactNode;
  /** 다른 노드의 실행 기록으로 이동(블록 실행 기록에서 안쪽 노드를 누를 때) */
  onJump?: (nodeId: string) => void;
}) {
  if (showPool) {
    return (
      <div className="flex h-full flex-col">
        <header className="flex items-center gap-2 border-b border-line px-4 py-3">
          <div className="flex min-w-0 flex-1 items-center gap-1 text-sm font-semibold text-ink">
            변수 풀 (Variable Pool)
            <Help label="변수 풀 설명">실행이 끝난 시점에 모든 노드가 남긴 값입니다.</Help>
          </div>
          <CopyButton value={message?.variablePool} />
          <button type="button" onClick={onClose} className="rounded-md p-1.5 text-ink-3 hover:bg-paper-2 hover:text-ink" aria-label="닫기">
            <X size={16} />
          </button>
        </header>
        <div className="flex-1 overflow-auto p-4">
          {Object.entries(message?.variablePool ?? {}).map(([scope, values]) => (
            <div key={scope} className="mb-4">
              <div className="mb-1.5">
                <RefChip path={scope} nodesById={nodes} />
              </div>
              <JsonTree value={values} rootOpen={false} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const node = nodeId ? nodes.get(nodeId) : undefined;
  if (!node) return null;
  if (isBlock(node)) {
    return <BlockInspector block={node} nodes={nodes} message={message} onClose={onClose} tab={tab} onTabChange={onTabChange} config={config} onJump={onJump} />;
  }
  const run = message?.runs.findLast((r) => r.nodeId === nodeId);
  const live = run ? message?.live[run.id] : undefined;
  const meta = nodeMeta(node.data.type);
  const parentBlock = node.parentId ? nodes.get(node.parentId) : undefined;

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-line px-4 py-3">
        <div className="flex items-center gap-2.5">
          <NodeIcon type={node.data.type} size={30} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-ink">{node.data.title || meta.label}</div>
            <div className="truncate text-[11px] text-ink-3">
              {meta.label} · <span className="font-mono">{node.id}</span>
              {isBlock(parentBlock) && (
                <>
                  {" · "}
                  <span className="rounded px-1 py-px text-ink-2" style={{ background: blockColor(parentBlock) }}>
                    {parentBlock.data.title || "블록"}
                  </span>
                </>
              )}
            </div>
          </div>
          {run && <CopyButton value={run} />}
          <button type="button" onClick={onClose} className="rounded-md p-1.5 text-ink-3 hover:bg-paper-2 hover:text-ink" aria-label="닫기">
            <X size={16} />
          </button>
        </div>
        {run && (
          <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-3">
            {run.status === "running" ? (
              <span className="inline-flex items-center gap-1 font-semibold text-run">
                <LoaderCircle size={12} className="animate-spin" /> 실행 중
              </span>
            ) : run.status === "succeeded" ? (
              <span className="inline-flex items-center gap-1 font-semibold text-ok">
                <CircleCheck size={12} /> 성공
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 font-semibold text-err">
                <CircleX size={12} /> 실패
              </span>
            )}
            <span>실행 순서 #{run.index}</span>
            {run.elapsedMs != null && <span className="tabular-nums">{formatMs(run.elapsedMs)}</span>}
            {run.usage && (
              <span className="tabular-nums">
                토큰 {run.usage.inputTokens.toLocaleString()} → {run.usage.outputTokens.toLocaleString()}
              </span>
            )}
            {run.selectedHandle && <span>선택 분기 <b className="text-ink-2">{branchLabel(run)}</b></span>}
          </div>
        )}
        {config && (
          <div className="-mb-3 mt-3 flex gap-4 text-[13px]">
            {(
              [
                ["config", "설정"],
                ["trace", run ? `실행 기록 #${run.index}` : "실행 기록"],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => onTabChange?.(k)}
                className={`border-b-2 pb-2 font-medium ${tab === k ? "border-accent text-ink" : "border-transparent text-ink-3 hover:text-ink"}`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </header>

      <div className="flex-1 overflow-auto">
        {config && tab === "config" ? (
          config
        ) : !run ? (
          <div className="m-4 rounded-lg border border-dashed border-line-2 bg-paper-2/60 px-4 py-3 text-xs leading-relaxed text-ink-3">
            {message
              ? "이 턴에서는 이 노드가 실행되지 않았습니다."
              : "아직 실행 기록이 없습니다. 채팅에서 메시지를 보내 보세요."}
          </div>
        ) : (
          <>
            {run.error && (
              <Section title="오류" tone="error">
                <div className="whitespace-pre-wrap break-words rounded-lg border border-err/30 bg-err/6 px-3 py-2 text-xs text-err">{run.error}</div>
              </Section>
            )}
            <Section title="입력" help="이 노드가 변수 풀에서 읽어 온 값입니다." tone="input">
              <VarTable entries={Object.entries(run.inputs ?? {})} nodes={nodes} />
            </Section>
            <Section title="처리 과정" tone="process">
              {Object.keys(run.processData ?? {}).length === 0 && run.status === "running" && run.nodeType !== "llm" ? (
                <div className="text-xs text-ink-4">실행 중…</div>
              ) : (
                <ProcessView run={run} nodes={nodes} live={live} />
              )}
              {Object.keys(run.processData ?? {}).length > 0 && (
                <Collapsible label="process_data 원본 JSON">
                  <JsonTree value={run.processData} rootOpen={false} />
                </Collapsible>
              )}
            </Section>
            <Section title="출력" help="이 노드가 변수 풀에 기록한 값입니다. 뒤 노드가 이 값을 참조합니다." tone="output">
              {run.status === "running" ? <div className="text-xs text-ink-4">실행이 끝나면 표시됩니다.</div> : <OutputView run={run} />}
            </Section>
          </>
        )}
        {!config && (
          <Section title="노드 설정 (DSL)" caption="YAML의 data 블록" defaultOpen={!run}>
            <JsonTree value={node.data} rootOpen={false} />
          </Section>
        )}
      </div>
    </div>
  );
}

function BlockInspector({
  block,
  nodes,
  message,
  onClose,
  tab,
  onTabChange,
  config,
  onJump,
}: {
  block: DifyNode;
  nodes: Nodes;
  message?: AssistantMessage;
  onClose: () => void;
  tab: InspectorTab;
  onTabChange?: (t: InspectorTab) => void;
  config?: ReactNode;
  onJump?: (nodeId: string) => void;
}) {
  const { status, elapsedMs, usage, inner, memberIds } = blockSummary(block, nodes, message);
  const color = blockColor(block);
  const memory = isMemoryBlock(block);
  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-line px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-md border border-black/10 text-ink-2" style={{ background: color }}>
            {memory ? <Brain size={16} /> : <SquareDashed size={16} />}
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-ink">{block.data.title || "블록"}</div>
            <div className="truncate text-[11px] text-ink-3">
              {memory ? `메모리 모듈 · ${memoryKindInfo(readMemory(block).kind).name}` : "블록"} · 노드 {memberIds.size}개 · <span className="font-mono">{block.id}</span>
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1.5 text-ink-3 hover:bg-paper-2 hover:text-ink" aria-label="닫기">
            <X size={16} />
          </button>
        </div>
        {status && (
          <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-3">
            {status === "running" ? (
              <span className="inline-flex items-center gap-1 font-semibold text-run">
                <LoaderCircle size={12} className="animate-spin" /> 실행 중
              </span>
            ) : status === "succeeded" ? (
              <span className="inline-flex items-center gap-1 font-semibold text-ok">
                <CircleCheck size={12} /> {memory ? "읽기·쓰기 완료" : "아웃까지 통과"}
              </span>
            ) : status === "failed" ? (
              <span className="inline-flex items-center gap-1 font-semibold text-err">
                <CircleX size={12} /> 실패
              </span>
            ) : (
              <span className="font-semibold text-[#b45309]">{memory ? "쓰기 끝까지 가지 않음" : "아웃까지 가지 않고 끝남"}</span>
            )}
            <span>
              안쪽 노드 {inner.length}/{memberIds.size}개 실행
            </span>
            {elapsedMs != null && <span className="tabular-nums">블록 전체 {formatMs(elapsedMs)}</span>}
            {usage.inputTokens + usage.outputTokens > 0 && (
              <span className="tabular-nums">
                토큰 {usage.inputTokens.toLocaleString()} → {usage.outputTokens.toLocaleString()}
              </span>
            )}
          </div>
        )}
        {config && (
          <div className="-mb-3 mt-3 flex gap-4 text-[13px]">
            {(
              [
                ["config", "설정"],
                ["trace", "실행 기록"],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => onTabChange?.(k)}
                className={`border-b-2 pb-2 font-medium ${tab === k ? "border-accent text-ink" : "border-transparent text-ink-3 hover:text-ink"}`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </header>
      <div className="flex-1 overflow-auto">
        {config && tab === "config" ? (
          config
        ) : memory ? (
          <MemoryTrace block={block} nodes={nodes} message={message} onJump={onJump} />
        ) : (
          <BlockTrace block={block} nodes={nodes} message={message} onJump={onJump} />
        )}
      </div>
    </div>
  );
}
