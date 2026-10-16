import { RefreshCw } from "lucide-react";

export default function SyncFab({ onClick, lastLog }) {
  return (
    <button
      onClick={onClick}
      className="fixed bottom-6 right-4 z-40 flex h-12 items-center gap-2.5 rounded-full bg-sleep px-5 text-sm font-semibold text-background shadow-[0_0_30px_hsl(var(--sleep)/0.45)] transition-transform hover:scale-105 sm:right-6 sm:h-14 sm:gap-3 sm:px-6 sm:text-base md:right-8"
    >
      <RefreshCw className="h-5 w-5 shrink-0" />
      {/* Anchored to the right edge the pill gets the full viewport width, so the
          label stays on one line; `truncate` keeps it from spilling out of the
          pill on a very narrow screen. */}
      <span className="truncate">Sync Huawei Health</span>
      {lastLog && (
        <span className={`h-2 w-2 shrink-0 rounded-full ${lastLog.status === "success" ? "bg-background" : "bg-danger"}`} />
      )}
    </button>
  );
}