"use client";

import { Component, type ReactNode } from "react";

/**
 * 한 영역(캔버스, 설정 패널)의 렌더링 오류가 화면 전체를 지우지 않게 막는다.
 * 문서(DSL)는 편집기 상태에 그대로 있으므로 '다시 그리기'로 돌아온다.
 */
export class ErrorBoundary extends Component<{ label: string; children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error(`[${this.props.label}] 렌더링 오류`, error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="m-4 rounded-lg border border-err/40 bg-err/6 p-3 text-[13px] leading-relaxed text-err">
        <div className="font-semibold">{this.props.label}을(를) 그리다가 오류가 났습니다.</div>
        <div className="mt-1 break-words font-mono text-[12px]">{this.state.error.message}</div>
        <div className="mt-1 text-ink-3">노드와 설정은 지워지지 않았습니다.</div>
        <button
          type="button"
          onClick={() => this.setState({ error: null })}
          className="mt-2 rounded-md border border-err/40 bg-surface px-2.5 py-1 text-[12px] font-medium text-err hover:bg-err/6"
        >
          다시 그리기
        </button>
      </div>
    );
  }
}
