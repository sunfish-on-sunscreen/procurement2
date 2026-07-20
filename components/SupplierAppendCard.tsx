"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FilePlus2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { panelElevation } from "@/lib/utils";

type Preview = {
  willInsert: string[];
  willUpdate: { id: string; name: string; changes: string[] }[];
  unchanged: number;
};

/**
 * Append suppliers from a one-sheet workbook, upserting by `supplier_id`.
 *
 * Additive — unlike the full replace it deletes nothing — but an upsert still
 * OVERWRITES fields on existing suppliers, so the file is validated and planned
 * server-side first and the exact before → after of every field is shown before
 * anything is written.
 */
export function SupplierAppendCard() {
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
      const res = await fetch("/api/imports/suppliers", { method: "POST", body });
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
      const res = await fetch("/api/imports/suppliers", { method: "POST", body });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        errors?: string[];
        success?: boolean;
        message?: string;
        recomputed?: boolean;
        applied?: { inserted: number; updated: number; unchanged: number; fieldsChanged: number };
      };
      if (res.ok && data.success) {
        const a = data.applied;
        toast.success(
          data.recomputed
            ? `${a?.inserted ?? 0} added, ${a?.updated ?? 0} updated (${a?.fieldsChanged ?? 0} fields). Analytics refreshed.`
            : (data.message ?? "No changes."),
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

  // Note the null case: with no preview loaded there is nothing to confirm, so the
  // dialog body must not render at all — an earlier version only checked "empty
  // plan", which let the else-branch dereference a null preview on first paint.
  const nothingToDo =
    preview !== null && preview.willInsert.length === 0 && preview.willUpdate.length === 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Append suppliers</h2>
        <Button size="sm" variant="outline" onClick={() => inputRef.current?.click()} disabled={busy}>
          <FilePlus2 className="mr-1 h-4 w-4" />
          {busy && !open ? "Checking…" : "Upload suppliers .xlsx"}
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
        Adds or updates suppliers from a workbook&rsquo;s <code>suppliers</code> sheet,
        matched on <code>supplier_id</code> — existing ids are updated in place, new ids
        are added. Nothing is deleted. Every change is recorded in the audit trail.
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
          aria-label="Confirm supplier append"
          className={`flex max-h-[80vh] w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-[560px] ${panelElevation}`}
        >
          <div className="border-b p-4">
            <DialogTitle className="font-heading text-base font-medium leading-snug">
              {nothingToDo ? "Nothing to change" : "Apply supplier changes?"}
            </DialogTitle>
            <p className="mt-1 text-sm text-muted-foreground">{file?.name}</p>
          </div>

          <div className="flex flex-col gap-3 p-4 text-sm">
            {!preview ? null : nothingToDo ? (
              <p className="text-muted-foreground">
                All {preview?.unchanged ?? 0} supplier(s) in the file already match the
                roster exactly. Nothing would be written and no recompute would run.
              </p>
            ) : (
              <>
                {preview!.willInsert.length > 0 && (
                  <div>
                    <p className="font-medium">Add {preview!.willInsert.length} supplier(s)</p>
                    <p className="font-mono text-xs text-muted-foreground">
                      {preview!.willInsert.join(", ")}
                    </p>
                  </div>
                )}
                {preview!.willUpdate.length > 0 && (
                  <div>
                    <p className="font-medium">Update {preview!.willUpdate.length} supplier(s)</p>
                    <ul className="mt-1 flex flex-col gap-1.5">
                      {preview!.willUpdate.slice(0, 12).map((u) => (
                        <li key={u.id} className="rounded-md border p-2">
                          <span className="font-medium">{u.name}</span>{" "}
                          <span className="text-muted-foreground">· {u.id}</span>
                          <ul className="mt-0.5 list-inside list-disc font-mono text-[11px] text-muted-foreground">
                            {u.changes.map((c) => (
                              <li key={c}>{c}</li>
                            ))}
                          </ul>
                        </li>
                      ))}
                    </ul>
                    {preview!.willUpdate.length > 12 && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        …and {preview!.willUpdate.length - 12} more.
                      </p>
                    )}
                  </div>
                )}
                {preview!.unchanged > 0 && (
                  <p className="text-muted-foreground">
                    {preview!.unchanged} supplier(s) already match and will be left alone.
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  A category or country change moves roster concentration, so every period
                  is recomputed on save — expect a few seconds.
                </p>
              </>
            )}
          </div>

          <footer className="flex items-center justify-end gap-2 border-t bg-muted/50 p-4">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
              {nothingToDo ? "Close" : "Cancel"}
            </Button>
            {!nothingToDo && (
              <Button onClick={apply} disabled={busy}>
                {busy ? "Applying…" : "Apply changes"}
              </Button>
            )}
          </footer>
        </DialogContent>
      </Dialog>
    </div>
  );
}
