import * as vscode from 'vscode';
import { PackageInfo } from './api/types';
import { DependencyEntry, SectionInfo, entryAt } from './packageJson/parse';

export interface DocInsights {
	entries: DependencyEntry[];
	sections: SectionInfo[];
	infoByEntry: Map<DependencyEntry, PackageInfo>;
}

/**
 * Single source of truth for the latest computed insights per document. Both
 * the decoration renderer and the hover provider read from here.
 */
export class InsightStore {
	private readonly byUri = new Map<string, DocInsights>();

	set(uri: vscode.Uri, insights: DocInsights): void {
		this.byUri.set(uri.toString(), insights);
	}

	get(uri: vscode.Uri): DocInsights | undefined {
		return this.byUri.get(uri.toString());
	}

	delete(uri: vscode.Uri): void {
		this.byUri.delete(uri.toString());
	}

	infoAt(uri: vscode.Uri, position: vscode.Position): PackageInfo | undefined {
		const insights = this.byUri.get(uri.toString());
		if (!insights) {
			return undefined;
		}
		const entry = entryAt(insights.entries, position);
		return entry ? insights.infoByEntry.get(entry) : undefined;
	}
}
