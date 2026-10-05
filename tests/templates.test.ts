import { describe, expect, it } from 'vitest';
import { getTemplate, listTemplates, registerTemplate } from '../src/templates/registry';
import { scoreTemplates, selectTemplate } from '../src/templates/selector';
import type { CopyContext, TemplateDefinition } from '../src/templates/types';

describe('template registry & selection', () => {
  it('ships the 7 required templates', () => {
    expect(listTemplates().map((t) => t.id).sort()).toEqual(
      ['advertisement', 'announcement', 'app-demo', 'product-presentation', 'social-media', 'storytelling', 'tutorial'].sort(),
    );
  });

  it.each([
    ['Crée une vidéo pour promouvoir Sirago', 'advertisement'],
    ['Tutoriel : comment installer notre logiciel étape par étape', 'tutorial'],
    ["Annonce de l'ouverture de notre boutique", 'announcement'],
    ["Démo de notre application mobile de livraison", 'app-demo'],
    ['Raconte l’histoire et le parcours d’une agricultrice', 'storytelling'],
    ['Un reel Instagram viral', 'social-media'],
    ['Présentation produit de notre nouvelle gamme', 'product-presentation'],
    ['Explain how to set up the router step by step', 'tutorial'],
  ])('"%s" → %s', (prompt, expected) => {
    expect(selectTemplate(prompt).template.id).toBe(expected);
  });

  it('honours an explicit template and rejects unknown ones', () => {
    expect(selectTemplate('promouvoir Sirago', 'storytelling').template.id).toBe('storytelling');
    expect(() => selectTemplate('x', 'nope')).toThrow(/Unknown template/);
  });

  it('falls back to the default template', () => {
    const r = selectTemplate('quelque chose de vague');
    expect(r.template.id).toBe('advertisement');
    expect(r.reason).toBe('default template');
  });

  it('scores multi-word keywords higher', () => {
    const scores = scoreTemplates('présentation produit');
    expect(scores[0]!.id).toBe('product-presentation');
  });

  it.each(listTemplates().map((t) => [t.id, t] as const))('template %s provides copy for every role in fr and en', (_id, template) => {
    for (const lang of ['fr', 'en'] as const) {
      const ctx: CopyContext = { lang, brand: 'Acme', subject: 'Acme', audience: 'artisans', location: 'Dakar', locationPhrase: 'à Dakar', topic: 'Acme' };
      const copy = template.copy(ctx);
      for (const scene of template.scenes) {
        expect(copy[scene.role], `${template.id}/${scene.role}/${lang}`).toBeDefined();
        expect(copy[scene.role]!.length).toBeGreaterThan(0);
        for (const c of copy[scene.role]!) {
          expect(c.headline.trim()).not.toBe('');
          expect(c.narration.trim()).not.toBe('');
          if (scene.kind === 'bullets' || scene.kind === 'steps') expect(c.items?.length).toBeGreaterThan(0);
        }
      }
      const concept = template.concept(ctx);
      expect(concept.title).toContain('Acme');
    }
  });

  it('lets third parties register templates', () => {
    const custom: TemplateDefinition = {
      ...getTemplate('announcement')!,
      id: 'webinar',
      name: 'Webinar',
      keywords: ['webinar', 'webinaire'],
    };
    registerTemplate(custom);
    expect(selectTemplate('Invitation à notre webinaire').template.id).toBe('webinar');
    expect(() => registerTemplate({ ...custom, id: 'empty', scenes: [] })).toThrow();
  });
});
