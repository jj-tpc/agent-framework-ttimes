import { DslError, normalizeDoc, parseDsl } from "@/lib/dsl/parse";
import type { DslDoc } from "@/lib/dsl/types";
import { deleteProject, getProject, saveProject } from "@/lib/store/projects";
import { bind, signedIn } from "@/lib/store/backend";

export async function GET(_req: Request, ctx: RouteContext<"/api/projects/[id]">) {
  const denied = bind(await signedIn());
  if (denied) return denied;
  const { id } = await ctx.params;
  const project = await getProject(id);
  if (!project) return Response.json({ error: "프로젝트를 찾을 수 없습니다." }, { status: 404 });
  return Response.json(project);
}

/** 편집기의 자동 저장 */
export async function PUT(req: Request, ctx: RouteContext<"/api/projects/[id]">) {
  const denied = bind(await signedIn());
  if (denied) return denied;
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => null)) as { dsl?: DslDoc } | null;
  if (!body?.dsl || typeof body.dsl !== "object") return Response.json({ error: "dsl 이 필요합니다." }, { status: 400 });
  try {
    parseDsl(body.dsl); // 실행 가능한 형태인지 확인
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: e instanceof DslError ? 422 : 500 });
  }
  const saved = await saveProject(id, normalizeDoc(body.dsl));
  if (!saved) return Response.json({ error: "프로젝트를 찾을 수 없습니다." }, { status: 404 });
  return Response.json({ updatedAt: saved.updatedAt });
}

export async function DELETE(_req: Request, ctx: RouteContext<"/api/projects/[id]">) {
  const denied = bind(await signedIn());
  if (denied) return denied;
  const { id } = await ctx.params;
  await deleteProject(id);
  return new Response(null, { status: 204 });
}
