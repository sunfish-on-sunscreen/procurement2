"use client";

import type { CycleTimeResult, CycleDescriptive } from "@/lib/analysis-types";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SortArrow } from "@/components/RankingCells";
import { useTableSort, type SortDir } from "@/lib/use-table-sort";

const STAGES = [
  { key: "pr_to_po", label: "PR → PO" },
  { key: "po_to_delivery", label: "PO → Delivery" },
  { key: "delivery_to_invoice", label: "Delivery → Invoice" },
  { key: "invoice_to_payment", label: "Invoice → Payment" },
] as const;

const d2 = (v: number | null | undefined) => (v == null ? "—" : v.toFixed(2));

function SortHead({
  label,
  sortKey,
  active,
  dir,
  onSort,
  align = "left",
  defaultDir = "desc",
}: {
  label: string;
  sortKey: string;
  active: boolean;
  dir: SortDir;
  onSort: (key: string, defaultDir: SortDir) => void;
  align?: "left" | "right";
  defaultDir?: SortDir;
}) {
  return (
    <TableHead className={align === "right" ? "text-right" : ""}>
      <button
        type="button"
        onClick={() => onSort(sortKey, defaultDir)}
        className={`inline-flex items-center gap-1 hover:text-foreground ${align === "right" ? "flex-row-reverse" : ""}`}
      >
        {label}
        <SortArrow active={active} dir={active ? dir : "desc"} />
      </button>
    </TableHead>
  );
}

type StageRow = { order: number; key: string; label: string } & CycleDescriptive;

/**
 * Per-stage descriptives (Average / Median / P25 / P75, 2dp) for the 4
 * procure-to-pay sub-processes. Renders only the sortable table — the caller
 * supplies the card/heading. Shared by CycleTimeView (reports) and the dashboard
 * "Stage breakdown" section, so both show the identical format.
 */
export function StageDecompositionTable({ data }: { data: CycleTimeResult }) {
  const rows: StageRow[] = STAGES.map((s, i) => ({
    order: i,
    key: s.key,
    label: s.label,
    ...data.stage_breakdown[s.key],
  }));
  const { sorted, sort, toggle } = useTableSort<StageRow, string>(
    rows,
    (r, k) => (r as unknown as Record<string, number | string | null>)[k],
    "order",
    "asc",
  );
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <SortHead label="Stage" sortKey="order" active={sort.key === "order"} dir={sort.dir} onSort={toggle} defaultDir="asc" />
          <SortHead label="N" sortKey="n" active={sort.key === "n"} dir={sort.dir} onSort={toggle} align="right" />
          <SortHead label="Average" sortKey="mean" active={sort.key === "mean"} dir={sort.dir} onSort={toggle} align="right" />
          <SortHead label="Median" sortKey="median" active={sort.key === "median"} dir={sort.dir} onSort={toggle} align="right" />
          <SortHead label="P25" sortKey="p25" active={sort.key === "p25"} dir={sort.dir} onSort={toggle} align="right" />
          <SortHead label="P75" sortKey="p75" active={sort.key === "p75"} dir={sort.dir} onSort={toggle} align="right" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {sorted.map((s) => (
          <TableRow key={s.key}>
            <TableCell className="font-medium">{s.label}</TableCell>
            <TableCell className="text-right tabular-nums text-muted-foreground">{s.n}</TableCell>
            <TableCell className="text-right tabular-nums">{d2(s.mean)}</TableCell>
            <TableCell className="text-right tabular-nums">{d2(s.median)}</TableCell>
            <TableCell className="text-right tabular-nums">{d2(s.p25)}</TableCell>
            <TableCell className="text-right tabular-nums">{d2(s.p75)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
