import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { FileText, MoreVertical, Trash2 } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { DeleteNotebookDialog } from "./DeleteNotebookDialog";
import { formatRelativeTime, truncateText } from "@/lib/formatters";
import type { Notebook } from "@/types/notebook";

interface NotebookCardProps {
  notebook: Notebook;
}

export function NotebookCard({ notebook }: NotebookCardProps) {
  const [deleteOpen, setDeleteOpen] = useState(false);
  const navigate = useNavigate();

  const lastOpened = notebook.lastOpenedAt?.toDate
    ? formatRelativeTime(notebook.lastOpenedAt.toDate())
    : "Never";

  return (
    <>
      <Card
        className="cursor-pointer transition-shadow hover:shadow-md"
        onClick={() => navigate(`/notebooks/${notebook.id}`)}
      >
        <CardHeader>
          <div className="flex items-start justify-between">
            <CardTitle className="font-heading text-base font-medium">
              {notebook.name}
            </CardTitle>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={(e) => e.stopPropagation()}
                  />
                }
              >
                <MoreVertical className="h-4 w-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  className="text-destructive"
                  onClick={(e) => {
                    e.stopPropagation();
                    setDeleteOpen(true);
                  }}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          {notebook.description && (
            <CardDescription className="font-body text-sm">
              {truncateText(notebook.description, 50)}
            </CardDescription>
          )}
          <div className="flex items-center gap-3 pt-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <FileText className="h-3.5 w-3.5" />
              Sources
            </span>
            <span>Opened {lastOpened}</span>
          </div>
        </CardHeader>
      </Card>

      <DeleteNotebookDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        notebookId={notebook.id}
        notebookName={notebook.name}
      />
    </>
  );
}
