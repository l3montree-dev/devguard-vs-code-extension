import * as vscode from "vscode";
import fs from "fs/promises";
import * as config from "./config";
import { AssetSelection } from "./selection";

const workspaceFolders = vscode.workspace.workspaceFolders;

if (!workspaceFolders) {
  throw new Error("No workspace is open");
}

const rootPath = workspaceFolders[0].uri.fsPath;
export const gitHooksFolder = `${rootPath}/.git/hooks`;
export const gitPreCommitHookFilePath = gitHooksFolder + "/pre-commit";
export const gitPostCommitHookFilePath = gitHooksFolder + "/post-commit";
export const setupCommentHead =
  "# The following lines were added by the DevGuard VS-Code Companion\n";
export const setupCommentTail =
  "# The previous lines were added by the DevGuard VS-Code Companion\n";

export async function removeExistingGitHooks(): Promise<void> {
  try {
    const stat = await fs.stat(gitHooksFolder);
    if (!stat.isDirectory()) {
      vscode.window.showErrorMessage(
        `${gitHooksFolder} exists but is not a folder.`,
      );
      return;
    }
  } catch (err: any) {
    if (err.code === "ENOENT") {
      vscode.window.showErrorMessage(
        `Workspace could not be recognized as a git-repo: ${gitHooksFolder} does not exist.`,
      );
    } else {
      vscode.window.showErrorMessage(
        `An error occured during git check. Could not check if git repository is present in workspace.`,
      );
    }
    return;
  }

  try {
    let content = await fs.readFile(gitPreCommitHookFilePath, "utf8");
    let resultFileContent = content;
    let linesHead = content.split("\n" + setupCommentHead);
    let linesTail = [];
    if (linesHead.length == 2) {
      linesTail = linesHead[1].split(setupCommentTail);
      if (linesTail.length == 2) {
        resultFileContent = linesHead[0] + linesTail[1];
      }
    }

    await fs.writeFile(gitPreCommitHookFilePath, resultFileContent, "utf8");

    content = await fs.readFile(gitPostCommitHookFilePath, "utf8");
    resultFileContent = content;
    linesHead = content.split("\n" + setupCommentHead);
    linesTail = [];
    if (linesHead.length == 2) {
      linesTail = linesHead[1].split(setupCommentTail);
      if (linesTail.length == 2) {
        resultFileContent = linesHead[0] + linesTail[1];
      }
    }
    await fs.writeFile(gitPostCommitHookFilePath, resultFileContent, "utf8");
  } catch (err: any) {
    if (!(err.code === "ENOENT")) {
      vscode.window.showErrorMessage(
        `An error occured during git check. Could not check if git hook is present in workspace.`,
      );
      return;
    }
  }
}

export async function setupGitCommitHooks(
  selection: AssetSelection,
): Promise<void> {
  const apiUrl = config.getApiUrl();  
  const sel = selection.getSelected();
  if (!sel) {
    vscode.window.showInformationMessage("DevGuard: select an asset first.");
    return;
  }
  const assetKey = `${sel.orgSlug}/projects/${sel.projectSlug}/assets/${sel.assetSlug}/${sel.refSlug}`;
  const secretScanningCommand = `docker run --rm -v "$(pwd):/repo" ghcr.io/l3montree-dev/devguard/scanner secret-scanning --apiURL=${apiUrl} --assetName=${assetKey} --path="/repo" --dir \n`;

  const intotoScanningCommand = `docker run --rm -v "$(pwd):/repo" ghcr.io/l3montree-dev/devguard/scanner intoto run --apiURL=${apiUrl} --assetName=${assetKey} \n`;

  try {
    const stat = await fs.stat(gitHooksFolder);
    if (!stat.isDirectory()) {
      vscode.window.showErrorMessage(
        `${gitHooksFolder} exists but is not a folder.`,
      );
      return;
    }
  } catch (err: any) {
    if (err.code === "ENOENT") {
      vscode.window.showErrorMessage(
        `Workspace could not be recognized as a git-repo: ${gitHooksFolder} does not exist.`,
      );
    } else {
      vscode.window.showErrorMessage(
        `An error occured during git check. Could not check if git repository is present in workspace.`,
      );
    }
    return;
  }

  await removeExistingGitHooks();

  await fs.appendFile(
    gitPreCommitHookFilePath,
    "\n" + setupCommentHead + secretScanningCommand + setupCommentTail,
    "utf8",
  );

  try {
    await fs.chmod(gitPreCommitHookFilePath, 0o755);
  } catch {
    vscode.window.showErrorMessage(
      `Could not change file permissions of $(gitPreCommitHookFilePath)`,
    );
    return;
  }

  await fs.appendFile(
    gitPostCommitHookFilePath,
    "\n" + setupCommentHead + intotoScanningCommand + setupCommentTail,
    "utf8",
  );

  try {
    await fs.chmod(gitPostCommitHookFilePath, 0o755);
  } catch {
    vscode.window.showErrorMessage(
      `Could not change file permissions of $(gitPostCommitHookFilePath)`,
    );
    return;
  }
}

async function commitHookExists(hookfile: string): Promise<boolean> {
  try {
    const stat = await fs.stat(gitHooksFolder);
    if (!stat.isDirectory()) {
      vscode.window.showErrorMessage(
        `${gitHooksFolder} exists but is not a folder.`,
      );
      return false;
    }

    const content = await fs.readFile(hookfile, "utf8");
    if (
      content.includes(setupCommentHead) &&
      content.includes(setupCommentTail)
    ) {
      return true;
    } else {
      return false;
    }
  } catch (err: any) {
    if (err.code === "ENOENT") {
      return false;
    }
    throw err;
  }
}

export async function preCommitHooksExists(): Promise<boolean> {
    return commitHookExists(gitPreCommitHookFilePath) 
}

export async function postCommitHooksExists(): Promise<boolean> {
    return commitHookExists(gitPostCommitHookFilePath) 
}
