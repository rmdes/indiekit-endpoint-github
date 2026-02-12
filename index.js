import express from "express";

import { activityController } from "./lib/controllers/activity.js";
import { changelogController } from "./lib/controllers/changelog.js";
import { commitsController } from "./lib/controllers/commits.js";
import { contributionsController } from "./lib/controllers/contributions.js";
import { dashboardController } from "./lib/controllers/dashboard.js";
import { featuredController } from "./lib/controllers/featured.js";
import { starsController } from "./lib/controllers/stars.js";

// Module-level routers (matching Indiekit's endpoint pattern)
const protectedRouter = express.Router();
const publicRouter = express.Router();

const defaults = {
  mountPath: "/github",
  username: "",
  token: process.env.GITHUB_TOKEN,
  cacheTtl: 900_000, // 15 minutes in ms
  limits: {
    commits: 10,
    stars: 20,
    contributions: 10,
    activity: 20,
    repos: 10,
  },
  repos: [], // Empty = all repos, or specify ['owner/repo', ...] for filtering activity
  featuredRepos: [], // Repos to showcase with commits, e.g. ['owner/repo', ...]
};

export default class GitHubEndpoint {
  name = "GitHub activity endpoint";

  constructor(options = {}) {
    this.options = { ...defaults, ...options };
    this.mountPath = this.options.mountPath;
  }

  get environment() {
    return ["GITHUB_TOKEN"];
  }

  get navigationItems() {
    return {
      href: this.options.mountPath,
      text: "github.title",
      requiresDatabase: false,
    };
  }

  get shortcutItems() {
    return {
      url: this.options.mountPath,
      name: "github.activity",
      iconName: "syndicate",
      requiresDatabase: false,
    };
  }

  /**
   * Protected routes (require authentication)
   * HTML pages for admin dashboard
   */
  get routes() {
    // Dashboard
    protectedRouter.get("/", dashboardController.get);

    // Individual sections (HTML pages)
    protectedRouter.get("/commits", commitsController.get);
    protectedRouter.get("/stars", starsController.get);
    protectedRouter.get("/contributions", contributionsController.get);
    protectedRouter.get("/activity", activityController.get);
    protectedRouter.get("/featured", featuredController.get);

    return protectedRouter;
  }

  /**
   * Public routes (no authentication required)
   * JSON API endpoints for Eleventy widgets
   */
  get routesPublic() {
    // JSON API for widgets - publicly accessible
    publicRouter.get("/api/commits", commitsController.api);
    publicRouter.get("/api/stars", starsController.api);
    publicRouter.get("/api/contributions", contributionsController.api);
    publicRouter.get("/api/activity", activityController.api);
    publicRouter.get("/api/featured", featuredController.api);
    publicRouter.get("/api/changelog", changelogController.api);

    return publicRouter;
  }

  init(Indiekit) {
    Indiekit.addEndpoint(this);

    // Store GitHub config in application for controller access
    Indiekit.config.application.githubConfig = this.options;
    Indiekit.config.application.githubEndpoint = this.mountPath;
  }
}
