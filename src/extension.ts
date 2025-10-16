import * as vscode from 'vscode';
import * as path from 'path';
import * as crypto from 'crypto';
import { EventBus } from './core/EventBus';
import { StorageManager } from './core/StorageManager';
import { CopilotAdapter } from './adapters/CopilotAdapter';
import { AIInteraction } from './types';

let copilotAdapter: CopilotAdapter | null = null;

export function activate(context: vscode.ExtensionContext) {
  console.log('AI Observer is activating...');

  // Initialize event bus
  const eventBus = new EventBus();

  // Create the storage manager responsible for persisting interactions.
  const storage = new StorageManager(context.globalStorageUri.fsPath);

  // Adapter responsible for detecting GitHub Copilot activity. It stays dormant
  // until logging is enabled via settings or the toggle command.
  copilotAdapter = new CopilotAdapter(eventBus);

  const interactionListener = async (data: AIInteraction) => {
    await storage.saveInteraction(data);
  };
  eventBus.on('interaction', interactionListener);
  context.subscriptions.push(
    new vscode.Disposable(() => eventBus.off('interaction', interactionListener)),
  );

  // Test command to verify extension works
  const testCmd = vscode.commands.registerCommand('ai-observer.test', () => {
    vscode.window.showInformationMessage('AI Observer is working!');
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

  const toggleLoggingCmd = vscode.commands.registerCommand(
    'ai-observer.toggleLogging',
    async () => {
      const config = vscode.workspace.getConfiguration('aiObserver');
      const current = config.get<boolean>('enableLogging', true);
      await config.update('enableLogging', !current, vscode.ConfigurationTarget.Global);

      if (!current && copilotAdapter) {
        copilotAdapter.start();
        vscode.window.showInformationMessage('AI Observer logging enabled');
      } else if (copilotAdapter) {
        copilotAdapter.stop();
        vscode.window.showInformationMessage('AI Observer logging disabled');
      }
    },
  );

  const adapterStatsCmd = vscode.commands.registerCommand('ai-observer.adapterStats', () => {
    if (!copilotAdapter) {
      vscode.window.showWarningMessage('Copilot adapter not initialised');
      return;
    }

    const stats = copilotAdapter.getStats();
    vscode.window.showInformationMessage(
      `Adapter running: ${stats.running}, Pending: ${stats.pendingSuggestions}`,
    );
  });

  context.subscriptions.push(
    testCmd,
    exportLogsCmd,
    clearLogsCmd,
    addTestDataCmd,
    toggleLoggingCmd,
    adapterStatsCmd,
  );

  const config = vscode.workspace.getConfiguration('aiObserver');
  if (config.get<boolean>('enableLogging', true) && copilotAdapter) {
    copilotAdapter.start();
  }

  console.log('AI Observer activated successfully');
}

export function deactivate() {
  if (copilotAdapter) {
    copilotAdapter.stop();
    copilotAdapter = null;
  }
  console.log('AI Observer deactivated');
}
