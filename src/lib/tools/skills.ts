import { multiUser } from "../store/backend";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { dump, load } from "js-yaml";
import type { ToolDef, ToolOutput } from "./config";

/**
 * 스킬과 플러그인.
 *
 * 스킬은 Agent Skills 형식 그대로다: 폴더 하나에 SKILL.md(머리말에 name · description, 본문에 지침)와 참고 파일.
 *   data/skills/<이름>/SKILL.md
 * 플러그인은 스킬과 MCP 서버를 한 폴더로 묶은 것이다(Claude Code 플러그인과 같은 배치).
 *   data/plugins/<플러그인>/.claude-plugin/plugin.json   (없어도 된다)
 *   data/plugins/<플러그인>/skills/<이름>/SKILL.md
 *   data/plugins/<플러그인>/.mcp.json
 *
 * 모델에는 단계적으로 보여 준다: 이름과 설명은 항상 프롬프트에, 본문은 skill 도구로 부를 때, 참고 파일은 읽을 때.
 */

const SKILL_ROOT = path.join(process.cwd(), "data", "skills");
export const PLUGIN_ROOT = path.join(process.cwd(), "data", "plugins");
const NAME = /^[a-z0-9][a-z0-9-_]{0,63}$/i;

export interface SkillInfo {
  /** 플러그인 스킬은 "플러그인:이름" */
  id: string;
  name: string;
  description: string;
  plugin?: string;
  /** SKILL.md 말고 같이 든 파일(스킬 폴더 기준 경로) */
  files: string[];
}

export interface PluginInfo {
  name: string;
  description: string;
  version?: string;
  skills: string[];
  mcpServers: string[];
}

interface Loaded extends SkillInfo {
  dir: string;
  body: string;
}

const dirs = async (root: string): Promise<string[]> => {
  try {
    return (await readdir(root, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return [];
  }
};

async function walk(dir: string, base = ""): Promise<string[]> {
  const out: string[] = [];
  for (const d of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const rel = base ? `${base}/${d.name}` : d.name;
    if (d.isDirectory()) out.push(...(await walk(path.join(dir, d.name), rel)));
    else if (rel !== "SKILL.md") out.push(rel);
    if (out.length > 200) break;
  }
  return out;
}

export function parseSkillFile(raw: string): { meta: Record<string, unknown>; body: string } {
  const m = raw.replace(/^﻿/, "").match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: raw.trim() };
  let meta: Record<string, unknown> = {};
  try {
    const y = load(m[1]);
    if (y && typeof y === "object") meta = y as Record<string, unknown>;
  } catch {
    // 머리말이 깨졌으면 본문만 쓴다
  }
  return { meta, body: m[2].trim() };
}

async function loadSkillDir(dir: string, folder: string, plugin?: string): Promise<Loaded | null> {
  let raw: string;
  try {
    raw = await readFile(path.join(dir, "SKILL.md"), "utf8");
  } catch {
    return null;
  }
  const { meta, body } = parseSkillFile(raw);
  const name = String(meta.name ?? folder).trim() || folder;
  return {
    id: plugin ? `${plugin}:${name}` : name,
    name,
    description: String(meta.description ?? "").trim() || body.split("\n").find((l) => l.trim() && !l.startsWith("#"))?.trim().slice(0, 200) || "(설명 없음)",
    ...(plugin ? { plugin } : {}),
    files: await walk(dir),
    dir,
    body,
  };
}

async function loadAll(): Promise<Loaded[]> {
  const out: Loaded[] = [];
  for (const folder of await dirs(SKILL_ROOT)) {
    const s = await loadSkillDir(path.join(SKILL_ROOT, folder), folder);
    if (s) out.push(s);
  }
  for (const plugin of await dirs(PLUGIN_ROOT)) {
    const root = path.join(PLUGIN_ROOT, plugin, "skills");
    for (const folder of await dirs(root)) {
      const s = await loadSkillDir(path.join(root, folder), folder, plugin);
      if (s) out.push(s);
    }
  }
  return out;
}

const publicInfo = ({ id, name, description, plugin, files }: Loaded): SkillInfo => ({ id, name, description, ...(plugin ? { plugin } : {}), files });

export async function listSkills(): Promise<SkillInfo[]> {
  return (await loadAll()).map(publicInfo);
}

export async function getSkill(id: string): Promise<(SkillInfo & { body: string }) | null> {
  const s = (await loadAll()).find((x) => x.id === id);
  return s ? { ...publicInfo(s), body: s.body } : null;
}

/** 플러그인의 .mcp.json — {"mcpServers": {...}} 또는 서버 맵 그대로 */
export async function pluginMcpServers(plugin: string): Promise<Record<string, unknown>> {
  try {
    const raw = JSON.parse(await readFile(path.join(PLUGIN_ROOT, plugin, ".mcp.json"), "utf8")) as Record<string, unknown>;
    const servers = raw.mcpServers && typeof raw.mcpServers === "object" ? raw.mcpServers : raw;
    return servers as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function listPlugins(): Promise<PluginInfo[]> {
  const skills = await loadAll();
  const out: PluginInfo[] = [];
  for (const dir of await dirs(PLUGIN_ROOT)) {
    let manifest: Record<string, unknown> = {};
    try {
      manifest = JSON.parse(await readFile(path.join(PLUGIN_ROOT, dir, ".claude-plugin", "plugin.json"), "utf8"));
    } catch {
      // 매니페스트는 없어도 된다
    }
    out.push({
      name: dir,
      description: String(manifest.description ?? ""),
      ...(manifest.version ? { version: String(manifest.version) } : {}),
      skills: skills.filter((s) => s.plugin === dir).map((s) => s.id),
      mcpServers: Object.keys(await pluginMcpServers(dir)).map((s) => `${dir}:${s}`),
    });
  }
  return out;
}

const SHARED_READONLY = "여러 사람이 함께 쓰는 서버에서는 스킬을 고칠 수 없습니다. 스킬은 배포 파일로 관리합니다.";

/** 화면에서 만든 스킬 저장(data/skills 아래만). 플러그인 스킬은 폴더를 직접 고친다 */
export async function saveSkill(name: string, description: string, body: string): Promise<void> {
  if (multiUser()) throw new Error(SHARED_READONLY);
  if (!NAME.test(name)) throw new Error("스킬 이름은 영문·숫자·-·_ 로 64자 이내여야 합니다.");
  if (!description.trim()) throw new Error("설명이 필요합니다. 모델은 이 설명을 보고 스킬을 쓸지 정합니다.");
  const dir = path.join(SKILL_ROOT, name);
  await mkdir(dir, { recursive: true });
  const head = dump({ name, description: description.trim() }, { lineWidth: -1 }).trim();
  await writeFile(path.join(dir, "SKILL.md"), `---\n${head}\n---\n\n${body.trim()}\n`, "utf8");
}

export async function deleteSkill(name: string): Promise<void> {
  if (multiUser()) throw new Error(SHARED_READONLY);
  if (!NAME.test(name)) throw new Error("올바른 스킬 이름이 아닙니다.");
  await rm(path.join(SKILL_ROOT, name), { recursive: true, force: true });
}

// ───────────────────────── 모델에 주는 것 ─────────────────────────

export const SKILL_TOOL = "skill";
export const SKILL_FILE_TOOL = "skill_read_file";

export interface SkillSet {
  /** 시스템 프롬프트에 붙일 스킬 목록(이름 + 설명) */
  prompt: string;
  defs: ToolDef[];
  run: (tool: string, input: unknown) => Promise<ToolOutput>;
  available: SkillInfo[];
  missing: string[];
}

/** LLM 노드에서 켠 스킬들로 프롬프트 목록과 도구를 만든다 */
export async function openSkills(ids: string[]): Promise<SkillSet | null> {
  if (!ids.length) return null;
  const all = await loadAll();
  const picked = ids.map((id) => all.find((s) => s.id === id)).filter((s): s is Loaded => !!s);
  const missing = ids.filter((id) => !all.some((s) => s.id === id));
  if (!picked.length) return { prompt: "", defs: [], run: async () => ({ output: "쓸 수 있는 스킬이 없습니다.", isError: true }), available: [], missing };
  const withFiles = picked.some((s) => s.files.length);
  const find = (input: unknown) => {
    const name = String((input as { name?: unknown })?.name ?? "").trim();
    return { name, skill: picked.find((s) => s.id === name || s.name === name) };
  };
  const names = picked.map((s) => s.id).join(", ");
  return {
    prompt: [
      "[스킬]",
      `아래 스킬을 쓸 수 있다. 요청이 어느 스킬의 설명에 해당하면, 답하기 전에 ${SKILL_TOOL} 도구로 그 스킬의 지침을 불러와 그대로 따른다. 해당하는 스킬이 없으면 부르지 않는다.`,
      ...picked.map((s) => `- ${s.id}: ${s.description}`),
    ].join("\n"),
    defs: [
      {
        name: SKILL_TOOL,
        description: "스킬의 전체 지침(SKILL.md 본문)을 불러온다. 시스템 프롬프트의 [스킬] 목록에 있는 이름만 쓸 수 있다.",
        parameters: { type: "object", properties: { name: { type: "string", enum: picked.map((s) => s.id), description: "스킬 이름" } }, required: ["name"] },
      },
      ...(withFiles
        ? [
            {
              name: SKILL_FILE_TOOL,
              description: "스킬에 딸린 참고 파일을 읽는다. 스킬 지침이 특정 파일을 보라고 할 때 쓴다.",
              parameters: {
                type: "object",
                properties: { name: { type: "string", description: "스킬 이름" }, path: { type: "string", description: "스킬 폴더 기준 파일 경로" } },
                required: ["name", "path"],
              },
            },
          ]
        : []),
    ],
    run: async (tool, input) => {
      const { name, skill } = find(input);
      if (!skill) return { output: `스킬 '${name}' 이 없습니다. 쓸 수 있는 스킬: ${names}`, isError: true };
      if (tool === SKILL_TOOL) {
        const files = skill.files.length ? `\n\n[이 스킬에 딸린 파일 — ${SKILL_FILE_TOOL} 로 읽는다]\n${skill.files.map((f) => `- ${f}`).join("\n")}` : "";
        return { output: `# 스킬: ${skill.id}\n\n${skill.body}${files}` };
      }
      const rel = String((input as { path?: unknown })?.path ?? "").replace(/\\/g, "/");
      const file = path.resolve(skill.dir, rel);
      if (!rel || !file.startsWith(path.resolve(skill.dir) + path.sep)) return { output: "스킬 폴더 안의 파일만 읽을 수 있습니다.", isError: true };
      try {
        if ((await stat(file)).size > 200_000) return { output: "파일이 너무 큽니다 (200KB 초과).", isError: true };
        return { output: await readFile(file, "utf8") };
      } catch {
        return { output: `파일이 없습니다: ${rel}. 있는 파일: ${skill.files.join(", ") || "(없음)"}`, isError: true };
      }
    },
    available: picked.map(publicInfo),
    missing,
  };
}
