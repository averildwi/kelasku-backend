import 'dotenv/config';

// Test-only defaults for the feature secrets the local .env leaves blank.
// DATABASE_URL still comes from .env; JWT_SECRET falls back to a test value.
process.env.NODE_ENV = 'test';
// The base env schema rejects an empty FRONTEND_URL, so use a valid test origin.
process.env.FRONTEND_URL = 'http://localhost:3000';
process.env.JWT_SECRET ||= 'test-secret-test-secret-test-secret';
process.env.OTP_SENDER = 'resend';
process.env.RESEND_API_KEY ||= 'test-resend-key';
process.env.MAIL_FROM ||= 'KelasKu <no-reply@example.com>';
process.env.CLOUDINARY_URL ||= 'cloudinary://key:secret@cloud';
process.env.FIREBASE_PROJECT_ID ||= 'kelasku-test';
process.env.FIREBASE_CLIENT_EMAIL ||=
  'firebase@kelasku-test.iam.gserviceaccount.com';
process.env.FIREBASE_PRIVATE_KEY ||=
  '-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----';
