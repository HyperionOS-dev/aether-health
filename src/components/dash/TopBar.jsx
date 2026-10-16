import { ChevronLeft, ChevronRight, Home as HomeIcon, Calendar } from "lucide-react";
import { NavLink } from "react-router-dom";
import { addDays, format, parseISO, formatDistanceToNow } from "date-fns";
import { dateLabel, todayStr } from "@/lib/metrics";
import SettingsDialog from "@/components/settings/SettingsDialog";
import { useDemoMode } from "@/hooks/useDemoMode";

const NAV = [
  { to: "/", label: "Home", end: true, icon: HomeIcon },
  { to: "/activity", label: "Activity", icon: Calendar },
];

export default function TopBar({ date, onDate, lastLog }) {
  const shift = (n) => onDate(format(addDays(parseISO(date), n), "yyyy-MM-dd"));
  const atToday = date >= todayStr();
  const synced = lastLog?.status === "success";
  const demo = useDemoMode();
  return (
    <header className="sticky top-0 z-30 border-b border-hairline bg-background/90 backdrop-blur">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-3 sm:h-16 sm:flex-nowrap sm:px-6 sm:py-0">
        <div className="flex min-w-0 items-center gap-2">
          <span className="font-display text-lg font-bold tracking-[0.3em] text-sleep">AETHER</span>
          {demo && (
            <span className="rounded-full border border-sleep/40 bg-sleep/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-sleep">
              {demo === "sparse" ? "Demo · sparse" : "Demo data"}
            </span>
          )}
        </div>
        <div className="order-last flex w-full items-center justify-center rounded-xl bg-card p-1 sm:order-none sm:w-auto sm:justify-start">
          <button onClick={() => shift(-1)} className="flex h-10 w-10 items-center justify-center rounded-lg hover:bg-surface" aria-label="Previous day">
            <ChevronLeft className="h-5 w-5" />
          </button>
          <span className="min-w-[96px] rounded-lg bg-surface px-3 py-2 text-center text-xs font-semibold uppercase tracking-[1.5px]">
            {dateLabel(date)}
          </span>
          <button onClick={() => shift(1)} disabled={atToday} className="flex h-10 w-10 items-center justify-center rounded-lg hover:bg-surface disabled:opacity-30" aria-label="Next day">
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div className="flex items-center gap-2 rounded-full border border-hairline px-3 py-1.5 text-xs text-muted-foreground">
            <span className={`h-2 w-2 rounded-full ${synced ? "bg-recovery shadow-[0_0_8px_hsl(var(--recovery))]" : "bg-muted-foreground"}`} />
            <span className="hidden sm:inline">
              Huawei Health · {lastLog ? formatDistanceToNow(new Date(lastLog.created_date), { addSuffix: true }) : "not synced"}
            </span>
          </div>
          <SettingsDialog />
        </div>
      </div>
      <nav className="mx-auto flex max-w-7xl gap-1 px-4 sm:px-6">
        {NAV.map((n) => {
          const Icon = n.icon;
          return (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                `flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-xs font-semibold uppercase tracking-[1.5px] transition-colors ${
                  isActive ? "border-sleep text-sleep" : "border-transparent text-muted-foreground hover:text-foreground"
                }`
              }
            >
              {Icon && <Icon className="h-3.5 w-3.5" />}
              {n.label}
            </NavLink>
          );
        })}
      </nav>
    </header>
  );
}