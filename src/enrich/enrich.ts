import * as path from 'node:path';
import * as vscode from 'vscode';
import { DevGuardClient } from '../api/client';
import { AssetRisk, PackageInfo, PurlInspectResponse, toNpmPurl } from '../api/types';
import * as config from '../config';
import { DependencyEntry } from '../packageJson/parse';
import { loadNearestLockfile } from '../packageJson/lockfile';
import { resolveVersion } from '../packageJson/resolveVersion';
import { countTransitive } from '../packageJson/transitive';
import { InspectSummary, PurlCache } from './cache';
import { mapWithConcurrency } from './pool';
import { purlNameKey } from '../utils';
export { purlNameKey } from '../utils';

/** A per-package map of open risks in the connected asset, keyed by purlNameKey. */
export type AssetXref = Map<string, AssetRisk>;

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
		const lock = await loadNearestLockfile(pkgDir, stopDir);

		const infos = await mapWithConcurrency(entries, config.getConcurrency(), (entry) =>
			this.enrichEntry(entry, pkgDir, lock, signal, assetXref),
		);

		const result = new Map<DependencyEntry, PackageInfo>();
		entries.forEach((entry, i) => result.set(entry, infos[i]));
		return result;
	}

	private async enrichEntry(
		entry: DependencyEntry,
		pkgDir: string,
		lock: Awaited<ReturnType<typeof loadNearestLockfile>>,
		signal: AbortSignal,
		assetXref?: AssetXref,
	): Promise<PackageInfo> {
		const resolved = await resolveVersion(pkgDir, lock, entry.name, entry.rangeSpec);
		if (!resolved) {
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

		const purl = toNpmPurl(entry.name, resolved.version);
		const transitiveCount = countTransitive(lock, entry.name);
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
					resolvedVersion: resolved.version,
					versionSource: resolved.source,
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
			resolvedVersion: resolved.version,
			versionSource: resolved.source,
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
