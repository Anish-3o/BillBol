import { keytermsFor, synthesize, transcribe, type VoiceLanguage } from '../ai/sarvam';
import { AppError } from '../utils/AppError';
import { loadCatalogue } from './voiceBill.service';

// 30 seconds of compressed speech is well under 1 MB; Sarvam's quick (synchronous) API is
// meant for clips under 30 seconds. Longer clips are rejected here, before they cost anything.
export const MAX_AUDIO_BYTES = 2 * 1024 * 1024;

export async function transcribeForShop(
  tenantId: string,
  audio: unknown,
  mimeType: string | undefined,
  language: VoiceLanguage,
): Promise<{ transcript: string }> {
  if (!Buffer.isBuffer(audio) || audio.length === 0) throw new AppError(400, 'No audio received');
  if (!mimeType?.startsWith('audio/')) throw new AppError(415, 'Send the recording as audio');
  // This shop's product names help the model hear brand names ("Aashirvaad", "Parachute").
  const catalogue = await loadCatalogue(tenantId);
  const keyterms = keytermsFor(catalogue.entries.map((e) => e.name));
  return { transcript: await transcribe({ audio, mimeType, language, keyterms }) };
}

export const speakText = (text: string, language: VoiceLanguage): Promise<Buffer> => synthesize(text, language);
