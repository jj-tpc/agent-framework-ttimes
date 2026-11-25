import type { ValueSelector } from "../../dsl/types";
import type { NodeExecutor } from "../context";
import { renderTemplate, selectorKey } from "../variable-pool";

interface StartVariable {
  variable: string;
  label?: string;
  type?: string;
  required?: boolean;
  default?: unknown;
  options?: string[];
}

export const startNode: NodeExecutor = async ({ data, request, pool, trace }) => {
  const decls = (data.variables as StartVariable[] | undefined) ?? [];
  const given = request.inputs ?? {};
  trace.inputs = { "sys.query": request.query, ...given };

  const outputs: Record<string, unknown> = {};
  const missing: string[] = [];
  for (const v of decls) {
    let value = given[v.variable] ?? v.default ?? null;
    if (value === "") value = null;
    if (value != null && v.type === "number") value = Number(value);
    if (v.required && value == null) missing.push(v.label ?? v.variable);
    outputs[v.variable] = value;
  }
  trace.processData = {
    declared_variables: decls.map((v) => ({ variable: v.variable, type: v.type, required: !!v.required })),
    system_variables: pool.snapshot().sys ?? {},
  };
  if (missing.length) throw new Error(`필수 입력값이 비어 있습니다: ${missing.join(", ")}`);
  return { outputs: { ...outputs, "sys.query": request.query } };
};

export const answerNode: NodeExecutor = async ({ data, pool, trace }) => {
  const template = String(data.answer ?? "");
  const { text, refs } = renderTemplate(template, pool);
  trace.inputs = refs;
  trace.processData = { template };
  return { outputs: { answer: text }, answer: text };
};

export const endNode: NodeExecutor = async ({ data, pool, trace }) => {
  const decls = (data.outputs as { variable: string; value_selector: ValueSelector }[] | undefined) ?? [];
  const outputs: Record<string, unknown> = {};
  for (const d of decls) {
    const value = pool.get(d.value_selector) ?? null;
    trace.inputs[selectorKey(d.value_selector)] = value;
    outputs[d.variable] = value;
  }
  trace.processData = { mapping: decls.map((d) => ({ output: d.variable, from: selectorKey(d.value_selector) })) };
  return { outputs };
};

/** variable-aggregator(구 variable-assigner): 여러 분기 중 값이 있는 첫 변수를 하나로 모은다. */
export const variableAggregatorNode: NodeExecutor = async ({ data, pool, trace }) => {
  const pick = (selectors: ValueSelector[]) => {
    const candidates = selectors.map((s) => {
      const value = pool.get(s);
      trace.inputs[selectorKey(s)] = value ?? null;
      return { from: selectorKey(s), has_value: value != null };
    });
    const hit = selectors.find((s) => pool.get(s) != null);
    return { candidates, chosen: hit ? selectorKey(hit) : null, value: hit ? pool.get(hit) : null };
  };

  const adv = data.advanced_settings as
    | { group_enabled?: boolean; groups?: { group_name: string; variables: ValueSelector[] }[] }
    | undefined;
  if (adv?.group_enabled && adv.groups?.length) {
    const outputs: Record<string, unknown> = {};
    const groups: Record<string, unknown> = {};
    for (const g of adv.groups) {
      const r = pick(g.variables ?? []);
      outputs[g.group_name] = { output: r.value };
      groups[g.group_name] = { candidates: r.candidates, chosen: r.chosen };
    }
    trace.processData = { groups };
    return { outputs };
  }
  const r = pick((data.variables as ValueSelector[] | undefined) ?? []);
  trace.processData = { candidates: r.candidates, chosen: r.chosen };
  return { outputs: { output: r.value } };
};

/** assigner: 대화 변수(conversation.*)를 갱신한다. v1(write_mode)과 v2(items) 형식을 모두 읽는다. */
export const assignerNode: NodeExecutor = async ({ data, pool, trace }) => {
  type Item = { variable_selector: ValueSelector; operation: string; input_type?: string; value?: unknown };
  const items: Item[] = Array.isArray(data.items)
    ? (data.items as Item[])
    : [
        {
          variable_selector: data.assigned_variable_selector as ValueSelector,
          operation: String(data.write_mode ?? "over-write"),
          input_type: "variable",
          value: data.input_variable_selector,
        },
      ];

  const updates = [];
  for (const item of items) {
    const target = item.variable_selector ?? [];
    const [scope, name] = target;
    if (scope !== "conversation" || !name) throw new Error(`대화 변수만 할당할 수 있습니다: ${selectorKey(target)}`);
    const before = pool.get(target);
    const input =
      item.input_type === "constant" || !Array.isArray(item.value) ? item.value : pool.get(item.value as ValueSelector);
    if (item.input_type !== "constant" && Array.isArray(item.value)) trace.inputs[selectorKey(item.value as ValueSelector)] = input ?? null;

    let after: unknown;
    switch (item.operation) {
      case "clear":
        after = Array.isArray(before) ? [] : typeof before === "number" ? 0 : typeof before === "object" ? {} : "";
        break;
      case "append":
        after = [...(Array.isArray(before) ? before : []), input];
        break;
      case "extend":
        after = [...(Array.isArray(before) ? before : []), ...(Array.isArray(input) ? input : [input])];
        break;
      case "+=":
        after = Number(before ?? 0) + Number(input);
        break;
      case "-=":
        after = Number(before ?? 0) - Number(input);
        break;
      case "*=":
        after = Number(before ?? 0) * Number(input);
        break;
      case "/=":
        after = Number(before ?? 0) / Number(input);
        break;
      case "remove-first":
        after = Array.isArray(before) ? before.slice(1) : before;
        break;
      case "remove-last":
        after = Array.isArray(before) ? before.slice(0, -1) : before;
        break;
      default: // over-write, set
        after = input;
    }
    pool.setVar("conversation", name, after);
    updates.push({ variable: selectorKey(target), operation: item.operation, before: before ?? null, after });
  }
  trace.processData = { updates };
  return { outputs: {} };
};
