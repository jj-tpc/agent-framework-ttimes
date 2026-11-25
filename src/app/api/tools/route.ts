import { connection } from "next/server";
import { listMcpServers } from "@/lib/tools/mcp";
import { listPlugins, listSkills } from "@/lib/tools/skills";
import { bind, signedIn } from "@/lib/store/backend";

/** LLM 노드의 도구 설정 화면에 보여 줄 목록: 스킬 · 플러그인 · MCP 서버 */
export async function GET() {
  const denied = bind(await signedIn());
  if (denied) return denied;
  await connection();
  const [skills, plugins, mcp] = await Promise.all([listSkills(), listPlugins(), listMcpServers()]);
  return Response.json({ skills, plugins, mcp });
}
