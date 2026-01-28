import { Type } from "@sinclair/typebox";
import { existsSync, statSync } from "fs";
import { basename, resolve as resolvePath } from "path";
import type { AgentTool } from "@mariozechner/pi-agent-core";

let uploadFunction: ((filePath: string, caption?: string) => Promise<void>) | undefined;

export function setUploadFunction(fn: (filePath: string, caption?: string) => Promise<void>) {
	uploadFunction = fn;
}

const attachSchema = Type.Object({
	label: Type.String({ description: "Brief description of what you're sharing (shown to user)" }),
	path: Type.String({ description: "Absolute path to the file to send" }),
	caption: Type.Optional(Type.String({ description: "Optional caption for the file" })),
});

export const attachTool: AgentTool<typeof attachSchema> = {
	name: "attach",
	label: "Attach",
	description: "Send a file to the user via Telegram. Use for sharing generated files, images, documents, etc.",
	parameters: attachSchema,
	async execute(_toolCallId, { path, caption }) {
		if (!uploadFunction) {
			throw new Error("Upload function not configured");
		}

		const absolutePath = resolvePath(path);

		if (!existsSync(absolutePath)) {
			throw new Error(`File not found: ${absolutePath}`);
		}

		const stats = statSync(absolutePath);
		if (stats.size > 50 * 1024 * 1024) {
			throw new Error(`File too large (max 50MB): ${absolutePath}`);
		}

		await uploadFunction(absolutePath, caption);
		return {
			content: [{ type: "text", text: `Sent file: ${basename(absolutePath)}` }],
		};
	},
};
