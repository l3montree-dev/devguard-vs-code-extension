import * as vscode from 'vscode';
import { ComponentProject, Osv, ScoreCard, VulnInPackage } from '../api/types';

/** The distilled, asset-independent intelligence we keep for a purl. */
export interface InspectSummary {
	malicious: Osv | null;
	vulnCount: number;
	vulns: VulnInPackage[];
	published?: string | null;
	scoreCardScore?: number | null;
	scoreCard?: ScoreCard | null;
	project?: ComponentProject | null;
}

interface CachedInspect {
	summary: InspectSummary;
	expires: number;
}

const STORAGE_KEY = 'devguard.purlCache.v1';
const MAX_PERSISTED = 500;
const PERSIST_DEBOUNCE_MS = 1000;

/**
 * In-memory cache of purl inspection results, persisted to workspaceState so
 * insights survive reloads. Keyed by the full purl (name + version); the result
 * is asset-independent, so it is reused across asset selections.
 */
export class PurlCache {
	private readonly mem = new Map<string, CachedInspect>();
	private persistTimer?: ReturnType<typeof setTimeout>;

	constructor(private readonly state: vscode.Memento) {
		const stored = state.get<Record<string, CachedInspect>>(STORAGE_KEY) ?? {};
		const now = Date.now();
		for (const [purl, entry] of Object.entries(stored)) {
			if (entry?.expires > now) {
				this.mem.set(purl, entry);
			}
		}
	}

	get(purl: string): InspectSummary | undefined {
		const entry = this.mem.get(purl);
		if (!entry) {
			return undefined;
		}
		if (entry.expires <= Date.now()) {
			this.mem.delete(purl);
			return undefined;
		}
		return entry.summary;
	}

	set(purl: string, summary: InspectSummary, ttlMs: number): void {
		this.mem.set(purl, { summary, expires: Date.now() + ttlMs });
		this.schedulePersist();
	}

	invalidateAll(): void {
		this.mem.clear();
		this.schedulePersist();
	}

	dispose(): void {
		if (this.persistTimer) {
			clearTimeout(this.persistTimer);
			this.persistTimer = undefined;
		}
		void this.persist();
	}

	private schedulePersist(): void {
		if (this.persistTimer) {
			clearTimeout(this.persistTimer);
		}
		this.persistTimer = setTimeout(() => void this.persist(), PERSIST_DEBOUNCE_MS);
	}

	private async persist(): Promise<void> {
		const entries = [...this.mem.entries()]
			.sort((a, b) => b[1].expires - a[1].expires)
			.slice(0, MAX_PERSISTED);
		const obj: Record<string, CachedInspect> = {};
		for (const [purl, entry] of entries) {
			obj[purl] = entry;
		}
		await this.state.update(STORAGE_KEY, obj);
	}
}
