"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { CustomizeReportModal } from "@/components/Reports/CustomizeReportModal";
import {
  defaultReportConfig,
  EPHEMERAL_KEY,
  type ReportConfig,
} from "@/lib/report-config";
import type { PeriodSelection } from "@/lib/period-constants";

export function ReportGenerator({
  defaultPeriod,
  periods,
  allCategories,
}: {
  defaultPeriod: PeriodSelection;
  periods: { id: string; name: string }[];
  allCategories: string[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  async function onGenerate(config: ReportConfig) {
    const single = config.period.mode === "single";
    const endpoint = single
      ? "/api/reports/generate"
      : "/api/reports/generate-ephemeral";
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        redirect?: string;
        meta?: unknown;
      };
      if (!res.ok) {
        toast.error(data.error || "Generation failed");
        return;
      }
      if (single && data.redirect) {
        toast.success("Report generated");
        setOpen(false);
        router.push(data.redirect);
        router.refresh();
      } else if (!single && data.meta) {
        sessionStorage.setItem(EPHEMERAL_KEY, JSON.stringify(data));
        toast.success("Range report ready");
        setOpen(false);
        router.push("/reports/preview");
      } else {
        toast.error("Unexpected response");
      }
    } catch {
      toast.error("Generation failed");
    }
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>Generate Report</Button>
      {open && (
        <CustomizeReportModal
          open={open}
          onClose={() => setOpen(false)}
          initialConfig={defaultReportConfig(defaultPeriod, allCategories)}
          periods={periods}
          allCategories={allCategories}
          onGenerate={onGenerate}
        />
      )}
    </>
  );
}
