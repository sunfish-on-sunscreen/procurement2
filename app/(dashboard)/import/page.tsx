import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
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
 * Admin data page — READ-ONLY in the normalized-data-model build.
 *
 * The old add/edit/delete/upload flows assumed the flat single-table schema and
 * are disabled (their API routes return 501). Data is loaded via the seed
 * (`prisma db seed`) + the post-seed compute (`python/seed_compute.py`). This page
 * now just surfaces the current roster + recent imports for reference.
 */
export default async function ImportPage() {
  await requireAdmin();

  const [suppliers, supplierCount, poCount, lineCount, imports] = await Promise.all([
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
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-lg border border-border bg-muted/40 p-4">
        <h1 className="text-lg font-semibold">Data management</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          This build uses the normalized document data model. Manual add / edit /
          delete / Excel upload are disabled — data is loaded from the seed
          dataset. The roster below is read-only.
        </p>
        <div className="mt-3 flex flex-wrap gap-4 text-sm">
          <span><span className="font-semibold">{supplierCount}</span> suppliers</span>
          <span><span className="font-semibold">{poCount}</span> purchase orders</span>
          <span><span className="font-semibold">{lineCount}</span> order lines</span>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Supplier roster</h2>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead>Country</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Mining service</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {suppliers.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">{s.id}</TableCell>
                  <TableCell>{s.supplierName}</TableCell>
                  <TableCell>{s.country}</TableCell>
                  <TableCell>{s.category}</TableCell>
                  <TableCell>{s.status}</TableCell>
                  <TableCell>{s.isMiningService ? "Yes" : "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
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
