import { Transform } from 'class-transformer';

/**
 * Reads a boolean from a query string without the `enableImplicitConversion`
 * trap, where `"false"` is already converted to `true` before validators run.
 * `obj[key]` is the raw value, so `"false"` stays `false`; anything else is
 * left for `@IsBoolean()` to reject.
 */
export function ToBoolean(): PropertyDecorator {
  return Transform(
    ({ obj, key }: { obj: Record<string, unknown>; key: string }) => {
      const raw = obj[key];
      if (raw === 'true' || raw === true) return true;
      if (raw === 'false' || raw === false) return false;
      return raw;
    },
  );
}
