import { readdir } from "node:fs/promises";
import path from "node:path";
import { connection } from "next/server";
import { loadDataset } from "@/lib/knowledge/store";
import { bind, signedIn } from "@/lib/store/backend";

/** 지식 검색 노드에서 고를 수 있는 로컬 데이터셋 목록 */
export async function GET() {
  const denied = bind(await signedIn());
  if (denied) return denied;
  await connection();
  let files: string[] = [];
  try {
    files = (await readdir(path.join(process.cwd(), "data", "datasets"))).filter((f) => f.endsWith(".json"));
  } catch {}
  const datasets = [];
  for (const f of files) {
    const id = f.replace(/\.json$/, "");
    const ds = await loadDataset(id);
    if (ds) datasets.push({ id, name: ds.name, chunkCount: ds.chunks.length });
  }
  return Response.json({ datasets });
}
