import { fileURLToPath, URL } from 'node:url';
import vueJsx from '@vitejs/plugin-vue-jsx';
import { defineConfig } from 'vite';
import { createChunkOwnership } from './scripts/chunk-ownership';

const root = fileURLToPath(new URL('.', import.meta.url));
const featureChunks: Record<string, string> = {
  settings: 'shared-ui',
  files: 'file-workspace',
  terminal: 'terminal-workspace',
  connections: 'workspace',
  workspace: 'workspace',
  remote: 'remote-workspace',
  quick: 'remote-workspace',
  x11: 'remote-workspace',
  operations: 'operations',
  forwards: 'operations',
  logs: 'operations',
  batch: 'operations',
  'data-exchange': 'operations',
  assistant: 'productivity',
  efficiency: 'productivity',
  'session-efficiency': 'productivity',
  snippets: 'productivity'
};

export default defineConfig({
  root,
  base: './',
  appType: 'mpa',
  publicDir: false,
  envDir: false,
  envPrefix: 'TERMA_PUBLIC_',
  plugins: [vueJsx()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: {
    host: '127.0.0.1',
    port: 8105,
    strictPort: true,
    cors: false,
    fs: { strict: true, allow: [root] }
  },
  preview: {
    host: '127.0.0.1',
    port: 8106,
    strictPort: true,
    cors: false,
    headers: {
      'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer'
    }
  },
  build: {
    outDir: fileURLToPath(new URL('./dist', import.meta.url)),
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
    manifest: true,
    rollupOptions: {
      output: {
        onlyExplicitManualChunks: true,
        minifyInternalExports: false,
        manualChunks: (() => {
          let ownership: Map<string, string> | undefined;
          const featureFor = (id: string) => {
          const source = id.replace(/\\/g, '/');
          if (source.includes('/node_modules/')) return undefined;
          if (source.endsWith('/installed-services.ts')) return 'shared-ui';
          if (/\/src\/(shared|components|composables)\//.test(source)) return 'shared-ui';
          if (/\/src\/app\/(AboutPage|UpdatePanel)\.tsx$/.test(source)) return 'shared-ui';
          // Modal ownership and validation are shared leaves, while mount composes the domains.
          if (/\/features\/operations\/operations-(modal|types)\.ts$/.test(source)) return 'shared-ui';
          if (source.endsWith('/features/workspace/workspace-modal-host.ts')) return 'shared-ui';
          // Settings and the workspace both show the same X Server diagnostics.
          if (source.endsWith('/features/x11/presentation-service.ts')) return 'shared-ui';
          if (source.endsWith('/features/remote/management-types.ts')) return 'shared-ui';
          if (source.endsWith('/features/connections/connection-credential-model.ts')) return 'shared-ui';
          // Workspace and productivity render the same labels and protocol markers.
          if (source.endsWith('/features/workspace/workspace-tab-presentation.ts')) return 'shared-ui';
          // File drops, workspace state and terminal controls share these leaf owners.
          if (/\/features\/terminal\/terminal-(session-state|quick-registry|identity|history|libraries|metadata|prompt|viewport-service|drop-(service|workspace)|directory-(service|workspace)|startup-(model|state))\.ts$/.test(source)) return 'shared-ui';
          // Shared actions and each workspace surface consume the shell controller.
          if (/\/features\/workspace\/(workspace-shell-controller\.ts|workspace-pane-scope\.ts|workspace-dock-(state|runtime|tabs|layout)\.ts|ShellNavigation\.tsx)$/.test(source)) return 'shared-ui';
          if (source.endsWith('/features/operations/operations-mount.ts')) return undefined;
          const feature = source.match(/\/src\/features\/([^/]+)\//)?.[1];
          return feature ? featureChunks[feature] : undefined;
          };
          return (id, graph) => {
            if (id.replace(/\\/g, '/').includes('/node_modules/')) return 'runtime-vendor';
            ownership ||= createChunkOwnership(graph, featureFor);
            return ownership.get(id);
          };
        })()
      },
      input: {
        login: fileURLToPath(new URL('./login.html', import.meta.url)),
        about: fileURLToPath(new URL('./about.html', import.meta.url)),
        aboutEmbed: fileURLToPath(new URL('./about-embed.html', import.meta.url))
      }
    }
  }
});
