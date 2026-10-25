// Une réponse du modèle a deux destinataires : une phrase naturelle pour la bulle du personnage, et,
// si la question le demande, un développement structuré pour le volet de droite.
// Le modèle les sépare par une ligne « --- » (voir REPLY_FORMAT) ; à défaut, on découpe nous-mêmes.

import { escapeHTML } from "./ui_utils.js";

export const REPLY_FORMAT = `Format de ta réponse :
- Commence par une réponse courte et naturelle, une ou deux phrases, comme à l'oral.
- Si la demande appelle du détail (liste, procédure, synthèse, comparaison, calcul), ajoute ensuite une ligne contenant uniquement --- puis un rapport structuré avec des titres ## et des listes.
- Pour une question simple, pas de rapport.`;

const SEPARATOR = /(?:^|\n)[ \t]*-{3,}[ \t]*(?:\n|$)/;
// Au-delà, une réponse sans séparateur est trop longue pour la bulle.
const CHAT_MAX_CHARS = 320;
const STRUCTURE = /^\s*(#{1,4}\s|[-*•]\s|\d+[.)]\s)/m;
const FALLBACK_CHAT = "Voici le détail.";

// Les petits modèles se répètent parfois : on retire les paragraphes déjà écrits.
export function tidyAnswer(text) {
    const seen = new Set();
    return String(text ?? "").trim().split(/\n{2,}/).filter((paragraph) => {
        const key = paragraph.toLowerCase().replace(/\s+/g, " ").trim();
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
    }).join("\n\n");
}

export function splitAnswer(text) {
    const answer = tidyAnswer(text);
    const match = SEPARATOR.exec(answer);
    if (match) {
        const chat = answer.slice(0, match.index).trim();
        const report = answer.slice(match.index + match[0].length).trim();
        return { chat: chat || (report ? FALLBACK_CHAT : ""), report };
    }
    if (answer.length <= CHAT_MAX_CHARS && !STRUCTURE.test(answer)) return { chat: answer, report: "" };

    // Pas de séparateur mais une réponse longue ou structurée : le premier paragraphe en prose
    // reste dans la bulle, le reste devient le développement.
    const [first, ...rest] = answer.split(/\n{2,}/);
    if (!STRUCTURE.test(first) && first.length <= CHAT_MAX_CHARS && rest.length > 0) {
        return { chat: first.trim(), report: rest.join("\n\n").trim() };
    }
    return { chat: FALLBACK_CHAT, report: answer };
}

// Pendant la génération : tout va dans la bulle jusqu'au séparateur, la suite dans le développement.
export function splitPartial(text) {
    const match = SEPARATOR.exec(text);
    if (!match) return { chat: text, report: "" };
    return { chat: text.slice(0, match.index), report: text.slice(match.index + match[0].length) };
}

// Markdown réduit (titres, listes, gras, citations [n]) → HTML sûr.
export function renderReport(markdown, sourceCount = 0) {
    const inline = (text) => escapeHTML(text)
        .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
        .replace(/\[(\d+)\]/g, (match, n) => (Number(n) >= 1 && Number(n) <= sourceCount ? `<sup class="fn-ref">${n}</sup>` : match));

    const html = [];
    let list = null;
    const closeList = () => {
        if (list) html.push(`</${list}>`);
        list = null;
    };
    for (const raw of String(markdown).split("\n")) {
        const line = raw.trim();
        const heading = /^(#{1,4})\s+(.*)$/.exec(line);
        const bullet = /^[-*•]\s+(.*)$/.exec(line);
        const numbered = /^\d+[.)]\s+(.*)$/.exec(line);
        if (heading) {
            closeList();
            html.push(heading[1].length <= 2 ? `<h3>${inline(heading[2])}</h3>` : `<h4>${inline(heading[2])}</h4>`);
        } else if (bullet || numbered) {
            const kind = bullet ? "ul" : "ol";
            if (list !== kind) {
                closeList();
                html.push(`<${kind}>`);
                list = kind;
            }
            html.push(`<li>${inline((bullet ?? numbered)[1])}</li>`);
        } else if (line) {
            closeList();
            html.push(`<p>${inline(line)}</p>`);
        } else {
            closeList();
        }
    }
    closeList();
    return html.join("");
}

// Liste courte écrite par le modèle (une idée par ligne) : sans puces, numéros, gras ni doublons.
export function parseLines(text, max = 4) {
    const seen = new Set();
    return String(text ?? "").split("\n")
        .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").replace(/\*\*/g, "").replace(/[.:;]+$/, "").trim())
        .filter((line) => line.length >= 3 && line.length <= 80)
        .filter((line) => !seen.has(line.toLowerCase()) && seen.add(line.toLowerCase()))
        .slice(0, max);
}
