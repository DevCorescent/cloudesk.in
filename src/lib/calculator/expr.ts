// The calculator's expression language — parsed and evaluated here, never with
// eval/Function. Operators: + − × ÷ (or * / x), ^ (power, right-associative), !
// (factorial), mod, implicit multiplication (2(3+4), 2pi), and business-style
// percentages: "200 + 18%" is 236, "200 − 10%" is 180, "18% of 200" is 36,
// "50%" alone is 0.5. Functions, constants, `ans` and your own variables
// ("rate = 18") are supported. Results are rounded to 12 significant digits so
// 0.1 + 0.2 shows as 0.3.

export type AngleMode = "deg" | "rad";
export type Env = { vars: Record<string, number>; ans: number; angle: AngleMode };

export class CalcError extends Error {
  constructor(message: string, public at = -1) {
    super(message);
  }
}

type Tok =
  | { t: "num"; v: number; at: number }
  | { t: "id"; v: string; at: number }
  | { t: "op"; v: string; at: number }
  | { t: "pct"; at: number }
  | { t: "fact"; at: number }
  | { t: "lp"; at: number }
  | { t: "rp"; at: number }
  | { t: "comma"; at: number }
  | { t: "eq"; at: number };

const OPS: Record<string, string> = { "+": "+", "-": "-", "−": "-", "–": "-", "*": "*", "×": "*", "·": "*", "/": "/", "÷": "/", "^": "^" };

export function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  // Inside brackets commas separate values (max(10,20)); outside they group digits (1,23,456).
  let depth = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    // Numbers: 1,23,456.78 (grouping commas inside digits), .5, 1e-3, ₹/$ signs ignored.
    if (/[0-9.]/.test(c)) {
      let j = i;
      let s = "";
      while (j < src.length && /[0-9.,]/.test(src[j]!)) {
        // A comma is grouping only between digits followed by exactly 2 or 3 digits (Indian or Western).
        if (src[j] === ",") {
          if (depth > 0) break;
          const rest = /^,(\d{2,3})(?!\d)|^,(\d{2,3})(?=,)/.exec(src.slice(j));
          if (!rest || !/\d/.test(src[j - 1] ?? "")) break;
          j++;
          continue;
        }
        s += src[j];
        j++;
      }
      if (/^[eE][+-]?\d/.test(src.slice(j)) && /\d/.test(s)) {
        const m = /^[eE][+-]?\d+/.exec(src.slice(j))!;
        s += m[0];
        j += m[0].length;
      }
      if ((s.match(/\./g)?.length ?? 0) > 1 || s === ".") throw new CalcError(`“${s}” isn't a number`, i);
      out.push({ t: "num", v: Number(s), at: i });
      i = j;
      continue;
    }
    if (/[₹$€£]/.test(c)) {
      i++;
      continue;
    }
    if (/[a-zA-Zπ_]/.test(c)) {
      let j = i;
      while (j < src.length && /[a-zA-Z0-9_π]/.test(src[j]!)) j++;
      const word = src.slice(i, j).toLowerCase();
      // "2 x 3" multiplies; x is otherwise an ordinary name.
      const prev = out[out.length - 1];
      if (word === "x" && prev && (prev.t === "num" || prev.t === "rp" || prev.t === "pct" || prev.t === "fact") && /^\s*[0-9.(]/.test(src.slice(j))) out.push({ t: "op", v: "*", at: i });
      else out.push({ t: "id", v: word, at: i });
      i = j;
      continue;
    }
    if (OPS[c]) out.push({ t: "op", v: OPS[c]!, at: i });
    else if (c === "%") out.push({ t: "pct", at: i });
    else if (c === "!") out.push({ t: "fact", at: i });
    else if (c === "(" || c === "[") {
      depth++;
      out.push({ t: "lp", at: i });
    } else if (c === ")" || c === "]") {
      depth = Math.max(0, depth - 1);
      out.push({ t: "rp", at: i });
    }
    else if (c === "," || c === ";") out.push({ t: "comma", at: i });
    else if (c === "=") out.push({ t: "eq", at: i });
    else throw new CalcError(`“${c}” can't be used here`, i);
    i++;
  }
  return out;
}

// ── Syntax tree ─────────────────────────────────────────────────────────────

export type Node =
  | { k: "num"; v: number }
  | { k: "var"; name: string; at: number }
  | { k: "neg"; e: Node }
  | { k: "bin"; op: string; a: Node; b: Node }
  | { k: "pct"; e: Node }
  | { k: "fact"; e: Node }
  | { k: "call"; name: string; args: Node[]; at: number };

const CONSTANTS: Record<string, number> = { pi: Math.PI, π: Math.PI, e: Math.E, tau: 2 * Math.PI, phi: (1 + Math.sqrt(5)) / 2 };

const fact = (n: number) => {
  if (!Number.isInteger(n) || n < 0) throw new CalcError("Factorial needs a whole number ≥ 0");
  if (n > 170) return Infinity;
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
};

type Fn = { min: number; max: number; f: (a: number[], env: Env) => number; help: string };
const toRad = (x: number, env: Env) => (env.angle === "deg" ? (x * Math.PI) / 180 : x);
const fromRad = (x: number, env: Env) => (env.angle === "deg" ? (x * 180) / Math.PI : x);
const nonNeg = (x: number, name: string) => {
  if (x < 0) throw new CalcError(`${name} of a negative number isn't real`);
  return x;
};
const positive = (x: number, name: string) => {
  if (x <= 0) throw new CalcError(`${name} needs a number above 0`);
  return x;
};

export const FUNCTIONS: Record<string, Fn> = {
  sqrt: { min: 1, max: 1, f: ([x]) => Math.sqrt(nonNeg(x!, "Square root")), help: "Square root" },
  cbrt: { min: 1, max: 1, f: ([x]) => Math.cbrt(x!), help: "Cube root" },
  root: { min: 2, max: 2, f: ([x, n]) => (n! % 2 === 1 && x! < 0 ? -Math.pow(-x!, 1 / n!) : Math.pow(nonNeg(x!, "Even root"), 1 / n!)), help: "root(x, n): n-th root" },
  abs: { min: 1, max: 1, f: ([x]) => Math.abs(x!), help: "Absolute value" },
  round: { min: 1, max: 2, f: ([x, d = 0]) => Math.round(x! * 10 ** d) / 10 ** d, help: "round(x, digits)" },
  floor: { min: 1, max: 1, f: ([x]) => Math.floor(x!), help: "Round down" },
  ceil: { min: 1, max: 1, f: ([x]) => Math.ceil(x!), help: "Round up" },
  ln: { min: 1, max: 1, f: ([x]) => Math.log(positive(x!, "ln")), help: "Natural log" },
  log: { min: 1, max: 2, f: ([x, b = 10]) => Math.log(positive(x!, "log")) / Math.log(b), help: "log(x) base 10, or log(x, base)" },
  log2: { min: 1, max: 1, f: ([x]) => Math.log2(positive(x!, "log2")), help: "Log base 2" },
  exp: { min: 1, max: 1, f: ([x]) => Math.exp(x!), help: "e to the power x" },
  sin: { min: 1, max: 1, f: ([x], e) => Math.sin(toRad(x!, e)), help: "Sine" },
  cos: { min: 1, max: 1, f: ([x], e) => Math.cos(toRad(x!, e)), help: "Cosine" },
  tan: { min: 1, max: 1, f: ([x], e) => Math.tan(toRad(x!, e)), help: "Tangent" },
  asin: { min: 1, max: 1, f: ([x], e) => fromRad(Math.asin(x!), e), help: "Inverse sine" },
  acos: { min: 1, max: 1, f: ([x], e) => fromRad(Math.acos(x!), e), help: "Inverse cosine" },
  atan: { min: 1, max: 1, f: ([x], e) => fromRad(Math.atan(x!), e), help: "Inverse tangent" },
  min: { min: 1, max: 100, f: (a) => Math.min(...a), help: "Smallest" },
  max: { min: 1, max: 100, f: (a) => Math.max(...a), help: "Largest" },
  sum: { min: 1, max: 100, f: (a) => a.reduce((s, x) => s + x, 0), help: "Total" },
  avg: { min: 1, max: 100, f: (a) => a.reduce((s, x) => s + x, 0) / a.length, help: "Average" },
  mean: { min: 1, max: 100, f: (a) => a.reduce((s, x) => s + x, 0) / a.length, help: "Average" },
  median: { min: 1, max: 100, f: (a) => { const s = [...a].sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2; }, help: "Middle value" },
  fact: { min: 1, max: 1, f: ([x]) => fact(x!), help: "Factorial" },
  ncr: { min: 2, max: 2, f: ([n, r]) => fact(n!) / (fact(r!) * fact(n! - r!)), help: "Combinations" },
  npr: { min: 2, max: 2, f: ([n, r]) => fact(n!) / fact(n! - r!), help: "Permutations" },
  pct: { min: 2, max: 2, f: ([part, whole]) => (part! / whole!) * 100, help: "pct(part, whole): part as % of whole" },
  change: { min: 2, max: 2, f: ([from, to]) => ((to! - from!) / from!) * 100, help: "change(from, to): % change" },
  gst: { min: 2, max: 2, f: ([amt, rate]) => amt! * (1 + rate! / 100), help: "gst(amount, rate): amount with GST" },
  exgst: { min: 2, max: 2, f: ([amt, rate]) => amt! / (1 + rate! / 100), help: "exgst(amount, rate): amount before GST" },
};

/** Variables can't take these names. */
export const RESERVED = new Set([...Object.keys(FUNCTIONS), ...Object.keys(CONSTANTS), "ans", "of", "mod"]);

class Parser {
  i = 0;
  constructor(private toks: Tok[]) {}
  peek() {
    return this.toks[this.i];
  }
  next() {
    return this.toks[this.i++];
  }
  done() {
    return this.i >= this.toks.length;
  }
  expr(): Node {
    return this.additive();
  }
  // a + b, a − b — with "a + b%" meaning a + (a × b/100).
  additive(): Node {
    let a = this.multiplicative();
    for (;;) {
      const t = this.peek();
      if (t?.t !== "op" || (t.v !== "+" && t.v !== "-")) return a;
      this.next();
      const b = this.multiplicative();
      a = b.k === "pct" ? { k: "bin", op: t.v === "+" ? "+%" : "-%", a, b: b.e } : { k: "bin", op: t.v, a, b };
    }
  }
  multiplicative(): Node {
    let a = this.unary();
    for (;;) {
      const t = this.peek();
      if (t?.t === "op" && (t.v === "*" || t.v === "/")) {
        this.next();
        a = { k: "bin", op: t.v, a, b: this.unary() };
      } else if (t?.t === "id" && (t.v === "mod" || t.v === "of")) {
        this.next();
        // "18% of 200": a percentage times the amount.
        a = { k: "bin", op: t.v === "mod" ? "mod" : "*", a, b: this.unary() };
      } else if (t && (t.t === "num" || t.t === "lp" || (t.t === "id" && t.v !== "mod" && t.v !== "of"))) {
        // Implicit multiplication: 2(3+4), 2pi, (1+2)(3+4).
        a = { k: "bin", op: "*", a, b: this.unary() };
      } else return a;
    }
  }
  unary(): Node {
    const t = this.peek();
    if (t?.t === "op" && (t.v === "-" || t.v === "+")) {
      this.next();
      const e = this.unary();
      return t.v === "-" ? { k: "neg", e } : e;
    }
    return this.power();
  }
  power(): Node {
    const base = this.postfix();
    const t = this.peek();
    if (t?.t === "op" && t.v === "^") {
      this.next();
      return { k: "bin", op: "^", a: base, b: this.unary() };
    }
    return base;
  }
  postfix(): Node {
    let e = this.primary();
    for (;;) {
      const t = this.peek();
      if (t?.t === "pct") {
        this.next();
        e = { k: "pct", e };
      } else if (t?.t === "fact") {
        this.next();
        e = { k: "fact", e };
      } else return e;
    }
  }
  primary(): Node {
    const t = this.next();
    if (!t) throw new CalcError("The expression ends too soon");
    if (t.t === "num") return { k: "num", v: t.v };
    if (t.t === "lp") {
      const e = this.expr();
      const r = this.next();
      if (r?.t !== "rp") throw new CalcError("A bracket isn't closed", t.at);
      return e;
    }
    if (t.t === "id") {
      if (this.peek()?.t === "lp" && Object.hasOwn(FUNCTIONS, t.v)) {
        this.next();
        const args: Node[] = [];
        if (this.peek()?.t !== "rp") {
          args.push(this.expr());
          while (this.peek()?.t === "comma") {
            this.next();
            args.push(this.expr());
          }
        }
        const r = this.next();
        if (r?.t !== "rp") throw new CalcError(`${t.v}( isn't closed`, t.at);
        return { k: "call", name: t.v, args, at: t.at };
      }
      return { k: "var", name: t.v, at: t.at };
    }
    if (t.t === "rp") throw new CalcError("A closing bracket has no opening one", t.at);
    throw new CalcError("Something's missing before this", t.at);
  }
}

export function parse(src: string): { assign: string | null; node: Node } {
  const toks = tokenize(src);
  if (!toks.length) throw new CalcError("Type a calculation");
  let assign: string | null = null;
  let body = toks;
  // "rate = 18" stores a variable.
  if (toks.length > 2 && toks[0]!.t === "id" && toks[1]!.t === "eq") {
    const name = (toks[0] as { v: string }).v;
    if (RESERVED.has(name) || name === "constructor" || name.startsWith("__") || !/^[a-zπ_][a-z0-9_]*$/.test(name)) throw new CalcError(`“${name}” can't be a variable name`, 0);
    assign = name;
    body = toks.slice(2);
  }
  if (body.some((t) => t.t === "eq")) throw new CalcError("Only one = is allowed, to name a value (rate = 18)");
  const p = new Parser(body);
  const node = p.expr();
  if (!p.done()) {
    const t = p.peek()!;
    throw new CalcError(t.t === "rp" ? "A closing bracket has no opening one" : "Something's wrong around here", t.at);
  }
  return { assign, node };
}

function ev(n: Node, env: Env): number {
  switch (n.k) {
    case "num":
      return n.v;
    case "neg":
      return -ev(n.e, env);
    case "pct":
      return ev(n.e, env) / 100;
    case "fact":
      return fact(ev(n.e, env));
    case "var": {
      if (n.name === "ans") return env.ans;
      // Own keys only: "constructor" or "__proto__" must never reach an object's prototype.
      if (Object.hasOwn(CONSTANTS, n.name)) return CONSTANTS[n.name]!;
      if (Object.hasOwn(env.vars, n.name) && typeof env.vars[n.name] === "number") return env.vars[n.name]!;
      throw new CalcError(Object.hasOwn(FUNCTIONS, n.name) ? `${n.name} needs brackets: ${n.name}(…)` : `“${n.name}” isn't defined — set it first, e.g. ${n.name} = 10`, n.at);
    }
    case "call": {
      const fn = FUNCTIONS[n.name]!;
      if (n.args.length < fn.min || n.args.length > fn.max) throw new CalcError(`${n.name} takes ${fn.min === fn.max ? fn.min : `${fn.min} to ${fn.max}`} value${fn.max === 1 ? "" : "s"}`, n.at);
      return fn.f(n.args.map((a) => ev(a, env)), env);
    }
    case "bin": {
      const a = ev(n.a, env);
      const b = ev(n.b, env);
      switch (n.op) {
        case "+": return a + b;
        case "-": return a - b;
        case "+%": return a + (a * b) / 100;
        case "-%": return a - (a * b) / 100;
        case "*": return a * b;
        case "/":
          if (b === 0) throw new CalcError("Can't divide by zero");
          return a / b;
        case "mod":
          if (b === 0) throw new CalcError("Can't divide by zero");
          return a % b;
        case "^": return Math.pow(a, b);
      }
    }
  }
  throw new CalcError("Unknown operation");
}

/** Rounds away floating-point noise (12 significant digits). */
export const clean = (x: number) => (Number.isFinite(x) && x !== 0 ? Number(x.toPrecision(12)) : x);

export function evaluate(src: string, env: Env): { value: number; assign: string | null } {
  const { assign, node } = parse(src);
  const value = clean(ev(node, env));
  if (Number.isNaN(value)) throw new CalcError("That isn't a real number");
  if (!Number.isFinite(value)) throw new CalcError("The result is too large");
  return { value, assign };
}
