import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { currentBuildVersion } from "../scripts/build-version";
import { precompressAssetsPlugin } from "../scripts/precompress-assets";
import packageJson from "./package.json";

const appVersion = currentBuildVersion(
  process.env.HERDR_WORLD_BUILD_VERSION,
  packageJson.version,
);

// Diffs request only Pierre's default pair (DEFAULT_THEMES in @pierre/diffs),
// yet its theme registry names every Shiki and Pierre theme as a lazy import,
// which shipped about 1.6 MB of themes no page could load. Every other theme
// resolves to one module that refuses to load. A theme picker would widen this.
export const BUNDLED_DIFF_THEMES = new Set(["pierre-dark", "pierre-light"]);
export const UNBUNDLED_THEME = "\0herdr-world-unbundled-theme";
export function onlyBundledDiffThemes(): Plugin {
  return {
    name: "herdr-world-bundled-diff-themes",
    enforce: "pre",
    resolveId(source) {
      const theme =
        /^@shikijs\/themes\/([\w-]+)$/.exec(source)?.[1] ??
        /^@pierre\/theme\/(pierre-[\w-]+)$/.exec(source)?.[1];
      if (theme && !BUNDLED_DIFF_THEMES.has(theme)) return UNBUNDLED_THEME;
    },
    load(id) {
      if (id === UNBUNDLED_THEME)
        return 'throw new Error("This syntax theme is not bundled with Herdr World");';
    },
  };
}

// In dev, the web app talks to the bridge through Vite's proxy so the
// frontend can use a relative /ws URL (same origin, no hardcoded port).
export default defineConfig(({ mode }) => {
  const devtools =
    mode === "development" || process.env.HERDR_WORLD_BUILD_DEVTOOLS === "1";
  return {
    // Hashed /assets/* ship with brotli and gzip variants (#1245).
    plugins: [react(), onlyBundledDiffThemes(), precompressAssetsPlugin()],
    define: {
      __HERDR_WORLD_VERSION__: JSON.stringify(appVersion),
      // World's development tools (event traces, renderer counters) exist only
      // in development builds: the dev server, or HERDR_WORLD_BUILD_DEVTOOLS=1.
      // Release and package builds never set it (src/world/devtools/flag.ts).
      __HERDR_WORLD_DEVTOOLS__: JSON.stringify(devtools),
    },
    resolve: {
      alias: [
        // Release builds get inert stand-ins for the devtools modules.
        ...(devtools
          ? []
          : [
              {
                find: /^.*\/devtools\/(trace|TraceOverlay)$/,
                replacement: fileURLToPath(
                  new URL("./src/world/devtools/release.ts", import.meta.url),
                ),
              },
            ]),
        {
          // Diffs always use Shiki's WASM engine ("shiki-wasm"); keep the
          // never-selected JavaScript regex engine out of the app and worker.
          find: /^shiki\/engine\/javascript$/,
          replacement: fileURLToPath(
            new URL("./src/shikiJavaScriptEngine.ts", import.meta.url),
          ),
        },
        {
          find: /^shiki\/wasm$/,
          replacement: fileURLToPath(
            new URL("./src/shikiWasm.ts", import.meta.url),
          ),
        },
        {
          find: /^shiki$/,
          replacement: fileURLToPath(
            new URL("./src/shiki.ts", import.meta.url),
          ),
        },
      ],
    },
    worker: {
      format: "es",
      plugins: () => [onlyBundledDiffThemes()],
    },
    build: {
      // Retain Vite 5's browser baseline instead of Vite 7's newer default.
      target: ["es2020", "edge88", "firefox78", "chrome87", "safari14"],
      // The asset check follows static imports from the entry, excluding lazy features.
      manifest: true,
      // Build straight into the server's static dir so the backend can serve it.
      outDir: "../server/public",
      emptyOutDir: true,
      rolldownOptions: {
        // A dynamic import that another module also imports statically stays in
        // the eager chunk, so the lazy boundary silently does nothing.
        onLog(level, log, handler) {
          if (log.code === "INEFFECTIVE_DYNAMIC_IMPORT")
            throw new Error(log.message);
          handler(level, log);
        },
        output: {
          codeSplitting: {
            groups: [
              {
                // Share startup transport and small agent RPC helpers without extra requests.
                name: "bridge-client",
                test: /src[\\/](?:api|connectionHttp|useConnectionClient|agentIntegrations|agentLauncher)\.tsx?$/,
              },
              {
                // These startup preferences share storage; keep their small
                // helpers together instead of adding utility-only requests.
                name: "browser-preferences",
                test: /src[\\/](?:browserStorage|layoutPreferences|shortcutPreferences)\.ts$/,
              },
              {
                // Keep startup UI primitives together without loading feature-only icons.
                name: "ui-runtime",
                test: /(?:node_modules[\\/](?:lucide-react|react|react-dom|scheduler|@radix-ui|@floating-ui)[\\/]|src[\\/](?:utils\.ts|components[\\/]ui[\\/]popover\.tsx)$)/,
                tags: ["$initial"],
              },
              {
                // The Library, its Town sign and Chat's Made summary read memory and
                // the artefact shelf together; keep both clients in one lazy asset.
                name: "memoryClient",
                test: /src[\\/]world[\\/]memory[\\/](?:memoryClient|artefactShelfClient)\.ts$/,
              },
              {
                // Feature-only icons and name dictionaries share one lazy asset.
                name: "feature-icons",
                test: /node_modules[\\/](?:lucide-react|unique-names-generator)[\\/]/,
              },
              {
                // File and code previews load these together. Preserve one lazy editor
                // boundary instead of a separate chunk for each editor package.
                name: "code-preview",
                test: /node_modules[\\/](?:@codemirror|@lezer|codemirror)[\\/]/,
              },
              // Rare grammars share one lazy chunk per family, but only the
              // grammars named here: one they embed (javascript, css, shell,
              // markdown, c, java…) keeps its own chunk, so a common
              // language's diff never fetches the whole family.
              {
                name: "syntax-config",
                includeDependenciesRecursively: false,
                test: /@shikijs\/langs\/dist\/(awk|diff|docker|ini|json5|jsonl|make|nginx|proto|toml|xml|yaml)\.mjs$/,
              },
              {
                name: "syntax-extra",
                includeDependenciesRecursively: false,
                test: /@shikijs\/langs\/dist\/(clojure|crystal|elixir|elm|erlang|fsharp|groovy|haskell|kotlin|common-lisp|lua|r|scala)\.mjs$/,
              },
            ],
          },
        },
      },
    },

    server: {
      port: 5173,
      proxy: {
        "/ws": { target: "http://127.0.0.1:8788", ws: true },
        "/api": { target: "http://127.0.0.1:8788" },
        // Installation metadata is instance-specific, including in development.
        "/manifest.json": { target: "http://127.0.0.1:8788" },
        // Code view: installed IDEs World proxies under /ide/<instance>/.
        "/ide/": { target: "http://127.0.0.1:8788", ws: true },
        // Let an unauthenticated dev client reach the bridge login page instead
        // of repeatedly loading the Vite SPA at /login and redirecting again.
        "/login": { target: "http://127.0.0.1:8788" },
      },
    },
  };
});
