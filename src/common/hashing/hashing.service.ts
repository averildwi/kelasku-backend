import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';

// Promisified so hashing never blocks the event loop (the sync variant would).
function scryptAsync(
  plainText: string,
  salt: string,
  keylen: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(plainText, salt, keylen, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}

@Injectable()
export class HashingService {
  async hash(plainText: string): Promise<string> {
    const salt = randomBytes(16).toString('hex');
    const derivedKey = await scryptAsync(plainText, salt, 64);
    return `${salt}:${derivedKey.toString('hex')}`;
  }

  async verify(plainText: string, storedHash: string): Promise<boolean> {
    const [salt, storedDerivedKey] = storedHash.split(':');
    if (!salt || !storedDerivedKey) return false;

    try {
      const derivedKey = await scryptAsync(plainText, salt, 64);
      const storedKeyBuffer = Buffer.from(storedDerivedKey, 'hex');
      return timingSafeEqual(derivedKey, storedKeyBuffer);
    } catch {
      // A malformed hash (wrong length, bad hex, bcrypt) is just a failed match.
      return false;
    }
  }
}
