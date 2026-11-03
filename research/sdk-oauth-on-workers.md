# Official Google / Microsoft SDKs for OAuth on Cloudflare Workers

Research question: can the gateway act as an OAuth **client** (authorization-code + refresh) to Google and Microsoft using only the official vendor SDKs, or is a dedicated OAuth client such as `arctic` still required?

- **Date:** 2026-11-03
- **Method:** package source + manifests from npm, vendor issue trackers, Cloudflare docs, and a local `workerd` harness (see [Appendix](#appendix-how-the-runtime-claims-were-tested)).
- **No production deploy was performed.** All runtime behaviour below was reproduced locally in `workerd 1.20261103.1` with `nodejs_compat` and compatibility date `2026-11-01`.

## Verdict table

| Library | Verdict | One-line reason |
|---|---|---|
| `google-auth-library@11.3.2` — `OAuth2Client` | **Works with caveats** | `generateAuthUrl` / `setCredentials` are pure; by default `getToken` returns an unparsed string and `refreshAccessToken` throws because gaxios picks `node-fetch` under workerd — both work with `fetchImplementation: fetch`. It also **discards rotated refresh tokens**. |
| `@googleapis/calendar@20.1.0` | **Works with caveats** | Cannot be decoupled from `google-auth-library`; a raw string `auth` is treated as an API key, not a bearer token; default responses come back as unparsed strings unless the `window` shim is applied. |
| `@azure/identity@4.14.1` | **Works with caveats** | Ships a `workerd` export; `ClientSecretCredential` and `AuthorizationCodeCredential` do acquire tokens. But it hides the refresh token in MSAL's in-memory cache, so stateless refresh across Worker requests is not possible. |
| `@microsoft/msgraph-sdk@1.0.0-preview.92` + Kiota | **Works with caveats** | A custom `AuthenticationProvider` works and `@microsoft/kiota-http-fetchlibrary` is required for an adapter. **`@microsoft/msgraph-sdk-notes` does not exist**, and no published package exposes OneNote request builders. |
| `@microsoft/kiota-authentication-azure` | **Works** | Thin wrapper over `BaseBearerTokenAuthenticationProvider`; no Node APIs, no MSAL. |
| `arctic@3.7.0` (baseline) | **Works** | No Node dependencies, uses global `fetch`; returns the rotated refresh token to the caller. |

## 1. `google-auth-library` — `OAuth2Client`

Version tested: `google-auth-library@11.3.2` ([npm](https://www.npmjs.com/package/google-auth-library/v/11.3.2), [source](https://unpkg.com/google-auth-library@11.3.2/build/src/auth/oauth2client.js)).

### Per-method result

| Method | Result in workerd | Why |
|---|---|---|
| `generateAuthUrl()` | Works | Pure URL construction with `querystring.stringify`; no I/O, no crypto. Verified in the harness. |
| `setCredentials()` | Works | Plain assignment to `this.credentials`. |
| `getToken(code)` | **Returns a raw string by default** (silent failure); works with a fetch override | Goes through gaxios. Under workerd gaxios selects `node-fetch`, whose responses arrive with **no headers**; gaxios therefore cannot detect `application/json` and returns the body as a string. |
| `refreshAccessToken()` | **Fails by default**, works with a fetch override | Same gaxios issue, then `tokens.refresh_token = ...` throws `TypeError: Cannot create property 'refresh_token' on string`. |
| PKCE (`generateCodeVerifierAsync`) | Works | Uses WebCrypto once the `window` shim is set; otherwise NodeCrypto (`createHash` / `randomBytes`). Verified: 128-char verifier. |

### Why the default path breaks

`AuthClient` builds a `Gaxios` transporter ([`authclient.js`](https://unpkg.com/google-auth-library@11.3.2/build/src/auth/authclient.js)):

```js
this.transporter = opts.transporter ?? new Gaxios(opts.transporterOptions);
```

gaxios chooses its fetch implementation by checking for a **`window` global**, not `globalThis.fetch` ([`gaxios.ts`](https://github.com/googleapis/gaxios/blob/main/src/gaxios.ts)):

```ts
static async #getFetch() {
  const hasWindow = typeof window !== 'undefined' && !!window;
  this.#fetch ||= hasWindow
    ? window.fetch
    : (await import('node-fetch')).default;
  return this.#fetch;
}
```

Workers have no `window`, so gaxios always takes the `node-fetch` branch. In the harness, `node-fetch@3.3.2` against a **real origin** (`jsonplaceholder.typicode.com`) returned `status: 200` but:

- `res.headers.get('content-type')` → `null`
- `[...res.headers.entries()]` → `[]`
- body → raw gzip bytes, not decoded

Global `fetch` against the same URL returned `content-type: application/json; charset=utf-8`. This is the root cause of the token-parsing failure, and it is independent of Google.

Reproduced output (default transporter, mock token endpoint):

```json
"getToken_defaultTransporter": {
  "ok": true,
  "value": { "tokens": "{\"access_token\":\"CODE_ACCESS\",...}", "credentials": {} }
},
"refresh_rotated_defaultTransporter": {
  "ok": false,
  "error": "TypeError: Cannot create property 'refresh_token' on string '{\"access_token\":\"NEW_ACCESS\",...}'"
}
```

### Working configuration (verified)

```ts
const client = new OAuth2Client({
  clientId,
  clientSecret,
  redirectUri,
  transporterOptions: { fetchImplementation: fetch }, // <- required
});
```

With this option:

- `getToken()` returned a parsed token object.
- `refreshAccessToken()` succeeded.
- PKCE worked.

The alternative that also worked, and which additionally fixes `@googleapis/calendar`, is a global shim **before** the first gaxios call:

```ts
globalThis.window = globalThis;
```

This makes gaxios use `window.fetch` and makes `google-auth-library` select `BrowserCrypto` (WebCrypto) instead of `NodeCrypto`. Both paths were verified.

### Which Node APIs the OAuth2 code path touches

| API | Where | Status under `nodejs_compat` |
|---|---|---|
| `querystring` | `generateAuthUrl` | Provided. |
| `stream` | Top-level import; `instanceof stream.Readable` in the 401 retry path | Provided. |
| `crypto` | `NodeCrypto`: `createHash`, `randomBytes` (PKCE / token hashing) | Provided. |
| `Buffer` | HTTP Basic client authentication in `getTokenAsync` | Provided. |
| `process` / `tty` | `google-logging-utils` calls `Colours.refresh()` at module load, which reads `process.stderr` and may call `getColorDepth()` | Provided as a stub. An **open** Google issue reports this breaking Workers deployments: [google-cloud-node#7684](https://github.com/googleapis/google-cloud-node/issues/7684). |
| `https` / `http` | gaxios top-level `require("https")`, used by `node-fetch` | Provided (Workers implements `node:http` as a wrapper over `fetch` — [Cloudflare docs](https://developers.cloudflare.com/workers/runtime-apis/nodejs/http/)). |
| `child_process` | `googleauth.js` requires it at module load | Stub; loading is fine, calling is not. |

`nodejs_compat` is required regardless: the package imports `crypto`, `stream`, `querystring`, and `https` at module scope.

### The `crypto.createSign` question

**It does not affect the OAuth2 authorization-code/token path.** In `oauth2client.js`, the only crypto calls are `randomBytesBase64` and `sha256DigestBase64` (PKCE), plus `verify` for ID-token signature checking. `NodeCrypto.sign()` — the only method that calls `crypto.createSign` — is reached from `GoogleAuth.sign()` and the JWT/service-account paths (`jwtclient`, `jwtaccess` via `jws`), not from `getToken` or `refreshAccessToken`.

Source: [`crypto/node/crypto.js`](https://unpkg.com/google-auth-library@11.3.2/build/src/crypto/node/crypto.js) — `sign()` uses `crypto.createSign('RSA-SHA256')`; `oauth2client.js` never calls it.

The gap is also **fixed upstream**:

- [workerd#3603](https://github.com/cloudflare/workerd/pull/3603) implemented `createSign` / `createVerify` / `crypto.sign` / `crypto.verify`; merged 2025-02-28.
- [workerd#3172](https://github.com/cloudflare/workerd/issues/3172) was closed 2025-03-12 with the note that `createSign` is implemented (RSA supported; RSA-PSS and DSA are not).
- Wrangler `4.4.0` enabled the native `node:crypto` APIs via `@cloudflare/unenv-preset@2.3.0` ([wrangler CHANGELOG](https://github.com/cloudflare/workers-sdk/blob/main/packages/wrangler/CHANGELOG.md)).
- Cloudflare's current docs state that all `node:crypto` APIs are supported except `generateKeyPair`/`generateKeyPairSync` for DSA/DH, `argon2`, `randomUUIDv7`, and ed448/x448 ([Cloudflare docs](https://developers.cloudflare.com/workers/runtime-apis/nodejs/crypto/)).

So the historical "`[unenv] crypto.createSign is not implemented yet`" error is stale on current Wrangler; it was never on the OAuth2 token path anyway.

### Rotated refresh tokens: **discarded**

Two code paths overwrite the server's new refresh token with the old one:

```js
// refreshAccessTokenAsync()
const r = await this.refreshToken(this.credentials.refresh_token);
const tokens = r.tokens;
tokens.refresh_token = this.credentials.refresh_token; // <-- old token wins
this.credentials = tokens;
```

```js
// getRequestHeaders() (automatic refresh on 401)
tokens.refresh_token = credentials.refresh_token; // <-- same overwrite
```

Source: [`oauth2client.js`](https://unpkg.com/google-auth-library@11.3.2/build/src/auth/oauth2client.js) (`refreshAccessTokenAsync`, `getRequestHeaders`).

Verified empirically: the mock token endpoint returned `refresh_token: "ROTATED_RT"`, and after `refreshAccessToken()` both `returnedRefreshToken` and `storedRefreshToken` were `"OLD_RT"`.

Whether Google actually rotates is client-type dependent and was **not verified** here; the library drops the new token either way. For Microsoft, which rotates on every refresh, this behaviour is fatal.

## 2. `@googleapis/calendar`

Version tested: `@googleapis/calendar@20.1.0` ([npm](https://www.npmjs.com/package/@googleapis/calendar/v/20.1.0)).

### Can it be used with an externally supplied access token, without `google-auth-library`?

**Not without bundling `google-auth-library`.** The package depends on `googleapis-common@^9`, which statically requires `google-auth-library` in both `index.js` and `authplus.js`:

- [`googleapis-common/index.js`](https://unpkg.com/googleapis-common@9.3.1/build/src/index.js): `exports.googleAuthLibrary = require("google-auth-library")`
- [`googleapis-common/authplus.js`](https://unpkg.com/googleapis-common@9.3.1/build/src/authplus.js): `require("google-auth-library")`

A metafile check of a bundle that only imports `calendar` and never references auth still contained **45 `google-auth-library` files**. The library is in the bundle whether or not you use it.

### Passing a token

A plain string is **not** a bearer token. In [`apirequest.ts`](https://github.com/googleapis/google-api-nodejs-client/blob/main/packages/googleapis-common/src/apirequest.ts):

```ts
// if authClient is actually a string, use it as an API KEY
if (typeof authClient === 'string') {
  params.key = params.key || authClient;
  authClient = undefined;
}
```

So `calendar({ auth: 'ya29...' })` sends `?key=ya29...`, not `Authorization: Bearer`.

Two workable forms:

1. **Per-request headers** (verified): `events.list({ calendarId: 'primary', headers: { Authorization: 'Bearer ...' } })`. The mock received `Authorization: Bearer EXTERNAL`.
2. **An auth object** with `setCredentials` (e.g. `OAuth2Client`) — this drags in the gaxios problem described above unless it has `fetchImplementation`.

### Response parsing

With the default gaxios transport, `res.data` came back as a **string**, not an object, for the same node-fetch header-loss reason. With `globalThis.window = globalThis` set before the first call, `res.data` was a parsed object (verified).

### Size

Bundled with esbuild 0.25.0, minified, ESM, Node builtins external:

| Bundle | Raw | Gzip |
|---|---|---|
| `@googleapis/calendar` + deps (with or without an auth object) | 380,735 B | **111.1 KB** |
| `google-auth-library` alone (`OAuth2Client` entry point) | 295,535 B | 88.4 KB |

## 3. `@azure/identity`

Version tested: `@azure/identity@4.14.1` ([npm](https://www.npmjs.com/package/@azure/identity/v/4.14.1)).

### Workers support is explicit

The package ships a dedicated `workerd` export condition:

```json
"exports": {
  ".": {
    "import":  "./dist/esm/index.js",
    "browser": "./dist/browser/index.js",
    "require": "./dist/commonjs/index.js",
    "workerd": "./dist/workerd/index.js"
  }
}
```

Added in `4.9.0` ([CHANGELOG](https://github.com/Azure/azure-sdk-for-js/blob/main/sdk/identity/identity/CHANGELOG.md), [PR #32422](https://github.com/Azure/azure-sdk-for-js/pull/32422)).

Wrangler's default build conditions are `["workerd", "worker", "browser"]` ([wrangler source, `getBuildConditions`](https://github.com/cloudflare/workers-sdk/blob/main/packages/wrangler/src/deployment-bundle/bundle.ts)). A metafile check with exactly those conditions resolved **45 files from `dist/workerd/` and 0 from `dist/browser/`**, so Wrangler does get the workerd build.

> Note: the `exports` object lists `browser` before `workerd`. Azure has a merged fix for that ordering ([PR #39087](https://github.com/Azure/azure-sdk-for-js/pull/39087)), but as of `4.14.1` the published order is still `import, browser, require, workerd`. esbuild (which Wrangler uses) still selected `workerd`, verified above. A Node-based resolver would select `browser`.

### Which credentials work

Verified in `workerd`:

| Credential | Result |
|---|---|
| `ClientSecretCredential` | `getToken()` returned `{ token, expiresOnTimestamp, tokenType }`. |
| `AuthorizationCodeCredential` | `getToken()` returned a token; a second call returned the cached token. |

Not usable on Workers (they shell out to local tooling): `AzureCliCredential`, `AzureDeveloperCliCredential`, `AzurePowerShellCredential`, and the interactive/broker credentials. They are exported by the workerd build, but their `processUtils` path calls `@azure/core-process` / `execFile`.

### Does it depend on `msal-node` and Node crypto?

Yes. `dist/workerd/msal/msal.js` is:

```js
export { AuthError, LogLevel } from "@azure/msal-node";
```

`@azure/msal-node@7.1.2` imports `crypto`, `node:crypto`, `fs`, `path`, `http`, and `jsonwebtoken` ([source](https://www.npmjs.com/package/@azure/msal-node/v/7.1.2)). `jsonwebtoken` is used for client assertions/certificates. `fs`/`path` are only touched by the optional cache-persistence plugin, but they are still imported, so `nodejs_compat` is mandatory.

### Rotated refresh tokens: preserved in MSAL's cache, but not exposed

MSAL does store a server-returned refresh token and overwrite the cached one:

- [`ResponseHandler.mjs`](https://unpkg.com/@azure/msal-common@16.15.0/dist/response/ResponseHandler.mjs) writes `serverTokenResponse.refresh_token` into the cache record.
- [`CacheManager.mjs`](https://unpkg.com/@azure/msal-common@16.15.0/dist/cache/CacheManager.mjs) persists `cacheRecord.refreshToken`.

But:

1. `TokenCredential.getToken()` returns only `{ token, expiresOnTimestamp, tokenType }` — no refresh token.
2. The cache is `NodeStorage`'s in-memory `this.cache = {}` ([`NodeStorage.mjs`](https://unpkg.com/@azure/msal-node@7.1.2/dist/cache/NodeStorage.mjs)); persistence requires a cache plugin, which is not available in a Worker.
3. A Worker isolate is not durable, so the cached refresh token is lost between requests.

Net effect: `@azure/identity` can mint tokens from a **client secret** on Workers, but it cannot own a long-lived user refresh cycle there. The authorization code is single-use, and after the first exchange the only thing that could refresh is the hidden, non-persistent MSAL cache.

### Size

| Bundle | Raw | Gzip |
|---|---|---|
| `@azure/identity` workerd build (ClientSecret + AuthorizationCode) | 368,664 B | **106.0 KB** |

## 4. Microsoft Graph: `@microsoft/msgraph-sdk`, `-notes`, Kiota

Versions: `@microsoft/msgraph-sdk@1.0.0-preview.92`, `@microsoft/msgraph-sdk-core@1.0.0-preview.17`, `@microsoft/kiota-http-fetchlibrary@1.0.0-preview.111`, `@microsoft/kiota-authentication-azure@1.0.0-preview.111`.

### `@microsoft/msgraph-sdk-notes` does not exist

`https://registry.npmjs.org/@microsoft/msgraph-sdk-notes/latest` returns **404**, as do `@microsoft/msgraph-sdk-onenote` and `@microsoft/msgraph-sdk-me`. A registry search of all `@microsoft/msgraph-sdk*` packages (69 published, including `-core`) contains no OneNote or `me` segment package.

The main `@microsoft/msgraph-sdk` package is a **proxifier shell**: `createGraphServiceClient()` creates metadata objects that are empty until a segment package calls `extendGraphServiceClient`. Its `graphServiceClient.d.ts` has no navigation properties, and the tarball contains **zero** files with "onenote" in the path. OneNote types exist only as models (`OnenoteNotebook`, `OnenoteSection`, … in `models/index.d.ts`), with no request builders.

Consequence: with this SDK, OneNote calls must be built manually as `RequestInformation` (e.g. `GET /me/onenote/notebooks`) and sent through the adapter — or use the older fetch-based `@microsoft/microsoft-graph-client`. There is no `client.me.onenote...` fluent surface.

### Custom `AuthenticationProvider`: works

The interface is a single method ([`authenticationProvider.ts`](https://github.com/microsoft/kiota-typescript/blob/main/packages/abstractions/src/authentication/authenticationProvider.ts)):

```ts
export interface AuthenticationProvider {
  authenticateRequest: (
    request: RequestInformation,
    additionalAuthenticationContext?: Record<string, unknown>
  ) => Promise<void>;
}
```

`FetchRequestAdapter` takes it as its first constructor argument ([`fetchRequestAdapter.ts`](https://github.com/microsoft/kiota-typescript/blob/main/packages/http/fetch/src/fetchRequestAdapter.ts)):

```ts
constructor(authenticationProvider, parseNodeFactory, serializationWriterFactory, httpClient, ...)
```

Verified in `workerd`: a custom provider set the `Authorization` header, `createGraphServiceClient(adapter)` succeeded, and `adapter.sendNoResponseContent(info, undefined)` completed a request. No Node APIs are involved.

Caveat: Kiota's `Headers.set(name, value)` spreads the value, so pass a string to `tryAdd`/`add` rather than `set` when setting a bearer header (observed: `set('Authorization', 'Bearer X')` stored individual characters).

### Is `@microsoft/kiota-http-fetchlibrary` required?

Yes, unless you implement your own `RequestAdapter`. `@microsoft/msgraph-sdk` exports the client factory, `extendGraphServiceClient`, and `GraphRequestAdapter`, and depends on `@microsoft/msgraph-sdk-core`; the fetch adapter (and its `HttpClient`) comes from `@microsoft/kiota-http-fetchlibrary`. `@microsoft/kiota-bundle` is a convenience aggregate that includes it plus the serializers.

### `@microsoft/kiota-authentication-azure`

A thin adapter over `BaseBearerTokenAuthenticationProvider`; it accepts any `@azure/core-auth` `TokenCredential` and calls `getToken`. It imports only `@microsoft/kiota-abstractions` and `@opentelemetry/api` — no MSAL, no Node builtins ([source](https://unpkg.com/@microsoft/kiota-authentication-azure@1.0.0-preview.111/dist/es/src/azureIdentityAccessTokenProvider.js)). It works on Workers, but it inherits `@azure/identity`'s refresh-token limitation.

### Size

| Bundle | Raw | Gzip |
|---|---|---|
| `@microsoft/msgraph-sdk` + `kiota-http-fetchlibrary` + custom provider (tree-shaken, no models) | 94,908 B | **24.0 KB** |
| `@microsoft/msgraph-sdk-core` alone | 104,761 B | 25.4 KB |
| `@microsoft/kiota-http-fetchlibrary` alone | 73,463 B | 19.7 KB |
| `@microsoft/kiota-authentication-azure` alone | 32,248 B | 10.3 KB |

Install footprint is a separate issue: the `@microsoft/msgraph-sdk` tarball unpacks to **24.5 MB**, almost entirely `models/index.js`. Tree-shaking keeps the Worker bundle small, but install/build time and editor tooling pay for it.

## 5. Refresh-token rotation summary

| Library | Rotated refresh token | Evidence |
|---|---|---|
| `google-auth-library` `OAuth2Client` | **Discarded** — overwritten with the old token | Source (`refreshAccessTokenAsync`, `getRequestHeaders`) + harness: server sent `ROTATED_RT`, stored value stayed `OLD_RT`. |
| `@googleapis/calendar` | Same as whichever auth client you pass; it has no refresh logic of its own | `googleapis-common` delegates to the auth client's `request()`. |
| `@azure/identity` | **Kept in MSAL's in-memory cache**, not exposed to the caller, lost across isolates | `msal-common` `ResponseHandler` / `CacheManager`; `NodeStorage.cache = {}`. |
| `@microsoft/msgraph-sdk` / Kiota | N/A — no refresh logic; the `AuthenticationProvider` supplies tokens | Kiota only calls `authenticateRequest`. |
| `arctic` (baseline) | **Returned to the caller** | Harness: both Google and Microsoft providers returned `refreshToken() === "ROTATED_RT"`. |

## Recommendation

**Keep `arctic` (or a ~100-line fetch client) for the OAuth token endpoint on both providers.** The official SDKs are usable for *API calls*, but neither is a good fit for *token lifecycle* on a stateless Worker:

1. **Microsoft makes this non-negotiable.** Microsoft's token responses can carry a new refresh token, and its docs require the client to discard the old one and keep the new one ([Microsoft identity platform docs](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow), quoting RFC 6749 §6). `@azure/identity` never returns it and cannot persist MSAL's cache in a Worker, so a user's refresh cycle dies with the isolate. `google-auth-library` would overwrite the new token with the old one. `arctic` returns whatever the server sent, so the gateway can store it in KV/D1.
2. **Google's OAuth path needs shims.** `google-auth-library` works only with `transporterOptions.fetchImplementation: fetch` or `globalThis.window = globalThis`. Without one of those, `getToken` silently returns a string and `refreshAccessToken` throws. That is a fragile foundation for the core auth flow.
3. **`@googleapis/calendar` cannot shed `google-auth-library`.** It is a hard transitive dependency (~88 KB gzip of the ~111 KB bundle), and a string `auth` is an API key. Use it only if you value the generated types; otherwise the Calendar REST API is a handful of `fetch` calls.
4. **The Graph SDK is fine as a transport**, but only if you accept building OneNote requests manually (no `-notes` package) and supply your own `AuthenticationProvider`. `@microsoft/kiota-http-fetchlibrary` is required for the adapter.

Suggested split:

| Concern | Use |
|---|---|
| Google + Microsoft authorization URL, code exchange, refresh, rotation | `arctic` (verified on workerd, 4.9 KB gzip for both providers) |
| Google Calendar reads/writes | Plain `fetch` to `https://www.googleapis.com/calendar/v3/...`, or `@googleapis/calendar` with `globalThis.window = globalThis` if you want the types |
| OneNote reads/writes | Plain `fetch` to `https://graph.microsoft.com/v1.0/me/onenote/...`, or Kiota with a custom `AuthenticationProvider` |

If you want to keep a vendor SDK for Google OAuth anyway, the only configuration that worked was:

```ts
new OAuth2Client({ clientId, clientSecret, redirectUri,
  transporterOptions: { fetchImplementation: fetch } });
```

…and you must accept that a rotated Google refresh token will be dropped.

## What I could not verify

- **No production Cloudflare deploy.** All runtime claims come from `workerd 1.20261103.1` locally. The same engine runs production Workers, but the deployed runtime version and Wrangler's bundling should be confirmed once.
- **No live Google or Microsoft token endpoints.** The harness used a mock origin that returns realistic token JSON (and a real origin only for the node-fetch header test). Endpoint-specific behavior (error shapes, `invalid_grant`, consent details) is untested.
- **Google's rotation policy.** I verified that the library *drops* a rotated token, not whether Google actually rotates for this client type.
- **Whether Wrangler's `node-fetch` handling matches my esbuild setup.** I used esbuild with Wrangler's documented conditions; a real `wrangler deploy` should be run to confirm the header-loss symptom.
- **`@azure/identity` interactive/device-code credentials** on Workers (they need a browser or local server).
- **MSAL cache serialization** as a workaround (`getTokenCache().serialize()`), which would require storing the blob yourself; not tested and not exposed by `@azure/identity`.
- **`@microsoft/microsoft-graph-client`** (the older fetch-based SDK) as a OneNote alternative; not evaluated.

### Deploy checklist

1. `wrangler deploy` a trivial Worker importing `google-auth-library`; confirm module init does not trip `google-logging-utils` (`getColorDepth`).
2. Call `getToken` against the real Google token endpoint with and without `fetchImplementation`; confirm the string-vs-object behavior.
3. Call `ClientSecretCredential.getToken` against real Entra ID.
4. Issue a Graph request through Kiota with a custom provider.
5. Confirm the rotated-refresh-token behavior against a real Microsoft refresh (the mock already proves the SDK-level behavior, but confirm the server does rotate).

## Appendix: how the runtime claims were tested

Harness (outside the repo, in `/tmp`):

- `workerd@1.20261103.1`, `compatibilityDate = "2026-11-01"`, `compatibilityFlags = ["nodejs_compat"]`.
- Two services: `main` (the test worker) and `mock` (a fetch handler returning token JSON), wired with `globalOutbound = "mock"`.
- Bundle: esbuild 0.25.0, `--format=esm --platform=neutral --main-fields=main,module --conditions=workerd,worker`, Node builtins external, plus a `createRequire` banner to satisfy google-auth-library's CommonJS `require("child_process")`.
- One separate run without `globalOutbound` to test `node-fetch` against `jsonplaceholder.typicode.com`.

Versions: `google-auth-library@11.3.2`, `@googleapis/calendar@20.1.0`, `googleapis-common@9.3.1`, `gaxios@8.3.2`, `@azure/identity@4.14.1`, `@azure/msal-node@7.1.2`, `@microsoft/msgraph-sdk@1.0.0-preview.92`, `@microsoft/kiota-http-fetchlibrary@1.0.0-preview.111`, `@microsoft/kiota-authentication-azure@1.0.0-preview.111`, `arctic@3.7.0`.

Observed results (abridged):

```json
{
  "generateAuthUrl": { "ok": true },
  "getToken_defaultTransporter": { "ok": true, "value": { "tokens": "<raw string>" } },
  "refresh_rotated_defaultTransporter": { "ok": false, "error": "TypeError: Cannot create property 'refresh_token' on string ..." },
  "getToken_fetchImpl": { "ok": true, "value": { "tokens": { "access_token": "CODE_ACCESS" } } },
  "refresh_rotated_fetchImpl": { "ok": true, "value": { "returnedRefreshToken": "OLD_RT", "storedRefreshToken": "OLD_RT" } },
  "window_shim_calendar": { "ok": true, "value": { "type": "object" } },
  "azure_getToken": { "ok": true, "value": { "token": "CODE_ACCESS", "tokenType": "Bearer" } },
  "kiota_custom_provider": { "ok": true, "value": { "hasClient": true } },
  "arctic_google_refresh": { "ok": true, "value": { "refresh": "ROTATED_RT" } },
  "arctic_ms_refresh": { "ok": true, "value": { "refresh": "ROTATED_RT" } }
}
```
