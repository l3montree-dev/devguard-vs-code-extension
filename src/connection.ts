import * as vscode from 'vscode';

const SECRET_KEY = 'devguard.pat';

/**
 * Owns the personal access token. The token is an ECDSA private key, so it is
 * stored only in SecretStorage and kept in memory for the session — never in
 * settings, workspaceState or logs.
 */
export class ConnectionManager {
	private token?: string;
	private userId?: string;
	private readonly emitter = new vscode.EventEmitter<void>();
	readonly onDidChange = this.emitter.event;

	constructor(private readonly secrets: vscode.SecretStorage) {}

	async init(): Promise<void> {
		this.token = (await this.secrets.get(SECRET_KEY)) ?? undefined;
		await this.syncContext();
	}

	/** Token provider passed to the API client. */
	readonly getToken = async (): Promise<string | undefined> => this.token;

	isConnected(): boolean {
		return this.token !== undefined;
	}

	getUserId(): string | undefined {
		return this.userId;
	}

	/** Runs `fn` with a candidate token active, then restores the previous token. */
	async withCandidate<T>(candidate: string, fn: () => Promise<T>): Promise<T> {
		const prev = this.token;
		this.token = candidate;
		try {
			return await fn();
		} finally {
			this.token = prev;
		}
	}

	/** Persists a validated token and the resolved user id. */
	async setToken(token: string, userId: string): Promise<void> {
		this.token = token;
		this.userId = userId;
		await this.secrets.store(SECRET_KEY, token);
		await this.syncContext();
		this.emitter.fire();
	}

	async disconnect(): Promise<void> {
		this.token = undefined;
		this.userId = undefined;
		await this.secrets.delete(SECRET_KEY);
		await this.syncContext();
		this.emitter.fire();
	}

	dispose(): void {
		this.emitter.dispose();
	}

	private async syncContext(): Promise<void> {
		await vscode.commands.executeCommand('setContext', 'devguard.connected', this.isConnected());
	}
}
