import * as Joi from 'joi';

/** Project env vars, concatenated onto baseEnvSchema by AppConfigModule.forProject(). */
export const projectEnvSchema = Joi.object({
  // 'console' prints codes to stdout for local work; it refuses to start in production.
  OTP_SENDER: Joi.string().valid('resend', 'console').default('resend'),
  RESEND_API_KEY: Joi.when('OTP_SENDER', {
    is: 'resend',
    then: Joi.string().required(),
    otherwise: Joi.string().allow('').optional(),
  }),
  MAIL_FROM: Joi.when('OTP_SENDER', {
    is: 'resend',
    then: Joi.string().required(),
    otherwise: Joi.string().allow('').optional(),
  }),
  OTP_TTL_MINUTES: Joi.number().integer().min(1).max(60).default(10),
  OTP_RESEND_COOLDOWN_SECONDS: Joi.number().integer().min(0).default(60),
  CLOUDINARY_URL: Joi.string().uri().required(),
  FIREBASE_PROJECT_ID: Joi.string().required(),
  FIREBASE_CLIENT_EMAIL: Joi.string().required(),
  FIREBASE_PRIVATE_KEY: Joi.string().required(),
  TZ: Joi.string().default('Asia/Jakarta'),
});
