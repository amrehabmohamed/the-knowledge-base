import { useState } from "react";
import type { Citation } from "@/types/session";
import { CitationPanel } from "./CitationPanel";

interface CitationMarkerProps {
  index: number;
  citation: Citation;
}

export function CitationMarker({ index, citation }: CitationMarkerProps) {
  const [open, setOpen] = useState(false);

  const isWeb = citation.type === "web";

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={`inline-flex h-4 min-w-4 items-center justify-center rounded px-1 align-super text-[10px] font-medium ${
          isWeb
            ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-200"
            : "bg-blue-100 text-blue-700 hover:bg-blue-200"
        }`}
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
