import type { Request, Response } from 'express';
import { isClaudeConfigured } from '../ai/claude';
import { isSarvamConfigured } from '../ai/sarvam';
import { getAuth } from '../middleware/authenticate';
import { handleAssistantMessage, lookupCustomer } from '../services/assistant.service';
import type { AssistantCustomerInput, AssistantInput } from '../validators/assistant.validator';

export async function message(req: Request, res: Response): Promise<void> {
  res.json(await handleAssistantMessage(getAuth(req), req.body as AssistantInput));
}

// Lets the app show whether answers come from Claude or the offline brain, and whether to use
// Sarvam's natural voice or the browser's own speech.
export function status(_req: Request, res: Response): void {
  res.json({ aiEnabled: isClaudeConfigured(), voice: isSarvamConfigured() ? 'sarvam' : 'browser' });
}

// The answer to "Customer ka naam ya number?" -> the matching customer, if any.
export async function customer(req: Request, res: Response): Promise<void> {
  const { spoken } = req.body as AssistantCustomerInput;
  res.json(await lookupCustomer(getAuth(req).tenantId, spoken));
}
