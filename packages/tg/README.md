# pi-tg

A personal AI assistant Telegram bot powered by LLMs. pi-tg lets you interact with an AI agent that can execute bash commands, read/write files, and interact with your development environment - all through Telegram.

## Features

- **Multi-provider AI support**: Works with Anthropic, OpenAI, Google, Groq, Together AI, and more
- **Voice messages**: Transcribes voice messages using OpenAI Whisper
- **File handling**: Upload and download files via Telegram
- **Scheduled events**: Set reminders and recurring tasks
- **Sandboxed execution**: Run commands safely in Docker containers
- **Per-chat memory**: Each chat maintains its own context and history

## Installation

```bash
npm install -g @mariozechner/pi-tg
```

## Quick Start

### 1. Create a Telegram Bot

1. Message [@BotFather](https://t.me/BotFather) on Telegram
2. Send `/newbot` and follow the prompts
3. Copy the bot token

### 2. Set Environment Variables

```bash
export TG_BOT_TOKEN=123456789:ABC-DEF...
export ANTHROPIC_API_KEY=sk-ant-...  # or your preferred provider
export OPENAI_API_KEY=sk-...          # optional, for voice transcription
```

### 3. Run the Bot

```bash
# Run with host tools (not recommended for untrusted use)
pi-tg --sandbox=host ./data

# Run with Docker sandbox (recommended)
pi-tg --sandbox=docker:tg-sandbox ./data
```

## Command Line Options

```
Usage: pi-tg [options] <working-directory>

Options:
  --sandbox=host              Run tools on host machine
  --sandbox=docker:<name>     Run tools in Docker container (recommended)
  --model=<provider/model>    Override default model
  --help, -h                  Show help

Working directory is where chat data, attachments, and settings are stored.
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `TG_BOT_TOKEN` | Yes | Telegram bot token from BotFather |
| `ANTHROPIC_API_KEY` | Yes* | Anthropic API key (default provider) |
| `OPENAI_API_KEY` | No | OpenAI API key for voice transcription |
| `GOOGLE_API_KEY` | No | Google AI API key |
| `GROQ_API_KEY` | No | Groq API key |
| `TOGETHER_API_KEY` | No | Together AI API key |

*At least one LLM provider API key is required.

## Bot Commands

- `/start` - Start the bot and get a welcome message
- `/stop` or `/cancel` - Stop the current running task
- `/model <provider/model>` - Switch AI model (not yet implemented)

## Docker Setup

Create a Docker container for sandboxed execution:

```bash
docker run -d --name tg-sandbox \
  -v /path/to/data:/workspace \
  alpine:latest tail -f /dev/null
```

Then run pi-tg with:

```bash
pi-tg --sandbox=docker:tg-sandbox ./data
```

## Data Directory Structure

```
<working-dir>/
├── settings.json            # Bot settings (model, etc.)
├── events/                  # Scheduled events
└── <chat-id>/               # Per-chat data
    ├── context.jsonl        # Conversation context
    ├── log.jsonl            # Message history
    ├── MEMORY.md            # Chat-specific memory
    ├── attachments/         # Downloaded files
    └── scratch/             # Working directory for agent
```

## License

MIT

## Related Projects

- [pi-mom](../mom) - Slack bot version
- [pi-coding-agent](../coding-agent) - Core coding agent
- [pi-ai](../ai) - Multi-provider AI library
