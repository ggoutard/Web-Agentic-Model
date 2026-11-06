// Petites phrases que le personnage dit pendant qu'il travaille, selon ce qu'il est en train de faire.
// Elles tournent dans la bulle tant que l'étape dure.

export const STATUS_LINES = {
    thinking: ["Voyons voir", "Je réfléchis", "Laissez-moi regarder ça"],
    searching: ["Je cherche dans vos documents", "Je fouille mes notes", "Je retrouve les bons passages"],
    writing: ["Je rédige le détail, à droite", "Je mets tout ça au propre", "J'organise les points importants"],
    reading: ["Hmm, voyons ce document", "C'est dense, je prends des notes", "Je lis attentivement", "Intéressant"],
    planning: ["Je réfléchis à ce que je dois lire", "Par où commencer ? Voyons", "Je prépare mes lectures"],
    locating: ["Je retrouve le bon passage", "Je feuillette vos documents", "Je cherche la page exacte"],
    grid: ["Je prépare ma grille d'évaluation", "Je réfléchis à ce qui compte vraiment"],
    ranking: ["Je compare les documents un par un", "Je relis chaque candidature", "Je note chacun, sans favori", "Hmm, celui-ci est intéressant"],
    deciding: ["J'ai mon favori, je vous explique", "Je pèse le pour et le contre"],
    waiting: ["Je termine ce que j'étais en train de faire"],
    tools: {
        rechercher_documents: ["Je vérifie dans vos documents"],
        calculer: ["Je sors la calculatrice", "Je refais le calcul"],
        date_actuelle: ["Je regarde le calendrier"],
        decaler_date: ["Je compte les jours", "Je calcule l'échéance"],
        creer_note: ["Je rédige la note", "Je mets ça par écrit"],
    },
};

export function toolLines(name) {
    return STATUS_LINES.tools[name] ?? STATUS_LINES.thinking;
}
