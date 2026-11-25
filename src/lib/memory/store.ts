import { rankChunks } from "../knowledge/store";
import { files } from "../store/backend";

/**
 * 메모리 저장소: 대화가 끝나도 남는 기억. memory/<범위>/<저장소 이름>.json 하나가 저장소 하나다(파일 또는 사용자별 DB).
 * - docs: 키 → 글(프로필, 요약, 메모리 파일, 일일 기록)
 * - records: 낱개 기억(사실, 에피소드). 시각·중요도·유효 기간을 함께 둔다.
 * 범위는 보통 프로젝트 ID 다. 같은 프로젝트 안에서는 대화를 새로 시작해도 같은 저장소를 본다.
 */

/** 기억이 어디서 왔는지 */
export interface Provenance {
  at: string;
  /** 어느 대화에서 */
  conversationId?: string;
  /** tool: 모델이 메모리 도구로 · node: 모듈의 저장소 노드가 · dream: 정리(드리밍)가 */
  via: "tool" | "node" | "dream";
  /** 외부 자료(웹 페이지, MCP 서버 결과)를 본 대화에서 저장됨 — 그 자료의 지시문이 섞였을 수 있다 */
  external?: boolean;
}

export interface MemoryDoc {
  text: string;
  updatedAt: string;
  prov?: Provenance;
}

export interface MemoryRecord {
  id: string;
  text: string;
  createdAt: string;
  updatedAt: string;
  /** 1(일상적) ~ 10(매우 중요) */
  importance?: number;
  /** 이 사실이 참이 된 시각 */
  validFrom?: string;
  /** 더 이상 참이 아니게 된 시각(없으면 지금도 유효) */
  invalidAt?: string | null;
  /** 어느 대화에서 쌓였는지 */
  conversationId?: string;
}

export interface MemoryFile {
  docs: Record<string, MemoryDoc>;
  records: MemoryRecord[];
  seq: number;
  /** 정리(드리밍)가 만든 검토용 사본 — 적용하기 전까지 docs 는 그대로다 */
  review?: { createdAt: string; docs: Record<string, string>; notes: string; model: string };
  /** 마지막 정리를 적용하기 직전의 docs */
  backup?: { at: string; docs: Record<string, MemoryDoc> };
}

const ROOT = "memory";
const safe = (s: string) => {
  const v = String(s || "default").trim().replace(/[^\w가-힣-]+/g, "_").slice(0, 80);
  return v || "default";
};
const fileOf = (scope: string, store: string) => `${ROOT}/${safe(scope)}/${safe(store)}.json`;
const empty = (): MemoryFile => ({ docs: {}, records: [], seq: 0 });

/** 같은 파일을 동시에 고치지 않도록 파일별로 줄을 세운다(병렬 노드 대비) */
const queues = new Map<string, Promise<unknown>>();
function locked<T>(path: string, fn: () => Promise<T>): Promise<T> {
  // 사용자마다 다른 줄에 세운다
  const file = `${files().id}:${path}`;
  const next = (queues.get(file) ?? Promise.resolve()).then(fn, fn);
  queues.set(
    file,
    next.catch(() => {}),
  );
  return next;
}

async function read(file: string): Promise<MemoryFile> {
  try {
    const raw = (await files().read(file)) as Partial<MemoryFile> | null;
    if (!raw) return empty();
    return {
      docs: raw.docs ?? {},
      records: Array.isArray(raw.records) ? raw.records : [],
      seq: Number(raw.seq) || 0,
      ...(raw.review ? { review: raw.review } : {}),
      ...(raw.backup ? { backup: raw.backup } : {}),
    };
  } catch {
    return empty();
  }
}

export function loadMemory(scope: string, store: string): Promise<MemoryFile> {
  const file = fileOf(scope, store);
  return locked(file, () => read(file));
}

/** 저장소를 읽어 고치고 다시 쓴다. fn 이 돌려준 값을 그대로 돌려준다. */
export function mutateMemory<T>(scope: string, store: string, fn: (m: MemoryFile) => T): Promise<T> {
  const file = fileOf(scope, store);
  return locked(file, async () => {
    const m = await read(file);
    const result = fn(m);
    await files().write(file, m);
    return result;
  });
}

export async function clearMemory(scope: string, store: string): Promise<void> {
  const file = fileOf(scope, store);
  await locked(file, () => files().remove(file));
}

export async function listStores(scope: string): Promise<string[]> {
  return (await files().list(`${ROOT}/${safe(scope)}`)).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5));
}

// ───────────────────────── 기록 조작 ─────────────────────────

export const isValid = (r: MemoryRecord) => !r.invalidAt;

export interface ScoredRecord extends MemoryRecord {
  /** 질의와의 어휘 유사도(0~1, TF-IDF 코사인) */
  relevance: number;
  age_hours: number;
}

/** 질의와의 관련성 점수를 붙여 높은 순으로 돌려준다. 임베딩이 아니라 지식 검색과 같은 로컬 TF-IDF 다. */
export function scoreRecords(query: string, records: MemoryRecord[], now = Date.now()): ScoredRecord[] {
  const ranked = query.trim()
    ? rankChunks(
        query,
        records.map((r, i) => ({ datasetId: "", datasetName: "", title: "", content: r.text, position: i })),
      )
    : [];
  const score = new Map(ranked.map((c) => [c.position, c.score]));
  return records
    .map((r, i) => ({
      ...r,
      relevance: score.get(i) ?? 0,
      age_hours: Number(Math.max(0, (now - Date.parse(r.createdAt)) / 3_600_000).toFixed(2)),
    }))
    .sort((a, b) => b.relevance - a.relevance || Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

export function addRecord(m: MemoryFile, text: string, extra: Partial<MemoryRecord> = {}, now = new Date().toISOString()): MemoryRecord {
  const record: MemoryRecord = { id: `m${++m.seq}`, text: text.trim(), createdAt: now, updatedAt: now, validFrom: now, invalidAt: null, ...extra };
  m.records.push(record);
  return record;
}

export interface MemoryOp {
  op: string;
  id?: string;
  text?: string;
  importance?: number;
}
export interface AppliedOp {
  op: string;
  id?: string;
  text?: string;
  before?: string;
  result: "적용" | "건너뜀";
  note?: string;
}

/**
 * 통합 판단(ADD / UPDATE / DELETE / INVALIDATE / NONE) 목록을 저장소에 반영한다.
 * 모델이 없는 ID를 지어내면 그 항목만 건너뛴다.
 */
export function applyOps(m: MemoryFile, ops: MemoryOp[], now = new Date().toISOString(), extra: Partial<MemoryRecord> = {}): AppliedOp[] {
  const out: AppliedOp[] = [];
  for (const raw of ops) {
    const op = String(raw?.op ?? "").toUpperCase();
    const id = String(raw?.id ?? "").trim();
    const text = String(raw?.text ?? "").trim();
    const found = m.records.find((r) => r.id === id);
    if (op === "ADD") {
      if (!text) out.push({ op, result: "건너뜀", note: "내용 없음" });
      else if (m.records.some((r) => isValid(r) && r.text === text)) out.push({ op, text, result: "건너뜀", note: "같은 내용이 이미 있음" });
      else {
        const r = addRecord(m, text, { ...extra, ...(raw.importance != null ? { importance: Number(raw.importance) } : {}) }, now);
        out.push({ op, id: r.id, text, result: "적용" });
      }
    } else if (op === "UPDATE") {
      if (!found || !text) out.push({ op, id, text, result: "건너뜀", note: found ? "내용 없음" : "없는 ID" });
      else {
        out.push({ op, id, text, before: found.text, result: "적용" });
        found.text = text;
        found.updatedAt = now;
      }
    } else if (op === "DELETE") {
      if (!found) out.push({ op, id, result: "건너뜀", note: "없는 ID" });
      else {
        m.records = m.records.filter((r) => r !== found);
        out.push({ op, id, before: found.text, result: "적용" });
      }
    } else if (op === "INVALIDATE") {
      if (!found || !isValid(found)) out.push({ op, id, result: "건너뜀", note: found ? "이미 무효" : "없는 ID" });
      else {
        found.invalidAt = now;
        found.updatedAt = now;
        out.push({ op, id, before: found.text, result: "적용" });
      }
    } else out.push({ op: op || "NONE", id: id || undefined, text: text || undefined, result: "건너뜀", note: op === "NONE" || !op ? "바꿀 것 없음" : "모르는 연산" });
  }
  return out;
}
