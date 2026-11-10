import { baseEnvSchema } from '../common/config/base-env.schema';
import { projectEnvSchema } from './env.schema';

// Same schema AppConfigModule.forProject(projectEnvSchema) validates at boot.
const schema = baseEnvSchema.concat(projectEnvSchema);

const valid = {
  DATABASE_URL: 'postgresql://localhost/db',
  JWT_SECRET: 'x'.repeat(32),
  RESEND_API_KEY: 're_123',
  MAIL_FROM: 'App <no-reply@example.com>',
  CLOUDINARY_URL: 'cloudinary://key:secret@cloud',
  FIREBASE_PROJECT_ID: 'kelasku-test',
  FIREBASE_CLIENT_EMAIL: 'firebase@kelasku-test.iam.gserviceaccount.com',
  FIREBASE_PRIVATE_KEY:
    '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----',
};

describe('env schema', () => {
  it('accepts a complete environment', () => {
    expect(schema.validate(valid).error).toBeUndefined();
  });

  it.each([
    'JWT_SECRET',
    'RESEND_API_KEY',
    'MAIL_FROM',
    'CLOUDINARY_URL',
    'FIREBASE_PROJECT_ID',
    'FIREBASE_CLIENT_EMAIL',
    'FIREBASE_PRIVATE_KEY',
  ])('fails boot without %s while the feature is on', (key) => {
    const env: Record<string, string> = { ...valid };
    delete env[key];
    expect(schema.validate(env).error?.message).toContain(key);
  });

  it('does not require the resend credentials when OTP_SENDER=console', () => {
    const env = {
      ...valid,
      OTP_SENDER: 'console',
      RESEND_API_KEY: '',
      MAIL_FROM: '',
    };
    expect(schema.validate(env).error).toBeUndefined();
  });

  it('rejects a short JWT_SECRET', () => {
    expect(
      schema.validate({ ...valid, JWT_SECRET: 'secret' }).error,
    ).toBeDefined();
  });

  it('rejects an OTP_TTL_MINUTES outside 1..60', () => {
    expect(
      schema.validate({ ...valid, OTP_TTL_MINUTES: 120 }).error,
    ).toBeDefined();
  });
});
