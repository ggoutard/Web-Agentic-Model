# Composants tiers

Le code original de ce dépôt est sous licence MIT (voir `LICENSE`). Les composants ci-dessous gardent leur propre licence.
Les conditions d'utilisation et de non-responsabilité du démonstrateur sont dans `TERMS.md`.

## Modèles

| Composant | Auteur | Licence | Emplacement |
|---|---|---|---|
| Ternary-Bonsai-2-2B (GGUF, PTQ1_0) | Prism ML, Inc., construit à partir de Qwen3.5-2B (Alibaba Cloud) | Apache 2.0 | `model/Ternary-Bonsai-2-2B-PTQ1_0/` (fichiers `LICENSE` et `NOTICE.txt` inclus) |
| Qwen3.5-0.8B (GGUF Q4_K_M, repli processeur) | Alibaba Cloud ; quantification Unsloth | Apache 2.0 | Non redistribué : téléchargé par le navigateur de l'utilisateur depuis `huggingface.co/unsloth/Qwen3.5-0.8B-GGUF` |

Created using Bonsai by Prism ML.

## Bibliothèques embarquées (`js/vendor/`)

| Composant | Version | Licence | Fichier de licence |
|---|---|---|---|
| three.js (+ RoundedBoxGeometry) | r170 | MIT | `js/vendor/THREE_LICENSE` |
| pdf.js (Mozilla Foundation) | 4.10.38 | Apache 2.0 | `js/vendor/pdfjs/LICENSE` |
| jsPDF | voir `jspdf.umd.min.js` | MIT | `js/vendor/jspdf/LICENSE` |
| wllama (Xuan Son Nguyen), contient llama.cpp compilé en WebAssembly | voir `wllama.wasm` | MIT | `js/vendor/wllama/LICENSE` |
| Inter (The Inter Project Authors) | — | SIL OFL 1.1 | `fonts/OFL.txt` |

## À clarifier : `js/vendor/qwen35-bonsai.js`

Moteur WebGPU extrait du Space Hugging Face `webml-community/ternary-bonsai-2-hermes-webgpu`.
**Ce Space ne déclare aucune licence** (ni champ `license:` dans son README, ni fichier `LICENSE`, vérifié le 6 novembre 2026).
Sans licence explicite, le droit d'auteur de ses auteurs s'applique par défaut. Le fichier est donc conservé ici dans l'attente
d'une confirmation de leur part (demande à envoyer aux auteurs du Space) ou de son remplacement par un moteur sous licence libre.
Ce fichier n'est pas couvert par la licence MIT du dépôt.
