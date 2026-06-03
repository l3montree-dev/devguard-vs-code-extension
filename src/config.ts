import * as vscode from 'vscode';

export type Verbosity = 'compact' | 'full';

const SECTION = 'devguard';

function cfg(): vscode.WorkspaceConfiguration {
	return vscode.workspace.getConfiguration(SECTION);
}

/**
 * Base API URL with any trailing slashes removed, e.g. `http://localhost:8080`.
 * Falls back to the documented default if the setting is blank.
 */
export function getApiUrl(): string {
	const raw = (cfg().get<string>('apiUrl') ?? '').trim();
	const url = raw.length > 0 ? raw : 'http://localhost:8080';
	return url.replace(/\/+$/, '');
}

/**
 * Origin (scheme + host + port) of the configured API URL, used to assert that
 * signed requests are only ever sent to the configured host. Returns
 * `undefined` if the URL is malformed.
 */
export function getApiOrigin(): string | undefined {
	try {
		return new URL(getApiUrl()).origin;
	} catch {
		return undefined;
	}
}

/** True when the API URL is a well-formed http(s) URL. */
export function isApiUrlValid(): boolean {
	try {
		const u = new URL(getApiUrl());
		return u.protocol === 'http:' || u.protocol === 'https:';
	} catch {
		return false;
	}
}

/** True when the API URL is plain http and not a loopback host. */
export function isInsecureRemote(): boolean {
	try {
		const u = new URL(getApiUrl());
		const loopback = u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '::1';
		return u.protocol === 'http:' && !loopback;
	} catch {
		return false;
	}
}

export function isInlineEnabled(): boolean {
	return cfg().get<boolean>('inlineDecorations.enabled') ?? true;
}

export function getVerbosity(): Verbosity {
	return (cfg().get<Verbosity>('inlineDecorations.verbosity') ?? 'full');
}

export function getConcurrency(): number {
	const n = cfg().get<number>('request.concurrency') ?? 6;
	return Math.min(16, Math.max(1, Math.floor(n)));
}

export function getTimeoutMs(): number {
	const n = cfg().get<number>('request.timeoutMs') ?? 8000;
	return Math.max(1000, Math.floor(n));
}

export function getCacheTtlMs(): number {
	const minutes = cfg().get<number>('cache.ttlMinutes') ?? 720;
	return Math.max(1, Math.floor(minutes)) * 60_000;
}

export function getScannerPath(): string {
	const p = (cfg().get<string>('scannerPath') ?? '').trim();
	return p.length > 0 ? p : 'devguard-scanner';
}

/** Fires when any `devguard.*` setting changes. */
export function onDidChangeConfig(listener: () => void): vscode.Disposable {
	return vscode.workspace.onDidChangeConfiguration((e) => {
		if (e.affectsConfiguration(SECTION)) {
			listener();
		}
	});
}
