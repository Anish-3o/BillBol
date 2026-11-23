import type { IncomingMessage, ServerResponse } from 'node:http';
import { createApp } from './app';
import { connectDBOnce } from './config/db';

// Entry point when the API runs as a Vercel serverless function (see /api/index.ts and
// /vercel.json). Locally and in Docker, src/server.ts starts a normal server instead.
// The app is built once per function instance, not per request.
const app = createApp();

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    await connectDBOnce();
  } catch (err) {
    console.error('❌ MongoDB connection failed:', err);
    // Same JSON shape as the error handler, so the client shows a normal error message.
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: { message: 'Server is busy, please try again in a moment' } }));
    return;
  }
  app(req, res);
}
