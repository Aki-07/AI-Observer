import * as vscode from 'vscode';
import { EventBus } from './core/EventBus';

export function activate(context: vscode.ExtensionContext) {
  console.log('AI Observer is activating...');

  // Initialize event bus
  const eventBus = new EventBus();

  // Test command to verify extension works
  const testCmd = vscode.commands.registerCommand('ai-observer.test', () => {
    vscode.window.showInformationMessage('AI Observer is working!');
  });

  context.subscriptions.push(testCmd);

  console.log('AI Observer activated successfully');
}

export function deactivate() {
  console.log('AI Observer deactivated');
}
