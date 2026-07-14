import * as vscode from "vscode";
import {
  VEXVuln,
  VexStatus,
  STATUS_TO_CDX_STATE,
  STATE_TO_DESCRIPTION,
} from "./vex";
import { parseVexDocument } from "./parse";

function matchesComponent(
  ref: string | undefined,
  packageName: string,
): boolean {
  return ref === packageName;
}

function partitionByComponent(
  affects: any[],
  packageName: string,
): [any, ...any[]] {
  const matched = affects.find((a) => matchesComponent(a.ref, packageName));
  const rest = affects.filter((a) => !matchesComponent(a.ref, packageName));
  return [matched, ...rest];
}

export class VexTreeProvider implements vscode.TreeDataProvider<
  string | VEXVuln
> {
  private _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private vexDocument: any;
  private vulns: Map<string, VEXVuln[]> = new Map();

  constructor(private vexUri: vscode.Uri | undefined) {}

  async setVexUri(uri: vscode.Uri | undefined) {
    this.vexUri = uri;
    if (uri) await this.load(uri);
    else this.vulns = new Map();
    this.refresh();
  }

  private async load(uri: vscode.Uri) {
    const bytes = await vscode.workspace.fs.readFile(uri);
    const json = JSON.parse(Buffer.from(bytes).toString("utf8"));
    this.vexDocument = json;
    this.vulns = parseVexDocument(json);
  }

  public async persist(vuln: VEXVuln) {
    if (!this.vexUri || !this.vexDocument) {
      throw new Error("No VEX document loaded — cannot persist status.");
    }

    const vulnerabilities: any[] = this.vexDocument.vulnerabilities ?? [];
    const now = new Date().toISOString();
    const cdxState = STATUS_TO_CDX_STATE[vuln.status];
    const detail = vuln.justificationDetail ?? "";

    let entry = vulnerabilities.find(
      (v) =>
        v.id === vuln.vulnID &&
        Array.isArray(v.affects) &&
        v.affects.length === 1 &&
        matchesComponent(v.affects[0]?.ref, vuln.packageName),
    );

    if (!entry) {
      // Find the shared entry currently grouping this component with others.
      const sharedEntry = vulnerabilities.find(
        (v) =>
          v.id === vuln.vulnID &&
          Array.isArray(v.affects) &&
          v.affects.some((a: any) => matchesComponent(a.ref, vuln.packageName)),
      );

      if (!sharedEntry) {
        throw new Error(
          `Vulnerability ${vuln.vulnID} for ${vuln.packageName} was not found in vex.json.`,
        );
      }

      const [matched, ...rest] = partitionByComponent(
        sharedEntry.affects,
        vuln.packageName,
      );

      sharedEntry.affects = rest;

      let matchingStateEntry = vulnerabilities.find(
        (v) =>
          v.id === vuln.vulnID &&
          v !== sharedEntry &&
          Array.isArray(v.affects) &&
          v.analysis?.state === cdxState &&
          (v.analysis?.detail ?? "") === detail,
      );

      if (matchingStateEntry) {
        entry = matchingStateEntry;
        entry.affects.push(matched);
      } else {
        entry = JSON.parse(JSON.stringify(sharedEntry));
        entry.affects = [matched];
        delete entry.analysis;

        vulnerabilities.push(entry);
      }
    }

    entry.analysis = {
      ...entry.analysis,
      lastUpdated: now,
      state: cdxState,
      detail,
    };
    // Since we do not provide an option to state the action taken so far, we just omit / clear the field
    // Assumption is that updating a statement always means that the old action no longer applies
    delete entry.analysis.response;

    this.vexDocument.vulnerabilities = vulnerabilities;
    this.vexDocument.metadata = {
      ...this.vexDocument.metadata,
      timestamp: now,
    };

    await this.writeVexDocument();
  }

  private async writeVexDocument() {
    if (!this.vexUri || !this.vexDocument) return;

    const content = Buffer.from(
      JSON.stringify(this.vexDocument, null, 2),
      "utf8",
    );

    try {
      await vscode.workspace.fs.writeFile(this.vexUri, content);
    } catch (err) {
      vscode.window.showErrorMessage(
        `Failed to save vex.json: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw err;
    }
  }

  refresh() {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(vuln: string | VEXVuln): vscode.TreeItem {
    if (typeof vuln === "string") {
      const item = new vscode.TreeItem(
        `${vuln}`,
        vscode.TreeItemCollapsibleState.Collapsed,
      );
      return item;
    } else {
      const item = new vscode.TreeItem(`${vuln.vulnID}`);
      item.description = `(${STATE_TO_DESCRIPTION[vuln.status]}) Score: ${vuln.rating.method} ${vuln.rating.score}`;
      item.iconPath = this.iconForStatus(vuln.status);
      item.contextValue = "vexVuln";
      item.command = {
        command: "devguard.setVexStatus",
        title: "Set VEX Status",
        arguments: [vuln],
      };
      return item;
    }
  }

  getChildren(element: string | VEXVuln): any[] {
    if (!element) {
      return [...this.vulns.keys()];
    } else {
      return (
        this.vulns
          .get(element as string)
          ?.sort(
            (a, b) => (b.rating.score as number) - (a.rating.score as number),
          ) ?? []
      );
    }
  }

  private iconForStatus(status: VexStatus): vscode.ThemeIcon {
    switch (status) {
      case "affected":
        return new vscode.ThemeIcon("bug", new vscode.ThemeColor("charts.red"));
      case "not_affected":
        return new vscode.ThemeIcon(
          "git-pull-request-closed",
          new vscode.ThemeColor("charts.green"),
        );
      case "false_positive":
        return new vscode.ThemeIcon(
          "git-pull-request-closed",
          new vscode.ThemeColor("charts.green"),
        );
      case "fixed":
        return new vscode.ThemeIcon(
          "pass",
          new vscode.ThemeColor("charts.green"),
        );
      case "under_investigation":
        return new vscode.ThemeIcon(
          "search-editor-label-icon",
          new vscode.ThemeColor("charts.yellow"),
        );
      default:
        return new vscode.ThemeIcon("question");
    }
  }
}
