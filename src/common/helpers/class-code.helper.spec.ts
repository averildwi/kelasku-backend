import {
  CLASS_CODE_ALPHABET,
  CLASS_CODE_LENGTH,
  generateClassCode,
} from './class-code.helper';

describe('generateClassCode', () => {
  it('returns a code with the configured length', () => {
    expect(generateClassCode()).toHaveLength(CLASS_CODE_LENGTH);
  });

  it('only uses characters from the unambiguous alphabet', () => {
    for (let run = 0; run < 200; run += 1) {
      for (const character of generateClassCode()) {
        expect(CLASS_CODE_ALPHABET).toContain(character);
      }
    }
  });

  it('never emits the ambiguous characters I, O, 0 or 1', () => {
    for (let run = 0; run < 200; run += 1) {
      expect(generateClassCode()).toMatch(
        /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/,
      );
    }
  });
});
