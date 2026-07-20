import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { nextSupplierId } from "@/lib/supplier-import";
import { SupplierAdminPanel } from "@/components/SupplierAdminPanel";
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

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-lg border border-border bg-muted/40 p-4">
        <h1 className="text-lg font-semibold">Data management</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Supplier master data is editable below — every change is recorded in the
          audit trail. Transactional data (purchase orders and their receipt /
          invoice / payment chain) and the Excel upload are still loaded from the
          seed dataset.
        </p>
        <div className="mt-3 flex flex-wrap gap-4 text-sm">
          <span><span className="font-semibold">{supplierCount}</span> suppliers</span>
          <span><span className="font-semibold">{poCount}</span> purchase orders</span>
          <span><span className="font-semibold">{lineCount}</span> order lines</span>
        </div>
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
