import { randomInt } from 'node:crypto';

/**
 * BR-6: class join codes are 6 characters from an unambiguous alphabet.
 * I, O, 0 and 1 are excluded so a code read aloud or copied by hand cannot be
 * mistyped. Codes are globally unique across all classes and never released.
 */
export const CLASS_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const CLASS_CODE_LENGTH = 6;

/** Generates one candidate code. Uniqueness is retried by the caller (BR-6). */
export function generateClassCode(): string {
  let code = '';
  for (let position = 0; position < CLASS_CODE_LENGTH; position += 1) {
    code += CLASS_CODE_ALPHABET[randomInt(CLASS_CODE_ALPHABET.length)];
  }
  return code;
}
