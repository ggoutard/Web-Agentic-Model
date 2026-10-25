// Agent lecteur : chaque document reçu suit trois étapes, un document à la fois.
//
//   1. lecture        extraction du texte (fichiers texte, PDF via un extracteur fourni)
//   2. compréhension  un appel court au modèle : titre, résumé, points clés, concepts, réaction
//   3. indexation     le texte est découpé en passages ; les concepts (thèmes, synonymes) sont
//                     rattachés au document dans le graphe, pour qu'une question formulée avec
//                     d'autres mots retrouve quand même le bon document
//
// Le lecteur ne touche ni au DOM ni au modèle directement : `understand`, `store` et `onEvent`
// sont fournis par l'application. `onEvent` peut renvoyer une promesse (une animation, par
// exemple) : l'étape suivante attend sa fin, pour que l'interface et le traitement restent alignés.

const TEXT_EXTENSIONS = ["txt", "md", "markdown", "csv", "json", "log"];
const MAX_TEXT_BYTES = 2_000_000;
const MAX_PDF_BYTES = 30_000_000;
const EXCERPT_CHARS = 2000;
const MAX_REACTION_WORDS = 8;
const MAX_POINTS = 3;
const MAX_CONCEPTS = 8;

/**
 * events (dans l'ordre, pour chaque document) :
 *   { type: "received", item }                 le document arrive
 *   { type: "reading",  item }                 la compréhension commence
 *   { type: "understood", item, sheet }        fiche : titre, résumé, points, concepts, réaction
 *   { type: "stored",   item, sheet }          indexé
 *   { type: "rejected", item, reason }         illisible, vide ou déjà connu
 * item = { name, text, origin } ; `origin` est transmis tel quel (position du dépôt, etc.).
 * `findDuplicate(item)` renvoie le document déjà connu au même contenu, s'il existe.
 */
export function createReader({ understand, store, findDuplicate = () => null, onEvent = () => {} }) {
    const queue = [];
    let running = null;

    async function process(item) {
        await onEvent({ type: "received", item });
        if (!item.error && findDuplicate(item)) item.error = "Je l'ai déjà lu.";
        if (item.error) {
            await onEvent({ type: "rejected", item, reason: item.error });
            return;
        }
        await onEvent({ type: "reading", item });
        let sheet;
        try {
            sheet = await understand(item);
        } catch (error) {
            console.warn("Lecture par le modèle impossible, fiche minimale :", error);
            sheet = fallbackSheet(item.name, item.text);
        }
        await onEvent({ type: "understood", item, sheet });
        store(item, sheet);
        await onEvent({ type: "stored", item, sheet });
    }

    async function drain() {
        while (queue.length > 0) await process(queue.shift());
        running = null;
    }

    return {
        // Ajoute des documents à la file ; renvoie une promesse résolue quand la file est vide.
        enqueue(items) {
            queue.push(...items);
            running ??= drain();
            return running;
        },
        get busy() {
            return running !== null;
        },
    };
}

// ---------- Lecture ----------

// `extractPdf(file)` renvoie le texte d'un PDF ; fourni par l'application (pdf.js dans le navigateur).
export async function readFile(file, origin, { extractPdf = null } = {}) {
    const name = file.name.replace(/\.[^.]+$/, "") || file.name;
    const extension = file.name.includes(".") ? file.name.split(".").pop().toLowerCase() : "";
    const isPdf = extension === "pdf" || file.type === "application/pdf";
    const reject = (error) => ({ name, text: "", origin, error });

    if (isPdf) {
        if (!extractPdf) return reject("Je ne sais pas lire les PDF ici.");
        if (file.size > MAX_PDF_BYTES) return reject("Ce PDF est trop volumineux pour moi (30 Mo maximum).");
        let text;
        try {
            text = (await extractPdf(file)).trim();
        } catch (error) {
            console.warn("PDF illisible :", error);
            return reject("Ce PDF est illisible ou protégé.");
        }
        return text ? { name, text, origin, file } : reject("Ce PDF ne contient que des images : je ne sais pas encore lire les scans.");
    }
    if (!TEXT_EXTENSIONS.includes(extension) && !file.type.startsWith("text/")) {
        return reject(`Je ne sais pas encore lire les fichiers .${extension || "sans extension"}.`);
    }
    if (file.size > MAX_TEXT_BYTES) return reject("Ce document est trop volumineux pour moi (2 Mo maximum).");
    const text = (await file.text()).trim();
    return text ? { name, text, origin } : reject("Ce document est vide.");
}

// ---------- Compréhension ----------

export function readingMessages(item, persona = "") {
    const system = `${persona ? `${persona}\n\n` : ""}On te confie un document. Lis-le et réponds uniquement avec un objet JSON, sans texte autour :
{"titre": "...", "resume": "...", "points": ["..."], "concepts": ["..."], "reaction": "..."}
- titre : 6 mots maximum
- resume : ce que dit le document, en une phrase de 20 mots maximum
- points : jusqu'à ${MAX_POINTS} informations utiles et concrètes (montants, dates, délais, obligations, décisions)
- concepts : jusqu'à ${MAX_CONCEPTS} thèmes ou synonymes qui décrivent le sujet, y compris des mots absents du texte
- reaction : ta réaction en le recevant, 6 mots maximum, à la première personne, ton naturel`;
    return [
        { role: "system", content: system },
        { role: "user", content: `Nom du fichier : ${item.name}\n\nDébut du document :\n${item.text.slice(0, EXCERPT_CHARS)}` },
    ];
}

// Le petit modèle ne produit pas toujours un JSON parfait : on garde ce qui est exploitable
// et on complète avec une fiche minimale.
export function parseSheet(raw, item) {
    const fallback = fallbackSheet(item.name, item.text);
    const match = /\{[\s\S]*\}/.exec(String(raw));
    if (!match) return fallback;
    let data;
    try {
        data = JSON.parse(match[0]);
    } catch {
        return fallback;
    }
    const clean = (value, max) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "");
    const list = (value, count, max) => (Array.isArray(value) ? value.map((v) => clean(v, max)).filter(Boolean).slice(0, count) : []);
    const concepts = [...new Set(list(data.concepts, MAX_CONCEPTS, 40).map((c) => c.toLowerCase()))];
    return {
        title: clean(data.titre, 60) || fallback.title,
        summary: clean(data.resume, 200) || fallback.summary,
        points: list(data.points, MAX_POINTS, 160),
        concepts: concepts.length > 0 ? concepts : fallback.concepts,
        reaction: clean(data.reaction, 80).split(" ").slice(0, MAX_REACTION_WORDS).join(" ") || fallback.reaction,
    };
}

// Sans modèle : titre tiré de la première ligne, concepts = mots les plus fréquents.
export function fallbackSheet(name, text) {
    const firstLine = text.split("\n").find((line) => line.trim())?.replace(/^#+\s*/, "").trim() ?? name;
    const counts = new Map();
    for (const word of normalize(text.slice(0, 20_000)).split(/[^a-z0-9]+/)) {
        if (word.length >= 5 && !COMMON_WORDS.has(word)) counts.set(word, (counts.get(word) ?? 0) + 1);
    }
    const concepts = [...counts].sort((a, b) => b[1] - a[1]).slice(0, MAX_CONCEPTS).map(([word]) => word);
    return { title: firstLine.slice(0, 60), summary: "", points: [], concepts, reaction: "C'est lu, je m'en souviens." };
}

function normalize(text) {
    return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

const COMMON_WORDS = new Set([
    "alors", "apres", "aussi", "autre", "autres", "avant", "avoir", "cette", "chaque", "comme", "dans", "depuis",
    "elles", "entre", "etait", "etre", "faire", "leurs", "meme", "moins", "notre", "nous", "parce", "pendant",
    "peuvent", "plus", "pour", "quand", "quelle", "quelles", "selon", "sans", "seront", "sont", "sous", "toute",
    "toutes", "votre", "vous", "about", "there", "their", "these", "which", "would",
]);
