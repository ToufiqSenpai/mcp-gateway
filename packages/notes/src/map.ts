export interface OneNoteLink {
  href?: string;
}

export interface RawLinks {
  oneNoteWebUrl?: OneNoteLink;
  oneNoteClientUrl?: OneNoteLink;
}

export interface GraphNotebook {
  id?: string;
  displayName?: string;
  isDefault?: boolean;
  createdDateTime?: string;
  lastModifiedDateTime?: string;
  links?: RawLinks;
}

export interface GraphSection {
  id?: string;
  displayName?: string;
  createdDateTime?: string;
  lastModifiedDateTime?: string;
  links?: RawLinks;
  parentNotebook?: { id?: string; displayName?: string };
  parentSectionGroup?: { id?: string; displayName?: string };
}

export interface GraphPage {
  id?: string;
  title?: string;
  createdDateTime?: string;
  lastModifiedDateTime?: string;
  links?: RawLinks;
  parentSection?: { id?: string; displayName?: string };
}

export interface Notebook {
  id?: string;
  displayName?: string;
  isDefault?: boolean;
  createdDateTime?: string;
  lastModifiedDateTime?: string;
  links: { oneNoteWebUrl?: string; oneNoteClientUrl?: string };
}

export interface Section {
  id?: string;
  displayName?: string;
  createdDateTime?: string;
  lastModifiedDateTime?: string;
  links: { oneNoteWebUrl?: string; oneNoteClientUrl?: string };
  parentNotebook?: { id?: string; displayName?: string };
  parentSectionGroup?: { id?: string; displayName?: string };
}

export interface Page {
  id?: string;
  title?: string;
  createdDateTime?: string;
  lastModifiedDateTime?: string;
  links: { oneNoteWebUrl?: string; oneNoteClientUrl?: string };
  parentSection?: { id?: string; displayName?: string };
}

function links(raw: RawLinks | undefined): {
  oneNoteWebUrl?: string;
  oneNoteClientUrl?: string;
} {
  return {
    ...(raw?.oneNoteWebUrl?.href ? { oneNoteWebUrl: raw.oneNoteWebUrl.href } : {}),
    ...(raw?.oneNoteClientUrl?.href ? { oneNoteClientUrl: raw.oneNoteClientUrl.href } : {}),
  };
}

function parent(value: { id?: string; displayName?: string } | undefined) {
  return value?.id ? { id: value.id, ...(value.displayName ? { displayName: value.displayName } : {}) } : undefined;
}

/** Drops `self`, url fields, ordering metadata and every other Graph-only member. */
export function toNotebook(raw: GraphNotebook): Notebook {
  return {
    ...(raw.id ? { id: raw.id } : {}),
    ...(raw.displayName ? { displayName: raw.displayName } : {}),
    ...(raw.isDefault !== undefined ? { isDefault: raw.isDefault } : {}),
    ...(raw.createdDateTime ? { createdDateTime: raw.createdDateTime } : {}),
    ...(raw.lastModifiedDateTime ? { lastModifiedDateTime: raw.lastModifiedDateTime } : {}),
    links: links(raw.links),
  };
}

export function toSection(raw: GraphSection): Section {
  return {
    ...(raw.id ? { id: raw.id } : {}),
    ...(raw.displayName ? { displayName: raw.displayName } : {}),
    ...(raw.createdDateTime ? { createdDateTime: raw.createdDateTime } : {}),
    ...(raw.lastModifiedDateTime ? { lastModifiedDateTime: raw.lastModifiedDateTime } : {}),
    links: links(raw.links),
    ...(parent(raw.parentNotebook) ? { parentNotebook: parent(raw.parentNotebook) } : {}),
    ...(parent(raw.parentSectionGroup)
      ? { parentSectionGroup: parent(raw.parentSectionGroup) }
      : {}),
  };
}

export function toPage(raw: GraphPage): Page {
  return {
    ...(raw.id ? { id: raw.id } : {}),
    ...(raw.title ? { title: raw.title } : {}),
    ...(raw.createdDateTime ? { createdDateTime: raw.createdDateTime } : {}),
    ...(raw.lastModifiedDateTime ? { lastModifiedDateTime: raw.lastModifiedDateTime } : {}),
    links: links(raw.links),
    ...(parent(raw.parentSection) ? { parentSection: parent(raw.parentSection) } : {}),
  };
}

export const NOTEBOOK_SELECT =
  'id,displayName,isDefault,createdDateTime,lastModifiedDateTime,links';
export const SECTION_SELECT =
  'id,displayName,createdDateTime,lastModifiedDateTime,links,parentNotebook,parentSectionGroup';
export const PAGE_SELECT =
  'id,title,createdDateTime,lastModifiedDateTime,links,parentSection';
