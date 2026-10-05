import type { z } from 'zod';
import { errorMessage } from '../core/errors';
import type { LLMProvider, LLMRequest } from './types';

/** Extract the first JSON object from a model response (handles ```json fences and chatter). */
export const extractJson = (text: string): unknown => {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidate = fenced ? fenced[1]! : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('no JSON object found in the response');
  return JSON.parse(candidate.slice(start, end + 1));
};

/**
 * Ask for JSON and validate it with zod. On a parse/validation error, the error is
 * sent back to the model once so it can correct itself.
 */
export const generateJson = async <T extends z.ZodTypeAny>(
  llm: LLMProvider,
  request: LLMRequest,
  schema: T,
  attempts = 2,
): Promise<z.infer<T>> => {
  const messages = [...request.messages];
  let lastError = '';
  for (let attempt = 0; attempt < attempts; attempt++) {
    const response = await llm.generate({ ...request, messages });
    try {
      const parsed = schema.safeParse(extractJson(response.text));
      if (parsed.success) return parsed.data;
      lastError = parsed.error.issues.slice(0, 8).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    } catch (err) {
      lastError = errorMessage(err);
    }
    messages.push(
      { role: 'assistant', content: response.text },
      { role: 'user', content: `Your answer was not valid (${lastError}). Reply again with ONLY the corrected JSON object.` },
    );
  }
  throw new Error(`invalid JSON from ${llm.id}: ${lastError}`);
};
