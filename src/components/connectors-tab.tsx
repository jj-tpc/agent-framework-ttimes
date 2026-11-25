"use client";

import { Check, CircleCheck, Copy, LoaderCircle } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { CONNECTABLE, GOOGLE_TOOLS, type ConnectableService, type ConnectorStatus } from "@/lib/tools/connector-catalog";
import { Button, Field, Help, inputCls } from "./ui";

interface ConnectorsInfo {
  google: ConnectorStatus;
  redirectUri: string;
}

/** 커넥터 상태. 로그인 창에서 돌아왔을 때(창에 초점이 돌아올 때) 다시 읽는다 */
export function useConnectors() {
  const [info, setInfo] = useState<ConnectorsInfo | null>(null);
  const reload = useCallback(
    () =>
      fetch("/api/connectors")
        .then((r) => r.json())
        .then((j: ConnectorsInfo) => {
          setInfo(j);
          return j;
        })
        .catch(() => null),
    [],
  );
  useEffect(() => {
    void reload();
    const onFocus = () => void reload();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [reload]);
  return { info, reload };
}

const call = (method: string, body: unknown) => fetch("/api/connectors", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(async (r) => ({ ok: r.ok, json: (await r.json()) as Record<string, unknown> }));
const code = "rounded bg-paper-2 px-1 py-0.5 font-mono text-[11px]";

/**
 * 커넥터 목록. 서비스마다 '연결'을 누르면 Google 동의 창이 바로 열리고, 그 서비스의 권한만 요청한다.
 * OAuth 앱(클라이언트 ID)은 처음 한 번만 등록하면 된다. 없을 때 '연결'을 누르면 등록 폼이 펼쳐진다.
 */
export function ConnectorList({ onChanged }: { onChanged?: () => void }) {
  const { info, reload } = useConnectors();
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [appOpen, setAppOpen] = useState(false);
  const [clientId, setClientId] = useState("");
  const [secret, setSecret] = useState("");
  const [copied, setCopied] = useState(false);
  /** 등록 폼을 거쳐 온 경우, 저장하자마자 이어서 연결할 서비스 */
  const [wanted, setWanted] = useState<ConnectableService | null>(null);
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => () => void (poll.current && clearInterval(poll.current)), []);

  if (!info) return <div className="py-4 text-center text-[13px] text-ink-3">불러오는 중…</div>;
  const g = info.google;
  const refresh = async () => {
    const j = await reload();
    onChanged?.();
    return j;
  };

  const connect = async (service: ConnectableService) => {
    setNote(null);
    setBusy(service);
    const r = await call("POST", { action: "login", service });
    if (!r.ok) {
      setBusy(null);
      if (r.json.needsApp) {
        setWanted(service);
        setAppOpen(true);
      } else setNote({ ok: false, text: String(r.json.error ?? "연결을 시작하지 못했습니다.") });
      return;
    }
    // 동의 창을 띄우고, 닫히거나 연결될 때까지 상태를 살핀다
    const popup = window.open(String(r.json.url), "google-oauth", "width=520,height=700");
    if (!popup) {
      setBusy(null);
      setNote({ ok: false, text: "팝업이 막혔습니다. 브라우저에서 이 사이트의 팝업을 허용한 뒤 다시 누르세요." });
      return;
    }
    if (poll.current) clearInterval(poll.current);
    let ticks = 0;
    poll.current = setInterval(async () => {
      const j = await reload();
      const done = !!j?.google.services[service];
      if (done || popup.closed || ++ticks > 120) {
        if (poll.current) clearInterval(poll.current);
        poll.current = null;
        setBusy(null);
        onChanged?.();
        if (done) setNote({ ok: true, text: `${CONNECTABLE.find((c) => c.id === service)?.label}를 연결했습니다.` });
        else if (popup.closed) setNote({ ok: false, text: "연결을 마치지 않고 창이 닫혔습니다." });
      }
    }, 1500);
  };

  const disconnect = async (service: ConnectableService) => {
    setNote(null);
    setBusy(service);
    const r = await call("POST", { action: "logout", service });
    setBusy(null);
    if (!r.ok) setNote({ ok: false, text: String(r.json.error ?? "끊지 못했습니다.") });
    await refresh();
  };

  const saveApp = async () => {
    setBusy("app");
    const r = await call("PUT", { clientId, clientSecret: secret });
    setBusy(null);
    if (!r.ok) return setNote({ ok: false, text: String(r.json.error ?? "저장하지 못했습니다.") });
    setClientId("");
    setSecret("");
    setAppOpen(false);
    await refresh();
    const next = wanted;
    setWanted(null);
    if (next) void connect(next);
  };

  return (
    <div className="space-y-2">
      <ul className="divide-y divide-line rounded-xl border border-line">
        {CONNECTABLE.map((c) => {
          const on = !!g.services[c.id];
          return (
            <li key={c.id} className="flex items-center gap-3 px-3.5 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
                  {c.label}
                  {on && <CircleCheck size={13} className="text-ok" aria-label="연결됨" />}
                </div>
                <div className="truncate text-[12px] text-ink-3">{on && g.email ? g.email : c.desc}</div>
              </div>
              {on ? (
                <Button disabled={busy !== null} onClick={() => disconnect(c.id)}>
                  연결 끊기
                </Button>
              ) : (
                <Button kind="primary" disabled={busy !== null} onClick={() => connect(c.id)}>
                  {busy === c.id && <LoaderCircle size={14} className="animate-spin" />}
                  연결
                </Button>
              )}
            </li>
          );
        })}
      </ul>

      {note && <p className={`px-1 text-[12px] leading-snug ${note.ok ? "text-ok" : "text-err"}`}>{note.text}</p>}

      {appOpen ? (
        <div className="space-y-3 rounded-xl border border-line bg-paper px-3.5 py-3">
          <div className="flex items-center gap-1 text-[13px] font-semibold text-ink">
            Google OAuth 앱 등록 (처음 한 번)
            <Help label="등록 방법">
              <span className="block">1. Google Cloud 콘솔에서 프로젝트를 만들고 Gmail · Calendar · Drive · Sheets · Docs API를 사용 설정합니다.</span>
              <span className="mt-1 block">2. OAuth 동의 화면을 만들고 테스트 사용자에 내 계정을 추가합니다.</span>
              <span className="mt-1 block">3. ‘OAuth 클라이언트 ID’(웹 애플리케이션)를 만들고, 승인된 리디렉션 URI에 아래 주소를 넣습니다.</span>
              <span className="mt-1 block">
                비밀번호와 토큰은 <code className={code}>data/connectors.json</code>에만 저장됩니다. 환경 변수 <code className={code}>GOOGLE_OAUTH_CLIENT_ID</code>, <code className={code}>GOOGLE_OAUTH_CLIENT_SECRET</code>로 줄 수도 있습니다.
              </span>
            </Help>
          </div>
          <div>
            <div className="mb-1 text-[12px] font-semibold text-ink-2">리디렉션 URI</div>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-md border border-line bg-surface px-2 py-1 font-mono text-[11px] text-ink">{info.redirectUri}</code>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard?.writeText(info.redirectUri);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
                className="inline-flex shrink-0 items-center gap-1 rounded-md border border-line bg-surface px-2 py-1 text-[12px] font-medium text-ink-2 hover:bg-paper-2"
              >
                {copied ? <Check size={12} /> : <Copy size={12} />}
                {copied ? "복사됨" : "복사"}
              </button>
            </div>
          </div>
          <Field label="클라이언트 ID">
            <input value={clientId} onChange={(e) => setClientId(e.target.value)} className={`${inputCls} font-mono !text-[12px]`} placeholder="….apps.googleusercontent.com" autoComplete="off" spellCheck={false} />
          </Field>
          <Field label="클라이언트 보안 비밀번호" hint="저장한 뒤에는 화면에 다시 보이지 않습니다.">
            <input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} className={`${inputCls} font-mono !text-[12px]`} autoComplete="off" spellCheck={false} />
          </Field>
          <div className="flex items-center gap-2">
            <Button kind="primary" disabled={!clientId.trim() || !secret.trim() || busy !== null} onClick={saveApp}>
              {wanted ? "저장하고 연결" : "저장"}
            </Button>
            <Button
              onClick={() => {
                setWanted(null);
                setAppOpen(false);
              }}
            >
              취소
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-[12px] text-ink-3">
          <button type="button" onClick={() => setAppOpen(true)} className="font-medium hover:text-ink hover:underline">
            {g.configured ? `OAuth 앱 바꾸기 (${g.clientIdHint})` : "OAuth 앱 등록"}
          </button>
          {!Object.values(g.services).every(Boolean) && (
            <span className="inline-flex items-center gap-1">
              <label className="flex cursor-pointer items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={g.demo}
                  disabled={busy !== null}
                  onChange={async (e) => {
                    await call("POST", { action: "demo", on: e.target.checked });
                    await refresh();
                  }}
                  className="accent-[var(--color-accent)]"
                />
                연결 안 된 서비스는 예시 데이터로 시연
              </label>
              <Help align="right">연결하기 전에 흐름을 보여 줄 때 씁니다. 도구가 Google을 부르지 않고 지어낸 메일·일정·시트를 돌려주고, 쓰기 도구는 아무것도 바꾸지 않습니다.</Help>
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/** 도구 관리 모달의 커넥터 탭 */
export function ConnectorsTab({ onChanged }: { onChanged?: () => void }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1 text-[12px] font-semibold text-ink-2">
        커넥터
        <Help label="커넥터 설명">
          외부 서비스에 내 계정으로 로그인해 두면, LLM 노드가 그 서비스의 기능을 도구로 부릅니다. 한 번의 실행에서 여러 도구를 이어 불러(일정 조회 → 시트 기록 → 문서 작성) 다단계 작업을 합니다.
        </Help>
      </div>
      <ConnectorList onChanged={onChanged} />
      <details className="rounded-xl border border-line px-3.5 py-2.5 text-[12px] text-ink-2">
        <summary className="cursor-pointer font-medium">도구 {GOOGLE_TOOLS.length}개</summary>
        <ul className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
          {GOOGLE_TOOLS.map((t) => (
            <li key={t.name} className="flex items-baseline gap-1.5">
              <span className="text-ink">{t.label}</span>
              <code className="font-mono text-[11px] text-ink-3">{t.name}</code>
              {t.outward ? <span className="text-[11px] text-err">발송</span> : t.writes ? <span className="text-[11px] text-warn">쓰기</span> : null}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
