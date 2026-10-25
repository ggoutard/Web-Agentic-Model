// Retrouver un passage dans un document de plusieurs pages : quelle page, et quelles lignes surligner.
// Fonctions pures (testées) ; pdf_text.js et pdf_viewer.js s'en servent sur le vrai PDF.

export function words(text) {
    return String(text ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
        .split(/[^a-z0-9€%]+/).filter((word) => word.length >= 2 || word === "€" || word === "%");
}

// Petits mots qui ne disent rien du sujet : ils ne comptent ni pour choisir ni pour surligner.
const STOP = new Set(["le", "la", "les", "de", "des", "du", "un", "une", "et", "ou", "en", "au", "aux", "a", "dans", "sur", "par", "pour", "avec", "que", "qui", "ce", "ces", "se", "sa", "son", "ses", "il", "elle", "ils", "elles", "on", "ne", "pas", "est", "sont", "nos", "notre", "leur", "leurs", "the", "of", "and"]);
const content = (list) => list.filter((word) => !STOP.has(word));

const bigrams = (list) => new Set(list.slice(1).map((word, i) => `${list[i]} ${word}`));

// Page (numérotée à partir de 1) qui contient le mieux le passage : mots et paires de mots communs.
export function bestPage(passage, pages) {
    const wanted = words(passage);
    const wantedPairs = bigrams(wanted);
    const wantedSet = new Set(wanted.filter((w) => w.length > 3));
    let best = { page: 1, score: 0 };
    pages.forEach((text, i) => {
        const found = words(text);
        const set = new Set(found);
        const pairs = bigrams(found);
        const single = wantedSet.size ? [...wantedSet].filter((w) => set.has(w)).length / wantedSet.size : 0;
        const paired = wantedPairs.size ? [...wantedPairs].filter((p) => pairs.has(p)).length / wantedPairs.size : 0;
        const score = single * 0.4 + paired * 0.6;
        if (score > best.score) best = { page: i + 1, score };
    });
    return best;
}

/**
 * Lignes de texte de la page (dans l'ordre) à surligner : la suite la plus dense de lignes dont
 * les mots viennent du passage, en tolérant deux lignes intercalaires. Renvoie { start, end } ou null.
 */
export function highlightRun(passage, lines, { gap = 2, threshold = 0.6 } = {}) {
    const wanted = new Set(content(words(passage)));
    // Un mot présent sur beaucoup de lignes (« porte » dans une page sur les portes) ne prouve rien.
    const spread = new Map();
    for (const line of lines) for (const word of new Set(words(line))) spread.set(word, (spread.get(word) ?? 0) + 1);
    const common = (word) => lines.length >= 8 && spread.get(word) / lines.length > 0.25;
    const match = lines.map((line) => {
        const list = content(words(line)).filter((w) => w.length >= 3 && !common(w));
        if (list.length === 0) return null;
        return list.filter((w) => wanted.has(w)).length / list.length >= threshold ? line.length : 0;
    });
    let best = null;
    let run = null;
    let misses = 0;
    match.forEach((value, i) => {
        if (value) {
            if (!run) run = { start: i, end: i, weight: 0 };
            run.end = i;
            run.weight += value;
            misses = 0;
            if (!best || run.weight > best.weight) best = { ...run };
        } else if (run && (value === null || ++misses <= gap)) {
            // Ligne vide ou intercalaire : la suite continue.
        } else {
            run = null;
            misses = 0;
        }
    });
    return best && { start: best.start, end: best.end };
}

// Mots de la demande elle-même (« donne-moi le PDF qui parle de… ») : ils ne disent rien du sujet.
const REQUEST_WORDS = new Set(["donne", "donnez", "montre", "montrez", "trouve", "trouvez", "retrouve", "retrouvez", "ouvre", "affiche", "cite", "moi", "pdf", "document", "documents", "fichier", "page", "passage", "extrait", "parle", "parlent", "concerne", "dans", "quel", "quelle", "est", "ecrit", "dit", "mentionne", "indique", "precise", "qui", "que", "les", "des", "une", "sur", "pour", "avec"]);

// Racine grossière : « repas »/« repa », « fixé »/« fixe », pluriels… se rejoignent.
const stem = (word) => word.slice(0, 5);

/**
 * Le passage précis à citer et surligner : dans un extrait trouvé par la recherche (souvent long),
 * les une à trois phrases qui se suivent et contiennent le plus de mots de la demande.
 */
export function preciseExcerpt(request, text, { maxSentences = 3 } = {}) {
    const wanted = new Set(words(request).filter((w) => w.length > 3 && !REQUEST_WORDS.has(w)).map(stem));
    const sentences = String(text).split(/\n+|(?<=[.!?;])\s+/).map((s) => s.trim()).filter(Boolean);
    if (wanted.size === 0 || sentences.length <= 1) return String(text).trim();
    const found = sentences.map((sentence) => new Set(words(sentence).map(stem).filter((w) => wanted.has(w))));
    // Un mot rare dans l'extrait (« hadamard ») compte plus qu'un mot présent partout (« porte »).
    const rarity = (word) => Math.log(1 + sentences.length / found.filter((set) => set.has(word)).length);
    const scores = found.map((set) => [...set].reduce((sum, word) => sum + rarity(word), 0));
    // À égalité, une vraie phrase l'emporte sur une ligne de sommaire (« 2. Frais de repas »).
    const weight = (i) => scores[i] + Math.min(1, words(sentences[i]).length / 12) * 0.3;
    const best = sentences.reduce((top, _, i) => (weight(i) > weight(top) ? i : top), 0);
    if (scores[best] === 0) return String(text).trim();
    // On étend aux phrases voisines qui parlent aussi du sujet ; un titre emmène son paragraphe.
    const heading = (i) => words(sentences[i]).length <= 9 && !/[.!?;:]$/.test(sentences[i]);
    let start = best;
    let end = best;
    while (end - start + 1 < maxSentences && end + 1 < sentences.length && (scores[end + 1] > 0 || heading(end))) end += 1;
    while (end - start + 1 < maxSentences && start > 0 && scores[start - 1] > 0) start -= 1;
    return sentences.slice(start, end + 1).join(" ");
}
