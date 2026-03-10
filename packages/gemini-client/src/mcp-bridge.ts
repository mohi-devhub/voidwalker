import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { DEFAULT_PORT } from "@voidwalker/shared";

const DEFAULT_SERVER_URL = `http://127.0.0.1:${process.env["VOIDWALKER_PORT"] ?? DEFAULT_PORT}/sse`;

export interface ResourceMeta {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export class McpBridge {
  private client = new Client(
    { name: "voidwalker-cli", version: "0.0.1" },
    { capabilities: {} },
  );

  async connect(serverUrl = DEFAULT_SERVER_URL): Promise<void> {
    const transport = new SSEClientTransport(new URL(serverUrl));
    await this.client.connect(transport);
  }

  async listResources(): Promise<ResourceMeta[]> {
    const result = await this.client.listResources();
    return result.resources as ResourceMeta[];
  }

  async readResource(uri: string): Promise<unknown> {
    const result = await this.client.readResource({ uri });
    const content = result.contents[0];
    if (!content) return null;
    if ("text" in content && content.mimeType === "application/json" && content.text) {
      return JSON.parse(content.text as string);
    }
    return "text" in content ? content.text : null;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    const result = await this.client.callTool({ name, arguments: args });
    const content = (result.content as Array<{ type: string; text?: string }>)[0];
    if (!content) return null;
    if (content.type === "text" && content.text) {
      try { return JSON.parse(content.text); } catch { return content.text; }
    }
    return null;
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}
