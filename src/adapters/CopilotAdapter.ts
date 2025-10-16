import * as vscode from 'vscode';
import { randomUUID } from 'crypto';
import { AIInteraction } from '../types';
import { EventBus } from '../core/EventBus';

/**
 * Adapter responsible for listening to VS Code events and inferring when the
 * user accepts a GitHub Copilot suggestion. Copilot does not expose a public
 * API for telemetry, so we lean on heuristics derived from text document
 * changes and cursor movement to approximate the behaviour.
 */
export class CopilotAdapter {
  private eventBus: EventBus;
  private isRunning = false;
  private disposables: vscode.Disposable[] = [];

  /**
   * Suggestions waiting for confirmation that the user accepted them. The map
   * key combines the document URI and line number where the suggestion was
   * presented. Once a text edit is detected at that location, we treat it as an
   * acceptance and emit an interaction event.
   */
  private pendingSuggestions: Map<
    string,
    {
      id: string;
      startTime: number;
      document: vscode.TextDocument;
      position: vscode.Position;
      contextBefore: string;
    }
  > = new Map();

  constructor(eventBus: EventBus) {
    this.eventBus = eventBus;
  }

  /**
   * Begin monitoring VS Code for signals that indicate Copilot usage.
   */
  public start(): void {
    if (this.isRunning) {
      console.log('CopilotAdapter already running, start() ignored');
      return;
    }

    this.isRunning = true;

    const copilotExt = vscode.extensions.getExtension('GitHub.copilot');
    if (!copilotExt) {
      vscode.window.showWarningMessage('GitHub Copilot not detected');
      console.warn('CopilotAdapter start() aborted - GitHub.copilot extension missing');
      this.isRunning = false;
      return;
    }

    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument(this.onTextChange.bind(this)),
      vscode.window.onDidChangeTextEditorSelection(this.onSelectionChange.bind(this)),
      vscode.window.onDidChangeActiveTextEditor(this.onEditorChange.bind(this)),
    );

    console.log('CopilotAdapter started');
  }

  /**
   * Stop monitoring and dispose all event listeners.
   */
  public stop(): void {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;

    this.disposables.forEach((d) => {
      try {
        d.dispose();
      } catch (error) {
        console.error('Failed to dispose CopilotAdapter listener', error);
      }
    });
    this.disposables = [];

    this.pendingSuggestions.clear();
    console.log('CopilotAdapter stopped');
  }

  /**
   * Track cursor movements so we can capture the surrounding context when the
   * user pauses. Copilot tends to produce suggestions shortly after the cursor
   * settles, so we snapshot the preceding text for use as the "prompt".
   */
  private onSelectionChange(e: vscode.TextEditorSelectionChangeEvent): void {
    if (!this.isRunning) {
      return;
    }

    const editor = e.textEditor;
    if (!editor || !editor.document) {
      return;
    }

    const position = editor.selection.active;
    const startLine = Math.max(0, position.line - 50);
    const range = new vscode.Range(startLine, 0, position.line, position.character);
    const contextBefore = editor.document.getText(range);

    const suggestionId = randomUUID();
    const key = `${editor.document.uri.toString()}-${position.line}`;

    this.pendingSuggestions.set(key, {
      id: suggestionId,
      startTime: Date.now(),
      document: editor.document,
      position,
      contextBefore,
    });

    console.log(
      `Tracking potential Copilot suggestion at ${editor.document.uri.toString()}:${position.line}`,
    );

    const now = Date.now();
    for (const [pendingKey, pending] of this.pendingSuggestions.entries()) {
      if (now - pending.startTime > 30_000) {
        this.pendingSuggestions.delete(pendingKey);
        console.log(`Discarded stale Copilot suggestion ${pending.id}`);
      }
    }
  }

  /**
   * Listen for text document edits and use heuristics to infer when Copilot
   * suggestions have been accepted by the user.
   */
  private async onTextChange(e: vscode.TextDocumentChangeEvent): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    if (!e || !e.document || e.document.isUntitled) {
      return;
    }

    if (!e.contentChanges || e.contentChanges.length === 0) {
      return;
    }

    for (const change of e.contentChanges) {
      if (!change.text) {
        continue;
      }

      // Heuristic explanation:
      //  - Copilot usually inserts entire blocks, so multi-line text is a strong signal.
      //  - Even for single-line suggestions, the completion tends to exceed typical typing
      //    bursts. We therefore treat long (>50 char) single-line inserts as likely AI.
      const isLikelyAI =
        change.text.length > 20 && (change.text.includes('\n') || change.text.length > 50);

      if (!isLikelyAI) {
        continue;
      }

      const key = `${e.document.uri.toString()}-${change.range.start.line}`;
      const pending = this.pendingSuggestions.get(key);

      if (pending) {
        const latency = Date.now() - pending.startTime;
        const interaction: AIInteraction = {
          id: pending.id,
          timestamp: Date.now(),
          type: 'completion',
          prompt: pending.contextBefore,
          response: change.text,
          language: e.document.languageId,
          filePath: vscode.workspace.asRelativePath(e.document.uri),
          accepted: true,
          latency,
          modelName: 'copilot',
          lineNumber: change.range.start.line,
          characterCount: change.text.length,
        };

        await this.eventBus.emit('interaction', interaction);
        this.pendingSuggestions.delete(key);
        console.log(`Captured Copilot interaction: ${interaction.id}`);
      } else {
        // We did not observe the cursor pause event, but a large chunk of text appeared
        // suddenly. To avoid missing telemetry entirely, we still record the event albeit
        // with limited context.
        const interaction: AIInteraction = {
          id: randomUUID(),
          timestamp: Date.now(),
          type: 'completion',
          prompt: '',
          response: change.text,
          language: e.document.languageId,
          filePath: vscode.workspace.asRelativePath(e.document.uri),
          accepted: true,
          latency: 0,
          modelName: 'copilot',
          lineNumber: change.range.start.line,
          characterCount: change.text.length,
        };

        await this.eventBus.emit('interaction', interaction);
        console.log(`Captured Copilot interaction (no context): ${interaction.id}`);
      }
    }
  }

  /**
   * When the user switches editors we clear any tracked suggestions because
   * Copilot's ghost text will no longer be relevant to the new document.
   */
  private onEditorChange(editor: vscode.TextEditor | undefined): void {
    if (!this.isRunning) {
      return;
    }

    this.pendingSuggestions.clear();
    console.log('Switched editor, cleared pending suggestions');
  }

  /**
   * Provide adapter status for debugging and quick diagnostics.
   */
  public getStats(): { running: boolean; pendingSuggestions: number } {
    return {
      running: this.isRunning,
      pendingSuggestions: this.pendingSuggestions.size,
    };
  }
}
