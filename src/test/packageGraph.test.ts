import * as assert from 'assert';
import { purlNameKey } from '../enrich/enrich';
import { Lockfile } from '../packageJson/lockfile';
import { cleanRange } from '../packageJson/resolveVersion';
import { countTransitive } from '../packageJson/transitive';

suite('countTransitive', () => {
	const lock: Lockfile = {
		dir: '/x',
		lockfileVersion: 3,
		packages: {
			'': {},
			'node_modules/a': { version: '1.0.0', dependencies: { b: '^1', c: '^1' } },
			'node_modules/b': { version: '1.0.0', dependencies: { c: '^1' } },
			'node_modules/c': { version: '1.0.0' },
			'node_modules/a/node_modules/d': { version: '2.0.0' },
			'node_modules/standalone': { version: '1.0.0' },
		},
	};

	test('counts unique transitive deps and ignores unrelated packages', () => {
		// a -> b, c ; b -> c. Nested d is not in a's manifest deps, standalone unreachable.
		assert.strictEqual(countTransitive(lock, 'a'), 2);
	});

	test('prefers the nested copy when resolving', () => {
		const nested: Lockfile = {
			dir: '/x',
			lockfileVersion: 3,
			packages: {
				'': {},
				'node_modules/a': { version: '1', dependencies: { b: '^1' } },
				'node_modules/b': { version: '1', dependencies: { c: '^1' } },
				'node_modules/c': { version: '1' },
				'node_modules/b/node_modules/c': { version: '2' },
			},
		};
		// a -> b ; b -> nested c. Unique reachable nodes: b and b's nested c.
		assert.strictEqual(countTransitive(nested, 'a'), 2);
	});

	test('returns undefined for missing package or non-v2/v3 lockfile', () => {
		assert.strictEqual(countTransitive(lock, 'missing'), undefined);
		assert.strictEqual(countTransitive({ dir: '/x', lockfileVersion: 1, dependencies: {} }, 'a'), undefined);
		assert.strictEqual(countTransitive(undefined, 'a'), undefined);
	});
});

suite('cleanRange', () => {
	test('extracts a concrete version from a range', () => {
		assert.strictEqual(cleanRange('^4.17.21'), '4.17.21');
		assert.strictEqual(cleanRange('~1.2.3'), '1.2.3');
		assert.strictEqual(cleanRange('>=1.0.0 <2.0.0'), '1.0.0');
		assert.strictEqual(cleanRange('1.2.3-beta.1'), '1.2.3-beta.1');
	});

	test('returns undefined for non-concrete specs', () => {
		assert.strictEqual(cleanRange('*'), undefined);
		assert.strictEqual(cleanRange('latest'), undefined);
		assert.strictEqual(cleanRange('workspace:*'), undefined);
		assert.strictEqual(cleanRange('1.2.x'), undefined);
	});
});

suite('purlNameKey', () => {
	test('collapses backend %40 and literal @ scoped purls to the same key', () => {
		assert.strictEqual(purlNameKey('pkg:npm/%40sentry/nextjs@8.0.0'), 'pkg:npm/@sentry/nextjs');
		assert.strictEqual(purlNameKey('pkg:npm/@sentry/nextjs@8.0.0'), 'pkg:npm/@sentry/nextjs');
	});

	test('strips version and qualifiers for unscoped purls', () => {
		assert.strictEqual(purlNameKey('pkg:npm/next@14.2.0'), 'pkg:npm/next');
		assert.strictEqual(purlNameKey('pkg:npm/next@14.2.0?type=module'), 'pkg:npm/next');
	});

	test('keeps the name when there is no version', () => {
		assert.strictEqual(purlNameKey('pkg:npm/%40scope/name'), 'pkg:npm/@scope/name');
		assert.strictEqual(purlNameKey('pkg:npm/next'), 'pkg:npm/next');
	});
});
