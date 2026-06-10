"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PeriodSelector, type PeriodOption } from "@/components/PeriodSelector";
import type { SessionData } from "@/lib/session";
import type { PeriodSelection } from "@/lib/period-constants";

export function Header({
  user,
  periods,
  selection,
}: {
  user: SessionData;
  periods: PeriodOption[];
  selection: PeriodSelection;
}) {
  const router = useRouter();

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b bg-background px-6">
      <div className="flex items-center gap-3">
        <PeriodSelector periods={periods} selection={selection} />
      </div>
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium">{user.name}</span>
        <Badge variant={user.role === "ADMIN" ? "destructive" : "secondary"}>
          {user.role}
        </Badge>
        <Button variant="outline" size="sm" onClick={handleLogout}>
          Logout
        </Button>
      </div>
    </header>
  );
}
