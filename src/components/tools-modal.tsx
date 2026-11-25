"use client";

import { CircleCheck, CircleX, LoaderCircle, LogIn, LogOut, Pencil, Plug, Plus, Puzzle, ScrollText, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { ConnectorsTab } from "./connectors-tab";
import { Button, Field, Help, Modal, inputCls } from "./ui";

export interface SkillItem {
  id: string;
  name: string;
  description: string;
  plugin?: string;
  files: string[];
}
export interface PluginItem {
  name: string;
  description: string;
  version?: string;
  skills: string[];
  mcpServers: string[];
}
export interface McpItem {
  name: string;
  type: "http" | "sse" | "stdio";
  target: string;
  headerNames: string[];
  source: "settings" | "plugin";
  editable: boolean;
  auth: "oauth" | "header" | "none";
  loggedIn?: boolean;
}
export interface ToolCatalog {
  skills: SkillItem[];
  plugins: PluginItem[];
  mcp: McpItem[];
}

export function useToolCatalog() {
  const [catalog, setCatalog] = useState<ToolCatalog | null>(null);
  const reload = useCallback(() => {
    fetch("/api/tools")
      .then((r) => r.json())
      .then(setCatalog)
      .catch(() => setCatalog({ skills: [], plugins: [], mcp: [] }));
  }, []);
  useEffect(reload, [reload]);
  return { catalog, reload };
}

const json = (method: string, body: unknown) => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const code = "rounded bg-paper-2 px-1 py-0.5 font-mono text-[11px]";

export type ToolsTab = "skills" | "mcp" | "plugins" | "connectors";
type Tab = ToolsTab;

/** 탭 안의 제목 줄. 동작 원리는 ⓘ 에 둔다 */
function TabHead({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1 text-[12px] font-semibold text-ink-2">
      {title}
      <Help label={`${title} 설명`}>{children}</Help>
    </div>
  );
}
const emptyCls = "rounded-lg border border-dashed border-line px-3 py-4 text-center text-[13px] leading-relaxed text-ink-3";

/** 스킬 · MCP 서버 · 플러그인 관리. 여기서 등록한 것을 LLM 노드의 '도구'에서 골라 쓴다 */
export function ToolsModal({ catalog, initialTab = "skills", onClose, onChanged }: { catalog: ToolCatalog; initialTab?: Tab; onClose: () => void; onChanged: () => void }) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const tabs: [Tab, string, number | null][] = [
    ["skills", "스킬", catalog.skills.length],
    ["mcp", "MCP 서버", catalog.mcp.length],
    ["connectors", "커넥터", null],
    ["plugins", "플러그인", catalog.plugins.length],
  ];
  return (
    <Modal title="스킬 · MCP 서버 · 커넥터 · 플러그인" onClose={onClose} width="max-w-3xl">
      <div className="flex gap-1 border-b border-line px-5 pt-3">
        {tabs.map(([id, label, n]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`-mb-px rounded-t-lg border-b-2 px-3 py-2 text-[13px] font-medium ${tab === id ? "border-accent text-ink" : "border-transparent text-ink-3 hover:text-ink"}`}
          >
            {label} {n !== null && <span className="text-ink-4">{n}</span>}
          </button>
        ))}
      </div>
      <div className="px-5 py-4">
        {tab === "skills" && <SkillsTab skills={catalog.skills} onChanged={onChanged} />}
        {tab === "mcp" && <McpTab servers={catalog.mcp} onChanged={onChanged} />}
        {tab === "connectors" && <ConnectorsTab onChanged={onChanged} />}
        {tab === "plugins" && <PluginsTab plugins={catalog.plugins} />}
      </div>
    </Modal>
  );
}

// ───────────────────────── 스킬 ─────────────────────────

function SkillsTab({ skills, onChanged }: { skills: SkillItem[]; onChanged: () => void }) {
  const [editing, setEditing] = useState<{ name: string; description: string; body: string; isNew: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const open = async (s: SkillItem) => {
    const res = await fetch(`/api/skills?id=${encodeURIComponent(s.id)}`).then((r) => r.json());
    setError(null);
    setEditing({ name: s.name, description: s.description, body: String(res.body ?? ""), isNew: false });
  };
  const save = async () => {
    if (!editing) return;
    setBusy(true);
    const res = await fetch("/api/skills", json("PUT", editing)).then((r) => r.json());
    setBusy(false);
    if (res.error) return setError(res.error);
    setEditing(null);
    onChanged();
  };
  const remove = async (name: string) => {
    if (!window.confirm(`‘${name}’ 스킬을 지울까요? 폴더(data/skills/${name})가 통째로 삭제됩니다.`)) return;
    await fetch(`/api/skills?name=${encodeURIComponent(name)}`, { method: "DELETE" });
    onChanged();
  };

  if (editing) {
    return (
      <div className="space-y-3">
        <Field label="이름" hint="영문, 숫자, -, _만 쓸 수 있습니다." help="스킬 폴더(data/skills/이름)의 이름이 됩니다. 만든 뒤에는 바꿀 수 없습니다.">
          <input value={editing.name} disabled={!editing.isNew} onChange={(e) => setEditing({ ...editing, name: e.target.value.replace(/[^a-zA-Z0-9_-]/g, "") })} className={`${inputCls} font-mono disabled:bg-paper-2`} placeholder="report-format" />
        </Field>
        <Field label="설명" hint="무엇을 하는지와 언제 쓰는지를 함께 적으세요." help="모델은 이 설명만 보고 스킬을 부를지 정합니다. 이름과 설명은 항상 프롬프트에 들어갑니다.">
          <textarea value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} rows={2} className={inputCls} placeholder="사내 주간 보고서를 쓸 때 사용. 결론 먼저, 근거는 세 줄 이내로 정리한다." />
        </Field>
        <Field label="지침 (SKILL.md 본문)" help="모델이 스킬을 부를 때만 읽습니다. 길어도 평소 프롬프트를 차지하지 않습니다.">
          <textarea value={editing.body} onChange={(e) => setEditing({ ...editing, body: e.target.value })} rows={12} spellCheck={false} className={`${inputCls} font-mono !text-[12px] leading-relaxed`} />
        </Field>
        {error && <p className="text-[12px] text-err">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button kind="ghost" onClick={() => setEditing(null)}>
            취소
          </Button>
          <Button kind="primary" onClick={save} disabled={busy || !editing.name || !editing.description.trim()}>
            저장
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <TabHead title="스킬">
        이름과 설명만 항상 프롬프트에 들어가고, 본문과 같은 폴더의 참고 파일은 모델이 <span className={code}>skill</span> 도구로 부를 때 읽습니다. Agent Skills 형식(<span className={code}>data/skills/이름/SKILL.md</span>)으로 저장됩니다. 스크립트 실행은 지원하지 않습니다.
      </TabHead>
      {skills.length === 0 && <p className={emptyCls}>스킬은 모델이 필요할 때 꺼내 읽는 지침 묶음입니다. 아래 ‘새 스킬’로 만드세요.</p>}
      <ul className={skills.length ? "divide-y divide-line rounded-lg border border-line" : "hidden"}>
        {skills.map((s) => (
          <li key={s.id} className="flex items-start gap-3 px-3 py-2.5">
            <ScrollText size={15} className="mt-0.5 shrink-0 text-ink-3" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[13px] font-semibold text-ink">{s.id}</span>
                {s.plugin && <span className="rounded-full bg-paper-2 px-1.5 py-0.5 text-[11px] text-ink-3">플러그인</span>}
                {s.files.length > 0 && <span className="text-[11px] text-ink-4">참고 파일 {s.files.length}개</span>}
              </div>
              <p className="mt-0.5 text-[12px] leading-snug text-ink-2">{s.description}</p>
            </div>
            {!s.plugin && (
              <div className="flex shrink-0 gap-0.5">
                <button type="button" onClick={() => open(s)} className="rounded p-1 text-ink-3 hover:bg-paper-2 hover:text-ink" aria-label={`${s.name} 편집`}>
                  <Pencil size={14} />
                </button>
                <button type="button" onClick={() => remove(s.name)} className="rounded p-1 text-ink-4 hover:bg-err/8 hover:text-err" aria-label={`${s.name} 삭제`}>
                  <Trash2 size={14} />
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
      <Button onClick={() => (setError(null), setEditing({ name: "", description: "", body: "# 지침\n\n1. \n", isNew: true }))}>
        <Plus size={14} />새 스킬
      </Button>
    </div>
  );
}

// ───────────────────────── MCP 서버 ─────────────────────────

type TestResult = { ok: true; server?: string; tools: { name: string; description: string }[] } | { ok: false; error: string };

function McpTab({ servers, onChanged }: { servers: McpItem[]; onChanged: () => void }) {
  const [form, setForm] = useState<{ name: string; url: string; type: "http" | "sse"; auth: "none" | "header" | "oauth"; headerName: string; headerValue: string } | null>(null);
  const [loginError, setLoginError] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [tests, setTests] = useState<Record<string, TestResult | "loading">>({});

  const test = async (name: string) => {
    setTests((t) => ({ ...t, [name]: "loading" }));
    const res = (await fetch("/api/mcp", json("POST", { name }))
      .then((r) => r.json())
      .catch((e) => ({ ok: false, error: String(e) }))) as TestResult;
    setTests((t) => ({ ...t, [name]: res }));
  };
  const save = async () => {
    if (!form) return;
    const headers = form.auth === "header" && form.headerName.trim() && form.headerValue.trim() ? { [form.headerName.trim()]: form.headerValue.trim() } : undefined;
    const res = await fetch("/api/mcp", json("PUT", { name: form.name, url: form.url, type: form.type, headers, ...(form.auth === "oauth" ? { auth: "oauth" } : {}) })).then((r) => r.json());
    if (res.error) return setError(res.error);
    const { name, auth } = form;
    setForm(null);
    onChanged();
    if (auth === "oauth") login(name);
    else test(name);
  };
  /** OAuth 로그인: 서버의 로그인 주소를 새 창으로 연다. 로그인은 그 창에서 사용자가 직접 한다 */
  const login = async (name: string) => {
    setLoginError((e) => ({ ...e, [name]: "" }));
    const res = (await fetch("/api/mcp", json("POST", { name, action: "login" }))
      .then((r) => r.json())
      .catch((e) => ({ error: String(e) }))) as { url?: string; authorized?: boolean; error?: string };
    if (res.error) return setLoginError((e) => ({ ...e, [name]: res.error! }));
    if (res.url) window.open(res.url, "_blank", "noopener,width=560,height=720");
    else onChanged();
  };
  const logout = async (name: string) => {
    await fetch("/api/mcp", json("POST", { name, action: "logout" }));
    setTests((t) => ({ ...t, [name]: undefined as never }));
    onChanged();
  };
  // 로그인 창에서 돌아오면 상태를 다시 읽는다
  useEffect(() => {
    const onFocus = () => onChanged();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [onChanged]);
  const remove = async (name: string) => {
    if (!window.confirm(`MCP 서버 ‘${name}’ 등록을 지울까요?`)) return;
    await fetch(`/api/mcp?name=${encodeURIComponent(name)}`, { method: "DELETE" });
    onChanged();
  };

  return (
    <div className="space-y-3">
      <TabHead title="MCP 서버">
        원격 서버는 Streamable HTTP와 예전 방식인 SSE를, 인증은 헤더(API 키·토큰)와 OAuth 로그인을 지원합니다. 이 PC에서 명령을 실행하는 로컬 서버(stdio)는 보안을 위해 화면에서 등록할 수 없습니다.
      </TabHead>
      {servers.length === 0 && !form && <p className={emptyCls}>외부 MCP 서버를 등록하면 그 도구를 LLM 노드에서 부를 수 있습니다. 아래 ‘원격 MCP 서버 추가’로 등록하세요.</p>}
      <ul className={servers.length ? "space-y-2" : "hidden"}>
        {servers.map((s) => {
          const t = tests[s.name];
          return (
            <li key={s.name} className="rounded-lg border border-line px-3 py-2.5">
              <div className="flex items-center gap-2">
                <Plug size={14} className="shrink-0 text-ink-3" />
                <span className="font-mono text-[13px] font-semibold text-ink">{s.name}</span>
                <span className="rounded-full bg-paper-2 px-1.5 py-0.5 text-[11px] text-ink-3">{s.type === "stdio" ? "로컬 stdio" : s.type === "sse" ? "SSE" : "HTTP"}</span>
                {s.source === "plugin" && <span className="rounded-full bg-paper-2 px-1.5 py-0.5 text-[11px] text-ink-3">플러그인</span>}
                {s.auth === "oauth" && (
                  <span className={`rounded-full px-1.5 py-0.5 text-[11px] ${s.loggedIn ? "bg-ok/10 text-ok" : "bg-err/8 text-err"}`}>{s.loggedIn ? "OAuth 로그인됨" : "OAuth 로그인 필요"}</span>
                )}
                <span className="ml-auto flex items-center gap-1">
                  {s.auth === "oauth" &&
                    (s.loggedIn ? (
                      <Button onClick={() => logout(s.name)} className="!px-2 !py-1 !text-[12px]">
                        <LogOut size={12} />
                        로그아웃
                      </Button>
                    ) : (
                      <Button kind="primary" onClick={() => login(s.name)} className="!px-2 !py-1 !text-[12px]">
                        <LogIn size={12} />
                        로그인
                      </Button>
                    ))}
                  <Button onClick={() => test(s.name)} disabled={t === "loading"} className="!px-2 !py-1 !text-[12px]">
                    {t === "loading" ? <LoaderCircle size={12} className="animate-spin" /> : null}연결 시험
                  </Button>
                  {s.editable && (
                    <button type="button" onClick={() => remove(s.name)} className="rounded p-1 text-ink-4 hover:bg-err/8 hover:text-err" aria-label={`${s.name} 삭제`}>
                      <Trash2 size={14} />
                    </button>
                  )}
                </span>
              </div>
              <div className="mt-1 truncate font-mono text-[12px] text-ink-3" title={s.target}>
                {s.target}
                {s.headerNames.length > 0 && <span className="ml-2 text-ink-4">헤더: {s.headerNames.join(", ")}</span>}
              </div>
              {loginError[s.name] && <p className="mt-1.5 break-all text-[12px] text-err">로그인을 시작하지 못했습니다: {loginError[s.name]}</p>}
              {t && t !== "loading" && (
                <div className={`mt-2 rounded-md px-2.5 py-2 text-[12px] ${t.ok ? "bg-ok/8 text-ink-2" : "bg-err/6 text-err"}`}>
                  {t.ok ? (
                    <>
                      <div className="flex items-center gap-1.5 font-medium text-ok">
                        <CircleCheck size={13} />
                        연결됨{t.server ? ` · ${t.server}` : ""} · 도구 {t.tools.length}개
                      </div>
                      <ul className="mt-1.5 space-y-0.5">
                        {t.tools.map((tool) => (
                          <li key={tool.name} className="truncate" title={tool.description}>
                            <span className="font-mono text-[12px] text-ink">{tool.name}</span>
                            <span className="ml-2 text-ink-3">{tool.description}</span>
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : (
                    <div className="flex items-start gap-1.5">
                      <CircleX size={13} className="mt-0.5 shrink-0" />
                      <span className="break-all">{t.error}</span>
                    </div>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {form ? (
        <div className="space-y-3 rounded-lg border border-line bg-paper px-3 py-3">
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <Field label="이름" help={<>도구 이름 앞에 붙습니다. 예: <span className={code}>mcp__이름__도구</span></>}>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value.replace(/[^a-zA-Z0-9_-]/g, "") })} className={`${inputCls} font-mono`} placeholder="github" />
            </Field>
            <Field label="방식">
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as "http" | "sse" })} className={`${inputCls} !w-40`}>
                <option value="http">Streamable HTTP</option>
                <option value="sse">SSE (예전 방식)</option>
              </select>
            </Field>
          </div>
          <Field label="주소">
            <input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} className={`${inputCls} font-mono`} placeholder="https://example.com/mcp" />
          </Field>
          <Field
            label="인증"
            hint={form.auth === "oauth" ? "등록하면 서버의 로그인 창이 새 창으로 열립니다." : undefined}
            help={form.auth === "oauth" ? <>로그인과 권한 동의는 새 창에서 직접 합니다. 받은 토큰은 <span className={code}>data/mcp-auth.json</span>에 저장됩니다.</> : undefined}
          >
            <select value={form.auth} onChange={(e) => setForm({ ...form, auth: e.target.value as "none" | "header" | "oauth" })} className={`${inputCls} !w-56`}>
              <option value="none">없음</option>
              <option value="header">헤더 (API 키 · 토큰)</option>
              <option value="oauth">OAuth 로그인</option>
            </select>
          </Field>
          {form.auth === "header" && (
          <div className="grid grid-cols-[10rem_1fr] gap-2">
            <Field label="헤더 이름">
              <input value={form.headerName} onChange={(e) => setForm({ ...form, headerName: e.target.value })} className={`${inputCls} font-mono`} placeholder="Authorization" />
            </Field>
            <Field label="값" hint="저장한 뒤에는 값이 화면에 다시 보이지 않습니다." help={<>토큰을 파일에 남기지 않으려면 <span className={code}>{"Bearer ${MY_TOKEN}"}</span>처럼 환경변수 이름으로 적으세요.</>}>
              <input type="password" autoComplete="off" value={form.headerValue} onChange={(e) => setForm({ ...form, headerValue: e.target.value })} className={`${inputCls} font-mono`} placeholder="Bearer …" />
            </Field>
          </div>
          )}
          {error && <p className="text-[12px] text-err">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button kind="ghost" onClick={() => setForm(null)}>
              취소
            </Button>
            <Button kind="primary" onClick={save} disabled={!form.name || !form.url}>
              {form.auth === "oauth" ? "등록하고 로그인" : "등록하고 연결 시험"}
            </Button>
          </div>
        </div>
      ) : (
        <Button onClick={() => (setError(null), setForm({ name: "", url: "", type: "http", auth: "none", headerName: "Authorization", headerValue: "" }))}>
          <Plus size={14} />원격 MCP 서버 추가
        </Button>
      )}
      <details className="text-[12px] text-ink-3">
        <summary className="cursor-pointer hover:text-ink">
          로컬(stdio) 서버는 <span className={code}>data/mcp.json</span> 파일로만 등록할 수 있습니다. 예시 보기
        </summary>
        <pre className="mt-2 overflow-x-auto rounded-lg bg-paper-2 p-3 font-mono text-[12px] leading-relaxed text-ink-2">{`// data/mcp.json
{
  "mcpServers": {
    "files": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "C:/Users/me/docs"]
    }
  }
}`}</pre>
      </details>
    </div>
  );
}

// ───────────────────────── 플러그인 ─────────────────────────

function PluginsTab({ plugins }: { plugins: PluginItem[] }) {
  return (
    <div className="space-y-3">
      <TabHead title="플러그인">
        Claude Code 플러그인과 같은 배치의 폴더를 <span className={code}>data/plugins/</span> 아래에 두면 읽습니다. 안에 든 스킬은 <span className={code}>플러그인:스킬</span>, MCP 서버는 <span className={code}>플러그인:서버</span> 이름으로 LLM 노드의 도구 목록에 나옵니다. 훅·명령·에이전트 정의는 읽지 않습니다.
      </TabHead>
      {plugins.length === 0 ? (
        <p className={emptyCls}>
          플러그인은 스킬과 MCP 서버를 한 폴더로 묶은 것입니다. 받은 플러그인 폴더를 <span className={code}>data/plugins/</span> 아래에 두면 여기에 나타납니다.
        </p>
      ) : (
        <ul className="divide-y divide-line rounded-lg border border-line">
          {plugins.map((p) => (
            <li key={p.name} className="flex items-start gap-3 px-3 py-2.5">
              <Puzzle size={15} className="mt-0.5 shrink-0 text-ink-3" />
              <div className="min-w-0">
                <div className="font-mono text-[13px] font-semibold text-ink">
                  {p.name}
                  {p.version && <span className="ml-2 font-sans text-[11px] font-normal text-ink-4">v{p.version}</span>}
                </div>
                {p.description && <p className="mt-0.5 text-[12px] text-ink-2">{p.description}</p>}
                <p className="mt-1 text-[12px] text-ink-3">
                  스킬 {p.skills.length}개{p.skills.length ? ` (${p.skills.join(", ")})` : ""} · MCP 서버 {p.mcpServers.length}개{p.mcpServers.length ? ` (${p.mcpServers.join(", ")})` : ""}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
      <details className="text-[12px] text-ink-3" open={plugins.length === 0}>
        <summary className="cursor-pointer hover:text-ink">플러그인 폴더 구조</summary>
        <pre className="mt-2 overflow-x-auto rounded-lg bg-paper-2 p-3 font-mono text-[12px] leading-relaxed text-ink-2">{`data/plugins/<플러그인>/
  .claude-plugin/plugin.json     이름 · 설명 · 버전 (선택)
  skills/<스킬>/SKILL.md          스킬
  .mcp.json                       MCP 서버 ({"mcpServers": {…}})`}</pre>
      </details>
    </div>
  );
}
