import { normalize } from '../prompt/parser';
import { DEFAULT_TEMPLATE_ID, getTemplate, listTemplates } from './registry';
import type { TemplateDefinition } from './types';

export interface TemplateScore {
  id: string;
  score: number;
  matches: string[];
}

/** Score every template against the prompt. Multi-word keywords weigh more. */
export const scoreTemplates = (prompt: string): TemplateScore[] => {
  const text = ` ${normalize(prompt).replace(/[^a-z0-9:]+/g, ' ')} `;
  return listTemplates()
    .map((t) => {
      const matches = t.keywords.filter((k) => text.includes(` ${k} `));
      const score = matches.reduce((sum, k) => sum + (k.includes(' ') ? 2 : 1), 0);
      return { id: t.id, score, matches };
    })
    .sort((a, b) => b.score - a.score);
};

/**
 * Select the template: explicit choice > best keyword score > default.
 * Throws when an explicit template id is unknown.
 */
export const selectTemplate = (prompt: string, explicit?: string): { template: TemplateDefinition; reason: string } => {
  if (explicit && explicit !== 'auto') {
    const template = getTemplate(explicit);
    if (!template) {
      const ids = listTemplates().map((t) => t.id).join(', ');
      throw new Error(`Unknown template "${explicit}". Available: ${ids}`);
    }
    return { template, reason: 'explicitly requested' };
  }
  const [best] = scoreTemplates(prompt);
  if (best && best.score > 0) {
    return { template: getTemplate(best.id)!, reason: `matched: ${best.matches.join(', ')}` };
  }
  return { template: getTemplate(DEFAULT_TEMPLATE_ID)!, reason: 'default template' };
};
