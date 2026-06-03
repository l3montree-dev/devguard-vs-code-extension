import * as vscode from 'vscode';
import { DepType, PackageInfo } from '../api/types';
import * as config from '../config';
import { DocInsights } from '../insightStore';
import { SEGMENT_ORDER, SegmentRole, Tone, buildSectionSummary, buildSegments } from './format';

const FIRST_MARGIN = '0 0 0 1.5rem';
const GAP_MARGIN = '0 0 0 0.6rem';

/**
 * Renders color-coded inline badges. Each segment role gets its own decoration
 * type so segments can carry different colors; the types are created in
 * SEGMENT_ORDER because VS Code renders multiple end-of-line decorations at the
 * same position in type-creation order (giving correct left-to-right layout).
 */
export class DecorationManager {
	private readonly roleTypes = new Map<SegmentRole, vscode.TextEditorDecorationType>();
	private readonly summaryType: vscode.TextEditorDecorationType;

	constructor() {
		for (const role of SEGMENT_ORDER) {
			this.roleTypes.set(role, vscode.window.createTextEditorDecorationType({
				rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
			}));
		}
		this.summaryType = vscode.window.createTextEditorDecorationType({
			rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
		});
	}

	apply(editor: vscode.TextEditor, insights: DocInsights): void {
		if (!config.isInlineEnabled()) {
			this.clear(editor);
			return;
		}
		const verbosity = config.getVerbosity();

		const optionsByRole = new Map<SegmentRole, vscode.DecorationOptions[]>();
		for (const role of SEGMENT_ORDER) {
			optionsByRole.set(role, []);
		}

		for (const [entry, info] of insights.infoByEntry) {
			const eol = editor.document.lineAt(entry.valueRange.end.line).range.end;
			buildSegments(info, verbosity).forEach((seg, index) => {
				optionsByRole.get(seg.role)?.push({
					range: new vscode.Range(eol, eol),
					renderOptions: {
						after: {
							contentText: seg.text,
							color: toneColor(seg.tone),
							margin: index === 0 ? FIRST_MARGIN : GAP_MARGIN,
							fontStyle: 'italic',
						},
					},
				});
			});
		}
		for (const role of SEGMENT_ORDER) {
			editor.setDecorations(this.roleTypes.get(role) as vscode.TextEditorDecorationType, optionsByRole.get(role) ?? []);
		}

		const summaryOptions: vscode.DecorationOptions[] = [];
		for (const section of insights.sections) {
			const summary = buildSectionSummary(infosForSection(insights, section.depType));
			if (!summary) {
				continue;
			}
			const eol = editor.document.lineAt(section.line).range.end;
			summaryOptions.push({
				range: new vscode.Range(eol, eol),
				renderOptions: {
					after: { contentText: summary.text, color: toneColor(summary.tone), margin: FIRST_MARGIN, fontStyle: 'italic' },
				},
			});
		}
		editor.setDecorations(this.summaryType, summaryOptions);
	}

	clear(editor: vscode.TextEditor): void {
		for (const type of this.roleTypes.values()) {
			editor.setDecorations(type, []);
		}
		editor.setDecorations(this.summaryType, []);
	}

	dispose(): void {
		for (const type of this.roleTypes.values()) {
			type.dispose();
		}
		this.summaryType.dispose();
	}
}

function infosForSection(insights: DocInsights, depType: DepType): PackageInfo[] {
	const infos: PackageInfo[] = [];
	for (const entry of insights.entries) {
		if (entry.depType === depType) {
			const info = insights.infoByEntry.get(entry);
			if (info) {
				infos.push(info);
			}
		}
	}
	return infos;
}

function toneColor(tone: Tone): vscode.ThemeColor {
	switch (tone) {
		case 'danger':
			return new vscode.ThemeColor('editorError.foreground');
		case 'warn':
			return new vscode.ThemeColor('editorWarning.foreground');
		case 'ok':
			return new vscode.ThemeColor('charts.green');
		default:
			return new vscode.ThemeColor('descriptionForeground');
	}
}
