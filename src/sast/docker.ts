import { spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import * as crypto from "node:crypto";
import { ScanKind } from "./classify";
import * as vscode from "vscode";
import path from "path";
import os from "os";

export interface DockerRunnerOptions {
  kind: ScanKind;
  signal: AbortSignal;
}

export interface DockerScanResult {
  sarifJson: string;
  exitCode: number;
  stderr: string;
}

/**
 * Runs the appropriate Docker scanner and resolves with the raw SARIF JSON string.
 * The scanner writes SARIF to a file inside the mounted repo (rather than stdout);
 * that file is read after the process exits and always deleted afterward, regardless
 * of success, failure, or abort. stdout/stderr are still collected for error messages.
 */
export async function runDockerScanner(
  opts: DockerRunnerOptions,
  documenturi: vscode.Uri,
): Promise<DockerScanResult> {
  const { kind, signal } = opts;

  const repoPath =
    vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();

  // Unique per-invocation filename so concurrent scans against the same repo
  // (e.g. two files saved in quick succession) don't read/delete each other's output.
  const outputName = `.devguard-${kind}-${crypto.randomUUID()}.sarif`;
  const outputPathOnHost = path.join(os.tmpdir(), outputName);
  const outputPathInContainer = `/tmp/${outputName}`;
  const relativePath = vscode.workspace.asRelativePath(documenturi ?? "");

  const args = [
    "run",
    "--rm",
    "-v",
    `${repoPath}:/repo`,
    "-v",
    `${os.tmpdir()}:${"/tmp"}`,
    "ghcr.io/l3montree-dev/devguard/scanner:main",
    "devguard-scanner",
    kind,
    `--path=/repo/${relativePath}`,
    `--outputPath=${outputPathInContainer}`,
  ];

  console.log(args)

  const cleanup = async (): Promise<void> => {
    try {
      await fs.unlink(outputPathOnHost);
    } catch {
      return;
    }
  };

  return new Promise<DockerScanResult>((resolve, reject) => {
    const proc = spawn("docker", args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    proc.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    proc.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

    const onAbort = (): void => {
      proc.kill();
      void cleanup();
      reject(new Error("Docker scan aborted"));
    };
    signal.addEventListener("abort", onAbort, { once: true });

    proc.on("close", (code) => {
      signal.removeEventListener("abort", onAbort);

      void (async () => {
        let sarifJson = "";
        try {
          sarifJson = await fs.readFile(outputPathOnHost, "utf8");
        } catch {
          // No SARIF file — likely a real crash before the scanner could write output.
          // Leave sarifJson empty; the caller's parseSarif will throw and surface stderr.
        } finally {
          await cleanup();
        }

        resolve({
          sarifJson,
          exitCode: code ?? -1,
          stderr: Buffer.concat(stderrChunks).toString("utf8").trim(),
        });
      })();
    });

    proc.on("error", (err) => {
      signal.removeEventListener("abort", onAbort);
      void cleanup();
      reject(err);
    });
  });
}
