import { useState } from "react";
import { Plus, BookOpen } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Loader } from "@/components/ui/loader";
import { useNotebooks } from "../hooks/useNotebooks";
import { NotebookCard } from "./NotebookCard";
import { CreateNotebookDialog } from "./CreateNotebookDialog";

export function NotebookListPage() {
  const { notebooks, loading, error } = useNotebooks();
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <AppLayout>
      <div className="mx-auto max-w-5xl px-6 py-8">
        <div className="mb-8 flex items-center justify-between">
          <h2 className="font-heading text-2xl font-semibold">Notebooks</h2>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="mr-1.5 h-4 w-4" />
            New Notebook
          </Button>
        </div>

        {loading ? (
          <div className="flex justify-center py-20">
            <Loader variant="circular" size="lg" />
          </div>
        ) : error ? (
          <div className="py-20 text-center">
            <p className="text-sm text-destructive">
              Failed to load notebooks. Please refresh.
            </p>
          </div>
        ) : notebooks.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <BookOpen className="mb-4 h-12 w-12 text-muted-foreground/50" />
            <h3 className="font-heading text-lg font-medium text-foreground">
              No notebooks yet
            </h3>
            <p className="font-body mt-1 text-sm text-muted-foreground">
              Create your first notebook to start organizing your knowledge.
            </p>
            <Button className="mt-4" onClick={() => setCreateOpen(true)}>
              <Plus className="mr-1.5 h-4 w-4" />
              Create Notebook
            </Button>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {notebooks.map((notebook) => (
              <NotebookCard key={notebook.id} notebook={notebook} />
            ))}
          </div>
        )}
      </div>

      <CreateNotebookDialog open={createOpen} onOpenChange={setCreateOpen} />
    </AppLayout>
  );
}
