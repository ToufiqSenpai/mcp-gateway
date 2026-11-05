import { applyD1Migrations, env, type D1Migration } from "cloudflare:test"
import { describe, expect, it } from "vitest"

interface AccountRow {
  id: string
  mcp: string
  slug: string
  provider: string
  providerSubject: string
  displayName: string
  accessToken: string
  isDefault: number
  lastError: string
}

interface StoredRow {
  mcp: string
  slug: string
  provider: string
  display_name: string | null
  access_token: string | null
  is_default: number
  last_error: string | null
}

function migration(prefix: string): D1Migration {
  const found = env.TEST_MIGRATIONS.find(entry => entry.name.startsWith(prefix))
  if (!found) throw new Error(`migration ${prefix} is missing`)
  return found
}

/**
 * The pool applies every migration in setup, so this test drops the tables and replays the
 * old schema from the migration files themselves: only the 0001 rebuild is under test.
 */
async function replayOldSchema(): Promise<void> {
  await env.DB.prepare("DROP TABLE IF EXISTS oauth_states").run()
  await env.DB.prepare("DROP TABLE IF EXISTS accounts").run()
  await env.DB.prepare("DELETE FROM d1_migrations").run()
  await applyD1Migrations(env.DB, [migration("0000_")])
}

async function insertAccount(row: AccountRow): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO accounts
      (id, mcp, slug, provider, provider_subject, email, display_name, access_token,
       access_token_expires_at, scopes, state, is_default, last_error, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'operator@example.com', ?, ?, 0, '', 'active', ?, ?, 0, 0)`
  )
    .bind(
      row.id,
      row.mcp,
      row.slug,
      row.provider,
      row.providerSubject,
      row.displayName,
      row.accessToken,
      row.isDefault,
      row.lastError
    )
    .run()
}

describe("0001 accounts rebuild", () => {
  it("keeps calendar and notes Accounts and accepts only sheets with Google", async () => {
    await replayOldSchema()
    await insertAccount({
      id: crypto.randomUUID(),
      mcp: "calendar",
      slug: "personal",
      provider: "google",
      providerSubject: "google-subject",
      displayName: "Operator One",
      accessToken: "ciphertext-calendar",
      isDefault: 1,
      lastError: "invalid_grant"
    })
    await insertAccount({
      id: crypto.randomUUID(),
      mcp: "notes",
      slug: "work",
      provider: "microsoft",
      providerSubject: "microsoft-subject",
      displayName: "Operator Two",
      accessToken: "ciphertext-notes",
      isDefault: 1,
      lastError: ""
    })

    await applyD1Migrations(env.DB, [migration("0001_")])

    const rows = await env.DB.prepare(
      `SELECT mcp, slug, provider, display_name, access_token, is_default, last_error
       FROM accounts ORDER BY mcp`
    ).all<StoredRow>()
    expect(rows.results).toEqual([
      {
        mcp: "calendar",
        slug: "personal",
        provider: "google",
        display_name: "Operator One",
        access_token: "ciphertext-calendar",
        is_default: 1,
        last_error: "invalid_grant"
      },
      {
        mcp: "notes",
        slug: "work",
        provider: "microsoft",
        display_name: "Operator Two",
        access_token: "ciphertext-notes",
        is_default: 1,
        last_error: ""
      }
    ])

    await insertAccount({
      id: crypto.randomUUID(),
      mcp: "sheets",
      slug: "budget",
      provider: "google",
      providerSubject: "sheets-subject",
      displayName: "Operator One",
      accessToken: "ciphertext-sheets",
      isDefault: 0,
      lastError: ""
    })
    const sheets = await env.DB.prepare("SELECT mcp, provider FROM accounts WHERE mcp = 'sheets'").all<{
      mcp: string
      provider: string
    }>()
    expect(sheets.results).toEqual([{ mcp: "sheets", provider: "google" }])

    await expect(
      insertAccount({
        id: crypto.randomUUID(),
        mcp: "sheets",
        slug: "wrong-provider",
        provider: "microsoft",
        providerSubject: "sheets-microsoft",
        displayName: "Operator Two",
        accessToken: "",
        isDefault: 0,
        lastError: ""
      })
    ).rejects.toThrow(/CHECK/i)
  })
})
