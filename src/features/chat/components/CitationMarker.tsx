import { useState } from "react";
import type { Citation } from "@/types/session";
import { CitationPanel } from "./CitationPanel";

interface CitationMarkerProps {
  index: number;
  citation: Citation;
}

export function CitationMarker({ index, citation }: CitationMarkerProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex h-4 min-w-4 items-center justify-center rounded bg-blue-100 px-1 align-super text-[10px] font-medium text-blue-700 hover:bg-blue-200"
      >
        {index}
      </button>
      {open && (
        <CitationPanel
          citation={citation}
          open={open}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
