import * as path from 'node:path';
import * as vscode from 'vscode';
import { DevGuardClient } from '../api/client';
import { AssetRisk, PackageInfo, PurlInspectResponse, toNpmPurl, toGolangPurl } from '../api/types';
import * as config from '../config';
import { DependencyEntry } from '../packageJson/parse';
import { loadNearestLockfile } from '../packageJson/lockfile';
import { resolveVersion } from '../packageJson/resolveVersion';
import { countTransitive } from '../packageJson/transitive';
import { loadNearestGoSum } from '../goMod/lockfile';
import { resolveGoVersion } from '../goMod/resolveVersion';
import { countGoTransitive } from '../goMod/transitive';
import { isGoMod } from '../goMod/parse';
import { InspectSummary, PurlCache } from './cache';
import { mapWithConcurrency } from './pool';
import { purlNameKey } from '../utils';
export { purlNameKey } from '../utils';

/** A per-package map of open risks in the connected asset, keyed by purlNameKey. */
export type AssetXref = Map<string, AssetRisk>;

type EnrichContext =
	| { kind: 'npm'; lock: Awaited<ReturnType<typeof loadNearestLockfile>> }
	| { kind: 'go'; goSum: Awaited<ReturnType<typeof loadNearestGoSum>> };

export class EnrichmentService {
	constructor(private readonly client: DevGuardClient, private readonly cache: PurlCache) {}

	async enrichDocument(
		document: vscode.TextDocument,
		entries: DependencyEntry[],
		signal: AbortSignal,
		assetXref?: AssetXref,
	): Promise<Map<DependencyEntry, PackageInfo>> {
		const pkgDir = path.dirname(document.uri.fsPath);
		const stopDir = vscode.workspace.getWorkspaceFolder(document.uri)?.uri.fsPath;

		const enrichContext: EnrichContext = isGoMod(document)
			? { kind: 'go', goSum: await loadNearestGoSum(pkgDir, stopDir) }
			: { kind: 'npm', lock: await loadNearestLockfile(pkgDir, stopDir) };

		const infos = await mapWithConcurrency(entries, config.getConcurrency(), (entry) =>
			this.enrichEntry(entry, pkgDir, enrichContext, signal, assetXref),
		);

		const result = new Map<DependencyEntry, PackageInfo>();
		entries.forEach((entry, i) => result.set(entry, infos[i]));
		return result;
	}

	private async enrichEntry(
		entry: DependencyEntry,
		pkgDir: string,
		ctx: EnrichContext,
		signal: AbortSignal,
		assetXref?: AssetXref,
	): Promise<PackageInfo> {
		let resolvedVersion: string;
		let versionSource: PackageInfo['versionSource'];
		let purl: string;
		let transitiveCount: number | undefined;

		if (ctx.kind === 'go') {
			const resolved = resolveGoVersion(ctx.goSum, entry.name, entry.rangeSpec);
			if (!resolved) {
				return unknownEntry(entry);
			}
			resolvedVersion = resolved.version;
			versionSource = resolved.source;
			purl = toGolangPurl(entry.name, resolvedVersion);
			transitiveCount = countGoTransitive();
		} else {
			const resolved = await resolveVersion(pkgDir, ctx.lock, entry.name, entry.rangeSpec);
			if (!resolved) {
				return unknownEntry(entry);
			}
			resolvedVersion = resolved.version;
			versionSource = resolved.source;
			purl = toNpmPurl(entry.name, resolvedVersion);
			transitiveCount = countTransitive(ctx.lock, entry.name);
		}

		const assetRisk = assetXref?.get(purlNameKey(purl));
		let summary = this.cache.get(purl);
		if (!summary) {
			try {
				const resp = await this.client.inspectPurl(purl, signal);
				summary = distill(resp);
				this.cache.set(purl, summary, config.getCacheTtlMs());
			} catch {
				return {
					name: entry.name,
					depType: entry.depType,
					resolvedVersion,
					versionSource,
					purl,
					status: 'offline',
					malicious: null,
					vulnCount: 0,
					vulns: [],
					transitiveCount,
					assetRisk,
				};
			}
		}

		return {
			name: entry.name,
			depType: entry.depType,
			resolvedVersion,
			versionSource,
			purl,
			status: 'ok',
			malicious: summary.malicious,
			vulnCount: summary.vulnCount,
			vulns: summary.vulns,
			published: summary.published,
			scoreCardScore: summary.scoreCardScore,
			scoreCard: summary.scoreCard,
			project: summary.project,
			transitiveCount,
			assetRisk,
		};
	}
}

function unknownEntry(entry: DependencyEntry): PackageInfo {
	return {
		name: entry.name,
		depType: entry.depType,
		resolvedVersion: entry.rangeSpec,
		versionSource: 'range',
		purl: '',
		status: 'unknown',
		malicious: null,
		vulnCount: 0,
		vulns: [],
	};
}

function distill(resp: PurlInspectResponse): InspectSummary {
	const vulns = resp.vulns ?? [];
	const project = resp.component?.project ?? null;
	return {
		malicious: resp.maliciousPackage ?? null,
		vulnCount: vulns.length,
		vulns,
		published: resp.component?.published ?? null,
		scoreCardScore: project?.scoreCardScore ?? null,
		scoreCard: project?.scoreCard ?? null,
		project,
	};
}