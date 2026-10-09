import { useIsMobile } from "@/hooks/use-mobile";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { useState } from "react";
import ImportForm from "./ImportForm";
import GadgetbridgeForm from "./GadgetbridgeForm";
import ImportLogList from "./ImportLogList";

export default function ImportPanel({ open, onOpenChange, logs }) {
  const isMobile = useIsMobile();
  const [source, setSource] = useState("huawei");
  const body = (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-1 rounded-xl border border-hairline p-1">
        {[["huawei", "Huawei Health"], ["gadgetbridge", "Gadgetbridge"]].map(([id, label]) => (
          <button
            key={id}
            onClick={() => setSource(id)}
            className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${source === id ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            {label}
          </button>
        ))}
      </div>
      {source === "huawei" ? <ImportForm /> : <GadgetbridgeForm />}
      <ImportLogList logs={logs} />
    </div>
  );
  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent className="max-h-[90vh] border-hairline bg-card">
          <DrawerHeader><DrawerTitle className="font-heading">Sync health data</DrawerTitle></DrawerHeader>
          <div className="overflow-y-auto px-4 pb-8">{body}</div>
        </DrawerContent>
      </Drawer>
    );
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto border-hairline bg-card sm:max-w-md">
        <DialogHeader><DialogTitle className="font-heading">Sync health data</DialogTitle></DialogHeader>
        {body}
      </DialogContent>
    </Dialog>
  );
}