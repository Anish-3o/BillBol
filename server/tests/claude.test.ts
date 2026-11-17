import { getClaude } from '../src/ai/claude';
import { AppError } from '../src/utils/AppError';

// The test setup leaves LLM_API_KEY empty, like a fresh install.
describe('getClaude', () => {
  it('refuses with a clear 503 when no API key is configured', () => {
    let error: unknown;
    try {
      getClaude();
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).statusCode).toBe(503);
    expect((error as AppError).message).toMatch(/LLM_API_KEY/);
  });
});
