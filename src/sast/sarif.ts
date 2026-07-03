import * as vscode from "vscode";

// Minimal SARIF 2.1 types — only what we need to map to Diagnostics
interface SarifLog {
  runs?: SarifRun[];
}

interface SarifRun {
  results?: SarifResult[];
  tool?: { driver?: { rules?: SarifRule[] } };
}

interface SarifRule {
  id: string;
  name?: string;
  shortDescription?: { text?: string };
  defaultConfiguration?: { level?: SarifLevel };
}

interface SarifResult {
  ruleId?: string;
  level?: SarifLevel;
  message?: { text?: string };
  locations?: SarifLocation[];
}

interface SarifLocation {
  physicalLocation?: {
    artifactLocation?: { uri?: string; uriBaseId?: string };
    region?: {
      startLine?: number;
      startColumn?: number;
      endLine?: number;
      endColumn?: number;
    };
  };
}

type SarifLevel = "error" | "warning" | "note" | "none";

function sarifLevelToSeverity(
  level: SarifLevel | undefined,
): vscode.DiagnosticSeverity {
  switch (level) {
    case "error":
      return vscode.DiagnosticSeverity.Error;
    case "warning":
      return vscode.DiagnosticSeverity.Warning;
    case "note":
      return vscode.DiagnosticSeverity.Information;
    default:
      return vscode.DiagnosticSeverity.Warning;
  }
}

/**
 * Parses a SARIF JSON string and maps results to VS Code Diagnostic objects,
 * grouped by the absolute file URI they apply to.
 *
 * @param sarifJson  Raw SARIF output from the Docker scanner
 * @param repoRoot   Absolute path of the repo mounted as /repo in Docker,
 *                   used to resolve artifact URIs back to local paths
 */
export function parseSarif(
  sarifJson: string,
  repoRoot: string,
): Map<vscode.Uri, vscode.Diagnostic[]> {
  const diagnosticsByUri = new Map<vscode.Uri, vscode.Diagnostic[]>();
  const result = new Map<string, vscode.Diagnostic[]>();

  let log: SarifLog;
  try {
    log = JSON.parse(sarifJson) as SarifLog;
  } catch {
    return diagnosticsByUri;
  }

  for (const run of log.runs ?? []) {
    // Build a rule index so we can fall back to rule-level severity
    const ruleIndex = new Map<string, SarifRule>();
    for (const rule of run.tool?.driver?.rules ?? []) {
      ruleIndex.set(rule.id, rule);
    }

    for (const sarifResult of run.results ?? []) {
      const message = sarifResult.message?.text ?? "DevGuard finding";
      const rule = sarifResult.ruleId
        ? ruleIndex.get(sarifResult.ruleId)
        : undefined;
      const level = sarifResult.level ?? rule?.defaultConfiguration?.level;
      const severity = sarifLevelToSeverity(level);

      for (const location of sarifResult.locations ?? []) {
        const phys = location.physicalLocation;
        if (!phys) {
          continue;
        }

        const uri = resolveArtifactUri(phys.artifactLocation, repoRoot);
        if (!uri) {
          continue;
        }

        const region = phys.region;
        const startLine = Math.max((region?.startLine ?? 1) - 1, 0);
        const startColumn = Math.max((region?.startColumn ?? 1) - 1, 0);
        const endLine = Math.max(
          (region?.endLine ?? startLine + 1) - 1,
          startLine,
        );
        const endColumn = Math.max(
          (region?.endColumn ?? startColumn + 1) - 1,
          0,
        );

        const range = new vscode.Range(
          startLine,
          startColumn,
          endLine,
          endColumn,
        );
        const diagnostic = new vscode.Diagnostic(range, message, severity);
        diagnostic.source = "DevGuard";
        if (sarifResult.ruleId) {
          diagnostic.code = sarifResult.ruleId;
        }

        const key = uri.toString();

        const existing = result.get(key) ?? [];
        existing.push(diagnostic);
        result.set(key, existing);
      }
    }
  }

  for (const [key, diagnostics] of result) {
    diagnosticsByUri.set(vscode.Uri.parse(key), diagnostics);
  }

  return diagnosticsByUri;
}

function resolveArtifactUri(
  artifactLocation:
    | NonNullable<SarifLocation["physicalLocation"]>["artifactLocation"]
    | undefined,
  repoRoot: string,
): vscode.Uri | undefined {
  if (!artifactLocation?.uri) {
    return undefined;
  }
  let uriStr = artifactLocation.uri;
  const adjustedRepoRoot = repoRoot.replace(/\\/g, "/") + "/";
  // Docker mounts the repo as /repo — map that back to the local repoRoot
  const replacements = [
    ["/repo/", adjustedRepoRoot],
    ["file:///repo/", `file:///${adjustedRepoRoot}`],
    ["repo/", adjustedRepoRoot],
  ];

  for (const [prefix, replacement] of replacements) {
    if (uriStr.startsWith(prefix)) {
      uriStr = replacement + uriStr.slice(prefix.length);
      break;
    }
  }

  try {
    return uriStr.startsWith("file://")
      ? vscode.Uri.parse(uriStr)
      : vscode.Uri.file(uriStr);
  } catch {
    return undefined;
  }
}
