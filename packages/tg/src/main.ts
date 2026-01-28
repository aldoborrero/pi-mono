#!/usr/bin/env node

import { join, resolve } from "path";
import { type AgentRunner, getOrCreateRunner } from "./agent.js";
import { createEventsWatcher } from "./events.js";
import * as log from "./log.js";
import { parseSandboxArg, type SandboxConfig, validateSandbox } from "./sandbox.js";
import { type TgHandler, type TelegramBot, TelegramBot as TelegramBotClass, type TelegramEvent } from "./telegram.js";
import { ChannelStore } from "./store.js";
import { loadSettings } from "./models.js";
import { transcribeVoice, isVoiceTranscriptionAvailable } from "./voice.js";

// ============================================================================
// Config
// ============================================================================

const TG_BOT_TOKEN = process.env.TG_BOT_TOKEN;

interface ParsedArgs {
	workingDir?: string;
	sandbox: SandboxConfig;
	model?: string;
}

function parseArgs(): ParsedArgs {
	const args = process.argv.slice(2);
	let sandbox: SandboxConfig = { type: "host" };
	let workingDir: string | undefined;
	let model: string | undefined;

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg.startsWith("--sandbox=")) {
			sandbox = parseSandboxArg(arg.slice("--sandbox=".length));
		} else if (arg === "--sandbox") {
			sandbox = parseSandboxArg(args[++i] || "");
		} else if (arg.startsWith("--model=")) {
			model = arg.slice("--model=".length);
		} else if (arg === "--model") {
			model = args[++i];
		} else if (arg === "--help" || arg === "-h") {
			console.log("Usage: pi-tg [options] <working-directory>");
			console.log("");
			console.log("Options:");
			console.log("  --sandbox=host              Run tools on host (not recommended)");
			console.log("  --sandbox=docker:<name>     Run tools in Docker container");
			console.log("  --model=<provider/model>    Override default model");
			console.log("");
			console.log("Environment:");
			console.log("  TG_BOT_TOKEN                Telegram bot token (required)");
			console.log("  ANTHROPIC_API_KEY           Anthropic API key");
			console.log("  OPENAI_API_KEY              OpenAI API key (for voice)");
			process.exit(0);
		} else if (!arg.startsWith("-")) {
			workingDir = arg;
		}
	}

	return {
		workingDir: workingDir ? resolve(workingDir) : undefined,
		sandbox,
		model,
	};
}

const parsedArgs = parseArgs();

if (!parsedArgs.workingDir) {
	console.error("Usage: pi-tg [--sandbox=host|docker:<name>] <working-directory>");
	process.exit(1);
}

const { workingDir, sandbox } = parsedArgs;

if (!TG_BOT_TOKEN) {
	console.error("Missing env: TG_BOT_TOKEN");
	process.exit(1);
}

await validateSandbox(sandbox);

// Load settings
const settings = loadSettings(workingDir);
if (parsedArgs.model) {
	const [provider, ...rest] = parsedArgs.model.split("/");
	const id = rest.join("/");
	if (provider && id) {
		settings.model = { provider, id };
	}
}

// ============================================================================
// State (per chat)
// ============================================================================

interface ChatState {
	running: boolean;
	runner: AgentRunner;
	store: ChannelStore;
	stopRequested: boolean;
}

const chatStates = new Map<number, ChatState>();

function getState(chatId: number): ChatState {
	let state = chatStates.get(chatId);
	if (!state) {
		const chatDir = join(workingDir, String(chatId));
		state = {
			running: false,
			runner: getOrCreateRunner(sandbox, String(chatId), chatDir),
			store: new ChannelStore({ workingDir }),
			stopRequested: false,
		};
		chatStates.set(chatId, state);
	}
	return state;
}

// ============================================================================
// Create TelegramContext adapter
// ============================================================================

function createTelegramContext(event: TelegramEvent, bot: TelegramBot, state: ChatState) {
	let messageId: number | null = null;
	let accumulatedText = "";
	let isWorking = true;
	const workingIndicator = " ...";
	let updatePromise = Promise.resolve();

	return {
		message: {
			text: event.text,
			user: event.userId,
			userName: event.userName,
			chatId: event.chatId,
			messageId: event.messageId,
			attachments: (event.attachments || []).map((a) => ({ local: a.local })),
		},
		store: state.store,

		respond: async (text: string) => {
			updatePromise = updatePromise.then(async () => {
				accumulatedText = accumulatedText ? `${accumulatedText}\n${text}` : text;
				const displayText = isWorking ? accumulatedText + workingIndicator : accumulatedText;

				if (messageId) {
					await bot.updateMessage(event.chatId, messageId, displayText);
				} else {
					messageId = await bot.sendMessage(event.chatId, displayText);
				}
			});
			await updatePromise;
		},

		replaceMessage: async (text: string) => {
			updatePromise = updatePromise.then(async () => {
				accumulatedText = text;
				const displayText = isWorking ? accumulatedText + workingIndicator : accumulatedText;
				if (messageId) {
					await bot.updateMessage(event.chatId, messageId, displayText);
				} else {
					messageId = await bot.sendMessage(event.chatId, displayText);
				}
			});
			await updatePromise;
		},

		respondInThread: async (text: string) => {
			// Telegram doesn't have threads like Slack, just send as reply
			updatePromise = updatePromise.then(async () => {
				await bot.sendMessage(event.chatId, text);
			});
			await updatePromise;
		},

		setTyping: async (isTyping: boolean) => {
			if (isTyping) {
				await bot.setTyping(event.chatId);
			}
		},

		uploadFile: async (filePath: string, caption?: string) => {
			await bot.sendFile(event.chatId, filePath, caption);
		},

		setWorking: async (working: boolean) => {
			updatePromise = updatePromise.then(async () => {
				isWorking = working;
				if (messageId) {
					const displayText = isWorking ? accumulatedText + workingIndicator : accumulatedText;
					await bot.updateMessage(event.chatId, messageId, displayText);
				}
			});
			await updatePromise;
		},

		deleteMessage: async () => {
			updatePromise = updatePromise.then(async () => {
				if (messageId) {
					await bot.deleteMessage(event.chatId, messageId);
					messageId = null;
				}
			});
			await updatePromise;
		},
	};
}

// ============================================================================
// Handler
// ============================================================================

const handler: TgHandler = {
	isRunning(chatId: number): boolean {
		const state = chatStates.get(chatId);
		return state?.running ?? false;
	},

	async handleStop(chatId: number, bot: TelegramBot): Promise<void> {
		const state = chatStates.get(chatId);
		if (state?.running) {
			state.stopRequested = true;
			state.runner.abort();
			await bot.sendMessage(chatId, "_Stopping..._");
		}
	},

	async handleEvent(event: TelegramEvent, bot: TelegramBot, isEvent?: boolean): Promise<void> {
		const state = getState(event.chatId);

		// Handle voice transcription
		if (event.voiceTranscription && event.attachments) {
			const voiceAttachment = event.attachments.find((a) => a.fileName.endsWith(".ogg"));
			if (voiceAttachment && isVoiceTranscriptionAvailable()) {
				try {
					const transcription = await transcribeVoice(voiceAttachment.local);
					event.text = `[Voice message]: ${transcription}`;
				} catch (error) {
					event.text = `[Voice message - transcription failed]: ${error}`;
				}
			}
		}

		state.running = true;
		state.stopRequested = false;

		log.logInfo(`[${event.chatId}] Starting run: ${event.text.substring(0, 50)}`);

		try {
			const ctx = createTelegramContext(event, bot, state);

			await ctx.setTyping(true);
			await ctx.setWorking(true);
			const result = await state.runner.run(ctx as any);
			await ctx.setWorking(false);

			if (result.stopReason === "aborted" && state.stopRequested) {
				await bot.sendMessage(event.chatId, "_Stopped_");
			}
		} catch (err) {
			log.logWarning(`[${event.chatId}] Run error`, err instanceof Error ? err.message : String(err));
		} finally {
			state.running = false;
		}
	},
};

// ============================================================================
// Start
// ============================================================================

log.logStartup(workingDir, sandbox.type === "host" ? "host" : `docker:${sandbox.container}`);
log.logInfo(`Model: ${settings.model.provider}/${settings.model.id}`);

if (!isVoiceTranscriptionAvailable()) {
	log.logWarning("Voice transcription disabled", "Set OPENAI_API_KEY to enable");
}

const bot = new TelegramBotClass(handler, {
	token: TG_BOT_TOKEN,
	workingDir,
});

// Start events watcher
const eventsWatcher = createEventsWatcher(workingDir, bot);
eventsWatcher.start();

// Handle shutdown
process.on("SIGINT", () => {
	log.logInfo("Shutting down...");
	eventsWatcher.stop();
	bot.stop();
	process.exit(0);
});

process.on("SIGTERM", () => {
	log.logInfo("Shutting down...");
	eventsWatcher.stop();
	bot.stop();
	process.exit(0);
});

bot.start();
