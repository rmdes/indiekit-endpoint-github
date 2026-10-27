import { test, afterEach } from "node:test";
import assert from "node:assert/strict";

import { GitHubClient } from "../lib/github-client.js";
import { fetchAllStarred } from "../lib/github-graphql.js";
import { activityController } from "../lib/controllers/activity.js";
import { changelogController } from "../lib/controllers/changelog.js";
import { commitsController } from "../lib/controllers/commits.js";
import { contributionsController } from "../lib/controllers/contributions.js";
import { featuredController } from "../lib/controllers/featured.js";
import { starsController } from "../lib/controllers/stars.js";

// The public JSON routes run with the owner's token, and GitHub answers a
// token with the owner's private repos and events too. Live, /api/changelog
// served commit bodies of a private repo and /api/featured served a private
// repo listed in featuredRepos. Shapes below follow the GitHub REST objects
// the controllers already parse: repos carry `private` and `visibility`,
// events carry a top-level `public`.

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const repo = (name, isPrivate) => ({
  name,
  full_name: `rmdes/${name}`,
  html_url: `https://github.com/rmdes/${name}`,
  owner: { login: "rmdes" },
  private: isPrivate,
  visibility: isPrivate ? "private" : "public",
  description: `${name} description`,
  topics: [],
});

const commit = (sha, message) => ({
  sha,
  html_url: `https://github.com/x/commit/${sha}`,
  parents: [{}],
  commit: {
    message,
    author: { name: "Ricardo", date: "2026-10-01T00:00:00Z" },
  },
});

const pushEvent = (repoName, isPublic, message) => ({
  type: "PushEvent",
  public: isPublic,
  created_at: "2026-10-01T00:00:00Z",
  repo: { name: repoName },
  actor: { login: "someone" },
  payload: { size: 1, commits: [{ sha: "a".repeat(40), message }] },
});

const prEvent = (repoName, isPublic, title) => ({
  type: "PullRequestEvent",
  public: isPublic,
  created_at: "2026-10-01T00:00:00Z",
  repo: { name: repoName },
  payload: {
    action: "opened",
    pull_request: { number: 1, title, html_url: `https://github.com/${repoName}/pull/1` },
  },
});

/**
 * Stub global fetch with a router of path prefix → JSON body
 * @param {Array<[string, any]>} routes - [pathPrefix, body] pairs; first match wins
 * @returns {string[]} Requested URLs
 */
function stubFetch(routes) {
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    const path = String(url).replace("https://api.github.com", "");
    const route = routes.find(([prefix]) => path.startsWith(prefix));
    const body = route ? route[1] : { message: "Not Found" };
    const status = route ? 200 : 404;
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  };
  return calls;
}

/**
 * Call a controller's api handler with a fake request/response
 * @param {Function} handler - Express handler
 * @param {object} [config] - githubConfig overrides
 * @returns {Promise<any>} JSON body sent
 */
async function callApi(handler, config = {}) {
  const githubConfig = {
    username: "rmdes",
    token: "ghp_test",
    cacheTtl: 1,
    limits: { commits: 10, stars: 20, contributions: 10, activity: 20, repos: 10 },
    repos: [],
    featuredRepos: [],
    ...config,
  };
  const request = { app: { locals: { application: { githubConfig } } }, query: {} };
  let body;
  const response = {
    status() {
      return this;
    },
    json(data) {
      body = data;
    },
  };
  await handler(request, response, (error) => {
    throw error;
  });
  return body;
}

test("client drops private repos and non-public events by default", async () => {
  stubFetch([
    ["/user/repos", [repo("public-one", false), repo("secret", true)]],
    ["/users/rmdes/repos", [repo("public-one", false), repo("secret", true)]],
    ["/users/rmdes/events", [pushEvent("rmdes/a", true, "ok"), pushEvent("rmdes/b", false, "leak")]],
  ]);
  const client = new GitHubClient({ token: "ghp_test" });

  const repos = await client.getUserRepos("rmdes");
  assert.deepEqual(repos.map((r) => r.name), ["public-one"]);

  const events = await client.getUserEvents("rmdes");
  assert.deepEqual(events.map((e) => e.repo.name), ["rmdes/a"]);
});

test("client asks GitHub for public events and repos only by default", async () => {
  const calls = stubFetch([
    ["/users/rmdes/events/public", []],
    ["/users/rmdes/repos", []],
  ]);
  const client = new GitHubClient({ token: "ghp_test" });
  await client.getUserEvents("rmdes");
  await client.getUserRepos("rmdes");

  assert.match(calls[0], /\/users\/rmdes\/events\/public\?/);
  assert.match(calls[1], /\/users\/rmdes\/repos\?/);
});

test("client refuses a single private repo by default", async () => {
  stubFetch([["/repos/rmdes/secret", repo("secret", true)]]);
  const client = new GitHubClient({ token: "ghp_test" });

  await assert.rejects(client.getRepo("rmdes", "secret"), { status: 404 });
});

test("client keeps private data when includePrivate is set (admin pages)", async () => {
  const calls = stubFetch([
    ["/user/repos", [repo("public-one", false), repo("secret", true)]],
    ["/repos/rmdes/secret", repo("secret", true)],
  ]);
  const client = new GitHubClient({ token: "ghp_test", includePrivate: true });

  const repos = await client.getUserRepos("rmdes");
  assert.equal(repos.length, 2);
  assert.match(calls[0], /\/user\/repos\?/);
  assert.equal((await client.getRepo("rmdes", "secret")).private, true);
});

test("/api/changelog omits private indiekit repos", async () => {
  stubFetch([
    ["/users/rmdes/repos", [repo("indiekit-public", false), repo("indiekit-sites", true)]],
    ["/user/repos", [repo("indiekit-public", false), repo("indiekit-sites", true)]],
    ["/repos/rmdes/indiekit-public/commits", [commit("1".repeat(40), "feat: ok")]],
    ["/repos/rmdes/indiekit-sites/commits", [commit("2".repeat(40), "fix: secret\n\nbody")]],
  ]);
  const body = await callApi(changelogController.api);

  assert.deepEqual(body.commits.map((c) => c.repoName), ["indiekit-public"]);
  assert.doesNotMatch(JSON.stringify(body), /indiekit-sites|secret/);
});

test("/api/featured skips a private repo named in featuredRepos", async () => {
  stubFetch([
    ["/repos/rmdes/public-one/commits", [commit("1".repeat(40), "ok")]],
    ["/repos/rmdes/public-one", repo("public-one", false)],
    ["/repos/rmdes/secret/commits", [commit("2".repeat(40), "secret commit")]],
    ["/repos/rmdes/secret", repo("secret", true)],
  ]);
  const body = await callApi(featuredController.api, {
    featuredRepos: ["rmdes/public-one", "rmdes/secret"],
  });

  assert.deepEqual(body.featured.map((r) => r.name), ["public-one"]);
  assert.doesNotMatch(JSON.stringify(body), /secret/);
});

test("/api/commits drops private push events", async () => {
  stubFetch([
    ["/users/rmdes/events", [pushEvent("rmdes/a", true, "ok"), pushEvent("rmdes/secret", false, "leak")]],
  ]);
  const body = await callApi(commitsController.api);

  assert.deepEqual(body.commits.map((c) => c.repo), ["rmdes/a"]);
});

test("/api/commits repo fallback skips private repos", async () => {
  stubFetch([
    ["/users/rmdes/events", []],
    ["/users/rmdes/repos", [repo("public-one", false), repo("secret", true)]],
    ["/user/repos", [repo("public-one", false), repo("secret", true)]],
    ["/repos/rmdes/public-one/commits", [commit("1".repeat(40), "ok")]],
    ["/repos/rmdes/secret/commits", [commit("2".repeat(40), "leak")]],
  ]);
  const body = await callApi(commitsController.api);

  assert.deepEqual(body.commits.map((c) => c.repo), ["rmdes/public-one"]);
});

test("/api/contributions drops private events and searches public repos only", async () => {
  stubFetch([
    ["/users/rmdes/events", [prEvent("rmdes/a", true, "ok"), prEvent("rmdes/secret", false, "leak")]],
  ]);
  const body = await callApi(contributionsController.api);
  assert.deepEqual(body.contributions.map((c) => c.repo), ["rmdes/a"]);

  // Search API fallback: issue items carry no visibility field, so the
  // restriction has to be in the query itself.
  const calls = stubFetch([["/users/rmdes/events", []], ["/search/issues", { items: [] }]]);
  await callApi(contributionsController.api);
  const searches = calls.filter((url) => url.includes("/search/issues"));
  assert.equal(searches.length, 2);
  for (const url of searches) assert.match(url, /\+is:public/);
});

test("/api/activity drops non-public received events", async () => {
  stubFetch([
    ["/users/rmdes/received_events", [pushEvent("rmdes/a", true, "ok"), pushEvent("rmdes/secret", false, "leak")]],
  ]);
  const body = await callApi(activityController.api);

  assert.deepEqual(body.activity.map((a) => a.repo), ["rmdes/a"]);
});

test("/api/stars drops private starred repos", async () => {
  stubFetch([["/users/rmdes/starred", [repo("public-one", false), repo("secret", true)]]]);
  const body = await callApi(starsController.api);

  assert.deepEqual(body.stars.map((s) => s.name), ["rmdes/public-one"]);
});

test("starred sync (served by /api/starred/*) skips private repos", async () => {
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        data: {
          viewer: {
            starredRepositories: {
              totalCount: 2,
              edges: [
                { starredAt: "2026-10-01T00:00:00Z", node: { nameWithOwner: "a/public", name: "public", isPrivate: false } },
                { starredAt: "2026-10-01T00:00:00Z", node: { nameWithOwner: "a/secret", name: "secret", isPrivate: true } },
              ],
              pageInfo: { endCursor: null, hasNextPage: false },
            },
          },
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  const { stars } = await fetchAllStarred("ghp_test");

  assert.deepEqual(stars.map((s) => s.fullName), ["a/public"]);
});
