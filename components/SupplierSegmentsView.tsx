"use client";

import type { ClusteringResult, ClusterProfile } from "@/lib/analysis-types";
import { SEGMENT_COLORS } from "@/lib/chart-colors";
import { PcaScatterChart } from "@/components/charts/PcaScatterChart";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const FEATURES: { key: string; label: string; digits: number }[] = [
  { key: "onTimeDeliveryPct", label: "On-Time %", digits: 1 },
  { key: "defectRatePct", label: "Defect %", digits: 2 },
  { key: "rfxResponseRatePct", label: "RFx Resp %", digits: 1 },
  { key: "avgLeadTimeDays", label: "Lead Time (d)", digits: 1 },
  { key: "threeWayMatchPct", label: "3-Way Match %", digits: 1 },
  { key: "log_spend", label: "Log Spend", digits: 2 },
];

type SegmentName =
  | "Star Performers"
  | "Strategic Underperformers"
  | "Reliable Specialists"
  | "Tail Spenders";

function normalize(values: number[]): number[] {
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max === min) return values.map(() => 0.5);
  return values.map((v) => (v - min) / (max - min));
}

/** Bijectively map each cluster index to a segment name from its profile means. */
function assignSegments(profiles: ClusterProfile[]): Map<number, SegmentName> {
  const otd = normalize(profiles.map((p) => p.onTimeDeliveryPct));
  const rfx = normalize(profiles.map((p) => p.rfxResponseRatePct));
  const tw = normalize(profiles.map((p) => p.threeWayMatchPct));
  const defectInv = normalize(profiles.map((p) => -p.defectRatePct));
  const leadInv = normalize(profiles.map((p) => -p.avgLeadTimeDays));
  const perf = profiles.map(
    (_p, i) => (otd[i] + rfx[i] + tw[i] + defectInv[i] + leadInv[i]) / 5,
  );
  const spend = profiles.map((p) => p.log_spend);

  const out = new Map<number, SegmentName>();
  const remaining = new Set(profiles.map((_p, i) => i));
  const pick = (score: (i: number) => number, best: "max" | "min") =>
    [...remaining].reduce((a, b) =>
      best === "max"
        ? score(a) >= score(b)
          ? a
          : b
        : score(a) <= score(b)
          ? a
          : b,
    );

  const tail = pick((i) => spend[i], "min");
  out.set(profiles[tail].cluster, "Tail Spenders");
  remaining.delete(tail);

  const star = pick((i) => perf[i], "max");
  out.set(profiles[star].cluster, "Star Performers");
  remaining.delete(star);

  const under = pick((i) => spend[i], "max");
  out.set(profiles[under].cluster, "Strategic Underperformers");
  remaining.delete(under);

  const last = [...remaining][0];
  out.set(profiles[last].cluster, "Reliable Specialists");
  return out;
}

function blurb(name: SegmentName, p: ClusterProfile): string {
  const otd = p.onTimeDeliveryPct.toFixed(1);
  const defect = p.defectRatePct.toFixed(2);
  const rfx = p.rfxResponseRatePct.toFixed(1);
  const lead = p.avgLeadTimeDays.toFixed(1);
  switch (name) {
    case "Star Performers":
      return `${p.n_suppliers} suppliers with the strongest all-round performance — ${otd}% on-time delivery, just ${defect}% defects, and ${rfx}% RFx response. These are benchmark partners worth deepening relationships with.`;
    case "Strategic Underperformers":
      return `${p.n_suppliers} high-spend suppliers whose quality and service lag behind their spend exposure (${otd}% on-time, ${defect}% defects, ${lead}-day lead time). Given the dollars involved, these are the highest-priority improvement targets.`;
    case "Reliable Specialists":
      return `${p.n_suppliers} mid-spend suppliers with solid, consistent scores across delivery, quality, and process. Dependable performers that rarely cause issues.`;
    case "Tail Spenders":
      return `${p.n_suppliers} low-spend tail suppliers (${otd}% on-time, ${defect}% defects). Their limited spend makes them natural candidates for consolidation or simplified management.`;
  }
}

export function SupplierSegmentsView({
  clustering,
}: {
  clustering: ClusteringResult;
}) {
  const profiles = [...clustering.cluster_profiles].sort(
    (a, b) => a.cluster - b.cluster,
  );
  const segments = assignSegments(profiles);
  const segmentNames: Record<number, string> = {};
  segments.forEach((name, cluster) => {
    segmentNames[cluster] = name;
  });
  const tiers = Object.keys(clustering.tier_vs_cluster);
  const clusterIds = profiles.map((p) => p.cluster);

  // Max value per feature column (for bold highlight).
  const maxByFeature = new Map<string, number>();
  for (const f of FEATURES) {
    maxByFeature.set(f.key, Math.max(...profiles.map((p) => p[f.key] ?? 0)));
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Methodology</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          K-means clustering segments suppliers based on 6 features (delivery,
          quality, service, process, lead time, spend). Fixed k = 4 clusters. PCA
          reduces dimensions to 2D for visualization.
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Supplier Clusters (PCA projection)</CardTitle>
        </CardHeader>
        <CardContent>
          <PcaScatterChart
            data={clustering.cluster_assignments}
            explainedVariance={clustering.explained_variance}
            segmentNames={segmentNames}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Cluster Profiles</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cluster</TableHead>
                <TableHead>Segment</TableHead>
                <TableHead className="text-right">Suppliers</TableHead>
                {FEATURES.map((f) => (
                  <TableHead key={f.key} className="text-right">
                    {f.label}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {profiles.map((p) => (
                <TableRow key={p.cluster}>
                  <TableCell>
                    <span
                      className="inline-block h-3 w-3 rounded-full align-middle"
                      style={{
                        backgroundColor: SEGMENT_COLORS[segmentNames[p.cluster]],
                      }}
                    />{" "}
                    {p.cluster}
                  </TableCell>
                  <TableCell className="font-medium">
                    {segments.get(p.cluster)}
                  </TableCell>
                  <TableCell className="text-right">{p.n_suppliers}</TableCell>
                  {FEATURES.map((f) => {
                    const v = p[f.key] ?? 0;
                    const isMax = v === maxByFeature.get(f.key);
                    return (
                      <TableCell
                        key={f.key}
                        className={`text-right ${isMax ? "font-semibold text-foreground" : ""}`}
                      >
                        {v.toFixed(f.digits)}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {profiles.map((p) => {
          const name = segments.get(p.cluster)!;
          return (
            <Card
              key={p.cluster}
              style={{
                borderLeft: `4px solid ${SEGMENT_COLORS[name]}`,
              }}
            >
              <CardHeader className="pb-2">
                <CardTitle className="text-base">
                  {name}{" "}
                  <span className="text-sm font-normal text-muted-foreground">
                    (Cluster {p.cluster})
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                {blurb(name, p)}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Legacy Tier vs Cluster</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tier</TableHead>
                {clusterIds.map((c) => (
                  <TableHead key={c} className="text-right">
                    Cluster {c}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {tiers.map((tier) => (
                <TableRow key={tier}>
                  <TableCell className="font-medium">{tier}</TableCell>
                  {clusterIds.map((c) => (
                    <TableCell key={c} className="text-right">
                      {clustering.tier_vs_cluster[tier]?.[String(c)] ?? 0}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}
