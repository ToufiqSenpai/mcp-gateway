import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose"
import { z } from "zod"

import type { Env } from "../env"

export type RouteGroup = "admin" | "mcp"

export interface AccessIdentity {
  kind: "human" | "service"
  subject: string
  email?: string
  commonName?: string
}

export class AccessError extends Error {
  public constructor(public readonly status: 401 | 403) {
    super(status === 403 ? "Forbidden" : "Unauthorized")
    this.name = "AccessError"
  }
}

function isLocalHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname.endsWith(".localhost")
}

function teamDomain(env: Env): string {
  let domain = env.CF_ACCESS_TEAM_DOMAIN
  while (domain.endsWith("/")) domain = domain.slice(0, -1)
  return domain
}

/** The only claims this verifier reads; every other claim is ignored. */
const AccessClaims = z.object({
  // "" is what an Access service token carries; a human carries an RFC 9562 UUID.
  sub: z.uuid().or(z.literal("")).optional(),
  email: z.string().optional(),
  common_name: z.string().optional()
})

type AccessClaims = z.infer<typeof AccessClaims>

function classify(claims: AccessClaims): AccessIdentity {
  const commonName = claims.common_name
  const email = claims.email
  const subject = claims.sub ?? ""

  if (subject === "" && commonName) {
    return { kind: "service", subject, commonName }
  }
  if (email && subject !== "") {
    return { kind: "human", subject, email }
  }
  throw new AccessError(403)
}

/**
 * Verifies `Cf-Access-Jwt-Assertion` against the team JWKS and enforces the route-group
 * pairing. Never trusts header presence, never redirects, never mints a token.
 */
export class AccessVerifier {
  /** JWKS is fetched and cached once per isolate, keyed by team domain. */
  private static readonly jwks = new Map<string, ReturnType<typeof createRemoteJWKSet>>()

  public constructor(private readonly env: Env) {}

  private static jwksFor(env: Env): ReturnType<typeof createRemoteJWKSet> {
    const domain = teamDomain(env)
    let set = AccessVerifier.jwks.get(domain)
    if (!set) {
      set = createRemoteJWKSet(new URL(`${domain}/cdn-cgi/access/certs`))
      AccessVerifier.jwks.set(domain, set)
    }
    return set
  }

  /**
   * The local bypass needs both halves: `ENVIRONMENT=development` and a localhost host. The
   * production test asserts the first half is unreachable when the environment is anything else.
   */
  public static isDevBypass(env: Pick<Env, "ENVIRONMENT">, url: string | URL): boolean {
    if (env.ENVIRONMENT !== "development") return false
    return isLocalHost(new URL(url).hostname)
  }

  public async verify(request: Request, group: RouteGroup): Promise<AccessIdentity> {
    if (AccessVerifier.isDevBypass(this.env, request.url)) {
      return {
        kind: "human",
        subject: "00000000-0000-0000-0000-000000000000",
        email: "dev@localhost"
      }
    }

    const token = request.headers.get("Cf-Access-Jwt-Assertion")
    if (!token) throw new AccessError(401)

    const audience = group === "admin" ? this.env.CF_ACCESS_ADMIN_AUD : this.env.CF_ACCESS_MCP_AUD
    let payload: JWTPayload
    try {
      // Both audiences are accepted here so a credential for the other group can be told apart
      // from an invalid one: the mismatch below is a 403, not a 401.
      ;({ payload } = await jwtVerify(token, AccessVerifier.jwksFor(this.env), {
        issuer: teamDomain(this.env),
        audience: [this.env.CF_ACCESS_ADMIN_AUD, this.env.CF_ACCESS_MCP_AUD]
      }))
    } catch {
      throw new AccessError(401)
    }

    const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud]
    if (!audiences.includes(audience)) throw new AccessError(403)

    const claims = AccessClaims.safeParse(payload)
    if (!claims.success) throw new AccessError(403)

    const identity = classify(claims.data)
    const expected = group === "admin" ? "human" : "service"
    // A credential valid for the other group is a 403 with no detail.
    if (identity.kind !== expected) throw new AccessError(403)
    return identity
  }
}

export function isDevBypass(env: Pick<Env, "ENVIRONMENT">, url: string | URL): boolean {
  return AccessVerifier.isDevBypass(env, url)
}

export function verifyAccess(request: Request, env: Env, group: RouteGroup): Promise<AccessIdentity> {
  return new AccessVerifier(env).verify(request, group)
}
