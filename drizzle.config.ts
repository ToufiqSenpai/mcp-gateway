import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'sqlite',
  schema: './packages/web/src/db/schema.ts',
  out: './packages/web/migrations',
});
