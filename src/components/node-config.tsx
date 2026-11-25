"use client";

import { ArrowDown, ArrowUp, Brain, Plus, Settings2, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { availableVars, type VarOption } from "@/lib/dsl/edit";
import { needLabel, structuredDependents, structuredNeedsOf } from "@/lib/dsl/requirements";
import { DEFAULT_MODEL, MODEL_CATALOG, PROVIDERS, PROVIDER_IDS, defaultParams, inferProvider, specFor, type ParamDef, type ProviderId } from "@/lib/llm/catalog";
import { dumpDoc, loadDoc } from "@/lib/dsl/parse";
import {
  DEFAULT_SWITCH_CODE,
  SWITCH_MODES,
  TEXT_OPERATORS,
  evaluateText,
  nextBranchId,
  readSwitch,
  textReason,
  type SwitchBranch,
  type SwitchMode,
  type TextOperator,
} from "@/lib/dsl/switch";
import type { DifyNode, DifyNodeData, DslDoc, ValueSelector } from "@/lib/dsl/types";
import { graphOf, rec } from "@/lib/dsl/graph";
import { memoryOf } from "@/lib/dsl/memory";
import { BUILTIN_TOOLS, COMPACT_KEEP_ROUNDS, DEFAULT_MAX_STEPS, PROVIDER_TOOLS, MEMORY_COMMANDS, MEMORY_COMMAND_LABEL, MEMORY_TOOL, readMemoryCommands, readTools, safeToolName, type CustomTool, type ToolsConfig } from "@/lib/tools/config";
import { CONNECTOR_SERVICES, GOOGLE_TOOLS, serviceConnected } from "@/lib/tools/connector-catalog";
import { useConnectors } from "./connectors-tab";
import { ToolsModal, useToolCatalog, type ToolsTab } from "./tools-modal";
import { ProviderDot } from "./settings-modal";
import { Field, Help, inputCls } from "./ui";

type Rec = Record<string, unknown>;
const smallInput = `${inputCls} !py-1 !text-[13px]`;

// ───────────────────────── 공용 조각 ─────────────────────────

/** help: ⓘ 뒤에 두는 동작 원리 설명. 항상 보이는 문장은 상태·경고만 남긴다. */
/** collapsed: 내용은 붙여 둔 채 숨긴다(입력란을 떼지 않아야 하는 경우) */
function Group({ title, children, action, help, collapsed }: { title: string; children?: ReactNode; action?: ReactNode; help?: ReactNode; collapsed?: boolean }) {
  const empty = collapsed || children == null || children === false;
  return (
    <div className="border-b border-line px-4 py-3.5">
      <div className={`flex items-center gap-1 ${empty ? "" : "mb-2.5"}`}>
        <span className="text-[13px] font-semibold text-ink">{title}</span>
        {help && <Help>{help}</Help>}
        <span className="ml-auto flex items-center">{action}</span>
      </div>
      {children != null && children !== false && <div className={collapsed ? "hidden" : "space-y-3"}>{children}</div>}
    </div>
  );
}

function AddButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex items-center gap-1 text-[12px] font-medium text-accent hover:underline">
      <Plus size={12} />
      {children}
    </button>
  );
}

function RemoveButton({ onClick, label = "삭제" }: { onClick: () => void; label?: string }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} className="shrink-0 rounded p-1 text-ink-4 hover:bg-err/8 hover:text-err">
      <Trash2 size={13} />
    </button>
  );
}

function VarSelect({
  value,
  onChange,
  vars,
  placeholder = "변수 선택",
}: {
  value?: ValueSelector;
  onChange: (sel: ValueSelector) => void;
  vars: VarOption[];
  placeholder?: string;
}) {
  const key = (value ?? []).join(".");
  const groups = useMemo(() => {
    const m = new Map<string, VarOption[]>();
    for (const v of vars) m.set(v.scope, [...(m.get(v.scope) ?? []), v]);
    return [...m.entries()];
  }, [vars]);
  const known = vars.some((v) => v.selector.join(".") === key);
  return (
    <select value={key} onChange={(e) => onChange(e.target.value ? e.target.value.split(".") : [])} className={smallInput}>
      <option value="">{placeholder}</option>
      {key && !known && <option value={key}>{key} (상류에 없음)</option>}
      {groups.map(([scope, list]) => (
        <optgroup key={scope} label={scope}>
          {list.map((v) => (
            <option key={v.selector.join(".")} value={v.selector.join(".")}>
              {v.scope} › {v.name}  ({v.type})
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

/** 텍스트 영역 + 커서 위치에 {{#노드.변수#}} 를 끼워 넣는 선택 상자 */
function TemplateArea({
  value,
  onChange,
  vars,
  rows = 4,
  mono = false,
  extraTokens = [],
  insertFormat = (sel: string) => `{{#${sel}#}}`,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  vars: VarOption[];
  rows?: number;
  mono?: boolean;
  extraTokens?: { label: string; token: string }[];
  insertFormat?: (sel: string) => string;
  placeholder?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const insert = (token: string) => {
    const el = ref.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    const next = value.slice(0, start) + token + value.slice(end);
    onChange(next);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + token.length, start + token.length);
    });
  };
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-surface focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/15">
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        placeholder={placeholder}
        spellCheck={false}
        className={`block w-full resize-y bg-transparent px-2.5 py-2 text-[13px] leading-relaxed text-ink outline-none placeholder:text-ink-4 ${
          mono ? "font-mono text-[12px]" : ""
        }`}
      />
      <div className="flex items-center gap-2 border-t border-line bg-paper-2/60 px-2 py-1">
        <select
          value=""
          onChange={(e) => e.target.value && insert(e.target.value)}
          className="max-w-[220px] rounded border border-line bg-surface px-1.5 py-0.5 text-[11px] text-ink-2"
          aria-label="변수 삽입"
        >
          <option value="">{"{x} 변수 삽입"}</option>
          {extraTokens.map((t) => (
            <option key={t.token} value={t.token}>
              {t.label}
            </option>
          ))}
          {vars.map((v) => (
            <option key={v.selector.join(".")} value={insertFormat(v.selector.join("."))}>
              {v.scope} › {v.name}
            </option>
          ))}
        </select>
        <span className="ml-auto text-[11px] tabular-nums text-ink-4">{value.length.toLocaleString()}자</span>
      </div>
    </div>
  );
}

// ───────────────────────── 모델 선택 + 하이퍼파라미터 ─────────────────────────

const liveCache = new Map<ProviderId, Promise<{ id: string; label?: string }[]>>();

/** 키가 있으면 공급자 API에서 실제 사용 가능한 모델 목록을 받아 온다(세션 동안 캐시) */
function useLiveModels(provider: ProviderId, hasKey: boolean) {
  const [list, setList] = useState<{ id: string; label?: string }[]>([]);
  useEffect(() => {
    if (!hasKey) return;
    let alive = true;
    let pr = liveCache.get(provider);
    if (!pr) {
      pr = fetch(`/api/models?provider=${provider}`)
        .then((r) => r.json())
        .then((j) => (j.models ?? []) as { id: string; label?: string }[])
        .catch(() => []);
      liveCache.set(provider, pr);
    }
    pr.then((l) => alive && setList(l));
    return () => {
      alive = false;
    };
  }, [provider, hasKey]);
  return hasKey ? list : [];
}

function ParamControl({ def, value, onChange }: { def: ParamDef; value: unknown; onChange: (v: unknown) => void }) {
  if (def.kind === "select") {
    return (
      <select value={String(value ?? def.default)} onChange={(e) => onChange(e.target.value)} className={`${smallInput} !w-36`}>
        {(def.options ?? []).map((o) => (
          <option key={o}>{o}</option>
        ))}
      </select>
    );
  }
  if (def.kind === "toggle") return <Toggle checked={Boolean(value ?? def.default)} onChange={onChange} />;
  if (def.kind === "tags") {
    return (
      <input
        value={Array.isArray(value) ? (value as string[]).join(", ") : ""}
        onChange={(e) =>
          onChange(
            e.target.value
              .split(",")
              .map((x) => x.trim())
              .filter(Boolean),
          )
        }
        placeholder="쉼표로 구분"
        className={`${smallInput} !w-44`}
      />
    );
  }
  const num = Number(value ?? def.default);
  const slider = def.max !== undefined && def.min !== undefined && def.max - def.min <= 2;
  return (
    <div className="flex items-center gap-2">
      {slider && (
        <input
          type="range"
          min={def.min}
          max={def.max}
          step={def.step}
          value={num}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-24 accent-[var(--color-accent)]"
          aria-label={def.label}
        />
      )}
      <input
        type="number"
        min={def.min}
        max={def.max}
        step={def.step}
        value={Number.isFinite(num) ? num : ""}
        onChange={(e) => onChange(e.target.value === "" ? def.default : Number(e.target.value))}
        className={`${smallInput} ${slider ? "!w-20" : "!w-28"} tabular-nums`}
        aria-label={def.label}
      />
    </div>
  );
}

function ModelPicker({ data, set, keys }: { data: Rec; set: (p: Rec) => void; keys: Partial<Record<ProviderId, boolean>> }) {
  const model = (data.model ?? {}) as { provider?: string; name?: string; mode?: string; completion_params?: Rec };
  const provider = inferProvider(model.provider, model.name);
  const name = model.name?.trim() || DEFAULT_MODEL[provider];
  const spec = specFor(provider, name);
  const params = model.completion_params ?? {};
  const live = useLiveModels(provider, !!keys[provider]);
  const catalog = MODEL_CATALOG.filter((m) => m.provider === provider);
  const extraLive = live.filter((m) => !catalog.some((c) => c.id === m.id));
  const listed = catalog.some((c) => c.id === name) || live.some((m) => m.id === name);
  const [customMode, setCustomMode] = useState(false);
  const showCustom = customMode || !listed;

  const setModel = (patch: Rec) => set({ model: { mode: "chat", ...model, ...patch } });
  const choose = (prov: ProviderId, id: string) => {
    const next = specFor(prov, id);
    // 새 모델이 받는 파라미터(선택지 안의 값)만 이어 가고 나머지는 기본값
    const kept = Object.fromEntries(
      Object.entries(prov === provider ? params : {}).filter(([k, v]) => {
        const def = next.params.find((d) => d.key === k);
        return def && (def.kind !== "select" || (def.options ?? []).includes(String(v)));
      }),
    );
    setModel({ provider: prov, name: id, completion_params: { ...defaultParams(next), ...kept } });
  };
  const setParam = (key: string, value: unknown) => {
    const next = { ...params };
    if (value === undefined) delete next[key];
    else next[key] = value;
    setModel({ completion_params: next });
  };
  const known = new Set(spec.params.map((d) => d.key));
  const ignored = Object.entries(params).filter(([k]) => !known.has(k));

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-1 rounded-lg border border-line bg-paper-2 p-0.5">
        {PROVIDER_IDS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => p !== provider && choose(p, DEFAULT_MODEL[p])}
            className={`flex items-center justify-center gap-1.5 rounded-md py-1 text-[12px] ${
              p === provider ? "bg-surface font-semibold text-ink shadow-sm" : "text-ink-3 hover:text-ink"
            }`}
          >
            <ProviderDot provider={p} on={!!keys[p]} />
            {PROVIDERS[p].short}
          </button>
        ))}
      </div>

      <div className="space-y-1.5">
        <select
          value={showCustom ? "__custom" : name}
          onChange={(e) => {
            if (e.target.value === "__custom") setCustomMode(true);
            else {
              setCustomMode(false);
              choose(provider, e.target.value);
            }
          }}
          className={smallInput}
          aria-label="모델"
        >
          <optgroup label="카탈로그">
            {catalog.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label} — {m.id}
              </option>
            ))}
          </optgroup>
          {extraLive.length > 0 && (
            <optgroup label="API에서 확인된 다른 모델">
              {extraLive.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label && m.label !== m.id ? `${m.label} — ${m.id}` : m.id}
                </option>
              ))}
            </optgroup>
          )}
          <option value="__custom">직접 입력…</option>
        </select>
        {showCustom && (
          <input
            value={model.name ?? ""}
            onChange={(e) => setModel({ provider, name: e.target.value.trim() })}
            placeholder="모델 ID (예: gpt-6-luna)"
            className={`${smallInput} font-mono`}
          />
        )}
        <div className="rounded-lg bg-paper-2/70 px-2.5 py-1.5 text-[12px] leading-snug text-ink-3">
          <b className="text-ink-2">{spec.label}</b> · {spec.summary}
          {spec.context && ` · 컨텍스트 ${spec.context}`}
          {spec.maxOutput && ` · 최대 출력 ${spec.maxOutput}`}
          {!keys[provider] && <div className="mt-0.5 text-err">{PROVIDERS[provider].label} API 키가 없습니다 — 실행하면 오류가 납니다.</div>}
        </div>
      </div>

      <div>
        <div className="mb-1 flex items-baseline text-[12px] font-semibold text-ink-2">
          하이퍼파라미터
          <span className="ml-1.5 font-normal text-ink-4">체크한 값만 요청에 넣고, 나머지는 모델 기본값</span>
        </div>
        <div className="divide-y divide-line overflow-hidden rounded-lg border border-line">
          {spec.params.map((def) => {
            const on = def.key in params;
            return (
              <div key={def.key} className={`px-2.5 py-2 ${on ? "bg-surface" : "bg-paper-2/40"}`}>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={(e) => setParam(def.key, e.target.checked ? def.default : undefined)}
                    aria-label={`${def.label} 사용`}
                  />
                  <span className={`font-mono text-[12px] ${on ? "font-semibold text-ink" : "text-ink-3"}`}>{def.label}</span>
                  {def.help && <Help label={`${def.label} 설명`}>{def.help}</Help>}
                  <span className="ml-auto">
                    {on ? (
                      <ParamControl def={def} value={params[def.key]} onChange={(v) => setParam(def.key, v)} />
                    ) : (
                      <span className="text-[11px] text-ink-4">기본값</span>
                    )}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
        {ignored.length > 0 && (
          <div className="mt-1.5 flex items-start gap-2 rounded-md bg-[#fffbeb] px-2 py-1.5 text-[11px] text-[#92400e]">
            <span className="flex-1">이 모델이 쓰지 않는 값(실행 시 무시): {ignored.map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(", ")}</span>
            <button
              type="button"
              onClick={() => setModel({ completion_params: Object.fromEntries(Object.entries(params).filter(([k]) => known.has(k))) })}
              className="shrink-0 font-semibold hover:underline"
            >
              정리
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function BindingRows({
  items,
  onChange,
  vars,
  namePlaceholder = "변수명",
}: {
  items: { variable: string; value_selector: ValueSelector }[];
  onChange: (items: { variable: string; value_selector: ValueSelector }[]) => void;
  vars: VarOption[];
  namePlaceholder?: string;
}) {
  return (
    <div className="space-y-1.5">
      {items.map((it, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <input
            value={it.variable}
            onChange={(e) => onChange(items.map((x, j) => (j === i ? { ...x, variable: e.target.value.replace(/[^\w]/g, "") } : x)))}
            placeholder={namePlaceholder}
            className={`${smallInput} !w-28 shrink-0 font-mono`}
          />
          <span className="text-ink-4">←</span>
          <VarSelect value={it.value_selector} onChange={(sel) => onChange(items.map((x, j) => (j === i ? { ...x, value_selector: sel } : x)))} vars={vars} />
          <RemoveButton onClick={() => onChange(items.filter((_, j) => j !== i))} />
        </div>
      ))}
      <AddButton onClick={() => onChange([...items, { variable: `arg${items.length + 1}`, value_selector: [] }])}>입력 변수 추가</AddButton>
    </div>
  );
}

// ───────────────────────── 노드 타입별 폼 ─────────────────────────

interface FormProps {
  data: Rec;
  set: (patch: Rec) => void;
  vars: VarOption[];
  keys: Partial<Record<ProviderId, boolean>>;
  datasets: { id: string; name: string; chunkCount: number }[];
  /** LLM 노드에 붙은 메모리 모듈이 내놓는 메모리 도구(있을 때) */
  memoryTool?: { module: string; commands: string[] } | null;
}

function StartForm({ data, set }: FormProps) {
  type V = { variable: string; label?: string; type?: string; required?: boolean; options?: string[]; default?: unknown };
  const list = (data.variables as V[]) ?? [];
  const update = (i: number, patch: Partial<V>) => set({ variables: list.map((v, j) => (j === i ? { ...v, ...patch } : v)) });
  return (
    <Group
      title="시작 입력 변수"
      help={
        <>
          채팅 메시지는 항상 <code className="font-mono">sys.query</code>로 들어옵니다. 여기 변수는 채팅 위의 입력 폼으로 받습니다.
        </>
      }
      action={<AddButton onClick={() => set({ variables: [...list, { variable: `input${list.length + 1}`, label: "입력", type: "text-input", required: false }] })}>추가</AddButton>}
    >
      {list.length > 0 && list.map((v, i) => (
        <div key={i} className="space-y-1.5 rounded-lg border border-line bg-paper-2/40 p-2">
          <div className="flex items-center gap-1.5">
            <input value={v.variable} onChange={(e) => update(i, { variable: e.target.value.replace(/[^\w]/g, "") })} className={`${smallInput} font-mono`} placeholder="변수명" />
            <input value={v.label ?? ""} onChange={(e) => update(i, { label: e.target.value })} className={smallInput} placeholder="표시 이름" />
            <RemoveButton onClick={() => set({ variables: list.filter((_, j) => j !== i) })} />
          </div>
          <div className="flex items-center gap-1.5">
            <select value={v.type ?? "text-input"} onChange={(e) => update(i, { type: e.target.value })} className={`${smallInput} !w-32`}>
              <option value="text-input">짧은 텍스트</option>
              <option value="paragraph">긴 텍스트</option>
              <option value="select">선택</option>
              <option value="number">숫자</option>
            </select>
            <label className="flex shrink-0 items-center gap-1 text-[12px] text-ink-2">
              <input type="checkbox" checked={!!v.required} onChange={(e) => update(i, { required: e.target.checked })} />
              필수
            </label>
            <input
              value={String(v.default ?? "")}
              onChange={(e) => update(i, { default: e.target.value })}
              className={smallInput}
              placeholder="기본값"
            />
          </div>
          {v.type === "select" && (
            <input
              value={(v.options ?? []).join(", ")}
              onChange={(e) => update(i, { options: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
              className={smallInput}
              placeholder="선택지 (쉼표로 구분)"
            />
          )}
        </div>
      ))}
    </Group>
  );
}

function LlmForm({ data, set, vars, keys, memoryTool }: FormProps) {
  type P = { role?: string; text?: string; edition_type?: string; jinja2_text?: string; id?: string };
  const context = (data.context ?? { enabled: false, variable_selector: [] }) as { enabled?: boolean; variable_selector?: ValueSelector };
  const memory = data.memory as { window?: { enabled?: boolean; size?: number }; query_prompt_template?: string } | undefined;
  const isChat = Array.isArray(data.prompt_template);
  const prompts: P[] = isChat ? (data.prompt_template as P[]) : [{ role: "user", ...((data.prompt_template as P) ?? {}) }];
  const setPrompts = (next: P[]) => set({ prompt_template: isChat ? next : next[0] });
  const ctxToken = context.enabled ? [{ label: "컨텍스트 {{#context#}}", token: "{{#context#}}" }] : [];

  return (
    <>
      <Group title="모델">
        <ModelPicker data={data} set={set} keys={keys} />
      </Group>
      <Group
        title="컨텍스트"
        help={
          <>
            고른 변수(보통 지식 검색 result)의 내용이 프롬프트의 <code className="font-mono">{"{{#context#}}"}</code> 자리에 들어갑니다.
          </>
        }
        action={<Toggle checked={!!context.enabled} onChange={(on) => set({ context: { ...context, enabled: on } })} />}
      >
        {!!context.enabled && (
          <VarSelect value={context.variable_selector} onChange={(sel) => set({ context: { ...context, variable_selector: sel } })} vars={vars} placeholder="컨텍스트로 쓸 변수 (보통 지식 검색 result)" />
        )}
      </Group>
      <Group title="프롬프트" action={isChat ? <AddButton onClick={() => setPrompts([...prompts, { role: "user", text: "" }])}>메시지 추가</AddButton> : null}>
        {prompts.map((p, i) => (
          <div key={i} className="space-y-1">
            <div className="flex items-center gap-1.5">
              {isChat ? (
                <select
                  value={p.role ?? "user"}
                  onChange={(e) => setPrompts(prompts.map((x, j) => (j === i ? { ...x, role: e.target.value } : x)))}
                  className="rounded border border-line bg-surface px-1.5 py-0.5 font-mono text-[11px] font-bold uppercase text-ink-2"
                >
                  <option value="system">system</option>
                  <option value="user">user</option>
                  <option value="assistant">assistant</option>
                </select>
              ) : (
                <span className="font-mono text-[11px] font-bold text-ink-2">PROMPT</span>
              )}
              {p.edition_type === "jinja2" && <span className="text-[11px] text-ink-3">Jinja2</span>}
              <span className="ml-auto" />
              {isChat && prompts.length > 1 && <RemoveButton onClick={() => setPrompts(prompts.filter((_, j) => j !== i))} />}
            </div>
            <TemplateArea
              value={p.edition_type === "jinja2" ? (p.jinja2_text ?? "") : (p.text ?? "")}
              onChange={(v) => setPrompts(prompts.map((x, j) => (j === i ? (x.edition_type === "jinja2" ? { ...x, jinja2_text: v } : { ...x, text: v }) : x)))}
              vars={vars}
              extraTokens={ctxToken}
              rows={p.role === "system" ? 6 : 3}
            />
          </div>
        ))}
      </Group>
      <Group
        title="이전 대화 포함"
        help="이전 대화를 messages로 함께 보냅니다. 끄면 매 턴 독립적으로 호출합니다. 이전 대화를 주는 메모리 모듈(슬라이딩 윈도, 요약)이 붙으면 이 설정 대신 모듈의 것이 들어갑니다."
        action={<Toggle checked={!!memory} onChange={(on) => set({ memory: on ? { window: { enabled: true, size: 6 }, query_prompt_template: "{{#sys.query#}}" } : undefined })} />}
      >
        {memory && (
          <>
            <div className="flex items-center gap-2 text-[12px] text-ink-2">
              최근
              <input
                type="number"
                min={1}
                max={50}
                value={memory.window?.size ?? 6}
                onChange={(e) => set({ memory: { ...memory, window: { enabled: true, size: Number(e.target.value) || 1 } } })}
                className={`${smallInput} !w-16`}
                aria-label="포함할 이전 대화 턴 수"
              />
              턴
            </div>
            <Field label="질의 템플릿" help="이전 대화 뒤에 마지막 user 메시지로 붙습니다.">
              <TemplateArea value={memory.query_prompt_template ?? "{{#sys.query#}}"} onChange={(v) => set({ memory: { ...memory, query_prompt_template: v } })} vars={vars} extraTokens={ctxToken} rows={2} />
            </Field>
          </>
        )}
      </Group>
      <StructuredOutputGroup data={data} set={set} />
      <ToolsGroup data={data} set={set} memoryTool={memoryTool ?? null} />
    </>
  );
}

// ───────────────────────── 도구 호출 ─────────────────────────

const NEW_CUSTOM_TOOL: CustomTool = {
  name: "lookup_order",
  description: "주문 번호로 주문 상태를 조회한다. 사용자가 주문·배송 상태를 물을 때 쓴다.",
  parameters: JSON.stringify({ type: "object", properties: { order_id: { type: "string", description: "주문 번호" } }, required: ["order_id"] }, null, 2),
  code: `function main({ order_id }) {
  // 여기서 값을 계산해 돌려준다. 돌려준 값이 모델에게 도구 결과로 전달된다.
  return { order_id, status: "배송 중" };
}`,
};

/** hint: 항상 보이는 한 줄(짧게). help: ⓘ 뒤의 설명. */
function CheckRow({ checked, onChange, label, hint, help, mono }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string; help?: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-start gap-1 rounded-md px-1 py-0.5 hover:bg-paper-2">
      <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-2">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-[3px] accent-[var(--color-accent)]" />
        <span className="min-w-0">
          <span className={`block text-[13px] text-ink ${mono ? "font-mono" : ""}`}>{label}</span>
          {hint && <span className="block text-[11px] leading-snug text-ink-3">{hint}</span>}
        </span>
      </label>
      {help && <Help align="right">{help}</Help>}
    </div>
  );
}

function CustomToolEditor({ tool, onChange, onRemove }: { tool: CustomTool; onChange: (t: CustomTool) => void; onRemove: () => void }) {
  const text = typeof tool.parameters === "string" ? tool.parameters : JSON.stringify(tool.parameters, null, 2);
  let schemaError: string | null = null;
  try {
    if (text.trim()) JSON.parse(text);
  } catch (e) {
    schemaError = (e as Error).message;
  }
  const sent = tool.name.trim() ? safeToolName(tool.name) : "";
  return (
    <details className="rounded-lg border border-line bg-surface" open={!tool.code.trim()}>
      <summary className="flex cursor-pointer items-center gap-2 px-2.5 py-1.5 text-[13px]">
        <span className="font-mono font-semibold text-ink">{tool.name || "(이름 없음)"}</span>
        <span className="min-w-0 flex-1 truncate text-[12px] text-ink-3">{tool.description}</span>
        <RemoveButton onClick={onRemove} label="도구 삭제" />
      </summary>
      <div className="space-y-2.5 border-t border-line px-2.5 py-2.5">
        <Field label="이름" hint={sent && sent !== tool.name ? `모델에 전달되는 이름: ${sent} (영문·숫자·_·-만 가능)` : undefined}>
          <input value={tool.name} onChange={(e) => onChange({ ...tool, name: e.target.value })} className={`${smallInput} font-mono`} />
        </Field>
        <Field label="설명" help="모델이 이 설명을 보고 언제 부를지 정합니다. 무엇을 하는지, 언제 쓰는지 적으세요.">
          <textarea value={tool.description} onChange={(e) => onChange({ ...tool, description: e.target.value })} rows={2} className={smallInput} />
        </Field>
        <Field label="입력 (JSON 스키마)" hint={schemaError ? <span className="text-err">JSON 형식이 아닙니다 — 실행할 때 이 도구는 빠집니다. ({schemaError})</span> : undefined}>
          <textarea value={text} onChange={(e) => onChange({ ...tool, parameters: e.target.value })} rows={6} spellCheck={false} className={`${smallInput} font-mono !text-[12px] leading-relaxed`} />
        </Field>
        <Field label="코드 (JavaScript)" help="main(입력)이 돌려준 값이 도구 결과가 됩니다. 코드 노드와 같은 실행기라 네트워크·파일은 쓸 수 없고 3초 제한이 있습니다.">
          <textarea value={tool.code} onChange={(e) => onChange({ ...tool, code: e.target.value })} rows={7} spellCheck={false} className={`${smallInput} font-mono !text-[12px] leading-relaxed`} />
        </Field>
      </div>
    </details>
  );
}

function ToolsGroup({ data, set, memoryTool }: { data: Rec; set: (p: Rec) => void; memoryTool: { module: string; commands: string[] } | null }) {
  const cfg = readTools(data);
  const { catalog, reload } = useToolCatalog();
  const [modal, setModal] = useState<ToolsTab | null>(null);
  const { info: connectors, reload: reloadConnectors } = useConnectors();
  const google = connectors?.google;
  const save = (patch: Partial<ToolsConfig>) => set({ tools: { ...cfg, ...patch } });
  const toggle = (list: string[], id: string, on: boolean) => (on ? [...new Set([...list, id])] : list.filter((x) => x !== id));
  const sub = "mb-1 flex items-center gap-1 text-[11px] font-semibold tracking-wide text-ink-3";
  const manage = (tab: ToolsTab) => (
    <button type="button" onClick={() => setModal(tab)} className="ml-auto inline-flex items-center gap-1 text-[12px] font-medium text-accent hover:underline">
      <Settings2 size={12} />
      관리
    </button>
  );
  const knownSkills = new Set((catalog?.skills ?? []).map((s) => s.id));
  const knownServers = new Set((catalog?.mcp ?? []).map((s) => s.name));
  const lostSkills = cfg.skills.filter((id) => catalog && !knownSkills.has(id));
  const lostServers = cfg.mcp.filter((m) => catalog && !knownServers.has(m.server));

  return (
    <Group
      title="도구"
      help="모델이 답하는 도중에 도구를 부를 수 있습니다. 결과를 돌려주고 다시 호출하기를 모델이 그만 부를 때까지 되풀이합니다."
      action={<Toggle checked={cfg.enabled} onChange={(on) => save({ enabled: on })} />}
    >
      {(memoryTool || cfg.enabled) && (
        <>
      {memoryTool && (
        <div className="flex items-start gap-2 rounded-lg border border-line bg-paper px-2.5 py-2 text-[12px] leading-snug text-ink-2">
          <Brain size={13} className="mt-0.5 shrink-0 text-[#be185d]" />
          <span>
            메모리 모듈 <b className="font-semibold">{memoryTool.module}</b>의 <code className="font-mono">memory</code> 도구({memoryTool.commands.join(", ")})가 아래 설정과 상관없이 붙습니다.
          </span>
        </div>
      )}
      {cfg.enabled && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Field label="최대 왕복" help="이 횟수를 넘으면 도구 없이 답하게 합니다.">
              <input type="number" min={1} max={30} value={cfg.max_steps} onChange={(e) => save({ max_steps: Number(e.target.value) || DEFAULT_MAX_STEPS })} className={smallInput} />
            </Field>
            <Field
              label={
                <>
                  결과 비우기 기준(자)
                  <Help align="right">
                    도구 결과가 이 글자 수를 넘으면 오래된 것부터 비웁니다. 최근 {COMPACT_KEEP_ROUNDS}번의 왕복은 그대로 두고, 비운 자리에는 다시 부르라는 안내가 남습니다. 0이면 비우지 않습니다.
                  </Help>
                </>
              }
            >
              <input
                type="number"
                min={0}
                step={10000}
                value={cfg.compact_after}
                onChange={(e) => save({ compact_after: Math.max(0, Number(e.target.value) || 0) })}
                className={smallInput}
                aria-label="도구 결과를 비우기 시작하는 글자 수"
              />
            </Field>
          </div>

          <div>
            <div className={sub}>내장 도구</div>
            {BUILTIN_TOOLS.map((t) => (
              <CheckRow key={t.name} checked={cfg.builtin.includes(t.name)} onChange={(on) => save({ builtin: toggle(cfg.builtin, t.name, on) })} label={`${t.label} · ${t.name}`} help={t.description} />
            ))}
          </div>

          <div>
            <div className={sub}>
              커넥터 · Google
              <Help>내 Google 계정으로 메일·일정·시트·문서를 읽고 씁니다. 여러 도구를 이어 불러 다단계 작업을 합니다. 메일과 문서의 내용은 남이 쓴 글이라 외부 자료로 다룹니다.</Help>
              {manage("connectors")}
            </div>
            {CONNECTOR_SERVICES.map((svc) => {
              const tools = GOOGLE_TOOLS.filter((t) => t.service === svc.id);
              const on = tools.filter((t) => cfg.connectors.includes(t.name)).length;
              const linked = google ? serviceConnected(google.services, svc.id) : true;
              return (
                <details key={svc.id} className="rounded-md" open={on > 0}>
                  <summary className="cursor-pointer rounded-md px-1 py-1 text-[13px] text-ink hover:bg-paper-2">
                    {svc.label} <span className="text-[11px] text-ink-3">{on ? `${on}/${tools.length}` : `${tools.length}개`}</span>
                    {on > 0 && !linked && <span className={`ml-1.5 text-[11px] ${google?.demo ? "text-ink-3" : "text-err"}`}>{google?.demo ? "예시 데이터" : "연결 안 됨"}</span>}
                  </summary>
                  <div className="pl-3">
                    {tools.map((t) => (
                      <CheckRow
                        key={t.name}
                        checked={cfg.connectors.includes(t.name)}
                        onChange={(v) => save({ connectors: toggle(cfg.connectors, t.name, v) })}
                        label={`${t.label} · ${t.name}`}
                        hint={t.outward ? "다른 사람에게 바로 닿습니다. 되돌릴 수 없습니다." : undefined}
                        help={t.description}
                      />
                    ))}
                  </div>
                </details>
              );
            })}
          </div>

          <div>
            <div className={sub}>공급자가 실행하는 도구</div>
            {PROVIDER_TOOLS.map((t) => (
              <CheckRow key={t.name} checked={cfg.provider.includes(t.name)} onChange={(on) => save({ provider: toggle(cfg.provider, t.name, on) })} label={`${t.label} · ${t.name}`} help={t.description} />
            ))}
          </div>

          <div>
            <div className={sub}>
              직접 만든 도구
              <span className="ml-auto">
                <AddButton onClick={() => save({ custom: [...cfg.custom, { ...NEW_CUSTOM_TOOL, name: cfg.custom.some((c) => c.name === NEW_CUSTOM_TOOL.name) ? `tool_${cfg.custom.length + 1}` : NEW_CUSTOM_TOOL.name }] })}>추가</AddButton>
              </span>
            </div>
            <div className="space-y-1.5">
              {cfg.custom.map((t, i) => (
                <CustomToolEditor key={i} tool={t} onChange={(next) => save({ custom: cfg.custom.map((x, j) => (j === i ? next : x)) })} onRemove={() => save({ custom: cfg.custom.filter((_, j) => j !== i) })} />
              ))}
            </div>
          </div>

          <div>
            <div className={sub}>스킬{manage("skills")}</div>
            {(catalog?.skills ?? []).map((s) => (
              <CheckRow key={s.id} mono checked={cfg.skills.includes(s.id)} onChange={(on) => save({ skills: toggle(cfg.skills, s.id, on) })} label={s.id} help={s.description || undefined} />
            ))}
            {lostSkills.map((id) => (
              <CheckRow key={id} mono checked onChange={() => save({ skills: cfg.skills.filter((x) => x !== id) })} label={id} hint="이 PC에 없는 스킬입니다 — 실행할 때 빠집니다." />
            ))}
            {catalog && catalog.skills.length === 0 && lostSkills.length === 0 && <p className="text-[12px] text-ink-3">등록된 스킬이 없습니다. ‘관리’에서 만드세요.</p>}
          </div>

          <div>
            <div className={sub}>
              외부 MCP 서버
              <Help>도구가 많은 서버는 쓸 도구만 골라 두세요. 도구 설명이 매 호출의 프롬프트에 들어갑니다.</Help>
              {manage("mcp")}
            </div>
            {(catalog?.mcp ?? []).map((s) => {
              const ref = cfg.mcp.find((m) => m.server === s.name);
              return (
                <div key={s.name}>
                  <CheckRow
                    mono
                    checked={!!ref}
                    onChange={(on) => save({ mcp: on ? [...cfg.mcp, { server: s.name, tools: [] }] : cfg.mcp.filter((m) => m.server !== s.name) })}
                    label={s.name}
                    hint={`${s.type === "stdio" ? "로컬" : "원격"} · ${s.target}`}
                  />
                  {ref && (
                    <input
                      value={(ref.tools ?? []).join(", ")}
                      onChange={(e) => save({ mcp: cfg.mcp.map((m) => (m.server === s.name ? { ...m, tools: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) } : m)) })}
                      placeholder="쓸 도구 이름을 쉼표로 (비우면 서버의 도구 전부)"
                      className={`${smallInput} mb-1 ml-6 !w-[calc(100%-1.5rem)] font-mono !text-[12px]`}
                      aria-label={`${s.name}에서 쓸 도구`}
                    />
                  )}
                </div>
              );
            })}
            {lostServers.map((m) => (
              <CheckRow key={m.server} mono checked onChange={() => save({ mcp: cfg.mcp.filter((x) => x.server !== m.server) })} label={m.server} hint="이 PC에 등록되지 않은 서버입니다 — 실행할 때 빠집니다." />
            ))}
            {catalog && catalog.mcp.length === 0 && lostServers.length === 0 && <p className="text-[12px] text-ink-3">등록된 MCP 서버가 없습니다. ‘관리’에서 추가하세요.</p>}
          </div>
          {modal && catalog && <ToolsModal
              catalog={catalog}
              initialTab={modal}
              onClose={() => {
                setModal(null);
                reloadConnectors();
              }}
              onChanged={reload}
            />}
        </>
      )}
        </>
      )}
    </Group>
  );
}

/** 메모리 모듈 안에 두는 '메모리 도구' 노드: 붙은 LLM 이 쓸 수 있는 명령을 고른다 */
function MemoryToolForm({ data, set }: FormProps) {
  const commands = readMemoryCommands(data);
  const canRead = commands.includes("view");
  const canDelete = commands.includes("delete");
  const canWrite = commands.some((c) => c !== "view" && c !== "delete");
  // 문장 대신 상태 한 줄: 고른 명령이 뜻하는 접근 범위
  const access = !commands.length
    ? null
    : canWrite
      ? `${canRead ? "읽기·쓰기" : "쓰기 전용"}${canDelete ? "" : " (삭제 불가)"}`
      : canRead
        ? canDelete
          ? "읽기·삭제"
          : "읽기 전용"
        : "삭제 전용";
  return (
    <Group
      title="모델이 쓸 수 있는 명령"
      help={
        <>
          선은 잇지 않습니다. 메모리 모듈 안에 있으면 모듈이 붙은 LLM 노드가 <code className="font-mono">memory</code> 도구로 저장소 파일(/memories)을 읽고 씁니다. 이 노드를 지우면 읽기 구역의 결과만 프롬프트에 들어갑니다.
        </>
      }
      action={access ? <span className="text-[12px] font-medium text-ink-2">{access}</span> : null}
    >
      {MEMORY_COMMANDS.map((c) => (
        <CheckRow key={c} checked={commands.includes(c)} onChange={(on) => set({ commands: MEMORY_COMMANDS.filter((x) => (x === c ? on : commands.includes(x))) })} label={`${MEMORY_COMMAND_LABEL[c]} · ${c}`} />
      ))}
      {!access && <p className="text-[12px] leading-snug text-err">고른 명령이 없어 LLM에 memory 도구가 붙지 않습니다.</p>}
    </Group>
  );
}

/** LLM 구조화 출력: JSON 스키마대로 받아 structured_output 변수로 내놓는다 */
function StructuredOutputGroup({ data, set }: { data: Rec; set: (p: Rec) => void }) {
  const on = !!data.structured_output_enabled;
  const schema = (data.structured_output as { schema?: unknown } | undefined)?.schema;
  const [text, setText] = useState(() => (schema ? JSON.stringify(schema, null, 2) : ""));
  const [error, setError] = useState<string | null>(null);
  const starter = { type: "object", properties: { answer: { type: "string" } }, required: ["answer"], additionalProperties: false };
  const fields = Object.keys(rec(rec(schema).properties));
  return (
    <Group
      collapsed={!on}
      title="구조화 출력"
      help="글 대신 이 JSON 스키마 모양의 응답을 받아 structured_output 변수로 내놓습니다. 모든 속성을 required에 넣고 additionalProperties는 false로 두세요."
      action={
        <Toggle
          checked={on}
          onChange={(v) => {
            if (v && !schema) {
              setText(JSON.stringify(starter, null, 2));
              set({ structured_output_enabled: true, structured_output: { schema: starter } });
            } else set({ structured_output_enabled: v });
          }}
        />
      }
    >
      <div className={on ? "contents" : "hidden"}>
          <textarea
            value={text}
            rows={9}
            spellCheck={false}
            data-gramm="false"
            data-enable-grammarly="false"
            onChange={(e) => {
              setText(e.target.value);
              try {
                const parsed = JSON.parse(e.target.value);
                setError(null);
                set({ structured_output: { schema: parsed } });
              } catch (err) {
                setError((err as Error).message);
              }
            }}
            className={`${smallInput} font-mono !text-[12px] leading-relaxed`}
            aria-label="JSON 스키마"
          />
          {error ? (
            <p className="text-[12px] text-err">JSON 형식이 아닙니다 — 고칠 때까지 이전 스키마를 씁니다. ({error})</p>
          ) : (
            fields.length > 0 && (
              <div className="flex flex-wrap gap-1" aria-label="다음 노드에서 쓸 수 있는 변수">
                {fields.map((f) => (
                  <code key={f} className="rounded bg-paper-2 px-1.5 py-px font-mono text-[11px] text-ink-2">
                    structured_output.{f}
                  </code>
                ))}
              </div>
            )
          )}
      </div>
    </Group>
  );
}

// ───────────────────────── 메모리 저장소 ─────────────────────────

const STORE_OPS: { op: string; label: string; hint: string; group: "문서" | "기록" }[] = [
  { op: "doc_get", label: "문서 읽기", hint: "키 하나의 글을 읽습니다. 없으면 빈 글을 돌려줍니다.", group: "문서" },
  { op: "doc_get_many", label: "문서 여러 개 읽기", hint: "키 목록(배열 변수)에 있는 글을 모두 읽습니다.", group: "문서" },
  { op: "doc_set", label: "문서 쓰기", hint: "키의 글을 통째로 바꿉니다.", group: "문서" },
  { op: "doc_append", label: "문서에 덧붙이기", hint: "키의 글 끝에 한 줄을 더합니다.", group: "문서" },
  { op: "rec_search", label: "기록 검색", hint: "질의와 관련 있는 기록을 점수순으로 돌려줍니다.", group: "기록" },
  { op: "rec_similar", label: "비슷한 기록 찾기", hint: "항목 목록(배열 변수)마다 비슷한 기록을 모읍니다.", group: "기록" },
  { op: "rec_add", label: "기록 추가", hint: "지금 시각과 함께 기록 하나를 쌓습니다.", group: "기록" },
  { op: "rec_apply", label: "기록에 반영", hint: "ADD / UPDATE / DELETE / INVALIDATE 목록을 적용합니다.", group: "기록" },
];

function MemoryStoreForm({ data, set, vars }: FormProps) {
  const op = String(data.op ?? "doc_get");
  const info = STORE_OPS.find((o) => o.op === op);
  const isDoc = op.startsWith("doc_");
  const needsKey = isDoc && op !== "doc_get_many";
  const needsValue = op === "doc_set" || op === "doc_append" || op === "rec_add";
  const needsList = op === "doc_get_many" || op === "rec_similar" || op === "rec_apply";
  const searches = op === "rec_search" || op === "rec_similar";
  return (
    <>
      <Group title="동작" help={info?.hint}>
        <select value={op} onChange={(e) => set({ op: e.target.value })} className={smallInput} aria-label="저장소 동작">
          {(["문서", "기록"] as const).map((g) => (
            <optgroup key={g} label={g === "문서" ? "문서 · 키로 찾는 글(프로필, 요약, 메모리 파일)" : "기록 · 낱개 기억(사실, 에피소드)"}>
              {STORE_OPS.filter((o) => o.group === g).map((o) => (
                <option key={o.op} value={o.op}>
                  {o.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </Group>
      <Group title="입력">
        {needsKey && (
          <Field label="키" help="변수를 넣을 수 있습니다. 예: daily/{{#모듈.today#}}.md">
            <TemplateArea value={String(data.key ?? "")} onChange={(v) => set({ key: v })} vars={vars} rows={1} mono />
          </Field>
        )}
        {needsValue && (
          <Field label={op === "rec_add" ? "기록할 내용" : op === "doc_append" ? "덧붙일 내용" : "쓸 내용"}>
            <TemplateArea value={String(data.value ?? "")} onChange={(v) => set({ value: v })} vars={vars} rows={3} />
          </Field>
        )}
        {op === "rec_add" && (
          <Field label="중요도 (1~10, 선택)">
            <TemplateArea value={String(data.importance ?? "")} onChange={(v) => set({ importance: v })} vars={vars} rows={1} />
          </Field>
        )}
        {op === "rec_search" && (
          <Field label="질의">
            <TemplateArea value={String(data.query ?? "")} onChange={(v) => set({ query: v })} vars={vars} rows={2} />
          </Field>
        )}
        {needsList && (
          <Field
            label={op === "doc_get_many" ? "키 목록 변수" : op === "rec_similar" ? "항목 목록 변수" : "반영할 목록 변수"}
            help={op === "rec_apply" ? "[{ op, id, text }] 모양의 배열입니다. 없는 id는 그 항목만 건너뜁니다." : "문자열 배열이어야 합니다."}
          >
            <VarSelect value={data.list as ValueSelector} onChange={(sel) => set({ list: sel })} vars={vars} placeholder="배열 변수 선택" />
          </Field>
        )}
        {searches && (
          <>
            <div className="flex items-center gap-2 text-[12px] text-ink-2">
              {op === "rec_similar" ? "항목마다 상위" : "상위"}
              <input type="number" min={1} max={100} value={Number(data.top_k ?? 5)} onChange={(e) => set({ top_k: Number(e.target.value) || 1 })} className={`${smallInput} !w-16`} />
              개
            </div>
            <label className="flex items-center gap-2 text-[12px] text-ink-2">
              <input type="checkbox" checked={data.valid_only !== false} onChange={(e) => set({ valid_only: e.target.checked })} className="accent-accent" />
              지금 유효한 기록만
              <Help>무효 처리된 사실은 결과에서 뺍니다.</Help>
            </label>
            {op === "rec_search" && (
              <label className="flex items-center gap-2 text-[12px] text-ink-2">
                <input type="checkbox" checked={!!data.include_unmatched} onChange={(e) => set({ include_unmatched: e.target.checked })} className="accent-accent" />
                관련성 0점인 기록도 포함
                <Help>뒤에서 다른 점수로 다시 줄 세울 때 켭니다.</Help>
              </label>
            )}
            <p className="text-[12px] leading-snug text-ink-3">어휘 유사도(TF-IDF) 검색이라 낱말이 겹쳐야 찾습니다.</p>
          </>
        )}
      </Group>
      <Group title="저장소">
        <Field label="저장소 이름" help="비워 두면 이 노드가 들어 있는 메모리 모듈의 저장소를 씁니다.">
          <input value={String(data.store ?? "")} onChange={(e) => set({ store: e.target.value })} className={smallInput} placeholder="(모듈의 저장소)" />
        </Field>
      </Group>
    </>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative h-[18px] w-8 rounded-full transition ${checked ? "bg-accent" : "bg-line-2"}`}
    >
      <span className={`absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white shadow transition-all ${checked ? "left-[16px]" : "left-[2px]"}`} />
    </button>
  );
}

function AnswerForm({ data, set, vars }: FormProps) {
  return (
    <Group title="답변 내용" help="변수를 채운 글이 채팅에 그대로 출력됩니다.">
      <TemplateArea value={String(data.answer ?? "")} onChange={(v) => set({ answer: v })} vars={vars} rows={5} placeholder="예: {{#llm.text#}}" />
    </Group>
  );
}

function EndForm({ data, set, vars }: FormProps) {
  const outputs = (data.outputs as { variable: string; value_selector: ValueSelector }[]) ?? [];
  return (
    <Group title="출력 변수">
      <BindingRows items={outputs} onChange={(o) => set({ outputs: o })} vars={vars} namePlaceholder="출력명" />
    </Group>
  );
}

function ClassifierForm({ data, set, vars, keys }: FormProps) {
  const classes = (data.classes as { id: string; name: string }[]) ?? [];
  const nextId = () => String(Math.max(0, ...classes.map((c) => Number(c.id) || 0)) + 1);
  return (
    <>
      <Group title="입력">
        <VarSelect value={data.query_variable_selector as ValueSelector} onChange={(sel) => set({ query_variable_selector: sel })} vars={vars} />
      </Group>
      <Group title="모델">
        <ModelPicker data={data} set={set} keys={keys} />
      </Group>
      <Group title="분류 항목" help="항목마다 캔버스에 점이 생깁니다. 각 점을 다음 노드에 연결하세요." action={<AddButton onClick={() => set({ classes: [...classes, { id: nextId(), name: "" }] })}>항목 추가</AddButton>}>
        {classes.length > 0 && classes.map((c, i) => (
          <div key={c.id} className="flex items-start gap-1.5">
            <span className="mt-1.5 w-12 shrink-0 font-mono text-[11px] text-ink-3">분류 {i + 1}</span>
            <textarea
              value={c.name}
              rows={2}
              onChange={(e) => set({ classes: classes.map((x) => (x.id === c.id ? { ...x, name: e.target.value } : x)) })}
              className={`${smallInput} resize-y`}
              placeholder="이 분류에 해당하는 질문 설명"
            />
            {classes.length > 1 && <RemoveButton onClick={() => set({ classes: classes.filter((x) => x.id !== c.id) })} />}
          </div>
        ))}
      </Group>
      <Group title="추가 지시 (선택)">
        <TemplateArea value={String(data.instruction ?? "")} onChange={(v) => set({ instruction: v })} vars={vars} rows={3} />
      </Group>
    </>
  );
}

function ExtractorForm({ data, set, vars, keys }: FormProps) {
  type P = { name: string; type: string; description?: string; required?: boolean };
  const params = (data.parameters as P[]) ?? [];
  const update = (i: number, patch: Partial<P>) => set({ parameters: params.map((p, j) => (j === i ? { ...p, ...patch } : p)) });
  return (
    <>
      <Group title="입력">
        <VarSelect value={data.query as ValueSelector} onChange={(sel) => set({ query: sel })} vars={vars} />
      </Group>
      <Group title="모델">
        <ModelPicker data={data} set={set} keys={keys} />
      </Group>
      <Group title="추출할 파라미터" action={<AddButton onClick={() => set({ parameters: [...params, { name: `param${params.length + 1}`, type: "string", description: "", required: false }] })}>추가</AddButton>}>
        {params.map((p, i) => (
          <div key={i} className="space-y-1.5 rounded-lg border border-line bg-paper-2/40 p-2">
            <div className="flex items-center gap-1.5">
              <input value={p.name} onChange={(e) => update(i, { name: e.target.value.replace(/[^\w]/g, "") })} className={`${smallInput} font-mono`} placeholder="이름" />
              <select value={p.type} onChange={(e) => update(i, { type: e.target.value })} className={`${smallInput} !w-32`}>
                {["string", "number", "bool", "select", "array[string]", "array[number]"].map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
              <label className="flex shrink-0 items-center gap-1 text-[12px] text-ink-2">
                <input type="checkbox" checked={!!p.required} onChange={(e) => update(i, { required: e.target.checked })} />
                필수
              </label>
              <RemoveButton onClick={() => set({ parameters: params.filter((_, j) => j !== i) })} />
            </div>
            <input value={p.description ?? ""} onChange={(e) => update(i, { description: e.target.value })} className={smallInput} placeholder="모델이 뽑아야 할 내용 설명" />
          </div>
        ))}
      </Group>
      <Group title="추가 지시 (선택)">
        <TemplateArea value={String(data.instruction ?? "")} onChange={(v) => set({ instruction: v })} vars={vars} rows={3} />
      </Group>
    </>
  );
}

function KnowledgeForm({ data, set, vars, datasets }: FormProps) {
  const ids = ((data.dataset_ids as string[]) ?? []).map(String);
  const cfg = (data.multiple_retrieval_config ?? {}) as { top_k?: number; score_threshold?: number | null };
  return (
    <>
      <Group title="검색어">
        <VarSelect value={data.query_variable_selector as ValueSelector} onChange={(sel) => set({ query_variable_selector: sel })} vars={vars} />
      </Group>
      <Group title="데이터셋">
        {datasets.length === 0 && <p className="text-[12px] text-ink-3">data/datasets 폴더에 데이터셋 JSON이 없습니다.</p>}
        {datasets.map((d) => (
          <label key={d.id} className="flex items-center gap-2 text-[13px] text-ink-2">
            <input
              type="checkbox"
              checked={ids.includes(d.id)}
              onChange={(e) => set({ dataset_ids: e.target.checked ? [...ids, d.id] : ids.filter((x) => x !== d.id) })}
            />
            {d.name}
            <span className="text-[11px] text-ink-4">
              {d.id} · 청크 {d.chunkCount}
            </span>
          </label>
        ))}
        {ids.filter((id) => !datasets.some((d) => d.id === id)).map((id) => (
          <div key={id} className="text-[12px] text-err">
            {id} — 로컬에 없는 데이터셋 (실행 시 건너뜀)
          </div>
        ))}
      </Group>
      <Group title="검색 설정">
        <div className="grid grid-cols-2 gap-2">
          <Field label="Top K">
            <input
              type="number"
              min={1}
              max={20}
              value={cfg.top_k ?? 3}
              onChange={(e) => set({ multiple_retrieval_config: { ...cfg, top_k: Number(e.target.value) || 1 } })}
              className={smallInput}
            />
          </Field>
          <Field label="점수 임계값 (0~1)">
            <input
              type="number"
              step={0.05}
              min={0}
              max={1}
              value={cfg.score_threshold ?? ""}
              placeholder="없음"
              onChange={(e) => set({ multiple_retrieval_config: { ...cfg, score_threshold: e.target.value === "" ? null : Number(e.target.value) } })}
              className={smallInput}
            />
          </Field>
        </div>
      </Group>
    </>
  );
}

const OPERATORS = ["contains", "not contains", "start with", "end with", "is", "is not", "empty", "not empty", "=", "≠", ">", "<", "≥", "≤", "in", "not in", "null", "not null"];
const NO_VALUE = new Set(["empty", "not empty", "null", "not null"]);

function IfElseForm({ data, set, vars }: FormProps) {
  type Cond = { variable_selector: ValueSelector; comparison_operator: string; value?: unknown; id?: string };
  type Case = { case_id: string; logical_operator: "and" | "or"; conditions: Cond[] };
  const cases: Case[] = Array.isArray(data.cases)
    ? (data.cases as Case[])
    : [{ case_id: "true", logical_operator: (data.logical_operator as "and") ?? "and", conditions: (data.conditions as Cond[]) ?? [] }];
  const save = (next: Case[]) => {
    const rest = { ...data };
    delete rest.conditions;
    delete rest.logical_operator;
    set({ ...rest, cases: next });
  };
  const updateCase = (ci: number, patch: Partial<Case>) => save(cases.map((c, j) => (j === ci ? { ...c, ...patch } : c)));

  return (
    <Group title="조건" action={<AddButton onClick={() => save([...cases, { case_id: String(Date.now()), logical_operator: "and", conditions: [] }])}>ELIF 추가</AddButton>}>
      {cases.map((c, ci) => (
        <div key={c.case_id} className="space-y-1.5 rounded-lg border border-line bg-paper-2/40 p-2">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[11px] font-bold text-ink">{ci === 0 ? "IF" : "ELIF"}</span>
            {c.conditions.length > 1 && (
              <select value={c.logical_operator} onChange={(e) => updateCase(ci, { logical_operator: e.target.value as "and" | "or" })} className="rounded border border-line bg-surface px-1 py-0.5 text-[11px]">
                <option value="and">모두 만족 (AND)</option>
                <option value="or">하나라도 (OR)</option>
              </select>
            )}
            <span className="ml-auto" />
            {ci > 0 && <RemoveButton onClick={() => save(cases.filter((_, j) => j !== ci))} label="분기 삭제" />}
          </div>
          {c.conditions.map((cond, k) => (
            <div key={k} className="space-y-1 rounded-md bg-surface p-1.5">
              <div className="flex items-center gap-1">
                <VarSelect
                  value={cond.variable_selector}
                  onChange={(sel) => updateCase(ci, { conditions: c.conditions.map((x, j) => (j === k ? { ...x, variable_selector: sel } : x)) })}
                  vars={vars}
                />
                <RemoveButton onClick={() => updateCase(ci, { conditions: c.conditions.filter((_, j) => j !== k) })} />
              </div>
              <div className="flex items-center gap-1">
                <select
                  value={cond.comparison_operator}
                  onChange={(e) => updateCase(ci, { conditions: c.conditions.map((x, j) => (j === k ? { ...x, comparison_operator: e.target.value } : x)) })}
                  className={`${smallInput} !w-32 font-mono`}
                >
                  {OPERATORS.map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </select>
                {!NO_VALUE.has(cond.comparison_operator) && (
                  <input
                    value={String(cond.value ?? "")}
                    onChange={(e) => updateCase(ci, { conditions: c.conditions.map((x, j) => (j === k ? { ...x, value: e.target.value } : x)) })}
                    className={smallInput}
                    placeholder="비교 값 ({{#…#}} 사용 가능)"
                  />
                )}
              </div>
            </div>
          ))}
          <AddButton onClick={() => updateCase(ci, { conditions: [...c.conditions, { variable_selector: [], comparison_operator: "contains", value: "" }] })}>조건 추가</AddButton>
        </div>
      ))}
      <div className="rounded-lg border border-dashed border-line-2 px-2 py-1.5 font-mono text-[11px] text-ink-3">ELSE · 위 조건이 모두 거짓일 때</div>
    </Group>
  );
}

function CodeForm({ data, set, vars }: FormProps) {
  const variables = (data.variables as { variable: string; value_selector: ValueSelector }[]) ?? [];
  const outputs = Object.entries((data.outputs as Record<string, { type: string }>) ?? {});
  const setOutputs = (list: [string, { type: string }][]) =>
    set({ outputs: Object.fromEntries(list.map(([k, v]) => [k, { type: v.type, children: null }])) });
  return (
    <>
      <Group title="입력 변수">
        <BindingRows items={variables} onChange={(v) => set({ variables: v })} vars={vars} />
      </Group>
      <Group
        title="코드"
        help={
          <>
            <code className="font-mono">{data.code_language === "python3" ? "def main(arg1, …) -> dict:" : "function main({ arg1, … })"}</code> 형식입니다. main이 돌려준 dict/object의 키가 출력 변수가 됩니다.
          </>
        }
        action={
          <select value={String(data.code_language ?? "javascript")} onChange={(e) => set({ code_language: e.target.value })} className="rounded border border-line bg-surface px-1.5 py-0.5 text-[11px]">
            <option value="javascript">JavaScript</option>
            <option value="python3">Python 3</option>
          </select>
        }
      >
        <textarea
          value={String(data.code ?? "")}
          onChange={(e) => set({ code: e.target.value })}
          rows={12}
          spellCheck={false}
          className="block w-full resize-y rounded-lg border border-line bg-[#18181b] px-3 py-2 font-mono text-[12px] leading-relaxed text-[#e4e4e7] outline-none focus:border-accent"
        />
      </Group>
      <Group title="출력 변수" action={<AddButton onClick={() => setOutputs([...outputs, [`out${outputs.length + 1}`, { type: "string" }]])}>추가</AddButton>}>
        {outputs.map(([name, v], i) => (
          <div key={i} className="flex items-center gap-1.5">
            <input
              value={name}
              onChange={(e) => setOutputs(outputs.map((x, j) => (j === i ? [e.target.value.replace(/[^\w]/g, ""), x[1]] : x)))}
              className={`${smallInput} font-mono`}
            />
            <select value={v.type} onChange={(e) => setOutputs(outputs.map((x, j) => (j === i ? [x[0], { type: e.target.value }] : x)))} className={`${smallInput} !w-36`}>
              {["string", "number", "boolean", "object", "array[string]", "array[number]", "array[object]"].map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
            <RemoveButton onClick={() => setOutputs(outputs.filter((_, j) => j !== i))} />
          </div>
        ))}
      </Group>
    </>
  );
}

function TemplateForm({ data, set, vars }: FormProps) {
  const variables = (data.variables as { variable: string; value_selector: ValueSelector }[]) ?? [];
  const localVars: VarOption[] = variables.map((v) => ({ selector: [v.variable], scope: "입력 변수", name: v.variable, type: "" }));
  return (
    <>
      <Group title="입력 변수">
        <BindingRows items={variables} onChange={(v) => set({ variables: v })} vars={vars} />
      </Group>
      <Group title="Jinja2 템플릿">
        <TemplateArea value={String(data.template ?? "")} onChange={(v) => set({ template: v })} vars={localVars} rows={8} mono insertFormat={(s) => `{{ ${s} }}`} />
      </Group>
    </>
  );
}

// ───────────────────────── 분기 ─────────────────────────

/** 문구 목록 입력: Enter·쉼표로 추가, ×로 삭제, 빈 칸에서 Backspace 로 마지막 삭제 */
function KeywordInput({ value, onChange, placeholder, mono }: { value: string[]; onChange: (v: string[]) => void; placeholder: string; mono?: boolean }) {
  const [draft, setDraft] = useState("");
  const commit = () => {
    const parts = draft
      .split(mono ? /\n/ : /,/)
      .map((x) => x.trim())
      .filter(Boolean)
      .filter((x) => !value.includes(x));
    if (parts.length) onChange([...value, ...parts]);
    setDraft("");
  };
  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1 rounded-lg border border-line bg-surface px-1.5 py-1 focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/15">
      {value.map((k, i) => (
        <span key={`${k}-${i}`} className={`inline-flex max-w-full items-center gap-0.5 rounded bg-paper-2 py-px pr-0.5 pl-1.5 text-[12px] text-ink ${mono ? "font-mono" : ""}`}>
          <span className="truncate">{k}</span>
          <button type="button" aria-label={`${k} 삭제`} onClick={() => onChange(value.filter((_, j) => j !== i))} className="rounded px-0.5 text-ink-4 hover:text-err">
            ×
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || (!mono && e.key === ",")) {
            e.preventDefault();
            commit();
          } else if (e.key === "Backspace" && !draft && value.length) onChange(value.slice(0, -1));
        }}
        onBlur={commit}
        placeholder={value.length ? "" : placeholder}
        className={`min-w-[90px] flex-1 bg-transparent px-1 py-0.5 text-[13px] outline-none placeholder:text-ink-4 ${mono ? "font-mono" : ""}`}
      />
    </div>
  );
}

/** 텍스트 방식: 예시 문장으로 어느 분기로 갈지 바로 확인 */
function SwitchPreview({ branches, caseSensitive, elseName }: { branches: SwitchBranch[]; caseSensitive: boolean; elseName: string }) {
  const [sample, setSample] = useState("");
  const result = sample.trim() ? evaluateText(sample, branches, caseSensitive) : null;
  return (
    <Group title="미리 확인">
      <input value={sample} onChange={(e) => setSample(e.target.value)} className={smallInput} placeholder="예시 문장" aria-label="예시 문장" />
      {result && (
        <div className="flex flex-wrap items-baseline gap-x-1.5 rounded-lg bg-[#ea580c]/8 px-2.5 py-1.5 text-[12px]">
          <span className="text-ink-3">→</span>
          <b className="text-ink">{result.selected?.name || elseName}</b>
          <span className="text-ink-3">{textReason(result.selected)}</span>
        </div>
      )}
    </Group>
  );
}

function SwitchForm({ data, set, vars, keys }: FormProps) {
  const cfg = readSwitch(data);
  const mode = cfg.mode;
  const branches = (Array.isArray(data.branches) ? data.branches : []) as SwitchBranch[];
  const setBranches = (next: SwitchBranch[]) => set({ branches: next });
  const update = (id: string, patch: Partial<SwitchBranch>) => setBranches(branches.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= branches.length) return;
    const next = [...branches];
    [next[i], next[j]] = [next[j], next[i]];
    setBranches(next);
  };
  const addBranch = () =>
    setBranches([...branches, { id: nextBranchId(branches), name: `분기 ${branches.length + 1}`, operator: "contains_any", keywords: [], description: "" }]);
  const setLanguage = (lang: string) => {
    // 손대지 않은 기본 코드면 새 언어의 기본 코드로 바꿔 준다
    const untouched = !cfg.code.trim() || Object.values(DEFAULT_SWITCH_CODE).includes(cfg.code);
    set({ code_language: lang, ...(untouched ? { code: DEFAULT_SWITCH_CODE[lang] } : {}) });
  };
  const branchHint: Record<SwitchMode, string> = {
    text: "위에서부터 차례로 검사해 처음 맞는 분기로 갑니다. 순서는 화살표로 바꿉니다.",
    code: "코드가 돌려준 이름의 분기로 갑니다.",
    ai: "모델이 설명을 읽고 하나를 고릅니다. 설명이 구체적일수록 정확합니다.",
  };
  const modeHelp: Record<SwitchMode, string> = {
    text: "입력에 특정 문구가 있는지 검사합니다.",
    code: "main()이 돌려준 분기 이름으로 갑니다. JavaScript와 Python을 쓸 수 있습니다.",
    ai: "LLM이 분기 설명을 읽고 하나를 고릅니다.",
  };

  return (
    <>
      <Group title="분기 방식" help={modeHelp[mode]}>
        <div role="radiogroup" aria-label="분기 방식" className="grid grid-cols-3 gap-1 rounded-lg bg-paper-2 p-1">
          {SWITCH_MODES.map((m) => (
            <button
              key={m.value}
              type="button"
              role="radio"
              aria-checked={mode === m.value}
              onClick={() => set({ mode: m.value })}
              className={`rounded-md px-2 py-1.5 text-[12px] font-semibold transition ${mode === m.value ? "bg-surface text-ink shadow-sm" : "text-ink-3 hover:text-ink"}`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </Group>

      <Group title="검사할 텍스트">
        <VarSelect value={cfg.input} onChange={(sel) => set({ input: sel })} vars={vars} />
      </Group>

      {mode === "ai" && (
        <Group title="판단 모델">
          <ModelPicker data={data} set={set} keys={keys} />
        </Group>
      )}

      <Group title={`분기 ${branches.length}개`} help={`${branchHint[mode]} 분기마다 캔버스에 점이 생깁니다.`} action={<AddButton onClick={addBranch}>분기 추가</AddButton>}>
        {branches.map((b, i) => (
          <div key={b.id} className="space-y-1.5 rounded-lg border border-line bg-paper-2/40 p-2">
            <div className="flex items-center gap-1">
              <span className="w-5 shrink-0 text-center font-mono text-[11px] text-ink-4">{i + 1}</span>
              <input value={b.name} onChange={(e) => update(b.id, { name: e.target.value })} className={`${smallInput} font-semibold`} placeholder="분기 이름" aria-label={`분기 ${i + 1} 이름`} />
              {mode === "text" && (
                <>
                  <button type="button" aria-label="위로" disabled={i === 0} onClick={() => move(i, -1)} className="shrink-0 rounded p-1 text-ink-4 hover:bg-paper-2 hover:text-ink disabled:opacity-30">
                    <ArrowUp size={13} />
                  </button>
                  <button type="button" aria-label="아래로" disabled={i === branches.length - 1} onClick={() => move(i, 1)} className="shrink-0 rounded p-1 text-ink-4 hover:bg-paper-2 hover:text-ink disabled:opacity-30">
                    <ArrowDown size={13} />
                  </button>
                </>
              )}
              {branches.length > 1 && <RemoveButton onClick={() => setBranches(branches.filter((x) => x.id !== b.id))} label={`${b.name} 분기 삭제`} />}
            </div>
            {mode === "text" && (
              <div className="flex items-start gap-1.5 pl-6">
                <select
                  value={b.operator ?? "contains_any"}
                  onChange={(e) => update(b.id, { operator: e.target.value as TextOperator })}
                  className={`${smallInput} !w-[118px] shrink-0`}
                  aria-label="비교 방법"
                >
                  {TEXT_OPERATORS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <KeywordInput
                  value={b.keywords ?? []}
                  onChange={(k) => update(b.id, { keywords: k })}
                  mono={b.operator === "regex"}
                  placeholder={b.operator === "regex" ? "정규식 입력 후 Enter" : "문구 입력 후 Enter"}
                />
              </div>
            )}
            {mode === "ai" && (
              <div className="pl-6">
                <textarea
                  value={b.description ?? ""}
                  rows={2}
                  onChange={(e) => update(b.id, { description: e.target.value })}
                  className={`${smallInput} resize-y`}
                  placeholder="이 분기를 고를 조건 (예: 요금제·결제·영수증 관련 질문)"
                  aria-label={`${b.name} 조건 설명`}
                />
              </div>
            )}
          </div>
        ))}
        <div className="flex items-center gap-1.5 rounded-lg border border-dashed border-line-2 px-2 py-1.5">
          <span className="shrink-0 text-[12px] text-ink-3">어느 분기에도 안 맞으면</span>
          <input value={String(data.else_name ?? "그 외")} onChange={(e) => set({ else_name: e.target.value })} className={smallInput} aria-label="그 외 분기 이름" />
        </div>
        {mode === "text" && (
          <label className="flex items-center gap-1.5 text-[12px] text-ink-2">
            <input type="checkbox" checked={cfg.caseSensitive} onChange={(e) => set({ case_sensitive: e.target.checked })} />
            영문 대소문자 구분
          </label>
        )}
      </Group>

      {mode === "text" && <SwitchPreview branches={cfg.branches} caseSensitive={cfg.caseSensitive} elseName={cfg.elseName} />}

      {mode === "code" && (
        <>
          <Group
            title="추가 입력 변수 (선택)"
            help={
              <>
                검사할 텍스트는 항상 <code className="font-mono">text</code>로 들어갑니다. 다른 값도 쓰려면 추가하세요.
              </>
            }
          >
            <BindingRows items={(data.variables as { variable: string; value_selector: ValueSelector }[]) ?? []} onChange={(v) => set({ variables: v })} vars={vars} />
          </Group>
          <Group
            title="코드"
            help={
              <>
                분기 이름(또는 ID)을 돌려주면 그 분기로 갑니다. <code className="font-mono">{cfg.language === "python3" ? "None" : "null"}</code>·false·빈 문자열이면 &apos;{cfg.elseName}&apos;, true면 첫 번째 분기입니다. <code className="font-mono">{`{ branch, reason }`}</code>으로 돌려주면 reason이 실행 기록과 출력 변수에 남습니다.
              </>
            }
            action={
              <select value={cfg.language} onChange={(e) => setLanguage(e.target.value)} className="rounded border border-line bg-surface px-1.5 py-0.5 text-[11px]" aria-label="코드 언어">
                <option value="javascript">JavaScript</option>
                <option value="python3">Python 3</option>
              </select>
            }
          >
            <textarea
              value={cfg.code}
              onChange={(e) => set({ code: e.target.value })}
              rows={11}
              spellCheck={false}
              aria-label="분기 코드"
              className="block w-full resize-y rounded-lg border border-line bg-[#18181b] px-3 py-2 font-mono text-[12px] leading-relaxed text-[#e4e4e7] outline-none focus:border-accent"
            />
            <div className="flex flex-wrap items-center gap-1 text-[12px] leading-snug text-ink-3">
              <span className="mr-0.5">반환값</span>
              {branches.map((b) => (
                <code key={b.id} className="rounded bg-paper-2 px-1 font-mono text-ink-2">
                  &quot;{b.name}&quot;
                </code>
              ))}
            </div>
          </Group>
        </>
      )}

      {mode === "ai" && (
        <Group title="추가 지시 (선택)">
          <TemplateArea value={cfg.instruction} onChange={(v) => set({ instruction: v })} vars={vars} rows={3} placeholder="예: 결제 오류는 '요금·결제'로 본다" />
        </Group>
      )}
    </>
  );
}

// ───────────────────────── 고급: YAML 직접 편집 ─────────────────────────

function YamlDataEditor({ data, onApply, defaultOpen }: { data: DifyNodeData; onApply: (d: DifyNodeData) => void; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const [text, setText] = useState(() => dumpDoc(data as Rec));
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const current = dumpDoc(data as Rec);
  const shown = dirty ? text : current;
  return (
    <div className="px-4 py-3.5">
      <button type="button" onClick={() => setOpen(!open)} className="text-[12px] font-semibold text-ink-2 hover:text-ink">
        {open ? "▾" : "▸"} 고급: data 블록 YAML로 편집
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          <textarea
            value={shown}
            onChange={(e) => {
              setText(e.target.value);
              setDirty(true);
              setError(null);
            }}
            rows={14}
            spellCheck={false}
            className="block w-full resize-y rounded-lg border border-line bg-[#18181b] px-3 py-2 font-mono text-[12px] leading-relaxed text-[#e4e4e7] outline-none focus:border-accent"
          />
          {error && <div className="rounded bg-err/6 px-2 py-1 text-[12px] text-err">{error}</div>}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={!dirty}
              onClick={() => {
                try {
                  const next = loadDoc(text) as DifyNodeData;
                  if (next.type !== data.type) throw new Error("type 은 바꿀 수 없습니다.");
                  onApply(next);
                  setDirty(false);
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
              className="rounded-md bg-accent px-2.5 py-1 text-[12px] font-semibold text-white disabled:opacity-40"
            >
              적용
            </button>
            {dirty && (
              <button type="button" onClick={() => setDirty(false)} className="text-[12px] text-ink-3 hover:text-ink">
                되돌리기
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ───────────────────────── 진입점 ─────────────────────────

const FORMS: Record<string, (p: FormProps) => ReactNode> = {
  start: StartForm,
  llm: LlmForm,
  answer: AnswerForm,
  end: EndForm,
  "question-classifier": ClassifierForm,
  "parameter-extractor": ExtractorForm,
  "knowledge-retrieval": KnowledgeForm,
  "if-else": IfElseForm,
  switch: SwitchForm,
  code: CodeForm,
  "template-transform": TemplateForm,
  "memory-store": MemoryStoreForm,
  [MEMORY_TOOL]: MemoryToolForm,
};

export function NodeConfig({
  node,
  doc,
  keys,
  datasets,
  onChange,
  onDelete,
}: {
  node: DifyNode;
  doc: DslDoc;
  keys: Partial<Record<ProviderId, boolean>>;
  datasets: { id: string; name: string; chunkCount: number }[];
  onChange: (data: DifyNodeData) => void;
  onDelete: () => void;
}) {
  const data = node.data as Rec;
  const vars = useMemo(() => availableVars(doc, node.id), [doc, node.id]);
  const set = (patch: Rec) => onChange({ ...(data as DifyNodeData), ...patch });
  const Form = FORMS[node.data.type];
  const { needs, dependents } = useMemo(() => {
    const { nodes } = graphOf(doc);
    return {
      needs: structuredNeedsOf(node, new Map(nodes.map((n) => [n.id, n]))),
      dependents: node.data.type === "llm" ? structuredDependents(node.id, nodes) : [],
    };
  }, [doc, node]);
  const unmet = needs.filter((n) => !n.ok);
  // 이 LLM 의 구조화 출력을 쓰는 노드가 있는데 꺼져 있거나 필드가 빠졌을 때
  const schemaProps = rec(rec(rec(data.structured_output).schema).properties);
  const starving = dependents
    .map((d) => ({ ...d, missing: data.structured_output_enabled ? d.fields.filter((f) => !(f in schemaProps)) : d.fields }))
    .filter((d) => !data.structured_output_enabled || d.missing.length);
  const memoryTool = useMemo(() => {
    if (node.data.type !== "llm") return null;
    const { nodes, edges } = graphOf(doc);
    const moduleId = memoryOf(edges, node.id);
    const tool = moduleId ? nodes.find((n) => n.parentId === moduleId && n.data.type === MEMORY_TOOL) : null;
    const commands = tool ? readMemoryCommands(tool.data as Rec) : [];
    return tool && commands.length ? { module: String(nodes.find((n) => n.id === moduleId)?.data.title ?? "메모리 모듈"), commands } : null;
  }, [doc, node.id, node.data.type]);

  return (
    <div>
      {needs.length > 0 && (
        <div className={`border-b px-4 py-2.5 text-[12px] leading-snug ${unmet.length ? "border-err/30 bg-err/6 text-err" : "border-line bg-paper-2 text-ink-2"}`}>
          <div className="font-semibold">입력으로 구조화 출력이 필요합니다</div>
          <ul className="mt-1 space-y-0.5">
            {needs.map((n) => (
              <li key={`${n.sourceId}.${n.field ?? ""}`}>
                <code className="font-mono text-[12px]">{needLabel(n)}</code> — {n.ok ? "충족" : n.reason}
              </li>
            ))}
          </ul>
          {unmet.length > 0 && <div className="mt-1 text-[12px]">이대로 실행하면 그 자리가 빈 값으로 들어갑니다. 앞 노드에서 구조화 출력을 켜거나, 이 노드가 쓰는 변수를 바꾸세요.</div>}
        </div>
      )}
      {starving.length > 0 && (
        <div className="border-b border-err/30 bg-err/6 px-4 py-2.5 text-[12px] leading-snug text-err">
          <div className="font-semibold">다음 노드가 이 노드의 구조화 출력을 씁니다</div>
          <ul className="mt-1 space-y-0.5">
            {starving.map((d) => (
              <li key={d.id}>
                {d.title}
                {d.missing.length ? ` — ${d.missing.join(", ")}` : ""}
              </li>
            ))}
          </ul>
          <div className="mt-1 text-[12px]">{data.structured_output_enabled ? "스키마에 위 속성이 없습니다." : "구조화 출력이 꺼져 있어 위 노드가 빈 값을 받습니다."}</div>
        </div>
      )}
      <Group title="기본">
        <div className="grid grid-cols-[1fr] gap-2">
          <Field label="제목">
            <input value={String(data.title ?? "")} onChange={(e) => set({ title: e.target.value })} className={smallInput} />
          </Field>
          <Field label="설명">
            <input value={String(data.desc ?? "")} onChange={(e) => set({ desc: e.target.value })} className={smallInput} placeholder="캔버스 카드에 표시" />
          </Field>
        </div>
      </Group>
      {Form ? (
        <Form data={data} set={set} vars={vars} keys={keys} datasets={datasets} memoryTool={memoryTool} />
      ) : (
        <div className="border-b border-line px-4 py-3 text-[12px] leading-snug text-ink-3">
          이 노드 타입은 전용 폼이 없습니다. 아래 YAML 편집기에서 Dify DSL 형식 그대로 설정하세요.
        </div>
      )}
      <YamlDataEditor key={node.id} data={node.data} onApply={onChange} defaultOpen={!Form} />
      {node.data.type !== "start" && (
        <div className="px-4 pb-5">
          <button
            type="button"
            onClick={onDelete}
            className="inline-flex items-center gap-1.5 rounded-lg border border-err/30 px-2.5 py-1 text-[12px] font-medium text-err hover:bg-err/6"
          >
            <Trash2 size={13} />
            노드 삭제
          </button>
        </div>
      )}
    </div>
  );
}
