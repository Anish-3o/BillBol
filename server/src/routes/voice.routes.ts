import express, { Router } from 'express';
import * as voiceController from '../controllers/voice.controller';
import { authenticate } from '../middleware/authenticate';
import { validate } from '../middleware/validate';
import { MAX_AUDIO_BYTES } from '../services/voice.service';
import { speakSchema } from '../validators/voice.validator';

export const voiceRouter = Router();

// Owners and staff both talk to Ramu at the counter. Login is required so strangers cannot
// spend the shop's voice credits.
voiceRouter.use(authenticate);

// The microphone recording as the raw body (audio/webm from the browser), read into a
// Buffer here only, so other routes keep their normal JSON body limit.
voiceRouter.post('/transcribe', express.raw({ type: 'audio/*', limit: MAX_AUDIO_BYTES }), voiceController.transcribe);
voiceRouter.post('/speak', validate(speakSchema), voiceController.speak);
