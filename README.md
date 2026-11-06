# Web-Agentic-Model

Une secrétaire IA qui tourne **entièrement dans le navigateur** : le modèle de langage s'exécute sur votre machine, vos documents ne la quittent jamais.

- **Avec une carte graphique (WebGPU)** : Ternary-Bonsai-2-2B (PrismML), 429 Mo, inclus dans le dépôt (`model/`).
- **Sans carte graphique** : bascule automatique sur Qwen3.5-0.8B sur le processeur (llama.cpp en WebAssembly via wllama). 533 Mo téléchargés une fois depuis Hugging Face puis gardés en cache. Plus lent.

## Lancer en local

Il faut un serveur web : ouvrir `index.html` directement depuis le disque ne marche pas.

```bash
npm run serve        # http://localhost:8000
# ou, sans Node :
python3 -m http.server 8000
```

Navigateur conseillé : Chrome ou Edge récents.

## Faire tester par d'autres

- **En ligne (le plus simple)** : activez GitHub Pages sur ce dépôt (Settings → Pages → branche `main`, dossier `/`). Le site sera à `https://ggoutard.github.io/Web-Agentic-Model/`. Chacun fait tourner le modèle sur sa propre machine.
- **Depuis votre machine** : il faut une adresse en **HTTPS**, par exemple un tunnel (`npx localtunnel --port 8000` ou `cloudflared tunnel --url http://localhost:8000`). Une simple adresse réseau `http://192.168.x.x:8000` ne suffit pas : hors `localhost`, le navigateur y bloque WebGPU, le cache du modèle et d'autres fonctions dont l'application a besoin.

## À essayer

Ouvrez **Changer de personnage** (icône en haut à droite) :

| Personnage | Métier | Scénario fictif |
|---|---|---|
| Cubi | secrétaire polyvalente | guide interne d'une entreprise (bouton « Charger le document d'exemple ») |
| Clause | contrats | 2 contrats : « Quand dois-je résilier, et que se passe-t-il si je rate la date ? » |
| Plume | courrier | 3 lettres : tri par urgence, échéances, réponse |
| Centime | notes de frais | 2 notes de frais et la politique interne : contrôle ligne à ligne |

Chaque personnage appelle lui-même ses outils (lire un document, calculer, dater, rédiger une note) : chaque appel apparaît comme une étape dans la conversation.

Le champ **Mission** du studio remplace toutes les consignes du modèle, comme le `SYSTEM` d'un Modelfile.

## Tests

```bash
npm test
```

## Structure

- `index.html`, `style.css`, `fonts/` : l'interface
- `js/` : l'application ; `js/engine.js` (carte graphique) et `js/engine_cpu.js` (processeur) chargent le modèle ; `js/crew.js` définit les personnages ; `js/agents/` contient les agents et leurs outils
- `js/vendor/` : bibliothèques embarquées (moteur Bonsai, wllama, Three.js, pdf.js, jsPDF)
- `model/` : le modèle Bonsai découpé en morceaux de 95 Mo (limite GitHub de 100 Mo par fichier)
- `api.html`, `sdk/cubi.js` : utiliser l'IA locale depuis une autre page

## Licences et mentions légales

- Code original : licence MIT (`LICENSE`).
- Conditions d'utilisation et limites de responsabilité du démonstrateur : `TERMS.md`.
- Modèle Ternary-Bonsai-2-2B de Prism ML (Apache 2.0, construit à partir de Qwen3.5-2B) : licence et notice dans `model/`. *Created using Bonsai by Prism ML.*
- Bibliothèques et polices tierces : `THIRD_PARTY_NOTICES.md`.
- Le modèle de secours (Qwen3.5-0.8B) est téléchargé depuis Hugging Face, qui reçoit l'adresse IP de l'utilisateur ; aucun document n'est transmis.
- Démonstration uniquement : ne pas utiliser pour décider du sort de personnes (recrutement, crédit…). Tous les documents d'exemple sont fictifs.
