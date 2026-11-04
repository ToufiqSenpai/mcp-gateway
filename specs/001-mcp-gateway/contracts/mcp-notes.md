# Contract: `notes` MCP

Provider: Microsoft Graph (OneNote), read-write, resources, no prompts. Endpoint `/mcps/notes`. Protocol `2026-07-28`, stateless, one server instance per request. Behaviour source: `docs/SPEC.md` §11, §13.

## Server facts

- Own `server/discover` and `serverInfo`; no gateway-wide discovery document.
- Capabilities: tools, resources (`resources: {}`), no prompts, no subscribe, no `listChanged`.
- `GET`/`DELETE` → `405`; unknown tool/resource → `-32602`; internal failure → `-32603`; tool failures → `isError: true`.

## Tools

Every tool accepts an optional `account` slug. Graph-native camelCase names; dates are the ISO 8601 strings Graph sends. All four list tools use the gateway cursor with page size 100.

| Tool | Graph call | readOnly | destructive | idempotent |
| --- | --- | --- | --- | --- |
| `list_notebooks` | `GET /me/onenote/notebooks` | ✓ | ✗ | ✓ |
| `list_sections` | `GET /me/onenote/sections` \| `/notebooks/{id}/sections` \| `/sectionGroups/{id}/sections` | ✓ | ✗ | ✓ |
| `list_pages` | `GET /me/onenote/pages` \| `/sections/{id}/pages` | ✓ | ✗ | ✓ |
| `get_page` | `GET /me/onenote/pages/{id}` + `/content` | ✓ | ✗ | ✓ |
| `search_pages` | pages list, filtered in the gateway | ✓ | ✗ | ✓ |
| `create_page` | `POST /me/onenote/sections/{id}/pages` | ✗ | ✗ | ✗ |
| `update_page` | `PATCH /me/onenote/pages/{id}/content` | ✗ | ✗ | ✗ |
| `delete_page` | `DELETE /me/onenote/pages/{id}` | ✗ | ✓ | ✓ |
| `create_section` | `POST /me/onenote/notebooks/{id}/sections` \| `/sectionGroups/{id}/sections` | ✗ | ✗ | ✗ |
| `create_notebook` | `POST /me/onenote/notebooks` | ✗ | ✗ | ✗ |
| `list_accounts` | gateway | ✓ | ✗ | ✓ |

Signatures:

```text
list_notebooks({ account?, cursor? }) -> { notebooks: Notebook[], nextCursor? }
list_sections({ account?, notebookId?, sectionGroupId?, cursor? }) -> { sections: Section[], nextCursor? }
list_pages({ account?, sectionId?, cursor? }) -> { pages: Page[], nextCursor? }
get_page({ account?, pageId, includeIds? = false }) -> PageContent
search_pages({ account?, query, sectionId?, cursor? }) -> { pages: Page[], nextCursor? }
create_page({ account?, sectionId, title, content }) -> Page
update_page({ account?, pageId, commands }) -> { pageId, updated: true }
delete_page({ account?, pageId }) -> { pageId, deleted: true }
create_section({ account?, displayName, notebookId?, sectionGroupId? }) -> Section
create_notebook({ account?, displayName }) -> Notebook
list_accounts() -> { accounts: [{ slug, isDefault }] }
```

Return shapes:

```text
Notebook { id, displayName, isDefault, createdDateTime, lastModifiedDateTime,
           links: { oneNoteWebUrl, oneNoteClientUrl } }
Section  { id, displayName, createdDateTime, lastModifiedDateTime,
           links: { oneNoteWebUrl, oneNoteClientUrl },
           parentNotebook: { id, displayName }, parentSectionGroup?: { id, displayName } }
Page     { id, title, createdDateTime, lastModifiedDateTime,
           links: { oneNoteWebUrl, oneNoteClientUrl },
           parentSection: { id, displayName } }
PageContent extends Page { content, contentLength, truncated }
```

Dropped fields: `self`, `createdByAppId`, `userRole`, `sectionsUrl`, `sectionGroupsUrl`, `pagesUrl`, `level`, `order`, `contentUrl`. Lists carry no `content`. Write tools normalise responses to the same shape with a follow-up `GET` when Graph omits a parent.

## Required behaviours

1. `list_sections` and `create_section` require exactly one of `notebookId` / `sectionGroupId`; neither or both → `-32602`.
2. `list_sections` with `notebookId` returns only sections directly in it; with neither parent, all sections including nested.
3. `list_pages` with no `sectionId` returns pages across all notebooks.
4. `search_pages.query` is non-empty; matching is case-insensitive substring on the page title only.
5. `create_page.content` is an HTML fragment wrapped as `<!DOCTYPE html><html><head><title>{escaped title}</title></head><body>{content}</body></html>` and sent as `text/html; charset=utf-8`; over 4 MB → `-32602` with `data.maxBytes: 4194304`.
6. `update_page.commands` is a non-empty array of Graph `patchContentCommand` (`{ target, action: replace|append|prepend|insert|delete, content?, position? }`); `content` required except for `delete`; `position` only with `append`/`insert`; `target` is `#<data-id>`, `body`, or `title`. Forwarded unchanged; Graph's `204` maps to `{ pageId, updated: true }`.
7. `get_page` returns HTML verbatim (no sanitising, no Markdown), capped at 100 000 characters cut at the last complete tag boundary at or before the cap; `contentLength` is the full length; `truncated` reports the cap. Resource URLs under `/me/onenote/resources/{id}/$value` are returned as-is, never proxied.

## Errors

| Condition | Surface |
| --- | --- |
| Graph 404 (`20102`, `20112`, `20113`) | `isError`, naming the id and Graph code |
| Graph 400 / 413 / 429 / 5xx | `isError`, pass-through `error.code` and `error.message` |
| Graph 401 / 403 | `isError`, pass-through; Account state untouched |
| Account unusable | `isError`, slug + admin URL |
| Bad arguments, cursor, parent params, size | `-32602` |

Error body is `{ error: { code, message, innerError } }` with a numeric-string `code` for OneNote and a named code for general throttling; parse defensively.

## Resources

- `resources/list`: one resource per notebook per usable Account. URI `notes://<account>/notebooks/<id>`.
- `resources/read`: one `text` item, `mimeType: application/json`, body `{ account, notebook, sections[], sectionGroups[], truncated }` from `GET /me/onenote/notebooks/{id}?$expand=sections,sectionGroups` — names and ids only, no recursion, no pages.
- Unknown/deleted notebook → `-32602` with `data.uri`; credential failure → `-32603` naming the Account.
- `resources/templates/list` → `[]`.

## Out of scope for this MCP

Section groups are not navigable (no `list_section_groups`, nothing addressed by path). No delete for notebooks/sections (Graph exposes no endpoint), no rename, no section-group creation, no body-text search, no whole-page replace, no image proxy.

## Caching

| Operation | `ttlMs` | `cacheScope` |
| --- | --- | --- |
| `server/discover`, `tools/list`, `resources/templates/list` | 3 600 000 | `public` |
| `resources/list` complete / partial | 300 000 / 0 | `private` |
| `resources/read` | 30 000 | `private` |

`tools/call` results are not cacheable; no HTTP caching headers.
