import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { graphOf, newBlankDoc } from "../dsl/edit";
import { loadDoc } from "../dsl/parse";
import type { DslDoc } from "../dsl/types";

/** 새 프로젝트를 만들 때 고르는 시작 템플릿. templates/*.yml + 빈 워크플로 */

const DIR = path.join(process.cwd(), "templates");

export interface TemplateSummary {
  id: string;
  name: string;
  description: string;
  icon: string;
  nodeTypes: string[];
}

export async function listTemplates(): Promise<TemplateSummary[]> {
  const blank = newBlankDoc("빈 워크플로");
  const out: TemplateSummary[] = [
    {
      id: "blank",
      name: "빈 워크플로",
      description: "시작 → LLM → 답변. 여기서부터 노드를 추가해 로직을 만듭니다.",
      icon: "✨",
      nodeTypes: graphOf(blank).nodes.map((n) => n.data.type),
    },
  ];
  let files: string[] = [];
  try {
    files = (await readdir(DIR)).filter((f) => /\.ya?ml$/i.test(f)).sort();
  } catch {}
  for (const f of files) {
    try {
      const doc = loadDoc(await readFile(path.join(DIR, f), "utf8"));
      const app = (doc.app ?? {}) as Record<string, unknown>;
      out.push({
        id: f,
        name: String(app.name ?? f),
        description: String(app.description ?? ""),
        icon: String(app.icon ?? "🤖"),
        nodeTypes: graphOf(doc).nodes.map((n) => n.data?.type).filter((t) => t && t !== "block"),
      });
    } catch {}
  }
  return out;
}

export async function loadTemplate(id: string): Promise<DslDoc | null> {
  if (id === "blank") return newBlankDoc("새 프로젝트");
  if (!/^[\w.-]+\.ya?ml$/i.test(id)) return null;
  try {
    return loadDoc(await readFile(path.join(DIR, id), "utf8"));
  } catch {
    return null;
  }
}
