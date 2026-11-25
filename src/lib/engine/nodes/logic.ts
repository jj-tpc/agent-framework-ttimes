import nunjucks from "nunjucks";
import type { ValueSelector } from "../../dsl/types";
import { loadDataset, rankChunks, type Chunk } from "../../knowledge/store";
import type { NodeExecutor } from "../context";
import { renderTemplate, selectorKey, stringifyValue } from "../variable-pool";
import { runCode } from "./code-runner";

// ───────────────────────── if-else ─────────────────────────

interface Condition {
  variable_selector: ValueSelector;
  comparison_operator: string;
  value?: unknown;
}
interface Case {
  case_id: string;
  logical_operator?: "and" | "or";
  conditions: Condition[];
}

const isEmpty = (v: unknown) =>
  v == null || v === "" || (Array.isArray(v) && v.length === 0) || (typeof v === "object" && !Array.isArray(v) && Object.keys(v as object).length === 0);

function compare(actual: unknown, op: string, expected: unknown): boolean {
  const a = actual;
  const e = typeof expected === "string" ? expected : expected;
  const str = (x: unknown) => stringifyValue(x);
  const num = (x: unknown) => Number(x);
  const list = (x: unknown) => (Array.isArray(x) ? x.map(String) : String(x ?? "").split(",").map((s) => s.trim()));
  switch (op) {
    case "contains":
      return Array.isArray(a) ? a.map(String).includes(str(e)) : str(a).includes(str(e));
    case "not contains":
      return !compare(a, "contains", e);
    case "start with":
      return str(a).startsWith(str(e));
    case "end with":
      return str(a).endsWith(str(e));
    case "is":
      return str(a) === str(e);
    case "is not":
      return str(a) !== str(e);
    case "empty":
      return isEmpty(a);
    case "not empty":
      return !isEmpty(a);
    case "in":
      return list(e).includes(str(a));
    case "not in":
      return !list(e).includes(str(a));
    case "all of":
      return Array.isArray(a) && list(e).every((x) => a.map(String).includes(x));
    case "=":
      return num(a) === num(e);
    case "≠":
      return num(a) !== num(e);
    case ">":
      return num(a) > num(e);
    case "<":
      return num(a) < num(e);
    case "≥":
      return num(a) >= num(e);
    case "≤":
      return num(a) <= num(e);
    case "null":
    case "not exists":
      return a == null;
    case "not null":
    case "exists":
      return a != null;
    default:
      throw new Error(`지원하지 않는 비교 연산자: ${op}`);
  }
}

export const ifElseNode: NodeExecutor = async ({ data, pool, trace }) => {
  const cases: Case[] = Array.isArray(data.cases)
    ? (data.cases as Case[])
    : [{ case_id: "true", logical_operator: data.logical_operator as "and" | "or", conditions: (data.conditions as Condition[]) ?? [] }];

  const evaluated = [];
  let selected = "false";
  for (const c of cases) {
    const conditions = c.conditions.map((cond) => {
      const actual = pool.get(cond.variable_selector);
      trace.inputs[selectorKey(cond.variable_selector)] = actual ?? null;
      const expected = typeof cond.value === "string" ? renderTemplate(cond.value, pool).text : cond.value;
      return {
        variable: selectorKey(cond.variable_selector),
        actual: actual ?? null,
        operator: cond.comparison_operator,
        expected: ["empty", "not empty", "null", "not null", "exists", "not exists"].includes(cond.comparison_operator) ? undefined : expected,
        result: compare(actual, cond.comparison_operator, expected),
      };
    });
    const op = c.logical_operator ?? "and";
    const result = conditions.length > 0 && (op === "and" ? conditions.every((x) => x.result) : conditions.some((x) => x.result));
    evaluated.push({ case_id: c.case_id, logical_operator: op, conditions, result });
    if (result) {
      selected = c.case_id;
      break;
    }
  }
  trace.processData = { cases: evaluated, selected_branch: selected === "false" ? "ELSE" : selected };
  return { outputs: { result: selected !== "false", selected_case_id: selected }, selectedHandle: selected };
};

// ───────────────────────── code ─────────────────────────

function collectArgs(data: Record<string, unknown>, pool: Parameters<NodeExecutor>[0]["pool"], inputs: Record<string, unknown>) {
  const args: Record<string, unknown> = {};
  for (const v of (data.variables as { variable: string; value_selector: ValueSelector }[]) ?? []) {
    args[v.variable] = pool.get(v.value_selector) ?? null;
    inputs[v.variable] = args[v.variable];
  }
  return args;
}

export const codeNode: NodeExecutor = async ({ data, pool, trace }) => {
  const args = collectArgs(data, pool, trace.inputs);
  const language = String(data.code_language ?? "python3");
  const code = String(data.code ?? "");
  const bindings = ((data.variables as { variable: string; value_selector: ValueSelector }[]) ?? []).map((v) => ({
    arg: v.variable,
    from: selectorKey(v.value_selector),
  }));
  trace.processData = { language, bindings, code };

  const { result, logs } = await runCode(language, code, args);
  trace.processData = { ...trace.processData, ...(logs.length ? { logs } : {}) };
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new Error("main() 은 dict/object 를 반환해야 합니다.");
  }
  const declared = Object.keys((data.outputs as Record<string, unknown>) ?? {});
  const missing = declared.filter((k) => !(k in (result as Record<string, unknown>)));
  if (missing.length) throw new Error(`선언된 출력 변수가 반환값에 없습니다: ${missing.join(", ")}`);
  return { outputs: result as Record<string, unknown> };
};

// ───────────────────────── template-transform ─────────────────────────

const jinja = new nunjucks.Environment(null, { autoescape: false });

export const templateTransformNode: NodeExecutor = async ({ data, pool, trace }) => {
  const vars = collectArgs(data, pool, trace.inputs);
  const template = String(data.template ?? "");
  trace.processData = { engine: "jinja2 (nunjucks)", template };
  const output = jinja.renderString(template, vars);
  return { outputs: { output } };
};

// ───────────────────────── knowledge-retrieval ─────────────────────────

export const knowledgeRetrievalNode: NodeExecutor = async ({ data, pool, trace }) => {
  const selector = data.query_variable_selector as ValueSelector;
  const query = stringifyValue(pool.get(selector));
  trace.inputs = { [selectorKey(selector)]: query };

  const multi = (data.multiple_retrieval_config ?? {}) as { top_k?: number; score_threshold?: number | null };
  const topK = Number(multi.top_k ?? 3);
  const threshold = multi.score_threshold != null ? Number(multi.score_threshold) : 0;
  const ids = ((data.dataset_ids as string[]) ?? []).map(String);

  const datasets = [];
  const chunks: Chunk[] = [];
  for (const id of ids) {
    const ds = await loadDataset(id);
    datasets.push({ id, name: ds?.name ?? null, found: !!ds, chunk_count: ds?.chunks.length ?? 0 });
    if (ds) chunks.push(...ds.chunks);
  }
  const ranked = query.trim() ? rankChunks(query, chunks) : [];
  const hits = ranked.filter((c) => c.score > 0 && c.score >= threshold).slice(0, topK);

  trace.processData = {
    datasets,
    retrieval: { method: "TF-IDF 코사인 유사도 (단어 + 한글 2-gram, 로컬)", top_k: topK, score_threshold: threshold },
    candidates: ranked.slice(0, Math.max(topK + 3, 6)).map((c) => ({
      title: c.title,
      position: c.position,
      score: c.score,
      selected: hits.includes(c),
      preview: c.content.slice(0, 90),
    })),
    ...(datasets.some((d) => !d.found) ? { note: "data/datasets/<id>.json 이 없는 데이터셋은 건너뜀" } : {}),
  };

  return {
    outputs: {
      result: hits.map((c) => ({
        content: c.content,
        title: c.title,
        metadata: { score: c.score, dataset_id: c.datasetId, dataset_name: c.datasetName, document_name: c.title, segment_position: c.position },
      })),
    },
  };
};

// ───────────────────────── http-request ─────────────────────────

function parseKv(raw: unknown, render: (s: string) => string): Record<string, string> {
  const out: Record<string, string> = {};
  if (Array.isArray(raw)) {
    for (const item of raw as { key: string; value: string }[]) if (item?.key) out[render(item.key)] = render(String(item.value ?? ""));
    return out;
  }
  for (const line of String(raw ?? "").split("\n")) {
    const i = line.indexOf(":");
    if (i > 0) out[render(line.slice(0, i).trim())] = render(line.slice(i + 1).trim());
  }
  return out;
}

export const httpRequestNode: NodeExecutor = async ({ data, pool, trace, signal }) => {
  const refs: Record<string, unknown> = {};
  const render = (s: string) => {
    const r = renderTemplate(s, pool);
    Object.assign(refs, r.refs);
    return r.text;
  };
  const method = String(data.method ?? "get").toUpperCase();
  const url = new URL(render(String(data.url ?? "")));
  const params = parseKv(data.params, render);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const headers = parseKv(data.headers, render);

  const auth = data.authorization as { type?: string; config?: { type?: string; api_key?: string; header?: string } } | undefined;
  if (auth?.type === "api-key" && auth.config?.api_key) {
    const key = render(auth.config.api_key);
    if (auth.config.type === "custom") headers[auth.config.header || "Authorization"] = key;
    else if (auth.config.type === "basic") headers.Authorization = `Basic ${key}`;
    else headers.Authorization = `Bearer ${key}`;
  }

  const bodyCfg = (data.body ?? {}) as { type?: string; data?: unknown };
  let body: string | undefined;
  if (method !== "GET" && method !== "HEAD" && bodyCfg.type && bodyCfg.type !== "none") {
    const rawData = Array.isArray(bodyCfg.data)
      ? (bodyCfg.data as { key?: string; value?: string }[])
      : null;
    if (bodyCfg.type === "json" || bodyCfg.type === "raw-text") {
      body = render(rawData ? String(rawData[0]?.value ?? "") : String(bodyCfg.data ?? ""));
      if (bodyCfg.type === "json") headers["Content-Type"] ??= "application/json";
    } else {
      const kv = rawData ? parseKv(rawData, render) : parseKv(bodyCfg.data, render);
      body = new URLSearchParams(kv).toString();
      headers["Content-Type"] ??= "application/x-www-form-urlencoded";
    }
  }

  const masked = Object.fromEntries(
    Object.entries(headers).map(([k, v]) => [k, /authorization|api-key|token/i.test(k) ? `${v.slice(0, 10)}…(가림)` : v]),
  );
  trace.inputs = refs;
  trace.processData = { request: { method, url: url.toString(), headers: masked, body } };

  const timeoutMs = Number((data.timeout as { read?: number } | undefined)?.read ?? 30) * 1000;
  const res = await fetch(url, {
    method,
    headers,
    body,
    signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
  });
  const text = await res.text();
  return {
    outputs: {
      status_code: res.status,
      body: text,
      headers: Object.fromEntries(res.headers.entries()),
      files: [],
    },
  };
};

// ───────────────────────── env/unsupported ─────────────────────────

export const unsupportedNode: NodeExecutor = async ({ node }) => {
  throw new Error(`'${node.data.type}' 노드는 이 런타임에서 아직 지원하지 않습니다.`);
};
