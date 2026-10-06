# Contribuer à SOVID AI

Merci de votre intérêt ! Ce guide explique comment préparer l'environnement, les conventions du projet et la procédure de contribution.

## Mise en place

```bash
git clone https://github.com/SotissiRZ/video-agent.git
cd video-agent
npm ci
cp .env.example .env      # optionnel : aucune clé n'est nécessaire pour développer
npm run typecheck && npm test
```

Lancer sans compiler : `npm run dev -- "votre prompt" --no-render`.

## Organisation du code

Voir la section [Architecture](README.md#2-architecture) du README. Les règles importantes :

1. **`src/remotion/` doit rester compatible navigateur.** Ce code est bundlé par Remotion/webpack : aucun import de `node:*`, aucun accès disque. Le contrat partagé avec l'agent se trouve dans `src/remotion/contract/`.
2. **Le storyboard est le contrat.** Toute nouvelle fonctionnalité visuelle passe par le schéma zod (`contract/storyboard.ts`), avec des valeurs par défaut pour rester compatible avec les storyboards existants.
3. **Rendu déterministe.** Les animations utilisent `useCurrentFrame()`, `interpolate()` et `spring()`. Pas d'animations ni de transitions CSS, pas de `Math.random()` (utilisez `seeded()`), pas de `Date.now()` dans les compositions.
4. **Fournisseurs optionnels.** Une factory renvoie `null` si elle n'est pas configurée. Une erreur de fournisseur produit un avertissement et un repli, jamais un échec silencieux ni un plantage du rendu.
5. **Secrets.** Les clés viennent uniquement des variables d'environnement. Ne les journalisez jamais et ne les écrivez jamais sur disque (`describeSecrets()` n'expose que leur présence).
6. **Performance de rendu.** Évitez les `filter: blur()` sur de grandes surfaces, très coûteux en rendu logiciel ; préférez des dégradés radiaux.

## Conventions

- TypeScript strict (`noUncheckedIndexedAccess`). `npm run typecheck` doit passer.
- Modules ESM. Imports relatifs sans extension (résolution « bundler »).
- Messages utilisateur en français, code et commentaires en anglais.
- Pas de nouvelle dépendance sans justification. Les appels HTTP aux fournisseurs utilisent `fetch` via `src/providers/http.ts`. Seul Anthropic utilise le SDK officiel.

## Tests

- `npm test` : rapide, sans réseau ni navigateur. Les appels HTTP des fournisseurs et des plateformes sont simulés avec `tests/fetch-mock.ts` : vérifiez la séquence exacte des requêtes (URL, en-têtes, corps). Utilisez les doubles de `tests/helpers.ts` (`FakeLLM`, `fakeRenderer`, `testConfig`).
- `npm run test:render` : rendu Remotion réel, à lancer si vous touchez `src/remotion/` ou `src/render/`.
- Ajoutez un test pour chaque correction de bug et chaque nouveau template, provider ou type de scène.
- Avant de toucher au rendu, vérifiez visuellement : `npm run studio` ou `video-agent render`.

## Ajouter un template, un provider, un style, un type de scène

Voir les sections 9 et 10 du README. Une checklist :

- [ ] Code et enregistrement dans le registre
- [ ] Variables dans `config.ts` **et** `.env.example` (vérifié par les tests)
- [ ] Rédaction FR et EN pour un template (vérifiée par les tests)
- [ ] Tests
- [ ] Documentation (README)

## Proposer une modification

1. Créez une branche depuis `main` : `feat/…`, `fix/…`, `docs/…`.
2. Faites des commits atomiques avec des messages explicites, par exemple `feat(templates): add webinar template`.
3. Vérifiez que `npm run typecheck`, `npm test` et `npm run build` passent.
4. Ouvrez une pull request qui décrit le problème, la solution et la manière de tester. Joignez une capture ou une courte vidéo pour tout changement visuel.

## Signaler un bug

Indiquez votre OS, `node -v`, la sortie de `video-agent doctor`, la commande lancée, et le `job.json` et `storyboard.json` du job concerné. Ne joignez pas votre fichier `.env`.
