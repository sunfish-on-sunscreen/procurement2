"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PackagePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { panelElevation, formatCompactCurrency } from "@/lib/utils";

type Preview = {
  purchaseOrders: number;
  orderLines: number;
  totalValueUsd: number;
  periods: string[];
};

/**
 * Append complete purchase chains from a multi-sheet workbook.
 *
 * Insert-only: nothing existing is touched. Re-uploading a posted document is
 * rejected rather than overwritten, and every purchase order must arrive with its
 * whole chain — an invoice-less PO would be scored as a three-way-match pass.
 */
export function TransactionAppendCard() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[] | null>(null);

  async function pickFile(f: File | null) {
    setFile(f);
    setErrors(null);
    setPreview(null);
    if (!f) return;
    setBusy(true);
    try {
      const body = new FormData();
      body.append("file", f);
      body.append("mode", "preview");
      const res = await fetch("/api/imports/transactions", { method: "POST", body });
      const data = (await res.json().catch(() => ({}))) as Preview & {
        error?: string;
        errors?: string[];
      };
      if (res.ok) {
        setPreview(data);
        setOpen(true);
      } else {
        setErrors(data.errors ?? [data.error ?? "Could not read that file."]);
      }
    } catch {
      setErrors(["Could not read that file."]);
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    if (!file) return;
    setBusy(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/imports/transactions", { method: "POST", body });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        errors?: string[];
        success?: boolean;
        purchaseOrders?: number;
        totalValueUsd?: number;
      };
      if (res.ok && data.success) {
        toast.success(
          `Appended ${data.purchaseOrders ?? 0} purchase order(s) — ${formatCompactCurrency(data.totalValueUsd ?? 0)}. Analytics refreshed.`,
        );
        setOpen(false);
        setFile(null);
        setPreview(null);
        if (inputRef.current) inputRef.current.value = "";
        router.refresh();
      } else {
        setErrors(data.errors ?? [data.error ?? "Append failed."]);
        setOpen(false);
      }
    } catch {
      setErrors(["Append failed — the request did not complete."]);
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Append transactions</h2>
        <Button size="sm" variant="outline" onClick={() => inputRef.current?.click()} disabled={busy}>
          <PackagePlus className="mr-1 h-4 w-4" />
          {busy && !open ? "Checking…" : "Upload transactions .xlsx"}
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx"
          className="hidden"
          onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
        />
      </div>
      <p className="text-sm text-muted-foreground">
        Adds new purchase orders from the eight document sheets (requisitions through
        payments), plus sourcing events and responses if any order is an RFQ. Each order
        must arrive as a complete chain, its suppliers must already exist, and posted
        records are never overwritten — a re-uploaded id is rejected.
      </p>

      {errors && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3">
          <p className="text-sm font-medium text-destructive">
            Rejected — no data was changed.
          </p>
          <ul className="mt-2 list-inside list-disc text-xs text-muted-foreground">
            {errors.slice(0, 10).map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
          {errors.length > 10 && (
            <p className="mt-1 text-xs text-muted-foreground">…and {errors.length - 10} more.</p>
          )}
        </div>
      )}

      <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <DialogContent
          showCloseButton={false}
          aria-label="Confirm transaction append"
          className={`flex w-full flex-col gap-0 p-0 sm:max-w-[520px] ${panelElevation}`}
        >
          <div className="border-b p-4">
            <DialogTitle className="font-heading text-base font-medium leading-snug">
              Append transactions?
            </DialogTitle>
            <p className="mt-1 text-sm text-muted-foreground">{file?.name}</p>
          </div>

          <div className="flex flex-col gap-2 p-4 text-sm">
            {preview && (
              <>
                <p>
                  <span className="font-medium">{preview.purchaseOrders}</span> purchase
                  order(s) · <span className="font-medium">{preview.orderLines}</span> order
                  line(s) ·{" "}
                  <span className="font-medium">
                    {formatCompactCurrency(preview.totalValueUsd)}
                  </span>{" "}
                  of new spend
                </p>
                <p className="text-muted-foreground">
                  Reporting period(s): {preview.periods.join(", ")}
                </p>
                <p className="text-xs text-muted-foreground">
                  Every chain passed validation. Nothing existing is modified; all periods
                  are recomputed on save — expect a few seconds.
                </p>
              </>
            )}
          </div>

          <footer className="flex items-center justify-end gap-2 border-t bg-muted/50 p-4">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={apply} disabled={busy || !preview}>
              {busy ? "Appending…" : "Append transactions"}
            </Button>
          </footer>
        </DialogContent>
      </Dialog>
    </div>
  );
}
