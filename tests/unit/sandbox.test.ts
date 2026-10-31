import { describe, expect, it } from "vitest";
import { runInSandbox, type SandboxInput } from "@/server/exec/sandbox";

const base = (code: string, extra: Partial<SandboxInput> = {}): SandboxInput => ({ code, filename: "scripts/t.js", mode: "module", files: new Map([["site/site.json", '{"pages":[{"slug":"/"}]}'], ["content/a.md", "# Hello"]]), allowWrites: true, project: { id: "p1", name: "Demo" }, ...extra });
const text = (r: { output: { text: string }[] }) => r.output.map((l) => l.text).join("\n");

describe("QuickJS sandbox", () => {
  it("runs code, formats console output and exposes project files", async () => {
    const r = await runInSandbox(base(`console.log("hi", 1 + 1, { a: [1] }); const s = project.readJson("site/site.json"); console.log(s.pages.length, project.files("content/"), args);`, { args: ["--x"] }));
    expect(r.ok).toBe(true);
    expect(text(r)).toBe('hi 2 {\n  "a": [\n    1\n  ]\n}\n1 [\n  "content/a.md"\n] [\n  "--x"\n]');
  });

  it("supports async code and top-level await, and stages writes", async () => {
    const r = await runInSandbox(base(`const n = await Promise.resolve(project.read("content/a.md").length); project.write("content/out.md", "len " + n); console.log(project.read("content/out.md"), project.exists("content/out.md"));`));
    expect(text(r)).toBe("len 7 true");
    expect([...r.writes]).toEqual([["content/out.md", "len 7"]]);
  });

  it("evaluates expressions in REPL mode", async () => {
    expect(text(await runInSandbox(base(`[1,2,3].map(x => x * 2)`, { mode: "expr" })))).toBe("[\n  2,\n  4,\n  6\n]");
    expect(text(await runInSandbox(base(`Promise.resolve("done")`, { mode: "expr" })))).toBe("done");
  });

  it("has no network, timers, modules or host access", async () => {
    const r = await runInSandbox(base(`console.log(typeof fetch, typeof setTimeout, typeof require, typeof process, typeof XMLHttpRequest, typeof WebAssembly)`));
    expect(text(r)).toBe("undefined undefined undefined undefined undefined undefined");
    const imp = await runInSandbox(base(`import fs from "fs"; console.log(fs)`));
    expect(imp.ok).toBe(false);
  });

  it("stops infinite loops, runaway memory and deep recursion", async () => {
    const loop = await runInSandbox(base(`while (true) {}`, { limits: { timeMs: 300 } }));
    expect(loop.error).toBe("Stopped: the script ran longer than its time limit");
    expect(loop.durationMs).toBeLessThan(2000);
    const mem = await runInSandbox(base(`const a = []; while (true) a.push(new Array(1e5).fill(a.length));`, { limits: { memoryBytes: 8 * 1024 * 1024 } }));
    expect(mem.ok).toBe(false);
    expect(mem.error).toMatch(/memory/);
    const rec = await runInSandbox(base(`function f() { return f() + 1 } f()`));
    expect(rec.ok).toBe(false);
  });

  it("caps output, refuses writes without permission and discards writes on failure", async () => {
    const big = await runInSandbox(base(`for (let i = 0; i < 10000; i++) console.log("line " + i)`, { limits: { outputBytes: 1000 } }));
    expect(big.truncated).toBe(true);
    expect(big.output.at(-1)!.text).toMatch(/truncated/);
    const ro = await runInSandbox(base(`project.write("a.txt", "x")`, { allowWrites: false }));
    expect(ro.error).toMatch(/can't change files/);
    const fail = await runInSandbox(base(`project.write("a.txt", "x"); throw new Error("boom")`));
    expect(fail.writes.size).toBe(0);
    expect(fail.error).toMatch(/^Error: boom/);
    const bad = await runInSandbox(base(`project.write("../etc/passwd", "x")`));
    expect(bad.error).toMatch(/Invalid path/);
  });

  it("reports a promise that never settles", async () => {
    const r = await runInSandbox(base(`await new Promise(() => {})`));
    expect(r.error).toMatch(/never settles/);
  });
});
