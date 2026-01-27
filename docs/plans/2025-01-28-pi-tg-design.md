# pi-tg Design Document

Personal Telegram bot with full pi-mom feature parity plus enhancements.

## Overview

**Package:** `@mariozechner/pi-tg`

**Purpose:** Personal assistant Telegram bot with bash access, file tools, memory, skills, events, and Docker sandbox support.

**Architecture:** Fork & adapt from pi-mom, replacing Slack integration with Telegram.

## Key Decisions

| Aspect | Decision |
|--------|----------|
| Telegram library | grammy (TypeScript-first, long polling) |
| Voice transcription | OpenAI Whisper API (local Whisper later) |
| Model support | Multi-provider via pi-ai |
| File handling | Bidirectional (receive + send) + voice-to-text |
| Sandbox | Docker (recommended) or host |
| Data structure | Same as mom (per-chat directories) |

## Package Structure

```
packages/tg/
├── src/
│   ├── main.ts           # Entry point, CLI parsing
│   ├── agent.ts          # Agent runner (adapted from mom)
│   ├── telegram.ts       # Telegram bot integration (long polling)
│   ├── context.ts        # Session manager, context.jsonl
│   ├── store.ts          # Data persistence, attachment handling
│   ├── log.ts            # Logging
│   ├── sandbox.ts        # Docker/host execution (reuse from mom)
│   ├── voice.ts          # Voice message → text conversion
│   ├── tools/
│   │   ├── bash.ts
│   │   ├── read.ts
│   │   ├── write.ts
│   │   ├── edit.ts
│   │   └── attach.ts     # Send files to Telegram
│   └── models.ts         # Multi-provider model resolution via pi-ai
├── docs/
│   ├── setup.md          # Telegram bot setup guide
│   ├── sandbox.md        # Docker vs host
│   └── events.md         # Events system
├── package.json
├── tsconfig.json
└── README.md
```

## Data Directory Structure

```
./data/
├── MEMORY.md              # Global memory
├── settings.json          # Model preferences, etc.
├── skills/                # Global skills
├── events/                # Scheduled events
└── <chat_id>/             # Per-chat directories
    ├── MEMORY.md
    ├── context.jsonl
    ├── log.jsonl
    ├── attachments/
    └── skills/
```

## Telegram Integration

### Connection Method

Long polling via grammy - simpler than webhooks, no public endpoint needed.

### Bot Triggers

- Direct messages (private chat with bot)
- Group mentions (`@botname message`)
- Reply to bot's messages

### Message Flow

```
User sends message
    ↓
telegram.ts receives update via long polling
    ↓
Download attachments (photos, documents, voice) to <chat_id>/attachments/
    ↓
If voice message → voice.ts converts to text
    ↓
Log message to log.jsonl
    ↓
Sync log.jsonl → context.jsonl
    ↓
agent.ts processes with LLM
    ↓
Send response chunks back to Telegram
    ↓
Tool details sent as replies to the main message
```

### Telegram-Specific Handling

- **Markdown** - Sanitize LLM output for Telegram's markdown subset
- **Message length** - Split responses >4096 chars
- **Message editing** - Update existing message during streaming (optional)

### Environment Variables

```
TG_BOT_TOKEN=123456:ABC-DEF...  # From @BotFather
```

## Voice Message Handling

### Flow

```
User sends voice message (.ogg)
    ↓
telegram.ts downloads to attachments/
    ↓
voice.ts converts ogg → text via Whisper API
    ↓
Text injected as user message content
    ↓
Original audio file kept for reference
```

### Transcription

Primary: OpenAI Whisper API ($0.006/minute)
Future: Local Whisper via whisper.cpp in sandbox

### Message Format to LLM

```
[Voice message transcription]: "Hey, can you check the build logs?"
```

### Environment Variable

```
OPENAI_API_KEY=sk-...  # Also used for Whisper
```

## Multi-Provider Model Support

### Integration

Uses `pi-ai` ModelRegistry for provider abstraction.

### Supported Providers

- Anthropic (Claude)
- OpenAI (GPT-4)
- Google (Gemini)
- Groq, Together, xAI, Mistral, etc.
- Custom providers via extensions

### Configuration (settings.json)

```json
{
  "model": {
    "provider": "anthropic",
    "id": "claude-sonnet-4-20250514"
  },
  "fallbackModels": [
    { "provider": "groq", "id": "llama-3.3-70b-versatile" }
  ]
}
```

### Runtime Model Switching

```
/model anthropic/claude-sonnet-4
/model together/meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8
```

### API Key Resolution

- Environment variables (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, etc.)
- OAuth tokens from `~/.pi/tg/auth.json`

## File Sending (attach tool)

### Telegram Limits

- Documents: up to 50MB
- Photos: up to 10MB (compressed), 50MB as document
- Audio/Voice: up to 50MB

### Tool Parameters

```typescript
{
  path: string,           // Path to file in workspace
  caption?: string,       // Caption for the file
  asDocument?: boolean,   // Force send as document (no compression)
}
```

### File Type Handling

| Extension | Send as |
|-----------|---------|
| `.jpg`, `.png`, `.gif` | Photo (unless asDocument) |
| `.mp3`, `.ogg` | Audio |
| Everything else | Document |

## Bot Commands

| Command | Description |
|---------|-------------|
| `/start` | Initialize bot, create workspace |
| `/model` | Show or change current model |
| `/memory` | Show or edit memory |
| `/compact` | Force context compaction |
| `/clear` | Clear conversation context |
| `/status` | Show context size, model, events |
| `/cancel` | Abort current operation |

## CLI Interface

```bash
pi-tg [options] <working-directory>

Options:
  --sandbox=host              Run tools on host (not recommended)
  --sandbox=docker:<name>     Run tools in Docker container (recommended)
  --model=<provider/model>    Override default model
```

### Startup Flow

1. Parse CLI args
2. Validate working directory
3. Load settings.json (or create defaults)
4. Initialize model registry (load pi-ai, extensions)
5. Connect to Docker container (if sandbox mode)
6. Start Telegram long polling
7. Log startup with model info

### Graceful Shutdown

- Stop accepting new messages
- Finish current agent run
- Save pending context
- Disconnect from Telegram
- Exit

### Error Recovery

- Network errors → Retry with backoff
- Telegram API errors → Log and continue
- LLM errors → Send error to user, keep running
- Sandbox errors → Report to user

## Example Usage

```bash
export TG_BOT_TOKEN=123456:ABC-DEF...
export ANTHROPIC_API_KEY=sk-ant-...

docker run -d --name tg-sandbox -v $(pwd)/data:/workspace alpine tail -f /dev/null

pi-tg --sandbox=docker:tg-sandbox ./data
```

## Enhancements Over pi-mom

1. **Multi-provider support** - Not limited to Anthropic
2. **Voice messages** - Transcription via Whisper
3. **Telegram-native features** - Message editing, better markdown

## Dependencies

```json
{
  "dependencies": {
    "@mariozechner/pi-ai": "workspace:*",
    "@mariozechner/pi-agent-core": "workspace:*",
    "grammy": "^1.x",
    "chalk": "^5.x"
  }
}
```

## Security

Same model as pi-mom:
- Docker sandbox recommended
- Credentials inside container can be exfiltrated via prompt injection
- Use dedicated bot tokens with minimal permissions
