/**
 * GitHub GraphQL API client for fetching all starred repositories
 * Uses cursor-based pagination to fetch 100 repos per request
 * @module github-graphql
 */

const GITHUB_GRAPHQL_URL = "https://api.github.com/graphql";

const STARRED_QUERY = `
  query($cursor: String) {
    viewer {
      starredRepositories(first: 100, after: $cursor, orderBy: {field: STARRED_AT, direction: DESC}) {
        totalCount
        edges {
          starredAt
          node {
            nameWithOwner
            name
            description
            url
            primaryLanguage { name }
            stargazerCount
            forkCount
            pushedAt
            isArchived
            owner { avatarUrl login }
            licenseInfo { spdxId name }
            repositoryTopics(first: 10) {
              nodes { topic { name } }
            }
          }
        }
        pageInfo { endCursor hasNextPage }
      }
    }
  }
`;

/**
 * Format a single starred repo edge from GraphQL response
 * @param {object} edge - GraphQL edge with starredAt + node
 * @returns {object} Formatted starred repo
 */
function formatStarredRepo(edge) {
  const repo = edge.node;
  return {
    fullName: repo.nameWithOwner,
    name: repo.name,
    description: repo.description || "",
    url: repo.url,
    language: repo.primaryLanguage?.name || null,
    stars: repo.stargazerCount,
    forks: repo.forkCount,
    topics: (repo.repositoryTopics?.nodes || []).map((n) => n.topic.name),
    license: repo.licenseInfo?.spdxId || null,
    archived: repo.isArchived,
    starredAt: edge.starredAt,
    ownerAvatar: repo.owner?.avatarUrl || "",
    ownerLogin: repo.owner?.login || "",
    pushedAt: repo.pushedAt,
  };
}

/**
 * Fetch all starred repositories via GraphQL pagination
 * @param {string} token - GitHub personal access token (REQUIRED for GraphQL)
 * @param {object} [options] - Fetch options
 * @param {number} [options.maxPages] - Max pages to fetch (null = all)
 * @param {Function} [options.onPage] - Callback after each page: (pageNum, totalFetched, totalCount)
 * @returns {Promise<{stars: Array, totalCount: number}>}
 */
export async function fetchAllStarred(token, options = {}) {
  if (!token) {
    throw new Error("GitHub token is required for GraphQL API");
  }

  const { maxPages = null, onPage = null } = options;
  const allStars = [];
  let cursor = null;
  let hasNextPage = true;
  let totalCount = 0;
  let pageNum = 0;

  while (hasNextPage) {
    if (maxPages !== null && pageNum >= maxPages) break;

    const response = await fetch(GITHUB_GRAPHQL_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: STARRED_QUERY,
        variables: { cursor },
      }),
    });

    if (!response.ok) {
      throw new Error(`GraphQL request failed: ${response.status} ${response.statusText}`);
    }

    const body = await response.json();

    if (body.errors) {
      throw new Error(`GraphQL errors: ${body.errors.map((e) => e.message).join(", ")}`);
    }

    const starred = body.data.viewer.starredRepositories;
    totalCount = starred.totalCount;

    for (const edge of starred.edges) {
      allStars.push(formatStarredRepo(edge));
    }

    cursor = starred.pageInfo.endCursor;
    hasNextPage = starred.pageInfo.hasNextPage;
    pageNum++;

    if (onPage) {
      onPage(pageNum, allStars.length, totalCount);
    }

    // Small delay between pages to avoid secondary rate limits
    if (hasNextPage) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  return { stars: allStars, totalCount };
}
