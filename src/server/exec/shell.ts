// The IDE terminal. A small command language over the project's files — not a
// system shell: there is no host process, no PATH and no pipes. Commands run as
// built-ins, in the QuickJS sandbox, or (when enabled) in a locked-down container.
import { desc, eq, and } from "drizzle-orm";
import { db, schema } from "@/db";
import { parseSiteDoc, SITE_DOC_PATH } from "@/lib/site/model";
import { ApiError } from "../http/errors";
import { createFile, normalizePath, permissionForPath, readAllFiles, writeFile } from "../services/files";
import type { Permission } from "../authz/permissions";
import { DOCKER_LANGUAGES, dockerAvailable, runInDocker, type DockerLanguage } from "./docker";
import { runInSandbox, SANDBOX_LIMITS, type OutputLine } from "./sandbox";

export const MAX_COMMAND = 4000;
export type ExecResult = { exitCode: number; output: OutputLine[]; changed: string[]; durationMs: number; runtime: "builtin" | "quickjs" | "docker" };

/** Splits a command line like a POSIX shell would for quoting (no expansion). */
export function tokenize(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quote: '"' | "'" | null = null;
  let has = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === quote) quote = null;
      else if (c === "\\" && quote === '"' && i + 1 < line.length && /["\\$`]/.test(line[i + 1])) cur += line[++i];
      else cur += c;
    } else if (c === '"' || c === "'") {
      quote = c;
      has = true;
    } else if (c === "\\" && i + 1 < line.length) {
      cur += line[++i];
      has = true;
    } else if (/\s/.test(c)) {
      if (has || cur) out.push(cur);
      cur = "";
      has = false;
    } else {
      cur += c;
      has = true;
    }
  }
  if (quote) throw new ApiError("validation_failed", "Unclosed quote");
  if (has || cur) out.push(cur);
  return out;
}

export const HELP = [
  "Commands",
  "  ls [dir]                 list files",
  "  cat <file>               print a file",
  "  grep <text> [dir]        find lines containing text (case-insensitive)",
  "  wc <file>                count lines, words and bytes",
  "  validate                 check site/site.json against the site schema",
  "  run <file.js> [args…]    run a script in the JavaScript sandbox",
  "  js <code>                evaluate JavaScript and print the result",
  "  python <file.py> [args…] run Python in a container (when enabled)",
  "  node <file.js> [args…]   run full Node.js in a container (when enabled)",
  "  history · clear · help",
  "",
  "Scripts get `project.read(path)`, `project.readJson(path)`, `project.files(prefix)`,",
  "`project.exists(path)`, `project.write(path, text|object)` and `args`. Writes are",
  "saved as new file revisions when the script finishes without an error.",
  `Limits: ${SANDBOX_LIMITS.timeMs / 1000} s, ${SANDBOX_LIMITS.memoryBytes / 1024 / 1024} MB memory, ${SANDBOX_LIMITS.outputBytes / 1024} KB output, no network or timers.`,
].join("\n");

const lines = (stream: OutputLine["stream"], text: string): OutputLine[] => text.split("\n").map((t) => ({ stream, text: t }));
const fail = (text: string, exitCode = 1): Omit<ExecResult, "durationMs" | "runtime"> => ({ exitCode, output: lines("err", text), changed: [] });

type Ctx = { projectId: string; projectName: string; userId: string; can: (p: Permission) => boolean };

export async function execute(ctx: Ctx, command: string): Promise<ExecResult> {
  const started = performance.now();
  const argv = tokenize(command.slice(0, MAX_COMMAND));
  const [cmd, ...rest] = argv;
  let runtime: ExecResult["runtime"] = "builtin";
  let r: Omit<ExecResult, "durationMs" | "runtime">;
  const files = async () => new Map((await readAllFiles(ctx.projectId)).map((f) => [f.path, f.content] as const));
  switch (cmd) {
    case undefined:
      r = { exitCode: 0, output: [], changed: [] };
      break;
    case "help":
      r = { exitCode: 0, output: lines("out", HELP), changed: [] };
      break;
    case "ls": {
      const dir = rest[0] ? normalizePath(rest[0]).replace(/\/?$/, "/") : "";
      const all = [...(await files()).keys()].filter((p) => p.startsWith(dir));
      if (rest[0] && !all.length) {
        r = fail(`ls: ${rest[0]}: no such directory`);
        break;
      }
      // One level, like ls: files and sub-directories.
      const entries = [...new Set(all.map((p) => { const tail = p.slice(dir.length); const i = tail.indexOf("/"); return i < 0 ? tail : tail.slice(0, i + 1); }))].sort((a, b) => Number(b.endsWith("/")) - Number(a.endsWith("/")) || a.localeCompare(b));
      r = { exitCode: 0, output: entries.map((text) => ({ stream: "out", text })), changed: [] };
      break;
    }
    case "cat": {
      if (!rest[0]) {
        r = fail("usage: cat <file>", 2);
        break;
      }
      const all = await files();
      const out: OutputLine[] = [];
      let code = 0;
      for (const p of rest) {
        const c = all.get(normalizePath(p));
        if (c === undefined) {
          out.push({ stream: "err", text: `cat: ${p}: no such file` });
          code = 1;
        } else out.push(...lines("out", c.length > 200_000 ? `${c.slice(0, 200_000)}\n… (${c.length - 200_000} more characters)` : c.replace(/\n$/, "")));
      }
      r = { exitCode: code, output: out, changed: [] };
      break;
    }
    case "wc": {
      const c = rest[0] ? (await files()).get(normalizePath(rest[0])) : undefined;
      if (c === undefined) {
        r = fail(rest[0] ? `wc: ${rest[0]}: no such file` : "usage: wc <file>");
        break;
      }
      r = { exitCode: 0, output: [{ stream: "out", text: `${c.split("\n").length - (c.endsWith("\n") ? 1 : 0)} lines  ${c.split(/\s+/).filter(Boolean).length} words  ${Buffer.byteLength(c)} bytes  ${rest[0]}` }], changed: [] };
      break;
    }
    case "grep": {
      const [needle, dir] = rest;
      if (!needle) {
        r = fail("usage: grep <text> [dir]", 2);
        break;
      }
      const prefix = dir ? normalizePath(dir) : "";
      const n = needle.toLowerCase();
      const out: OutputLine[] = [];
      for (const [p, c] of await files()) {
        if (prefix && !p.startsWith(prefix)) continue;
        c.split("\n").forEach((l, i) => {
          if (out.length < 500 && l.toLowerCase().includes(n)) out.push({ stream: "out", text: `${p}:${i + 1}: ${l.trim().slice(0, 240)}` });
        });
      }
      if (out.length >= 500) out.push({ stream: "info", text: "… stopped at 500 matches" });
      r = { exitCode: out.length ? 0 : 1, output: out, changed: [] };
      break;
    }
    case "validate": {
      const c = (await files()).get(SITE_DOC_PATH);
      if (c === undefined) {
        r = fail(`${SITE_DOC_PATH} not found`);
        break;
      }
      const v = parseSiteDoc(c);
      r = v.ok ? { exitCode: 0, output: [{ stream: "out", text: `✓ ${SITE_DOC_PATH} is valid · ${v.doc.pages.length} pages` }], changed: [] } : { exitCode: 1, output: v.errors.slice(0, 100).map((text) => ({ stream: "err", text })), changed: [] };
      break;
    }
    case "run":
    case "js": {
      if (!ctx.can("code:write")) {
        r = fail("Running code needs code edit access on this project");
        break;
      }
      runtime = "quickjs";
      const all = await files();
      let code: string;
      let filename: string;
      let args: string[] = [];
      if (cmd === "js") {
        code = command.trim().replace(/^js\s+/, "");
        filename = "repl.js";
        if (code === "js" || !code) {
          r = fail("usage: js <code>", 2);
          break;
        }
      } else {
        if (!rest[0]) {
          r = fail("usage: run <file.js> [args…]", 2);
          break;
        }
        filename = normalizePath(rest[0]);
        args = rest.slice(1);
        const src = all.get(filename);
        if (src === undefined) {
          r = fail(`run: ${rest[0]}: no such file`);
          break;
        }
        if (!/\.(m?js)$/.test(filename)) {
          r = fail(`run: only JavaScript files run in the sandbox${/\.py$/.test(filename) ? " — try: python " + filename : ""}`);
          break;
        }
        code = src;
      }
      const res = await runInSandbox({ code, filename, mode: cmd === "js" ? "expr" : "module", files: all, args, allowWrites: true, project: { id: ctx.projectId, name: ctx.projectName } });
      const out = [...res.output];
      const changed: string[] = [];
      if (res.ok && res.writes.size) {
        const current = await readAllFiles(ctx.projectId);
        for (const [rawPath, content] of res.writes) {
          try {
            const path = normalizePath(rawPath);
            if (!ctx.can(permissionForPath(path))) throw new ApiError("forbidden", "you don't have permission to edit this file");
            const existing = current.find((f) => f.path === path);
            const author = { userId: ctx.userId, source: "user" as const, message: `Script: ${filename}` };
            if (existing) {
              if (existing.content === content) continue;
              await writeFile(ctx.projectId, path, content, existing.revision, author);
            } else await createFile(ctx.projectId, path, content, author);
            changed.push(path);
          } catch (e) {
            out.push({ stream: "err", text: `write ${rawPath}: ${(e as Error).message}` });
          }
        }
        if (changed.length) out.push({ stream: "info", text: `Saved ${changed.length} file${changed.length === 1 ? "" : "s"}: ${changed.join(", ")}` });
      }
      r = { exitCode: res.ok && out.every((l) => !l.text.startsWith("write ")) ? 0 : 1, output: out, changed };
      break;
    }
    case "python":
    case "node": {
      if (!ctx.can("code:write")) {
        r = fail("Running code needs code edit access on this project");
        break;
      }
      const lang = cmd as DockerLanguage;
      if (!(await dockerAvailable())) {
        r = fail(
          cmd === "node"
            ? "Full Node.js runs in a container, which isn't enabled on this server (EXEC_DOCKER=on with Docker installed). For JavaScript, use: run <file.js>"
            : "Python runs in a container, which isn't enabled on this server. An administrator can enable it with EXEC_DOCKER=on on a host with Docker installed.",
        );
        break;
      }
      const file = rest[0] ? normalizePath(rest[0]) : "";
      const all = await files();
      if (!file || !all.has(file) || !DOCKER_LANGUAGES[lang].ext.test(file)) {
        r = fail(`usage: ${cmd} <file${lang === "python" ? ".py" : ".js"}> [args…]`, 2);
        break;
      }
      runtime = "docker";
      const res = await runInDocker({ language: lang, file, args: rest.slice(1), files: all });
      r = { exitCode: res.exitCode, output: res.output, changed: [] };
      break;
    }
    default:
      r = fail(`${cmd}: command not found. Type help for the list.`, 127);
  }
  const result: ExecResult = { ...r, durationMs: Math.round(performance.now() - started), runtime };
  if (cmd && cmd !== "help") {
    await db.insert(schema.execRuns).values({ projectId: ctx.projectId, userId: ctx.userId, command: command.slice(0, MAX_COMMAND), runtime, exitCode: result.exitCode, output: result.output.slice(0, 400), changedPaths: result.changed, durationMs: result.durationMs });
  }
  return result;
}

export async function recentRuns(projectId: string, userId: string, limit = 50) {
  return db
    .select({ id: schema.execRuns.id, command: schema.execRuns.command, exitCode: schema.execRuns.exitCode, runtime: schema.execRuns.runtime, durationMs: schema.execRuns.durationMs, createdAt: schema.execRuns.createdAt })
    .from(schema.execRuns)
    .where(and(eq(schema.execRuns.projectId, projectId), eq(schema.execRuns.userId, userId)))
    .orderBy(desc(schema.execRuns.createdAt))
    .limit(limit);
}
