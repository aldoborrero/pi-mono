import { getModel, type Model, type Api } from "@mariozechner/pi-ai";
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
		// Cast to any since getModel will throw if provider/model is invalid
		return getModel(provider as any, id);
	} catch (error) {
		log.logWarning(`Failed to resolve model ${provider}/${id}`, String(error));

		// Try fallback models
		if (settings.fallbackModels) {
			for (const fallback of settings.fallbackModels) {
				try {
					log.logInfo(`Trying fallback model: ${fallback.provider}/${fallback.id}`);
					return getModel(fallback.provider as any, fallback.id);
				} catch {
					continue;
				}
			}
		}

		return undefined;
	}
}

export function getApiKeyEnvVar(provider: string): string {
	const providerEnvMap: Record<string, string> = {
		anthropic: "ANTHROPIC_API_KEY",
		openai: "OPENAI_API_KEY",
		google: "GOOGLE_API_KEY",
		groq: "GROQ_API_KEY",
		together: "TOGETHER_API_KEY",
		deepseek: "DEEPSEEK_API_KEY",
	};
	return providerEnvMap[provider] ?? `${provider.toUpperCase()}_API_KEY`;
}

export function getApiKey(provider: string): string | undefined {
	const envVar = getApiKeyEnvVar(provider);
	return process.env[envVar];
}
