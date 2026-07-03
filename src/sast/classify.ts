/**
 * Classifies a document URI into a scanner type.
 *
 * 'iac'  → checkov (Dockerfiles, Terraform, CloudFormation, Kubernetes, Helm, etc.)
 * 'sast' → semgrep (all other source files)
 * null   → skip (binary files, go.mod, package.json, lock files — nothing to scan)
 */
export type ScanKind = 'iac' | 'sast';

const IAC_PATTERNS = [
  /Dockerfile(\..*)?$/i,
  /\.tf$/i,
  /\.tfvars$/i,
  /\.hcl$/i,
  /cloudformation\.(ya?ml|json)$/i,
  /\.ya?ml$/i,
  /\.json$/i,
  /helmfile\.ya?ml$/i,
];

const SKIP_PATTERNS = [
  /package\.json$/,
  /package-lock\.json$/,
  /go\.(mod|sum)$/,
  /yarn\.lock$/,
  /pnpm-lock\.ya?ml$/,
  /\.lock$/,
  /node_modules/,
];

export function classifyDocument(fsPath: string): ScanKind | null {
  if (SKIP_PATTERNS.some((p) => p.test(fsPath))) {
    return null;
  }
  if (IAC_PATTERNS.some((p) => p.test(fsPath))) {
    return 'iac';
  }
  // Skip files with no extension — unlikely to be scannable source
  if (!/\.\w+$/.test(fsPath)) {
    return null;
  }
  return 'sast';
}