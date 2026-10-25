// Réflexion avant une réponse détaillée : quelles lectures faire dans les documents, puis le choix
// d'un passage précis. Comme pour l'évaluateur, le modèle ne produit que quelques mots ou un chiffre.

import { parseLines } from "../answer_format.js";

export const MAX_READINGS = 3;
// Passages gardés après toutes les lectures, pour tenir dans le contexte du petit modèle.
export const MAX_PASSAGES = 6;

export function planMessages(question, documents = []) {
    const list = documents.slice(0, 12).map((doc) => `- ${doc.title || doc.name}${doc.summary ? ` : ${doc.summary}` : ""}`).join("\n");
    return [
        {
            role: "system",
            content: `Avant de répondre, tu prépares tes lectures.${list ? `\nDocuments disponibles :\n${list}` : ""}
Écris de 1 à ${MAX_READINGS} recherches courtes (quelques mots chacune) à faire dans ces documents pour répondre complètement. Une par ligne, sans numéro ni explication.`,
        },
        { role: "user", content: question },
    ];
}

// Les lectures prévues ; à défaut, la question elle-même.
export function parsePlan(text, question) {
    const plan = parseLines(text, MAX_READINGS);
    return plan.length ? plan : [question];
}

// Passages de toutes les lectures, sans doublon, dans l'ordre où ils ont été trouvés.
export function mergeReadings(readings, max = MAX_PASSAGES) {
    const merged = [];
    for (const chunks of readings) {
        for (const chunk of chunks) {
            if (merged.length < max && !merged.some((known) => known.id === chunk.id)) merged.push(chunk);
        }
    }
    return merged;
}

// Choix du passage qui répond le mieux : un seul chiffre.
export function chooseMessages(question, sources) {
    const list = sources.map((source) => `[${source.index}] (${source.document}) ${source.text.slice(0, 600)}`).join("\n\n");
    return [
        { role: "system", content: `Voici des extraits de documents, numérotés :\n\n${list}\n\nQuel extrait répond le plus précisément à la demande ? Réponds uniquement par son numéro.` },
        { role: "user", content: question },
    ];
}

export function parseChoice(text, count) {
    const n = Number(/\d+/.exec(String(text ?? ""))?.[0]);
    return n >= 1 && n <= count ? n : 1;
}

// Citation lisible : le passage, coupé proprement s'il est long.
export function quote(text, max = 260) {
    const clean = String(text).replace(/\s+/g, " ").trim();
    if (clean.length <= max) return clean;
    const cut = clean.slice(0, max);
    return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), max - 40))}…`;
}
