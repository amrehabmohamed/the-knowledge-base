import { onRequest } from "firebase-functions/https";
import { getTelegramWebhookSecret } from "../config";
import { sendMessage } from "./telegramClient";
import {
  handleStart,
  handleUnlink,
  handleNotebooks,
  handleSwitch,
  handleModel,
  handleStatus,
  handleReset,
  handleHelp,
  handleLinkingInput,
  getLink,
} from "./commands";
import { handleChatMessage } from "./chat";
import type { TelegramUpdate } from "./types";

export const telegramWebhook = onRequest(
  { timeoutSeconds: 300 },
  async (req, res) => {
    // Only accept POST
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    // Validate webhook secret
    const secret = req.headers["x-telegram-bot-api-secret-token"];
    if (secret !== getTelegramWebhookSecret()) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    // Process the update, then respond 200
    try {
      const update = req.body as TelegramUpdate;
      await processUpdate(update);
    } catch (err) {
      console.error("[TELEGRAM] Unhandled error processing update:", err);
    }

    // Always return 200 to Telegram (prevents retries)
    res.status(200).json({ ok: true });
  }
);

async function processUpdate(update: TelegramUpdate): Promise<void> {
  const message = update.message;
  if (!message?.chat) return;

  const chatId = message.chat.id;

  // Extract text from message — handle locations as text
  let text = message.text?.trim() ?? "";
  if (!text && message.location) {
    text = `My location is: ${message.location.latitude}, ${message.location.longitude}`;
  }
  if (!text) return;

  // Only support private chats
  if (message.chat.type !== "private") return;

  try {
    // Check if user is in a multi-step linking flow
    const handledByLinking = await handleLinkingInput(chatId, text);
    if (handledByLinking) return;

    // Route commands
    if (text.startsWith("/")) {
      await routeCommand(chatId, text);
      return;
    }

    // Otherwise treat as a chat query
    await handleChatMessage(chatId, text);
  } catch (err) {
    console.error(`[TELEGRAM] Error handling message from ${chatId}:`, err);
    try {
      await sendMessage(chatId, "Something went wrong. Please try again.");
    } catch {
      // Can't even send error message — log and move on
      console.error(`[TELEGRAM] Failed to send error message to ${chatId}`);
    }
  }
}

async function routeCommand(chatId: number, text: string): Promise<void> {
  const [rawCommand, ...argParts] = text.split(" ");
  const command = rawCommand.toLowerCase().replace(/@\w+$/, ""); // Strip @botname suffix
  const args = argParts.join(" ").trim();

  // Commands that don't require being linked
  if (command === "/start") {
    await handleStart(chatId);
    return;
  }

  if (command === "/help") {
    await handleHelp(chatId);
    return;
  }

  // All other commands require a linked account
  const link = await getLink(chatId);
  if (!link) {
    await sendMessage(chatId, "You're not linked yet. Send /start to connect your account.");
    return;
  }

  switch (command) {
    case "/unlink":
      await handleUnlink(chatId);
      break;
    case "/notebooks":
      await handleNotebooks(chatId, link);
      break;
    case "/switch":
      await handleSwitch(chatId, link, args);
      break;
    case "/model":
      await handleModel(chatId, link, args);
      break;
    case "/status":
      await handleStatus(chatId, link);
      break;
    case "/reset":
      await handleReset(chatId, link);
      break;
    default:
      await sendMessage(chatId, `Unknown command: ${command}\n\nUse /help to see available commands.`);
  }
}
