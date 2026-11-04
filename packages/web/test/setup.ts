import { applyD1Migrations, env } from 'cloudflare:test';
import { accessKeys } from './support/access';
import { installFetchRouter } from './support/providers';

// The Provider and Access fakes are below the SDK, at the HTTP seam.
installFetchRouter(async () => (await accessKeys()).jwks);

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
