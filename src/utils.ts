/**
 * Canonical version-less key for matching purls across the package.json side and
 * the backend. Drops qualifiers/subpath, decodes the `%40` the backend uses for
 * scoped npm packages, removes the version, and lowercases. So both
 * `pkg:npm/@sentry/nextjs@8` and `pkg:npm/%40sentry/nextjs@8` -> `pkg:npm/@sentry/nextjs`.
 */
export function purlNameKey(purl: string): string {
	let s = purl.split('?')[0].split('#')[0].replace(/%40/gi, '@');
	const lastSlash = s.lastIndexOf('/');
	const versionAt = s.indexOf('@', lastSlash < 0 ? 0 : lastSlash);
	if (versionAt !== -1) {
		s = s.slice(0, versionAt);
	}
	return s.toLowerCase();
}
