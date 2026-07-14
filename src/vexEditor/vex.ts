import * as vscode from "vscode";

const includedFilePaths = ["**/vex*.json", "**/*cdx.json", "**/*.cdx"];
const excludedFilePaths = ["**/node_modules/**"];

export enum VexStatus {
  not_affected = "not_affected",
  affected = "affected",
  false_positive = "false_positive",
  under_investigation = "under_investigation",
  fixed = "fixed",
}

export const STATE_TO_DESCRIPTION: Record<VexStatus, string> = {
  affected: "Affected",
  not_affected: "Not Affected",
  false_positive: "False Positive",
  under_investigation: "Under Investigation",
  fixed: "Fixed",
};

export const STATUS_OPTIONS: {
  label: string;
  value: VexStatus;
  description?: string;
}[] = [
  {
    label: STATE_TO_DESCRIPTION.affected,
    value: VexStatus.affected,
    description: "Vulnerable and exploitable",
  },
  {
    label: STATE_TO_DESCRIPTION.not_affected,
    value: VexStatus.not_affected,
    description: "Vulnerable code not reachable",
  },
  {
    label: STATE_TO_DESCRIPTION.false_positive,
    value: VexStatus.false_positive,
  },
  {
    label: STATE_TO_DESCRIPTION.under_investigation,
    value: VexStatus.under_investigation,
  },
  { label: STATE_TO_DESCRIPTION.fixed, value: VexStatus.fixed },
];

export const STATUS_TO_CDX_STATE: Record<VexStatus, string> = {
  affected: "exploitable",
  not_affected: "not_affected",
  false_positive: "false_positive",
  under_investigation: "in_triage",
  fixed: "resolved",
};

export const CDX_STATE_TO_STATUS: Record<string, VexStatus> = {
  exploitable: VexStatus.affected,
  not_affected: VexStatus.not_affected,
  false_positive: VexStatus.false_positive,
  in_triage: VexStatus.under_investigation,
  resolved: VexStatus.fixed,
};

export type VEXVuln = {
  vulnID: string;
  packageName: string;
  status: VexStatus;
  rating: {
    method: string;
    score: Number;
  };
  justificationDetail: string;
};

export async function findVexFile(): Promise<vscode.Uri | undefined> {
  const files = await vscode.workspace.findFiles(
    `{${includedFilePaths.join(",")}}`,
    `{${excludedFilePaths.join(",")}}`,
    1,
  );

  return files.sort((a, b) =>
    a.fsPath.toString().localeCompare(b.fsPath.toString()),
  )[0];
}

export function watchVexFile(
  onChange: (uri: vscode.Uri | undefined) => void,
): vscode.Disposable {
  const watcher = vscode.workspace.createFileSystemWatcher(
    `{${includedFilePaths.join(",")}}`,
  );

  watcher.onDidCreate(onChange);
  watcher.onDidChange(onChange);
  watcher.onDidDelete(onChange);

  return watcher;
}
