import { randomUUID } from "node:crypto";
import { graphOf } from "../dsl/edit";
import { normalizeDoc } from "../dsl/parse";
import type { DslDoc } from "../dsl/types";
import { files } from "./backend";

/** 프로젝트 = Dify DSL 문서 1개. projects/<id>.json 에 저장한다(파일 또는 사용자별 DB — backend.ts). */

export interface Project {
  id: string;
  createdAt: number;
  updatedAt: number;
  dsl: DslDoc;
}

export interface ProjectSummary {
  id: string;
  name: string;
  description: string;
  icon: string;
  mode: string;
  nodeCount: number;
  nodeTypes: string[];
  createdAt: number;
  updatedAt: number;
}

const DIR = "projects";
const fileOf = (id: string) => {
  if (!/^[\w-]+$/.test(id)) throw new Error("잘못된 프로젝트 ID");
  return `${DIR}/${id}.json`;
};

export function summarize(p: Project): ProjectSummary {
  const app = (p.dsl.app ?? {}) as Record<string, unknown>;
  const { nodes } = graphOf(p.dsl);
  return {
    id: p.id,
    name: String(app.name ?? "이름 없는 프로젝트"),
    description: String(app.description ?? ""),
    icon: String(app.icon ?? "🤖"),
    mode: String(app.mode ?? "advanced-chat"),
    // 블록은 묶음 영역이라 노드 수·구성에서 뺀다
    nodeCount: nodes.filter((n) => n.data?.type !== "block").length,
    nodeTypes: nodes.map((n) => n.data?.type).filter((t) => t && t !== "block"),
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const store = files();
  const names = (await store.list(DIR)).filter((f) => f.endsWith(".json"));
  const loaded = await Promise.all(names.map((f) => store.read(`${DIR}/${f}`)));
  const out: ProjectSummary[] = [];
  for (const p of loaded) {
    try {
      // 깨진 파일은 목록에서 제외
      if (p) out.push(summarize(p as Project));
    } catch {
      /* skip */
    }
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getProject(id: string): Promise<Project | null> {
  return ((await files().read(fileOf(id))) as Project | null) ?? null;
}

const write = (p: Project) => files().write(fileOf(p.id), p);

export async function createProject(dsl: DslDoc): Promise<Project> {
  const now = Date.now();
  const p: Project = { id: randomUUID().slice(0, 8), createdAt: now, updatedAt: now, dsl: normalizeDoc(dsl) };
  await write(p);
  return p;
}

export async function saveProject(id: string, dsl: DslDoc): Promise<Project | null> {
  const cur = await getProject(id);
  if (!cur) return null;
  const next = { ...cur, dsl, updatedAt: Date.now() };
  await write(next);
  return next;
}

export async function deleteProject(id: string) {
  await files().remove(fileOf(id));
}
