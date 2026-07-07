import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ImportForm } from "@/components/ImportForm";
import { SupplierRosterTable } from "@/components/SupplierRosterTable";
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

export default async function ImportPage() {
  await requireAdmin();

  // The supplier roster (one row per supplier) drives the roster table below and
  // the add-supplier card's id preview + category options. Re-derived on every
  // router.refresh(), so a just-added supplier appears immediately.
  const [imports, suppliers, poIds, unitRows] = await Promise.all([
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
    prisma.purchase.findMany({ select: { poId: true } }),
    prisma.purchase.findMany({ select: { unit: true }, distinct: ["unit"], orderBy: { unit: "asc" } }),
  ]);

  const nextId = nextSupplierId(suppliers.map((s) => s.externalId));
  const categories = [...new Set(suppliers.map((s) => s.category))].sort((a, b) =>
    a.localeCompare(b),
  );
  const nextPurchaseId = nextPoId(poIds.map((p) => p.poId));
  const supplierPicks = suppliers.map((s) => ({ id: s.externalId, name: s.supplierName }));
  const units = unitRows.map((u) => u.unit);

  return (
    <div className="flex flex-col gap-6">
      <ImportForm
        nextSupplierId={nextId}
        categories={categories}
        nextPoId={nextPurchaseId}
        suppliers={supplierPicks}
        units={units}
      />

      <SupplierRosterTable suppliers={suppliers} categories={categories} />

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
