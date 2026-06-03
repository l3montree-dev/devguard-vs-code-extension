import * as vscode from 'vscode';
import { DevGuardClient } from './api/client';
import { AssetRisk, Ref } from './api/types';
import { AssetXref, purlNameKey } from './enrich/enrich';

const STATE_KEY = 'devguard.selectedAsset';
const XREF_TTL_MS = 5 * 60_000;
const PAGE_SIZE = 100;

export interface SelectedAsset {
	orgSlug: string;
	projectSlug: string;
	assetSlug: string;
	refSlug: string;
	label: string;
}

interface XrefCache {
	key: string;
	map: AssetXref;
	expires: number;
}

interface Named {
	name: string;
	slug: string;
}

/** Persists the chosen org/project/asset/ref and builds the per-package risk map. */
export class AssetSelection {
	private selected?: SelectedAsset;
	private xref?: XrefCache;
	private readonly emitter = new vscode.EventEmitter<void>();
	readonly onDidChange = this.emitter.event;

	constructor(private readonly state: vscode.Memento, private readonly client: DevGuardClient) {}

	async init(): Promise<void> {
		this.selected = this.state.get<SelectedAsset>(STATE_KEY);
		await this.syncContext();
	}

	getSelected(): SelectedAsset | undefined {
		return this.selected;
	}

	async clear(): Promise<void> {
		this.selected = undefined;
		this.xref = undefined;
		await this.state.update(STATE_KEY, undefined);
		await this.syncContext();
		this.emitter.fire();
	}

	/** Runs the organization -> project -> asset -> ref QuickPick chain. */
	async pick(): Promise<SelectedAsset | undefined> {
		const org = await this.pickNamed('Select organization', () => this.client.listOrgs());
		if (!org) {
			return undefined;
		}
		const project = await this.pickNamed('Select project', () => this.client.listProjects(org.slug));
		if (!project) {
			return undefined;
		}
		const asset = await this.pickNamed('Select asset (repository)', () =>
			this.client.listAssets(org.slug, project.slug),
		);
		if (!asset) {
			return undefined;
		}
		const ref = await this.pickRef(await this.client.listRefs(org.slug, project.slug, asset.slug));
		if (!ref) {
			return undefined;
		}

		const selected: SelectedAsset = {
			orgSlug: org.slug,
			projectSlug: project.slug,
			assetSlug: asset.slug,
			refSlug: ref.slug,
			label: `${asset.name}@${ref.slug}`,
		};
		this.selected = selected;
		this.xref = undefined;
		await this.state.update(STATE_KEY, selected);
		await this.syncContext();
		this.emitter.fire();
		return selected;
	}

	/** Loads (and caches with a short TTL) the open-risk map for the selected asset. */
	async loadXref(): Promise<AssetXref | undefined> {
		const sel = this.selected;
		if (!sel) {
			return undefined;
		}
		const key = `${sel.orgSlug}/${sel.projectSlug}/${sel.assetSlug}/${sel.refSlug}`;
		if (this.xref && this.xref.key === key && this.xref.expires > Date.now()) {
			return this.xref.map;
		}
		const map = await this.sweep(sel);
		this.xref = { key, map, expires: Date.now() + XREF_TTL_MS };
		return map;
	}

	invalidateXref(): void {
		this.xref = undefined;
	}

	dispose(): void {
		this.emitter.dispose();
	}

	/**
	 * Builds the per-package risk map. Each vulnerability is attributed to every
	 * package along its vulnerabilityPath. For the package that is the vulnerable
	 * component it counts as "own"; for the ancestors along the path it counts as
	 * "transitive" — so a direct dependency surfaces the risks its subtree pulls
	 * in. Vulns are de-duplicated per package by id.
	 */
	private async sweep(sel: SelectedAsset): Promise<AssetXref> {
		const ownIds = new Map<string, Set<string>>();
		const transitiveIds = new Map<string, Set<string>>();
		const maxRiskByPackage = new Map<string, number>();

		const add = (target: Map<string, Set<string>>, key: string, id: string): void => {
			let ids = target.get(key);
			if (!ids) {
				ids = new Set();
				target.set(key, ids);
			}
			ids.add(id);
		};

		let page = 1;
		for (;;) {
			const paged = await this.client.listDependencyVulnsFlat(
				sel.orgSlug,
				sel.projectSlug,
				sel.assetSlug,
				sel.refSlug,
				page,
				PAGE_SIZE,
			);
			for (const vuln of paged.data ?? []) {
				const risk = typeof vuln.rawRiskAssessment === 'number' ? vuln.rawRiskAssessment : 0;
				const componentKey = vuln.componentPurl ? purlNameKey(vuln.componentPurl) : '';
				const keys = new Set<string>((vuln.vulnerabilityPath ?? []).map(purlNameKey));
				if (componentKey) {
					keys.add(componentKey);
				}
				for (const key of keys) {
					add(key === componentKey ? ownIds : transitiveIds, key, vuln.id);
					maxRiskByPackage.set(key, Math.max(maxRiskByPackage.get(key) ?? 0, risk));
				}
			}
			const fetched = paged.data?.length ?? 0;
			if (fetched === 0 || page * PAGE_SIZE >= (paged.total ?? 0)) {
				break;
			}
			page++;
		}

		const map: AssetXref = new Map();
		for (const key of new Set([...ownIds.keys(), ...transitiveIds.keys()])) {
			map.set(key, {
				ownCount: ownIds.get(key)?.size ?? 0,
				transitiveCount: transitiveIds.get(key)?.size ?? 0,
				maxRisk: maxRiskByPackage.get(key) ?? 0,
			});
		}
		return map;
	}

	private async pickNamed<T extends Named>(placeholder: string, fetch: () => Promise<T[]>): Promise<T | undefined> {
		const items = await fetch();
		if (items.length === 0) {
			vscode.window.showWarningMessage(`DevGuard: nothing to choose for "${placeholder}".`);
			return undefined;
		}
		const picked = await vscode.window.showQuickPick(
			items.map((value) => ({ label: value.name || value.slug, description: value.slug, value })),
			{ placeHolder: placeholder, matchOnDescription: true },
		);
		return picked?.value;
	}

	private async pickRef(refs: Ref[]): Promise<Ref | undefined> {
		// An asset that hasn't been scanned yet has no refs; let the user name one
		// (a scan will create it). Existing refs are offered plus a custom option.
		if (refs.length > 0) {
			const sorted = [...refs].sort((a, b) => Number(b.defaultBranch ?? false) - Number(a.defaultBranch ?? false));
			const items: (vscode.QuickPickItem & { ref?: Ref })[] = sorted.map((ref) => ({
				label: ref.name || ref.slug,
				description: ref.defaultBranch ? 'default branch' : ref.type,
				ref,
			}));
			items.push({ label: '$(edit) Enter a ref name…', description: 'not yet scanned' });
			const picked = await vscode.window.showQuickPick(items, { placeHolder: 'Select branch / tag' });
			if (!picked) {
				return undefined;
			}
			if (picked.ref) {
				return picked.ref;
			}
		}
		const name = (
			await vscode.window.showInputBox({
				title: 'Branch / tag',
				prompt: 'This asset has no refs yet. Enter the git ref to use — a scan will create it.',
				value: 'main',
				ignoreFocusOut: true,
			})
		)?.trim();
		return name ? { slug: name, name, defaultBranch: true } : undefined;
	}

	private async syncContext(): Promise<void> {
		await vscode.commands.executeCommand('setContext', 'devguard.assetSelected', this.selected !== undefined);
	}
}
