import { requireAdmin } from "@/lib/auth";
import { getAllPeriods, getCurrentPeriodSelection } from "@/lib/period";
import {
  getSupplierCategoryMap,
  getSupplierDirectory,
} from "@/lib/suppliers";
import { ReportEditor } from "@/components/Reports/ReportEditor";

// The universal report editor (Batch 6a). Admin-only: it can persist reports.
export default async function ReportPreviewPage() {
  const session = await requireAdmin();
  const [selection, periods, supplierCategory, supplierDirectory] =
    await Promise.all([
      getCurrentPeriodSelection(),
      getAllPeriods(),
      getSupplierCategoryMap(),
      getSupplierDirectory(),
    ]);

  const periodOptions = periods.map((p) => ({ id: p.id, name: p.name }));

  return (
    <ReportEditor
      defaultPeriod={selection}
      periods={periodOptions}
      supplierCategory={supplierCategory}
      supplierDirectory={supplierDirectory}
      generatedBy={session.name}
    />
  );
}
