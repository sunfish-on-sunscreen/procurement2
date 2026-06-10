import { requireAuth } from "@/lib/auth";
import { getAllPeriods, getCurrentPeriodId } from "@/lib/period";
import { getAnalysisResult, type AbcResult } from "@/lib/analysis-types";
import { EmptyState } from "@/components/EmptyState";
import { ABC_COLORS } from "@/lib/chart-colors";
import { ParetoChart } from "@/components/charts/ParetoChart";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const usdCompact = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

const pct1 = (fraction: number) => `${(fraction * 100).toFixed(1)}%`;
const ABC_CLASSES = ["A", "B", "C"] as const;

export default async function AbcAnalysisPage() {
  await requireAuth();
  const periodId = await getCurrentPeriodId();
  const periods = await getAllPeriods();
  const period = periods.find((p) => p.id === periodId);
  const abc = periodId
    ? await getAnalysisResult<AbcResult>(periodId, "abc")
    : null;

  const tiers = abc ? Object.keys(abc.crosstab) : [];

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">
        ABC Analysis{period ? ` — ${period.name}` : ""}
      </h1>

      {!abc ? (
        <EmptyState />
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Methodology</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              ABC classification (Pareto principle) ranks suppliers by spend. The
              top 80% of spend forms Class A, the next 15% forms Class B, and the
              bottom 5% forms Class C. Thresholds are fixed at 80% / 95%.
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {ABC_CLASSES.map((cls) => (
              <Card key={cls} style={{ borderLeft: `4px solid ${ABC_COLORS[cls]}` }}>
                <CardHeader className="pb-2">
                  <CardDescription>Class {cls}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-semibold">
                    {abc.summary[cls].n} suppliers
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {pct1(abc.summary[cls].pct_of_spend)} of spend
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Pareto Chart</CardTitle>
            </CardHeader>
            <CardContent>
              <ParetoChart data={abc.classifications} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Supplier Classification</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-right">Rank</TableHead>
                    <TableHead>Supplier</TableHead>
                    <TableHead>Tier</TableHead>
                    <TableHead>Class</TableHead>
                    <TableHead className="text-right">Total Spend</TableHead>
                    <TableHead className="text-right">% of Spend</TableHead>
                    <TableHead className="text-right">Cumulative %</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {abc.classifications.map((c) => (
                    <TableRow key={c.supplier_id}>
                      <TableCell className="text-right">{c.rank}</TableCell>
                      <TableCell className="font-medium">{c.supplier_name}</TableCell>
                      <TableCell>{c.tier}</TableCell>
                      <TableCell>
                        <Badge
                          style={{
                            backgroundColor: ABC_COLORS[c.abc_class],
                            color: "#fff",
                            borderColor: "transparent",
                          }}
                        >
                          {c.abc_class}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {usdCompact.format(c.total)}
                      </TableCell>
                      <TableCell className="text-right">{pct1(c.pct)}</TableCell>
                      <TableCell className="text-right">
                        {pct1(c.cumulative_pct)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Legacy Tier vs ABC Class</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tier</TableHead>
                    {ABC_CLASSES.map((cls) => (
                      <TableHead key={cls} className="text-right">
                        Class {cls}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tiers.map((tier) => (
                    <TableRow key={tier}>
                      <TableCell className="font-medium">{tier}</TableCell>
                      {ABC_CLASSES.map((cls) => (
                        <TableCell key={cls} className="text-right">
                          {abc.crosstab[tier]?.[cls] ?? 0}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
