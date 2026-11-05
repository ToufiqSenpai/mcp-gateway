import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1"

import type { Env } from "../env"
import * as schema from "./schema"

export type Database = DrizzleD1Database<typeof schema>

export function createDb(env: Pick<Env, "DB">): Database {
  return drizzle(env.DB, { schema })
}

export const nowSeconds = (): number => Math.floor(Date.now() / 1000)
