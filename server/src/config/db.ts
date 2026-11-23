import mongoose from 'mongoose';
import { env } from './env';

export async function connectDB(): Promise<void> {
  mongoose.set('strictQuery', true);
  await mongoose.connect(env.MONGO_URI);
  console.log('✅ MongoDB connected');
}

export async function disconnectDB(): Promise<void> {
  await mongoose.disconnect();
}

// Serverless (Vercel): there is no long-running process that connects once at startup.
// A function instance stays warm between requests, so the connection is opened on the first
// request and the same promise is reused by every request after it, including requests that
// arrive while the first connect is still in progress. Without this, each request would open
// a new connection and quickly use up the free MongoDB Atlas tier's connection limit.
let connecting: Promise<unknown> | null = null;

export async function connectDBOnce(): Promise<void> {
  if (!connecting) {
    mongoose.set('strictQuery', true);
    connecting = mongoose
      .connect(env.MONGO_URI, {
        // Fail fast with a clear error instead of hanging the request for 30 s.
        serverSelectionTimeoutMS: 5000,
        // One instance handles a few requests at a time; a small pool keeps the total
        // across many warm instances well under Atlas's limit.
        maxPoolSize: 5,
      })
      .catch((err: unknown) => {
        // Forget the failed attempt so the next request tries again.
        connecting = null;
        throw err;
      });
  }
  await connecting;
}
