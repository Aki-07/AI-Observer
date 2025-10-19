import * as vscode from 'vscode';
import * as path from 'path';
import * as crypto from 'crypto';
import * as fsp from 'fs/promises';
import { EventBus } from './core/EventBus';
import { StorageManager } from './core/StorageManager';
import { CopilotAdapter } from './adapters/CopilotAdapter';
import { AIInteraction } from './types';
import { DashboardProvider } from './dashboard/DashboardProvider';
import { CopilotChatMonitor } from './adapters/CoPilotChatMonitor';

let copilotAdapter: CopilotAdapter | null = null;
let chatMonitor: CopilotChatMonitor | null = null;

export function activate(context: vscode.ExtensionContext) {
  console.log('AI Observer is activating...');

  const eventBus = new EventBus();

  const storage = new StorageManager(context.globalStorageUri.fsPath);

  const dashboardProvider = new DashboardProvider(context.extensionUri, storage, eventBus);

  copilotAdapter = new CopilotAdapter(eventBus);

  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'ai-observer.viewDashboard';
  statusBarItem.name = 'AI Observer';
  statusBarItem.text = '$(graph) AI Observer';
  statusBarItem.show();

  const getConfiguration = () => vscode.workspace.getConfiguration('aiObserver');
  let loggingEnabled = getConfiguration().get<boolean>('enableLogging', true);
  let chatMonitorRetry: NodeJS.Timeout | undefined;

  const refreshStatusBar = () => {
    const total = dashboardProvider.getTotalInteractions();
    const parts: string[] = ['$(graph) AI Observer'];
    if (!loggingEnabled) {
      parts.push('paused');
    } else if (total > 0) {
      parts.push(`${total}`);
    }
    statusBarItem.text = parts.join(' ');
    statusBarItem.tooltip = loggingEnabled
      ? total > 0
        ? `AI Observer · ${total} interactions captured`
        : 'AI Observer · monitoring Copilot usage'
      : 'AI Observer · logging disabled';
  };

  const updateStorageLimit = () => {
    const limit = getConfiguration().get<number>('storageLimit', 10000) ?? 10000;
    storage.setMaxInteractions(limit);
  };
  updateStorageLimit();
  refreshStatusBar();

  const ensureChatMonitor = async (): Promise<CopilotChatMonitor | null> => {
    if (chatMonitor) {
      return chatMonitor;
    }

    const chatDir = await resolveCopilotChatSessionsDirectory(context);
    if (!chatDir) {
      console.warn('AI Observer could not locate Copilot chat transcripts directory');
      return null;
    }

    chatMonitor = new CopilotChatMonitor(chatDir, eventBus);
    return chatMonitor;
  };

  const scheduleChatMonitorRetry = () => {
    if (chatMonitorRetry || chatMonitor || !loggingEnabled) {
      return;
    }

    chatMonitorRetry = setTimeout(async () => {
      chatMonitorRetry = undefined;
      if (!loggingEnabled || chatMonitor) {
        return;
      }
      const monitor = await ensureChatMonitor();
      if (monitor) {
        await monitor.start();
      } else {
        scheduleChatMonitorRetry();
      }
    }, 10_000);
  };

  const applyLoggingState = async (enabled: boolean, options: { notify?: boolean } = {}) => {
    loggingEnabled = enabled;

    if (copilotAdapter) {
      if (enabled) {
        copilotAdapter.start();
      } else {
        copilotAdapter.stop();
      }
    }

    if (!enabled && chatMonitorRetry) {
      clearTimeout(chatMonitorRetry);
      chatMonitorRetry = undefined;
    }

    const monitor = await ensureChatMonitor();
    if (monitor) {
      if (enabled) {
        await monitor.start();
      } else {
        monitor.stop();
      }
    } else if (enabled) {
      scheduleChatMonitorRetry();
    }

    refreshStatusBar();

    if (options.notify) {
      const status = enabled ? 'enabled' : 'disabled';
      vscode.window.showInformationMessage(`AI Observer logging ${status}.`);
    }
  };

  const configurationListener = vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration('aiObserver.enableLogging')) {
      void applyLoggingState(getConfiguration().get<boolean>('enableLogging', true) ?? true);
    }
    if (event.affectsConfiguration('aiObserver.storageLimit')) {
      updateStorageLimit();
    }
  });

  void applyLoggingState(loggingEnabled);

  const interactionListener = async (data: AIInteraction) => {
    if (!loggingEnabled) {
      console.log('AI Observer logging disabled. Skipping interaction capture.');
      return;
    }

    await storage.saveInteraction(data);
    dashboardProvider.refresh();
    refreshStatusBar();
  };
  eventBus.on('interaction', interactionListener);
  context.subscriptions.push(
    new vscode.Disposable(() => eventBus.off('interaction', interactionListener)),
    configurationListener,
    statusBarItem,
    new vscode.Disposable(() => {
      if (chatMonitorRetry) {
        clearTimeout(chatMonitorRetry);
        chatMonitorRetry = undefined;
      }
    }),
    new vscode.Disposable(() => {
      chatMonitor?.stop();
      chatMonitor = null;
    }),
  );

  const testCmd = vscode.commands.registerCommand('ai-observer.test', () => {
    vscode.window.showInformationMessage('AI Observer is working!');
  });

  const toggleLoggingCmd = vscode.commands.registerCommand(
    'ai-observer.toggleLogging',
    async () => {
      const config = getConfiguration();
      const next = !config.get<boolean>('enableLogging', true);

      await config.update('enableLogging', next, vscode.ConfigurationTarget.Global);

      await applyLoggingState(next, { notify: true });
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
      refreshStatusBar();
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
      refreshStatusBar();
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
    toggleLoggingCmd,
    viewDashboardCmd,
    exportLogsCmd,
    clearLogsCmd,
    addTestDataCmd,
    adapterStatsCmd,
  );

  console.log('AI Observer activated successfully');
}

export function deactivate() {
  if (copilotAdapter) {
    copilotAdapter.stop();
    copilotAdapter = null;
  }
  if (chatMonitor) {
    chatMonitor.stop();
    chatMonitor = null;
  }
  console.log('AI Observer deactivated');
}

async function resolveCopilotChatSessionsDirectory(
  context: vscode.ExtensionContext,
): Promise<string | null> {
  try {
    const globalStoragePath = context.globalStorageUri?.fsPath;
    if (!globalStoragePath) {
      return null;
    }

    const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
    if (workspaceFolders.length === 0) {
      return null;
    }

    const workspaceRoots = workspaceFolders
      .map((folder) => folder.uri.fsPath)
      .filter((fsPath) => fsPath && fsPath.length > 0);

    if (workspaceRoots.length === 0) {
      return null;
    }

    const workspaceStorageRoot = path.resolve(globalStoragePath, '..', '..', 'workspaceStorage');
    try {
      const rootStats = await fsp.stat(workspaceStorageRoot);
      if (!rootStats.isDirectory()) {
        return null;
      }
    } catch {
      return null;
    }

    const entries = await fsp.readdir(workspaceStorageRoot, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const candidateRoot = path.join(workspaceStorageRoot, entry.name);
      const descriptorPath = path.join(candidateRoot, 'workspace.json');

      let descriptor: Record<string, unknown> | undefined;
      try {
        const raw = await fsp.readFile(descriptorPath, 'utf8');
        descriptor = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        continue;
      }

      const candidateUris = collectWorkspaceUris(descriptor);
      const candidateFsPaths = candidateUris.map(normalizeWorkspaceUri).filter(Boolean);

      const matchesWorkspace = candidateFsPaths.some((fsPath) =>
        workspaceRoots.some((root) => samePath(root, fsPath)),
      );

      if (!matchesWorkspace) {
        continue;
      }

      const chatSessionsPath = path.join(candidateRoot, 'chatSessions');
      await fsp.mkdir(chatSessionsPath, { recursive: true });
      return chatSessionsPath;
    }

    return null;
  } catch (error) {
    console.error('AI Observer failed to resolve Copilot chat transcripts directory', error);
    return null;
  }
}

function collectWorkspaceUris(descriptor: Record<string, unknown>): string[] {
  const uris: string[] = [];

  const maybeAdd = (value: unknown) => {
    if (typeof value === 'string' && value.length > 0) {
      uris.push(value);
    }
  };

  maybeAdd(descriptor['folder']);
  maybeAdd(descriptor['folderUri']);

  const folders = descriptor['folders'];
  if (Array.isArray(folders)) {
    for (const item of folders) {
      if (typeof item === 'string') {
        maybeAdd(item);
      } else if (item && typeof item === 'object') {
        const record = item as Record<string, unknown>;
        maybeAdd(record.uri);
        maybeAdd(record.folderUri);
      }
    }
  }

  return uris;
}

function normalizeWorkspaceUri(value: string): string {
  try {
    const parsed = vscode.Uri.parse(value);
    if (parsed.scheme === 'file') {
      return parsed.fsPath;
    }
  } catch {
    // noop
  }
  return value;
}

function samePath(a: string, b: string): boolean {
  const normalize = (input: string) => {
    const resolved = path.resolve(input);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  };

  const normalizedA = normalize(a);
  const normalizedB = normalize(b);

  return normalizedA === normalizedB;
}
