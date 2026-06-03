import * as vscode from 'vscode';
import { findNodeAtLocation, Node, parseTree } from 'jsonc-parser';
import { DepType } from '../api/types';

export interface DependencyEntry {
	name: string;
	rangeSpec: string;
	depType: DepType;
	keyRange: vscode.Range;
	valueRange: vscode.Range;
}

export interface SectionInfo {
	depType: DepType;
	/** Line of the section's opening (e.g. the `"dependencies": {` line). */
	line: number;
}

const DEP_SECTIONS: DepType[] = [
	'dependencies',
	'devDependencies',
	'optionalDependencies',
	'peerDependencies',
];

/** True when this document is a package.json we should decorate. */
export function isPackageJson(document: vscode.TextDocument): boolean {
	return document.uri.scheme === 'file' && /(^|[\\/])package\.json$/.test(document.uri.fsPath);
}

/** Extracts every dependency entry across the four dependency sections. */
export function parseDependencies(document: vscode.TextDocument): DependencyEntry[] {
	const root = parseTree(document.getText());
	if (!root) {
		return [];
	}
	const entries: DependencyEntry[] = [];
	for (const section of DEP_SECTIONS) {
		const node = findNodeAtLocation(root, [section]);
		if (!node || node.type !== 'object' || !node.children) {
			continue;
		}
		for (const prop of node.children) {
			if (prop.type !== 'property' || !prop.children || prop.children.length < 2) {
				continue;
			}
			const [keyNode, valueNode] = prop.children;
			if (keyNode.type !== 'string' || valueNode.type !== 'string') {
				continue;
			}
			entries.push({
				name: String(keyNode.value),
				rangeSpec: String(valueNode.value),
				depType: section,
				keyRange: nodeRange(document, keyNode),
				valueRange: nodeRange(document, valueNode),
			});
		}
	}
	return entries;
}

/** Returns the line of each present dependency section's opening, for the summary decoration. */
export function parseSections(document: vscode.TextDocument): SectionInfo[] {
	const root = parseTree(document.getText());
	if (!root) {
		return [];
	}
	const sections: SectionInfo[] = [];
	for (const depType of DEP_SECTIONS) {
		const node = findNodeAtLocation(root, [depType]);
		if (node && node.type === 'object') {
			sections.push({ depType, line: document.positionAt(node.offset).line });
		}
	}
	return sections;
}

/** Finds the entry whose key or value range contains the given position. */
export function entryAt(entries: DependencyEntry[], position: vscode.Position): DependencyEntry | undefined {
	return entries.find((e) => e.keyRange.contains(position) || e.valueRange.contains(position));
}

function nodeRange(document: vscode.TextDocument, node: Node): vscode.Range {
	return new vscode.Range(document.positionAt(node.offset), document.positionAt(node.offset + node.length));
}
