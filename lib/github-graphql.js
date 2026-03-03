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

const LISTS_QUERY = `
  query($cursor: String) {
    viewer {
      lists(first: 100, after: $cursor) {
        totalCount
        nodes {
          name
          slug
          description
          isPrivate
        }
        pageInfo { endCursor hasNextPage }
      }
    }
  }
`;

const LIST_ITEMS_QUERY = `
  query($slug: String!, $cursor: String) {
    viewer {
      list(slug: $slug) {
        items(first: 100, after: $cursor) {
          nodes {
            ... on Repository {
              nameWithOwner
            }
          }
          pageInfo { endCursor hasNextPage }
        }
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

/**
 * Fetch all GitHub Lists and their repository memberships
 * @param {string} token - GitHub personal access token (REQUIRED)
 * @returns {Promise<Array<{name: string, slug: string, description: string, repoFullNames: string[]}>>}
 */
export async function fetchAllLists(token) {
  if (!token) {
    throw new Error("GitHub token is required for GraphQL API");
  }

  // Stage 1: Fetch list metadata only (no items — avoids timeout)
  const listMeta = [];
  let cursor = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const response = await fetch(GITHUB_GRAPHQL_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: LISTS_QUERY,
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

    const listsData = body.data.viewer.lists;

    for (const node of listsData.nodes) {
      if (node.isPrivate) continue;
      listMeta.push({
        name: node.name,
        slug: node.slug,
        description: node.description || "",
      });
    }

    cursor = listsData.pageInfo.endCursor;
    hasNextPage = listsData.pageInfo.hasNextPage;

    if (hasNextPage) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  // Stage 2: Fetch items per list individually (avoids timeout from bulk query)
  const allLists = [];

  for (const meta of listMeta) {
    const repoFullNames = [];
    let itemsCursor = null;
    let itemsHasNext = true;

    while (itemsHasNext) {
      await new Promise((resolve) => setTimeout(resolve, 200));

      const itemsResponse = await fetch(GITHUB_GRAPHQL_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query: LIST_ITEMS_QUERY,
          variables: { slug: meta.slug, cursor: itemsCursor },
        }),
      });

      if (!itemsResponse.ok) {
        console.error(`[GitHub Lists] Failed to fetch items for list "${meta.name}": ${itemsResponse.status}`);
        break;
      }

      const itemsBody = await itemsResponse.json();

      if (itemsBody.errors) {
        console.error(`[GitHub Lists] GraphQL errors for list "${meta.name}": ${itemsBody.errors.map((e) => e.message).join(", ")}`);
        break;
      }

      const itemsData = itemsBody.data.viewer.list.items;
      for (const itemNode of itemsData.nodes) {
        if (itemNode.nameWithOwner) {
          repoFullNames.push(itemNode.nameWithOwner);
        }
      }

      itemsCursor = itemsData.pageInfo.endCursor;
      itemsHasNext = itemsData.pageInfo.hasNextPage;
    }

    allLists.push({
      name: meta.name,
      slug: meta.slug,
      description: meta.description,
      repoFullNames,
    });
  }

  console.log(`[GitHub Lists] Fetched ${allLists.length} public lists`);
  return allLists;
}
