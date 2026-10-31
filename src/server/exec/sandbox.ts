// Runs project scripts in QuickJS compiled to WebAssembly. The guest gets a
// fresh runtime per run with memory, stack, time and output limits, and only the
// globals defined here: no network, no timers, no host filesystem, no modules.
// Project files are visible read-only; writes are staged and returned to the
// caller, which applies them through the normal file-save path (validation,
// revisions, permissions).
import { getQuickJS, shouldInterruptAfterDeadline, type QuickJSContext, type QuickJSHandle } from "quickjs-emscripten";

export const SANDBOX_LIMITS = {
  timeMs: 3000,
  memoryBytes: 64 * 1024 * 1024,
  stackBytes: 1024 * 1024,
  outputBytes: 64 * 1024,
  writes: 50,
  writeBytes: 1024 * 1024,
};

export type OutputLine = { stream: "out" | "err" | "info"; text: string };
export type SandboxResult = {
  ok: boolean;
  output: OutputLine[];
  /** Staged writes, in order; the last write to a path wins. */
  writes: Map<string, string>;
  durationMs: number;
  truncated: boolean;
  error?: string;
};
export type SandboxInput = {
  code: string;
  filename: string;
  /** "module" allows top-level await; "expr" prints the value of the last expression (REPL). */
  mode: "module" | "expr";
  files: Map<string, string>;
  args?: string[];
  allowWrites: boolean;
  project: { id: string; name: string };
  limits?: Partial<typeof SANDBOX_LIMITS>;
};

// Defines console and the `project` API on top of a few raw host functions.
const PRELUDE = `
(() => {
  const host = globalThis.__host; delete globalThis.__host;
  const fmt = (v) => {
    if (typeof v === "string") return v;
    if (v instanceof Error) return (v.stack ? v.name + ": " + v.message + "\\n" + v.stack : v.name + ": " + v.message).trim();
    if (typeof v === "function") return "[Function " + (v.name || "anonymous") + "]";
    if (typeof v === "undefined") return "undefined";
    if (typeof v === "bigint") return v + "n";
    try { const s = JSON.stringify(v, (k, x) => typeof x === "bigint" ? x + "n" : x, 2); return s === undefined ? String(v) : s; } catch { return String(v); }
  };
  const line = (stream) => (...a) => host.print(stream, a.map(fmt).join(" "));
  globalThis.console = Object.freeze({ log: line("out"), info: line("out"), debug: line("out"), warn: line("err"), error: line("err"), table: (rows) => host.print("out", fmt(rows)) });
  globalThis.__fmt = fmt;
  const project = {
    id: host.id, name: host.name, args: Object.freeze(JSON.parse(host.args)),
    files: (prefix) => JSON.parse(host.list(prefix ?? "")),
    exists: (path) => host.exists(String(path)),
    read: (path) => host.read(String(path)),
    readJson: (path) => JSON.parse(host.read(String(path))),
    write: (path, content) => { host.write(String(path), typeof content === "string" ? content : JSON.stringify(content, null, 2) + "\\n"); },
  };
  globalThis.project = Object.freeze(project);
  globalThis.args = project.args;
})();
`;

let modulePromise: ReturnType<typeof getQuickJS> | null = null;
const quickjs = () => (modulePromise ??= getQuickJS());

export async function runInSandbox(input: SandboxInput): Promise<SandboxResult> {
  const L = { ...SANDBOX_LIMITS, ...input.limits };
  const QuickJS = await quickjs();
  const started = performance.now();
  const output: OutputLine[] = [];
  const writes = new Map<string, string>();
  let outBytes = 0;
  let truncated = false;
  let writeBytes = 0;
  const print = (stream: OutputLine["stream"], text: string) => {
    if (truncated) return;
    const bytes = Buffer.byteLength(text, "utf8") + 1;
    if (outBytes + bytes > L.outputBytes) {
      truncated = true;
      output.push({ stream: "info", text: `… output truncated at ${L.outputBytes >= 1024 ? `${Math.round(L.outputBytes / 1024)} KB` : `${L.outputBytes} bytes`}` });
      return;
    }
    outBytes += bytes;
    output.push({ stream, text });
  };

  const runtime = QuickJS.newRuntime();
  runtime.setMemoryLimit(L.memoryBytes);
  runtime.setMaxStackSize(L.stackBytes);
  runtime.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + L.timeMs));
  const vm = runtime.newContext();
  let error: string | undefined;

  try {
    const host = vm.newObject();
    const fn = (name: string, impl: (...a: string[]) => QuickJSHandle | void) => {
      const h = vm.newFunction(name, (...handles) => {
        try {
          return impl(...handles.map((x) => (vm.typeof(x) === "undefined" ? "" : vm.getString(x))));
        } catch (e) {
          return { error: vm.newError((e as Error).message) };
        }
      });
      vm.setProp(host, name, h);
      h.dispose();
    };
    const str = (name: string, v: string) => vm.newString(v).consume((h) => vm.setProp(host, name, h));
    str("id", input.project.id);
    str("name", input.project.name);
    str("args", JSON.stringify(input.args ?? []));
    fn("print", (stream, text) => print(stream === "err" ? "err" : "out", text));
    fn("list", (prefix) => vm.newString(JSON.stringify([...new Set([...input.files.keys(), ...writes.keys()])].filter((p) => p.startsWith(prefix)).sort())));
    fn("exists", (path) => (writes.has(path) || input.files.has(path) ? vm.true : vm.false));
    fn("read", (path) => {
      const v = writes.get(path) ?? input.files.get(path);
      if (v === undefined) throw new Error(`No such file: ${path}`);
      return vm.newString(v);
    });
    fn("write", (path, content) => {
      if (!input.allowWrites) throw new Error("This run can't change files (you need code edit access)");
      if (!/^[A-Za-z0-9._@/-]{1,200}$/.test(path) || path.split("/").some((s) => !s || s === "." || s === "..")) throw new Error(`Invalid path: ${path}`);
      if (!writes.has(path) && writes.size >= L.writes) throw new Error(`A run can change at most ${L.writes} files`);
      writeBytes += Buffer.byteLength(content, "utf8");
      if (writeBytes > L.writeBytes * 4) throw new Error("Too much data written in one run");
      writes.set(path, content);
    });
    vm.setProp(vm.global, "__host", host);
    host.dispose();
    vm.unwrapResult(vm.evalCode(PRELUDE, "prelude.js")).dispose();

    const res = vm.evalCode(input.code, input.filename, { type: input.mode === "module" ? "module" : "global", strict: input.mode === "module" });
    if (res.error) {
      error = describe(vm, res.error);
      res.error.dispose();
    } else {
      // Settle promises (async functions, top-level await) within the same deadline.
      let value = res.value;
      for (let i = 0; i < 10_000; i++) {
        const jobs = runtime.executePendingJobs();
        if (jobs.error) {
          error = describe(vm, jobs.error);
          jobs.error.dispose();
          break;
        }
        if (jobs.value === 0) break;
      }
      if (!error && vm.typeof(value) === "object") {
        const state = vm.getPromiseState(value);
        if (state.type === "rejected") {
          error = describe(vm, state.error);
          state.error.dispose();
        } else if (state.type === "pending") {
          error = "The script is still waiting on a promise that never settles (there are no timers or network here).";
        } else if (!state.notAPromise) {
          value.dispose();
          value = state.value;
        }
      }
      if (!error && input.mode === "expr" && vm.typeof(value) !== "undefined") {
        const shown = vm.callFunction(vm.getProp(vm.global, "__fmt"), vm.undefined, value);
        if (shown.error) shown.error.dispose();
        else {
          print("out", vm.getString(shown.value));
          shown.value.dispose();
        }
      }
      value.dispose();
    }
  } catch (e) {
    error = (e as Error).message;
  } finally {
    try {
      vm.dispose();
      runtime.dispose();
    } catch {
      // A run that hit the memory limit can leave the runtime unable to free cleanly; it is discarded either way.
    }
  }
  if (error) output.push({ stream: "err", text: error });
  return { ok: !error, output, writes: error ? new Map() : writes, durationMs: Math.round(performance.now() - started), truncated, error };
}

function describe(vm: QuickJSContext, h: QuickJSHandle): string {
  const e = vm.dump(h) as { name?: string; message?: string; stack?: string } | string;
  if (typeof e !== "object" || !e) return `Uncaught ${String(e)}`;
  if (e.name === "InternalError" && e.message === "interrupted") return `Stopped: the script ran longer than its time limit`;
  if (e.name === "InternalError" && /out of memory/i.test(e.message ?? "")) return `Stopped: the script used more memory than allowed`;
  if (e.name === "RangeError" && /stack/i.test(e.message ?? "")) return `${e.name}: ${e.message} (call stack limit)`;
  const stack = (e.stack ?? "").split("\n").filter((l) => l.trim() && !l.includes("prelude.js")).join("\n");
  return `${e.name ?? "Error"}: ${e.message ?? ""}${stack ? `\n${stack}` : ""}`;
}
