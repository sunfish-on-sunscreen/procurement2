"use client";

import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Triggers the browser's native print-to-PDF (window.print()). The report's print
 * layout lives in the `@media print` block in app/globals.css — so the PDF has real
 * selectable text, vector charts, and correct pagination, with no bitmap
 * rasterisation of the DOM. `filename` seeds the print dialog's default Save-as-PDF
 * name via document.title (restored on `afterprint`).
 */
export function DownloadPdfButton({ filename }: { filename: string }) {
  function handlePrint() {
    const previous = document.title;
    document.title = filename.replace(/\.pdf$/i, "") || previous;
    const restore = () => {
      document.title = previous;
      window.removeEventListener("afterprint", restore);
    };
    window.addEventListener("afterprint", restore);
    window.print();
  }

  return (
    <Button size="sm" onClick={handlePrint}>
      <Download className="h-4 w-4" /> Download PDF
    </Button>
  );
}
