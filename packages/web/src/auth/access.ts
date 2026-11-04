import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import type { Env } from '../env';

export type RouteGroup = 'admin' | 'mcp';

export interface AccessIdentity {
  kind: 'human' | 'service';
  subject: string;
  email?: string;
  commonName?: string;
}

export class AccessError extends Error {
  constructor(readonly status: 401 | 403) {
    super(status === 403 ? 'Forbidden' : 'Unauthorized');
    this.name = 'AccessError';
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isLocalHost(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname.endsWith('.localhost')
  );
}

/**
 * The local bypass needs both halves: `ENVIRONMENT=development` and a localhost host. The
 * production test asserts the first half is unreachable when the environment is anything else.
 */
export function isDevBypass(env: Pick<Env, 'ENVIRONMENT'>, url: string | URL): boolean {
  if (env.ENVIRONMENT !== 'development') return false;
  const hostname = typeof url === 'string' ? new URL(url).hostname : url.hostname;
  return isLocalHost(hostname);
}

function teamDomain(env: Env): string {
  return env.CF_ACCESS_TEAM_DOMAIN.replace(/\/+$/, '');
}

const jwks = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function jwksFor(env: Env): ReturnType<typeof createRemoteJWKSet> {
  const domain = teamDomain(env);
  let set = jwks.get(domain);
  if (!set) {
    set = createRemoteJWKSet(new URL(`${domain}/cdn-cgi/access/certs`));
    jwks.set(domain, set);
  }
  return set;
}

function classify(payload: JWTPayload): AccessIdentity {
  const commonName = typeof payload.common_name === 'string' ? payload.common_name : undefined;
  const email = typeof payload.email === 'string' ? payload.email : undefined;
  const subject = typeof payload.sub === 'string' ? payload.sub : '';

  if (subject === '' && commonName) {
    return { kind: 'service', subject, commonName };
  }
  if (email && UUID.test(subject)) {
    return { kind: 'human', subject, email };
  }
  throw new AccessError(403);
}

/**
 * Verifies `Cf-Access-Jwt-Assertion` against the team JWKS and enforces the route-group
 * pairing. Never trusts header presence, never redirects, never mints a token.
 */
export async function verifyAccess(
  request: Request,
  env: Env,
  group: RouteGroup,
): Promise<AccessIdentity> {
  if (isDevBypass(env, request.url)) {
    return { kind: 'human', subject: '00000000-0000-0000-0000-000000000000', email: 'dev@localhost' };
  }

  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token) throw new AccessError(401);

  const audience = group === 'admin' ? env.CF_ACCESS_ADMIN_AUD : env.CF_ACCESS_MCP_AUD;
  let payload: JWTPayload;
  try {
    // Both audiences are accepted here so a credential for the other group can be told apart
    // from an invalid one: the mismatch below is a 403, not a 401.
    ({ payload } = await jwtVerify(token, jwksFor(env), {
      issuer: teamDomain(env),
      audience: [env.CF_ACCESS_ADMIN_AUD, env.CF_ACCESS_MCP_AUD],
    }));
  } catch {
    throw new AccessError(401);
  }

  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audiences.includes(audience)) throw new AccessError(403);

  const identity = classify(payload);
  const expected = group === 'admin' ? 'human' : 'service';
  // A credential valid for the other group is a 403 with no detail.
  if (identity.kind !== expected) throw new AccessError(403);
  return identity;
}
