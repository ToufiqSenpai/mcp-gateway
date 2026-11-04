import type {
  ExternalLink,
  Notebook as GraphNotebook,
  OnenotePage as GraphPage,
  OnenoteSection as GraphSection
} from "@microsoft/msgraph-sdk/models"

export interface RawLinks {
  oneNoteWebUrl?: ExternalLink | null
  oneNoteClientUrl?: ExternalLink | null
}

/** The tool-surface link pair; Graph's `self` and href wrappers are dropped. */
export interface Links {
  oneNoteWebUrl?: string
  oneNoteClientUrl?: string
}

export interface Parent {
  id?: string | null
  displayName?: string | null
}

export interface Notebook {
  id?: string
  displayName?: string
  isDefault?: boolean
  createdDateTime?: string
  lastModifiedDateTime?: string
  links: Links
}

export interface Section {
  id?: string
  displayName?: string
  createdDateTime?: string
  lastModifiedDateTime?: string
  links: Links
  parentNotebook?: Parent
  parentSectionGroup?: Parent
}

export interface Page {
  id?: string
  title?: string
  createdDateTime?: string
  lastModifiedDateTime?: string
  links: Links
  parentSection?: Parent
}

function links(raw: RawLinks | null | undefined): Links {
  const result: Links = {}
  if (raw?.oneNoteWebUrl?.href) result.oneNoteWebUrl = raw.oneNoteWebUrl.href
  if (raw?.oneNoteClientUrl?.href) result.oneNoteClientUrl = raw.oneNoteClientUrl.href
  return result
}

function parent(value: Parent | null | undefined): Parent | undefined {
  if (!value?.id) return undefined
  const result: Parent = { id: value.id }
  if (value.displayName) result.displayName = value.displayName
  return result
}

/** Drops `self`, url fields, ordering metadata and every other Graph-only member. */
export function toNotebook(raw: GraphNotebook): Notebook {
  const notebook: Notebook = { links: links(raw.links) }
  if (raw.id) notebook.id = raw.id
  if (raw.displayName) notebook.displayName = raw.displayName
  if (raw.isDefault !== undefined && raw.isDefault !== null) notebook.isDefault = raw.isDefault
  if (raw.createdDateTime) notebook.createdDateTime = raw.createdDateTime.toISOString()
  if (raw.lastModifiedDateTime) notebook.lastModifiedDateTime = raw.lastModifiedDateTime.toISOString()
  return notebook
}

export function toSection(raw: GraphSection): Section {
  const section: Section = { links: links(raw.links) }
  if (raw.id) section.id = raw.id
  if (raw.displayName) section.displayName = raw.displayName
  if (raw.createdDateTime) section.createdDateTime = raw.createdDateTime.toISOString()
  if (raw.lastModifiedDateTime) section.lastModifiedDateTime = raw.lastModifiedDateTime.toISOString()
  const parentNotebook = parent(raw.parentNotebook)
  if (parentNotebook) section.parentNotebook = parentNotebook
  const parentSectionGroup = parent(raw.parentSectionGroup)
  if (parentSectionGroup) section.parentSectionGroup = parentSectionGroup
  return section
}

export function toPage(raw: GraphPage): Page {
  const page: Page = { links: links(raw.links) }
  if (raw.id) page.id = raw.id
  if (raw.title) page.title = raw.title
  if (raw.createdDateTime) page.createdDateTime = raw.createdDateTime.toISOString()
  if (raw.lastModifiedDateTime) page.lastModifiedDateTime = raw.lastModifiedDateTime.toISOString()
  const parentSection = parent(raw.parentSection)
  if (parentSection) page.parentSection = parentSection
  return page
}

/**
 * Property lists the SDK sends as `$select` / `$expand`, kept next to the mappers that consume
 * them so a renamed property is a type error rather than an empty tool result.
 */
export const NOTEBOOK_SELECT = ["id", "displayName", "isDefault", "createdDateTime", "lastModifiedDateTime", "links"]
export const SECTION_SELECT = [
  "id",
  "displayName",
  "createdDateTime",
  "lastModifiedDateTime",
  "links",
  "parentNotebook",
  "parentSectionGroup"
]
export const PAGE_SELECT = ["id", "title", "createdDateTime", "lastModifiedDateTime", "links", "parentSection"]
