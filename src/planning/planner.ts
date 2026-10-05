/**
 * Planner facade: produces the concept and script, using the LLM when available
 * and falling back to the deterministic planner on any failure.
 */
import { errorMessage } from '../core/errors';
import type { Logger } from '../core/logger';
import type { PlannedScene, VideoBrief, VideoConcept } from '../core/types';
import type { LLMProvider } from '../llm/types';
import type { TemplateDefinition } from '../templates/types';
import { llmConcept, llmScript } from './llm-planner';
import { proceduralConcept, proceduralScript } from './procedural';
import type { SceneSlot } from './slots';

export interface PlannerResult<T> {
  value: T;
  source: string;
  warning?: string;
}

export class Planner {
  constructor(
    private readonly llm: LLMProvider | null,
    private readonly logger: Logger,
  ) {}

  get source(): string {
    return this.llm ? `${this.llm.id}:${this.llm.model}` : 'procedural';
  }

  async concept(brief: VideoBrief, template: TemplateDefinition, signal?: AbortSignal): Promise<PlannerResult<VideoConcept>> {
    if (this.llm) {
      try {
        return { value: await llmConcept(this.llm, brief, template, signal), source: this.source };
      } catch (err) {
        if (signal?.aborted) throw err;
        const warning = `LLM concept failed, using procedural concept: ${errorMessage(err)}`;
        this.logger.warn(warning);
        return { value: proceduralConcept(brief, template), source: 'procedural', warning };
      }
    }
    return { value: proceduralConcept(brief, template), source: 'procedural' };
  }

  async script(brief: VideoBrief, template: TemplateDefinition, concept: VideoConcept, slots: SceneSlot[], signal?: AbortSignal): Promise<PlannerResult<PlannedScene[]>> {
    if (this.llm) {
      try {
        return { value: await llmScript(this.llm, brief, template, concept, slots, signal), source: this.source };
      } catch (err) {
        if (signal?.aborted) throw err;
        const warning = `LLM script failed, using procedural script: ${errorMessage(err)}`;
        this.logger.warn(warning);
        return { value: proceduralScript(brief, template, slots), source: 'procedural', warning };
      }
    }
    return { value: proceduralScript(brief, template, slots), source: 'procedural' };
  }
}
