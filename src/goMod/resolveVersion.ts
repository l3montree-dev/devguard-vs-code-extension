import { VersionSource } from "../api/types";
import { GoSum } from "./lockfile";

export interface ResolvedGoVersion {
  version: string;
  source: VersionSource;
}

/**
 * Resolves the exact version for a Go module.
 *
 * Unlike npm, go.mod already pins exact versions — there are no semver ranges
 * and there is no node_modules equivalent to fall back to. go.sum gives us an
 * independent confirmation that the version was actually downloaded, so we
 * prefer it as the source of truth when available.
 */
export function resolveGoVersion(
  goSum: GoSum | undefined,
  moduleName: string,
  rangeSpec: string,
): ResolvedGoVersion | undefined {
  if (!rangeSpec) {
    return undefined;
  }

  const sumEntry = goSum?.modules.get(moduleName);
  if (sumEntry) {
    return { version: sumEntry.version, source: "lockfile" };
  }

  // go.mod versions are always exact (vX.Y.Z or pseudo-version), never ranges,
  // so falling back to rangeSpec directly is always safe — unlike npm.
  return { version: rangeSpec, source: "range" };
}
