// Transitive dependency counting is not possible from go.sum alone —
// the file is a flat integrity manifest with no dependency graph edges.
// Accurate counts require running `go mod graph` or parsing the module
// cache. Until that is implemented, we intentionally return undefined
// so callers omit the count rather than show a misleading value.
export function countGoTransitive(): undefined {
	return undefined;
}