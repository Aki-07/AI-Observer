import * as fs from "fs";
import * as fsp from "fs/promises";
import * as path from "path";
import { randomUUID } from "crypto";
import { EventBus } from "../core/EventBus";
import { AIInteraction } from "../types";

interface ChatRequestRecord {
  requestId?: string;
  message?: { text?: string };
  response?: Array<Record<string, unknown>>;
  timestamp?: number;
  modelId?: string;
}

interface ChatSessionDocument {
  sessionId?: string;
  creationDate?: string;
  lastMessageDate?: string;
  requests?: ChatRequestRecord[];
}

/**
 * Watches Copilot chat transcripts under VS Code’s workspaceStorage and emits
 * unified AIInteraction records so the dashboard treats chats like completions.
 */
export class CopilotChatMonitor {
  private watcher: fs.FSWatcher | undefined;
  private rescanTimer: NodeJS.Timeout | undefined;
  private readonly processed = new Set<string>();

  constructor(
    private readonly chatSessionsDir: string,
    private readonly eventBus: EventBus
  ) {}

  public async start(): Promise<void> {
    if (this.watcher || this.rescanTimer) {
      return;
    }

    try {
      await fsp.mkdir(this.chatSessionsDir, { recursive: true });
    } catch (error) {
      console.error(
        "AI Observer chat monitor could not prepare directory",
        error
      );
      return;
    }

    await this.scanSessions();

    this.watcher = fs.watch(this.chatSessionsDir, { persistent: false }, () => {
      this.scanSessions().catch((error) => {
        console.error(
          "AI Observer chat monitor incremental scan failed",
          error
        );
      });
    });

    this.rescanTimer = setInterval(() => {
      this.scanSessions().catch((error) => {
        console.error("AI Observer chat monitor periodic scan failed", error);
      });
    }, 15_000);
  }

  public stop(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = undefined;
    }
    if (this.rescanTimer) {
      clearInterval(this.rescanTimer);
      this.rescanTimer = undefined;
    }
  }

  private async scanSessions(): Promise<void> {
    let files: string[] = [];
    try {
      files = await fsp.readdir(this.chatSessionsDir);
    } catch (error) {
      console.error(
        "AI Observer chat monitor could not read chatSessions directory",
        error
      );
      return;
    }

    for (const entry of files) {
      if (!entry.endsWith(".json")) {
        continue;
      }
      await this.processSession(path.join(this.chatSessionsDir, entry));
    }
  }

  private async processSession(filePath: string): Promise<void> {
    let raw: string;
    try {
      raw = await fsp.readFile(filePath, "utf8");
    } catch (error) {
      console.error(
        `AI Observer chat monitor could not read ${filePath}`,
        error
      );
      return;
    }

    let doc: ChatSessionDocument;
    try {
      doc = JSON.parse(raw) as ChatSessionDocument;
    } catch (error) {
      console.error(
        `AI Observer chat monitor failed to parse ${filePath}`,
        error
      );
      return;
    }

    if (!Array.isArray(doc.requests)) {
      return;
    }

    for (const request of doc.requests) {
      const uniqueId = `${path.basename(filePath)}:${
        request.requestId ?? randomUUID()
      }`;
      if (this.processed.has(uniqueId)) {
        continue;
      }

      const prompt = (request.message?.text ?? "").trim();
      const response = this.extractResponseText(request.response ?? []);
      if (!prompt && !response) {
        this.processed.add(uniqueId);
        continue;
      }

      const timestamp = this.resolveTimestamp(request, doc);
      const interaction: AIInteraction = {
        id: randomUUID(),
        timestamp,
        type: "chat",
        prompt,
        response,
        language: "markdown",
        filePath: "copilot-chat",
        accepted: true,
        latency: 0,
        modelName: request.modelId ?? "copilot-chat",
        lineNumber: 0,
        characterCount: response.length,
        metadata: {
          requestId: request.requestId ?? null,
          sessionId: doc.sessionId ?? null,
          sourcePath: filePath,
        },
      };

      await this.eventBus.emit("interaction", interaction);
      this.processed.add(uniqueId);
      this.cullProcessed();
    }
  }

  private extractResponseText(parts: Array<Record<string, unknown>>): string {
    const chunks: string[] = [];

    for (const part of parts) {
      const kind =
        typeof (part as { kind?: unknown }).kind === "string"
          ? (part as { kind: string }).kind
          : undefined;

      if (kind === "toolInvocationSerialized") {
        const past = (part as { pastTenseMessage?: Record<string, unknown> })
          .pastTenseMessage;
        if (past && typeof past.value === "string") {
          chunks.push(past.value);
        }
        continue;
      }

      if (kind === "markdown") {
        const content = (part as { content?: Array<Record<string, unknown>> })
          .content;
        if (Array.isArray(content)) {
          for (const entry of content) {
            if (typeof entry?.value === "string") {
              chunks.push(entry.value);
            }
          }
        }
        continue;
      }

      const value = (part as { value?: unknown }).value;
      if (typeof value === "string") {
        chunks.push(value);
        continue;
      }

      const text = (part as { text?: unknown }).text;
      if (typeof text === "string") {
        chunks.push(text);
      }
    }

    return chunks.join("\n\n").trim();
  }

  private resolveTimestamp(
    request: ChatRequestRecord,
    doc: ChatSessionDocument
  ): number {
    if (
      typeof request.timestamp === "number" &&
      Number.isFinite(request.timestamp)
    ) {
      return request.timestamp;
    }
    if (typeof doc.lastMessageDate === "string") {
      const parsed = Date.parse(doc.lastMessageDate);
      if (!Number.isNaN(parsed)) {
        return parsed;
      }
    }
    if (typeof doc.creationDate === "string") {
      const parsed = Date.parse(doc.creationDate);
      if (!Number.isNaN(parsed)) {
        return parsed;
      }
    }
    return Date.now();
  }

  private cullProcessed(): void {
    const MAX_TRACKED = 5_000;
    if (this.processed.size <= MAX_TRACKED) {
      return;
    }

    const excess = this.processed.size - MAX_TRACKED;
    const iterator = this.processed.values();
    for (let index = 0; index < excess; index += 1) {
      const next = iterator.next();
      if (next.done) {
        break;
      }
      this.processed.delete(next.value);
    }
  }
}
