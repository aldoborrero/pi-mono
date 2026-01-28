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
