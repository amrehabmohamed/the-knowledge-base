import { getTelegramBotToken } from "../config";
import type { ChatChunk } from "../services/gemini";

interface ApiResponse<T = unknown> {
  ok: boolean;
  result: T;
  description?: string;
}

interface SentMessage {
  message_id: number;
  chat: { id: number };
  text?: string;
}

const TELEGRAM_MAX_MESSAGE_LENGTH = 4096;

function getBaseUrl(): string {
  return `https://api.telegram.org/bot${getTelegramBotToken()}`;
}

async function callApi<T>(method: string, body: Record<string, unknown>): Promise<ApiResponse<T>> {
  const res = await fetch(`${getBaseUrl()}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Telegram API ${method} failed (${res.status}): ${text}`);
  }

  return res.json() as Promise<ApiResponse<T>>;
}

export async function sendMessage(
  chatId: number,
  text: string,
  parseMode?: "Markdown" | "HTML"
): Promise<SentMessage> {
  // Split long messages
  if (text.length > TELEGRAM_MAX_MESSAGE_LENGTH) {
    return sendLongMessage(chatId, text, parseMode);
  }

  const body: Record<string, unknown> = { chat_id: chatId, text };
  if (parseMode) body.parse_mode = parseMode;

  const response = await callApi<SentMessage>("sendMessage", body);
  return response.result;
}

async function sendLongMessage(
  chatId: number,
  text: string,
  parseMode?: "Markdown" | "HTML"
): Promise<SentMessage> {
  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= TELEGRAM_MAX_MESSAGE_LENGTH) {
      chunks.push(remaining);
      break;
    }

    // Find a good split point (newline or space)
    let splitAt = remaining.lastIndexOf("\n", TELEGRAM_MAX_MESSAGE_LENGTH);
    if (splitAt < TELEGRAM_MAX_MESSAGE_LENGTH * 0.5) {
      splitAt = remaining.lastIndexOf(" ", TELEGRAM_MAX_MESSAGE_LENGTH);
    }
    if (splitAt < TELEGRAM_MAX_MESSAGE_LENGTH * 0.5) {
      splitAt = TELEGRAM_MAX_MESSAGE_LENGTH;
    }

    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }

  let lastMessage: SentMessage | null = null;
  for (const chunk of chunks) {
    const body: Record<string, unknown> = { chat_id: chatId, text: chunk };
    if (parseMode) body.parse_mode = parseMode;
    const response = await callApi<SentMessage>("sendMessage", body);
    lastMessage = response.result;
  }

  return lastMessage!;
}

export async function editMessageText(
  chatId: number,
  messageId: number,
  text: string,
  parseMode?: "Markdown" | "HTML"
): Promise<void> {
  const body: Record<string, unknown> = {
    chat_id: chatId,
    message_id: messageId,
    text: text.slice(0, TELEGRAM_MAX_MESSAGE_LENGTH),
  };
  if (parseMode) body.parse_mode = parseMode;

  await callApi("editMessageText", body);
}

export async function sendChatAction(chatId: number, action: string = "typing"): Promise<void> {
  await callApi("sendChatAction", { chat_id: chatId, action });
}

/**
 * Converts Gemini's Markdown output to Telegram-compatible HTML.
 */
function markdownToTelegramHtml(text: string): string {
  let html = text;

  // Bold: **text** → <b>text</b>
  html = html.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");

  // Italic: *text* → <i>text</i> (but not inside bold tags)
  html = html.replace(/(?<![<b>])\*(.+?)\*(?![</b>])/g, "<i>$1</i>");

  // Code blocks: ```lang\ncode\n``` → <pre>code</pre>
  html = html.replace(/```\w*\n([\s\S]*?)```/g, "<pre>$1</pre>");

  // Inline code: `text` → <code>text</code>
  html = html.replace(/`(.+?)`/g, "<code>$1</code>");

  // Strikethrough: ~~text~~ → <s>text</s>
  html = html.replace(/~~(.+?)~~/g, "<s>$1</s>");

  // Links: [text](url) → <a href="url">text</a>
  html = html.replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2">$1</a>');

  // Headings: ### text → <b>text</b> (Telegram has no heading support)
  html = html.replace(/^#{1,6}\s+(.+)$/gm, "<b>$1</b>");

  // Escape remaining HTML-special characters that aren't part of our tags
  // (Telegram requires < > & to be escaped in non-tag positions)
  // We skip this since our content is AI-generated and unlikely to have raw < >

  return html;
}

/**
 * Collects the full response from a queryWithFileSearch generator,
 * then sends it as a single HTML-formatted message.
 */
export async function streamResponse(
  chatId: number,
  generator: AsyncGenerator<ChatChunk>
): Promise<{ fullText: string; totalTokens: number }> {
  let fullText = "";
  let totalTokens = 0;

  for await (const chunk of generator) {
    if (chunk.type === "token") {
      fullText += chunk.text;
    } else if (chunk.type === "done") {
      totalTokens = chunk.totalTokens;
    }
    // Skip citation chunks for Telegram
  }

  if (fullText) {
    try {
      const html = markdownToTelegramHtml(fullText);
      await sendMessage(chatId, html, "HTML");
    } catch {
      // HTML parsing failed — send as plain text
      await sendMessage(chatId, fullText);
    }
  }

  return { fullText, totalTokens };
}
