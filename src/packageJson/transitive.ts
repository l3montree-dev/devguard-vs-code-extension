import { Lockfile } from './lockfile';

/**
 * Counts the unique transitive dependencies a package pulls in, using the v2/v3
 * npm lockfile `packages` graph and npm's nearest-node_modules resolution. The
 * starting package itself is excluded. Returns undefined when the count cannot
 * be determined (no v2/v3 lockfile, or the package is not present in it).
 */
export function countTransitive(lock: Lockfile | undefined, name: string): number | undefined {
	const packages = lock?.packages;
	if (!packages) {
		return undefined;
	}
	const startKey = `node_modules/${name}`;
	if (!packages[startKey]) {
		return undefined;
	}

	const visited = new Set<string>([startKey]);
	const queue: string[] = [startKey];
	while (queue.length > 0) {
		const key = queue.shift() as string;
		const node = packages[key];
		if (!node) {
			continue;
		}
		const deps = { ...node.dependencies, ...node.optionalDependencies };
		for (const dep of Object.keys(deps)) {
			const resolved = resolveDepNode(packages, key, dep);
			if (resolved && !visited.has(resolved)) {
				visited.add(resolved);
				queue.push(resolved);
			}
		}
	}
	return visited.size - 1;
}

/**
 * Resolves a dependency name from a given package node to the install path npm
 * would use: look in the node's own node_modules, then walk up each enclosing
 * scope, finally the root node_modules.
 */
function resolveDepNode(packages: Record<string, { version?: string }>, fromKey: string, dep: string): string | undefined {
	let scope: string | null = fromKey;
	while (scope !== null) {
		const base = scope === '' ? '' : `${scope}/`;
		const candidate = `${base}node_modules/${dep}`;
		if (packages[candidate]) {
			return candidate;
		}
		if (scope === '') {
			scope = null;
		} else {
			const idx = scope.lastIndexOf('/node_modules/');
			scope = idx === -1 ? '' : scope.slice(0, idx);
		}
	}
	return undefined;
}
