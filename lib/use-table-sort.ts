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
    let c: number;
    if (typeof av === "number" && typeof bv === "number") {
      c = av - bv;
    } else {
      c = String(av ?? "").localeCompare(String(bv ?? ""));
    }
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
