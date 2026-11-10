import { bindings, defineConfig, defineWorker } from "cf/config";

export default defineConfig({
  worker: defineWorker({
    name: "app",
    entrypoint: "vinext/server/fetch-handler",
    compatibilityDate: "2026-11-09",
    compatibilityFlags: ["nodejs_compat", "global_fetch_strictly_public"],
    assets: {
      htmlHandling: "none",
      notFoundHandling: "none",
      runWorkerFirst: [
        "/*", "!/_next/static/*", "!/*/_next/static/*",
        "!/manifest.webmanifest", "!/deltatime-push.js", "!/deltatime-icon-*.png",
      ],
    },
    env: {
      ASSETS: bindings.assets(),
    },
  }),
});
