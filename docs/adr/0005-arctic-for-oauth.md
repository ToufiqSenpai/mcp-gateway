# Native fetch owns the OAuth lifecycle; vendor SDKs only make API calls

**Superseded in part.** `arctic` was deprecated on npm in July 2026, so the gateway's own
`OAuthProvider` (`packages/web/src/auth/oauth.ts`) now performs authorize, code exchange,
refresh and Google revoke with `fetch`. The decision to keep OAuth out of the vendor SDKs
still holds.

Neither official SDK can be the OAuth client on Workers. `@azure/identity` keeps the refresh token in an in-memory MSAL cache that `getToken()` never exposes and an isolate cannot outlive, so the refresh cycle cannot be sustained. `google-auth-library` overwrites a rotated refresh token with the stale one it sent, silently destroying the Credential. Both were verified against package source and a local workerd harness, not just documentation. So the gateway performs authorize, code exchange and refresh for both Providers itself, while `@googleapis/calendar` and the Microsoft Graph SDK are used only for API calls with an externally supplied access token.

**Consequences.** The Google client needs `access_type=offline` and `prompt=consent` on the authorize URL — without it Google issues no refresh token at all. Microsoft's scope list must carry `offline_access` explicitly, and its refresh request must repeat the scope list. The Google client needs `globalThis.window = globalThis` (otherwise gaxios loads `node-fetch`) and an auth adapter exposing `request(opts)`, because googleapis-common calls `authClient.request`, not just `getRequestHeaders`; a string `auth` would be read as an API key. Graph needs `@microsoft/msgraph-sdk-users` imported for its `me.onenote` registration, a hand-written `AuthenticationProvider` that adds `Authorization` with `headers.add` (the kiota `Headers` collection is `Map<string, Set<string>>`), and every `@microsoft/kiota-*` pinned to one preview number.
