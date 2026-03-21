import { useState, useCallback, useRef } from "react";
import { addDoc, updateDoc, increment, serverTimestamp } from "firebase/firestore";
import { getMessagesCollection, getSessionRef } from "@/lib/firestore";
import { streamChat } from "@/lib/streaming";
import { useSession } from "./useSession";
import { useMessages } from "./useMessages";
import { useSystemStatusContext } from "@/features/settings";
import type { Source } from "@/types/source";
import type { Citation } from "@/types/session";

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
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const startTimeRef = useRef<number>(0);
  const ttftRef = useRef<number | null>(null);

  const readySources = sources.filter(
    (s) => s.status === "ready" && s.geminiDocId
  );

  const sendMessage = useCallback(
    async (query: string) => {
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
      startTimeRef.current = Date.now();
      ttftRef.current = null;

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
        }));

      const controller = new AbortController();
      abortRef.current = controller;

      let finalContent = "";
      let finalCitations: Citation[] = [];
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

        // Write assistant message to Firestore
        if (finalContent) {
          const clientTtft = ttftRef.current ?? 0;
          const clientTotal = Date.now() - startTimeRef.current;

          await addDoc(messagesCol, {
            sessionId: session.id,
            role: "assistant",
            content: finalContent,
            citations: finalCitations.length > 0 ? finalCitations : null,
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

  return {
    session,
    messages,
    streaming,
    streamingContent,
    streamingCitations,
    error,
    loading: sessionLoading || messagesLoading,
    readySources,
    sendMessage,
    resetSession,
    updateModel,
  };
}
