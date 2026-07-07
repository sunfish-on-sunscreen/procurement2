import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ImportForm } from "@/components/ImportForm";
import { SupplierRosterTable } from "@/components/SupplierRosterTable";
import { PurchaseRosterTable, type PurchaseRow } from "@/components/PurchaseRosterTable";
import { nextSupplierId } from "@/lib/supplier-import";
import { nextPoId } from "@/lib/purchase-import";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type BadgeVariant = "default" | "destructive" | "secondary" | "outline";

const STATUS_VARIANT: Record<string, BadgeVariant> = {
  SUCCESS: "default",
  FAILED: "destructive",
  PROCESSING: "secondary",
  PENDING: "outline",
};

function formatDate(value: Date | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

/** DateTime -> YYYY-MM-DD (UTC, matching how the dates were stored/parsed). */
const iso = (d: Date): string => d.toISOString().slice(0, 10);

export default async function ImportPage() {
  await requireAdmin();

  // The supplier roster (one row per supplier) drives the roster table below and
  // the add-supplier card's id preview + category options. Re-derived on every
  // router.refresh(), so a just-added supplier appears immediately.
  const [imports, suppliers, purchaseRows] = await Promise.all([
    prisma.import.findMany({
      take: 20,
      orderBy: { uploadedAt: "desc" },
      include: { period: true },
    }),
    prisma.supplier.findMany({
      select: { externalId: true, supplierName: true, country: true, category: true },
      distinct: ["externalId"],
      orderBy: { externalId: "asc" },
    }),
    // All purchases (full field set — display uses a subset, the edit card uses
    // the rest). Client-side filtered + paginated in PurchaseRosterTable.
    prisma.purchase.findMany({
      orderBy: { poId: "asc" },
      select: {
        poId: true, supplierExternalId: true, supplierName: true, category: true,
        itemName: true, unit: true, quantity: true, unitPriceUsd: true, totalValueUsd: true,
        defectCount: true, complaintCount: true, onTimeDelivery: true, threeWayMatchPass: true,
        prDate: true, poDate: true, deliveryDate: true, invoiceDate: true, paymentDate: true,
      },
    }),
  ]);

  const purchases: PurchaseRow[] = purchaseRows.map((p) => ({
    poId: p.poId,
    supplierExternalId: p.supplierExternalId,
    supplierName: p.supplierName,
    category: p.category,
    itemName: p.itemName,
    unit: p.unit,
    quantity: p.quantity,
    unitPriceUsd: p.unitPriceUsd,
    totalValueUsd: p.totalValueUsd,
    defectCount: p.defectCount,
    complaintCount: p.complaintCount,
    onTimeDelivery: p.onTimeDelivery,
    threeWayMatchPass: p.threeWayMatchPass,
    prDate: iso(p.prDate),
    poDate: iso(p.poDate),
    deliveryDate: iso(p.deliveryDate),
    invoiceDate: iso(p.invoiceDate),
    paymentDate: iso(p.paymentDate),
  }));

  const nextId = nextSupplierId(suppliers.map((s) => s.externalId));
  const categories = [...new Set(suppliers.map((s) => s.category))].sort((a, b) =>
    a.localeCompare(b),
  );
  const nextPurchaseId = nextPoId(purchases.map((p) => p.poId));
  const supplierPicks = suppliers.map((s) => ({ id: s.externalId, name: s.supplierName }));
  const units = [...new Set(purchases.map((p) => p.unit))].sort((a, b) => a.localeCompare(b));
  const purchasePicks = purchases.map((p) => ({
    poId: p.poId,
    supplierExternalId: p.supplierExternalId,
    supplierName: p.supplierName,
    itemName: p.itemName,
  }));
  // supplierExternalId -> distinct existing item names (scopes the purchase card's
  // Item combobox suggestions to the selected supplier).
  const itemsBySupplier = new Map<string, Set<string>>();
  for (const p of purchases) {
    let set = itemsBySupplier.get(p.supplierExternalId);
    if (!set) {
      set = new Set();
      itemsBySupplier.set(p.supplierExternalId, set);
    }
    set.add(p.itemName);
  }
  const supplierItems: Record<string, string[]> = {};
  for (const [sid, set] of itemsBySupplier) {
    supplierItems[sid] = [...set].sort((a, b) => a.localeCompare(b));
  }

  return (
    <div className="flex flex-col gap-6">
      <ImportForm
        nextSupplierId={nextId}
        categories={categories}
        nextPoId={nextPurchaseId}
        suppliers={supplierPicks}
        units={units}
        purchases={purchasePicks}
        supplierItems={supplierItems}
      />

      <SupplierRosterTable suppliers={suppliers} categories={categories} />

      <PurchaseRosterTable
        purchases={purchases}
        suppliers={supplierPicks}
        units={units}
        supplierItems={supplierItems}
      />

      <div className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Recent Imports</h2>
        {imports.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No imports yet. Upload your first Excel file above.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Filename</TableHead>
                <TableHead>Period</TableHead>
                <TableHead>Sheet</TableHead>
                <TableHead className="text-right">Rows</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Uploaded At</TableHead>
                <TableHead>Processed At</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {imports.map((imp) => (
                <TableRow key={imp.id}>
                  <TableCell className="font-medium">{imp.filename}</TableCell>
                  <TableCell>{imp.period.name}</TableCell>
                  <TableCell>{imp.fileType}</TableCell>
                  <TableCell className="text-right">{imp.rowCount}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[imp.status] ?? "outline"}>
                      {imp.status}
                    </Badge>
                  </TableCell>
                  <TableCell>{formatDate(imp.uploadedAt)}</TableCell>
                  <TableCell>{formatDate(imp.processedAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
