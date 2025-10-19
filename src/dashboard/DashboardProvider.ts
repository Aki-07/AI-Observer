import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { EventBus } from "../core/EventBus";
import { StorageManager } from "../core/StorageManager";

/**
 * Hosts the dashboard webview inside VS Code and keeps it synchronised with
 * the telemetry data stored by {@link StorageManager}.
 */
export class DashboardProvider {
  private panel: vscode.WebviewPanel | undefined;
  private readonly extensionUri: vscode.Uri;
  private readonly storage: StorageManager;
  private updateInterval: NodeJS.Timeout | undefined;

  constructor(
    extensionUri: vscode.Uri,
    storage: StorageManager,
    eventBus: EventBus
  ) {
    this.extensionUri = extensionUri;
    this.storage = storage;

    eventBus.on("interaction", () => this.refresh());
  }

  /**
   * Display the dashboard webview. When the panel already exists we simply
   * reveal it instead of creating a new one to preserve state.
   */
  public show(): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Two);
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      "aiObserverDashboard",
      "✨ AI Observer Dashboard",
      vscode.ViewColumn.Two,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [this.extensionUri],
      }
    );

    this.panel.webview.html = this.getHtmlContent();

    this.panel.webview.onDidReceiveMessage(async (msg) => {
      try {
        if (msg?.type === "refresh") {
          this.updateData();
        } else if (msg?.type === "export") {
          await vscode.commands.executeCommand("ai-observer.exportLogs");
        } else if (msg?.type === "clear") {
          await vscode.commands.executeCommand("ai-observer.clearLogs");
        }
      } catch (error) {
        console.error("Failed to handle dashboard message", error);
      }
    });

    this.panel.onDidDispose(() => {
      this.panel = undefined;
      if (this.updateInterval) {
        clearInterval(this.updateInterval);
        this.updateInterval = undefined;
      }
    });

    // Prime the dashboard with data and refresh it periodically while open.
    this.updateData();
    this.updateInterval = setInterval(() => this.updateData(), 5000);
  }

  /**
   * Push the latest analytics and interaction data into the webview.
   */
  private async updateData(): Promise<void> {
    if (!this.panel) {
      return;
    }

    try {
      const analytics = this.storage.getAnalytics();
      const interactions = this.storage.getInteractions();

      console.log("Dashboard updating with:", {
        totalInteractions: interactions.length,
        analyticsData: analytics,
      });

      await this.panel.webview.postMessage({
        type: "update",
        data: {
          analytics,
          recentInteractions: interactions.slice(-20).reverse(),
          totalInteractions: interactions.length,
        },
      });
    } catch (error) {
      console.error("Failed to update dashboard data", error);
    }
  }

  /**
   * Read the dashboard HTML from disk and inject the CSP nonce required by the
   * webview environment.
   */
  private getHtmlContent(): string {
    const htmlPath = path.join(
      this.extensionUri.fsPath,
      "src",
      "dashboard",
      "dashboard.html"
    );

    try {
      const nonce = this.getNonce();
      const rawHtml = fs.readFileSync(htmlPath, "utf-8");
      return rawHtml.replace(/\$\{nonce\}/g, nonce);
    } catch (error) {
      console.error("Unable to load dashboard HTML", error);
      const errorMessage = `Failed to load dashboard UI. Check the developer console for details.`;
      return `<!DOCTYPE html><html lang="en"><body><h1>${errorMessage}</h1></body></html>`;
    }
  }

  /**
   * Generate a cryptographically random nonce for use inside the CSP.
   */
  private getNonce(): string {
    const possible =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let text = "";
    for (let i = 0; i < 32; i += 1) {
      text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
  }

  /**
   * Trigger a refresh if the dashboard is currently visible.
   */
  public async refresh(): Promise<void> {
    console.log("Dashboard refresh requested");
    if (this.panel) {
      await this.updateData();
    }
  }

  public getTotalInteractions(): number {
    return this.storage.getInteractions().length;
  }

  public getInteractionsPerLanguage(): Map<string, number> {
    const interactions = this.storage.getInteractions();
    const languageCounts = new Map<string, number>();

    for (const interaction of interactions) {
      const existing = languageCounts.get(interaction.language) ?? 0;
      languageCounts.set(interaction.language, existing + 1);
    }

    return languageCounts;
  }
}
