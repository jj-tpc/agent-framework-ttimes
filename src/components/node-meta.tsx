import {
  BookOpenText,
  Braces,
  Brain,
  CircleQuestionMark,
  Database,
  Flag,
  GitBranch,
  Globe,
  LayoutTemplate,
  Merge,
  MessageSquareText,
  PencilLine,
  Play,
  ScanText,
  Signpost,
  Sparkles,
  Split,
  SquareDashed,
  Wrench,
  type LucideIcon,
} from "lucide-react";

export interface NodeMeta {
  label: string;
  color: string;
  icon: LucideIcon;
}

const META: Record<string, NodeMeta> = {
  start: { label: "시작", color: "#2563eb", icon: Play },
  answer: { label: "답변", color: "#d97706", icon: MessageSquareText },
  end: { label: "종료", color: "#d97706", icon: Flag },
  llm: { label: "LLM", color: "#6d4aff", icon: Sparkles },
  "knowledge-retrieval": { label: "지식 검색", color: "#059669", icon: BookOpenText },
  "question-classifier": { label: "질문 분류기", color: "#15803d", icon: Split },
  "parameter-extractor": { label: "파라미터 추출", color: "#0d9488", icon: ScanText },
  "if-else": { label: "IF / ELSE", color: "#0891b2", icon: GitBranch },
  switch: { label: "분기", color: "#ea580c", icon: Signpost },
  code: { label: "코드", color: "#0369a1", icon: Braces },
  "template-transform": { label: "템플릿", color: "#7c3aed", icon: LayoutTemplate },
  "http-request": { label: "HTTP 요청", color: "#9333ea", icon: Globe },
  "variable-aggregator": { label: "변수 집계", color: "#4f46e5", icon: Merge },
  "variable-assigner": { label: "변수 할당", color: "#4f46e5", icon: Merge },
  assigner: { label: "변수 할당", color: "#db2777", icon: PencilLine },
  "memory-store": { label: "메모리 저장소", color: "#be185d", icon: Database },
  "memory-tool": { label: "메모리 도구", color: "#4338ca", icon: Wrench },
  memory: { label: "메모리 모듈", color: "#be185d", icon: Brain },
  "memory-read": { label: "메모리 읽기", color: "#be185d", icon: Brain },
  "memory-read-end": { label: "메모리 읽기 끝", color: "#be185d", icon: Brain },
  "memory-write": { label: "메모리 쓰기", color: "#be185d", icon: Brain },
  "memory-write-end": { label: "메모리 쓰기 끝", color: "#be185d", icon: Brain },
  block: { label: "블록", color: "#52525b", icon: SquareDashed },
  "block-exit": { label: "블록 종료", color: "#52525b", icon: SquareDashed },
};

export function nodeMeta(type: string): NodeMeta {
  return META[type] ?? { label: type, color: "#64748b", icon: CircleQuestionMark };
}

export function NodeIcon({ type, size = 26 }: { type: string; size?: number }) {
  const meta = nodeMeta(type);
  const Icon = meta.icon;
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-md text-white"
      style={{ background: meta.color, width: size, height: size }}
    >
      <Icon size={Math.round(size * 0.58)} strokeWidth={2.2} />
    </span>
  );
}
