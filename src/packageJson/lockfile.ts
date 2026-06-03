import { promises as fs } from 'node:fs';
import * as path from 'node:path';

/** A package entry in a v2/v3 npm lockfile (`packages` map). */
export interface LockPackage {
	version?: string;
	dependencies?: Record<string, string>;
	optionalDependencies?: Record<string, string>;
}

/** A package entry in a v1 npm lockfile (`dependencies` map). */
export interface LockDepV1 {
	version?: string;
}

export interface Lockfile {
	dir: string;
	lockfileVersion: number;
	/** v2/v3: keyed by install path, e.g. "node_modules/@babel/core". */
	packages?: Record<string, LockPackage>;
	/** v1: keyed by package name (top level only here). */
	dependencies?: Record<string, LockDepV1>;
}

interface CacheEntry {
	mtimeMs: number;
	lock: Lockfile | undefined;
}

const cache = new Map<string, CacheEntry>();

/**
 * Finds the nearest package-lock.json walking up from `pkgDir` (bounded by
 * `stopDir` when given) and returns it parsed. Memoized by path + mtime.
 */
export async function loadNearestLockfile(pkgDir: string, stopDir?: string): Promise<Lockfile | undefined> {
	const lockPath = await findLockfilePath(pkgDir, stopDir);
	if (!lockPath) {
		return undefined;
	}
	let mtimeMs: number;
	try {
		mtimeMs = (await fs.stat(lockPath)).mtimeMs;
	} catch {
		return undefined;
	}
	const cached = cache.get(lockPath);
	if (cached && cached.mtimeMs === mtimeMs) {
		return cached.lock;
	}
	let lock: Lockfile | undefined;
	try {
		const parsed = JSON.parse(await fs.readFile(lockPath, 'utf8')) as Partial<Lockfile>;
		lock = {
			dir: path.dirname(lockPath),
			lockfileVersion: parsed.lockfileVersion ?? 0,
			packages: parsed.packages,
			dependencies: parsed.dependencies,
		};
	} catch {
		lock = undefined;
	}
	cache.set(lockPath, { mtimeMs, lock });
	return lock;
}

async function findLockfilePath(startDir: string, stopDir?: string): Promise<string | undefined> {
	let dir = startDir;
	// Bound the walk so a stray edit far outside the project can't scan the disk.
	for (let depth = 0; depth < 30; depth++) {
		const candidate = path.join(dir, 'package-lock.json');
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
