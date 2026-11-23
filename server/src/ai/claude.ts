import Anthropic from '@anthropic-ai/sdk';
import { env } from '../config/env';
import { AppError } from '../utils/AppError';

// One place that knows which model we use and how the client is configured.
export const CLAUDE_MODEL = 'claude-opus-5-5';

let client: Anthropic | null = null;

// Lets callers choose the offline path up front instead of waiting for a 503.
export const isClaudeConfigured = (): boolean => Boolean(env.LLM_API_KEY);

// Created lazily, so the server starts (and tests run) without an API key.
// The key comes only from env (Rule 5); it is never sent to the browser.
export function getClaude(): Anthropic {
  if (!env.LLM_API_KEY) {
    throw new AppError(503, 'Voice billing is not set up yet: add LLM_API_KEY to server/.env');
  }
  client ??= new Anthropic({
    apiKey: env.LLM_API_KEY,
    // A customer is waiting at the counter: fail fast and let the shopkeeper type instead,
    // rather than the SDK's default 10-minute timeout with 2 retries.
    timeout: 20_000,
    maxRetries: 1,
  });
  return client;
}
