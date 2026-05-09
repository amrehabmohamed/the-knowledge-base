import { useState, useCallback, useEffect, useRef } from "react";
import { addDoc, updateDoc, increment, serverTimestamp } from "firebase/firestore";
import { getMessagesCollection, getSessionRef } from "@/lib/firestore";
import { streamChat } from "@/lib/streaming";
import { useSession } from "./useSession";
import { useMessages } from "./useMessages";
import { useSystemStatusContext } from "@/features/settings";
import { uploadChatAttachment } from "@/features/chat/services/attachmentService";
import { auth } from "@/lib/firebase";
import type { Source } from "@/types/source";
import type {
  Citation,
  Attachment,
  ToolCall,
  ClarificationRecord,
} from "@/types/session";
import type {
  PendingActionEvent,
  ScopeExpansionEvent,
} from "@/lib/connectors";

/**
 * Apply a streamed tool_call event to the running list. New ids append;
 * existing ids transition status (running → done | error) preserving startedAt.
 */
function mergeToolCall(
  existing: ToolCall[],
  event: Omit<ToolCall, "startedAt">
): ToolCall[] {
  const idx = existing.findIndex((t) => t.id === event.id);
  if (idx === -1) {
    return [...existing, { ...event, startedAt: Date.now() }];
  }
  const next = existing.slice();
  next[idx] = { ...next[idx], ...event };
  return next;
}

export function useChat(notebookId: string, sources: Source[]) {
  const { session, loading: sessionLoading, archiveSession, createSession, updateModel } =
    useSession(notebookId);
  const { messages, loading: messagesLoading } = useMessages(
    notebookId,
    session?.id
  );
  const { markReady } = useSystemStatusContext();

  const [streaming, setStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [streamingCitations, setStreamingCitations] = useState<Citation[]>([]);
  const [streamingToolCalls, setStreamingToolCalls] = useState<ToolCall[]>([]);
  // TODO: persist pendingActions on the assistant message doc once backend
  // exposes a way to re-fetch action state on reload. For v1 these live in
  // memory only and are lost on refresh — the actions still expire safely
  // server-side.
  const [pendingActions, setPendingActions] = useState<PendingActionEvent[]>([]);
  const [scopeExpansions, setScopeExpansions] = useState<ScopeExpansionEvent[]>([]);
  const [clarifications, setClarifications] = useState<ClarificationRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const startTimeRef = useRef<number>(0);
  const ttftRef = useRef<number | null>(null);

  const readySources = sources.filter(
    (s) => s.status === "ready" && s.geminiDocId
  );

  const [uploading, setUploading] = useState(false);

  const sendMessage = useCallback(
    async (query: string, files?: File[]) => {
      if (streaming || !session || readySources.length === 0) return;

      // Parse slash commands: /web, /maps, /url
      const SLASH_COMMANDS: Record<string, string> = {
        "/web ": "googleSearch",
        "/maps ": "googleMaps",
        "/url ": "urlContext",
      };
      let toolOverride: string | undefined;
      let actualQuery = query;
      for (const [prefix, tool] of Object.entries(SLASH_COMMANDS)) {
        if (query.toLowerCase().startsWith(prefix)) {
          toolOverride = tool;
          actualQuery = query.slice(prefix.length).trim();
          break;
        }
      }

      setError(null);
      setStreaming(true);
      setStreamingContent("");
      setStreamingCitations([]);
      setStreamingToolCalls([]);
      // Clear per-turn HITL state — previous turn's cards are now baked into
      // their assistant message doc and will render via ChatMessage.
      setPendingActions([]);
      setScopeExpansions([]);
      setClarifications([]);
      startTimeRef.current = Date.now();
      ttftRef.current = null;

      // Upload attachments to Cloud Storage first
      let attachments: Attachment[] | undefined;
      if (files?.length) {
        const userId = auth.currentUser?.uid;
        if (!userId) {
          setError("Not authenticated.");
          setStreaming(false);
          return;
        }
        setUploading(true);
        try {
          attachments = await Promise.all(
            files.map((file) =>
              uploadChatAttachment(file, userId, notebookId, session.id)
            )
          );
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : "Upload failed";
          setError(`Attachment upload failed: ${msg}`);
          setStreaming(false);
          setUploading(false);
          return;
        }
        setUploading(false);
      }

      const messagesCol = getMessagesCollection(notebookId, session.id);

      // Write user message (store original query with command prefix)
      await addDoc(messagesCol, {
        sessionId: session.id,
        role: "user",
        content: query,
        citations: null,
        tokenCount: 0,
        modelId: null,
        agentType: toolOverride ?? "filesearch",
        metrics: null,
        attachments: attachments ?? null,
        createdAt: serverTimestamp(),
      });
      await updateDoc(getSessionRef(notebookId, session.id), {
        messageCount: increment(1),
        updatedAt: serverTimestamp(),
      });

      // Build history from existing messages
      const history = messages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({
          role: m.role,
          content: m.content,
          toolCalls: m.toolCalls ?? undefined,
        }));

      const controller = new AbortController();
      abortRef.current = controller;

      let finalContent = "";
      let finalCitations: Citation[] = [];
      let finalToolCalls: ToolCall[] = [];
      let finalPendingActions: PendingActionEvent[] = [];
      let finalScopeExpansions: ScopeExpansionEvent[] = [];
      let finalClarifications: ClarificationRecord[] = [];
      let metricsData: { ttftMs: number; totalMs: number; tokenCount: number } | undefined;

      try {
        await streamChat(
          {
            notebookId,
            query: actualQuery,
            modelId: session.modelId,
            history,
            sessionId: session.id,
            toolOverride,
            attachments: attachments?.map((a) => ({
              storageRef: a.storageRef,
              mimeType: a.mimeType,
              fileName: a.fileName,
              sizeBytes: a.sizeBytes,
            })),
          },
          {
            onToken: (text) => {
              if (ttftRef.current === null) {
                ttftRef.current = Date.now() - startTimeRef.current;
              }
              finalContent += text;
              setStreamingContent((prev) => prev + text);
            },
            onCitations: (citations) => {
              finalCitations = citations;
              setStreamingCitations(citations);
            },
            onToolCall: (event) => {
              const updated = mergeToolCall(finalToolCalls, event);
              finalToolCalls = updated;
              setStreamingToolCalls(updated);
            },
            onActionApprovalRequired: (event) => {
              if (!finalPendingActions.some((a) => a.actionId === event.actionId)) {
                finalPendingActions = [...finalPendingActions, event];
                setPendingActions(finalPendingActions);
              }
            },
            onScopeExpansionRequired: (event) => {
              if (
                !finalScopeExpansions.some(
                  (e) => e.provider === event.provider && e.tool === event.tool
                )
              ) {
                finalScopeExpansions = [...finalScopeExpansions, event];
                setScopeExpansions(finalScopeExpansions);
              }
            },
            onClarificationRequired: (event) => {
              if (
                !finalClarifications.some(
                  (c) => c.clarificationId === event.clarificationId
                )
              ) {
                finalClarifications = [...finalClarifications, event];
                setClarifications(finalClarifications);
              }
            },
            onMetrics: (metrics) => {
              metricsData = metrics;
            },
            onError: (message) => {
              setError(message);
            },
            onDone: () => {
              // Handled after streamChat resolves
            },
          },
          controller.signal
        );

        // Write assistant message to Firestore. Persist whenever the turn
        // produced *anything* the user should see — content, tool calls,
        // approvals, scope asks, OR a clarification card. Without this, an
        // ask_user-only turn (no assistant text) would vanish on reload.
        const hasArtifacts =
          finalContent.length > 0 ||
          finalToolCalls.length > 0 ||
          finalPendingActions.length > 0 ||
          finalScopeExpansions.length > 0 ||
          finalClarifications.length > 0;
        if (hasArtifacts) {
          const clientTtft = ttftRef.current ?? 0;
          const clientTotal = Date.now() - startTimeRef.current;

          await addDoc(messagesCol, {
            sessionId: session.id,
            role: "assistant",
            content: finalContent,
            citations: finalCitations.length > 0 ? finalCitations : null,
            toolCalls: finalToolCalls.length > 0 ? finalToolCalls : null,
            pendingActions:
              finalPendingActions.length > 0 ? finalPendingActions : null,
            scopeExpansions:
              finalScopeExpansions.length > 0 ? finalScopeExpansions : null,
            clarifications:
              finalClarifications.length > 0 ? finalClarifications : null,
            tokenCount: metricsData?.tokenCount ?? 0,
            modelId: session.modelId,
            agentType: toolOverride ?? "filesearch",
            metrics: {
              ttftMs: metricsData?.ttftMs ?? clientTtft,
              totalMs: metricsData?.totalMs ?? clientTotal,
            },
            createdAt: serverTimestamp(),
          });
          await updateDoc(getSessionRef(notebookId, session.id), {
            messageCount: increment(1),
            updatedAt: serverTimestamp(),
          });

          markReady();
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name !== "AbortError") {
          setError(err.message);
        }
      } finally {
        setStreaming(false);
        abortRef.current = null;
      }
    },
    [streaming, session, notebookId, messages, readySources]
  );

  const resetSession = useCallback(async () => {
    if (!session) return;
    const modelId = session.modelId;
    await archiveSession();
    await createSession(modelId);
  }, [session, archiveSession, createSession]);

  /**
   * Queue for an HITL auto-continuation. We can't just call sendMessage
   * directly because the original chat turn's `setStreaming(false)` lives in
   * a `finally` block that may not have flushed yet at the moment the user
   * clicks Confirm — sendMessage's `if (streaming) return` guard would drop
   * the call silently. Instead we set a pending flag here and a useEffect
   * below fires the continuation as soon as streaming is actually false.
   */
  const pendingContinuationRef = useRef(false);

  /**
   * After an HITL action card resolves to "executed" (`confirmPendingAction`
   * succeeded), record the executed tool call as a synthetic assistant
   * message so the orchestrator's history-replay sees it on the next turn,
   * then queue a `[continue]` follow-up so the agent can complete any
   * remaining steps from the original multi-step request.
   *
   * Idempotency: keyed on `action.actionId`. If the agent already produced
   * a follow-up turn referencing this action (or the user manually typed
   * something), we skip the auto-continue but still record the result so
   * history is consistent.
   */
  const recordExecutedAction = useCallback(
    async (action: PendingActionEvent, result: unknown): Promise<void> => {
      if (!session) return;
      const messagesCol = getMessagesCollection(notebookId, session.id);
      // Serialize the result into the same shape as a regular tool call's
      // output so the orchestrator's history-replay picks it up uniformly.
      const output =
        typeof result === "string"
          ? result
          : JSON.stringify(result ?? null).slice(0, 8000);
      const toolCallEntry: ToolCall = {
        id: action.actionId,
        name: action.tool,
        args: action.args,
        status: "done",
        output,
        startedAt: Date.now(),
      };
      try {
        await addDoc(messagesCol, {
          sessionId: session.id,
          role: "assistant",
          content: "",
          citations: null,
          toolCalls: [toolCallEntry],
          tokenCount: 0,
          modelId: session.modelId,
          agentType: "hitl_executed",
          metrics: null,
          createdAt: serverTimestamp(),
        });
        await updateDoc(getSessionRef(notebookId, session.id), {
          messageCount: increment(1),
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        // Non-fatal: history replay will be missing this entry but the agent
        // can still attempt to continue (it may re-fetch which is fine).
        console.error("[useChat] Failed to record executed HITL action:", err);
      }
      // Queue the continuation. The useEffect below will fire it as soon as
      // streaming is false and the session has settled.
      pendingContinuationRef.current = true;
      // Try once immediately in case streaming is already false — the effect
      // is a backstop for the race-window case.
      if (!streaming) {
        pendingContinuationRef.current = false;
        void sendMessage("[continue]");
      }
    },
    [session, notebookId, sendMessage, streaming]
  );

  // Backstop for the streaming-flush race: if recordExecutedAction was called
  // while a previous turn was still wrapping up (its `finally setStreaming
  // (false)` not yet flushed), the inline call no-ops. As soon as streaming
  // flips false, fire the queued continuation.
  useEffect(() => {
    if (!streaming && pendingContinuationRef.current) {
      pendingContinuationRef.current = false;
      void sendMessage("[continue]");
    }
  }, [streaming, sendMessage]);

  return {
    session,
    messages,
    streaming,
    uploading,
    streamingContent,
    streamingCitations,
    streamingToolCalls,
    pendingActions,
    scopeExpansions,
    clarifications,
    error,
    loading: sessionLoading || messagesLoading,
    readySources,
    sendMessage,
    resetSession,
    updateModel,
    recordExecutedAction,
  };
}
