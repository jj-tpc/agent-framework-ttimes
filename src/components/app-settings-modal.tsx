"use client";

import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { updateApp, updateWorkflowField } from "@/lib/dsl/edit";
import type { DslDoc } from "@/lib/dsl/types";
import { Button, Field, Modal, inputCls } from "./ui";

type Rec = Record<string, unknown>;
interface VarDecl {
  name: string;
  value: string;
  value_type: string;
}

const ICONS = ["🤖", "🎧", "📰", "🧭", "💬", "🛒", "📚", "🧪", "⚖️", "🏥", "💼", "✨"];

function VarRows({ list, onChange, addLabel }: { list: VarDecl[]; onChange: (l: VarDecl[]) => void; addLabel: string }) {
  return (
    <div className="space-y-1.5">
      {list.map((v, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <input
            value={v.name}
            onChange={(e) => onChange(list.map((x, j) => (j === i ? { ...x, name: e.target.value.replace(/[^\w]/g, "") } : x)))}
            placeholder="이름"
            className={`${inputCls} !w-36 font-mono`}
          />
          <select value={v.value_type} onChange={(e) => onChange(list.map((x, j) => (j === i ? { ...x, value_type: e.target.value } : x)))} className={`${inputCls} !w-24`}>
            <option value="string">string</option>
            <option value="number">number</option>
          </select>
          <input value={v.value} onChange={(e) => onChange(list.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} placeholder="값" className={inputCls} />
          <button type="button" onClick={() => onChange(list.filter((_, j) => j !== i))} className="rounded p-1 text-ink-4 hover:text-err" aria-label="삭제">
            <Trash2 size={14} />
          </button>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...list, { name: "", value: "", value_type: "string" }])} className="inline-flex items-center gap-1 text-[12px] font-medium text-accent hover:underline">
        <Plus size={12} />
        {addLabel}
      </button>
    </div>
  );
}

function toDecls(v: unknown): VarDecl[] {
  return ((v as Rec[]) ?? []).map((x) => ({
    name: String(x.name ?? x.variable ?? ""),
    value: x.value == null ? "" : String(x.value),
    value_type: String(x.value_type ?? "string"),
  }));
}
function fromDecls(list: VarDecl[]) {
  return list
    .filter((v) => v.name)
    .map((v) => ({ name: v.name, value_type: v.value_type, value: v.value_type === "number" ? Number(v.value) || 0 : v.value }));
}

export function AppSettingsModal({ doc, onClose, onSave }: { doc: DslDoc; onClose: () => void; onSave: (doc: DslDoc) => void }) {
  const app = (doc.app ?? {}) as Rec;
  const workflow = (doc.workflow ?? {}) as Rec;
  const features = (workflow.features ?? {}) as Rec;
  const [name, setName] = useState(String(app.name ?? ""));
  const [icon, setIcon] = useState(String(app.icon ?? "🤖"));
  const [description, setDescription] = useState(String(app.description ?? ""));
  const [opening, setOpening] = useState(String(features.opening_statement ?? ""));
  const [questions, setQuestions] = useState(((features.suggested_questions as string[]) ?? []).join("\n"));
  const [env, setEnv] = useState(toDecls(workflow.environment_variables));
  const [conv, setConv] = useState(toDecls(workflow.conversation_variables));

  const save = () => {
    let next = updateApp(doc, { name: name.trim() || "이름 없는 프로젝트", icon, description });
    next = updateWorkflowField(next, "features", {
      ...features,
      opening_statement: opening,
      suggested_questions: questions.split("\n").map((q) => q.trim()).filter(Boolean),
    });
    next = updateWorkflowField(next, "environment_variables", fromDecls(env));
    next = updateWorkflowField(next, "conversation_variables", fromDecls(conv));
    onSave(next);
    onClose();
  };

  return (
    <Modal
      title="앱 설정"
      onClose={onClose}
      footer={
        <>
          <Button kind="ghost" onClick={onClose}>
            취소
          </Button>
          <Button kind="primary" onClick={save}>
            적용
          </Button>
        </>
      }
    >
      <div className="space-y-5 px-5 py-4">
        <div className="grid grid-cols-[auto_1fr] gap-3">
          <Field label="아이콘">
            <select value={icon} onChange={(e) => setIcon(e.target.value)} className={`${inputCls} !w-16 text-lg`}>
              {[...new Set([icon, ...ICONS])].map((i) => (
                <option key={i}>{i}</option>
              ))}
            </select>
          </Field>
          <Field label="이름">
            <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
          </Field>
        </div>
        <Field label="설명">
          <input value={description} onChange={(e) => setDescription(e.target.value)} className={inputCls} />
        </Field>
        <Field label="시작 인사말">
          <textarea value={opening} onChange={(e) => setOpening(e.target.value)} rows={2} className={inputCls} />
        </Field>
        <Field label="예시 질문" hint="한 줄에 하나씩 적습니다." help="채팅에서 누르면 바로 전송됩니다.">
          <textarea value={questions} onChange={(e) => setQuestions(e.target.value)} rows={4} className={inputCls} />
        </Field>
        <Field label="환경 변수 (env.*)" hint="비밀값은 넣지 마세요 — DSL 내보내기에 포함됩니다." help="모든 노드에서 {{#env.이름#}}으로 참조합니다.">
          <VarRows list={env} onChange={setEnv} addLabel="환경 변수 추가" />
        </Field>
        <Field label="대화 변수 (conversation.*)" help="한 대화 동안 유지되는 값입니다. 변수 할당 노드로 갱신합니다.">
          <VarRows list={conv} onChange={setConv} addLabel="대화 변수 추가" />
        </Field>
      </div>
    </Modal>
  );
}
