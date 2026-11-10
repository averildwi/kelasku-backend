import { HashingService } from './hashing.service';

describe('HashingService', () => {
  const hashing = new HashingService();

  it('verifies the original text and rejects another one', async () => {
    const stored = await hashing.hash('correct horse');
    expect(stored).toMatch(/^[0-9a-f]{32}:[0-9a-f]{128}$/);
    await expect(hashing.verify('correct horse', stored)).resolves.toBe(true);
    await expect(hashing.verify('wrong horse', stored)).resolves.toBe(false);
  });

  it('salts every hash', async () => {
    expect(await hashing.hash('same')).not.toBe(await hashing.hash('same'));
  });

  it.each([
    ['no separator', 'abc'],
    ['empty salt', ':abcd'],
    ['short key', 'aa:bb'],
    [
      'bcrypt hash',
      '$2b$10$abcdefghijklmnopqrstuuJ1oY5i3H3uC1T3q0nqQf0n1g8b1Ue',
    ],
  ])(
    'returns false (does not throw) for a malformed hash: %s',
    async (_case, bad) => {
      await expect(hashing.verify('x', bad)).resolves.toBe(false);
    },
  );
});
