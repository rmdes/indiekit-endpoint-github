/**
 * Resolve a list through a worker pool.
 *
 * Promise.all over a whole list opens one request per item at once (two, for
 * a featured repo — the repo plus its commits). GitHub's secondary rate limit
 * reacts to concurrency, not just volume, and the client has no retry: a
 * throttled fetch returns null and the item silently disappears from the
 * page. A small pool keeps a long list from tripping it.
 * @param {Array} items - Items to map
 * @param {Function} fn - Async mapper
 * @param {number} [limit] - Maximum calls in flight
 * @returns {Promise<Array>} Results, in the order of the input
 */
export async function mapWithConcurrency(items, fn, limit = 4) {
  const results = new Array(items.length);
  let next = 0;

  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );

  return results;
}
