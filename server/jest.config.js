/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  // Sets test env vars (separate database, test secrets) before any app code loads.
  setupFiles: ['<rootDir>/tests/setup/env.ts'],
  clearMocks: true,
  // Tests run against a real MongoDB. With many test files connecting and building indexes
  // in parallel, a beforeAll hook can exceed Jest's default 5 s on a busy machine.
  testTimeout: 20_000,
  // Every test file talks to the same single MongoDB. With one worker per CPU core, a 16-core
  // laptop runs ~15 files at once and the database (in Docker) becomes the bottleneck: setup
  // hooks time out at random. Four workers keep the run fast and the results stable.
  maxWorkers: 4,
};
