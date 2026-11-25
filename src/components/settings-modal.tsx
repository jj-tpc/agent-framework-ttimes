"use client";

import { CircleCheck, CircleX, KeyRound, LoaderCircle, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { PROVIDERS, PROVIDER_IDS, type ProviderId } from "@/lib/llm/catalog";
import { ConnectorList } from "./connectors-tab";
import { Button, Modal, inputCls, Help } from "./ui";

export interface ProviderKeyStatus {
  hasKey: boolean;
  source: "settings" | "env" | null;
  envName?: string;
  preview: string | null;
}
export interface LlmSettings {
  mock: boolean;
  providers: Record<ProviderId, ProviderKeyStatus>;
}

export function useLlmSettings() {
  const [settings, setSettings] = useState<LlmSettings | null>(null);
  const reload = useCallback(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then(setSettings)
      .catch(() => {});
  }, []);
  useEffect(reload, [reload]);
  return { settings, setSettings, reload };
}

export function ProviderDot({ provider, on, size = 7 }: { provider: ProviderId; on: boolean; size?: number }) {
  return (
    <span
      role="img"
      className="inline-block shrink-0 rounded-full"
      style={{ width: size, height: size, background: on ? PROVIDERS[provider].color : "var(--color-line-2)" }}
      title={`${PROVIDERS[provider].label}: ${on ? "키 있음" : "키 없음"}`}
      aria-label={`${PROVIDERS[provider].label}: ${on ? "키 있음" : "키 없음"}`}
    />
  );
}

export function LlmStatusPill({ settings, onClick }: { settings: LlmSettings | null; onClick: () => void }) {
  if (!settings) return null;
  const count = PROVIDER_IDS.filter((p) => settings.providers[p].hasKey).length;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-[12px] font-medium hover:bg-paper-2 ${
        count === 0 && !settings.mock ? "border-err/30 bg-err/6 text-err" : "border-line bg-surface text-ink-2"
      }`}
    >
      <span className="hidden items-center gap-1 sm:flex">
        {PROVIDER_IDS.map((p) => (
          <ProviderDot key={p} provider={p} on={settings.providers[p].hasKey} />
        ))}
      </span>
      API 키 · {settings.mock ? "Mock" : count === 0 ? "없음" : `${count}/${PROVIDER_IDS.length}`}
    </button>
  );
}

function ProviderKeyRow({
  provider,
  status,
  onSaved,
}: {
  provider: ProviderId;
  status: ProviderKeyStatus;
  onSaved: (s: LlmSettings) => void;
}) {
  const meta = PROVIDERS[provider];
  const [value, setValue] = useState("");
  const [test, setTest] = useState<{ state: "idle" | "running" | "ok" | "fail"; message?: string }>({ state: "idle" });
  const [busy, setBusy] = useState(false);

  const runTest = async () => {
    setTest({ state: "running" });
    const r = await fetch("/api/settings/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider, apiKey: value || undefined }),
    })
      .then((x) => x.json())
      .catch((e) => ({ ok: false, error: String(e) }));
    setTest(r.ok ? { state: "ok", message: `연결됨 · 사용 가능한 모델 ${r.count}개` } : { state: "fail", message: r.error });
  };

  const save = async (apiKey: string | null) => {
    setBusy(true);
    const r = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider, apiKey }),
    }).then((x) => x.json());
    setBusy(false);
    setValue("");
    setTest({ state: "idle" });
    onSaved(r);
  };

  return (
    <div className="rounded-xl border border-line p-3.5">
      <div className="flex items-center gap-2">
        <ProviderDot provider={provider} on={status.hasKey} size={9} />
        <span className="text-[13px] font-semibold text-ink">{meta.label}</span>
        <span className="ml-auto text-[12px] text-ink-3">
          {status.hasKey ? (
            <>
              <code className="font-mono">{status.preview}</code> · {status.source === "env" ? `환경변수 ${status.envName}` : "화면에서 저장"}
            </>
          ) : (
            "키 없음"
          )}
        </span>
        {status.source === "settings" && (
          <button type="button" onClick={() => save(null)} disabled={busy} className="rounded p-1 text-ink-4 hover:bg-err/8 hover:text-err" aria-label={`${meta.label} 키 삭제`} title="저장된 키 삭제">
            <Trash2 size={14} />
          </button>
        )}
      </div>
      <div className="mt-2.5 flex gap-2">
        <input
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setTest({ state: "idle" });
          }}
          placeholder={status.hasKey ? "새 키로 교체하려면 입력" : meta.keyHint}
          className={`${inputCls} font-mono`}
          aria-label={`${meta.label} API 키`}
        />
        <Button onClick={runTest} disabled={test.state === "running" || (!value && !status.hasKey)} className="shrink-0" title="모델 목록만 불러오므로 토큰을 쓰지 않습니다.">
          {test.state === "running" && <LoaderCircle size={14} className="animate-spin" />}
          테스트
        </Button>
        <Button kind="primary" onClick={() => save(value)} disabled={!value.trim() || busy} className="shrink-0">
          저장
        </Button>
      </div>
      <div className="mt-1.5 text-[11px] text-ink-3">
        {test.state === "ok" ? (
          <span className="inline-flex items-center gap-1 text-ok">
            <CircleCheck size={13} /> {test.message}
          </span>
        ) : test.state === "fail" ? (
          <span className="inline-flex items-start gap-1 text-err">
            <CircleX size={13} className="mt-px shrink-0" /> {test.message}
          </span>
        ) : (
          <>발급: {meta.console}</>
        )}
      </div>
    </div>
  );
}

export function SettingsModal({
  settings,
  onClose,
  onSaved,
}: {
  settings: LlmSettings;
  onClose: () => void;
  onSaved: (s: LlmSettings) => void;
}) {
  return (
    <Modal
      title={
        <span className="inline-flex items-center gap-2">
          <KeyRound size={16} /> API 키 · 커넥터
        </span>
      }
      width="max-w-xl"
      onClose={onClose}
      footer={<Button onClick={onClose}>닫기</Button>}
    >
      <div className="space-y-3 px-5 py-4">
        <p className="text-xs leading-relaxed text-ink-3">
          키는 이 PC의 <code className="font-mono">data/settings.json</code>에만 저장됩니다.
        </p>
        {settings.mock && (
          <div className="rounded-lg border border-[#fde68a] bg-[#fffbeb] px-3 py-2 text-xs text-[#92400e]">
            서버가 <code className="font-mono">LLM_MODE=mock</code>으로 실행 중이라 모든 LLM 호출이 가짜 응답으로 대체됩니다.
          </div>
        )}
        {PROVIDER_IDS.map((p) => (
          <ProviderKeyRow key={p} provider={p} status={settings.providers[p]} onSaved={onSaved} />
        ))}
        <div className="border-t border-line pt-4">
          <div className="mb-2 flex items-center gap-1 text-[13px] font-semibold text-ink">
            커넥터
            <Help>연결해 둔 서비스를 LLM 노드의 ‘도구 → 커넥터 · Google’에서 골라 씁니다. ‘연결’을 누르면 Google 동의 창이 열리고, 그 서비스의 권한만 요청합니다.</Help>
          </div>
          <ConnectorList />
        </div>
      </div>
    </Modal>
  );
}
