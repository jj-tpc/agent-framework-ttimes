"use client";

import { Copy, EllipsisVertical, KeyRound, LoaderCircle, Plus, Trash2, Upload, Workflow as WorkflowIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AccountButton } from "./account-button";
import { NodeIcon } from "./node-meta";
import { LlmStatusPill, SettingsModal, useLlmSettings } from "./settings-modal";
import { Button, Field, Help, Modal, inputCls, timeAgo } from "./ui";

interface ProjectSummary {
  id: string;
  name: string;
  description: string;
  icon: string;
  nodeCount: number;
  nodeTypes: string[];
  updatedAt: number;
}

interface TemplateSummary {
  id: string;
  name: string;
  description: string;
  icon: string;
  nodeTypes: string[];
}

function TypeStrip({ types, max = 9 }: { types: string[]; max?: number }) {
  const unique = [...new Set(types)].filter((t) => t !== "start");
  return (
    <div className="flex items-center gap-1">
      {unique.slice(0, max).map((t) => (
        <NodeIcon key={t} type={t} size={18} />
      ))}
      {unique.length > max && <span className="text-[11px] text-ink-4">+{unique.length - max}</span>}
    </div>
  );
}

function ProjectCard({
  p,
  onDuplicate,
  onDelete,
}: {
  p: ProjectSummary;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const [menu, setMenu] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setMenu(false);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [menu]);

  return (
    <div className="group relative flex flex-col rounded-xl border border-line bg-surface transition hover:border-line-2 hover:shadow-[0_6px_24px_-12px_rgba(24,24,27,.25)]">
      <Link href={`/projects/${p.id}`} className="flex flex-1 flex-col p-4">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-paper-2 text-xl">{p.icon}</span>
          <div className="min-w-0 flex-1 pr-6">
            <div className="truncate text-[15px] font-semibold text-ink">{p.name}</div>
            <div className="mt-0.5 text-[12px] text-ink-3">
              노드 {p.nodeCount}개 · {timeAgo(p.updatedAt)} 수정
            </div>
          </div>
        </div>
        <p className="mt-3 line-clamp-2 min-h-[2.6em] text-[13px] leading-[1.3em] text-ink-3">{p.description || "설명 없음"}</p>
        <div className="mt-3">
          <TypeStrip types={p.nodeTypes} />
        </div>
      </Link>
      <div ref={ref} className="absolute top-3 right-3">
        <button
          type="button"
          onClick={() => setMenu(!menu)}
          className="rounded-md p-1 text-ink-4 opacity-0 transition group-hover:opacity-100 hover:bg-paper-2 hover:text-ink focus:opacity-100 data-[open=true]:opacity-100"
          data-open={menu}
          aria-label="프로젝트 메뉴"
        >
          <EllipsisVertical size={16} />
        </button>
        {menu && (
          <div className="absolute right-0 z-10 mt-1 w-36 overflow-hidden rounded-lg border border-line bg-surface py-1 shadow-lg">
            <button
              type="button"
              onClick={() => {
                setMenu(false);
                onDuplicate();
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-ink-2 hover:bg-paper-2"
            >
              <Copy size={13} /> 복제
            </button>
            <button
              type="button"
              onClick={() => {
                setMenu(false);
                onDelete();
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-err hover:bg-err/6"
            >
              <Trash2 size={13} /> 삭제
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function NewProjectModal({
  templates,
  initialTemplate,
  onClose,
}: {
  templates: TemplateSummary[];
  initialTemplate?: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [source, setSource] = useState<"template" | "import">("template");
  const [template, setTemplate] = useState(initialTemplate ?? templates[0]?.id ?? "blank");
  const [yaml, setYaml] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const chosen = templates.find((t) => t.id === template);
  const create = async () => {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name || undefined,
        description: description || undefined,
        ...(source === "template" ? { template } : { yaml }),
      }),
    });
    const j = await res.json();
    if (!res.ok) {
      setBusy(false);
      setError(j.error ?? `HTTP ${res.status}`);
      return;
    }
    router.push(`/projects/${j.id}`);
  };

  return (
    <Modal
      title="새 프로젝트"
      onClose={onClose}
      footer={
        <>
          <Button kind="ghost" onClick={onClose}>
            취소
          </Button>
          <Button kind="primary" onClick={create} disabled={busy || (source === "import" && !yaml.trim())}>
            {busy && <LoaderCircle size={14} className="animate-spin" />}
            만들고 열기
          </Button>
        </>
      }
    >
      <div className="space-y-5 px-5 py-4">
        <div className="flex rounded-lg border border-line bg-paper-2 p-0.5 text-[13px]">
          {(
            [
              ["template", "템플릿에서 시작"],
              ["import", "Dify DSL 가져오기"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setSource(k)}
              className={`flex-1 rounded-md py-1.5 ${source === k ? "bg-surface font-semibold text-ink shadow-sm" : "text-ink-3"}`}
            >
              {label}
            </button>
          ))}
        </div>

        {source === "template" ? (
          <div className="grid gap-2 sm:grid-cols-2">
            {templates.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTemplate(t.id)}
                className={`rounded-xl border p-3 text-left transition ${
                  template === t.id ? "border-accent bg-accent/5 ring-2 ring-accent/15" : "border-line bg-surface hover:border-line-2"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-lg">{t.icon}</span>
                  <span className="truncate text-[13px] font-semibold text-ink">{t.name}</span>
                </div>
                <p className="mt-1.5 line-clamp-2 text-[12px] leading-snug text-ink-3">{t.description}</p>
                <div className="mt-2">
                  <TypeStrip types={t.nodeTypes} max={7} />
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            <p className="flex items-center gap-1 text-xs leading-relaxed text-ink-3">
              지원하지 않는 노드(iteration, tool 등)는 실행할 때 오류로 표시됩니다.
              <Help label="DSL 가져오기 설명" align="right">
                Dify 스튜디오의 <b>앱 → DSL 내보내기</b>로 받은 YAML을 넣으면 그대로 프로젝트가 됩니다.
              </Help>
            </p>
            <input
              ref={fileInput}
              type="file"
              accept=".yml,.yaml,text/yaml"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) {
                  setYaml(await f.text());
                  setFileName(f.name);
                }
                e.target.value = "";
              }}
            />
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-line-2 bg-paper-2/50 py-4 text-xs text-ink-2 hover:border-accent/60"
            >
              <Upload size={15} className="text-ink-3" />
              {fileName ?? ".yml 파일 선택"}
            </button>
            <textarea
              value={yaml}
              onChange={(e) => {
                setYaml(e.target.value);
                setFileName(null);
              }}
              rows={8}
              placeholder={"또는 YAML 붙여넣기\napp:\n  mode: advanced-chat\n  name: ...\nworkflow:\n  graph: ..."}
              className={`${inputCls} font-mono text-xs`}
            />
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="프로젝트 이름" help="비워 두면 템플릿이나 DSL의 이름을 씁니다.">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={source === "template" ? chosen?.name : "DSL의 app.name"}
              className={inputCls}
            />
          </Field>
          <Field label="설명 (선택)">
            <input value={description} onChange={(e) => setDescription(e.target.value)} className={inputCls} />
          </Field>
        </div>
        {error && <div className="rounded-lg bg-err/6 px-3 py-2 text-xs text-err">{error}</div>}
      </div>
    </Modal>
  );
}

export function Lobby() {
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [newModal, setNewModal] = useState<{ template?: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ProjectSummary | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { settings, setSettings } = useLlmSettings();

  const [loadError, setLoadError] = useState<string | null>(null);
  const load = () =>
    fetch("/api/projects")
      .then(async (r) => {
        if (r.status === 401) return window.location.replace("/login");
        const j = (await r.json().catch(() => ({}))) as { projects?: ProjectSummary[]; error?: string };
        if (!r.ok || !j.projects) throw new Error(j.error ?? `HTTP ${r.status}`);
        setLoadError(null);
        setProjects(j.projects);
      })
      .catch((e: Error) => setLoadError(e.message));

  useEffect(() => {
    load();
    fetch("/api/templates")
      .then((r) => r.json())
      .then((j) => setTemplates(j.templates));
  }, []);

  const duplicate = async (id: string) => {
    const r = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ duplicateOf: id }),
    }).then((x) => x.json());
    if (r.id) load();
  };

  const remove = async (id: string) => {
    await fetch(`/api/projects/${id}`, { method: "DELETE" });
    setConfirmDelete(null);
    load();
  };

  const quickStart = async (template: string) => {
    const r = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ template }),
    }).then((x) => x.json());
    if (r.id) router.push(`/projects/${r.id}`);
  };

  return (
    <div className="min-h-dvh bg-paper">
      <header className="sticky top-0 z-20 border-b border-line bg-surface/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3 sm:px-5">
          <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-ink text-paper">
            <WorkflowIcon size={16} />
          </span>
          <div className="min-w-0 leading-tight">
            <div className="truncate text-[15px] font-bold tracking-tight">Node Trace</div>
            <div className="hidden truncate text-[11px] text-ink-3 sm:block">Dify 형식 에이전트를 노드 단위로 만들고 실행 과정을 추적합니다</div>
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <LlmStatusPill settings={settings} onClick={() => setSettingsOpen(true)} />
            <AccountButton />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-5">
        {settings && !Object.values(settings.providers).some((p) => p.hasKey) && (
          <div className="mb-8 flex flex-col gap-3 rounded-xl border border-[#fde68a] bg-[#fffbeb] px-4 py-3.5 sm:flex-row sm:items-center">
            <div className="flex-1 text-[13px] leading-relaxed text-[#78350f]">API 키를 설정하면 LLM 노드가 실제 모델로 응답합니다.</div>
            <Button kind="primary" onClick={() => setSettingsOpen(true)} className="shrink-0 whitespace-nowrap">
              <KeyRound size={14} />
              API 키
            </Button>
          </div>
        )}

        <div className="mb-4 flex items-center gap-3">
          <h1 className="min-w-0 truncate text-xl font-bold tracking-tight text-ink">프로젝트</h1>
          <Button kind="primary" className="ml-auto shrink-0 whitespace-nowrap" onClick={() => setNewModal({})}>
            <Plus size={15} />새 프로젝트
          </Button>
        </div>

        {loadError && projects === null ? (
          <div className="rounded-2xl border border-line bg-surface px-6 py-10 text-center">
            <div className="text-[15px] font-semibold text-ink">프로젝트를 불러오지 못했습니다</div>
            <p className="mx-auto mt-1 max-w-md text-[13px] text-err">{loadError}</p>
            <Button className="mt-4" onClick={() => load()}>
              다시 시도
            </Button>
          </div>
        ) : projects === null ? (
          <div className="flex items-center gap-2 py-16 text-sm text-ink-3">
            <LoaderCircle size={16} className="animate-spin" /> 불러오는 중…
          </div>
        ) : projects.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-line-2 bg-surface px-6 py-10 text-center">
            <div className="text-[15px] font-semibold text-ink">아직 프로젝트가 없습니다</div>
            <p className="mx-auto mt-1 max-w-md text-[13px] text-ink-3">템플릿으로 바로 시작하거나, Dify에서 내보낸 DSL을 가져오세요.</p>
            <div className="mx-auto mt-6 grid max-w-3xl gap-3 text-left sm:grid-cols-3">
              {templates.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => quickStart(t.id)}
                  className="rounded-xl border border-line bg-paper/60 p-3.5 transition hover:border-accent/60 hover:bg-surface"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-lg">{t.icon}</span>
                    <span className="truncate text-[13px] font-semibold text-ink">{t.name}</span>
                  </div>
                  <p className="mt-1.5 line-clamp-3 text-[12px] leading-snug text-ink-3">{t.description}</p>
                </button>
              ))}
            </div>
            <Button className="mt-5" onClick={() => setNewModal({})}>
              <Upload size={14} />
              DSL 가져오기 / 직접 설정
            </Button>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((p) => (
              <ProjectCard key={p.id} p={p} onDuplicate={() => duplicate(p.id)} onDelete={() => setConfirmDelete(p)} />
            ))}
          </div>
        )}
      </main>

      {newModal && <NewProjectModal templates={templates} initialTemplate={newModal.template} onClose={() => setNewModal(null)} />}
      {confirmDelete && (
        <Modal
          title="프로젝트 삭제"
          width="max-w-sm"
          onClose={() => setConfirmDelete(null)}
          footer={
            <>
              <Button kind="ghost" onClick={() => setConfirmDelete(null)}>
                취소
              </Button>
              <Button kind="danger" onClick={() => remove(confirmDelete.id)}>
                삭제
              </Button>
            </>
          }
        >
          <p className="px-5 py-4 text-[13px] leading-relaxed text-ink-2">
            <b>{confirmDelete.name}</b> 프로젝트를 삭제합니다. 워크플로가 영구히 지워지며 되돌릴 수 없습니다. 필요하면 먼저 편집기에서 DSL을
            내보내 두세요.
          </p>
        </Modal>
      )}
      {settingsOpen && settings && <SettingsModal settings={settings} onClose={() => setSettingsOpen(false)} onSaved={setSettings} />}
    </div>
  );
}
