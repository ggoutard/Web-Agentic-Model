// Découpage d'un document en passages qui respectent sa structure : un passage ne mélange pas deux
// sections, et chacun rappelle le titre de sa section (« La porte de Hadamard » reste attaché à
// son paragraphe, même s'il ne répète pas le mot).

const MAX_WORDS = 110;
const OVERLAP = 20;

const wordCount = (text) => text.split(/\s+/).filter(Boolean).length;

// Ligne qui a l'allure d'un titre : courte, sans ponctuation finale, pas une puce.
export function looksLikeHeading(line) {
    const text = line.trim();
    if (!text || text.length > 70 || wordCount(text) > 9) return false;
    if (/^[-*•●▪◦–]\s*/.test(text) || /[.,;:!?…»)]$/.test(text)) return false;
    return /^(?:\d+(?:\.\d+)*\.?\s+)?[A-ZÀ-ÖØ-Þ]/.test(text);
}

// Paragraphe trop long pour un passage : fenêtres glissantes.
function windows(words) {
    const parts = [];
    for (let i = 0; i < words.length; i += MAX_WORDS - OVERLAP) {
        parts.push(words.slice(i, i + MAX_WORDS).join(" "));
        if (i + MAX_WORDS >= words.length) break;
    }
    return parts;
}

export function chunkText(text) {
    const lines = String(text ?? "").split(/\n/).map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean);
    // Un titre ouvre une section : il est suivi d'un paragraphe. Une suite de lignes courtes
    // (« La porte X », « La porte Y »…) est une liste sans puces, pas une suite de titres.
    const isHeading = (i) => looksLikeHeading(lines[i]) && i + 1 < lines.length && !looksLikeHeading(lines[i + 1]);
    const chunks = [];
    let heading = "";
    let current = [];
    let size = 0;

    const flush = () => {
        const body = current.join("\n").trim();
        if (body) chunks.push(heading && !current[0].startsWith(heading) ? `${heading}\n${body}` : body);
        current = [];
        size = 0;
    };

    for (const [i, line] of lines.entries()) {
        if (isHeading(i)) {
            // Nouvelle section : le passage en cours s'arrête là.
            flush();
            heading = line;
            continue;
        }
        const words = line.split(" ");
        if (words.length > MAX_WORDS) {
            flush();
            for (const part of windows(words)) {
                current = [part];
                flush();
            }
            continue;
        }
        if (size + words.length > MAX_WORDS) flush();
        current.push(line);
        size += words.length;
    }
    flush();
    // Un document fait seulement de titres (ou d'une ligne) : on le garde tel quel.
    if (chunks.length === 0 && String(text ?? "").trim()) return windows(String(text).trim().split(/\s+/));
    return chunks;
}
