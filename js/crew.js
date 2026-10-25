// Équipe : personnages spécialisés qui remplacent la secrétaire par défaut.
// Chacun arrive avec son style (couleur, accessoires, entrée en scène), son métier, ses outils
// (appels de fonction, voir agents/tools.js) et un scénario fictif pour l'essayer sans données réelles.

const OFFRE = `Offre d'emploi — Développeur·se front-end (fictive)
Atelier Lumen, Lyon. CDI, temps plein, télétravail 2 jours par semaine.
Missions : développer le configurateur 3D de luminaires en ligne, maintenir le site vitrine, travailler avec les designers.
Profil recherché : au moins 3 ans d'expérience en JavaScript et React ; Three.js ou WebGL très apprécié ; sens du design ; anglais technique.
Salaire : 42 000 à 48 000 euros brut par an selon expérience. Prise de poste souhaitée : le 1er février.`;

const CV_LEA = `CV — Léa Martin (fictif)
Développeuse front-end, Lyon. Disponible sous 1 mois.
Expérience : 2021-2025, Studio Pixel (Lyon) : sites e-commerce en React et TypeScript, refonte du tunnel de paiement. 2019-2021, agence Nova : intégration HTML/CSS et JavaScript.
Compétences : React, TypeScript, Three.js (projet personnel : visite 3D d'appartement), Figma, anglais courant.
Formation : licence professionnelle Web, Lyon 1. Prétentions : 45 000 euros.`;

const CV_KARIM = `CV — Karim Benali (fictif)
Développeur full-stack, Grenoble. Disponible immédiatement.
Expérience : 2018-2025, Logistix : applications internes en Angular et Java, API REST, base de données PostgreSQL. 2016-2018, stage puis CDD en support technique.
Compétences : Angular, Java, Spring, SQL, un peu de React (formation en ligne en 2024), anglais intermédiaire.
Formation : DUT informatique. Prétentions : 50 000 euros.`;

const CV_SOFIA = `CV — Sofia Rossi (fictif)
Développeuse créative WebGL, Milan puis Lyon. Disponible dans 3 mois.
Expérience : 2022-2025, agence Lumina (Milan) : expériences 3D interactives en Three.js et React Three Fiber pour des marques de design. 2021-2022, freelance : animations web.
Compétences : Three.js, WebGL, GLSL, React, Blender, anglais et italien courants, français professionnel.
Formation : master design interactif, Politecnico di Milano. Prétentions : 44 000 euros.`;

const LETTRE_CLIENT = `Lettre reçue le 20 octobre — Mme Hélène Perrin, Annecy (fictive)
Objet : suspension Arc livrée cassée
Madame, Monsieur, j'ai reçu le 14 octobre la suspension Arc commandée sous la référence CMD-2291 (389 euros). Le verre est fendu sur toute la hauteur. Je souhaite un remplacement rapide, la pièce était prévue pour l'inauguration de mon restaurant le 8 novembre. Photos jointes. Cordialement, Hélène Perrin.`;

const LETTRE_URSSAF = `Courrier reçu le 21 octobre — Organisme de recouvrement (fictif)
Objet : demande de justificatifs
Dans le cadre d'un contrôle de routine, nous vous remercions de nous transmettre sous 30 jours calendaires à compter de la réception du présent courrier : les bulletins de paie de septembre, le registre du personnel et l'attestation d'assurance. À défaut, une relance avec pénalités pourra être adressée.`;

const LETTRE_FOURNISSEUR = `Lettre reçue le 22 octobre — Verrerie du Jura (fictive)
Objet : hausse de tarifs
Nous vous informons que nos tarifs augmenteront de 6 % à compter du 1er janvier, en raison du coût de l'énergie. Les commandes passées avant le 15 décembre resteront au tarif actuel. Votre interlocuteur reste M. Paul Girard.`;

const FRAIS_MARS = `Note de frais — Julien Faure, commercial, déplacement à Paris (fictive)
Train Lyon-Paris aller-retour en première classe : 212 euros (trajet de 2 h).
Hôtel 1 nuit : 145 euros.
Dîner client à 3 personnes : 126 euros.
Taxi gare - salon : 38 euros.
Achat d'un vidéoprojecteur pour le salon, sans accord préalable : 640 euros.
Déposée le 9 du mois suivant.`;

const FRAIS_LYON = `Note de frais — Amélie Roux, designer, rendez-vous fournisseur (fictive)
Déjeuner avec le fournisseur à 2 personnes : 64 euros.
Parking : 12 euros.
Échantillons de tissu : 86 euros.
Déposée le 3 du mois suivant.`;

const doc = (name, title, summary, concepts, text) => ({ name, text, sheet: { title, summary, points: [], concepts } });

export const CREW = [
    {
        id: "cubi",
        name: "Cubi",
        role: "Secrétaire",
        color: "#7cc6f2",
        accessories: [],
        entrance: "hop",
        pitch: "Votre secrétaire polyvalente : répond à partir de vos documents, trouve un passage, rédige.",
        useCases: [],
        agent: null,
        scenario: null,
    },
    {
        id: "rhea",
        name: "Rhéa",
        role: "Recrutement",
        color: "#b4a4f0",
        accessories: ["lunettes", "noeud"],
        entrance: "spin",
        pitch: "Chargée de recrutement : compare des CV à une offre, repère les écarts, prépare la présélection.",
        useCases: [
            "Présélectionner les candidats d'une offre",
            "Vérifier qu'un profil coche les critères obligatoires",
            "Calculer les années d'expérience et l'écart de salaire",
            "Rédiger une note de synthèse pour le manager",
        ],
        persona: "Tu t'appelles Rhéa. Tu es chargée de recrutement : rigoureuse, factuelle et bienveillante envers les candidats. Tu ne juges que les compétences et l'expérience, jamais l'âge, le genre ou l'origine.",
        agent: {
            instructions: "Pour comparer des candidats : appelle lister_documents, puis lire_document pour l'offre et pour chaque CV utile. Compare chaque profil aux critères de l'offre. Fais les calculs (années d'expérience, écart de salaire) avec calculer, jamais de tête. Si on te demande une note ou une synthèse, enregistre-la avec creer_note.",
            tools: ["lister_documents", "lire_document", "calculer", "creer_note"],
            maxSteps: 6,
            reasoning: false,
        },
        scenario: {
            label: "Une offre et 3 CV",
            story: "L'Atelier Lumen recrute un·e développeur·se front-end pour son configurateur 3D. Trois candidatures sont arrivées.",
            documents: [
                doc("Offre — Développeur front-end (fictive)", "Offre développeur front-end", "Poste React et Three.js à Lyon, 3 ans d'expérience, 42 à 48 k€.", ["recrutement", "offre d'emploi", "react", "three.js"], OFFRE),
                doc("CV — Léa Martin (fictif)", "CV Léa Martin", "Développeuse React et TypeScript depuis 2019, un projet Three.js.", ["candidat", "cv", "react", "typescript"], CV_LEA),
                doc("CV — Karim Benali (fictif)", "CV Karim Benali", "Développeur Angular et Java depuis 2016, React débutant.", ["candidat", "cv", "angular", "java"], CV_KARIM),
                doc("CV — Sofia Rossi (fictif)", "CV Sofia Rossi", "Développeuse créative Three.js et WebGL depuis 2021.", ["candidat", "cv", "three.js", "webgl"], CV_SOFIA),
            ],
            prompts: [
                "Quel CV recommandes-tu pour l'offre de développeur front-end ?",
                "Lis le CV de Karim Benali : coche-t-il les critères obligatoires de l'offre ?",
                "Rédige une note de présélection pour le manager avec les 3 candidats.",
            ],
        },
    },
    {
        id: "plume",
        name: "Plume",
        role: "Courrier",
        color: "#f6b48f",
        accessories: ["casque"],
        entrance: "drop",
        pitch: "Responsable du courrier : trie les lettres reçues, calcule les délais de réponse, prépare les réponses.",
        useCases: [
            "Trier le courrier du jour par urgence",
            "Calculer la date limite pour répondre",
            "Rédiger une réponse polie et précise",
            "Résumer une lettre longue en trois lignes",
        ],
        persona: "Tu t'appelles Plume. Tu gères le courrier de l'entreprise : organisée, attentive aux délais, tu écris des réponses courtoises et précises.",
        agent: {
            instructions: "Pour traiter le courrier : appelle lister_documents puis lire_document pour chaque lettre utile. Pour une échéance, récupère la date avec date_actuelle et calcule-la avec decaler_date, jamais de tête. Classe les lettres de la plus urgente à la moins urgente. Quand on te demande une réponse écrite, enregistre-la avec creer_note.",
            tools: ["lister_documents", "lire_document", "date_actuelle", "decaler_date", "creer_note"],
            maxSteps: 6,
            reasoning: false,
        },
        scenario: {
            label: "Le courrier du jour",
            story: "Trois lettres attendent sur le bureau : une cliente mécontente, un organisme qui réclame des pièces et un fournisseur qui augmente ses prix.",
            documents: [
                doc("Lettre — Mme Perrin, suspension cassée (fictive)", "Réclamation de Mme Perrin", "Suspension Arc livrée cassée, remplacement souhaité avant le 8 novembre.", ["réclamation", "client", "livraison", "remplacement"], LETTRE_CLIENT),
                doc("Courrier — demande de justificatifs (fictif)", "Demande de justificatifs", "Contrôle : pièces à fournir sous 30 jours calendaires.", ["contrôle", "administration", "justificatifs", "délai"], LETTRE_URSSAF),
                doc("Lettre — Verrerie du Jura, hausse de tarifs (fictive)", "Hausse de tarifs fournisseur", "Hausse de 6 % au 1er janvier, ancien tarif jusqu'au 15 décembre.", ["fournisseur", "tarifs", "achats"], LETTRE_FOURNISSEUR),
            ],
            prompts: [
                "Trie le courrier du jour du plus urgent au moins urgent.",
                "Avant quelle date dois-je envoyer les justificatifs demandés ?",
                "Rédige la réponse à Mme Perrin en lui proposant un remplacement.",
            ],
        },
    },
    {
        id: "abaque",
        name: "Abaque",
        role: "Notes de frais",
        color: "#7fd8b4",
        accessories: ["lunettes", "antenne"],
        entrance: "pop",
        pitch: "Contrôleur de gestion : vérifie les notes de frais ligne à ligne face à la politique interne, calculs à l'appui.",
        useCases: [
            "Contrôler une note de frais avant remboursement",
            "Calculer le montant remboursable et l'écart",
            "Repérer les dépenses qui demandent un accord",
            "Rédiger l'avis motivé pour le salarié",
        ],
        persona: "Tu t'appelles Abaque. Tu es contrôleur de gestion : précis, neutre, tu justifies chaque décision par une règle écrite et un calcul.",
        agent: {
            instructions: "Pour contrôler une note de frais : lis la note avec lire_document, cherche chaque règle applicable avec rechercher_documents dans le guide interne, fais tous les calculs avec calculer, jamais de tête. Pour chaque ligne, dis CONFORME ou NON CONFORME avec la règle et le montant de l'écart, puis le total remboursable. Si on te demande un avis, enregistre-le avec creer_note.",
            tools: ["lister_documents", "lire_document", "rechercher_documents", "calculer", "creer_note"],
            maxSteps: 7,
            reasoning: false,
        },
        scenario: {
            label: "Deux notes de frais et le guide interne",
            story: "Fin de mois : deux notes de frais à valider avant le virement, dont une qui sent le dépassement.",
            documents: [
                doc("Note de frais — Julien Faure (fictive)", "Note de frais Julien Faure", "Déplacement à Paris : train, hôtel, dîner client, vidéoprojecteur.", ["notes de frais", "dépenses", "déplacement"], FRAIS_MARS),
                doc("Note de frais — Amélie Roux (fictive)", "Note de frais Amélie Roux", "Rendez-vous fournisseur : déjeuner, parking, échantillons.", ["notes de frais", "dépenses", "fournisseur"], FRAIS_LYON),
            ],
            // Le guide interne (document d'exemple) contient la politique de frais.
            withSample: true,
            prompts: [
                "Contrôle la note de frais de Julien Faure ligne par ligne.",
                "Quel montant faut-il rembourser à Amélie Roux ?",
                "Rédige l'avis à envoyer à Julien Faure sur sa note de frais.",
            ],
        },
    },
];

export const findCrew = (id) => CREW.find((member) => member.id === id) ?? CREW[0];
