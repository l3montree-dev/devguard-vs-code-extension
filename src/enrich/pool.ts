/** Runs `fn` over `items` with at most `limit` concurrent executions. */
export async function mapWithConcurrency<T, R>(
	items: T[],
	limit: number,
	fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
	const results: R[] = new Array(items.length);
	let next = 0;
	const workerCount = Math.max(1, Math.min(limit, items.length));
	const workers: Promise<void>[] = [];
	for (let w = 0; w < workerCount; w++) {
		workers.push(
			(async () => {
				for (;;) {
					const i = next++;
					if (i >= items.length) {
						return;
					}
					results[i] = await fn(items[i], i);
				}
			})(),
		);
	}
	await Promise.all(workers);
	return results;
}
