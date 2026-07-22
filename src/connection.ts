import * as vscode from "vscode";
import * as config from "./config";
import { spawn } from "node:child_process";

const KEYSTORE_USER = "token";

function getKeyIdentifier(): string {
  return `devguard/${config.getApiUrl()}/${config.getAssetName()}`;
}

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
    this.token = (await this.secrets.get(getKeyIdentifier())) ?? undefined;
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

  async setToken(token: string | undefined): Promise<void> {
    this.token = token;
  }

  /** Persists a validated token and the resolved user id. Stores the token in the vs-code secret store using the assetName as the identifier for the token.*/
  async storeToken(token: string, userId: string): Promise<void> {
    const scannerPath = config.getScannerPath();
    const args = [
      "auth",
      `--assetName`,
      `${config.getAssetName()}`,
      `--apiUrl`,
      `${config.getApiUrl()}`,
      `--token`,
      `${token}`,
    ];
    const exitCode = await new Promise<number | undefined>((resolve) => {
      let child: ReturnType<typeof spawn> | undefined;
      try {
        child = spawn(scannerPath, args);
      } catch (err) {
        resolve(undefined);
        return;
      }

      child.on("error", (err) => {
        resolve(undefined);
      });
      child.on("close", (code) => resolve(code ?? undefined));
    });
    console.log(exitCode);
    if (exitCode === undefined || exitCode != 0) {
      throw new Error();
    }
    await this.secrets.store(getKeyIdentifier(), token);
    this.token = token;
    this.userId = userId;
    await this.syncContext();
    this.emitter.fire();
  }

  async disconnect(): Promise<void> {
    await this.secrets.delete(getKeyIdentifier());
    this.token = undefined;
    this.userId = undefined;
    await config.setAssetName("");
    await this.syncContext();
    this.emitter.fire();
  }

  dispose(): void {
    this.emitter.dispose();
  }

  private async syncContext(): Promise<void> {
    await vscode.commands.executeCommand(
      "setContext",
      "devguard.connected",
      this.isConnected(),
    );
  }
}
