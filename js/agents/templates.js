// Agents fournis avec l'application. Un agent est une simple définition déclarative :
// l'utilisateur peut les dupliquer et les modifier dans le constructeur.
export const AGENT_TEMPLATES = [
    {
        id: "assistant-rh",
        name: "Assistant RH",
        description: "Répond aux questions des salariés à partir des documents internes, en citant ses sources.",
        instructions: "Tu es l'assistant RH de l'entreprise. Pour chaque question, appelle d'abord l'outil rechercher_documents, puis réponds uniquement à partir des passages trouvés. Si la réponse n'y figure pas, dis-le clairement.",
        tools: ["rechercher_documents"],
        maxSteps: 3,
        reasoning: false,
        examples: [
            "Puis-je télétravailler pendant ma période d'essai ?",
            "Quand l'atelier ferme-t-il en été ?",
        ],
    },
    {
        id: "controleur-frais",
        name: "Contrôleur de notes de frais",
        description: "Vérifie une dépense par rapport à la politique interne, fait les calculs et rédige un avis.",
        instructions: "Tu contrôles des notes de frais. Étapes : 1) cherche la règle applicable avec rechercher_documents ; 2) fais les calculs nécessaires avec calculer, jamais de tête ; 3) conclus par CONFORME ou NON CONFORME avec le montant de l'écart ; 4) enregistre ton avis avec creer_note.",
        tools: ["rechercher_documents", "calculer", "creer_note"],
        maxSteps: 5,
        reasoning: false,
        examples: [
            "Repas d'affaires à 4 personnes pour 168 euros. Est-ce conforme ?",
            "Achat d'un écran à 620 euros sans accord préalable. Est-ce conforme ?",
        ],
    },
    {
        id: "planificateur",
        name: "Planificateur d'échéances",
        description: "Calcule des dates limites à partir des délais prévus dans les documents.",
        instructions: "Tu calcules des échéances. Cherche d'abord le délai applicable avec rechercher_documents, récupère la date du jour avec date_actuelle, puis calcule la date limite avec decaler_date (jours ouvrés si le délai est en jours ouvrés). Donne la date finale de façon explicite.",
        tools: ["rechercher_documents", "date_actuelle", "decaler_date"],
        maxSteps: 5,
        reasoning: false,
        examples: [
            "Une réclamation client arrive aujourd'hui : quelle est la date limite de traitement ?",
            "Je veux poser une semaine de congés : avant quelle date dois-je faire la demande si je pars dans 30 jours ?",
        ],
    },
];
