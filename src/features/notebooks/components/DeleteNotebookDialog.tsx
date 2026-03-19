import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { deleteNotebook } from "../services/notebookService";

interface DeleteNotebookDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  notebookId: string;
  notebookName: string;
}

export function DeleteNotebookDialog({
  open,
  onOpenChange,
  notebookId,
  notebookName,
}: DeleteNotebookDialogProps) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  const handleDelete = async () => {
    setDeleting(true);
    setError("");
    try {
      await deleteNotebook(notebookId);
      onOpenChange(false);
    } catch {
      setError("Failed to delete notebook. Please try again.");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete Notebook</DialogTitle>
          <DialogDescription>
            Are you sure you want to delete <strong>{notebookName}</strong>? This
            will permanently remove all sources and chat history. This action
            cannot be undone.
          </DialogDescription>
        </DialogHeader>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={deleting}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={deleting}
          >
            {deleting ? "Deleting..." : "Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
