import mongoose from 'mongoose';
import { env } from '../../src/config/env';

// Jest runs test files in parallel worker processes. Each worker gets its own database
// (billbol_test_1, billbol_test_2, ...) so one file clearing data cannot break another.
const dbName = `billbol_test_${process.env.JEST_WORKER_ID ?? '1'}`;

// Last line of defence: never wipe a database that is not clearly a test database.
function assertTestDatabase(): void {
  if (!mongoose.connection.name?.startsWith('billbol_test')) {
    throw new Error(`Refusing to clear non-test database "${mongoose.connection.name}"`);
  }
}

export async function connectTestDB(): Promise<void> {
  try {
    await mongoose.connect(env.MONGO_URI, { dbName, serverSelectionTimeoutMS: 5000 });
  } catch (err) {
    throw new Error(
      `Could not connect to MongoDB for tests at ${env.MONGO_URI}. ` +
        `Is it running? Try "docker compose up -d". (${(err as Error).message})`,
    );
  }
  // Build the unique indexes now, so duplicate-key behaviour is real from the first test.
  await mongoose.connection.syncIndexes();
}

export async function clearTestDB(): Promise<void> {
  assertTestDatabase();
  await Promise.all(
    Object.values(mongoose.connection.collections).map((collection) => collection.deleteMany({})),
  );
}

export async function closeTestDB(): Promise<void> {
  assertTestDatabase();
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
}
