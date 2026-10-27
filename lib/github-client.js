import { IndiekitError } from "@indiekit/error";

const BASE_URL = "https://api.github.com";

/**
 * Whether a GitHub REST object belongs to a non-public repository.
 * Repos carry `private` and `visibility`; events carry a top-level `public`.
 * @param {object} item - GitHub API object
 * @returns {boolean} - True if the object must not be served publicly
 */
export function isNonPublic(item) {
  if (!item || typeof item !== "object") return false;
  return (
    item.private === true ||
    item.public === false ||
    (item.visibility !== undefined && item.visibility !== "public")
  );
}

export class GitHubClient {
  /**
   * @param {object} options - Client options
   * @param {string} [options.token] - GitHub personal access token
   * @param {number} [options.cacheTtl] - Cache TTL in milliseconds
   * @param {boolean} [options.includePrivate] - Return private repos and
   *   events the token can read. Only for authenticated (admin) pages; the
   *   default drops them, because public routes run with the owner's token.
   */
  constructor(options = {}) {
    this.token = options.token;
    this.includePrivate = options.includePrivate === true;
    this.cacheTtl = options.cacheTtl || 900_000;
    this.cache = new Map();
  }

  /**
   * Fetch from GitHub API with caching
   * @param {string} endpoint - API endpoint
   * @returns {Promise<object>} - Response data
   */
  async fetch(endpoint) {
    const url = `${BASE_URL}${endpoint}`;

    // Check cache first
    const cached = this.cache.get(url);
    if (cached && Date.now() - cached.timestamp < this.cacheTtl) {
      return cached.data;
    }

    const headers = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };

    if (this.token) {
      headers.Authorization = `Bearer ${this.token}`;
    }

    const response = await fetch(url, { headers });

    if (!response.ok) {
      // Only use fromFetch for JSON error responses; GitHub sometimes returns
      // HTML error pages (e.g., 502 Bad Gateway) which cause SyntaxError noise
      const contentType = response.headers.get("content-type") || "";
      if (contentType.includes("json")) {
        throw await IndiekitError.fromFetch(response);
      }

      throw new IndiekitError(response.statusText, {
        status: response.status,
        code: response.statusText,
      });
    }

    let data = await response.json();

    if (!this.includePrivate) {
      if (Array.isArray(data)) {
        data = data.filter((item) => !isNonPublic(item));
      } else if (isNonPublic(data)) {
        throw new IndiekitError("Not Found", { status: 404, code: "Not Found" });
      }
    }

    // Cache result
    this.cache.set(url, { data, timestamp: Date.now() });

    return data;
  }

  /**
   * Get user's events (commits, PRs, issues, etc.)
   * With includePrivate and a token, uses the endpoint that includes private activity
   * @param {string} username - GitHub username
   * @param {number} [limit] - Number of events to fetch
   * @returns {Promise<Array>} - User events
   */
  async getUserEvents(username, limit = 30) {
    // Use non-public endpoint when authenticated to include private repo activity
    const endpoint =
      this.token && this.includePrivate
        ? `/users/${username}/events?per_page=${limit}`
        : `/users/${username}/events/public?per_page=${limit}`;
    return this.fetch(endpoint);
  }

  /**
   * Get commits for a specific repository
   * @param {string} owner - Repository owner
   * @param {string} repo - Repository name
   * @param {number} [limit] - Number of commits to fetch
   * @param {string} [since] - ISO 8601 date string to filter commits after
   * @returns {Promise<Array>} - Repository commits
   */
  async getRepoCommits(owner, repo, limit = 10, since = null) {
    let endpoint = `/repos/${owner}/${repo}/commits?per_page=${limit}`;
    if (since) {
      endpoint += `&since=${since}`;
    }
    return this.fetch(endpoint);
  }

  /**
   * Get user's starred repos
   * @param {string} username - GitHub username
   * @param {number} [limit] - Number of repos to fetch
   * @returns {Promise<Array>} - Starred repositories
   */
  async getUserStarred(username, limit = 30) {
    return this.fetch(
      `/users/${username}/starred?per_page=${limit}&sort=created`,
    );
  }

  /**
   * Get user profile
   * @param {string} username - GitHub username
   * @returns {Promise<object>} - User profile
   */
  async getUser(username) {
    return this.fetch(`/users/${username}`);
  }

  /**
   * Get user's repositories
   * With includePrivate and a token, uses /user/repos to include private repos
   * @param {string} username - GitHub username
   * @param {number} [limit] - Number of repos to fetch
   * @param {string} [sort] - Sort by: created, updated, pushed, full_name
   * @returns {Promise<Array>} - User repositories
   */
  async getUserRepos(username, limit = 30, sort = "pushed") {
    // When authenticated, use /user/repos for private repos access
    // Then filter by owner to get only the user's repos (not org repos)
    if (this.token && this.includePrivate) {
      const repos = await this.fetch(
        `/user/repos?per_page=${limit}&sort=${sort}&direction=desc&affiliation=owner`,
      );
      return repos;
    }
    // Unauthenticated: public repos only
    return this.fetch(
      `/users/${username}/repos?per_page=${limit}&sort=${sort}&direction=desc`,
    );
  }

  /**
   * Get repo details
   * @param {string} owner - Repository owner
   * @param {string} repo - Repository name
   * @returns {Promise<object>} - Repository details
   */
  async getRepo(owner, repo) {
    return this.fetch(`/repos/${owner}/${repo}`);
  }

  /**
   * Get repo events (activity from others)
   * @param {string} owner - Repository owner
   * @param {string} repo - Repository name
   * @param {number} [limit] - Number of events to fetch
   * @returns {Promise<Array>} - Repository events
   */
  async getRepoEvents(owner, repo, limit = 30) {
    return this.fetch(`/repos/${owner}/${repo}/events?per_page=${limit}`);
  }

  /**
   * Get user's PRs across all repos
   * @param {string} username - GitHub username
   * @param {number} [limit] - Number of PRs to fetch
   * @returns {Promise<object>} - Search results with PRs
   */
  async getUserPRs(username, limit = 30) {
    return this.fetch(
      `/search/issues?q=author:${username}+type:pr${this.includePrivate ? "" : "+is:public"}&per_page=${limit}&sort=created`,
    );
  }

  /**
   * Get user's issues across all repos
   * @param {string} username - GitHub username
   * @param {number} [limit] - Number of issues to fetch
   * @returns {Promise<object>} - Search results with issues
   */
  async getUserIssues(username, limit = 30) {
    return this.fetch(
      `/search/issues?q=author:${username}+type:issue${this.includePrivate ? "" : "+is:public"}&per_page=${limit}&sort=created`,
    );
  }
}
