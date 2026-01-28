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
