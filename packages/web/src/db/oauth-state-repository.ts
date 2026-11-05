import { eq, lt } from "drizzle-orm"

import type { Env } from "../env"
import { createDb, nowSeconds, type Database } from "./client"
import { oauthStates, type NewOAuthAttempt, type OAuthAttempt } from "./schema"

/** Every OAuth-attempt statement the Worker makes, over one D1 handle. */
export class OAuthStateRepository {
  private readonly db: Database

  public constructor(env: Pick<Env, "DB">) {
    this.db = createDb(env)
  }

  public async insert(attempt: NewOAuthAttempt): Promise<void> {
    await this.db.insert(oauthStates).values(attempt)
  }

  /** Single-use consumption: `DELETE … RETURNING` in one statement. */
  public async take(state: string): Promise<OAuthAttempt | undefined> {
    const rows = await this.db.delete(oauthStates).where(eq(oauthStates.state, state)).returning()
    return rows[0]
  }

  public async deleteExpired(now = nowSeconds()): Promise<void> {
    await this.db.delete(oauthStates).where(lt(oauthStates.expiresAt, now))
  }
}
