import Link from "next/link";
import { requireAuth } from "@/lib/auth";
import { getAllPeriods, getCurrentPeriodSelection } from "@/lib/period";
import { getCategories } from "@/lib/suppliers";
import { prisma } from "@/lib/prisma";
import { ReportGenerator } from "@/components/Reports/ReportGenerator";
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
  const [selection, periods, categories, summaries] = await Promise.all([
    getCurrentPeriodSelection(),
    getAllPeriods(),
    getCategories(),
    prisma.executiveSummary.findMany({
      orderBy: { createdAt: "desc" },
      include: { generatedByUser: true, period: true },
    }),
  ]);

  const periodOptions = periods.map((p) => ({ id: p.id, name: p.name }));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Reports</h1>
        {session.role === "ADMIN" && (
          <ReportGenerator
            defaultPeriod={selection}
            periods={periodOptions}
            allCategories={categories}
          />
        )}
      </div>

      <p className="text-sm text-muted-foreground">
        Single-year reports are saved below. Range reports are generated fresh
        each time and downloaded as PDF — they are not saved to this list.
      </p>

      {summaries.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No saved reports yet.
            {session.role === "ADMIN"
              ? " Click “Generate Report”, pick a Single Year, and it will appear here."
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
                    {sm.period.name} &middot;{" "}
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
      )}
    </div>
  );
}
