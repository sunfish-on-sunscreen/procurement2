"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export function GenerateButton({ periodId }: { periodId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function handleClick() {
    setBusy(true);
    toast("Generating summary…");
    try {
      const res = await fetch("/api/reports/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ periodId }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        redirect?: string;
      };
      if (res.ok && data.redirect) {
        toast.success("Summary generated");
        router.push(data.redirect);
        router.refresh();
      } else {
        toast.error(data.error || "Generation failed");
        setBusy(false);
      }
    } catch {
      toast.error("Generation failed");
      setBusy(false);
    }
  }

  return (
    <Button onClick={handleClick} disabled={busy}>
      {busy ? "Generating…" : "Generate Summary"}
    </Button>
  );
}
