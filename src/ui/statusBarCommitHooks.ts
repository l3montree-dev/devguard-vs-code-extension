import * as vscode from 'vscode';

export class StatusBarCommitHooks {
    private readonly item: vscode.StatusBarItem;

    constructor() {
        this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
        this.item.name = 'DevGuard Commit Hooks';
    }

    setActive(status: boolean): void {
        if (status) {
            this.item.text = '🔒 DevGuard - Commit Hooks';
            this.item.tooltip = 'DevGuard - Commit Hooks active. Click to remove hooks.';
            this.item.command = 'devguard.removeGitHooks';
        } else {
            this.item.text = `⚠️ DevGuard - Commit Hooks`;
            this.item.tooltip = `DevGuard - Commit Hooks not active. Click to insert hooks.`;
            this.item.command = 'devguard.setupGitHooks';
        }
        this.item.show();
    }

    dispose(): void {
        this.item.dispose();
    }
}
