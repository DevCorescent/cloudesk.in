// Laying out a day's timed events side by side when they overlap: events that
// touch form a group; each takes the first free column, and the group's width
// is shared by its columns (like Google and Outlook calendars).
export type Placed<T> = { item: T; col: number; cols: number };

export function layoutDay<T>(items: T[], start: (t: T) => number, end: (t: T) => number): Placed<T>[] {
  const sorted = [...items].sort((a, b) => start(a) - start(b) || end(b) - end(a));
  const out: Placed<T>[] = [];
  let group: Placed<T>[] = [];
  let groupEnd = -Infinity;
  const close = () => {
    const cols = Math.max(1, ...group.map((g) => g.col + 1));
    for (const g of group) g.cols = cols;
    out.push(...group);
    group = [];
  };
  for (const it of sorted) {
    const s = start(it);
    if (s >= groupEnd && group.length) close();
    const taken = new Set(group.filter((g) => end(g.item) > s).map((g) => g.col));
    let col = 0;
    while (taken.has(col)) col++;
    group.push({ item: it, col, cols: 1 });
    groupEnd = Math.max(groupEnd, end(it));
  }
  if (group.length) close();
  return out;
}
