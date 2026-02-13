# CLAUDE.md - GitHub Activity Endpoint

## Package Overview

**Name:** `@rmdes/indiekit-endpoint-github`
**Version:** 1.0.6
**Type:** Indiekit endpoint plugin
**Repository:** https://github.com/rmdes/indiekit-endpoint-github

Displays GitHub activity including commits, stars, contributions (PRs/issues), repository activity from others, and featured repositories. Provides both an admin dashboard and public JSON API routes for Eleventy frontend integration.

## Architecture

### Entry Point
`index.js` exports the `GitHubEndpoint` class, which registers:
- Protected routes (admin dashboard HTML pages)
- Public routes (JSON API for Eleventy widgets)
- Navigation items for Indiekit admin sidebar
- Configuration storage in `application.githubConfig`

### Data Flow
```
GitHub API (api.github.com)
    ↓
GitHubClient (caching layer, 15min TTL)
    ↓
Controllers (dashboard, commits, stars, contributions, activity, featured, changelog)
    ↓
Nunjucks views (admin) OR JSON API (public)
```

No database required. All data is fetched live from GitHub API with in-memory caching.

## Key Files

| File | Purpose |
|------|---------|
| `index.js` | Plugin entry point, route registration, config storage |
| `lib/github-client.js` | GitHub API client with caching (15min TTL by default) |
| `lib/utils.js` | Data transformation utilities (extractCommits, formatStarred, etc.) |
| `lib/controllers/dashboard.js` | Main admin dashboard showing all activity |
| `lib/controllers/commits.js` | Recent commits (Events API + fallback to Repos API) |
| `lib/controllers/stars.js` | Recently starred repositories |
| `lib/controllers/contributions.js` | PRs and issues created by user |
| `lib/controllers/activity.js` | Activity on user's repos from others |
| `lib/controllers/featured.js` | Featured repositories with recent commits |
| `lib/controllers/changelog.js` | Indiekit-specific changelog aggregator (categorizes by repo type) |
| `views/*.njk` | Nunjucks templates for admin pages |
| `locales/en.json` | Internationalization strings |

## Routes

### Protected Routes (Admin)
Authentication required via Indiekit's auth middleware.

| Route | Controller | Purpose |
|-------|------------|---------|
| `GET /github` | `dashboardController.get` | Main dashboard with all sections |
| `GET /github/commits` | `commitsController.get` | Full commits list |
| `GET /github/stars` | `starsController.get` | Full starred repos list |
| `GET /github/contributions` | `contributionsController.get` | Full PRs/issues list |
| `GET /github/activity` | `activityController.get` | Activity on user's repos from others |
| `GET /github/featured` | `featuredController.get` | Featured repositories with commits |

### Public Routes (JSON API)
No authentication required. Used by Eleventy frontend widgets.

| Route | Controller | Response |
|-------|------------|----------|
| `GET /github/api/commits` | `commitsController.api` | `{ commits: [...] }` |
| `GET /github/api/stars` | `starsController.api` | `{ stars: [...] }` |
| `GET /github/api/contributions` | `contributionsController.api` | `{ contributions: [...] }` |
| `GET /github/api/activity` | `activityController.api` | `{ activity: [...] }` |
| `GET /github/api/featured` | `featuredController.api` | `{ featured: [...] }` |
| `GET /github/api/changelog?days=30` | `changelogController.api` | `{ commits: [...], categories: {...}, totalCommits: N }` |

## MongoDB Schema

**None.** This plugin does not use MongoDB. All data is fetched from GitHub API with in-memory caching.

## Configuration Options

Configure in `indiekit.config.js`:

```javascript
import GitHubEndpoint from "@rmdes/indiekit-endpoint-github";

export default {
  plugins: [
    new GitHubEndpoint({
      mountPath: "/github",          // Admin route prefix (default: /github)
      username: "your-username",     // GitHub username (REQUIRED)
      token: process.env.GITHUB_TOKEN, // GitHub PAT for private repos (optional)
      cacheTtl: 900_000,             // Cache TTL in ms (default: 15 minutes)
      limits: {
        commits: 10,                 // Max commits to show (default: 10)
        stars: 20,                   // Max starred repos (default: 20)
        contributions: 10,           // Max PRs/issues (default: 10)
        activity: 20,                // Max activity events (default: 20)
        repos: 10,                   // Max repos to fetch (default: 10)
      },
      repos: [],                     // Filter activity to specific repos (empty = all)
      featuredRepos: [               // Repos to showcase with commits
        "owner/repo1",
        "owner/repo2",
      ],
    }),
  ],
};
```

### Environment Variables

- `GITHUB_TOKEN` - GitHub Personal Access Token (optional, but required for private repo activity)

The token is read from `options.token` which defaults to `process.env.GITHUB_TOKEN`.

## Inter-Plugin Relationships

### Navigation Integration
Registers a navigation item in Indiekit's admin sidebar:
```javascript
get navigationItems() {
  return {
    href: this.options.mountPath,
    text: "github.title",
    requiresDatabase: false,
  };
}
```

### Shortcut Integration
Registers a shortcut in Indiekit's admin dashboard:
```javascript
get shortcutItems() {
  return {
    url: this.options.mountPath,
    name: "github.activity",
    iconName: "syndicate",
    requiresDatabase: false,
  };
}
```

### Config Storage
Stores configuration in `Indiekit.config.application.githubConfig` for controller access:
```javascript
init(Indiekit) {
  Indiekit.addEndpoint(this);
  Indiekit.config.application.githubConfig = this.options;
  Indiekit.config.application.githubEndpoint = this.mountPath;
}
```

## Known Gotchas

### 1. GitHub Events API Limitations
The Events API has several limitations:
- **90-day retention**: Only returns events from the last 90 days
- **300 events max**: Only returns the most recent 300 events
- **Inconsistent commit details**: PushEvents sometimes lack commit payloads

**Mitigation:** Controllers implement fallback strategies:
- `commitsController`: Falls back to fetching commits directly from recently pushed repos
- `contributionsController`: Falls back to GitHub Search API (`/search/issues`) which has no 90-day limit

### 2. Private Repository Access
Without a GitHub token, the plugin only shows public activity. With a token:
- Uses `/user/repos` instead of `/users/:username/repos` (includes private repos)
- Uses `/users/:username/events` instead of `/users/:username/events/public` (includes private activity)

**Best practice:** Always configure `GITHUB_TOKEN` for complete activity visibility.

### 3. Rate Limiting
- **Authenticated:** 5,000 requests/hour per token
- **Unauthenticated:** 60 requests/hour per IP

The plugin uses in-memory caching (15min TTL) to minimize API calls. The `changelog` endpoint fetches commits in batches of 5 repos to avoid secondary rate limits.

### 4. Cache Stale Data
The in-memory cache (Map) persists for 15 minutes. If you push new commits, they won't appear immediately. Restart Indiekit or wait for cache expiry.

**Future improvement:** Add cache-busting or manual refresh button in admin UI.

### 5. Changelog Endpoint is Indiekit-Specific
The `/api/changelog` endpoint is designed for the `indiekit-dev` workspace. It:
- Filters repos by name containing "indiekit"
- Categorizes repos by prefix (endpoint-, syndicator-, post-type-, etc.)
- Returns commits grouped by category

If used outside the Indiekit ecosystem, this endpoint will return empty results or need customization.

## Dependencies

### Runtime
- `@indiekit/error` (^1.0.0-beta.25) - Error handling
- `express` (^5.0.0) - HTTP routing

### Peer
- `@indiekit/indiekit` (>=1.0.0-beta.25) - Core plugin API

### Implicit
- Relies on native `fetch` (Node 18+)
- No database dependencies

## Debugging Tips

### Enable GitHub API Logging
The plugin logs errors to console but not successful requests. To debug API calls:
```javascript
// In lib/github-client.js, add before line 46:
console.log('[GitHub] Fetching:', url);
```

### Inspect Cache
The cache is stored in `GitHubClient` instances (per-request). To inspect:
```javascript
// In any controller, after creating client:
console.log('Cache keys:', Array.from(client.cache.keys()));
console.log('Cache size:', client.cache.size);
```

### Test Public API Routes Locally
```bash
# Without auth (public routes)
curl http://localhost:3000/github/api/commits
curl http://localhost:3000/github/api/changelog?days=7
```

### Verify Token Access
Check if token has access to private repos:
```bash
curl -H "Authorization: Bearer $GITHUB_TOKEN" https://api.github.com/user/repos
```

## Common Patterns

### Adding a New View
1. Create controller in `lib/controllers/new-view.js`
2. Export `get` (HTML view) and `api` (JSON) methods
3. Register routes in `index.js`:
   ```javascript
   protectedRouter.get('/new-view', newViewController.get);
   publicRouter.get('/api/new-view', newViewController.api);
   ```
4. Create Nunjucks template in `views/new-view.njk`
5. Add i18n strings to `locales/en.json`

### Fetching New GitHub Data Types
1. Add method to `GitHubClient`:
   ```javascript
   async getNewData(param) {
     return this.fetch(`/endpoint/${param}`);
   }
   ```
2. Add formatter to `lib/utils.js` if needed
3. Use in controller:
   ```javascript
   const data = await client.getNewData('value');
   const formatted = formatNewData(data);
   ```

## Testing Checklist

- [ ] Admin dashboard loads without errors
- [ ] All sections show data (commits, stars, contributions)
- [ ] Featured repos display correctly (if configured)
- [ ] Public API routes return valid JSON
- [ ] Changelog endpoint categorizes Indiekit repos correctly
- [ ] Private repos appear (if token configured)
- [ ] Fallback logic works when Events API returns no commits
- [ ] Error states render correctly (no username, API failure)
- [ ] Navigation item appears in Indiekit admin sidebar
- [ ] Cache expires after 15 minutes
