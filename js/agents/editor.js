// Agent rédacteur : travaille sur un passage envoyé par une autre page (TextEdit, ou toute page qui utilise l'API).
// Deux sortes de demandes :
//   - réécrire le passage (corriger, plus sobre, plus clair, plus court, développer, ou une consigne libre) :
//     il répond par le passage réécrit, que l'éditeur propose d'appliquer ; « écrire la suite » ajoute un paragraphe ;
//   - poser une question avec le passage comme contexte : il répond, sans toucher au texte.
// L'éditeur remplace formules, code et liens par des marqueurs ⟦1⟧, ⟦2⟧… avant l'envoi.

export const ACTIONS = {
    corriger: { label: "Correction", instruction: "Corrige l'orthographe, la grammaire, les accords et la ponctuation. Ne change ni le sens, ni le style, ni l'ordre des phrases." },
    sobre: { label: "Plus sobre", instruction: "Reformule de façon plus sobre et plus neutre : enlève l'emphase, les adjectifs inutiles et les tournures familières." },
    clair: { label: "Plus clair", instruction: "Reformule pour que ce soit plus clair et plus simple à lire, sans perdre d'information." },
    court: { label: "Plus court", instruction: "Raccourcis en gardant toutes les informations importantes." },
    // Un petit modèle à qui l'on dit « développe » reformule et répète : on lui fait garder le texte et ajouter.
    developper: { label: "Développer", grow: 2.5, instruction: "Développe ce passage pour qu'il soit environ deux fois plus long. Garde les phrases existantes et, après chacune, ajoute une ou deux phrases nouvelles : une explication, un exemple concret ou une précision. Ne répète pas ce qui est déjà dit, n'ajoute ni titre ni conclusion générale." },
    // Il n'écrit que la suite ; le passage est gardé tel quel devant.
    suite: { label: "Écrire la suite", append: true, instruction: "Écris la suite de ce passage : un nouveau paragraphe de quatre à six phrases qui prolonge l'idée, dans le même style. Ne recopie pas le passage, écris seulement la suite." },
};

const CODE_RULE = "Le passage est du code. Applique exactement la modification demandée, sans rien changer d'autre ; garde le même langage. Réponds uniquement par le code complet modifié, sans bloc ``` ni explication.";
// Sur du code, seule une vraie question appelle une réponse : « donne-lui un nom », « continue la boucle » sont des consignes.
const CODE_QUESTION = /\?\s*$|^(explique|que fait|qu'est-ce|qu’est-ce|pourquoi|comment (ça|ca|cela) marche|comment fonctionne)/i;

// Un document jusqu'à FULL_WORDS mots est lu d'un coup ; au-delà, partie par partie (PART_WORDS mots), avec des notes.
export const FULL_WORDS = 2500;
const PART_WORDS = 1200;
const NOTE_TOKENS = 180;
// Une consigne libre qui demande en fait une action prête (« corrige les fautes stp », même mal tapée) : on prend
// la consigne prête, plus précise pour un petit modèle.
const PRESET_HINTS = [
    ["suite", /\b(la suite|continue|poursui|encha[iî]ne|prolonge)/i],
    ["developper", /\b(d[ée]velopp|approfondi|enrichi|plus long|plus d[ée]taill|d[ée]taille|[ée]toff|allonge)/i],
    ["corriger", /\b(corrig|correct|faute|fote|orthogra|grammai|coquille|accord)/i],
    ["sobre", /\b(sobre|sobrement|neutre|moins emphatique)/i],
    ["court", /\b(plus court|raccourci|abr[eé]g|condens)/i],
    ["clair", /\b(plus clair|clarifi|simplifi|plus simple)/i],
];
export function presetFor(instruction) {
    const text = String(instruction ?? "");
    return PRESET_HINTS.find(([, pattern]) => pattern.test(text))?.[0] ?? null;
}

const KEEP_MARKERS = "Les marqueurs ⟦1⟧, ⟦2⟧… remplacent des formules, du code ou des liens : recopie-les tels quels, à la même place.";
const MARKDOWN = "Le texte est en Markdown : garde sa mise en forme (**gras**, *italique*, listes, titres) et sers-t'en quand c'est utile.";
const LEGEND_CHARS = 80;
const PLACE_TOKENS = 6;
const WRITE_TOKENS = 1000;

// Ce que cachent les marqueurs : il les comprend (le code, la formule) sans pouvoir les abîmer.
function legend(keep) {
    if (!keep?.length) return "";
    const items = keep.map((value, i) => `⟦${i + 1}⟧ = ${String(value).replace(/\s+/g, " ").slice(0, LEGEND_CHARS)}`);
    return `\nPour comprendre le passage, voici ce que cachent les marqueurs (ne les remplace pas) : ${items.join(" ; ")}.`;
}
const MAX_ANSWER_TOKENS = 350;

// Une consigne libre qui est une question (« pourquoi… ? », « explique… ») appelle une réponse, pas une réécriture.
export function isQuestion(instruction) {
    const text = String(instruction ?? "").trim().toLowerCase();
    return /\?$/.test(text) || /^(pourquoi|comment|qu'est|qu’est|est-ce|explique|que veut|c'est quoi|quel|quelle|quels|quelles|résume|resume|donne|cite|combien|où|ou est)\b/.test(text);
}

/**
 * Messages pour le modèle. task : { action, instruction?, text?, title, document?, notes?, code? }.
 * code : le passage est du code (il le lit et le réécrit en développeur).
 * document : la page entière, lue avec la demande (une réponse) ; notes : ses notes, quand elle était trop longue.
 * action : corriger | sobre | clair | court · rewrite (réécrire selon la consigne) · ask (répondre, le texte sert de
 * contexte, facultatif) · consigne (l'un ou l'autre, selon que la consigne est une question).
 * Renvoie { messages, maxTokens, rewrite, append } ; rewrite : la réponse remplace le passage ; append : elle s'ajoute après.
 */
export function taskMessages({ action, instruction = "", text = "", title = "", document = "", notes = "", code = false, keep = [] }) {
    const asks = code ? CODE_QUESTION.test(instruction.trim()) : isQuestion(instruction);
    const rewrite = action === "ask" ? false : Boolean(ACTIONS[action]) || action === "rewrite" || !asks;
    // Les consignes prêtes sont écrites pour du texte : sur du code, il suit la demande telle quelle.
    const preset = code && instruction.trim() ? undefined : ACTIONS[action] ?? (rewrite ? ACTIONS[presetFor(instruction)] : undefined);
    if (rewrite) {
        const rule = preset?.instruction ?? (code ? `Modifie ce code en suivant cette consigne : ${instruction.trim() || "corrige ses erreurs"}` : `Réécris le passage en suivant cette consigne : ${instruction.trim()}`);
        // De quoi réécrire tout le passage, plus long pour développer ; la suite : un paragraphe.
        const length = Math.ceil(text.length / (code ? 2.2 : 2.6));
        const maxTokens = preset?.append ? 320 : Math.min(preset?.grow ? 1400 : 900, Math.max(80, Math.ceil(length * (preset?.grow ?? 1)) + 80));
        const who = code ? `Tu es un développeur attentif.\n${rule}\n${CODE_RULE}` : `Tu es un rédacteur attentif, en français.\n${rule}\n${MARKDOWN}\n${KEEP_MARKERS}${legend(keep)}\nRéponds uniquement par ${preset?.append ? "la suite" : "le passage réécrit"}, sans guillemets, sans titre ni commentaire.`;
        return {
            rewrite,
            append: Boolean(preset?.append),
            maxTokens,
            // Une consigne libre, ou du code : la consigne accompagne le passage (un petit modèle qui ne voit que le
            // passage le recopie souvent tel quel).
            messages: [
                { role: "system", content: who },
                { role: "user", content: preset ? text : code ? `Consigne : ${instruction.trim() || "corrige ses erreurs"}\n\nCode :\n\`\`\`\n${text}\n\`\`\`` : `Consigne : ${instruction.trim()}\n\nPassage :\n${text}` },
            ],
        };
    }
    // Ce qu'il a sous les yeux : le document entier (ou ses notes de lecture), et le passage sélectionné.
    const sources = [];
    if (document.trim()) sources.push(`Voici le document complet${title ? ` « ${title} »` : ""} :\n"""\n${document.trim()}\n"""`);
    if (notes.trim()) sources.push(`Tu as lu tout le document${title ? ` « ${title} »` : ""}, partie par partie. Tes notes de lecture :\n${notes.trim()}`);
    if (text.trim()) sources.push(`${sources.length ? `L'utilisateur a sélectionné ce ${code ? "code" : "passage"}` : `Voici le ${code ? "code" : "passage"} sélectionné par l'utilisateur`} :\n"""\n${text}\n"""`);
    if (!sources.length) {
        return {
            rewrite,
            maxTokens: MAX_ANSWER_TOKENS,
            messages: [
                { role: "system", content: `Tu es Cubi, un assistant qui aide à rédiger${title ? ` le document « ${title} »` : ""}. Réponds en français, simplement, en quelques phrases.` },
                { role: "user", content: instruction.trim() },
            ],
        };
    }
    return {
        rewrite,
        maxTokens: MAX_ANSWER_TOKENS,
        messages: [
            { role: "system", content: `Tu es Cubi, tu aides à rédiger${title && !document && !notes ? ` le document « ${title} »` : ""}.\n${sources.join("\n\n")}\nRéponds à sa demande en t'appuyant sur ce texte, en français, en quelques phrases. ${KEEP_MARKERS}${legend(keep)}` },
            { role: "user", content: instruction.trim() },
        ],
    };
}

const countWords = (text) => String(text ?? "").split(/\s+/).filter(Boolean).length;

// Un long document en parties d'environ PART_WORDS mots, coupées entre deux paragraphes.
export function splitDocument(document, size = PART_WORDS) {
    const parts = [];
    let current = [];
    let words = 0;
    for (const paragraph of String(document ?? "").split(/\n\s*\n/)) {
        const n = countWords(paragraph);
        if (!n) continue;
        if (words && words + n > size) { parts.push(current.join("\n\n")); current = []; words = 0; }
        current.push(paragraph.trim());
        words += n;
    }
    if (current.length) parts.push(current.join("\n\n"));
    return parts;
}

export { countWords };

// Lecture d'une partie : il note ce qui sert à la demande, ou « RIEN ».
export function readingMessages({ instruction, part, index, of, title = "" }) {
    return {
        maxTokens: NOTE_TOKENS,
        messages: [
            { role: "system", content: `Tu lis le document${title ? ` « ${title} »` : ""}, partie ${index} sur ${of} :\n"""\n${part}\n"""\nNote, en quelques lignes courtes, ce qui dans cette partie sert à répondre à la demande de l'utilisateur. Si rien ne sert, réponds seulement : RIEN.` },
            { role: "user", content: instruction.trim() },
        ],
    };
}

export const isEmptyNote = (note) => !note.trim() || /^rien\b/i.test(note.trim());

// Les petits modèles ajoutent parfois « Voici le texte corrigé : », des guillemets ou un bloc de code.
export function cleanRewrite(reply) {
    let text = String(reply ?? "").trim();
    text = text.replace(/^(?:voici|voilà)\b[^\n]*:\s*\n+/i, "").trim();
    text = text.replace(/^(?:passage|texte|code)(?: (?:réécrit|corrigé|modifié))?\s*:\s*\n?/i, "").trim();
    // Un bloc de code suivi (ou précédé) d'une explication : seulement le code.
    const fenced = /```[\w+#.-]*\n([\s\S]*?)\n```/.exec(text);
    if (fenced) text = fenced[1].trim();
    const quoted = /^(["«“])([\s\S]*)(["»”])$/.exec(text);
    if (quoted && !/["«“»”]/.test(quoted[2])) text = quoted[2].trim();
    return text;
}

// Le passage réécrit garde exactement les marqueurs du passage d'origine, sinon on ne l'applique pas.
export function markersIntact(original, rewritten) {
    const list = (text) => (String(text).match(/⟦\d+⟧/g) ?? []).sort().join(",");
    return list(original) === list(rewritten);
}

// Un petit modèle abîme souvent les marqueurs : il les écrit autrement ([[1]]), les oublie ou en invente. On les
// remet d'aplomb plutôt que de jeter sa réécriture : variantes corrigées, inventés retirés, oubliés remis après le
// mot qui les précédait dans le passage d'origine (les mots sont alignés, comme pour un diff).
const loose = (word) => word.replace(/⟦\d+⟧/g, "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
export function repairMarkers(original, rewritten) {
    const want = String(original).match(/⟦\d+⟧/g) ?? [];
    let text = String(rewritten ?? "").replace(/(?:⟦|\[\[|【|\[)\s*(\d+)\s*(?:⟧|\]\]|】|\])/g, (m, n) => (want.includes(`⟦${n}⟧`) ? `⟦${n}⟧` : m));
    const seen = new Set();
    text = text.replace(/ ?⟦(\d+)⟧/g, (m, n) => {
        const key = `⟦${n}⟧`;
        if (!want.includes(key) || seen.has(key)) return "";
        seen.add(key);
        return m;
    });
    const missing = want.filter((key) => !seen.has(key));
    if (!missing.length) return text;

    const a = String(original).split(/\s+/).filter(Boolean);
    const parts = text.split(/(\s+)/);
    const b = parts.map((part, index) => ({ part, index })).filter(({ part }) => part.trim());
    const n = a.length, m = b.length;
    if (n * m > 1_000_000) return text;
    const same = (i, j) => loose(a[i]) !== "" && loose(a[i]) === loose(b[j].part);
    const lcs = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) lcs[i][j] = same(i, j) ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    // Pour chaque mot d'origine, le mot de la réécriture qui lui correspond (ou le dernier avant lui).
    const after = new Int32Array(n).fill(-1);
    const matched = new Uint8Array(n);
    for (let i = 0, j = 0, last = -1; i < n; ) {
        if (j < m && same(i, j) && lcs[i][j] === lcs[i + 1][j + 1] + 1) { last = j; matched[i] = 1; after[i++] = j++; }
        else if (j < m && lcs[i][j + 1] >= lcs[i + 1][j]) j++;
        else after[i++] = last;
    }
    // Un marqueur collé à un mot (« cours⟦3⟧ », un lien) se recolle au même mot ; sinon il revient après le mot d'avant.
    const head = [];
    for (const key of missing) {
        const at = a.findIndex((word) => word.includes(key));
        const [before, rest] = a[at].split(key);
        if (matched[at] && loose(before)) { parts[b[after[at]].index] += key; continue; }
        if (matched[at] && loose(rest)) { parts[b[after[at]].index] = key + parts[b[after[at]].index]; continue; }
        const j = at > 0 ? after[at - 1] : -1;
        if (j < 0) head.push(key);
        else parts[b[j].index] += ` ${key}`;
    }
    return (head.length ? `${head.join(" ")} ` : "") + parts.join("");
}

// ---------------------------------------------------------------- ajouter du contenu au document

// Le plan du document, un endroit par ligne (titres, ou paragraphes s'il n'y en a pas) ; le dernier : la fin.
const outlineText = (outline) => outline.map(({ label }, i) => `${i + 1}. ${label}`).join("\n");

/** Où ajouter ce qui est demandé : il répond par le numéro de l'endroit après lequel l'ajouter. */
export function placeMessages({ instruction, outline, title = "" }) {
    return {
        maxTokens: PLACE_TOKENS,
        messages: [
            { role: "system", content: `Voici le plan du document${title ? ` « ${title} »` : ""}, un endroit par ligne :\n${outlineText(outline)}\nL'utilisateur veut ajouter du contenu. Après quel endroit faut-il l'ajouter pour que le document reste logique ? Réponds seulement par le numéro.` },
            { role: "user", content: instruction.trim() },
        ],
    };
}

export function parsePlace(reply, count) {
    const n = Number(/\d+/.exec(String(reply ?? ""))?.[0]);
    return Number.isInteger(n) && n >= 1 && n <= count ? n - 1 : null;
}

/** Le contenu à ajouter après l'endroit choisi : complet, en Markdown, dans le style du document. */
export function writeMessages({ instruction, outline, place, title = "", document = "" }) {
    const spot = outline[place];
    const context = document.trim()
        ? `Voici le document en entier :\n"""\n${document.trim()}\n"""`
        : spot?.text?.trim() ? `Voici ce qui précède l'endroit où ton texte sera ajouté :\n"""\n${spot.text.trim()}\n"""` : "";
    return {
        maxTokens: WRITE_TOKENS,
        messages: [
            { role: "system", content: `Tu écris dans le document${title ? ` « ${title} »` : ""}, en français et en Markdown : titres (##), **gras**, *italique*, listes quand c'est utile.\nLe plan du document :\n${outlineText(outline)}\nTon texte sera ajouté après « ${spot?.label ?? "la fin"} ».${context ? `\n${context}` : ""}\nRédige ce que demande l'utilisateur, complet et précis, dans le même style ; si c'est une nouvelle section, donne-lui un titre du même niveau que ses voisines. Ne répète pas ce qui est déjà écrit. Réponds uniquement par le texte à ajouter, sans commentaire.` },
            { role: "user", content: instruction.trim() },
        ],
    };
}

/** Quel endroit modifier (un bloc de code, un paragraphe) : il répond par le numéro. */
export function targetMessages({ instruction, outline, title = "" }) {
    return {
        maxTokens: PLACE_TOKENS,
        messages: [
            { role: "system", content: `Voici les parties du document${title ? ` « ${title} »` : ""}, une par ligne :\n${outlineText(outline)}\nL'utilisateur veut modifier l'une d'elles. Laquelle ? Réponds seulement par le numéro.` },
            { role: "user", content: instruction.trim() },
        ],
    };
}
