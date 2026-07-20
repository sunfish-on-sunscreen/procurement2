"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Upload, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { panelElevation } from "@/lib/utils";

type Preflight = {
  supplierCount: number;
  poCount: number;
  changeLogCount: number;
  manuallyAddedSuppliers: string[];
};

/**
 * Full-dataset (12-sheet) upload. REPLACE-ALL, so the confirmation names exactly
 * what will be destroyed rather than warning generically — the counts come from a
 * preflight read taken at click time, not from stale page props.
 */
export function DatasetImportCard() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preflight, setPreflight] = useState<Preflight | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[] | null>(null);

  async function pickFile(f: File | null) {
    setFile(f);
    setErrors(null);
    if (!f) return;
    try {
      const res = await fetch("/api/imports/upload");
      if (res.ok) setPreflight((await res.json()) as Preflight);
      else setPreflight(null);
    } catch {
      setPreflight(null);
    }
    setConfirmOpen(true);
  }

  async function handleImport() {
    if (!file) return;
    setBusy(true);
    setErrors(null);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/imports/upload", { method: "POST", body });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        errors?: string[];
        success?: boolean;
        counts?: Record<string, number>;
        audit?: { preserved: number; dropped: number };
      };
      if (res.ok && data.success) {
        const total = Object.values(data.counts ?? {}).reduce((a, b) => a + b, 0);
        toast.success(
          `Imported ${total.toLocaleString()} rows across 12 tables. ` +
            `${data.audit?.preserved ?? 0} audit entries preserved.`,
        );
        setConfirmOpen(false);
        setFile(null);
        if (inputRef.current) inputRef.current.value = "";
        router.refresh();
      } else {
        setErrors(data.errors ?? [data.error ?? "Import failed."]);
      }
    } catch {
      setErrors(["Import failed — the request did not complete."]);
    } finally {
      setBusy(false);
    }
  }

  const manualCount = preflight?.manuallyAddedSuppliers.length ?? 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Import dataset</h2>
        <Button size="sm" variant="outline" onClick={() => inputRef.current?.click()} disabled={busy}>
          <Upload className="mr-1 h-4 w-4" />
          Upload .xlsx
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
        Replaces the entire dataset from a 12-sheet workbook (suppliers → payments).
        The file is fully validated before anything is written, and the whole import
        is one transaction, so a bad file changes nothing.
      </p>

      {errors && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3">
          <p className="text-sm font-medium text-destructive">
            Import rejected — no data was changed.
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

      <Dialog open={confirmOpen} onOpenChange={(o) => !busy && setConfirmOpen(o)}>
        <DialogContent
          showCloseButton={false}
          aria-label="Confirm dataset replacement"
          className={`flex w-full flex-col gap-0 p-0 sm:max-w-[520px] ${panelElevation}`}
        >
          <div className="border-b p-4">
            <DialogTitle className="flex items-center gap-2 font-heading text-base font-medium leading-snug">
              <TriangleAlert className="h-4 w-4 text-[var(--warning)]" />
              Replace all data?
            </DialogTitle>
            <p className="mt-2 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{file?.name}</span> will
              replace the entire dataset. This cannot be undone.
            </p>
          </div>

          <div className="flex flex-col gap-2 p-4 text-sm">
            <p className="font-medium">What will be deleted:</p>
            <ul className="list-inside list-disc text-muted-foreground">
              <li>
                All <span className="font-medium text-foreground">{preflight?.supplierCount ?? "?"}</span>{" "}
                suppliers and{" "}
                <span className="font-medium text-foreground">{preflight?.poCount ?? "?"}</span>{" "}
                purchase orders, with their full document chain
              </li>
              {manualCount > 0 && (
                <li className="text-destructive">
                  <span className="font-medium">{manualCount}</span> manually-added
                  supplier{manualCount === 1 ? "" : "s"} ({preflight?.manuallyAddedSuppliers.join(", ")})
                  — these exist only in the database, not in any file
                </li>
              )}
            </ul>
            <p className="mt-2 font-medium">Audit trail:</p>
            <p className="text-muted-foreground">
              {preflight?.changeLogCount ? (
                <>
                  The {preflight.changeLogCount} master-data change entr
                  {preflight.changeLogCount === 1 ? "y is" : "ies are"} preserved for
                  every supplier the new file still contains. History for suppliers
                  not in the file is dropped, and the import itself is recorded.
                </>
              ) : (
                <>No master-data changes recorded yet — nothing to preserve.</>
              )}
            </p>
          </div>

          <footer className="flex items-center justify-end gap-2 border-t bg-muted/50 p-4">
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleImport} disabled={busy}>
              {busy ? "Importing…" : "Replace all data"}
            </Button>
          </footer>
        </DialogContent>
      </Dialog>
    </div>
  );
}
