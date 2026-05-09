import { useMemo, useState } from "react";
import { ChevronDown, Check, HelpCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  setClarificationState,
  useClarificationState,
} from "@/lib/clarificationStore";
import type { ClarificationRecord } from "@/types/session";

interface ClarificationCardProps {
  clarification: ClarificationRecord;
  /**
   * Called when the user submits answers. Receives a single natural-language
   * message string the parent should send via `sendMessage()` so the agent
   * picks up the conversation with full context on the next turn.
   */
  onSubmit?: (followUpMessage: string) => void;
}

/**
 * Build a tight natural-language follow-up from the answers map. The agent
 * reads it as a normal user message — no special parsing needed. Format chosen
 * so a Gemini model recognizes the structure and ties answers back to the
 * original questions by `key`.
 */
function composeFollowUp(
  questions: ClarificationRecord["questions"],
  answers: Record<string, string>,
): string {
  const lines: string[] = [];
  lines.push("My answers:");
  for (const q of questions) {
    const v = answers[q.key];
    if (v === undefined || v === "") continue;
    if (q.type === "select" && q.options) {
      const opt = q.options.find((o) => o.id === v);
      lines.push(`- ${q.key}: ${opt ? `${opt.label} (id: ${opt.id})` : v}`);
    } else {
      lines.push(`- ${q.key}: ${v}`);
    }
  }
  lines.push("");
  lines.push("Please proceed with the original request now that you have these.");
  return lines.join("\n");
}

export function ClarificationCard({
  clarification,
  onSubmit,
}: ClarificationCardProps) {
  const runtime = useClarificationState(clarification.clarificationId);
  const state = runtime?.state ?? "pending";
  const isPending = state === "pending";
  const [open, setOpen] = useState<boolean>(isPending);
  // Local form state — answers keyed by question.key.
  const [answers, setAnswers] = useState<Record<string, string>>(() => {
    const seed: Record<string, string> = {};
    for (const q of clarification.questions) {
      if (q.type === "select" && q.options && q.options.length > 0) {
        seed[q.key] = "";
      } else {
        seed[q.key] = "";
      }
    }
    return seed;
  });

  const allRequiredFilled = useMemo(() => {
    for (const q of clarification.questions) {
      if (q.required === false) continue;
      const v = answers[q.key];
      if (v === undefined || v === "") return false;
    }
    return true;
  }, [answers, clarification.questions]);

  const handleSubmit = () => {
    if (!isPending || !allRequiredFilled) return;
    setClarificationState(clarification.clarificationId, {
      state: "answered",
      answers,
    });
    setOpen(false);
    const followUp = composeFollowUp(clarification.questions, answers);
    onSubmit?.(followUp);
  };

  const headerClass =
    "flex w-full items-center gap-2 px-2.5 py-1.5 text-left " +
    (isPending ? "cursor-default" : "hover:bg-muted/60 cursor-pointer");

  return (
    <div
      className={
        "rounded-md border text-xs " +
        (isPending
          ? "border-sky-300/60 bg-sky-50/60 dark:border-sky-500/30 dark:bg-sky-500/5"
          : "border-border/60 bg-muted/30")
      }
    >
      <button
        type="button"
        onClick={() => !isPending && setOpen((o) => !o)}
        className={headerClass}
        disabled={isPending}
      >
        <HelpCircle
          className={
            "h-3.5 w-3.5 shrink-0 " +
            (isPending
              ? "text-sky-700 dark:text-sky-400"
              : "text-muted-foreground")
          }
        />
        <span className="font-medium text-foreground">
          {state === "answered" ? "Answered" : "Need a few details"}
        </span>
        {state === "answered" ? (
          <Check className="ml-auto h-3 w-3 text-green-600" />
        ) : !isPending ? (
          <ChevronDown
            className={
              "ml-auto h-3 w-3 text-muted-foreground transition-transform " +
              (open ? "rotate-180" : "")
            }
          />
        ) : null}
      </button>

      {open && (
        <div className="border-t border-border/60 px-3 py-2 space-y-2">
          {isPending && (
            <p className="font-body text-xs text-foreground/80">
              {clarification.reason}
            </p>
          )}
          <div className="space-y-2">
            {clarification.questions.map((q) => (
              <div key={q.key} className="space-y-1">
                <label
                  htmlFor={`clarq_${clarification.clarificationId}_${q.key}`}
                  className="block text-[11px] font-medium text-foreground"
                >
                  {q.prompt}
                  {q.required !== false && (
                    <span className="ml-1 text-red-500">*</span>
                  )}
                </label>
                {q.type === "select" && q.options ? (
                  <select
                    id={`clarq_${clarification.clarificationId}_${q.key}`}
                    value={answers[q.key] ?? ""}
                    disabled={!isPending}
                    onChange={(e) =>
                      setAnswers((prev) => ({
                        ...prev,
                        [q.key]: e.target.value,
                      }))
                    }
                    className="w-full rounded border border-border/60 bg-background px-2 py-1 text-xs"
                  >
                    <option value="">— pick one —</option>
                    {q.options.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                ) : q.type === "date" ? (
                  <input
                    id={`clarq_${clarification.clarificationId}_${q.key}`}
                    type="date"
                    value={answers[q.key] ?? ""}
                    disabled={!isPending}
                    onChange={(e) =>
                      setAnswers((prev) => ({
                        ...prev,
                        [q.key]: e.target.value,
                      }))
                    }
                    className="w-full rounded border border-border/60 bg-background px-2 py-1 text-xs"
                  />
                ) : (
                  <input
                    id={`clarq_${clarification.clarificationId}_${q.key}`}
                    type="text"
                    value={answers[q.key] ?? ""}
                    disabled={!isPending}
                    onChange={(e) =>
                      setAnswers((prev) => ({
                        ...prev,
                        [q.key]: e.target.value,
                      }))
                    }
                    className="w-full rounded border border-border/60 bg-background px-2 py-1 text-xs"
                  />
                )}
              </div>
            ))}
          </div>
          {state === "answered" && runtime?.answers && (
            <p className="flex items-center gap-1.5 text-[11px] text-green-700 dark:text-green-400">
              <Check className="h-3 w-3" />
              Sent to assistant
            </p>
          )}
          {isPending && (
            <div className="flex items-center gap-2 pt-1">
              <Button
                size="sm"
                onClick={handleSubmit}
                disabled={!allRequiredFilled}
              >
                Send answers
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function ClarificationList({
  clarifications,
  onSubmit,
}: {
  clarifications: ClarificationRecord[];
  onSubmit?: (followUpMessage: string) => void;
}) {
  if (!clarifications || clarifications.length === 0) return null;
  return (
    <div className="space-y-1.5">
      {clarifications.map((c) => (
        <ClarificationCard
          key={c.clarificationId}
          clarification={c}
          onSubmit={onSubmit}
        />
      ))}
    </div>
  );
}
