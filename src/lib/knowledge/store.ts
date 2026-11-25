import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * 로컬 지식베이스. data/datasets/<dataset_id>.json 파일을 Dify의 지식(Dataset)처럼 다룬다.
 * 검색은 단어 + 한글 2-gram TF-IDF 코사인 유사도(0~1)로, 외부 벡터DB 없이 동작한다.
 */

interface DatasetFile {
  id: string;
  name: string;
  documents: { title: string; content: string }[];
}

export interface Chunk {
  datasetId: string;
  datasetName: string;
  title: string;
  content: string;
  position: number;
}

export interface ScoredChunk extends Chunk {
  score: number;
}

const DATASET_DIR = path.join(process.cwd(), "data", "datasets");

export async function loadDataset(id: string): Promise<{ name: string; chunks: Chunk[] } | null> {
  if (!/^[\w-]+$/.test(id)) return null;
  try {
    const raw = await readFile(path.join(DATASET_DIR, `${id}.json`), "utf8");
    const ds = JSON.parse(raw) as DatasetFile;
    const chunks: Chunk[] = [];
    for (const doc of ds.documents ?? []) {
      const paragraphs = String(doc.content ?? "")
        .split(/\n\s*\n/)
        .map((p) => p.trim())
        .filter(Boolean);
      paragraphs.forEach((content, i) =>
        chunks.push({ datasetId: id, datasetName: ds.name ?? id, title: doc.title, content, position: i + 1 }),
      );
    }
    return { name: ds.name ?? id, chunks };
  } catch {
    return null;
  }
}

function features(text: string): string[] {
  const out: string[] = [];
  for (const word of text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean)) {
    out.push(word);
    if (/[ㄱ-힝]/.test(word) && word.length > 1) {
      for (let i = 0; i < word.length - 1; i++) out.push(`#${word.slice(i, i + 2)}`);
    }
  }
  return out;
}

function termFreq(tokens: string[]) {
  const tf = new Map<string, number>();
  for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
  return tf;
}

export function rankChunks(query: string, chunks: Chunk[]): ScoredChunk[] {
  const docs = chunks.map((c) => termFreq(features(`${c.title} ${c.content}`)));
  const df = new Map<string, number>();
  for (const d of docs) for (const t of d.keys()) df.set(t, (df.get(t) ?? 0) + 1);
  const n = chunks.length;
  const idf = (t: string) => Math.log(1 + n / (1 + (df.get(t) ?? 0)));

  const vec = (tf: Map<string, number>) => {
    const v = new Map<string, number>();
    for (const [t, f] of tf) v.set(t, (1 + Math.log(f)) * idf(t));
    return v;
  };
  const norm = (v: Map<string, number>) => Math.sqrt([...v.values()].reduce((s, x) => s + x * x, 0));

  const qv = vec(termFreq(features(query)));
  const qn = norm(qv);
  return chunks
    .map((chunk, i) => {
      const dv = vec(docs[i]);
      let dot = 0;
      for (const [t, w] of qv) dot += w * (dv.get(t) ?? 0);
      const denom = qn * norm(dv);
      return { ...chunk, score: denom ? Number((dot / denom).toFixed(4)) : 0 };
    })
    .sort((a, b) => b.score - a.score);
}
