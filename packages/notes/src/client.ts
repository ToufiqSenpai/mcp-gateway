import type { McpContext } from "@mcp-gateway/common"
import { HttpMethod, RequestInformation } from "@microsoft/kiota-abstractions"
import type { AuthenticationProvider, Parsable, ParsableFactory } from "@microsoft/kiota-abstractions"
import { GraphRequestAdapter, createGraphServiceClient } from "@microsoft/msgraph-sdk"
import type { Notebook, OnenotePage, OnenoteSection } from "@microsoft/msgraph-sdk/models"
// Registers `me` on the client: the SDK reaches OneNote through /users/{id}/onenote and only
// this import adds `me` (rewritten from /users/TokenToReplace by the Graph URL replacer).
import "@microsoft/msgraph-sdk-users"
import {
  createNotebookCollectionResponseFromDiscriminatorValue,
  createOnenotePageCollectionResponseFromDiscriminatorValue,
  createOnenotePageFromDiscriminatorValue,
  createOnenoteSectionCollectionResponseFromDiscriminatorValue
} from "@microsoft/msgraph-sdk/models"

import { NOTEBOOK_SELECT, PAGE_SELECT, SECTION_SELECT } from "./map"

export const GRAPH_BASE_URL = "https://graph.microsoft.com/v1.0"

/** Graph's maximum page size for OneNote collections. */
const GRAPH_PAGE_SIZE = 100
/** How many items one tool call will gather before reporting `truncated`. */
const FETCH_CAP = 1000

export class GraphError extends Error {
  public constructor(
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(message)
    this.name = "GraphError"
  }
}

export interface Collected<T> {
  items: T[]
  truncated: boolean
}

/** Mirrors Graph's `patchContentCommand`; sent as-is to the documented PATCH endpoint. */
export interface PatchContentCommand {
  target: string
  action: "replace" | "append" | "prepend" | "insert" | "delete"
  content?: string
  position?: "after" | "before"
}

interface GraphFailure {
  responseStatusCode?: number
  message?: string
  errorEscaped?: { code?: string; message?: string }
}

function toGraphError(failure: GraphFailure): GraphError {
  return new GraphError(
    failure.responseStatusCode ?? 500,
    failure.errorEscaped?.code ?? "unknown",
    failure.errorEscaped?.message ?? failure.message ?? "Graph request failed"
  )
}

/**
 * The SDK calls this per request. `Headers` is a Map<string, Set<string>>, so `add` is the
 * only correct way to set one header value; `set("Authorization", "Bearer …")` would spread
 * the string into single characters.
 */
class TokenAuthenticationProvider implements AuthenticationProvider {
  private token?: string

  public constructor(
    private readonly ctx: McpContext,
    private readonly slug: string
  ) {}

  public async authenticateRequest(request: RequestInformation): Promise<void> {
    this.token ??= await this.ctx.getAccessToken(this.slug)
    request.headers.add("Authorization", `Bearer ${this.token}`)
  }

  public async refresh(): Promise<void> {
    this.token = await this.ctx.refreshAccessToken(this.slug)
  }
}

export class GraphClient {
  private readonly auth: TokenAuthenticationProvider
  private readonly adapter: GraphRequestAdapter
  private readonly client: ReturnType<typeof createGraphServiceClient>

  public constructor(ctx: McpContext, slug: string, baseUrl: string = GRAPH_BASE_URL) {
    this.auth = new TokenAuthenticationProvider(ctx, slug)
    this.adapter = new GraphRequestAdapter(this.auth)
    this.adapter.baseUrl = baseUrl
    this.client = createGraphServiceClient(this.adapter)
  }

  /** Runs one SDK call, rotating the token once after a Provider 401. */
  private async run<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call()
    } catch (error) {
      // SAFETY: kiota throws its deserialized ODataError, which carries these fields.
      const failure = error as GraphFailure
      if (failure.responseStatusCode !== 401) throw toGraphError(failure)
      await this.auth.refresh()
      try {
        return await call()
      } catch (retryError) {
        // SAFETY: same ODataError shape as the first attempt.
        throw toGraphError(retryError as GraphFailure)
      }
    }
  }

  /** Follows `odataNextLink` to the cap; next links never reach the callers. */
  private async collect<T extends Parsable, P extends Parsable & { value?: T[] | null; odataNextLink?: string | null }>(
    first: () => Promise<P | undefined>,
    deserializer: ParsableFactory<P>
  ): Promise<Collected<T>> {
    const items: T[] = []
    let page = await this.run(first)

    while (true) {
      items.push(...(page?.value ?? []))
      const next = page?.odataNextLink
      if (!next || items.length >= FETCH_CAP) break
      const link = new RequestInformation(HttpMethod.GET, next)
      page = await this.run(() => this.adapter.send(link, deserializer, undefined))
    }

    return { items: items.slice(0, FETCH_CAP), truncated: items.length >= FETCH_CAP }
  }

  public notebooks(): Promise<Collected<Notebook>> {
    return this.collect(
      () =>
        this.client.me.onenote.notebooks.get({
          queryParameters: { select: NOTEBOOK_SELECT, top: GRAPH_PAGE_SIZE }
        }),
      createNotebookCollectionResponseFromDiscriminatorValue
    )
  }

  public sections(parent: { notebookId?: string; sectionGroupId?: string }): Promise<Collected<OnenoteSection>> {
    const notebookId = parent.notebookId
    const sectionGroupId = parent.sectionGroupId
    const queryParameters = {
      select: SECTION_SELECT,
      expand: ["parentNotebook", "parentSectionGroup"],
      top: GRAPH_PAGE_SIZE
    }

    const load = notebookId
      ? () => this.client.me.onenote.notebooks.byNotebookId(notebookId).sections.get({ queryParameters })
      : sectionGroupId
        ? () => this.client.me.onenote.sectionGroups.bySectionGroupId(sectionGroupId).sections.get({ queryParameters })
        : () => this.client.me.onenote.sections.get({ queryParameters })

    return this.collect(load, createOnenoteSectionCollectionResponseFromDiscriminatorValue)
  }

  public pages(sectionId?: string): Promise<Collected<OnenotePage>> {
    const queryParameters = { select: PAGE_SELECT, expand: ["parentSection"], top: GRAPH_PAGE_SIZE }
    const load = sectionId
      ? () => this.client.me.onenote.sections.byOnenoteSectionId(sectionId).pages.get({ queryParameters })
      : () => this.client.me.onenote.pages.get({ queryParameters })

    return this.collect(load, createOnenotePageCollectionResponseFromDiscriminatorValue)
  }

  public notebook(id: string): Promise<Notebook | undefined> {
    return this.run(() =>
      this.client.me.onenote.notebooks.byNotebookId(id).get({
        queryParameters: { select: NOTEBOOK_SELECT, expand: ["sections", "sectionGroups"] }
      })
    )
  }

  public page(id: string): Promise<OnenotePage | undefined> {
    return this.run(() =>
      this.client.me.onenote.pages
        .byOnenotePageId(id)
        .get({ queryParameters: { select: PAGE_SELECT, expand: ["parentSection"] } })
    )
  }

  public section(id: string): Promise<OnenoteSection | undefined> {
    return this.run(() =>
      this.client.me.onenote.sections
        .byOnenoteSectionId(id)
        .get({ queryParameters: { select: SECTION_SELECT, expand: ["parentNotebook", "parentSectionGroup"] } })
    )
  }

  public async pageContent(id: string, includeIds = false): Promise<string> {
    const request = this.client.me.onenote.pages.byOnenotePageId(id).content.toGetRequestInformation()
    // The generated media builder types no query parameters, so the documented flag goes on the URL.
    if (includeIds) request.URL += "?includeIDs=true"

    // SAFETY: the "ArrayBuffer" response type selects the ArrayBuffer branch of sendPrimitive.
    const bytes = (await this.run(() => this.adapter.sendPrimitive(request, "ArrayBuffer", undefined))) as
      | ArrayBuffer
      | undefined
    return new TextDecoder().decode(bytes)
  }

  public createPage(sectionId: string, html: string): Promise<OnenotePage | undefined> {
    // shortcut: the generated builder types this POST as JSON, but OneNote creates a page
    // from a text/html document. Upgrade when the SDK models the body content type.
    const request = this.client.me.onenote.sections.byOnenoteSectionId(sectionId).pages.toPostRequestInformation({})
    request.headers.delete("Content-Type")
    request.setStreamContent(new TextEncoder().encode(html).buffer, "text/html; charset=utf-8")
    return this.run(() => this.adapter.send(request, createOnenotePageFromDiscriminatorValue, undefined))
  }

  public async updatePage(id: string, commands: readonly PatchContentCommand[]): Promise<void> {
    // shortcut: the fluent API only exposes the undocumented onenotePatchContent action, so
    // the documented PATCH .../content is sent through the adapter with the same command list.
    const request = this.client.me.onenote.pages.byOnenotePageId(id).content.toGetRequestInformation()
    request.httpMethod = HttpMethod.PATCH
    request.setStreamContent(new TextEncoder().encode(JSON.stringify(commands)).buffer, "application/json")
    await this.run(() => this.adapter.sendNoResponseContent(request, undefined))
  }

  public async deletePage(id: string): Promise<void> {
    await this.run(() => this.client.me.onenote.pages.byOnenotePageId(id).delete())
  }

  public createNotebook(displayName: string): Promise<Notebook | undefined> {
    return this.run(() => this.client.me.onenote.notebooks.post({ displayName }))
  }

  public createSection(
    parent: { notebookId?: string; sectionGroupId?: string },
    displayName: string
  ): Promise<OnenoteSection | undefined> {
    const notebookId = parent.notebookId
    const sectionGroupId = parent.sectionGroupId
    const call = notebookId
      ? () => this.client.me.onenote.notebooks.byNotebookId(notebookId).sections.post({ displayName })
      : () => this.client.me.onenote.sectionGroups.bySectionGroupId(sectionGroupId ?? "").sections.post({ displayName })
    return this.run(call)
  }
}
