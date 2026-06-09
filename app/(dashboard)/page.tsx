import { requireAuth } from "@/lib/auth";
import { getAllPeriods, getCurrentPeriodId } from "@/lib/period";

export default async function OverviewPage() {
  const session = await requireAuth();
  const periods = await getAllPeriods();
  const currentPeriodId = await getCurrentPeriodId();
  const current = periods.find((period) => period.id === currentPeriodId);

  return (
    <div className="flex flex-col gap-2">
      <h1 className="text-2xl font-semibold">Welcome, {session.name}!</h1>
      <p className="text-muted-foreground">
        Current period: {current?.name ?? "—"}
      </p>
    </div>
  );
}
