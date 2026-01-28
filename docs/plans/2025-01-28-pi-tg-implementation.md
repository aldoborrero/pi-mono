# pi-tg Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a personal Telegram bot with full pi-mom feature parity plus multi-provider support and voice transcription.

**Architecture:** Fork pi-mom structure, replace Slack integration with Telegram (grammy), add voice transcription (Whisper API), use pi-ai for multi-provider model support.

**Tech Stack:** TypeScript, grammy (Telegram), pi-ai, pi-agent-core, pi-coding-agent, OpenAI Whisper API

---

## Task 1: Package Scaffolding

**Files:**
- Create: `packages/tg/package.json`
- Create: `packages/tg/tsconfig.json`
- Create: `packages/tg/tsconfig.build.json`
- Create: `packages/tg/README.md`

**Step 1: Create package.json**

```json
{
  "name": "@mariozechner/pi-tg",
  "version": "0.50.0",
  "description": "Telegram bot powered by pi agent",
  "type": "module",
  "bin": {
    "pi-tg": "dist/main.js"
  },
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "files": [
    "dist",
    "CHANGELOG.md"
  ],
  "scripts": {
    "clean": "rm -rf dist",
    "build": "tsgo -p tsconfig.build.json && chmod +x dist/main.js",
    "dev": "tsgo -p tsconfig.build.json --watch --preserveWatchOutput",
    "prepublishOnly": "npm run clean && npm run build"
  },
  "dependencies": {
    "@anthropic-ai/sandbox-runtime": "^0.0.16",
    "@mariozechner/pi-agent-core": "^0.50.0",
    "@mariozechner/pi-ai": "^0.50.0",
    "@mariozechner/pi-coding-agent": "^0.50.0",
    "@sinclair/typebox": "^0.34.0",
    "chalk": "^5.6.2",
    "croner": "^9.1.0",
    "diff": "^8.0.2",
    "grammy": "^1.35.0",
    "openai": "^4.77.0"
  },
  "devDependencies": {
    "@types/diff": "^7.0.2",
    "@types/node": "^24.3.0",
    "typescript": "^5.7.3"
  },
  "keywords": [
    "telegram",
    "bot",
    "ai",
    "agent"
  ],
  "author": "Mario Zechner",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/badlogic/pi-mono.git",
    "directory": "packages/tg"
  },
  "engines": {
    "node": ">=20.0.0"
  }
}
```

**Step 2: Create tsconfig.json**

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src/**/*"]
}
```

**Step 3: Create tsconfig.build.json**

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "exclude": ["**/*.test.ts", "test/**/*"]
}
```

**Step 4: Create minimal README.md**

```markdown
# pi-tg

A Telegram bot powered by an LLM that can execute bash commands, read/write files, and interact with your development environment.

## Quick Start

\`\`\`bash
export TG_BOT_TOKEN=123456:ABC-DEF...
export ANTHROPIC_API_KEY=sk-ant-...

pi-tg --sandbox=docker:tg-sandbox ./data
\`\`\`

See [docs/](docs/) for full documentation.
```

**Step 5: Create src directory**

```bash
mkdir -p packages/tg/src/tools
```

**Step 6: Update root package.json workspaces**

Add `"packages/tg"` to the workspaces array in the root package.json.

**Step 7: Commit**

```bash
git add packages/tg/
git add package.json
git commit -m "feat(tg): scaffold pi-tg package structure"
```

---

## Task 2: Copy and Adapt Core Files

**Files:**
- Copy: `packages/mom/src/log.ts` → `packages/tg/src/log.ts`
- Copy: `packages/mom/src/sandbox.ts` → `packages/tg/src/sandbox.ts`
- Copy: `packages/mom/src/store.ts` → `packages/tg/src/store.ts`
- Copy: `packages/mom/src/context.ts` → `packages/tg/src/context.ts`
- Copy: `packages/mom/src/events.ts` → `packages/tg/src/events.ts`

**Step 1: Copy log.ts (no changes needed)**

```bash
cp packages/mom/src/log.ts packages/tg/src/log.ts
```

**Step 2: Copy sandbox.ts (no changes needed)**

```bash
cp packages/mom/src/sandbox.ts packages/tg/src/sandbox.ts
```

**Step 3: Copy store.ts and adapt**

```bash
cp packages/mom/src/store.ts packages/tg/src/store.ts
```

Edit `packages/tg/src/store.ts`:
- Remove Slack-specific token handling
- Keep file/attachment storage logic
- Remove `botToken` from constructor (not needed for Telegram)

**Step 4: Copy context.ts (minimal changes)**

```bash
cp packages/mom/src/context.ts packages/tg/src/context.ts
```

No changes needed - context management is platform-agnostic.

**Step 5: Copy events.ts and adapt**

```bash
cp packages/mom/src/events.ts packages/tg/src/events.ts
```

Edit to import from local `./telegram.js` instead of `./slack.js` (will be created in next task).

**Step 6: Commit**

```bash
git add packages/tg/src/
git commit -m "feat(tg): copy core files from pi-mom"
```

---

## Task 3: Copy Tools

**Files:**
- Copy: `packages/mom/src/tools/*.ts` → `packages/tg/src/tools/`

**Step 1: Copy all tool files**

```bash
cp packages/mom/src/tools/*.ts packages/tg/src/tools/
```

**Step 2: Adapt attach.ts for Telegram**

The attach tool needs to be rewritten for Telegram's file upload API. Replace content:

```typescript
import { Type } from "@sinclair/typebox";
import { existsSync, statSync } from "fs";
import { basename } from "path";
import type { AgentTool } from "@mariozechner/pi-agent-core";

let uploadFunction: ((filePath: string, caption?: string) => Promise<void>) | undefined;

export function setUploadFunction(fn: (filePath: string, caption?: string) => Promise<void>) {
  uploadFunction = fn;
}

export const attachTool: AgentTool<"attach"> = {
  name: "attach",
  label: "Attach",
  description: "Send a file to the user via Telegram. Use for sharing generated files, images, documents, etc.",
  parameters: Type.Object({
    path: Type.String({ description: "Absolute path to the file to send" }),
    caption: Type.Optional(Type.String({ description: "Optional caption for the file" })),
  }),
  async execute(id, { path, caption }) {
    if (!uploadFunction) {
      return {
        content: [{ type: "text", text: "Upload function not configured" }],
        isError: true,
      };
    }

    if (!existsSync(path)) {
      return {
        content: [{ type: "text", text: `File not found: ${path}` }],
        isError: true,
      };
    }

    const stats = statSync(path);
    if (stats.size > 50 * 1024 * 1024) {
      return {
        content: [{ type: "text", text: `File too large (max 50MB): ${path}` }],
        isError: true,
      };
    }

    try {
      await uploadFunction(path, caption);
      return {
        content: [{ type: "text", text: `Sent file: ${basename(path)}` }],
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Failed to send file: ${error}` }],
        isError: true,
      };
    }
  },
};
```

**Step 3: Update tools/index.ts**

Keep the same structure, just ensure imports work.

**Step 4: Commit**

```bash
git add packages/tg/src/tools/
git commit -m "feat(tg): add tools adapted for Telegram"
```

---

## Task 4: Create Telegram Integration

**Files:**
- Create: `packages/tg/src/telegram.ts`

**Step 1: Create telegram.ts**

```typescript
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

  constructor(handler: TgHandler, options: { token: string; workingDir: string }) {
    this.handler = handler;
    this.workingDir = options.workingDir;
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

    // Handle /cancel command
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
        // Will be handled by voice.ts
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

      const url = `https://api.telegram.org/file/bot${this.bot.token}/${file.file_path}`;
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

  start(): void {
    log.logInfo("Starting Telegram bot...");
    this.bot.start();
  }

  stop(): void {
    this.bot.stop();
  }
}
```

**Step 2: Commit**

```bash
git add packages/tg/src/telegram.ts
git commit -m "feat(tg): add Telegram bot integration with grammy"
```

---

## Task 5: Create Voice Transcription

**Files:**
- Create: `packages/tg/src/voice.ts`

**Step 1: Create voice.ts**

```typescript
import OpenAI from "openai";
import { createReadStream, existsSync } from "fs";
import * as log from "./log.js";

let openaiClient: OpenAI | undefined;

function getOpenAIClient(): OpenAI {
  if (!openaiClient) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY environment variable required for voice transcription");
    }
    openaiClient = new OpenAI({ apiKey });
  }
  return openaiClient;
}

export async function transcribeVoice(audioPath: string): Promise<string> {
  if (!existsSync(audioPath)) {
    throw new Error(`Audio file not found: ${audioPath}`);
  }

  try {
    const client = getOpenAIClient();

    const transcription = await client.audio.transcriptions.create({
      file: createReadStream(audioPath),
      model: "whisper-1",
    });

    return transcription.text;
  } catch (error) {
    log.logWarning("Voice transcription failed", String(error));
    throw error;
  }
}

export function isVoiceTranscriptionAvailable(): boolean {
  return !!process.env.OPENAI_API_KEY;
}
```

**Step 2: Commit**

```bash
git add packages/tg/src/voice.ts
git commit -m "feat(tg): add voice transcription with OpenAI Whisper"
```

---

## Task 6: Create Model Registry Integration

**Files:**
- Create: `packages/tg/src/models.ts`

**Step 1: Create models.ts**

```typescript
import { getModel, type Model, type Api } from "@mariozechner/pi-ai";
import { ModelRegistry, AuthStorage } from "@mariozechner/pi-coding-agent";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import * as log from "./log.js";

export interface ModelConfig {
  provider: string;
  id: string;
}

export interface TgSettings {
  model: ModelConfig;
  fallbackModels?: ModelConfig[];
}

const DEFAULT_SETTINGS: TgSettings = {
  model: {
    provider: "anthropic",
    id: "claude-sonnet-4-5",
  },
};

export function loadSettings(workingDir: string): TgSettings {
  const settingsPath = join(workingDir, "settings.json");

  if (existsSync(settingsPath)) {
    try {
      const content = readFileSync(settingsPath, "utf-8");
      return { ...DEFAULT_SETTINGS, ...JSON.parse(content) };
    } catch (error) {
      log.logWarning("Failed to load settings", String(error));
    }
  }

  return DEFAULT_SETTINGS;
}

export function saveSettings(workingDir: string, settings: TgSettings): void {
  mkdirSync(workingDir, { recursive: true });
  const settingsPath = join(workingDir, "settings.json");
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
}

export function resolveModel(settings: TgSettings): Model<Api> | undefined {
  const { provider, id } = settings.model;

  try {
    return getModel(provider, id);
  } catch (error) {
    log.logWarning(`Failed to resolve model ${provider}/${id}`, String(error));

    // Try fallback models
    if (settings.fallbackModels) {
      for (const fallback of settings.fallbackModels) {
        try {
          log.logInfo(`Trying fallback model: ${fallback.provider}/${fallback.id}`);
          return getModel(fallback.provider, fallback.id);
        } catch {
          continue;
        }
      }
    }

    return undefined;
  }
}

export async function getApiKey(
  authStorage: AuthStorage,
  provider: string,
): Promise<string | undefined> {
  return authStorage.getApiKey(provider);
}
```

**Step 2: Commit**

```bash
git add packages/tg/src/models.ts
git commit -m "feat(tg): add multi-provider model resolution"
```

---

## Task 7: Create Agent Runner

**Files:**
- Create: `packages/tg/src/agent.ts`

**Step 1: Copy agent.ts from mom and adapt**

```bash
cp packages/mom/src/agent.ts packages/tg/src/agent.ts
```

**Step 2: Modify agent.ts**

Key changes:
1. Replace `SlackContext` imports with `TelegramContext` from `./telegram.js`
2. Use `resolveModel()` from `./models.js` instead of hardcoded Anthropic
3. Update `getApiKey` to support multiple providers
4. Update system prompt references from "Slack" to "Telegram"
5. Handle voice transcription in message processing

The system prompt should reference Telegram-specific behavior:
- Messages instead of mentions
- Telegram markdown format
- Voice message support

**Step 3: Commit**

```bash
git add packages/tg/src/agent.ts
git commit -m "feat(tg): add agent runner with multi-provider support"
```

---

## Task 8: Create Main Entry Point

**Files:**
- Create: `packages/tg/src/main.ts`

**Step 1: Create main.ts**

```typescript
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
      const result = await state.runner.run(ctx as any, state.store);
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
```

**Step 2: Commit**

```bash
git add packages/tg/src/main.ts
git commit -m "feat(tg): add main entry point"
```

---

## Task 9: Update Store for Telegram

**Files:**
- Modify: `packages/tg/src/store.ts`

**Step 1: Adapt store.ts**

Remove Slack-specific token handling, keep just file storage:

```typescript
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "fs";
import { join } from "path";

export interface Attachment {
  fileId?: string;
  fileName: string;
  local: string;
}

export interface ChannelStoreOptions {
  workingDir: string;
}

export class ChannelStore {
  private workingDir: string;

  constructor(options: ChannelStoreOptions) {
    this.workingDir = options.workingDir;
  }

  getChatDir(chatId: string | number): string {
    return join(this.workingDir, String(chatId));
  }

  getAttachmentsDir(chatId: string | number): string {
    return join(this.getChatDir(chatId), "attachments");
  }

  ensureChatDir(chatId: string | number): void {
    const chatDir = this.getChatDir(chatId);
    if (!existsSync(chatDir)) {
      mkdirSync(chatDir, { recursive: true });
    }
  }

  saveAttachment(chatId: string | number, fileName: string, data: Buffer): string {
    this.ensureChatDir(chatId);
    const attachmentsDir = this.getAttachmentsDir(chatId);
    mkdirSync(attachmentsDir, { recursive: true });

    const localPath = join(attachmentsDir, fileName);
    writeFileSync(localPath, data);
    return localPath;
  }
}
```

**Step 2: Commit**

```bash
git add packages/tg/src/store.ts
git commit -m "feat(tg): simplify store for Telegram"
```

---

## Task 10: Update Events for Telegram

**Files:**
- Modify: `packages/tg/src/events.ts`

**Step 1: Adapt events.ts**

Change imports and types to use TelegramBot instead of SlackBot:

```typescript
// At top of file, change:
import type { TelegramBot } from "./telegram.js";

// In EventsWatcher class, change SlackBot to TelegramBot
// In triggerEvent, use bot.sendMessage instead of Slack-specific methods
```

**Step 2: Commit**

```bash
git add packages/tg/src/events.ts
git commit -m "feat(tg): adapt events system for Telegram"
```

---

## Task 11: Build and Test

**Files:**
- Modify: Root `package.json` (add tg to workspaces)

**Step 1: Ensure tg is in workspaces**

Verify root package.json has `"packages/tg"` in workspaces array.

**Step 2: Install dependencies**

```bash
npm install
```

**Step 3: Build**

```bash
npm run build
```

Fix any TypeScript errors that arise.

**Step 4: Create a test bot**

1. Message @BotFather on Telegram
2. Create new bot with `/newbot`
3. Get the token

**Step 5: Test locally**

```bash
export TG_BOT_TOKEN=your-token
export ANTHROPIC_API_KEY=your-key

node packages/tg/dist/main.js --sandbox=host ./test-data
```

**Step 6: Commit all fixes**

```bash
git add -A
git commit -m "feat(tg): complete pi-tg implementation"
```

---

## Task 12: Documentation

**Files:**
- Expand: `packages/tg/README.md`
- Create: `packages/tg/docs/setup.md`

**Step 1: Write full README**

Document:
- Features
- Installation
- Bot setup (BotFather)
- Environment variables
- CLI usage
- Commands
- Docker setup
- Security considerations

**Step 2: Create setup.md**

Step-by-step Telegram bot creation guide.

**Step 3: Commit**

```bash
git add packages/tg/
git commit -m "docs(tg): add documentation"
```

---

## Summary

| Task | Description | Est. Complexity |
|------|-------------|-----------------|
| 1 | Package scaffolding | Low |
| 2 | Copy core files | Low |
| 3 | Copy and adapt tools | Medium |
| 4 | Telegram integration | High |
| 5 | Voice transcription | Low |
| 6 | Model registry | Medium |
| 7 | Agent runner | High |
| 8 | Main entry point | Medium |
| 9 | Update store | Low |
| 10 | Update events | Low |
| 11 | Build and test | Medium |
| 12 | Documentation | Low |

Total: ~12 tasks, moderate complexity overall due to adapting mom's architecture.
