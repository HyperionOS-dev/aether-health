import { RefreshCw } from "lucide-react";

export default function SyncFab({ onClick, lastLog }) {
  return (
    <button
      onClick={onClick}
      className="fixed bottom-6 left-1/2 z-40 flex h-14 -translate-x-1/2 items-center gap-3 rounded-full bg-sleep px-6 font-semibold text-background shadow-[0_0_30px_hsl(var(--sleep)/0.45)] transition-transform hover:scale-105 md:left-auto md:right-8 md:translate-x-0"
    >
      <RefreshCw className="h-5 w-5" />
      Sync Huawei Health
      {lastLog && (
        <span className={`h-2 w-2 rounded-full ${lastLog.status === "success" ? "bg-background" : "bg-danger"}`} />
      )}
    </button>
  );
}