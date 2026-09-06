import { test } from "node:test";
import assert from "node:assert/strict";

import { mapWithConcurrency } from "../lib/concurrency.js";

// A long featuredRepos list used to open one request per repo at once (two,
// counting the commits call). GitHub's secondary rate limit reacts to
// concurrency, and the client has no retry — a throttled fetch returns null
// and the repo silently vanishes from the page.

test("never exceeds the concurrency limit", async () => {
  let inFlight = 0;
  let peak = 0;

  const items = Array.from({ length: 45 }, (_, i) => i);
  await mapWithConcurrency(
    items,
    async (n) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight--;
      return n;
    },
    4,
  );

  assert.ok(peak <= 4, `peak concurrency was ${peak}`);
});

test("preserves input order despite out-of-order completion", async () => {
  const items = [0, 1, 2, 3, 4, 5];

  const results = await mapWithConcurrency(
    items,
    async (n) => {
      // Later items finish first.
      await new Promise((r) => setTimeout(r, (items.length - n) * 2));
      return n * 10;
    },
    3,
  );

  assert.deepEqual(results, [0, 10, 20, 30, 40, 50]);
});

test("a shorter list than the limit still resolves", async () => {
  const results = await mapWithConcurrency([1, 2], async (n) => n, 10);
  assert.deepEqual(results, [1, 2]);
});
