// Aiguillage d'une demande, avant tout appel au modèle : un échange cordial ne doit ni fouiller les
// documents ni produire de rapport. Règles explicites plutôt qu'un second appel au modèle :
// instantané, prévisible et testable.
//
//   conversation  salutations, remerciements, échange courtois → une ou deux phrases, sans recherche
//   simple        question ponctuelle → recherche dans les documents, réponse courte dans la bulle
//   complet       synthèse, liste, analyse, calcul… → recherche (ou agent) et développement à droite
//   classement    « quel CV recommandes-tu ? » avec plusieurs documents → chaque document est noté,
//                 puis le meilleur est recommandé (voir agents/ranker.js)
//   retrouver     « donne-moi le PDF qui parle de… », « où est-il écrit que… » → le passage précis,
//                 sa page dans le document d'origine, surligné (voir pdf_viewer.js)
//
// `deliver` : l'utilisateur a demandé un livrable (rapport, note, courrier…) ; seul ce cas passe par
// la boîte aux lettres.

import { REPLY_FORMAT } from "./answer_format.js";

export const MODES = {
    conversation: {
        label: "échange",
        retrieve: false,
        maxTokens: 96,
        instructions: "Tu échanges avec l'utilisateur de façon cordiale et naturelle. Réponds en une ou deux phrases, sans titre, sans liste et sans séparateur.",
    },
    simple: {
        label: "réponse courte",
        retrieve: true,
        maxTokens: 220,
        instructions: "Réponds en une à trois phrases, sans titre, sans liste et sans séparateur.",
    },
    complet: {
        label: "réponse détaillée",
        retrieve: true,
        maxTokens: 1024,
        instructions: REPLY_FORMAT,
    },
    retrouver: {
        label: "recherche d'un passage",
        retrieve: true,
        maxTokens: 0,
        instructions: "",
    },
    // Mission imposée dans le studio : ni recherche, ni format, ni rapport ; elle seule guide le modèle.
    mission: {
        label: "mission imposée",
        retrieve: false,
        maxTokens: 512,
        instructions: "",
    },
    // Personnage de l'équipe : le modèle appelle lui-même ses outils (voir crew.js, agents/runner.js).
    agent: {
        label: "agent avec outils",
        retrieve: false,
        maxTokens: 512,
        instructions: REPLY_FORMAT,
    },
    classement: {
        label: "classement de documents",
        retrieve: false,
        maxTokens: 700,
        instructions: REPLY_FORMAT,
    },
};

const SMALL_TALK = /^(?:bonjour|bonsoir|salut|hello|hey|coucou|yo|merci|thanks|ok|okay|d'accord|daccord|parfait|super|genial|top|cool|bien|tres bien|au revoir|a bientot|a plus|bonne (journee|soiree|nuit)|ca va|comment (ca va|vas[- ]tu|tu vas)|tu vas bien|qui es[- ]tu|tu es qui|tu t'appelles comment|comment tu t'appelles|que sais[- ]tu faire|tu fais quoi)\b/;
// Mots qui peuvent accompagner une politesse sans en faire une vraie question.
const FILLERS = new Set(["et", "toi", "vous", "a", "aussi", "beaucoup", "bien", "pour", "ton", "ta", "votre", "aide", "reponse", "encore", "tout", "le", "monde", "ici", "la", "oui", "non", "merci"]);
const DETAIL = /\b(resume|resumer|synthese|synthetise|liste|lister|enumere|compare|comparer|comparaison|analyse|analyser|rapport|detaille|detailler|en detail|explique|expliquer|procedure|etapes|plan|tableau|tous les|toutes les|calcule|calculer|combien|verifie|verifier|conforme|redige|rediger|prepare|preparer|propose)\b/;
const DELIVERABLE = /\b(?:rapport|(?:fais|fait|faites|prepare|preparer|redige|rediger|ecris|ecrire|genere|generer|produis|produire|cree|creer|envoie|envoyer)(?:[- ]moi)?(?: un| une| le| la| les| des| mon| ma)? (rapport|note|compte rendu|synthese|dossier|courrier|lettre|mail|e-mail|email|memo|document|fiche|proposition|devis))\b/;
const RANK = /\b(recommande|recommandes|recommander|recommandation|meilleur|meilleure|meilleurs|meilleures|classe|classer|classement|trie|trier|choisis|choisir|selectionne|selectionner|retiens|retenir|lequel|laquelle|lesquels|lesquelles|departage|departager|le plus adapte|la plus adaptee|le plus pertinent|la plus pertinente|shortlist)\b/;
const LOCATE = /\b(?:(?:donne|donnez|montre|montrez|trouve|trouvez|retrouve|retrouvez|ouvre|ouvrez|affiche|affichez|sors|sortez|cite|citez)(?:[- ]moi)? (?:(?:le|la|les|un|une|ce|cette) |l')?(?:pdf|document|doc|fichier|page|passage|extrait|paragraphe|article|clause|source)|ou (?:est[- ]il |est[- ]ce qu'il est |c'est |est )?(?:ecrit|dit|mentionne|indique|precise)|dans quel (?:document|fichier|pdf)|(?:a |en )?quelle page)\b/;
const LONG_QUESTION = 160;
const SHORT_SMALL_TALK = 60;

// `documents` : nombre de documents en mémoire ; il en faut au moins deux pour un classement.
export function routeQuestion(text, { documents = 0 } = {}) {
    const question = normalize(text);
    if (isSmallTalk(question)) return { mode: "conversation", deliver: false, reason: "échange courtois" };
    const rank = documents >= 2 && RANK.exec(question);
    if (rank) return { mode: "classement", deliver: DELIVERABLE.test(question), reason: `choix entre ${documents} documents (« ${rank[1]} »)` };
    const locate = documents >= 1 && LOCATE.exec(question);
    // L'extrait trouvé est déposé dans la boîte aux lettres, prêt à être rouvert.
    if (locate) return { mode: "retrouver", deliver: true, reason: `passage précis demandé (« ${locate[0]} »)` };
    if (DELIVERABLE.test(question)) return { mode: "complet", deliver: true, reason: "livrable demandé" };
    const cue = DETAIL.exec(question);
    if (cue) return { mode: "complet", deliver: false, reason: `demande de détail (« ${cue[1]} »)` };
    if (question.length > LONG_QUESTION) return { mode: "complet", deliver: false, reason: "demande longue" };
    return { mode: "simple", deliver: false, reason: "question ponctuelle" };
}

// Tout le message est une politesse : « Bonjour Cubi ! », « Merci beaucoup », « Ça va et toi ? ».
// « Bonjour, quand ferme l'atelier ? » est une vraie question.
function isSmallTalk(question) {
    if (question.length > SHORT_SMALL_TALK) return false;
    let rest = question.replace(/[!?.,;:…]/g, " ").replace(/\s+/g, " ").trim();
    for (let match = SMALL_TALK.exec(rest); match; match = SMALL_TALK.exec(rest)) {
        rest = rest.slice(match[0].length).trim();
        if (!rest) return true;
    }
    if (rest === question) return false;
    return rest.split(" ").filter((word) => !FILLERS.has(word)).length <= 1;
}

function normalize(text) {
    return String(text).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[’`]/g, "'").replace(/\s+/g, " ").trim();
}
