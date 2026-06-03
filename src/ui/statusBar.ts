import * as vscode from 'vscode';

export interface StatusState {
	connected: boolean;
	assetLabel?: string;
}

export class StatusBar {
	private readonly item: vscode.StatusBarItem;

	constructor() {
		this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
		this.item.name = 'DevGuard';
	}

	update(state: StatusState): void {
		if (!state.connected) {
			this.item.text = '$(shield) DevGuard';
			this.item.tooltip = 'DevGuard: not connected. Click to connect with a personal access token.';
			this.item.command = 'devguard.connect';
		} else if (!state.assetLabel) {
			this.item.text = '$(shield) DevGuard: connected';
			this.item.tooltip = 'Connected to DevGuard. Click to select an organization / project / asset.';
			this.item.command = 'devguard.selectAsset';
		} else {
			this.item.text = `$(shield) ${state.assetLabel}`;
			this.item.tooltip = `DevGuard asset: ${state.assetLabel}. Click to change.`;
			this.item.command = 'devguard.selectAsset';
		}
		this.item.show();
	}

	dispose(): void {
		this.item.dispose();
	}
}
