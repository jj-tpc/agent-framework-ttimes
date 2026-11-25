import { isMemoryBlock, readMemory } from "../dsl/memory";
import type { Workflow } from "../dsl/types";
import { runBuiltin, runCustom } from "./builtin";
import { BUILTIN_TOOLS, MEMORY_TOOL, objectSchema, readMemoryCommands, readTools, safeToolName, type ToolCall, type ToolDef, type ToolOutput } from "./config";
import { connectorTool } from "./connector-catalog";
import { runGoogleTool } from "./connectors/google";
import { openMcp } from "./mcp";
import { memoryToolDef, runMemoryTool } from "./memory-tool";
import { sanitize } from "./sanitize";
import { openSkills } from "./skills";

/** LLM 노드 한 번의 실행에 쓸 도구 묶음 */
export interface Toolset {
  defs: ToolDef[];
  maxSteps: number;
  /** 쌓인 도구 결과를 비우기 시작하는 글자 수(0 이면 안 비움) */
  compactAfter: number;
  /** 공급자가 서버에서 실행하는 도구 (web_search) */
  providerTools: string[];
  /** 시스템 프롬프트에 덧붙일 글(스킬 목록) */
  systemAdditions: string[];
  run: (call: ToolCall) => Promise<ToolOutput>;
  /** 도구 이름 → 온 곳 */
  sourceOf: (name: string) => string;
  /** 실행 기록에 남길 요약 */
  summary: Record<string, unknown>;
  close: () => Promise<void>;
}

interface Options {
  data: Record<string, unknown>;
  workflow: Workflow;
  /** 붙어 있는 메모리 모듈의 블록 ID */
  memoryModuleId: string | null;
  memoryScope: string;
  conversationId?: string;
  signal: AbortSignal;
}

/** 결과가 이 앱 밖에서 온 글인 도구 — 정화하고, 그 뒤에 쓰는 기억에는 표시를 남긴다 */
const isExternal = (source: string, name: string) => source.startsWith("mcp:") || source.startsWith("connector:") || (source === "builtin" && name === "web_fetch");

/**
 * LLM 노드의 도구 설정 + 붙어 있는 메모리 모듈에서 도구를 모은다. 도구가 하나도 없으면 null.
 * 이름이 겹치면 먼저 나온 것이 이긴다(메모리 → 내장 → 직접 만든 도구 → 커넥터 → 스킬 → MCP).
 */
export async function buildToolset(o: Options): Promise<Toolset | null> {
  const cfg = readTools(o.data);
  const defs: ToolDef[] = [];
  const runners = new Map<string, { source: string; run: (input: unknown) => Promise<ToolOutput> }>();
  const notes: string[] = [];
  /** 이번 LLM 실행에서 외부 자료를 본 적이 있는지 */
  let sawExternal = false;
  const cleaned = { invisible: 0, markup: 0 };
  const add = (def: ToolDef, source: string, run: (input: unknown) => Promise<ToolOutput>) => {
    if (runners.has(def.name)) return void notes.push(`이름이 겹쳐 뺀 도구: ${def.name} (${source})`);
    defs.push(def);
    runners.set(def.name, { source, run });
  };

  // 1) 메모리 모듈 안에 '메모리 도구' 노드가 있으면 — 도구 설정을 켜지 않아도 붙는다
  const block = o.memoryModuleId ? o.workflow.nodes.find((n) => n.id === o.memoryModuleId) : null;
  const toolNode = block ? o.workflow.nodes.find((n) => n.parentId === block.id && n.data.type === MEMORY_TOOL) : null;
  let memory: Record<string, unknown> | undefined;
  if (block && isMemoryBlock(block) && toolNode) {
    const commands = readMemoryCommands(toolNode.data as Record<string, unknown>);
    if (commands.length) {
      const target = { scope: o.memoryScope, store: readMemory(block).store, commands, conversationId: o.conversationId, sawExternal: () => sawExternal };
      add(memoryToolDef(commands), `memory:${String(block.data.title ?? block.id)}`, (input) => runMemoryTool(target, input));
      memory = { module: block.data.title, store: target.store, commands };
    }
  }

  const systemAdditions: string[] = [];
  let closeMcp: (() => Promise<void>) | null = null;
  let skills: Record<string, unknown> | undefined;
  let mcp: unknown;
  if (cfg.enabled) {
    for (const name of cfg.builtin) {
      const def = BUILTIN_TOOLS.find((t) => t.name === name);
      if (!def) notes.push(`모르는 내장 도구: ${name}`);
      else add({ name: def.name, description: def.description, parameters: def.parameters }, "builtin", (input) => runBuiltin(name, input, o.signal, { scope: o.memoryScope, conversationId: o.conversationId }));
    }
    for (const tool of cfg.custom) {
      if (!tool.name.trim()) continue;
      try {
        add({ name: safeToolName(tool.name), description: tool.description || tool.name, parameters: objectSchema(tool.parameters) }, "custom", (input) => runCustom(tool, input));
      } catch (e) {
        notes.push(`도구 '${tool.name}': ${(e as Error).message}`);
      }
    }
    // 커넥터: 메일·문서 내용은 남이 쓴 글이므로 결과를 외부 자료로 다룬다(정화 · 출처 표시)
    for (const name of cfg.connectors) {
      const def = connectorTool(name);
      if (!def) notes.push(`모르는 커넥터 도구: ${name}`);
      else add({ name: def.name, description: def.description, parameters: def.parameters }, "connector:google", (input) => runGoogleTool(name, input, o.signal));
    }
    const [skillSet, session] = await Promise.all([openSkills(cfg.skills), openMcp(cfg.mcp)]);
    if (skillSet) {
      if (skillSet.prompt) systemAdditions.push(skillSet.prompt);
      for (const def of skillSet.defs) add(def, "skill", (input) => skillSet.run(def.name, input));
      skills = { available: skillSet.available.map((s) => s.id), ...(skillSet.missing.length ? { missing: skillSet.missing } : {}) };
    }
    if (session) {
      closeMcp = session.close;
      for (const def of session.defs) add(def, `mcp:${session.origin.get(def.name)?.server ?? ""}`, (input) => session.run(def.name, input, o.signal));
      mcp = session.status;
    }
  }

  const providerTools = cfg.enabled ? cfg.provider : [];
  if (!defs.length && !providerTools.length) {
    await closeMcp?.();
    // 도구를 켰는데 하나도 못 모았으면(서버 연결 실패 등) 이유를 기록에 남긴다
    if (!cfg.enabled || (!notes.length && !mcp && !skills)) return null;
  }
  const summary: Record<string, unknown> = {
    max_steps: cfg.max_steps,
    compact_after: cfg.compact_after,
    available: [...defs.map((d) => ({ name: d.name, source: runners.get(d.name)?.source })), ...providerTools.map((name) => ({ name, source: "provider" }))],
    ...(memory ? { memory } : {}),
    ...(skills ? { skills } : {}),
    ...(mcp ? { mcp } : {}),
    ...(notes.length ? { notes } : {}),
  };
  return {
    defs,
    maxSteps: cfg.max_steps,
    systemAdditions,
    compactAfter: cfg.compact_after,
    providerTools,
    run: async (call) => {
      const r = runners.get(call.name);
      if (!r) return { output: `없는 도구입니다: ${call.name}. 쓸 수 있는 도구: ${defs.map((d) => d.name).join(", ")}`, isError: true };
      if (!isExternal(r.source, call.name)) return r.run(call.input);
      // 외부 자료: 받기 전에 표시를 세워, 같은 왕복에서 함께 실행되는 메모리 쓰기도 '외부 자료를 본 뒤'로 남긴다
      sawExternal = true;
      summary.saw_external = true;
      const out = await r.run(call.input);
      const s = sanitize(out.output);
      cleaned.invisible += s.invisible;
      cleaned.markup += s.markup;
      if (s.invisible || s.markup) summary.sanitized = { ...cleaned };
      return { ...out, output: s.text };
    },
    sourceOf: (name) => runners.get(name)?.source ?? (providerTools.includes(name) ? "provider" : "unknown"),
    summary,
    close: async () => {
      await closeMcp?.();
    },
  };
}
