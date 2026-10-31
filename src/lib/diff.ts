// Line diff for review screens. LCS for normal sizes; for very large inputs it
// falls back to a prefix/suffix trim so the UI never stalls.
export type DiffLine = { type: "same" | "add" | "del"; text: string; a?: number; b?: number };

export function lineDiff(before: string, after: string): DiffLine[] {
  const a = before.split("\n");
  const b = after.split("\n");
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length - 1;
  let endB = b.length - 1;
  while (endA >= start && endB >= start && a[endA] === b[endB]) {
    endA--;
    endB--;
  }
  const out: DiffLine[] = [];
  for (let i = 0; i < start; i++) out.push({ type: "same", text: a[i], a: i + 1, b: i + 1 });
  const midA = a.slice(start, endA + 1);
  const midB = b.slice(start, endB + 1);
  if (midA.length * midB.length > 4_000_000) {
    midA.forEach((t, i) => out.push({ type: "del", text: t, a: start + i + 1 }));
    midB.forEach((t, i) => out.push({ type: "add", text: t, b: start + i + 1 }));
  } else {
    const n = midA.length;
    const m = midB.length;
    const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = midA[i] === midB[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    let i = 0;
    let j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && midA[i] === midB[j]) {
        out.push({ type: "same", text: midA[i], a: start + i + 1, b: start + j + 1 });
        i++;
        j++;
      } else if (i < n && (j >= m || dp[i + 1][j] >= dp[i][j + 1])) {
        out.push({ type: "del", text: midA[i], a: start + i + 1 });
        i++;
      } else {
        out.push({ type: "add", text: midB[j], b: start + j + 1 });
        j++;
      }
    }
  }
  for (let k = 0; k < a.length - 1 - endA; k++) out.push({ type: "same", text: a[endA + 1 + k], a: endA + 2 + k, b: endB + 2 + k });
  return out;
}

export type Hunk = { lines: DiffLine[] } | { skipped: number };

/** Collapses unchanged runs, keeping `context` lines around each change. */
export function hunks(lines: DiffLine[], context = 3): Hunk[] {
  const keep = new Array(lines.length).fill(false);
  lines.forEach((l, i) => {
    if (l.type !== "same") for (let k = Math.max(0, i - context); k <= Math.min(lines.length - 1, i + context); k++) keep[k] = true;
  });
  const out: Hunk[] = [];
  let cur: DiffLine[] = [];
  let skipped = 0;
  lines.forEach((l, i) => {
    if (keep[i]) {
      if (skipped) {
        out.push({ skipped });
        skipped = 0;
      }
      cur.push(l);
    } else {
      if (cur.length) {
        out.push({ lines: cur });
        cur = [];
      }
      skipped++;
    }
  });
  if (cur.length) out.push({ lines: cur });
  if (skipped) out.push({ skipped });
  return out;
}

export function diffStats(lines: DiffLine[]) {
  return { added: lines.filter((l) => l.type === "add").length, removed: lines.filter((l) => l.type === "del").length };
}
