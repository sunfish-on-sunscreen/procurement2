"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AddSupplierCard } from "@/components/AddSupplierCard";
import { SupplierRosterTable } from "@/components/SupplierRosterTable";

type Supplier = {
  id: string;
  supplierName: string;
  country: string;
  category: string;
  status: string;
};

/**
 * Client shell for supplier master-data management: the add dialog + the roster
 * (which owns the per-row deactivate/reactivate). Kept separate from the server
 * page so the page can stay a server component and re-derive nextId/categories
 * on router.refresh().
 */
export function SupplierAdminPanel({
  suppliers,
  nextId,
  categories,
}: {
  suppliers: Supplier[];
  nextId: string;
  categories: string[];
}) {
  const [addOpen, setAddOpen] = useState(false);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Supplier master data</h2>
        <Button size="sm" onClick={() => setAddOpen(true)}>
          <Plus className="mr-1 h-4 w-4" />
          Add supplier
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        Adding a supplier changes the roster, so every period is recomputed on save —
        expect a few seconds. Suppliers are never deleted; retire one by deactivating it.
      </p>

      <AddSupplierCard
        open={addOpen}
        onOpenChange={setAddOpen}
        nextId={nextId}
        categories={categories}
      />
      <SupplierRosterTable suppliers={suppliers} />
    </div>
  );
}
