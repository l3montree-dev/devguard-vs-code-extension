// TypeScript mirrors of the DevGuard backend DTOs we consume, plus the computed
// view-model the UI renders. Shapes verified against a live backend on
// http://localhost:8080 (see plan, "Verification").

export interface WhoAmI {
	userID: string;
}

/** An entry of `vulns[]` from purl-inspect: a known CVE for the inspected version. */
export interface VulnInPackage {
	cveId: string;
	fixedVersion: string | null;
}

/** OSV advisory returned as `maliciousPackage` when a package is flagged. */
export interface Osv {
	id: string;
	summary?: string;
	details?: string;
	published?: string;
	modified?: string;
	aliases?: string[];
}

export interface ScoreCardCheck {
	name: string;
	score: number;
	reason?: string;
	details?: string[];
	documentation?: { shortDescription?: string; url?: string };
}

/** `scoreCard` is `map[string]any` server-side; we type the fields we read. */
export interface ScoreCard {
	checks?: ScoreCardCheck[];
	overallScore?: number;
	date?: string;
}

export interface ComponentProject {
	projectKey: string;
	starsCount: number;
	forksCount: number;
	openIssuesCount: number;
	homepage: string;
	license: string;
	description: string;
	scoreCard?: ScoreCard | null;
	scoreCardScore?: number | null;
}

export interface ComponentDto {
	purl: string;
	dependsOn?: unknown[];
	componentType?: string;
	version?: string;
	license?: string | null;
	published?: string | null;
	project?: ComponentProject | null;
	projectId?: string | null;
}

export interface PurlInspectResponse {
	purl: string;
	matchContext?: unknown;
	component?: ComponentDto | null;
	affectedComponents?: unknown[];
	vulns?: VulnInPackage[];
	maliciousPackage?: Osv | null;
}

// --- Organization / Project / Asset hierarchy (only the fields we use) ---

export interface Org {
	id: string;
	name: string;
	slug: string;
}

export interface Project {
	id: string;
	name: string;
	slug: string;
}

export interface Asset {
	id: string;
	name: string;
	slug: string;
}

export interface Ref {
	slug: string;
	name: string;
	defaultBranch?: boolean;
	type?: string;
}

export interface Paged<T> {
	data: T[];
	total: number;
	page: number;
	pageSize: number;
}

/** One vulnerability from `dependency-vulns?flat=true`. */
export interface DependencyVulnFlat {
	id: string;
	componentPurl: string;
	/** Chain of purls from the direct dependency down to the vulnerable component. */
	vulnerabilityPath?: string[];
	rawRiskAssessment?: number | null;
}

// --- View model the UI consumes ---

export type DepType =
	| 'dependencies'
	| 'devDependencies'
	| 'optionalDependencies'
	| 'peerDependencies';

export type VersionSource = 'lockfile' | 'node_modules' | 'range';

export type InfoStatus = 'ok' | 'unknown' | 'offline';

export interface AssetRisk {
	/** Vulnerabilities in the asset where this package itself is the vulnerable component. */
	ownCount: number;
	/** Vulnerabilities in the asset that come from this package's transitive dependencies. */
	transitiveCount: number;
	maxRisk: number;
}

export interface PackageInfo {
	name: string;
	depType: DepType;
	resolvedVersion: string;
	versionSource: VersionSource;
	purl: string;
	status: InfoStatus;
	malicious: Osv | null;
	vulnCount: number;
	vulns: VulnInPackage[];
	published?: string | null;
	scoreCardScore?: number | null;
	scoreCard?: ScoreCard | null;
	project?: ComponentProject | null;
	/** Transitive dependency count from the local lockfile; undefined if unknown. */
	transitiveCount?: number;
	/** Open risks for this package in the connected asset; undefined if not connected. */
	assetRisk?: AssetRisk;
}

// --- purl helpers ---

/** Builds an npm purl, e.g. `pkg:npm/@babel/core@7.0.0` or `pkg:npm/lodash@4.17.21`. */
export function toNpmPurl(name: string, version: string): string {
	return `pkg:npm/${name}@${version}`;
}

/** Percent-encodes a purl for use as a single path segment (matches the web client). */
export function encodePurlForPath(purl: string): string {
	return encodeURIComponent(purl);
}
