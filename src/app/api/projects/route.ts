import { connection } from "next/server";
import { DslError, loadDoc } from "@/lib/dsl/parse";
import { createProject, getProject, listProjects } from "@/lib/store/projects";
import { loadTemplate } from "@/lib/store/templates";
import type { DslDoc } from "@/lib/dsl/types";
import { bind, signedIn } from "@/lib/store/backend";

export async function GET() {
  const denied = bind(await signedIn());
  if (denied) return denied;
  await connection();
  return Response.json({ projects: await listProjects() });
}

/** 새 프로젝트: 템플릿(template) · Dify YAML 가져오기(yaml) · 복제(duplicateOf) 중 하나로 만든다. */
export async function POST(req: Request) {
  const denied = bind(await signedIn());
  if (denied) return denied;
  const body = (await req.json().catch(() => ({}))) as {
    name?: string;
    description?: string;
    template?: string;
    yaml?: string;
    duplicateOf?: string;
  };

  let dsl: DslDoc | null = null;
  try {
    if (body.yaml) dsl = loadDoc(body.yaml);
    else if (body.duplicateOf) {
      const src = await getProject(body.duplicateOf);
      if (src) {
        const app = (src.dsl.app ?? {}) as Record<string, unknown>;
        dsl = { ...structuredClone(src.dsl), app: { ...app, name: `${app.name ?? "프로젝트"} 사본` } };
      }
    } else dsl = await loadTemplate(body.template ?? "blank");
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: e instanceof DslError ? 422 : 500 });
  }
  if (!dsl) return Response.json({ error: "템플릿 또는 원본 프로젝트를 찾을 수 없습니다." }, { status: 404 });

  const app = { ...((dsl.app ?? {}) as Record<string, unknown>) };
  if (body.name?.trim()) app.name = body.name.trim();
  if (body.description !== undefined && body.description.trim()) app.description = body.description.trim();
  const project = await createProject({ ...dsl, app });
  return Response.json({ id: project.id }, { status: 201 });
}
