import { isMemoryBlock, memoryKindInfo, readMemory } from "../../dsl/memory";
import type { ValueSelector } from "../../dsl/types";
import { addRecord, applyOps, isValid, loadMemory, mutateMemory, scoreRecords, type MemoryOp, type MemoryRecord, type ScoredRecord } from "../../memory/store";
import type { NodeContext, NodeExecutor } from "../context";
import { renderTemplate, selectorKey, stringifyValue } from "../variable-pool";

/** 저장소 범위: 프로젝트마다 따로. 요청에 없으면 공용 */
const scopeOf = (ctx: NodeContext) => String(ctx.request.memoryScope ?? "") || "default";

// ───────────────────────── 메모리 모듈(블록)의 네 지점 ─────────────────────────

const turnText = (history: { role: string; content: string }[]) =>
  history.map((h) => `${h.role === "user" ? "사용자" : "AI"}: ${h.content}`).join("\n");

function moduleInfo(ctx: NodeContext) {
  const cfg = readMemory(ctx.node);
  const llm = ctx.workflow.nodes.find((n) => n.id === ctx.data.llm_id);
  return { cfg, kind: memoryKindInfo(cfg.kind).name, llmTitle: llm?.data.title ?? String(ctx.data.llm_id ?? "") };
}

/** 읽기 시작: 안쪽 노드가 쓸 값(질문, 지난 대화, 시각)을 모듈 변수로 내놓는다 */
export const memoryReadNode: NodeExecutor = async (ctx) => {
  const { cfg, kind, llmTitle } = moduleInfo(ctx);
  const history = ctx.request.history ?? [];
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  ctx.trace.inputs = { "sys.query": ctx.request.query, history_messages: history.length };
  ctx.trace.processData = { phase: "read", kind, store: cfg.store, scope: scopeOf(ctx), attached_to: llmTitle, llm_id: String(ctx.data.llm_id ?? "") };
  return {
    outputs: {
      query: ctx.request.query,
      history,
      history_text: turnText(history),
      turn: history.filter((h) => h.role === "user").length + 1,
      conversation_id: String(ctx.pool.get(["sys", "conversation_id"]) ?? ""),
      now: now.toISOString(),
      today: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    },
  };
};

/** 읽기 끝: 읽기 구역의 결과를 LLM 에 넘길 형태(컨텍스트 글 + 대화 이력)로 정리한다 */
export const memoryReadEndNode: NodeExecutor = async (ctx) => {
  const { cfg, llmTitle } = moduleInfo(ctx);
  const inputs: Record<string, unknown> = {};
  let context = "";
  if (cfg.context.length) {
    const raw = ctx.pool.get(cfg.context);
    inputs[selectorKey(cfg.context)] = raw ?? null;
    context = stringifyValue(raw).trim();
  }
  let messages: { role: "user" | "assistant"; content: string }[] | null = null;
  if (cfg.history.length) {
    const raw = ctx.pool.get(cfg.history);
    inputs[selectorKey(cfg.history)] = raw ?? null;
    messages = (Array.isArray(raw) ? raw : [])
      .filter((m): m is { role: string; content: unknown } => !!m && typeof m === "object" && "role" in m && "content" in m)
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({ role: m.role as "user" | "assistant", content: String(m.content ?? "") }));
  }
  ctx.trace.inputs = inputs;
  ctx.trace.processData = {
    phase: "read-end",
    to: llmTitle,
    context: cfg.context.length ? { from: selectorKey(cfg.context), chars: context.length } : "지정 안 함",
    history: cfg.history.length ? { from: selectorKey(cfg.history), messages: messages?.length ?? 0 } : "지정 안 함 — LLM 노드의 메모리 설정을 그대로 사용",
  };
  return { outputs: { context, messages } };
};

/** 쓰기 시작: LLM 이 방금 낸 응답을 모듈 변수로 내놓는다 */
export const memoryWriteNode: NodeExecutor = async (ctx) => {
  const llmId = String(ctx.data.llm_id ?? "");
  const answer = stringifyValue(ctx.pool.get([llmId, "text"]));
  ctx.trace.inputs = { [`${llmId}.text`]: answer };
  ctx.trace.processData = { phase: "write" };
  return { outputs: { answer } };
};

/** 쓰기 끝: 이번 턴이 끝난 뒤의 저장소 상태를 기록에 남긴다 */
export const memoryWriteEndNode: NodeExecutor = async (ctx) => {
  const { cfg } = moduleInfo(ctx);
  const m = await loadMemory(scopeOf(ctx), cfg.store);
  ctx.trace.processData = {
    phase: "write-end",
    store: cfg.store,
    docs: Object.fromEntries(Object.entries(m.docs).map(([k, d]) => [k, `${d.text.length}자`])),
    records: { total: m.records.length, valid: m.records.filter(isValid).length },
  };
  return { outputs: {} };
};

// ───────────────────────── 메모리 저장소 노드 ─────────────────────────

export const MEMORY_OPS = ["doc_get", "doc_get_many", "doc_set", "doc_append", "rec_search", "rec_similar", "rec_add", "rec_apply"] as const;

const view = (r: MemoryRecord | ScoredRecord) => ({
  id: r.id,
  text: r.text,
  ...("relevance" in r ? { relevance: r.relevance, age_hours: r.age_hours } : {}),
  importance: r.importance ?? null,
  created_at: r.createdAt,
  valid_from: (r.validFrom ?? r.createdAt).slice(0, 10),
  invalid_at: r.invalidAt ? r.invalidAt.slice(0, 10) : null,
});
const listText = (rs: { id: string; text: string }[]) => rs.map((r) => `[${r.id}] ${r.text}`).join("\n");

export const memoryStoreNode: NodeExecutor = async (ctx) => {
  const { data, pool, trace, node, workflow } = ctx;
  const parent = workflow.nodes.find((n) => n.id === node.parentId);
  const store = String(data.store ?? "") || (isMemoryBlock(parent) ? readMemory(parent).store : "default");
  const scope = scopeOf(ctx);
  const op = String(data.op ?? "doc_get");
  const refs: Record<string, unknown> = {};
  const render = (key: string) => {
    const r = renderTemplate(String(data[key] ?? ""), pool);
    Object.assign(refs, r.refs);
    return r.text;
  };
  const list = (): unknown[] => {
    const sel = data.list as ValueSelector | undefined;
    const raw = pool.get(sel);
    refs[selectorKey(sel)] = raw ?? null;
    return Array.isArray(raw) ? raw : raw == null || raw === "" ? [] : [raw];
  };
  const textOf = (v: unknown) => (v && typeof v === "object" ? String((v as { text?: unknown }).text ?? "") : String(v ?? "")).trim();
  const topK = Math.max(1, Number(data.top_k ?? 5));
  const validOnly = data.valid_only !== false;
  const base = { store, scope, op };
  trace.inputs = refs;

  switch (op) {
    case "doc_get": {
      const key = render("key").trim();
      const m = await loadMemory(scope, store);
      const doc = m.docs[key];
      trace.processData = { ...base, key, found: !!doc, updated_at: doc?.updatedAt ?? null };
      return { outputs: { text: doc?.text ?? "", exists: !!doc } };
    }
    case "doc_get_many": {
      const keys = [...new Set(list().map(textOf).filter(Boolean))];
      const m = await loadMemory(scope, store);
      const docs = keys.filter((k) => m.docs[k]).map((k) => ({ key: k, text: m.docs[k].text }));
      const missing = keys.filter((k) => !m.docs[k]);
      trace.processData = { ...base, requested: keys, found: docs.map((d) => d.key), missing, available: Object.keys(m.docs) };
      return { outputs: { text: docs.map((d) => `## ${d.key}\n${d.text}`).join("\n\n"), docs, missing } };
    }
    case "doc_set":
    case "doc_append": {
      const key = render("key").trim();
      const value = render("value");
      if (!key) throw new Error("저장할 키가 비어 있습니다.");
      const result = await mutateMemory(scope, store, (m) => {
        const before = m.docs[key]?.text ?? "";
        const text = op === "doc_set" ? value : value.trim() ? (before ? `${before.replace(/\s+$/, "")}\n${value.trim()}` : value.trim()) : before;
        if (text !== before || !m.docs[key]) {
          const at = new Date().toISOString();
          m.docs[key] = { text, updatedAt: at, prov: { at, via: "node", conversationId: ctx.request.conversationId, ...(m.docs[key]?.prov?.external ? { external: true } : {}) } };
        }
        return { before, text };
      });
      trace.processData = { ...base, key, before: result.before, after: result.text, changed: result.before !== result.text };
      return { outputs: { text: result.text, changed: result.before !== result.text } };
    }
    case "rec_search": {
      const query = render("query");
      const m = await loadMemory(scope, store);
      const pool0 = m.records.filter((r) => !validOnly || isValid(r));
      const scored = scoreRecords(query, pool0);
      const hits = (data.include_unmatched ? scored : scored.filter((r) => r.relevance > 0)).slice(0, topK).map(view);
      trace.processData = {
        ...base,
        query,
        method: "TF-IDF 코사인 유사도 (단어 + 한글 2-gram, 로컬 — 임베딩 아님)",
        top_k: topK,
        valid_only: validOnly,
        include_unmatched: !!data.include_unmatched,
        searched: pool0.length,
        candidates: scored.slice(0, Math.max(topK + 3, 8)).map((r) => ({ id: r.id, relevance: r.relevance, selected: hits.some((h) => h.id === r.id), text: r.text.slice(0, 90) })),
      };
      return { outputs: { records: hits, text: listText(hits), count: hits.length } };
    }
    case "rec_similar": {
      const items = list().map(textOf).filter(Boolean);
      const m = await loadMemory(scope, store);
      const pool0 = m.records.filter((r) => !validOnly || isValid(r));
      const picked = new Map<string, ReturnType<typeof view>>();
      const per = items.map((item) => {
        const hits = scoreRecords(item, pool0).filter((r) => r.relevance > 0).slice(0, topK);
        for (const h of hits) if (!picked.has(h.id)) picked.set(h.id, view(h));
        return { item, similar: hits.map((h) => ({ id: h.id, relevance: h.relevance, text: h.text.slice(0, 90) })) };
      });
      const records = [...picked.values()];
      trace.processData = { ...base, top_k: topK, valid_only: validOnly, searched: pool0.length, per_item: per };
      return { outputs: { records, text: listText(records) || "(관련된 기존 기억 없음)", count: records.length } };
    }
    case "rec_add": {
      const text = render("value").trim();
      const imp = Number(render("importance"));
      if (!text) {
        trace.processData = { ...base, note: "내용이 비어 있어 저장하지 않음" };
        return { outputs: { id: "", text: "" } };
      }
      const importance = Number.isFinite(imp) && imp > 0 ? Math.min(10, Math.max(1, imp)) : undefined;
      const r = await mutateMemory(scope, store, (m) => addRecord(m, text, { conversationId: ctx.request.conversationId, ...(importance != null ? { importance } : {}) }));
      trace.processData = { ...base, added: view(r) };
      return { outputs: { id: r.id, text: r.text } };
    }
    case "rec_apply": {
      const ops = list().filter((o): o is MemoryOp => !!o && typeof o === "object");
      const applied = await mutateMemory(scope, store, (m) => applyOps(m, ops, undefined, { conversationId: ctx.request.conversationId }));
      const done = applied.filter((a) => a.result === "적용");
      const count = (name: string) => done.filter((a) => a.op === name).length;
      const summary = `추가 ${count("ADD")} · 갱신 ${count("UPDATE")} · 삭제 ${count("DELETE")} · 무효 ${count("INVALIDATE")} · 건너뜀 ${applied.length - done.length}`;
      trace.processData = { ...base, applied, summary };
      return { outputs: { applied, summary, changed: done.length } };
    }
    default:
      throw new Error(`모르는 저장소 동작: ${op}`);
  }
};
