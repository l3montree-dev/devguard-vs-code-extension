import * as vscode from 'vscode';
import { DevGuardClient, DevGuardHttpError } from './api/client';
import { registerCommands } from './commands';
import * as config from './config';
import { ConnectionManager } from './connection';
import { InsightController } from './controller';
import { PurlCache } from './enrich/cache';
import { EnrichmentService } from './enrich/enrich';
import { InsightStore } from './insightStore';
import { Logger } from './logger';
import { isPackageJson } from './packageJson/parse';
import { SbomDocumentProvider } from './sbomDocuments';
import { AssetSelection } from './selection';
import { DecorationManager } from './ui/decorations';
import { DevGuardHoverProvider } from './ui/hover';
import { StatusBar } from './ui/statusBar';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	const logger = new Logger();
	const connection = new ConnectionManager(context.secrets);
	const client = new DevGuardClient(logger, connection.getToken);
	const cache = new PurlCache(context.workspaceState);
	const enrich = new EnrichmentService(client, cache);
	const store = new InsightStore();
	const decorations = new DecorationManager();
	const selection = new AssetSelection(context.workspaceState, client);
	const statusBar = new StatusBar();
	const sbomProvider = new SbomDocumentProvider();
	const controller = new InsightController(enrich, decorations, store, connection, selection, logger);

	await connection.init();
	await selection.init();

	const updateStatus = (): void =>
		statusBar.update({ connected: connection.isConnected(), assetLabel: selection.getSelected()?.label });
	updateStatus();

	const hoverSelector: vscode.DocumentSelector = [
		{ language: 'json', pattern: '**/package.json' },
		{ language: 'jsonc', pattern: '**/package.json' },
	];

	context.subscriptions.push(
		logger,
		decorations,
		statusBar,
		connection,
		selection,
		controller,
		new vscode.Disposable(() => cache.dispose()),
		vscode.languages.registerHoverProvider(hoverSelector, new DevGuardHoverProvider(store)),
		vscode.workspace.registerTextDocumentContentProvider(SbomDocumentProvider.scheme, sbomProvider),
		...registerCommands({ client, connection, selection, controller, cache, sbomProvider, logger }),
	);

	context.subscriptions.push(
		connection.onDidChange(() => updateStatus()),
		selection.onDidChange(() => {
			updateStatus();
			controller.refreshVisible();
		}),
	);

	let lastApiUrl = config.getApiUrl();
	context.subscriptions.push(
		vscode.window.onDidChangeActiveTextEditor((editor) => {
			if (editor && isPackageJson(editor.document)) {
				void controller.refreshDocument(editor.document);
			}
		}),
		vscode.workspace.onDidChangeTextDocument((e) => {
			if (isPackageJson(e.document)) {
				controller.scheduleRefresh(e.document);
			}
		}),
		vscode.workspace.onDidSaveTextDocument((doc) => {
			if (isPackageJson(doc)) {
				void controller.refreshDocument(doc);
			}
		}),
		vscode.workspace.onDidCloseTextDocument((doc) => store.delete(doc.uri)),
		config.onDidChangeConfig(() => {
			const now = config.getApiUrl();
			if (now !== lastApiUrl) {
				lastApiUrl = now;
				cache.invalidateAll();
				selection.invalidateXref();
			}
			controller.refreshVisible();
		}),
	);

	controller.refreshVisible();

	if (connection.isConnected()) {
		void validateStoredToken(client, connection, logger, updateStatus);
	}

	logger.info('DevGuard extension activated.');
}

export function deactivate(): void {
	// Disposables registered on the context are cleaned up by VS Code.
}

/** If a saved token is no longer accepted, quietly downgrade so state stays honest. */
async function validateStoredToken(
	client: DevGuardClient,
	connection: ConnectionManager,
	logger: Logger,
	updateStatus: () => void,
): Promise<void> {
	try {
		const who = await client.whoami();
		if (who.userID === 'NO_SESSION') {
			logger.warn('the saved token signature was rejected; signed features may not work.');
		}
	} catch (err) {
		if (err instanceof DevGuardHttpError && err.status === 401) {
			await connection.disconnect();
			updateStatus();
			vscode.window.showWarningMessage('DevGuard: your saved token is no longer recognized. Please reconnect.');
		}
		// Network errors are ignored: the backend may simply be offline.
	}
}
