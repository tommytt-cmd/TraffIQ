// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  // Pass additional raw configuration directly to Vite using the 'vite' key
  vite: {
    environments: {
      ssr: {
        transport: {
          // Bump Vite 6 environment transport timeout to 2 minutes
          timeout: 120000, 
        },
      },
    },
    ssr: {
      optimizeDeps: {
        // Pre-bundle common heavy SSR dependencies to reduce cold-start compilation overhead
        include: [
          "@tanstack/react-start", 
          "lucide-react", 
          "zod"
        ],
      },
    },
  },
});
