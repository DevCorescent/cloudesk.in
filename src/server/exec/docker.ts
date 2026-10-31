// Optional container runner for languages QuickJS can't run (Python, full Node).
// Off unless EXEC_DOCKER=on and the docker CLI answers. Each run gets a
// throwaway container: no network, read-only root, capped memory/CPU/PIDs, all
// capabilities dropped, an unprivileged user, and the project's files mounted
// read-only. Output is captured and capped; nothing is written back.
import { spawn as nodeSpawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { OutputLine } from "./sandbox";

export const DOCKER_LANGUAGES = {
  python: { image: () => process.env.EXEC_PYTHON_IMAGE || "python:3.12-alpine", cmd: (file: string, args: string[]) => ["python3", "-I", file, ...args], ext: /\.py$/ },
  node: { image: () => process.env.EXEC_NODE_IMAGE || "node:22-alpine", cmd: (file: string, args: string[]) => ["node", "--disallow-code-generation-from-strings", file, ...args], ext: /\.(m?js|cjs)$/ },
} as const;
export type DockerLanguage = keyof typeof DOCKER_LANGUAGES;

export const DOCKER_LIMITS = { timeMs: 20_000, memory: "256m", cpus: "1", pids: 64, outputBytes: 64 * 1024 };

type Spawn = (cmd: string, args: string[]) => { stdout: NodeJS.ReadableStream; stderr: NodeJS.ReadableStream; on(ev: "close", cb: (code: number | null) => void): void; on(ev: "error", cb: (e: Error) => void): void; kill(sig?: NodeJS.Signals): void };
let spawnImpl: Spawn = (cmd, args) => nodeSpawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
/** Test hook: replace the process spawner. */
export function setDockerSpawn(fn: Spawn | null) {
  spawnImpl = fn ?? ((cmd, args) => nodeSpawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] }));
  available = null;
}

let available: Promise<boolean> | null = null;
export function dockerAvailable(): Promise<boolean> {
  if (process.env.EXEC_DOCKER !== "on") return Promise.resolve(false);
  return (available ??= new Promise<boolean>((resolve) => {
    try {
      const p = spawnImpl("docker", ["version", "--format", "{{.Server.Version}}"]);
      const t = setTimeout(() => (p.kill("SIGKILL"), resolve(false)), 5000);
      p.on("error", () => (clearTimeout(t), resolve(false)));
      p.on("close", (code) => (clearTimeout(t), resolve(code === 0)));
    } catch {
      resolve(false);
    }
  }));
}

/** The exact `docker run` arguments; kept separate so the isolation flags are testable. */
export function dockerArgs(language: DockerLanguage, workDir: string, file: string, args: string[], name: string) {
  const L = DOCKER_LANGUAGES[language];
  return [
    "run", "--rm", "--name", name,
    "--network", "none",
    "--read-only",
    "--tmpfs", "/tmp:rw,noexec,nosuid,size=16m",
    "--memory", DOCKER_LIMITS.memory, "--memory-swap", DOCKER_LIMITS.memory,
    "--cpus", DOCKER_LIMITS.cpus,
    "--pids-limit", String(DOCKER_LIMITS.pids),
    "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges",
    "--user", "65534:65534",
    "--env", "HOME=/tmp",
    "-v", `${workDir}:/work:ro`,
    "-w", "/work",
    L.image(),
    ...L.cmd(file, args),
  ];
}

export async function runInDocker(input: { language: DockerLanguage; file: string; args: string[]; files: Map<string, string> }): Promise<{ ok: boolean; exitCode: number; output: OutputLine[]; durationMs: number; truncated: boolean }> {
  const started = performance.now();
  const dir = await mkdtemp(join(tmpdir(), "cc-exec-"));
  const output: OutputLine[] = [];
  let bytes = 0;
  let truncated = false;
  try {
    for (const [path, content] of input.files) {
      const dest = join(dir, path);
      if (!dest.startsWith(dir + "/")) continue;
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, content, { mode: 0o644 });
    }
    const name = `cc-exec-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const p = spawnImpl("docker", dockerArgs(input.language, dir, input.file, input.args, name));
    const collect = (stream: "out" | "err") => (chunk: Buffer | string) => {
      if (truncated) return;
      const text = chunk.toString();
      bytes += Buffer.byteLength(text);
      if (bytes > DOCKER_LIMITS.outputBytes) {
        truncated = true;
        output.push({ stream: "info", text: `… output truncated at ${DOCKER_LIMITS.outputBytes / 1024} KB` });
        return;
      }
      const last = output.at(-1);
      // Merge chunks of the same stream; split into lines at the end.
      if (last && last.stream === stream && !last.text.endsWith("\n")) last.text += text;
      else output.push({ stream, text });
    };
    p.stdout.on("data", collect("out"));
    p.stderr.on("data", collect("err"));
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      p.kill("SIGKILL");
      // The CLI dying doesn't stop the container; remove it by name.
      spawnImpl("docker", ["rm", "-f", name]);
    }, DOCKER_LIMITS.timeMs);
    const exitCode = await new Promise<number>((resolve) => {
      p.on("error", (e) => {
        output.push({ stream: "err", text: `Couldn't start docker: ${e.message}` });
        resolve(127);
      });
      p.on("close", (code) => resolve(code ?? 137));
    });
    clearTimeout(timer);
    if (timedOut) output.push({ stream: "err", text: `Stopped: the program ran longer than ${DOCKER_LIMITS.timeMs / 1000} s` });
    else if (exitCode === 137) output.push({ stream: "err", text: "Stopped: the program was killed (most often for using more than 256 MB of memory)" });
    const lines = output.flatMap((l) => l.text.replace(/\n$/, "").split("\n").map((text) => ({ stream: l.stream, text })));
    return { ok: exitCode === 0 && !timedOut, exitCode: timedOut ? 124 : exitCode, output: lines, durationMs: Math.round(performance.now() - started), truncated };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
