import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

const here = path.dirname(fileURLToPath(import.meta.url));

// Deliberately production: the dev auth bypass is unreachable here, which is what the
// production gate test relies on.
export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.join(here, 'migrations'));

  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: path.join(here, '../../wrangler.jsonc') },
        miniflare: {
          bindings: {
            ENVIRONMENT: 'production',
            TEST_MIGRATIONS: migrations,
            // Fixtures only. Not a deployed key.
            TOKEN_ENCRYPTION_KEY: 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=',
            CURSOR_SIGNING_KEY: 'test-cursor-signing-key',
            CF_ACCESS_TEAM_DOMAIN: 'https://test.cloudflareaccess.com',
            CF_ACCESS_ADMIN_AUD: 'test-admin-aud',
            CF_ACCESS_MCP_AUD: 'test-mcp-aud',
            GOOGLE_CLIENT_ID: 'test-google-client-id',
            GOOGLE_CLIENT_SECRET: 'test-google-client-secret',
            MICROSOFT_CLIENT_ID: 'test-microsoft-client-id',
            MICROSOFT_CLIENT_SECRET: 'test-microsoft-client-secret',
          },
          d1Databases: ['DB'],
          kvNamespaces: ['CACHE'],
        },
      }),
    ],
    test: {
      setupFiles: ['./test/setup.ts'],
      include: ['test/**/*.test.ts'],
      passWithNoTests: true,
    },
  };
});
