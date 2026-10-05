# Bibliothèque d'assets

Déposez ici vos fichiers. L'agent les sélectionne automatiquement selon les mots-clés de chaque scène.

| Emplacement | Usage |
| --- | --- |
| `logo.png`, `sirago-logo.svg`… | Logo de marque (nom contenant `logo`), utilisé si le nom correspond à la marque de la demande. |
| `images/*.jpg`, `*.png`, `*.webp` | Visuels de scène. Les mots du nom de fichier servent de tags (`taxi-ouagadougou.jpg` → `taxi`, `ouagadougou`). |
| `images/*.mp4`, `*.webm`, `*.mov` | Clips vidéo de scène. |
| `music/*.mp3`, `*.wav` | Musiques de fond (prioritaires sur la musique synthétisée quand `VIDEO_AGENT_MUSIC=auto`). |

Pour ajouter des tags, créez un `manifest.json` :

```json
[
  { "file": "images/chauffeur.jpg", "tags": ["driver", "chauffeur", "taxi", "moto"] },
  { "file": "logo.png", "type": "logo", "brand": "Sirago" }
]
```

Les fichiers de ce dossier (hors ce README) ne sont pas versionnés.
