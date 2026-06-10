import { requireAuth } from "@/lib/auth";
import { getAllPeriods, getCurrentPeriodSelection } from "@/lib/period";
import { Sidebar } from "@/components/Sidebar";
import { Header } from "@/components/Header";
import { Toaster } from "@/components/ui/sonner";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireAuth();
  const periods = await getAllPeriods();
  const selection = await getCurrentPeriodSelection();

  const periodOptions = periods.map((period) => ({
    id: period.id,
    name: period.name,
  }));

  return (
    <div className="flex min-h-screen flex-1">
      <Sidebar role={session.role} />
      <div className="flex flex-1 flex-col">
        <Header
          user={session}
          periods={periodOptions}
          selection={selection}
        />
        <main className="mx-auto w-full max-w-7xl flex-1 px-6 py-6">
          {children}
        </main>
      </div>
      <Toaster />
    </div>
  );
}
