import * as vscode from 'vscode';

/**
 * Thin wrapper around an OutputChannel. `redact()` is a defense-in-depth helper:
 * the personal access token should never reach the logger, but if a long hex
 * string ever slips through we mask it.
 */
export class Logger {
	private readonly channel: vscode.OutputChannel;

	constructor() {
		this.channel = vscode.window.createOutputChannel('DevGuard');
	}

	info(message: string): void {
		this.write('INFO', message);
	}

	warn(message: string): void {
		this.write('WARN', message);
	}

	error(message: string, err?: unknown): void {
		const detail = err instanceof Error ? `${err.message}` : err !== undefined ? String(err) : '';
		this.write('ERROR', detail ? `${message}: ${detail}` : message);
	}

	/** Appends raw text (e.g. streamed subprocess output) without a level prefix. */
	append(text: string): void {
		this.channel.append(redact(text));
	}

	show(): void {
		this.channel.show(true);
	}

	dispose(): void {
		this.channel.dispose();
	}

	private write(level: string, message: string): void {
		const ts = new Date().toISOString();
		this.channel.appendLine(`[${ts}] [${level}] ${redact(message)}`);
	}
}

/** Masks anything that looks like a 64+ char hex token (an ECDSA private key). */
export function redact(text: string): string {
	return text.replace(/\b[0-9a-fA-F]{64,}\b/g, '<redacted>');
}
