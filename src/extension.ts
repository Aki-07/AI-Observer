import * as vscode from 'vscode';
import * as path from 'path';
import * as crypto from 'crypto';
import { EventBus } from './core/EventBus';
import { StorageManager } from './core/StorageManager';
import { CopilotAdapter } from './adapters/CopilotAdapter';
import { AIInteraction } from './types';
import { DashboardProvider } from './dashboard/DashboardProvider';

let copilotAdapter: CopilotAdapter | null = null;

export function activate(context: vscode.ExtensionContext) {
  console.log('AI Observer is activating...');

  // Initialize event bus
  const eventBus = new EventBus();

  // Create the storage manager responsible for persisting interactions.
  const storage = new StorageManager(context.globalStorageUri.fsPath);

  const dashboardProvider = new DashboardProvider(context.extensionUri, storage);

  // Track whether logging is currently enabled via configuration.
  const configuration = vscode.workspace.getConfiguration();
  let loggingEnabled = configuration.get<boolean>('aiObserver.enableLogging', true);

  const configurationListener = vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration('aiObserver.enableLogging')) {
      loggingEnabled = configuration.get<boolean>('aiObserver.enableLogging', true);
    }
  });

  const interactionListener = async (data: AIInteraction) => {
    if (!loggingEnabled) {
      console.log('AI Observer logging disabled. Skipping interaction capture.');
      return;
    }

    await storage.saveInteraction(data);
    dashboardProvider.refresh();
  };
  eventBus.on('interaction', interactionListener);
  context.subscriptions.push(
    new vscode.Disposable(() => eventBus.off('interaction', interactionListener)),
    configurationListener,
  );

  // Test command to verify extension works
  const testCmd = vscode.commands.registerCommand('ai-observer.test', () => {
    vscode.window.showInformationMessage('AI Observer is working!');
  });

  const toggleLoggingCmd = vscode.commands.registerCommand(
    'ai-observer.toggleLogging',
    async () => {
      const next = !configuration.get<boolean>('aiObserver.enableLogging', true);

      await configuration.update('aiObserver.enableLogging', next, vscode.ConfigurationTarget.Global);

      loggingEnabled = next;
      const status = next ? 'enabled' : 'disabled';
      vscode.window.showInformationMessage(`AI Observer logging ${status}.`);
    },
  );

  const viewDashboardCmd = vscode.commands.registerCommand('ai-observer.viewDashboard', () => {
    dashboardProvider.show();
  });

  const exportLogsCmd = vscode.commands.registerCommand(
    'ai-observer.exportLogs',
    async () => {
      const defaultUri = vscode.Uri.file(
        path.join(context.globalStorageUri.fsPath, 'ai-observer-logs.json'),
      );

      const uri = await vscode.window.showSaveDialog({
        defaultUri,
        saveLabel: 'Export',
        filters: {
          JSON: ['json'],
          CSV: ['csv'],
        },
      });

      if (!uri) {
        return;
      }

      await storage.exportLogs(uri.fsPath);
      vscode.window.showInformationMessage(`Logs exported to ${uri.fsPath}`);
    },
  );

  const clearLogsCmd = vscode.commands.registerCommand(
    'ai-observer.clearLogs',
    async () => {
      const choice = await vscode.window.showWarningMessage(
        'Clear all stored AI interactions? This action cannot be undone.',
        'Yes',
        'No',
      );

      if (choice !== 'Yes') {
        return;
      }

      await storage.clearLogs();
      dashboardProvider.refresh();
      vscode.window.showInformationMessage('AI Observer logs cleared');
    },
  );

  const addTestDataCmd = vscode.commands.registerCommand(
    'ai-observer.addTestData',
    async () => {
      const now = Date.now();
      const languages = ['typescript', 'python', 'javascript', 'go', 'rust'];
      const fakeInteractions: AIInteraction[] = Array.from({ length: 5 }).map((_, index) => {
        const language = languages[index % languages.length];
        const latency = Math.floor(Math.random() * 400) + 100;
        return {
          id: crypto.randomUUID(),
          timestamp: now - index * 60000,
          type: 'completion',
          prompt: `Sample prompt ${index + 1}`,
          response: `Sample response ${index + 1}`,
          language,
          filePath: `/path/to/file-${index + 1}.${language === 'typescript' ? 'ts' : language}`,
          accepted: index % 2 === 0,
          latency,
          modelName: 'copilot',
          lineNumber: index + 1,
          characterCount: latency,
        };
      });

      for (const interaction of fakeInteractions) {
        await eventBus.emit('interaction', interaction);
      }

      vscode.window.showInformationMessage('Added 5 test interactions');
    },
  );

  context.subscriptions.push(
    testCmd,
    toggleLoggingCmd,
    viewDashboardCmd,
    exportLogsCmd,
    clearLogsCmd,
    addTestDataCmd,
  );

  console.log('AI Observer activated successfully');
}

export function deactivate() {
  if (copilotAdapter) {
    copilotAdapter.stop();
    copilotAdapter = null;
  }
  console.log('AI Observer deactivated');
}
