import { describe, expect, it } from 'vitest';
import { assertPublicUrl, chooseScreenScenes, contentRows, deviceFor, findUrls, isPrivateAddress, showScreen } from '../src/media/screenshots';
import { SceneSchema, type Scene } from '../src/remotion/contract/storyboard';

const scene = (over: Partial<Scene>): Scene => SceneSchema.parse({ id: 's', kind: 'text', role: 'point', durationInFrames: 150, ...over });

describe('web addresses in the request', () => {
  it('finds them in order, without duplicates or trailing punctuation', () => {
    expect(findUrls('Montre notre site https://zsr-technum.com, puis www.exemple.org/app. Et https://zsr-technum.com/ encore.')).toEqual([
      'https://zsr-technum.com/',
      'https://www.exemple.org/app',
    ]);
    expect(findUrls('Vidéo de 30 s pour Sirago')).toEqual([]);
    expect(findUrls('a https://a.com b https://b.com c https://c.com d https://d.com')).toHaveLength(3);
  });

  it('refuses addresses inside the server network', async () => {
    for (const ip of ['127.0.0.1', '10.0.0.5', '192.168.1.10', '172.20.0.1', '169.254.169.254', '100.64.0.1', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1']) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    for (const ip of ['8.8.8.8', '104.16.0.1', '2606:4700::1111']) expect(isPrivateAddress(ip), ip).toBe(false);
    await expect(assertPublicUrl('http://localhost:3210/admin')).rejects.toThrow();
    await expect(assertPublicUrl('http://169.254.169.254/latest/meta-data')).rejects.toThrow();
    await expect(assertPublicUrl('http://192.168.1.1/')).rejects.toThrow();
    await expect(assertPublicUrl('file:///etc/passwd')).rejects.toThrow();
    await expect(assertPublicUrl('https://user:pass@example.com/')).rejects.toThrow();
    await expect(assertPublicUrl('https://8.8.8.8/')).resolves.toBeInstanceOf(URL);
  });
});

describe('capture trimming', () => {
  it('finds where the content of a short page ends', () => {
    const width = 4;
    // 6 rows of content (varied), then 4 white rows.
    const rows = [[0, 50, 90, 200], [30, 30, 30, 30], [255, 0, 255, 0], [10, 10, 10, 10], [80, 80, 80, 80], [0, 0, 0, 0], ...Array.from({ length: 4 }, () => [255, 255, 255, 255])];
    expect(contentRows(Buffer.from(rows.flat()), width)).toEqual({ rows: 10, content: 6, blank: false });
    expect(contentRows(Buffer.alloc(40, 255), width).blank).toBe(true);
  });
});

describe('where the captures go', () => {
  const scenes = [
    scene({ kind: 'title', headline: 'ZSR-TechNum' }),
    scene({ kind: 'bullets', headline: 'Nos services', items: ['Design', 'IA'] }),
    scene({ kind: 'text', headline: 'Notre plateforme de billetterie', body: 'Réservez en ligne.' }),
    scene({ kind: 'text', headline: 'Découvrez zsr-technum.com' }),
    scene({ kind: 'cta', headline: 'Contactez-nous' }),
  ];

  it('prefers the scene naming the site, then a scene about a platform, never the title or the call to action', () => {
    expect(chooseScreenScenes(['https://www.zsr-technum.com/', 'https://billets.example.com/'], scenes, [])).toEqual([3, 2]);
    // Without a matching scene: a free middle scene that keeps its text.
    expect(chooseScreenScenes(['https://a.com/', 'https://b.com/', 'https://c.com/', 'https://d.com/'], scenes, [])).toEqual([2, 3, 1, -1]);
  });

  it('shows a phone in vertical videos unless the scene talks about a computer', () => {
    expect(deviceFor(scenes[2]!, true)).toBe('mobile');
    expect(deviceFor(scenes[2]!, false)).toBe('desktop');
    expect(deviceFor(scene({ headline: 'Votre tableau de bord' }), true)).toBe('desktop');
    expect(deviceFor(scene({ headline: 'Notre application mobile' }), false)).toBe('mobile');
  });

  it('turns the scene into a picture scene and keeps its text', () => {
    const media = { type: 'image' as const, src: 'screens/01-mobile.png', fit: 'cover' as const, origin: 'screen:mobile', screen: { device: 'mobile' as const, url: 'zsr-technum.com', aspect: 3 } };
    const shown = showScreen(scenes[1]!, media);
    expect(shown).toMatchObject({ kind: 'image', body: 'Design · IA', media });
    expect(SceneSchema.parse(shown).media?.screen?.aspect).toBe(3);
  });
});
