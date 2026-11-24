import type { Request, Response } from 'express';
import { getAuth } from '../middleware/authenticate';
import { parseOrThrow } from '../middleware/validate';
import { speakText, transcribeForShop } from '../services/voice.service';
import { transcribeQuerySchema, type SpeakInput } from '../validators/voice.validator';

// The recording arrives as the raw request body (see voice.routes.ts), not as JSON.
export async function transcribe(req: Request, res: Response): Promise<void> {
  const { lang } = parseOrThrow(transcribeQuerySchema, req.query);
  res.json(await transcribeForShop(getAuth(req).tenantId, req.body, req.get('content-type'), lang));
}

export async function speak(req: Request, res: Response): Promise<void> {
  const { text, lang } = req.body as SpeakInput;
  const audio = await speakText(text, lang);
  // The same sentence ("Aur kuch?") is said again and again: let the browser keep it a day.
  res.set('Cache-Control', 'private, max-age=86400').type('audio/mpeg').send(audio);
}
