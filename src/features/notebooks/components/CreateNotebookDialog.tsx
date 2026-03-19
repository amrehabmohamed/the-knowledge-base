import { useState, type FormEvent } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  MAX_NOTEBOOK_NAME_LENGTH,
  MAX_NOTEBOOK_DESC_LENGTH,
} from "@/config/constants";
import { createNotebook } from "../services/notebookService";
import { useAuthContext } from "@/features/auth";
import { useNavigate } from "react-router-dom";

interface CreateNotebookDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateNotebookDialog({
  open,
  onOpenChange,
}: CreateNotebookDialogProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const { user } = useAuthContext();
  const navigate = useNavigate();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");

    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Name is required.");
      return;
    }
    if (trimmedName.length > MAX_NOTEBOOK_NAME_LENGTH) {
      setError(`Name must be ${MAX_NOTEBOOK_NAME_LENGTH} characters or less.`);
      return;
    }

    if (!user) return;

    setSubmitting(true);
    try {
      const notebookId = await createNotebook(
        { name: trimmedName, description: description.trim() },
        user.uid
      );
      onOpenChange(false);
      resetForm();
      navigate(`/notebooks/${notebookId}`);
    } catch {
      setError("Failed to create notebook. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const resetForm = () => {
    setName("");
    setDescription("");
    setError("");
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) resetForm();
    onOpenChange(nextOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Notebook</DialogTitle>
          <DialogDescription>
            Create a new notebook to organize your knowledge.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="notebook-name">Name</Label>
              <span className="text-xs text-muted-foreground">
                {name.length}/{MAX_NOTEBOOK_NAME_LENGTH}
              </span>
            </div>
            <Input
              id="notebook-name"
              placeholder="My Notebook"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={MAX_NOTEBOOK_NAME_LENGTH}
              required
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="notebook-description">
                Description{" "}
                <span className="text-muted-foreground">(optional)</span>
              </Label>
              <span className="text-xs text-muted-foreground">
                {description.length}/{MAX_NOTEBOOK_DESC_LENGTH}
              </span>
            </div>
            <textarea
              id="notebook-description"
              placeholder="What is this notebook about?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={MAX_NOTEBOOK_DESC_LENGTH}
              rows={3}
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Creating..." : "Create Notebook"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
