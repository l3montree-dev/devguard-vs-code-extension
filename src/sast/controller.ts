import * as path from "node:path";
import * as vscode from "vscode";
import { Logger } from "../logger";
import { classifyDocument } from "./classify";
import { runDockerScanner, DockerScanResult } from "./docker";
import { parseSarif } from "./sarif";
import * as config from "../config";

/**
 * Orchestrates on-open / on-save SAST and IaC scanning via Docker.
 * Triggers only on open and save — never on keystroke — so cost is minimal.
 *
 * One AbortController per file: if the same file is saved again while a scan
 * is in flight, the old scan is cancelled before the new one starts.
 */
export class SastController implements vscode.Disposable {
  readonly diagnostics: vscode.DiagnosticCollection;
  private readonly inflight = new Map<string, AbortController>();

  constructor(private readonly logger: Logger) {
    this.diagnostics =
      vscode.languages.createDiagnosticCollection("DevGuard SAST");
  }

  async scan(document: vscode.TextDocument): Promise<void> {
    if (!config.isSastEnabled()) {
      this.clearForDocument(document);
      return;
    }

    const kind = classifyDocument(document.uri.fsPath);
    // Iac scan is kinda implemented, but since the current checkov configuration in devguard does not support scanning individual files, we don't trigger it for now.
    if (!kind || document.uri.scheme !== "file" || kind === "iac") {
      return;
    }

    const key = document.uri.toString();
    this.inflight.get(key)?.abort();

    const controller = new AbortController();
    this.inflight.set(key, controller);

    const repoRoot = this.resolveRepoRoot(document);

    this.logger.info(`Running ${kind} scan for ${document.uri.fsPath}...`);

    try {
      const result = await runDockerScanner(
        { kind, signal: controller.signal },
        document.uri,
      );

      if (this.inflight.get(key) !== controller) {
        return;
      }

      if (result.exitCode === -1 && !result.sarifJson) {
        return;
      }

      let byUri: Map<vscode.Uri, vscode.Diagnostic[]>;
      try {
        byUri = parseSarif(result.sarifJson, repoRoot);
      } catch (parseErr) {
        // exit code wasn't 0 and stdout isn't valid SARIF -> genuine crash, not "vulns found"
        this.logger.error(`DevGuard ${kind} scan failed`, parseErr);
        vscode.window.showErrorMessage(
          `DevGuard: ${kind.toUpperCase()} scan failed.\n\n${result.stderr || (parseErr as Error).message}`,
        );
        return;
      }

      if (!byUri.has(document.uri)) {
        this.diagnostics.delete(document.uri);
      }

      for (const [uri, diags] of byUri) {
        this.diagnostics.set(uri, diags);
      }

      this.logger.info(
        `DevGuard ${kind}: ${countTotal(byUri)} finding(s) in ${path.basename(
          document.uri.fsPath,
        )}`,
      );

      if (result.exitCode !== 0) {
        this.logger.info(`DevGuard ${kind} scanner exited ${result.exitCode}.`);
      }
    } catch (err) {
      if ((err as Error).message === "Docker scan aborted") {
        return;
      }

      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`DevGuard ${kind} scan failed`, err);
      vscode.window.showErrorMessage(
        `DevGuard: ${kind.toUpperCase()} scan failed.\n\n${message}`,
      );
    } finally {
      if (this.inflight.get(key) === controller) {
        this.inflight.delete(key);
      }
    }
  }

  /** Clear diagnostics when a file is closed. */
  clearForDocument(document: vscode.TextDocument): void {
    this.diagnostics.delete(document.uri);
    this.inflight.get(document.uri.toString())?.abort();
    this.inflight.delete(document.uri.toString());
  }

  dispose(): void {
    for (const ctrl of this.inflight.values()) {
      ctrl.abort();
    }
    this.inflight.clear();
    this.diagnostics.dispose();
  }

  private resolveRepoRoot(document: vscode.TextDocument): string {
    return (
      vscode.workspace.getWorkspaceFolder(document.uri)?.uri.fsPath ??
      path.dirname(document.uri.fsPath)
    );
  }

  clearAll(): void {
    for (const ctrl of this.inflight.values()) {
      ctrl.abort();
    }
    this.inflight.clear();
    this.diagnostics.clear();
  }
}

function countTotal(byUri: Map<vscode.Uri, vscode.Diagnostic[]>): number {
  let n = 0;
  for (const diags of byUri.values()) {
    n += diags.length;
  }
  return n;
}
