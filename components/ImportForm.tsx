"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export type PeriodOption = { id: string; name: string };

export function ImportForm({
  periods,
  currentPeriodId,
}: {
  periods: PeriodOption[];
  currentPeriodId: string | null;
}) {
  const router = useRouter();
  const [selectedPeriodId, setSelectedPeriodId] = useState<string | null>(
    currentPeriodId,
  );
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  // Bump to remount (clear) the file input after a successful upload.
  const [fileInputKey, setFileInputKey] = useState(0);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!file || !selectedPeriodId) return;

    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("periodId", selectedPeriodId);

      const res = await fetch("/api/imports/upload", {
        method: "POST",
        body: formData,
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        suppliers?: number;
        purchases?: number;
        metrics?: number;
      };

      if (res.ok) {
        toast.success(
          `Import successful: ${data.suppliers} suppliers, ${data.purchases} purchases, ${data.metrics} metrics`,
        );
        setFile(null);
        setFileInputKey((key) => key + 1);
        router.refresh();
      } else {
        toast.error(data.error || "Import failed");
      }
    } catch {
      toast.error("Import failed");
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Import data</CardTitle>
        <CardDescription>
          Upload procurement data for a reporting period.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label>Reporting period</Label>
            <Select
              items={periods.map((period) => ({
                value: period.id,
                label: period.name,
              }))}
              value={selectedPeriodId ?? undefined}
              onValueChange={(value) => setSelectedPeriodId(value)}
            >
              <SelectTrigger className="w-[260px]">
                <SelectValue placeholder="Select period" />
              </SelectTrigger>
              <SelectContent>
                {periods.map((period) => (
                  <SelectItem key={period.id} value={period.id}>
                    {period.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="file">Excel file (.xlsx)</Label>
            <Input
              key={fileInputKey}
              id="file"
              type="file"
              accept=".xlsx"
              className="cursor-pointer"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
          </div>

          <p className="text-sm text-muted-foreground">
            Upload a single Excel file with 3 sheets: Suppliers, Purchases,
            SupplierMetrics. Sheet names must match exactly (case-sensitive).
          </p>

          <div className="flex items-center gap-4">
            <Button type="submit" disabled={!file || isUploading}>
              {isUploading ? "Uploading..." : "Upload"}
            </Button>
            <a
              href="/api/sample-data"
              download
              className="text-sm text-primary underline-offset-4 hover:underline"
            >
              Download sample data
            </a>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
