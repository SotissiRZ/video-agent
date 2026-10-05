/** Offline planner: builds concept and script from the template's copywriting rules. */
import type { PlannedScene, VideoBrief, VideoConcept } from '../core/types';
import type { CopyContext, TemplateDefinition } from '../templates/types';
import type { SceneSlot } from './slots';

export const copyContext = (brief: VideoBrief): CopyContext => ({
  lang: brief.language,
  brand: brief.brand,
  subject: brief.brand || brief.topic || (brief.language === 'fr' ? 'notre solution' : 'our solution'),
  audience: brief.audience,
  location: brief.location,
  locationPhrase: brief.locationPhrase,
  topic: brief.topic || brief.brand,
});

export const proceduralConcept = (brief: VideoBrief, template: TemplateDefinition): VideoConcept => template.concept(copyContext(brief));

export const proceduralScript = (brief: VideoBrief, template: TemplateDefinition, slots: SceneSlot[]): PlannedScene[] => {
  const ctx = copyContext(brief);
  const copy = template.copy(ctx);
  return slots.map((slot) => {
    const variants = copy[slot.role] ?? [];
    const c = variants.length ? variants[slot.repetition % variants.length]! : { headline: ctx.subject, narration: ctx.subject };
    return {
      role: slot.role,
      kind: slot.kind,
      headline: c.headline,
      subheadline: c.subheadline ?? '',
      body: c.body ?? '',
      items: c.items ?? [],
      statValue: c.stat?.value ?? '',
      statLabel: c.stat?.label ?? '',
      // Subjects such as "notre plateforme" can start a sentence.
      narration: c.narration.charAt(0).toUpperCase() + c.narration.slice(1),
      visualKeywords: [...(c.visualKeywords ?? []), slot.role, ...brief.keywords].filter(Boolean),
      visualPrompt: [brief.topic, c.headline.replace(/\*/g, ''), brief.audience, brief.location, 'cinematic photo, natural light'].filter(Boolean).join(', '),
      weight: slot.weight,
    };
  });
};
