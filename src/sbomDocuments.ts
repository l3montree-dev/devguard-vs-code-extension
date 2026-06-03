import * as vscode from 'vscode';

/** Serves SBOM JSON as read-only virtual documents (no webview surface). */
export class SbomDocumentProvider implements vscode.TextDocumentContentProvider {
	static readonly scheme = 'devguard-sbom';
	private readonly contents = new Map<string, string>();

	provideTextDocumentContent(uri: vscode.Uri): string {
		return this.contents.get(uri.toString()) ?? '// SBOM content is no longer available.';
	}

	async open(label: string, content: string): Promise<void> {
		const uri = vscode.Uri.parse(`${SbomDocumentProvider.scheme}:/${encodeURIComponent(label)}.json`);
		this.contents.set(uri.toString(), content);
		const doc = await vscode.workspace.openTextDocument(uri);
		await vscode.languages.setTextDocumentLanguage(doc, 'json');
		await vscode.window.showTextDocument(doc, { preview: true });
	}
}
