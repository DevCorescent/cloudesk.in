// LIKE/ILIKE patterns from what people type: % and _ (and the escape
// character itself) match literally, so a search for "50%" or "a_b" finds just
// that and a query can't become an expensive wildcard pattern.

/** Escapes LIKE wildcards (PostgreSQL's default escape character is a backslash). */
export const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** A "contains" pattern for LIKE/ILIKE. */
export const contains = (s: string) => `%${escapeLike(s)}%`;
