import { GitHubClient } from "../github-client.js";

/**
 * Public JSON API for the user's own repositories (Phase 7c).
 *
 * The sidebar widget's "Repos" tab previously fetched api.github.com DIRECTLY
 * from the browser (sort=updated, type=owner) and filtered fork/private
 * client-side — bypassing this plugin, so the GitHub token never protected the
 * call (rate limits, no auth). This endpoint moves that fetch server-side: the
 * plugin (GitHubClient + token + 15-min cache) is now the single source of truth.
 *
 * Returns a SLIM shape using the RAW GitHub field names the widget template
 * already reads (html_url/name/description/language/stargazers_count/updated_at),
 * so github-repos.njk needs no change — only the widget's fetch URL moves to
 * /api/repos.
 * @type {import("express").RequestHandler}
 */
export const reposController = {
  async api(request, response, next) {
    try {
      const { username, token, cacheTtl, limits } =
        request.app.locals.application.githubConfig;

      if (!username) {
        return response.status(400).json({ error: "No username configured" });
      }

      const client = new GitHubClient({ token, cacheTtl });

      let raw = [];
      try {
        // Fetch extra (×2) so the fork/private filter still yields enough.
        raw = await client.getUserRepos(username, (limits.repos || 10) * 2, "updated");
      } catch (apiError) {
        return response
          .status(apiError.status || 500)
          .json({ error: apiError.message });
      }

      const repos = (Array.isArray(raw) ? raw : [])
        .filter((r) => r && !r.fork && !r.private)
        .slice(0, limits.repos || 10)
        .map((r) => ({
          name: r.name,
          html_url: r.html_url,
          description: r.description,
          language: r.language,
          stargazers_count: r.stargazers_count,
          updated_at: r.updated_at,
        }));

      response.json({ repos });
    } catch (error) {
      next(error);
    }
  },
};
