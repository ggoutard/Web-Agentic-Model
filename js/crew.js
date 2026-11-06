// Équipe : personnages spécialisés qui remplacent la secrétaire par défaut.
// Chacun arrive avec son style (couleur, accessoires, entrée en scène), son métier, ses outils
// (appels de fonction, voir agents/tools.js) et un scénario fictif pour l'essayer sans données réelles.

const CONTRAT_MAINTENANCE = `Contrat de maintenance informatique n° 2024-017 (fictif)
Entre Nexa Services (le prestataire) et Atelier Lumen (le client).
Article 1 — Durée : le contrat prend effet le 1er mars 2024 pour 36 mois, soit jusqu'au 28 février 2027.
Article 2 — Reconduction : à son échéance, le contrat est reconduit tacitement par périodes successives de 12 mois.
Article 3 — Résiliation : le client peut résilier à l'échéance par lettre recommandée, au moins 90 jours calendaires avant la date d'échéance. Passé ce délai, la reconduction de 12 mois s'applique.
Article 4 — Prix : 1 450 euros HT par mois, révisés de 3 % chaque 1er mars.
Article 5 — Sortie anticipée : en cas de résiliation avant l'échéance, le client verse 50 % des mensualités restantes.
Article 6 — Exclusivité : le client s'interdit de confier la maintenance de son parc à un autre prestataire pendant la durée du contrat.`;

const CONTRAT_COPIEUR = `Contrat de location de photocopieur n° L-8841 (fictif)
Entre Copyrex (le loueur) et Atelier Lumen (le locataire).
Article 1 — Durée : la location débute le 1er juin 2025 pour 48 mois, soit jusqu'au 31 mai 2029.
Article 2 — Reconduction : à l'échéance, la location se poursuit par périodes de 12 mois, sauf congé donné par lettre recommandée au moins 180 jours calendaires avant l'échéance.
Article 3 — Loyer : 290 euros HT par mois, copies en noir et blanc incluses ; 0,04 euro HT la copie couleur.
Article 4 — Sortie anticipée : en cas de résiliation avant l'échéance, le locataire verse 100 % des loyers restants.`;

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
        id: "clause",
        name: "Clause",
        role: "Contrats",
        color: "#e88fb4",
        accessories: ["lunettes", "noeud"],
        entrance: "spin",
        pitch: "Gestionnaire de contrats : repère les clauses à risque, calcule les dates limites de résiliation, prépare le rappel. Ne remplace pas un avocat.",
        useCases: [
            "Trouver la date limite pour résilier un contrat",
            "Repérer reconduction tacite, pénalités et exclusivité",
            "Chiffrer le coût d'une sortie anticipée",
            "Rédiger une note de rappel pour ne pas rater l'échéance",
        ],
        persona: "Tu t'appelles Clause. Tu gères les contrats de l'entreprise : méthodique, tu cites toujours l'article concerné, tu calcules les dates et les montants et tu rappelles que tu n'es pas juriste quand une décision engage l'entreprise.",
        agent: {
            instructions: "Pour analyser un contrat : appelle lister_documents puis lire_document. Cite l'article de chaque clause que tu mentionnes. Pour une date limite, récupère la date du jour avec date_actuelle et calcule-la avec decaler_date à partir de la date d'échéance, jamais de tête. Fais les montants avec calculer. Si on te demande une note ou un rappel, enregistre-le avec creer_note. Rappelle que ce n'est pas un conseil juridique.",
            tools: ["lister_documents", "lire_document", "date_actuelle", "decaler_date", "calculer", "creer_note"],
            maxSteps: 6,
            reasoning: false,
        },
        scenario: {
            label: "Deux contrats à surveiller",
            story: "L'Atelier Lumen a signé un contrat de maintenance informatique et une location de photocopieur. Les deux se reconduisent tout seuls si personne ne réagit.",
            documents: [
                doc("Contrat — Maintenance informatique Nexa Services (fictif)", "Contrat de maintenance Nexa", "36 mois jusqu'au 28 février 2027, reconduction tacite, préavis de 90 jours, 1 450 € HT par mois.", ["contrat", "maintenance", "résiliation", "reconduction tacite", "préavis"], CONTRAT_MAINTENANCE),
                doc("Contrat — Location de photocopieur Copyrex (fictif)", "Contrat photocopieur Copyrex", "48 mois jusqu'au 31 mai 2029, préavis de 180 jours, 290 € HT par mois.", ["contrat", "location", "résiliation", "préavis", "photocopieur"], CONTRAT_COPIEUR),
            ],
            prompts: [
                "Quand dois-je résilier le contrat de maintenance Nexa, et que se passe-t-il si je rate la date ?",
                "Quelles clauses du contrat de maintenance sont à risque ?",
                "Rédige une note de rappel pour ne pas manquer la date de résiliation de la maintenance.",
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
        name: "Centime",
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
        persona: "Tu t'appelles Centime. Tu es contrôleur de gestion : précis, neutre, tu justifies chaque décision par une règle écrite et un calcul.",
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
