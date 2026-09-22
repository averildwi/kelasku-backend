import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';

@Injectable()
export class HashingService {
  hash(plainText: string): string {
    const salt = randomBytes(16).toString('hex');
    const derivedKey = scryptSync(plainText, salt, 64).toString('hex');
    return `${salt}:${derivedKey}`;
  }

  verify(plainText: string, storedHash: string): boolean {
    const [salt, storedDerivedKey] = storedHash.split(':');
    if (!salt || !storedDerivedKey) return false;

    try {
      const derivedKey = scryptSync(plainText, salt, 64);
      const storedKeyBuffer = Buffer.from(storedDerivedKey, 'hex');
      return timingSafeEqual(derivedKey, storedKeyBuffer);
    } catch {
      return false;
    }
  }
}
