import { useIsMobile } from "@/hooks/use-mobile";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import UnifiedImportForm from "./UnifiedImportForm";
import ImportLogList from "./ImportLogList";

export default function ImportPanel({ open, onOpenChange, logs }) {
  const isMobile = useIsMobile();
  const body = (
    <div className="space-y-5">
      <UnifiedImportForm />
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