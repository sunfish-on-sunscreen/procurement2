import Link from "next/link";
import { Database } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export function EmptyState({
  message = "No analyses have been computed for this period yet.",
  ctaHref = "/import",
  ctaLabel = "Go to Import",
}: {
  message?: string;
  ctaHref?: string;
  ctaLabel?: string;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center gap-4 py-16 text-center">
        <Database className="h-10 w-10 text-muted-foreground" />
        <p className="max-w-md text-muted-foreground">{message}</p>
        <Link href={ctaHref} className={buttonVariants()}>
          {ctaLabel}
        </Link>
      </CardContent>
    </Card>
  );
}
