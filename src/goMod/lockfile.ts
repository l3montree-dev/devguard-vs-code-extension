import { promises as fs } from 'node:fs';
import * as path from 'node:path';

/**
 * A parsed entry from go.sum.
 * Each module+version can appear twice: once for the module tree, once for the zip.
 * We only care about the module tree entry (no `/go.mod` suffix).
 */
export interface GoSumEntry {
	version: string;
	hash: string;
}

export interface GoSum {
	dir: string;
	/** Keyed by module path, e.g. "github.com/gin-gonic/gin" → { version, hash } */
	modules: Map<string, GoSumEntry>;
}

interface CacheEntry {
	mtimeMs: number;
	goSum: GoSum | undefined;
}

const cache = new Map<string, CacheEntry>();

/**
 * Finds the nearest go.sum walking up from `pkgDir` (bounded by `stopDir`)
 * and returns it parsed. Memoized by path + mtime.
 *
 * go.sum lines look like:
 *   github.com/gin-gonic/gin v1.9.1 h1:4idEAncQnU5cB7BeOkPtxjfCSye0AAm1R0RVIqJ+Jmg=
 *   github.com/gin-gonic/gin v1.9.1/go.mod h1:hMxhfA4/zJQnFMF7oFLqf0V9JaE9EfG7XkJO/1MCxHA=
 */
export async function loadNearestGoSum(pkgDir: string, stopDir?: string): Promise<GoSum | undefined> {
	const sumPath = await findGoSumPath(pkgDir, stopDir);
	if (!sumPath) {
		return undefined;
	}
	let mtimeMs: number;
	try {
		mtimeMs = (await fs.stat(sumPath)).mtimeMs;
	} catch {
		return undefined;
	}
	const cached = cache.get(sumPath);
	if (cached && cached.mtimeMs === mtimeMs) {
		return cached.goSum;
	}
	let goSum: GoSum | undefined;
	try {
		const text = await fs.readFile(sumPath, 'utf8');
		goSum = { dir: path.dirname(sumPath), modules: parseGoSum(text) };
	} catch {
		goSum = undefined;
	}
	cache.set(sumPath, { mtimeMs, goSum });
	return goSum;
}

function parseGoSum(text: string): Map<string, GoSumEntry> {
	const modules = new Map<string, GoSumEntry>();
	for (const line of text.split('\n')) {
		const trimmed = line.trim();
		if (!trimmed) {
			continue;
		}
		// Skip the /go.mod entries — we want the module zip entries only
		if (trimmed.includes('/go.mod ')) {
			continue;
		}
		const parts = trimmed.split(/\s+/);
		if (parts.length < 3) {
			continue;
		}
		const [modulePath, version, hash] = parts;
		if (!modules.has(modulePath)) {
			modules.set(modulePath, { version, hash });
		}
	}
	return modules;
}

async function findGoSumPath(startDir: string, stopDir?: string): Promise<string | undefined> {
	let dir = startDir;
	for (let depth = 0; depth < 30; depth++) {
		const candidate = path.join(dir, 'go.sum');
		try {
			await fs.access(candidate);
			return candidate;
		} catch {
			// keep walking up
		}
		if (stopDir && path.resolve(dir) === path.resolve(stopDir)) {
			break;
		}
		const parent = path.dirname(dir);
		if (parent === dir) {
			break;
		}
		dir = parent;
	}
	return undefined;
}