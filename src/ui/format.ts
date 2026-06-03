import { Verbosity } from '../config';
import { PackageInfo } from '../api/types';

export type Tone = 'danger' | 'warn' | 'ok' | 'muted';

export type SegmentRole = 'malicious' | 'vulns' | 'age' | 'deps' | 'scorecard' | 'asset' | 'offline';

export interface Segment {
	role: SegmentRole;
	text: string;
	tone: Tone;
}

/** Left-to-right render order of inline segments (also the decoration-type creation order). */
export const SEGMENT_ORDER: SegmentRole[] = ['malicious', 'vulns', 'asset', 'age', 'deps', 'scorecard', 'offline'];

const DAY_MS = 86_400_000;

/** Builds the color-coded inline segments for a dependency, in display order. */
export function buildSegments(info: PackageInfo, verbosity: Verbosity): Segment[] {
	if (info.status === 'unknown') {
		return [];
	}
	if (info.status === 'offline') {
		return [{ role: 'offline', text: 'DevGuard offline', tone: 'muted' }];
	}
	if (info.malicious) {
		return [{ role: 'malicious', text: '⚠ malicious package', tone: 'danger' }];
	}

	const segments: Segment[] = [
		{
			role: 'vulns',
			text: info.vulnCount > 0 ? `${info.vulnCount} ${plural(info.vulnCount, 'vuln', 'vulns')}` : '0 vulns',
			tone: info.vulnCount > 0 ? 'warn' : 'ok',
		},
	];

	// Vulnerabilities pulled in via this dependency's transitive subtree (connected asset).
	const inDeps = info.assetRisk?.transitiveCount ?? 0;
	if (inDeps > 0) {
		segments.push({
			role: 'asset',
			text: `(${inDeps} in deps)`,
			tone: (info.assetRisk?.maxRisk ?? 0) >= 7 ? 'danger' : 'warn',
		});
	}

	if (verbosity === 'full') {
		const age = formatAge(info.published);
		if (age) {
			segments.push({ role: 'age', text: age, tone: ageTone(info.published) });
		}
		if (typeof info.transitiveCount === 'number') {
			segments.push({
				role: 'deps',
				text: `${info.transitiveCount} ${plural(info.transitiveCount, 'dep', 'deps')}`,
				tone: 'muted',
			});
		}
		if (typeof info.scoreCardScore === 'number' && !Number.isNaN(info.scoreCardScore)) {
			segments.push({
				role: 'scorecard',
				text: `scorecard ${info.scoreCardScore.toFixed(1)}`,
				tone: scoreTone(info.scoreCardScore),
			});
		}
	}

	return segments;
}

export interface SectionSummary {
	text: string;
	tone: Tone;
}

/** Rolls up a dependency section: malicious count, total vulns, average age and scorecard. */
export function buildSectionSummary(infos: PackageInfo[]): SectionSummary | undefined {
	const ok = infos.filter((i) => i.status === 'ok');
	if (ok.length === 0) {
		return undefined;
	}
	const totalVulns = ok.reduce((sum, i) => sum + i.vulnCount, 0);
	const maliciousCount = ok.filter((i) => i.malicious).length;
	const ages = ok.map((i) => ageYears(i.published)).filter((n): n is number => n !== undefined);
	const scores = ok
		.map((i) => i.scoreCardScore)
		.filter((n): n is number => typeof n === 'number' && !Number.isNaN(n));

	const parts: string[] = [];
	if (maliciousCount > 0) {
		parts.push(`${maliciousCount} malicious`);
	}
	parts.push(`${totalVulns} ${plural(totalVulns, 'vuln', 'vulns')}`);
	if (ages.length > 0) {
		parts.push(`avg age ${average(ages).toFixed(1)}y`);
	}
	if (scores.length > 0) {
		parts.push(`avg scorecard ${average(scores).toFixed(1)}`);
	}

	const tone: Tone = maliciousCount > 0 ? 'danger' : totalVulns > 0 ? 'warn' : 'ok';
	return { text: `Σ ${parts.join(' · ')}`, tone };
}

export function plural(n: number, one: string, many: string): string {
	return n === 1 ? one : many;
}

/** Compact relative age, e.g. "today", "12d", "5mo", "4y". */
export function formatAge(published?: string | null): string {
	const ms = ageMs(published);
	if (ms === undefined) {
		return '';
	}
	const days = Math.floor(ms / DAY_MS);
	if (days < 1) {
		return 'today';
	}
	if (days < 30) {
		return `${days}d`;
	}
	if (days < 365) {
		return `${Math.floor(days / 30)}mo`;
	}
	return `${Math.floor(days / 365)}y`;
}

export function formatScore(score?: number | null): string {
	if (typeof score !== 'number' || Number.isNaN(score)) {
		return '';
	}
	return `scorecard ${score.toFixed(1)}`;
}

/** Absolute date with a relative suffix, for the hover card. */
export function formatPublished(published?: string | null): string {
	if (!published) {
		return 'unknown';
	}
	const parsed = Date.parse(published);
	if (Number.isNaN(parsed)) {
		return 'unknown';
	}
	const date = new Date(parsed).toISOString().slice(0, 10);
	const age = formatAge(published);
	return age ? `${date} (${age} ago)` : date;
}

function scoreTone(score: number): Tone {
	if (score >= 7) {
		return 'ok';
	}
	return score >= 4 ? 'warn' : 'danger';
}

function ageTone(published?: string | null): Tone {
	const years = ageYears(published);
	return years !== undefined && years >= 3 ? 'warn' : 'muted';
}

function ageYears(published?: string | null): number | undefined {
	const ms = ageMs(published);
	return ms === undefined ? undefined : ms / (DAY_MS * 365);
}

function ageMs(published?: string | null): number | undefined {
	if (!published) {
		return undefined;
	}
	const parsed = Date.parse(published);
	if (Number.isNaN(parsed)) {
		return undefined;
	}
	const ms = Date.now() - parsed;
	return ms < 0 ? undefined : ms;
}

function average(values: number[]): number {
	return values.reduce((sum, v) => sum + v, 0) / values.length;
}
