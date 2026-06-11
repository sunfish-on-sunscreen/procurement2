import Link from "next/link";
import { requireAuth } from "@/lib/auth";
import { getCurrentPeriodSelection, resolveAnalysisSource } from "@/lib/period";
import { prisma } from "@/lib/prisma";
import { EmptyState } from "@/components/EmptyState";
import { GenerateButton } from "./GenerateButton";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default async function ReportsPage() {
  const session = await requireAuth();
  const selection = await getCurrentPeriodSelection();
  const source = await resolveAnalysisSource(selection);

  const label =
    source.kind === "cached" || source.kind === "range" ? source.periodLabel : "";

  let body: React.ReactNode;

  if (source.kind === "empty") {
    body = <EmptyState />;
  } else if (source.kind === "range") {
    body = (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          Reports are tied to specific periods. Switch to <strong>Single Year</strong>{" "}
          mode to generate or view reports.
        </CardContent>
      </Card>
    );
  } else {
    const summaries = await prisma.executiveSummary.findMany({
      where: { periodId: source.periodId },
      orderBy: { createdAt: "desc" },
      include: { generatedByUser: true },
    });

    body =
      summaries.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No summaries yet for {source.periodLabel}.
            {session.role === "ADMIN"
              ? " Click “Generate Summary” to create one."
              : ""}
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {summaries.map((sm) => (
            <Card key={sm.id}>
              <CardHeader className="flex flex-row items-center justify-between gap-4">
                <div className="min-w-0">
                  <CardTitle className="truncate text-base">{sm.title}</CardTitle>
                  <CardDescription>
                    {new Date(sm.createdAt).toLocaleString()} &middot; by{" "}
                    {sm.generatedByUser.name}
                  </CardDescription>
                </div>
                <Link
                  href={`/reports/${sm.id}`}
                  className={buttonVariants({ variant: "outline", size: "sm" })}
                >
                  View
                </Link>
              </CardHeader>
            </Card>
          ))}
        </div>
      );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">
          Reports{label ? ` — ${label}` : ""}
        </h1>
        {source.kind === "cached" && session.role === "ADMIN" && (
          <GenerateButton periodId={source.periodId} />
        )}
      </div>
      {body}
    </div>
  );
}
