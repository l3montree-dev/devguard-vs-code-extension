import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { VersionSource } from '../api/types';
import { Lockfile } from './lockfile';

export interface ResolvedVersion {
	version: string;
	source: VersionSource;
}

/**
 * Resolves the concrete version to inspect for a dependency. Prefers the
 * lockfile, then the installed node_modules copy, then a concrete version
 * cleaned out of the package.json range. Returns undefined when no concrete
 * version can be determined (e.g. `*`, `latest`, `workspace:*`, git/file specs).
 */
export async function resolveVersion(
	pkgDir: string,
	lock: Lockfile | undefined,
	name: string,
	rangeSpec: string,
): Promise<ResolvedVersion | undefined> {
	const fromLock = versionFromLockfile(lock, name);
	if (fromLock) {
		return { version: fromLock, source: 'lockfile' };
	}
	const fromModules = await versionFromNodeModules(pkgDir, name);
	if (fromModules) {
		return { version: fromModules, source: 'node_modules' };
	}
	const cleaned = cleanRange(rangeSpec);
	if (cleaned) {
		return { version: cleaned, source: 'range' };
	}
	return undefined;
}

function versionFromLockfile(lock: Lockfile | undefined, name: string): string | undefined {
	if (!lock) {
		return undefined;
	}
	if (lock.packages) {
		return lock.packages[`node_modules/${name}`]?.version;
	}
	if (lock.dependencies) {
		return lock.dependencies[name]?.version;
	}
	return undefined;
}

async function versionFromNodeModules(pkgDir: string, name: string): Promise<string | undefined> {
	try {
		const manifest = path.join(pkgDir, 'node_modules', ...name.split('/'), 'package.json');
		const parsed = JSON.parse(await fs.readFile(manifest, 'utf8')) as { version?: string };
		return typeof parsed.version === 'string' ? parsed.version : undefined;
	} catch {
		return undefined;
	}
}

/** Extracts a concrete `major.minor.patch[...]` version from a range spec. */
export function cleanRange(spec: string): string | undefined {
	const match = /(\d+\.\d+\.\d+[A-Za-z0-9.\-+]*)/.exec(spec.trim());
	return match ? match[1] : undefined;
}
