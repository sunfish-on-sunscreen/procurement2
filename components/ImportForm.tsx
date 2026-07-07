"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Minus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { AddSupplierCard } from "@/components/AddSupplierCard";
import { RemoveSupplierCard } from "@/components/RemoveSupplierCard";
import { AddPurchaseCard, type SupplierPick } from "@/components/AddPurchaseCard";
import { RemovePurchaseCard, type PurchasePick } from "@/components/RemovePurchaseCard";

export function ImportForm({
  nextSupplierId,
  categories,
  nextPoId,
  suppliers,
  units,
  purchases,
  supplierItems,
}: {
  nextSupplierId: string;
  categories: string[];
  nextPoId: string;
  suppliers: SupplierPick[];
  units: string[];
  purchases: PurchasePick[];
  supplierItems: Record<string, string[]>;
}) {
  const router = useRouter();
  const [suppliersFile, setSuppliersFile] = useState<File | null>(null);
  const [purchasesFile, setPurchasesFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [addOpen, setAddOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [addPurchaseOpen, setAddPurchaseOpen] = useState(false);
  const [removePurchaseOpen, setRemovePurchaseOpen] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!suppliersFile || !purchasesFile) return;

    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append("suppliers", suppliersFile);
      formData.append("purchases", purchasesFile);

      const res = await fetch("/api/imports/upload", {
        method: "POST",
        body: formData,
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        suppliers?: number;
        purchases?: number;
        periodsCreated?: string[];
      };

      if (res.ok) {
        const periods = (data.periodsCreated ?? []).join(", ");
        toast.success(
          `Imported ${data.suppliers} suppliers and ${data.purchases} purchases across periods: ${periods || "—"}`,
        );
        setSuppliersFile(null);
        setPurchasesFile(null);
        setFileInputKey((key) => key + 1);
        router.refresh();
      } else {
        toast.error(data.error || "Import failed");
      }
    } catch {
      toast.error("Import failed");
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Import data</CardTitle>
        <CardDescription>
          Upload two Excel files — a Suppliers file and a Purchases file. Periods
          are detected automatically from the purchase dates.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="suppliers">Suppliers file (.xlsx)</Label>
            <Input
              key={`suppliers-${fileInputKey}`}
              id="suppliers"
              type="file"
              accept=".xlsx"
              className="cursor-pointer"
              onChange={(event) => setSuppliersFile(event.target.files?.[0] ?? null)}
            />
            <div className="flex items-center gap-4">
              <button
                type="button"
                onClick={() => setAddOpen(true)}
                className="inline-flex w-fit items-center gap-1 text-sm text-primary underline-offset-4 hover:underline"
              >
                <Plus className="h-3.5 w-3.5" /> add a single supplier
              </button>
              <button
                type="button"
                onClick={() => setRemoveOpen(true)}
                className="inline-flex w-fit items-center gap-1 text-sm text-primary underline-offset-4 hover:underline"
              >
                <Minus className="h-3.5 w-3.5" /> remove a single supplier
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="purchases">Purchases file (.xlsx)</Label>
            <Input
              key={`purchases-${fileInputKey}`}
              id="purchases"
              type="file"
              accept=".xlsx"
              className="cursor-pointer"
              onChange={(event) => setPurchasesFile(event.target.files?.[0] ?? null)}
            />
            <div className="flex items-center gap-4">
              <button
                type="button"
                onClick={() => setAddPurchaseOpen(true)}
                className="inline-flex w-fit items-center gap-1 text-sm text-primary underline-offset-4 hover:underline"
              >
                <Plus className="h-3.5 w-3.5" /> add a single purchase
              </button>
              <button
                type="button"
                onClick={() => setRemovePurchaseOpen(true)}
                className="inline-flex w-fit items-center gap-1 text-sm text-primary underline-offset-4 hover:underline"
              >
                <Minus className="h-3.5 w-3.5" /> remove a single purchase
              </button>
            </div>
          </div>

          <p className="text-sm text-muted-foreground">
            Each purchase must reference a supplier_id present in the Suppliers
            file (or already imported). Rows with a blank id are assigned the next
            id automatically. The system auto-detects years from the purchase
            dates and creates periods accordingly.
          </p>

          <div className="flex items-center gap-4">
            <Button
              type="submit"
              disabled={!suppliersFile || !purchasesFile || isUploading}
            >
              {isUploading ? "Uploading..." : "Upload"}
            </Button>
            <a
              href="/api/sample-data?file=suppliers"
              download
              className="text-sm text-primary underline-offset-4 hover:underline"
            >
              Sample suppliers
            </a>
            <a
              href="/api/sample-data?file=purchases"
              download
              className="text-sm text-primary underline-offset-4 hover:underline"
            >
              Sample purchases
            </a>
          </div>
        </form>
      </CardContent>

      <AddSupplierCard
        open={addOpen}
        onOpenChange={setAddOpen}
        nextId={nextSupplierId}
        categories={categories}
      />

      <RemoveSupplierCard
        open={removeOpen}
        onOpenChange={setRemoveOpen}
        suppliers={suppliers}
      />

      <AddPurchaseCard
        open={addPurchaseOpen}
        onOpenChange={setAddPurchaseOpen}
        nextId={nextPoId}
        suppliers={suppliers}
        units={units}
        supplierItems={supplierItems}
      />

      <RemovePurchaseCard
        open={removePurchaseOpen}
        onOpenChange={setRemovePurchaseOpen}
        purchases={purchases}
      />
    </Card>
  );
}
