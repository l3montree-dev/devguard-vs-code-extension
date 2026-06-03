import { spawn } from 'node:child_process';
import * as vscode from 'vscode';
import { DevGuardClient, DevGuardHttpError, DevGuardNetworkError } from './api/client';
import { isValidTokenFormat } from './api/signing';
import * as config from './config';
import { ConnectionManager } from './connection';
import { InsightController } from './controller';
import { PurlCache } from './enrich/cache';
import { Logger } from './logger';
import { SbomDocumentProvider } from './sbomDocuments';
import { AssetSelection, SelectedAsset } from './selection';

export interface CommandDeps {
	client: DevGuardClient;
	connection: ConnectionManager;
	selection: AssetSelection;
	controller: InsightController;
	cache: PurlCache;
	sbomProvider: SbomDocumentProvider;
	logger: Logger;
}

export function registerCommands(deps: CommandDeps): vscode.Disposable[] {
	return [
		vscode.commands.registerCommand('devguard.connect', () => connect(deps)),
		vscode.commands.registerCommand('devguard.disconnect', () => disconnect(deps)),
		vscode.commands.registerCommand('devguard.selectAsset', () => selectAsset(deps)),
		vscode.commands.registerCommand('devguard.refresh', () => refresh(deps)),
		vscode.commands.registerCommand('devguard.setupDependencyProxy', () => setupDependencyProxy(deps)),
		vscode.commands.registerCommand('devguard.viewSbom', () => viewSbom(deps)),
		vscode.commands.registerCommand('devguard.generateSbom', () => generateSbom(deps)),
	];
}

type ConnectResult =
	| { ok: true }
	| { ok: false; kind: 'unverified' }
	| { ok: false; kind: 'error'; err: unknown };

async function connect({ client, connection, controller, logger }: CommandDeps): Promise<void> {
	if (!config.isApiUrlValid()) {
		vscode.window.showErrorMessage('DevGuard: set a valid devguard.apiUrl before connecting.');
		return;
	}
	if (config.isInsecureRemote()) {
		const proceed = await vscode.window.showWarningMessage(
			'DevGuard: the API URL uses plain http on a non-local host. Connecting would send signed requests over an unencrypted connection.',
			{ modal: true },
			'Connect anyway',
		);
		if (proceed !== 'Connect anyway') {
			return;
		}
	}

	const token = (
		await vscode.window.showInputBox({
			title: 'DevGuard Personal Access Token',
			prompt: 'Paste your DevGuard PAT. Stored securely in VS Code Secret Storage — never written to settings or logs.',
			placeHolder: 'hex-encoded token',
			password: true,
			ignoreFocusOut: true,
		})
	)?.trim();
	if (!token) {
		return;
	}
	if (!isValidTokenFormat(token)) {
		vscode.window.showErrorMessage('DevGuard: that does not look like a valid token (a hex-encoded key was expected).');
		return;
	}

	const result = await vscode.window.withProgress<ConnectResult>(
		{ location: vscode.ProgressLocation.Notification, title: 'DevGuard: validating token…' },
		async () => {
			try {
				const who = await connection.withCandidate(token, () => client.whoami());
				if (who.userID && who.userID !== 'NO_SESSION') {
					await connection.setToken(token, who.userID);
					return { ok: true };
				}
				return { ok: false, kind: 'unverified' };
			} catch (err) {
				return { ok: false, kind: 'error', err };
			}
		},
	);

	if (result.ok) {
		controller.refreshVisible();
		const action = await vscode.window.showInformationMessage('DevGuard: connected.', 'Select asset');
		if (action === 'Select asset') {
			await vscode.commands.executeCommand('devguard.selectAsset');
		}
	} else if (result.kind === 'unverified') {
		vscode.window.showErrorMessage(
			'DevGuard: the token could not be verified (signature rejected). Check that you pasted the whole token and that your system clock is accurate.',
		);
	} else {
		reportError('validate the token', result.err, logger);
	}
}

async function disconnect({ connection, selection, controller }: CommandDeps): Promise<void> {
	await connection.disconnect();
	await selection.clear();
	controller.refreshVisible();
	vscode.window.showInformationMessage('DevGuard: disconnected.');
}

async function selectAsset({ connection, selection, controller, logger }: CommandDeps): Promise<void> {
	if (!connection.isConnected()) {
		const action = await vscode.window.showInformationMessage('DevGuard: connect first to select an asset.', 'Connect');
		if (action === 'Connect') {
			await vscode.commands.executeCommand('devguard.connect');
		}
		return;
	}
	let selected: SelectedAsset | undefined;
	try {
		selected = await selection.pick();
	} catch (err) {
		reportError('load organizations and assets', err, logger);
		return;
	}
	if (!selected) {
		return;
	}
	// Eagerly load the asset's risk data: warms the cache and surfaces the count
	// (or the real error) rather than failing silently in a background refresh.
	try {
		const xref = await vscode.window.withProgress(
			{ location: vscode.ProgressLocation.Notification, title: `DevGuard: loading risk data for ${selected.label}…` },
			() => selection.loadXref(),
		);
		const packages = xref?.size ?? 0;
		logger.info(`Loaded asset risk data for ${selected.label}: ${packages} package(s) with open risks.`);
		vscode.window.showInformationMessage(
			packages > 0
				? `DevGuard: using ${selected.label} — ${packages} package(s) with open risks.`
				: `DevGuard: using ${selected.label} (no open dependency risks found — has it been scanned?).`,
		);
	} catch (err) {
		reportError('load asset risk data', err, logger);
	}
	controller.refreshVisible();
}

async function refresh({ cache, selection, controller }: CommandDeps): Promise<void> {
	cache.invalidateAll();
	selection.invalidateXref();
	controller.refreshVisible();
}

async function setupDependencyProxy({ logger }: CommandDeps): Promise<void> {
	const folder = await pickWorkspaceFolder();
	if (!folder) {
		return;
	}
	const secret = (
		await vscode.window.showInputBox({
			title: 'DevGuard Dependency Proxy',
			prompt: 'Optional organization proxy secret. Leave blank to use the public proxy path.',
			ignoreFocusOut: true,
			password: true,
		})
	)?.trim();

	const apiUrl = config.getApiUrl();
	const registry = secret
		? `${apiUrl}/api/v1/dependency-proxy/${encodeURIComponent(secret)}/npm/`
		: `${apiUrl}/api/v1/dependency-proxy/npm/`;

	const npmrc = vscode.Uri.joinPath(folder.uri, '.npmrc');
	let existing = '';
	try {
		existing = Buffer.from(await vscode.workspace.fs.readFile(npmrc)).toString('utf8');
	} catch {
		// no existing .npmrc
	}

	if (existing) {
		const ok = await vscode.window.showWarningMessage(
			`Update ${vscode.workspace.asRelativePath(npmrc)} to route npm through the DevGuard proxy?`,
			{ modal: true, detail: `registry=${registry}` },
			'Update .npmrc',
		);
		if (ok !== 'Update .npmrc') {
			return;
		}
	}

	try {
		await vscode.workspace.fs.writeFile(npmrc, Buffer.from(upsertRegistry(existing, registry), 'utf8'));
		await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(npmrc));
		vscode.window.showInformationMessage('DevGuard: .npmrc updated. Run "npm install" to use the proxy.');
	} catch (err) {
		reportError('write .npmrc', err, logger);
	}
}

async function viewSbom({ client, selection, sbomProvider, logger }: CommandDeps): Promise<void> {
	const selected = selection.getSelected();
	if (!selected) {
		vscode.window.showInformationMessage('DevGuard: select an asset first.');
		return;
	}
	await vscode.window.withProgress(
		{ location: vscode.ProgressLocation.Notification, title: `DevGuard: fetching SBOM for ${selected.label}…` },
		async () => {
			try {
				const raw = await client.getSbom(selected.orgSlug, selected.projectSlug, selected.assetSlug, selected.refSlug);
				let pretty = raw;
				try {
					pretty = JSON.stringify(JSON.parse(raw), null, 2);
				} catch {
					// leave raw if not valid JSON
				}
				await sbomProvider.open(`${selected.assetSlug}-${selected.refSlug}-sbom`, pretty);
			} catch (err) {
				reportError('fetch the SBOM', err, logger);
			}
		},
	);
}

async function generateSbom({ connection, selection, controller, logger }: CommandDeps): Promise<void> {
	const selected = selection.getSelected();
	if (!connection.isConnected() || !selected) {
		vscode.window.showInformationMessage('DevGuard: connect and select an asset before generating an SBOM.');
		return;
	}
	const folder = await pickWorkspaceFolder();
	if (!folder) {
		return;
	}
	const token = await connection.getToken();
	if (!token) {
		vscode.window.showErrorMessage('DevGuard: no token available — reconnect and try again.');
		return;
	}

	const scannerPath = config.getScannerPath();
	const assetName = `${selected.orgSlug}/${selected.projectSlug}/${selected.assetSlug}`;
	// Token is passed via DEVGUARD_TOKEN env (not argv) so it does not appear in the process list.
	const args = ['sca', '--path', folder.uri.fsPath, '--assetName', assetName, '--apiUrl', config.getApiUrl(), '--ref', selected.refSlug];

	logger.show();
	logger.info(`Running ${scannerPath} sca for ${assetName} (ref ${selected.refSlug})…`);

	let output = '';
	const capture = (chunk: Buffer): void => {
		const text = chunk.toString();
		logger.append(text);
		output = (output + text).slice(-8000);
	};

	const exitCode = await vscode.window.withProgress<number | undefined>(
		{ location: vscode.ProgressLocation.Notification, title: `DevGuard: scanning ${selected.label}…`, cancellable: true },
		(_progress, cancelToken) =>
			new Promise<number | undefined>((resolve) => {
				let child: ReturnType<typeof spawn> | undefined;
				try {
					child = spawn(scannerPath, args, { cwd: folder.uri.fsPath, env: { ...process.env, DEVGUARD_TOKEN: token } });
				} catch (err) {
					logger.error('could not start the scanner', err);
					resolve(undefined);
					return;
				}
				cancelToken.onCancellationRequested(() => child?.kill());
				child.stdout?.on('data', capture);
				child.stderr?.on('data', capture);
				child.on('error', (err) => {
					logger.error('scanner process error', err);
					resolve(undefined);
				});
				child.on('close', (code) => resolve(code ?? undefined));
			}),
	);

	if (exitCode === undefined) {
		vscode.window.showErrorMessage(
			`DevGuard: could not run "${scannerPath}". Install the devguard-scanner CLI or set devguard.scannerPath.`,
		);
		return;
	}
	// The SBOM is uploaded before the scanner applies its fail-on-risk gate, so a
	// non-zero exit usually means "findings present", not a failure to upload.
	selection.invalidateXref();
	controller.refreshVisible();
	if (exitCode === 0) {
		vscode.window.showInformationMessage('DevGuard: SCA complete — SBOM uploaded. Insights refreshed.');
		return;
	}
	if (/invalid specification version|not a valid CycloneDX/i.test(output)) {
		vscode.window.showErrorMessage(
			'DevGuard: the generated SBOM used a CycloneDX version the scanner could not read. Rebuild devguard-scanner from source (go install ./cmd/devguard-scanner) or align your trivy version, then retry.',
		);
		return;
	}
	vscode.window.showWarningMessage(`DevGuard: scanner exited with code ${exitCode} (see the DevGuard output). Insights refreshed.`);
}

async function pickWorkspaceFolder(): Promise<vscode.WorkspaceFolder | undefined> {
	const folders = vscode.workspace.workspaceFolders ?? [];
	if (folders.length === 0) {
		vscode.window.showWarningMessage('DevGuard: open a project folder first.');
		return undefined;
	}
	if (folders.length === 1) {
		return folders[0];
	}
	return vscode.window.showWorkspaceFolderPick();
}

/** Replaces an existing `registry=` line or appends one, preserving other lines. */
export function upsertRegistry(content: string, registry: string): string {
	const line = `registry=${registry}`;
	const lines = content.split(/\r?\n/);
	let replaced = false;
	const out = lines.map((l) => {
		if (/^\s*registry\s*=/.test(l)) {
			replaced = true;
			return line;
		}
		return l;
	});
	if (!replaced) {
		while (out.length > 0 && out[out.length - 1].trim() === '') {
			out.pop();
		}
		out.push(line);
	}
	return `${out.join('\n').replace(/\n+$/, '')}\n`;
}

function reportError(action: string, err: unknown, logger: Logger): void {
	logger.error(`while trying to ${action}`, err);
	if (err instanceof DevGuardHttpError) {
		if (err.status === 401) {
			vscode.window.showErrorMessage('DevGuard: token not recognized by the server. Create a new PAT and try again.');
		} else {
			vscode.window.showErrorMessage(`DevGuard: the server returned ${err.status} while trying to ${action} (see DevGuard output).`);
		}
		return;
	}
	if (err instanceof DevGuardNetworkError) {
		vscode.window.showErrorMessage(`DevGuard: ${err.message}.`);
		return;
	}
	vscode.window.showErrorMessage(`DevGuard: failed to ${action} (see DevGuard output).`);
}
