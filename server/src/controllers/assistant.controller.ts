import type { Request, Response } from 'express';
import { isClaudeConfigured } from '../ai/claude';
import { getAuth } from '../middleware/authenticate';
import { handleAssistantMessage } from '../services/assistant.service';
import type { AssistantInput } from '../validators/assistant.validator';

export async function message(req: Request, res: Response): Promise<void> {
  res.json(await handleAssistantMessage(getAuth(req), req.body as AssistantInput));
}

// Lets the app show whether answers come from Claude or the offline brain.
export function status(_req: Request, res: Response): void {
  res.json({ aiEnabled: isClaudeConfigured() });
}
