import { Bot, InputFile } from "grammy";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join, basename, extname } from "path";
import * as log from "./log.js";

// ============================================================================
// Types
// ============================================================================

export interface TelegramEvent {
	type: "message" | "command";
	chatId: number;
	messageId: number;
	userId: number;
	userName?: string;
	text: string;
	attachments?: Attachment[];
	voiceTranscription?: string;
}

export interface Attachment {
	fileId: string;
	fileName: string;
	local: string;
}

export interface TelegramContext {
	message: {
		text: string;
		user: number;
		userName?: string;
		chatId: number;
		messageId: number;
		attachments: Array<{ local: string }>;
	};
	respond: (text: string) => Promise<void>;
	replaceMessage: (text: string) => Promise<void>;
	respondInThread: (text: string) => Promise<void>;
	setTyping: (isTyping: boolean) => Promise<void>;
	uploadFile: (filePath: string, caption?: string) => Promise<void>;
	setWorking: (working: boolean) => Promise<void>;
	deleteMessage: () => Promise<void>;
}

export interface TgHandler {
	isRunning(chatId: number): boolean;
	handleEvent(event: TelegramEvent, bot: TelegramBot, isEvent?: boolean): Promise<void>;
	handleStop(chatId: number, bot: TelegramBot): Promise<void>;
}

// ============================================================================
// TelegramBot class
// ============================================================================

export class TelegramBot {
	private bot: Bot;
	private handler: TgHandler;
	private workingDir: string;
	private token: string;

	constructor(handler: TgHandler, options: { token: string; workingDir: string }) {
		this.handler = handler;
		this.workingDir = options.workingDir;
		this.token = options.token;
		this.bot = new Bot(options.token);

		this.setupHandlers();
	}

	private setupHandlers() {
		// Handle /stop command
		this.bot.command("stop", async (ctx) => {
			const chatId = ctx.chat.id;
			if (this.handler.isRunning(chatId)) {
				await this.handler.handleStop(chatId, this);
			} else {
				await ctx.reply("_Nothing running_", { parse_mode: "Markdown" });
			}
		});

		// Handle /start command
		this.bot.command("start", async (ctx) => {
			await ctx.reply("Hello! I'm pi-tg, your personal AI assistant. Send me a message to get started.");
		});

		// Handle /model command
		this.bot.command("model", async (ctx) => {
			const args = ctx.message?.text?.split(" ").slice(1).join(" ");
			if (!args) {
				await ctx.reply("Usage: /model <provider/model-id>");
			} else {
				// TODO: Implement model switching
				await ctx.reply(`Model switching not yet implemented`);
			}
		});

		// Handle /cancel command (alias for /stop)
		this.bot.command("cancel", async (ctx) => {
			const chatId = ctx.chat.id;
			if (this.handler.isRunning(chatId)) {
				await this.handler.handleStop(chatId, this);
			} else {
				await ctx.reply("_Nothing to cancel_", { parse_mode: "Markdown" });
			}
		});

		// Handle all other messages
		this.bot.on("message", async (ctx) => {
			const chatId = ctx.chat.id;
			const messageId = ctx.message.message_id;
			const userId = ctx.from?.id ?? 0;
			const userName = ctx.from?.username ?? ctx.from?.first_name;

			// Skip if already running
			if (this.handler.isRunning(chatId)) {
				await ctx.reply("_I'm busy, please wait..._", { parse_mode: "Markdown" });
				return;
			}

			// Get text content
			let text = ctx.message.text ?? ctx.message.caption ?? "";

			// Handle voice messages
			let voiceTranscription: string | undefined;
			if (ctx.message.voice || ctx.message.audio) {
				voiceTranscription = "[Voice message - transcription pending]";
			}

			// Download attachments
			const attachments: Attachment[] = [];

			// Handle documents
			if (ctx.message.document) {
				const doc = ctx.message.document;
				const localPath = await this.downloadFile(chatId, doc.file_id, doc.file_name ?? "document");
				if (localPath) {
					attachments.push({ fileId: doc.file_id, fileName: doc.file_name ?? "document", local: localPath });
				}
			}

			// Handle photos (get largest)
			if (ctx.message.photo && ctx.message.photo.length > 0) {
				const photo = ctx.message.photo[ctx.message.photo.length - 1];
				const localPath = await this.downloadFile(chatId, photo.file_id, `photo_${photo.file_id}.jpg`);
				if (localPath) {
					attachments.push({ fileId: photo.file_id, fileName: `photo.jpg`, local: localPath });
				}
			}

			// Handle voice
			if (ctx.message.voice) {
				const voice = ctx.message.voice;
				const localPath = await this.downloadFile(chatId, voice.file_id, `voice_${voice.file_id}.ogg`);
				if (localPath) {
					attachments.push({ fileId: voice.file_id, fileName: "voice.ogg", local: localPath });
				}
			}

			const event: TelegramEvent = {
				type: "message",
				chatId,
				messageId,
				userId,
				userName,
				text: voiceTranscription ?? text,
				attachments,
				voiceTranscription,
			};

			await this.handler.handleEvent(event, this);
		});
	}

	private async downloadFile(chatId: number, fileId: string, fileName: string): Promise<string | null> {
		try {
			const file = await this.bot.api.getFile(fileId);
			if (!file.file_path) return null;

			const url = `https://api.telegram.org/file/bot${this.token}/${file.file_path}`;
			const response = await fetch(url);
			if (!response.ok) return null;

			const buffer = Buffer.from(await response.arrayBuffer());

			const attachmentsDir = join(this.workingDir, String(chatId), "attachments");
			mkdirSync(attachmentsDir, { recursive: true });

			const localPath = join(attachmentsDir, fileName);
			writeFileSync(localPath, buffer);

			return localPath;
		} catch (error) {
			log.logWarning("Failed to download file", String(error));
			return null;
		}
	}

	async sendMessage(chatId: number, text: string): Promise<number> {
		// Telegram has 4096 char limit, split if needed
		if (text.length <= 4096) {
			const msg = await this.bot.api.sendMessage(chatId, text, { parse_mode: "Markdown" });
			return msg.message_id;
		}

		// Split long messages
		const chunks = this.splitMessage(text, 4096);
		let lastMsgId = 0;
		for (const chunk of chunks) {
			const msg = await this.bot.api.sendMessage(chatId, chunk, { parse_mode: "Markdown" });
			lastMsgId = msg.message_id;
		}
		return lastMsgId;
	}

	async updateMessage(chatId: number, messageId: number, text: string): Promise<void> {
		try {
			const truncated = text.length > 4096 ? text.slice(0, 4093) + "..." : text;
			await this.bot.api.editMessageText(chatId, messageId, truncated, { parse_mode: "Markdown" });
		} catch (error) {
			// Message might be identical or deleted, ignore
		}
	}

	async deleteMessage(chatId: number, messageId: number): Promise<void> {
		try {
			await this.bot.api.deleteMessage(chatId, messageId);
		} catch (error) {
			// Message might already be deleted
		}
	}

	async sendFile(chatId: number, filePath: string, caption?: string): Promise<void> {
		const ext = extname(filePath).toLowerCase();
		const file = new InputFile(filePath);

		if ([".jpg", ".jpeg", ".png", ".gif"].includes(ext)) {
			await this.bot.api.sendPhoto(chatId, file, { caption });
		} else if ([".mp3", ".ogg", ".wav"].includes(ext)) {
			await this.bot.api.sendAudio(chatId, file, { caption });
		} else {
			await this.bot.api.sendDocument(chatId, file, { caption });
		}
	}

	async setTyping(chatId: number): Promise<void> {
		await this.bot.api.sendChatAction(chatId, "typing");
	}

	private splitMessage(text: string, maxLength: number): string[] {
		const chunks: string[] = [];
		let remaining = text;

		while (remaining.length > 0) {
			if (remaining.length <= maxLength) {
				chunks.push(remaining);
				break;
			}

			// Find a good break point
			let breakPoint = remaining.lastIndexOf("\n", maxLength);
			if (breakPoint === -1 || breakPoint < maxLength / 2) {
				breakPoint = remaining.lastIndexOf(" ", maxLength);
			}
			if (breakPoint === -1 || breakPoint < maxLength / 2) {
				breakPoint = maxLength;
			}

			chunks.push(remaining.slice(0, breakPoint));
			remaining = remaining.slice(breakPoint).trimStart();
		}

		return chunks;
	}

	// Method to enqueue events (for events.ts compatibility)
	enqueueEvent(event: TelegramEvent): boolean {
		if (this.handler.isRunning(event.chatId)) {
			return false;
		}
		this.handler.handleEvent(event, this, true);
		return true;
	}

	start(): void {
		log.logInfo("Starting Telegram bot...");
		this.bot.start();
	}

	stop(): void {
		this.bot.stop();
	}
}
