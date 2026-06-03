import * as vscode from 'vscode';
import { PackageInfo, ScoreCardCheck } from '../api/types';
import { InsightStore } from '../insightStore';
import { isPackageJson } from '../packageJson/parse';
import { formatPublished, formatScore } from './format';

export class DevGuardHoverProvider implements vscode.HoverProvider {
	constructor(private readonly store: InsightStore) {}

	provideHover(document: vscode.TextDocument, position: vscode.Position): vscode.ProviderResult<vscode.Hover> {
		if (!isPackageJson(document)) {
			return undefined;
		}
		const info = this.store.infoAt(document.uri, position);
		if (!info) {
			return undefined;
		}
		return new vscode.Hover(renderHover(info));
	}
}

function renderHover(info: PackageInfo): vscode.MarkdownString {
	const md = new vscode.MarkdownString(undefined, true);
	md.supportThemeIcons = true;

	md.appendMarkdown(`**${escape(info.name)}@${escape(info.resolvedVersion)}**\n`);

	if (info.status === 'offline') {
		md.appendMarkdown('\n$(cloud) DevGuard is offline — could not load insights.');
		return md;
	}
	if (info.status === 'unknown') {
		md.appendMarkdown(`\n_No concrete version could be resolved for ${code(info.resolvedVersion)}._`);
		return md;
	}

	if (info.malicious) {
		md.appendMarkdown(`\n$(alert) **Malicious package** — ${code(info.malicious.id)}`);
		if (info.malicious.summary) {
			md.appendMarkdown(`\n\n${escape(info.malicious.summary)}`);
		}
		md.appendMarkdown('\n\n---\n');
	}

	const lines: string[] = [];

	if (info.vulnCount > 0) {
		lines.push(`$(shield) **${info.vulnCount}** known ${info.vulnCount === 1 ? 'vulnerability' : 'vulnerabilities'} for this version`);
		for (const v of info.vulns.slice(0, 5)) {
			lines.push(`  - ${code(v.cveId)}${v.fixedVersion ? ` → fixed in ${code(v.fixedVersion)}` : ''}`);
		}
		if (info.vulns.length > 5) {
			lines.push(`  - …and ${info.vulns.length - 5} more`);
		}
	} else {
		lines.push('$(shield) No known vulnerabilities for this version');
	}

	lines.push(`$(history) Released: ${formatPublished(info.published)}`);

	if (typeof info.transitiveCount === 'number') {
		lines.push(`$(package) Transitive dependencies: **${info.transitiveCount}** (from package-lock.json)`);
	}

	const score = formatScore(info.scoreCardScore);
	if (score) {
		lines.push(`$(verified) OpenSSF ${score} / 10`);
		for (const c of failingChecks(info.scoreCard?.checks)) {
			lines.push(`  - ${escape(c.name)}: ${c.score}/10`);
		}
	}

	if (info.project && (info.project.starsCount || info.project.license)) {
		const stars = info.project.starsCount ? `$(star) ${info.project.starsCount.toLocaleString()}` : '';
		const license = info.project.license ? `· ${escape(info.project.license)}` : '';
		const home = safeUrl(info.project.homepage) ? ` · [homepage](${info.project.homepage})` : '';
		lines.push(`${stars} ${license}${home}`.trim());
	}

	if (info.assetRisk) {
		const { ownCount, transitiveCount, maxRisk } = info.assetRisk;
		if (ownCount > 0) {
			lines.push(`$(warning) Open risks for this package in your asset: **${ownCount}**`);
		}
		if (transitiveCount > 0) {
			lines.push(`$(warning) Vulnerabilities in transitive dependencies: **${transitiveCount}** — max risk ${maxRisk.toFixed(1)}`);
		}
	}

	md.appendMarkdown(`\n${lines.join('\n\n')}\n`);
	md.appendMarkdown(`\n\n---\n_version from ${versionSourceLabel(info)}_`);
	return md;
}

function failingChecks(checks?: ScoreCardCheck[]): ScoreCardCheck[] {
	return (checks ?? [])
		.filter((c) => typeof c.score === 'number' && c.score >= 0 && c.score < 7)
		.sort((a, b) => a.score - b.score)
		.slice(0, 3);
}

function versionSourceLabel(info: PackageInfo): string {
	switch (info.versionSource) {
		case 'lockfile':
			return 'package-lock.json';
		case 'node_modules':
			return 'installed node_modules';
		default:
			return 'package.json range (approximate)';
	}
}

function safeUrl(url?: string): boolean {
	if (!url) {
		return false;
	}
	try {
		const u = new URL(url);
		return u.protocol === 'http:' || u.protocol === 'https:';
	} catch {
		return false;
	}
}

function escape(text: string): string {
	return text.replace(/[\\`*_{}[\]()#+\-.!|<>]/g, (m) => `\\${m}`);
}

/** Wraps text in an inline code span (backslashes are literal inside, so no escaping — just strip backticks). */
function code(text: string): string {
	return `\`${text.replace(/`/g, '')}\``;
}
