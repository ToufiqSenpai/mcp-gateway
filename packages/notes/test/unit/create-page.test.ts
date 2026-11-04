import { describe, expect, it } from 'vitest';
import {
  assertDocumentSize,
  wrapDocument,
} from '../../src/tools/create-page';
import { capContent } from '../../src/tools/get-page';

describe('create_page document wrapping', () => {
  it('wraps the fragment as a full HTML document with an escaped title', () => {
    const document = wrapDocument('A & B <script>', '<p>hi</p>');
    expect(document).toBe(
      '<!DOCTYPE html><html><head><title>A &amp; B &lt;script&gt;</title></head><body><p>hi</p></body></html>',
    );
  });

  it('refuses a wrapped document over 4 MiB with data.maxBytes', () => {
    expect(() => assertDocumentSize('x'.repeat(4_194_304))).not.toThrow();
    expect(() => assertDocumentSize('x'.repeat(4_194_305))).toThrow(/4194304/);
    expect(() => assertDocumentSize('x'.repeat(4_194_305))).toThrow(/data\.maxBytes/);
  });
});

describe('get_page content cap', () => {
  it('leaves shorter content untouched', () => {
    expect(capContent('<p>short</p>')).toEqual({ content: '<p>short</p>', truncated: false });
  });

  it('cuts at the last complete tag boundary at or before 100 000 characters', () => {
    const html = `<p>${'a'.repeat(120_000)}</p><p>tail</p>`;
    const capped = capContent(html);
    expect(capped.truncated).toBe(true);
    expect(capped.content.endsWith('>')).toBe(true);
    expect(capped.content.length).toBeLessThanOrEqual(100_000);
  });
});
