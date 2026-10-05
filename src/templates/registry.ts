import type { TemplateDefinition } from './types';
import { advertisement } from './builtin/advertisement';
import { announcement } from './builtin/announcement';
import { appDemo } from './builtin/app-demo';
import { productPresentation } from './builtin/product-presentation';
import { socialMedia } from './builtin/social-media';
import { storytelling } from './builtin/storytelling';
import { tutorial } from './builtin/tutorial';

const registry = new Map<string, TemplateDefinition>();

/** Register (or replace) a template. Third-party templates call this at startup. */
export const registerTemplate = (template: TemplateDefinition): void => {
  if (!template.scenes.length) throw new Error(`Template "${template.id}" has no scenes`);
  if (!template.scenes.some((s) => !s.optional)) throw new Error(`Template "${template.id}" needs at least one required scene`);
  registry.set(template.id, template);
};

export const getTemplate = (id: string): TemplateDefinition | undefined => registry.get(id);
export const listTemplates = (): TemplateDefinition[] => [...registry.values()];

export const DEFAULT_TEMPLATE_ID = 'advertisement';

[advertisement, productPresentation, tutorial, announcement, socialMedia, appDemo, storytelling].forEach(registerTemplate);
