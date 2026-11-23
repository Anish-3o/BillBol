// Vercel turns each file in /api into a serverless function. This single function runs the
// whole Express API: vercel.json sends every /api/* request here, and Express routes it as
// usual because the original URL is kept. The real code lives in server/src/vercel.ts.
export { default } from '../server/src/vercel';
