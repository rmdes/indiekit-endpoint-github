/**
 * GitHub v2 block declaration (Phase 7c — plugin block ownership).
 *
 * The `github-repos` sidebar widget was a site-config BUILTIN_BLOCKS seed
 * (requiresPlugin null). Declaring it here makes site-config's scanPlugins stamp
 * `sourcePlugin` → `requiresPlugin` ("GitHub activity endpoint"), so the block is
 * properly plugin-gated (theme ENDPOINT_SLUGS maps it to the `github` loadout
 * slug). scanPlugins precedence is `built-in < plugin blocks`, so this entry
 * OVERWRITES the builtin seed where the plugin is loaded; the seed itself is
 * removed from site-config in Phase 7d alongside the legacy-map bridge.
 *
 * `source:"api"` is honest: the widget fetches the plugin's JSON API LIVE
 * client-side (commits/featured/contributions/repos) — no rebuild needed for
 * fresh data. As of 7c the Repos tab also routes through this plugin
 * (/api/repos) instead of hitting api.github.com directly from the browser, so
 * the plugin is the single source of truth. Bespoke template: the theme owns
 * `components/widgets/github-repos.njk` + `js/widgets/github-repos.js`.
 *
 * @module lib/blocks
 */

/** @type {Array<object>} */
export const GITHUB_BLOCKS = [
  {
    id: "github-repos",
    version: 1,
    label: "GitHub Projects",
    description: "GitHub repositories and activity",
    icon: "github",
    category: "social",
    placement: { regions: ["sidebar"], surfaces: ["homepage"] },
    multiple: false,
    data: { source: "api" },
    schema: { type: "object", additionalProperties: false, properties: {} },
  },
];
