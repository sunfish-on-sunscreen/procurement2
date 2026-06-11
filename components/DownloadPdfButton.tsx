"use client";

import { useState } from "react";
import { toast } from "sonner";
import jsPDF from "jspdf";
import html2canvas from "html2canvas-pro";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";

export function DownloadPdfButton({ filename }: { filename: string }) {
  const [busy, setBusy] = useState(false);

  async function handleClick() {
    const root = document.getElementById("report-root");
    if (!root) {
      toast.error("Report content not found");
      return;
    }
    const sections = Array.from(
      root.querySelectorAll<HTMLElement>(".pdf-page-break"),
    );
    if (sections.length === 0) {
      toast.error("Nothing to export");
      return;
    }

    setBusy(true);
    try {
      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const margin = 10;
      const contentW = pageW - margin * 2;
      const usableH = pageH - margin * 2;
      let first = true;

      for (const section of sections) {
        const canvas = await html2canvas(section, {
          scale: 1.5,
          useCORS: true,
          logging: false,
          backgroundColor: "#ffffff",
        });
        const imgW = contentW;
        const fullImgH = (canvas.height * imgW) / canvas.width;

        if (fullImgH <= usableH) {
          if (!first) pdf.addPage();
          pdf.addImage(
            canvas.toDataURL("image/jpeg", 0.9),
            "JPEG",
            margin,
            margin,
            imgW,
            fullImgH,
          );
          first = false;
          continue;
        }

        // Section taller than one page: slice the canvas vertically.
        const pxPerPage = (usableH * canvas.width) / imgW;
        let y = 0;
        while (y < canvas.height) {
          const sliceH = Math.min(pxPerPage, canvas.height - y);
          const slice = document.createElement("canvas");
          slice.width = canvas.width;
          slice.height = sliceH;
          const ctx = slice.getContext("2d");
          if (ctx) {
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(0, 0, slice.width, slice.height);
            ctx.drawImage(
              canvas,
              0,
              y,
              canvas.width,
              sliceH,
              0,
              0,
              canvas.width,
              sliceH,
            );
          }
          const sliceImgH = (sliceH * imgW) / canvas.width;
          if (!first) pdf.addPage();
          pdf.addImage(
            slice.toDataURL("image/jpeg", 0.9),
            "JPEG",
            margin,
            margin,
            imgW,
            sliceImgH,
          );
          first = false;
          y += sliceH;
        }
      }

      pdf.save(filename);
      toast.success("PDF downloaded");
    } catch (err) {
      console.error("PDF generation failed:", err);
      toast.error("PDF generation failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button size="sm" onClick={handleClick} disabled={busy}>
      {busy ? (
        "Generating PDF…"
      ) : (
        <>
          <Download className="h-4 w-4" /> Download PDF
        </>
      )}
    </Button>
  );
}
