import * as vscode from 'vscode';
import * as config from './config';
import { ConnectionManager } from './connection';
import { AssetXref } from './enrich/enrich';
import { EnrichmentService } from './enrich/enrich';
import { DocInsights, InsightStore } from './insightStore';
import { Logger } from './logger';
import { isPackageJson, parseDependencies, parseSections } from './packageJson/parse';
import { AssetSelection } from './selection';
import { DecorationManager } from './ui/decorations';

const DEBOUNCE_MS = 400;

/**
 * Orchestrates refreshes: parse package.json, enrich its dependencies and render
 * decorations. Debounced per document, with a generation counter + AbortController
 * so superseded refreshes are cancelled and their stale results dropped.
 */
export class InsightController  {
	private readonly generations = new Map<string, number>();
	private readonly debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
	private readonly inflight = new Map<string, AbortController>();

	constructor(
		private readonly enrich: EnrichmentService,
		private readonly decorations: DecorationManager,
		private readonly store: InsightStore,
		private readonly connection: ConnectionManager,
		private readonly selection: AssetSelection,
		private readonly logger: Logger,
	) {}

	/** Debounced refresh, used while the user types. */
	scheduleRefresh(document: vscode.TextDocument): void {
		if (!isPackageJson(document)) {
			return;
		}
		const key = document.uri.toString();
		const existing = this.debounceTimers.get(key);
		if (existing) {
			clearTimeout(existing);
		}
		this.debounceTimers.set(
			key,
			setTimeout(() => {
				this.debounceTimers.delete(key);
				void this.refreshDocument(document);
			}, DEBOUNCE_MS),
		);
	}

	/** Refreshes every visible package.json (e.g. on activate or after connecting). */
	refreshVisible(): void {
		const seen = new Set<string>();
		for (const editor of vscode.window.visibleTextEditors) {
			const key = editor.document.uri.toString();
			if (isPackageJson(editor.document) && !seen.has(key)) {
				seen.add(key);
				void this.refreshDocument(editor.document);
			}
		}
	}

	async refreshDocument(document: vscode.TextDocument): Promise<void> {
		if (!isPackageJson(document)) {
			return;
		}
		const key = document.uri.toString();

		if (!config.isInlineEnabled()) {
			this.clearForDocument(document);
			return;
		}

		const entries = parseDependencies(document);
		const sections = parseSections(document);
		if (entries.length === 0) {
			const empty: DocInsights = { entries, sections, infoByEntry: new Map() };
			this.store.set(document.uri, empty);
			this.applyToVisible(document, empty);
			return;
		}

		const gen = (this.generations.get(key) ?? 0) + 1;
		this.generations.set(key, gen);
		this.inflight.get(key)?.abort();
		const controller = new AbortController();
		this.inflight.set(key, controller);

		let xref: AssetXref | undefined;
		if (this.connection.isConnected() && this.selection.getSelected()) {
			try {
				xref = await this.selection.loadXref();
			} catch (err) {
				this.logger.warn('could not load asset risks for the connected asset');
			}
		}

		try {
			const infoByEntry = await this.enrich.enrichDocument(document, entries, controller.signal, xref);
			if (this.generations.get(key) !== gen) {
				return; // superseded by a newer refresh
			}
			const insights: DocInsights = { entries, sections, infoByEntry };
			this.store.set(document.uri, insights);
			this.applyToVisible(document, insights);
		} catch (err) {
			this.logger.error('failed to refresh dependency insights', err);
		} finally {
			if (this.inflight.get(key) === controller) {
				this.inflight.delete(key);
			}
		}
	}

	clearForDocument(document: vscode.TextDocument): void {
		this.store.delete(document.uri);
		for (const editor of vscode.window.visibleTextEditors) {
			if (editor.document.uri.toString() === document.uri.toString()) {
				this.decorations.clear(editor);
			}
		}
	}

	dispose(): void {
		for (const timer of this.debounceTimers.values()) {
			clearTimeout(timer);
		}
		this.debounceTimers.clear();
		for (const controller of this.inflight.values()) {
			controller.abort();
		}
		this.inflight.clear();
	}

	private applyToVisible(document: vscode.TextDocument, insights: DocInsights): void {
		for (const editor of vscode.window.visibleTextEditors) {
			if (editor.document.uri.toString() === document.uri.toString()) {
				this.decorations.apply(editor, insights);
			}
		}
	}
}
