import type { TokenCipher } from "../auth/crypto"
import type { AccountRepository } from "../db/account-repository"
import type { Account } from "../db/schema"
import { UnusableAccountError, type UnusableReason } from "./errors"

/**
 * Records the demotion, drops the refresh lease and fails the call. Shared by the pre-emptive
 * refresh path and the call-path scope check so the two can never drift.
 */
export async function demoteAccount(
  repository: AccountRepository,
  account: Account,
  reason: Extract<UnusableReason, "needs_reauth" | "missing_scope">,
  lastError: string = reason
): Promise<never> {
  await repository.update(account.id, { state: "needs_reauth", lastError })
  await repository.releaseRefreshLock(account.id, account.refreshLockToken ?? "")
  await repository.bumpCacheEpoch(account.id)
  throw new UnusableAccountError(account.mcp, account.slug, reason)
}

/** The row holds ciphertext only; an absent column means there is nothing to decrypt. */
export async function readAccessToken(cipher: TokenCipher, account: Account): Promise<string> {
  if (!account.accessToken) {
    throw new UnusableAccountError(account.mcp, account.slug, "no_credentials")
  }
  return cipher.decrypt(account.accessToken, account.id, "access_token")
}
