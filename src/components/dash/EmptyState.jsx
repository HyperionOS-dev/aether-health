import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import DualDial from "./DualDial";

export default function EmptyState({ onImport }) {
  return (
    <div className="flex flex-col items-center gap-6 py-10 text-center">
      <div className="w-64 opacity-60"><DualDial strain={null} recovery={null} /></div>
      <div>
        <h1 className="font-display text-3xl font-bold sm:text-4xl">Bring in your Huawei Health data</h1>
        <p className="mx-auto mt-2 max-w-md text-muted-foreground">
          Upload your Huawei Health export and we'll calculate your daily Strain, Recovery and Sleep Performance.
        </p>
      </div>
      <Button onClick={onImport} className="h-12 rounded-full bg-sleep px-6 text-background hover:bg-sleep/90">
        <Upload className="mr-2 h-4 w-4" />Import Huawei Health data
      </Button>
    </div>
  );
}