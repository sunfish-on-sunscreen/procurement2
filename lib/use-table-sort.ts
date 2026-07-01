import { useState } from "react";

export type SortDir = "asc" | "desc";

/**
 * Small client-side table sorter shared by the Cycle Time tables. Mirrors the
 * sort behaviour of the Spend Overview / Supplier Classification ranking tables
 * (string keys sort asc by default, numeric desc; toggling flips direction).
 * `get` projects a row + key to a comparable value; nulls sort last.
 */
export function useTableSort<T, K extends string>(
  rows: T[],
  get: (row: T, key: K) => number | string | null | undefined,
  initialKey: K,
  initialDir: SortDir = "desc",
) {
  const [sort, setSort] = useState<{ key: K; dir: SortDir }>({
    key: initialKey,
    dir: initialDir,
  });

  const sorted = [...rows].sort((a, b) => {
    const av = get(a, sort.key);
    const bv = get(b, sort.key);
    // Null/undefined always sort LAST, regardless of direction.
    const aNull = av == null;
    const bNull = bv == null;
    if (aNull || bNull) return aNull === bNull ? 0 : aNull ? 1 : -1;
    // Both non-null: numbers compare numerically (a null value no longer
    // forces the whole column onto the string path); anything else lexically.
    const c =
      typeof av === "number" && typeof bv === "number"
        ? av - bv
        : String(av).localeCompare(String(bv));
    return sort.dir === "asc" ? c : -c;
  });

  const toggle = (key: K, defaultDir: SortDir = "desc") =>
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === "asc" ? "desc" : "asc" }
        : { key, dir: defaultDir },
    );

  return { sorted, sort, toggle };
}
