import type { Plugin } from "vite";

import { createBrowserBoundaryPlugin, locatePackageRoots } from "./boundary.ts";

export const astilbaEnvBrowserBoundary = (): Plugin =>
  createBrowserBoundaryPlugin(locatePackageRoots(import.meta.url));
