import { spawn } from "node:child_process";
import vm from "node:vm";

/**
 * Code 노드 실행기.
 * - javascript: node:vm 컨텍스트에서 main(args) 실행 (3초 제한)
 * - python3: 로컬 python 인터프리터로 main(**args) 실행 (10초 제한)
 * 둘 다 보안 샌드박스가 아니다. 워크플로 작성자를 신뢰하는 로컬/사내 환경을 전제로 한다.
 */
export async function runCode(
  language: string,
  code: string,
  args: Record<string, unknown>,
): Promise<{ result: unknown; logs: string[] }> {
  if (language === "javascript") return runJavaScript(code, args);
  if (language === "python3" || language === "python") return runPython(code, args);
  throw new Error(`지원하지 않는 코드 언어: ${language}`);
}

async function runJavaScript(code: string, args: Record<string, unknown>) {
  const logs: string[] = [];
  const fmt = (xs: unknown[]) => xs.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ");
  const sandbox = {
    __args__: structuredClone(args),
    console: { log: (...xs: unknown[]) => logs.push(fmt(xs)), error: (...xs: unknown[]) => logs.push(`[error] ${fmt(xs)}`) },
    JSON,
    Math,
    Date,
  };
  const value = vm.runInNewContext(`${code}\n;main(__args__);`, sandbox, { timeout: 3000 });
  const result = await Promise.resolve(value);
  return { result: JSON.parse(JSON.stringify(result ?? null)), logs };
}

const PY_MARKER = "__DIFY_RESULT__";

function pythonCandidates() {
  if (process.env.PYTHON_BIN) return [process.env.PYTHON_BIN];
  return process.platform === "win32" ? ["python", "py", "python3"] : ["python3", "python"];
}

async function runPython(code: string, args: Record<string, unknown>) {
  const script = [
    "import json, sys",
    "__args = json.loads(sys.stdin.read())",
    code,
    `print("${PY_MARKER}" + json.dumps(main(**__args), ensure_ascii=False))`,
  ].join("\n");

  let lastError: Error | null = null;
  for (const bin of pythonCandidates()) {
    try {
      const { stdout, stderr, code: exitCode } = await spawnWithInput(bin, ["-c", script], JSON.stringify(args), 10_000);
      const lines = stdout.split(/\r?\n/);
      const resultLine = lines.find((l) => l.startsWith(PY_MARKER));
      const logs = lines.filter((l) => l && !l.startsWith(PY_MARKER));
      if (exitCode !== 0 || !resultLine) {
        throw new Error(stderr.trim().split("\n").slice(-4).join("\n") || `python 종료 코드 ${exitCode}`);
      }
      return { result: JSON.parse(resultLine.slice(PY_MARKER.length)), logs };
    } catch (e) {
      lastError = e as Error;
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
  }
  throw new Error(`python 인터프리터를 찾지 못했습니다 (PYTHON_BIN 환경변수로 지정 가능). ${lastError?.message ?? ""}`);
}

function spawnWithInput(bin: string, argv: string[], input: string, timeoutMs: number) {
  return new Promise<{ stdout: string; stderr: string; code: number | null }>((resolve, reject) => {
    const child = spawn(bin, argv, { env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`코드 실행 시간 초과 (${timeoutMs / 1000}초)`));
    }, timeoutMs);
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code });
    });
    child.stdin.end(input);
  });
}
