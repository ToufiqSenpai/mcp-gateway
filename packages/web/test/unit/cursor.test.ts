import { describe, expect, it } from 'vitest';
import { InvalidCursorError, createCursorCodec } from '../../src/mcps/pagination';

const codec = createCursorCodec({ CURSOR_SIGNING_KEY: 'test-cursor-signing-key' } as never);
const accounts = [{ slug: 'personal' }, { slug: 'work' }];

describe('signed cursors', () => {
  it('round-trips a payload bound to the Account set', async () => {
    const set = await codec.accountSet(accounts);
    const cursor = await codec.encode({ o: 100, a: set });
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    await expect(codec.decode(cursor, set)).resolves.toEqual({ o: 100, a: set });
  });

  it('keeps the Provider-side position out of plain sight', async () => {
    const set = await codec.accountSet(accounts);
    const cursor = await codec.encode({ o: 100, a: set });
    expect(cursor).not.toContain('100');
  });

  it('rejects a tampered signature', async () => {
    const set = await codec.accountSet(accounts);
    const cursor = await codec.encode({ o: 0, a: set });
    const [body, signature] = cursor.split('.');
    const flipped = (signature?.[0] === 'A' ? 'B' : 'A') + (signature?.slice(1) ?? '');
    await expect(codec.decode(`${body}.${flipped}`, set)).rejects.toThrow(InvalidCursorError);
    await expect(codec.decode(`${body}`, set)).rejects.toThrow(InvalidCursorError);
  });

  it('rejects a cursor issued under a different Account set', async () => {
    const before = await codec.accountSet(accounts);
    const cursor = await codec.encode({ o: 0, a: before });
    const after = await codec.accountSet([{ slug: 'personal' }]);
    await expect(codec.decode(cursor, after)).rejects.toThrow(InvalidCursorError);
  });

  it('rejects a body that is not the signed JSON', async () => {
    const set = await codec.accountSet(accounts);
    const cursor = await codec.encode({ o: 0, a: set });
    const signature = cursor.split('.')[1] ?? '';
    const forged = btoa('{"o":999,"a":"' + set + '"}')
      .replaceAll('+', '-')
      .replaceAll('/', '_')
      .replace(/=+$/, '');
    await expect(codec.decode(`${forged}.${signature}`, set)).rejects.toThrow(InvalidCursorError);
  });
});
