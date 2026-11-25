// Runs before each test file imports any app code (Jest "setupFiles"), so src/config/env.ts
// sees these values. dotenv never overrides variables that are already set, which means the
// developer's server/.env (and its real database and secrets) cannot leak into tests.
process.env.NODE_ENV = 'test';
process.env.MONGO_URI = process.env.MONGO_URI_TEST ?? 'mongodb://localhost:27017/billbol_test';
process.env.JWT_ACCESS_SECRET = 'test-access-secret-0123456789-abcdefghijklmnop';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-0123456789-abcdefghijklmnop';
// Tests must never call the real Claude API (cost, flakiness): an empty key means "not set up",
// and because the variable now exists, dotenv will not fill it from a developer's .env.
// Tests that exercise AI code mock it instead.
process.env.LLM_API_KEY = '';
// Same for Sarvam (voice): tests mock fetch instead of calling the real speech service.
process.env.SARVAM_API_KEY = '';
// No cron secret by default (the cron routes are then switched off); cron tests set one.
process.env.CRON_SECRET = '';
