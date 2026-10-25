// Le développement rédigé par le personnage, mis en page en PDF (A4) : titre, demande, « En bref »,
// sections, listes, livrables et sources. jsPDF n'est chargé qu'au premier export.

const JSPDF_URL = new URL("./vendor/jspdf/jspdf.umd.min.js", import.meta.url).href;
const PAGE = { width: 210, height: 297, margin: 20 };
const ACCENT = [43, 90, 160];
const INK = [29, 29, 34];
const MUTED = [110, 112, 120];

let loading = null;

function loadJsPdf() {
    loading ??= new Promise((resolve, reject) => {
        if (window.jspdf) {
            resolve(window.jspdf.jsPDF);
            return;
        }
        const script = document.createElement("script");
        script.src = JSPDF_URL;
        script.onload = () => resolve(window.jspdf.jsPDF);
        script.onerror = () => {
            loading = null;
            reject(new Error("Export PDF indisponible."));
        };
        document.head.append(script);
    });
    return loading;
}

// Les polices standard du PDF ne couvrent que l'alphabet latin (WinAnsi) : on remplace le reste.
const REPLACEMENTS = { "→": "->", "←": "<-", "≥": ">=", "≤": "<=", "≈": "~", "×": "x", "✓": "-", "✔": "-", "✕": "x", " ": " ", " ": " " };
export function pdfSafe(text) {
    return String(text ?? "")
        .replace(/[→←≥≤≈×✓✔✕  ]/g, (c) => REPLACEMENTS[c])
        .replace(/\p{Extended_Pictographic}️?/gu, "")
        .replace(/[^\x09\x0a\x0d\x20-\x7e -ÿ€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]/g, "");
}

// Markdown réduit (celui de renderReport) → blocs à mettre en page.
export function reportBlocks(markdown) {
    const blocks = [];
    let number = 0;
    for (const raw of String(markdown ?? "").split("\n")) {
        const line = raw.trim();
        const heading = /^(#{1,4})\s+(.*)$/.exec(line);
        const bullet = /^[-*•]\s+(.*)$/.exec(line);
        const numbered = /^(\d+)[.)]\s+(.*)$/.exec(line);
        if (heading) blocks.push({ type: heading[1].length <= 2 ? "h2" : "h3", text: heading[2] });
        else if (bullet) blocks.push({ type: "li", text: bullet[1] });
        else if (numbered) blocks.push({ type: "ol", text: numbered[2], n: Number(numbered[1]) || ++number });
        else if (line) blocks.push({ type: "p", text: line });
        if (!numbered) number = 0;
    }
    return blocks;
}

// Segments de texte en gras (**…**) ou non.
export function inlineRuns(text) {
    return String(text).split(/(\*\*[^*]+\*\*)/).filter(Boolean).map((part) =>
        part.startsWith("**") && part.endsWith("**") ? { text: part.slice(2, -2), bold: true } : { text: part, bold: false });
}

export function reportTitle(record) {
    return String(record.title ?? "").trim() || "Rapport";
}

/** Construit le PDF et lance le téléchargement. `author` : nom du personnage. */
export async function downloadReportPdf(record, options = {}) {
    const doc = await buildReportPdf(record, options);
    doc.save(`${fileName(record)}.pdf`);
}

export async function buildReportPdf(record, { author = "" } = {}) {
    const JsPDF = await loadJsPdf();
    const doc = new JsPDF({ unit: "mm", format: "a4" });
    const width = PAGE.width - PAGE.margin * 2;
    let y = PAGE.margin;

    const ensure = (height) => {
        if (y + height <= PAGE.height - PAGE.margin) return;
        doc.addPage();
        y = PAGE.margin;
    };

    // Texte enrichi (gras) avec retour à la ligne, mot par mot.
    function rich(text, { x = PAGE.margin, maxWidth = width, size = 11, lineHeight = 5.6, color = INK, italic = false } = {}) {
        doc.setFontSize(size);
        doc.setTextColor(...color);
        const words = [];
        for (const run of inlineRuns(pdfSafe(text))) {
            for (const word of run.text.split(/(?<=\s)/)) if (word) words.push({ word, bold: run.bold });
        }
        const style = (bold) => (bold ? (italic ? "bolditalic" : "bold") : italic ? "italic" : "normal");
        let line = [];
        let lineWidth = 0;
        const flush = () => {
            ensure(lineHeight);
            let cursor = x;
            for (const piece of line) {
                doc.setFont("helvetica", style(piece.bold));
                doc.text(piece.word, cursor, y);
                cursor += doc.getTextWidth(piece.word);
            }
            y += lineHeight;
            line = [];
            lineWidth = 0;
        };
        for (const piece of words) {
            doc.setFont("helvetica", style(piece.bold));
            const w = doc.getTextWidth(piece.word);
            if (lineWidth + doc.getTextWidth(piece.word.trimEnd()) > maxWidth && line.length) flush();
            if (line.length === 0 && !piece.word.trim()) continue;
            line.push(piece);
            lineWidth += w;
        }
        if (line.length) flush();
    }

    // En-tête : rubrique, titre, demande, auteur et date.
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(...ACCENT);
    doc.text(record.kind === "document" ? "FICHE DE LECTURE" : "RAPPORT", PAGE.margin, y);
    y += 9;
    rich(reportTitle(record), { size: 20, lineHeight: 8.5 });
    const date = new Date(record.createdAt ?? Date.now()).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
    rich([author && `Rédigé par ${author}`, date].filter(Boolean).join(" · "), { size: 9.5, color: MUTED });
    y += 2;
    doc.setDrawColor(...ACCENT);
    doc.setLineWidth(0.6);
    doc.line(PAGE.margin, y, PAGE.margin + 30, y);
    y += 9;

    // L'essentiel en une phrase, dans un encadré.
    if (record.summary) {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(11);
        const lines = doc.splitTextToSize(pdfSafe(record.summary.replace(/\*\*/g, "")), width - 10);
        const height = lines.length * 5.6 + 8;
        ensure(height);
        doc.setFillColor(238, 243, 250);
        doc.roundedRect(PAGE.margin, y - 5, width, height, 2, 2, "F");
        y += 1;
        rich(`**En bref.** ${record.summary}`, { x: PAGE.margin + 5, maxWidth: width - 10 });
        y += 6;
    }

    const section = (title) => {
        y += 3;
        ensure(16);
        rich(title, { size: 14, lineHeight: 7, color: ACCENT });
        y += 1;
    };
    for (const block of reportBlocks(record.report)) {
        if (block.type === "h2") section(block.text);
        else if (block.type === "h3") {
            y += 1.5;
            ensure(12);
            rich(`**${block.text.replace(/\*\*/g, "")}**`, { size: 12, lineHeight: 6 });
        } else if (block.type === "li" || block.type === "ol") {
            ensure(5.6);
            doc.setFont("helvetica", "normal");
            doc.setFontSize(11);
            doc.setTextColor(...ACCENT);
            doc.text(block.type === "li" ? "•" : `${block.n}.`, PAGE.margin + 1.5, y);
            rich(block.text, { x: PAGE.margin + 7, maxWidth: width - 7 });
            y += 0.8;
        } else {
            rich(block.text);
            y += 2.2;
        }
    }

    for (const item of record.deliverables ?? []) {
        section(item.title);
        for (const paragraph of String(item.content).split(/\n+/)) {
            rich(paragraph);
            y += 2;
        }
    }

    // Sources : un document par ligne, avec les numéros des passages cités.
    if (record.sources?.length) {
        section("Sources");
        const byDocument = new Map();
        for (const source of record.sources) byDocument.set(source.document, [...(byDocument.get(source.document) ?? []), source.index]);
        for (const [name, indexes] of byDocument) rich(`[${indexes.join(", ")}] ${name}`, { size: 9.5, lineHeight: 5, color: MUTED });
    }

    // Pied de page sur chaque page.
    const pages = doc.getNumberOfPages();
    for (let page = 1; page <= pages; page++) {
        doc.setPage(page);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8.5);
        doc.setTextColor(...MUTED);
        doc.text(pdfSafe(`${reportTitle(record)} — page ${page} / ${pages}`), PAGE.width / 2, PAGE.height - 10, { align: "center" });
    }

    return doc;
}

export function fileName(record) {
    return pdfSafe(record.title).replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "rapport";
}
