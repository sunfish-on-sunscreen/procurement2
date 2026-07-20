import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { nextSupplierId } from "@/lib/supplier-import";
import { SupplierAdminPanel } from "@/components/SupplierAdminPanel";
import { DatasetImportCard } from "@/components/DatasetImportCard";
import { RecordPurchaseCard } from "@/components/RecordPurchaseCard";
import { SupplierAppendCard } from "@/components/SupplierAppendCard";
import { TransactionAppendCard } from "@/components/TransactionAppendCard";
import { CorrectionCard } from "@/components/CorrectionCard";
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

/**
 * Admin data page.
 *
 * Supplier MASTER DATA is editable here (add / edit / deactivate), each change
 * recorded in SupplierChangeLog. Transactional data (POs and the document chain)
 * and the Excel upload are still loaded via the seed + `python/seed_compute.py` —
 * those write paths are rebuilt in later phases.
 */
export default async function ImportPage() {
  await requireAdmin();

  const [suppliers, supplierCount, poCount, lineCount, imports, changeLog] = await Promise.all([
    prisma.supplier.findMany({
      orderBy: { id: "asc" },
      select: {
        id: true,
        supplierName: true,
        country: true,
        category: true,
        status: true,
        isMiningService: true,
      },
    }),
    prisma.supplier.count(),
    prisma.purchaseOrder.count(),
    prisma.poLine.count(),
    prisma.import.findMany({
      take: 20,
      orderBy: { uploadedAt: "desc" },
      include: { period: true },
    }),
    prisma.supplierChangeLog.findMany({
      take: 25,
      orderBy: { changedAt: "desc" },
      include: {
        user: { select: { email: true } },
        supplier: { select: { supplierName: true } },
      },
    }),
  ]);

  const nextId = nextSupplierId(suppliers.map((s) => s.id));
  const categories = [...new Set(suppliers.map((s) => s.category))].sort();

  // Vocabularies for the record-purchase form, sourced from the existing data so
  // new transactions reuse the established values rather than inventing new ones.
  const [frameworks, lineFacets, grnFacets, prFacets] = await Promise.all([
    prisma.framework.findMany({
      where: { status: "active" },
      select: { id: true, supplierId: true, title: true },
      orderBy: { id: "asc" },
    }),
    prisma.poLine.findMany({ select: { category: true, unit: true }, distinct: ["category", "unit"] }),
    prisma.goodsReceipt.findMany({ select: { site: true, receivedBy: true }, distinct: ["site", "receivedBy"] }),
    prisma.requisition.findMany({ select: { department: true, requester: true }, distinct: ["department", "requester"] }),
  ]);

  const corrections = await prisma.correction.findMany({
    take: 25,
    orderBy: { createdAt: "desc" },
    include: {
      user: { select: { email: true } },
      poLines: { select: { id: true, quantityOrdered: true, unitPriceUsd: true } },
      invoiceLines: { select: { id: true, quantityBilled: true, unitPriceUsd: true } },
      grnLines: { select: { id: true, defectCount: true } },
    },
  });
  const uniqSorted = (xs: string[]) => [...new Set(xs)].filter(Boolean).sort();

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-lg border border-border bg-muted/40 p-4">
        <h1 className="text-lg font-semibold">Data management</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Supplier master data is editable below — every change is recorded in the
          audit trail. Purchases are recorded as a complete document chain, and the
          full 12-sheet dataset can be re-imported from Excel — which replaces all
          transactional data.
        </p>
        <div className="mt-3 flex flex-wrap gap-4 text-sm">
          <span><span className="font-semibold">{supplierCount}</span> suppliers</span>
          <span><span className="font-semibold">{poCount}</span> purchase orders</span>
          <span><span className="font-semibold">{lineCount}</span> order lines</span>
        </div>
      </div>

      <DatasetImportCard />

      <SupplierAppendCard />

      <TransactionAppendCard />

      <RecordPurchaseCard
        suppliers={suppliers
          .filter((s) => s.status === "active")
          .map((s) => ({ id: s.id, name: s.supplierName, category: s.category }))}
        frameworks={frameworks}
        categories={uniqSorted(lineFacets.map((l) => l.category))}
        units={uniqSorted(lineFacets.map((l) => l.unit))}
        sites={uniqSorted(grnFacets.map((g) => g.site))}
        receivers={uniqSorted(grnFacets.map((g) => g.receivedBy))}
        departments={uniqSorted(prFacets.map((p) => p.department))}
        requesters={uniqSorted(prFacets.map((p) => p.requester))}
      />

      <CorrectionCard />

      <div className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Correction ledger</h2>
        {corrections.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No corrections posted. Originals stay exactly as posted; a correction appends
            a signed adjustment beside them.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Purchase order</TableHead>
                <TableHead>Rows appended</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>By</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {corrections.map((c) => {
                const rows = [
                  ...c.poLines.map((l) => `${l.id} (qty ${l.quantityOrdered})`),
                  ...c.invoiceLines.map((l) => `${l.id} (${l.quantityBilled} @ ${l.unitPriceUsd})`),
                  ...c.grnLines.map((l) => `${l.id} (defects ${l.defectCount})`),
                ];
                return (
                  <TableRow key={c.id}>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {formatDate(c.createdAt)}
                    </TableCell>
                    <TableCell className="capitalize">{c.kind}</TableCell>
                    <TableCell className="font-mono text-xs">{c.poId}</TableCell>
                    <TableCell className="font-mono text-[11px] text-muted-foreground">
                      {rows.map((r) => (
                        <div key={r}>{r}</div>
                      ))}
                    </TableCell>
                    <TableCell className="max-w-[280px] text-xs">{c.reason}</TableCell>
                    <TableCell className="text-muted-foreground">{c.user.email}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>

      <div className="overflow-x-auto">
        <SupplierAdminPanel
          suppliers={suppliers}
          nextId={nextId}
          categories={categories}
        />
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Master-data audit trail</h2>
        {changeLog.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No supplier changes recorded yet.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Field</TableHead>
                <TableHead>Before</TableHead>
                <TableHead>After</TableHead>
                <TableHead>By</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {changeLog.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {formatDate(c.changedAt)}
                  </TableCell>
                  <TableCell className="font-medium">
                    {c.supplier.supplierName}
                    <span className="text-muted-foreground"> · {c.supplierId}</span>
                  </TableCell>
                  <TableCell className="capitalize">{c.action}</TableCell>
                  <TableCell className="font-mono text-xs">{c.field ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{c.oldValue ?? "—"}</TableCell>
                  <TableCell>{c.newValue ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{c.user.email}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Recent Imports</h2>
        {imports.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No import records. Data is loaded via the seed in this build.
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
