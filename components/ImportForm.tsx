"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
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

export function ImportForm() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [fileInputKey, setFileInputKey] = useState(0);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!file) return;

    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/imports/upload", {
        method: "POST",
        body: formData,
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        purchases?: number;
        periodsCreated?: string[];
      };

      if (res.ok) {
        const periods = (data.periodsCreated ?? []).join(", ");
        toast.success(
          `Imported ${data.purchases} purchases across periods: ${periods || "—"}`,
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
          Upload procurement data. Periods are detected automatically from the
          data.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
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
            Upload an Excel file with 3 sheets (Suppliers, Purchases,
            SupplierMetrics). The system will auto-detect years from the data and
            create periods accordingly.
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
