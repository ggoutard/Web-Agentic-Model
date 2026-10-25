export const $ = (id) => document.getElementById(id);

export function escapeHTML(str) {
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

export const formatNumber = (value, digits = 0) =>
    value.toLocaleString("fr-FR", { maximumFractionDigits: digits, minimumFractionDigits: digits });

export const formatMs = (ms) => (ms < 1 ? "< 1 ms" : ms < 1000 ? `${Math.round(ms)} ms` : `${formatNumber(ms / 1000, 1)} s`);

// Mise en forme légère d'une réponse : paragraphes, gras, puces,
// et appels de note [n] lorsque n correspond à une source affichée.
export function renderAnswer(text, sourceCount = 0) {
    return escapeHTML(text)
        .split(/\n{2,}/)
        .map((paragraph) => paragraph
            .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
            .replace(/^\s*[-*]\s+/gm, "— ")
            .replace(/\[(\d+)\]/g, (match, n) => (Number(n) >= 1 && Number(n) <= sourceCount ? `<sup class="fn-ref">${n}</sup>` : match))
            .replace(/\n/g, "<br>"))
        .map((paragraph) => `<p>${paragraph}</p>`)
        .join("");
}

export function autoResize(textarea) {
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
}

// Animation FLIP : `mutate` change la mise en page, l'élément glisse de son ancienne position à la nouvelle.
// L'échelle est la même sur les deux axes (alignée sur le centre) pour ne jamais déformer le contenu.
export function flip(element, mutate, { duration = 550 } = {}) {
    const first = element.getBoundingClientRect();
    mutate();
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const last = element.getBoundingClientRect();
    if (last.width === 0 || last.height === 0) return;
    const scale = Math.min(first.width / last.width, first.height / last.height);
    const dx = first.left + first.width / 2 - (last.left + last.width / 2);
    const dy = first.top + first.height / 2 - (last.top + last.height / 2);
    element.animate([
        { transformOrigin: "center", transform: `translate(${dx}px, ${dy}px) scale(${scale})` },
        { transformOrigin: "center", transform: "none" },
    ], { duration, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" });
}
