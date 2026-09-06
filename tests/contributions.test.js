import { test } from "node:test";
import assert from "node:assert/strict";

import { extractContributions } from "../lib/utils.js";

// GitHub's PUBLIC events feed carries a minimal pull_request object. Captured
// from /users/rmdes/events/public: the keys are id, number, url, base, head —
// there is no title and no html_url. Building a contribution from it produced
// a bare "getindiekit/indiekit #944" with an empty title and a dead link, and
// because it was non-empty it also suppressed the Search API fallback that
// returns the real data.
const minimalPrEvent = {
  type: "PullRequestEvent",
  created_at: "2026-09-05T20:50:01Z",
  repo: { name: "getindiekit/indiekit" },
  payload: {
    action: "opened",
    number: 944,
    pull_request: { id: 1, number: 944, url: "https://api.github.com/…" },
  },
};

const fullPrEvent = {
  type: "PullRequestEvent",
  created_at: "2026-09-05T20:50:01Z",
  repo: { name: "getindiekit/indiekit" },
  payload: {
    action: "opened",
    pull_request: {
      number: 944,
      title: "feat(endpoint-microsub): PR 1",
      html_url: "https://github.com/getindiekit/indiekit/pull/944",
    },
  },
};

test("drops events that carry no title or url", () => {
  assert.deepEqual(extractContributions([minimalPrEvent]), []);
});

test("keeps events that do carry a title and url", () => {
  const [contribution] = extractContributions([fullPrEvent]);

  assert.equal(contribution.type, "pr");
  assert.equal(contribution.title, "feat(endpoint-microsub): PR 1");
  assert.equal(
    contribution.url,
    "https://github.com/getindiekit/indiekit/pull/944",
  );
});

test("an all-minimal feed yields nothing, so callers reach the Search API", () => {
  // Every caller falls back on `contributions.length === 0`.
  assert.equal(
    extractContributions([minimalPrEvent, minimalPrEvent]).length,
    0,
  );
});

test("non-opened actions are still ignored", () => {
  const reopened = {
    ...fullPrEvent,
    payload: { ...fullPrEvent.payload, action: "reopened" },
  };
  assert.deepEqual(extractContributions([reopened]), []);
});
