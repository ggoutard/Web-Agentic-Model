import { $, escapeHTML } from "./ui_utils.js";
import { loadFile } from "./file_store.js";
import { loadPdfjs, openPdf, pageTexts } from "./pdf_text.js";
import { bestPage, highlightRun } from "./locate.js";

const QUOTE_CHARS = 420;

/**
 * Visionneuse de citation, au-dessus de toute l'interface : la page du document d'origine, au premier
 * plan sur un voile bleu, avec le passage cité surligné et repris en citation.
 * Un PDF conservé s'affiche tel quel (pdf.js) ; un document texte, comme une feuille.
 */
export function createViewer({ findDocument }) {
    const ui = {
        root: $("viewer"),
        name: $("viewer-name"),
        page: $("viewer-page"),
        prev: $("viewer-prev"),
        next: $("viewer-next"),
        stage: $("viewer-stage"),
        sheet: $("viewer-sheet"),
        quote: $("viewer-quote"),
    };
    let current = null;
    let opener = null;

    async function open({ document: name, passage = "", page = null }) {
        close();
        opener = document.activeElement;
        const doc = findDocument(name);
        current = { name, passage, page: 1, pages: 1, target: null, pdf: null, doc, token: Symbol("view") };
        const view = current;
        ui.name.textContent = doc?.title || name;
        ui.quote.innerHTML = passage ? `<p>« ${escapeHTML(excerpt(passage))} »</p><cite>${escapeHTML(doc?.title || name)}</cite>` : "";
        ui.quote.hidden = !passage;
        ui.sheet.className = "viewer-sheet is-loading";
        ui.sheet.replaceChildren();
        ui.page.textContent = "";
        ui.root.hidden = false;
        document.body.classList.add("is-viewing");
        ui.root.querySelector("#viewer-close").focus();

        const blob = doc?.pdf ? await loadFile(doc.id) : null;
        if (view !== current) return;
        if (!blob) {
            showText(doc, passage);
            return;
        }
        try {
            view.pdf = await openPdf(blob);
            if (view !== current) {
                view.pdf.destroy();
                return;
            }
            view.pages = view.pdf.numPages;
            view.target = page ?? (passage ? bestPage(passage, await pageTexts(view.pdf)).page : 1);
            if (view !== current) return;
            await showPage(view.target);
        } catch (error) {
            console.warn("Visionneuse :", error);
            showText(doc, passage);
        }
    }

    // Page du PDF, à la taille de l'écran ; le passage est surligné sur la page où il se trouve.
    async function showPage(number) {
        const view = current;
        const { Util } = await loadPdfjs();
        const page = await view.pdf.getPage(number);
        if (view !== current) return;
        view.page = number;
        ui.page.textContent = `page ${number} / ${view.pages}`;
        ui.prev.disabled = number <= 1;
        ui.next.disabled = number >= view.pages;

        const base = page.getViewport({ scale: 1 });
        const scale = Math.min((ui.stage.clientWidth - 32) / base.width, (ui.stage.clientHeight - 24) / base.height, 2.2);
        const viewport = page.getViewport({ scale });
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        const canvas = document.createElement("canvas");
        canvas.width = Math.floor(viewport.width * ratio);
        canvas.height = Math.floor(viewport.height * ratio);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        await page.render({ canvasContext: canvas.getContext("2d"), viewport, transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : null }).promise;
        if (view !== current) return;

        const marks = [];
        if (view.passage && number === view.target) {
            const { items } = await page.getTextContent();
            const run = highlightRun(view.passage, items.map((item) => item.str));
            if (run) {
                for (const item of items.slice(run.start, run.end + 1)) {
                    if (!item.str.trim()) continue;
                    const [, , c, d, x, y] = Util.transform(viewport.transform, item.transform);
                    const height = Math.hypot(c, d);
                    const mark = document.createElement("span");
                    mark.className = "viewer-mark";
                    mark.style.left = `${x - 2}px`;
                    mark.style.top = `${y - height - 1}px`;
                    mark.style.width = `${item.width * scale + 4}px`;
                    mark.style.height = `${height * 1.25 + 2}px`;
                    marks.push(mark);
                }
            }
        }
        page.cleanup();
        ui.sheet.className = "viewer-sheet";
        ui.sheet.style.width = `${viewport.width}px`;
        ui.sheet.style.height = `${viewport.height}px`;
        ui.sheet.replaceChildren(canvas, ...marks);
        marks[0]?.scrollIntoView({ block: "center", behavior: "smooth" });
    }

    // Document texte (ou PDF non conservé) : une feuille avec le texte, le passage surligné.
    function showText(doc, passage) {
        ui.page.textContent = "";
        ui.prev.disabled = ui.next.disabled = true;
        ui.sheet.className = "viewer-sheet is-text";
        ui.sheet.style.width = ui.sheet.style.height = "";
        if (!doc) {
            ui.sheet.innerHTML = `<p class="viewer-missing">Ce document n'est plus dans ma mémoire.</p>`;
            return;
        }
        const lines = String(doc.text).split(/\n/);
        const run = passage ? highlightRun(passage, lines) : null;
        ui.sheet.innerHTML = lines.map((line, i) => {
            const html = escapeHTML(line) || "&nbsp;";
            return run && i >= run.start && i <= run.end ? `<p><mark>${html}</mark></p>` : `<p>${html}</p>`;
        }).join("");
        ui.sheet.querySelector("mark")?.scrollIntoView({ block: "center" });
    }

    function close() {
        if (!current) return;
        current.pdf?.destroy();
        current = null;
        ui.root.hidden = true;
        document.body.classList.remove("is-viewing");
        opener?.focus?.();
    }

    ui.prev.addEventListener("click", () => current?.pdf && current.page > 1 && showPage(current.page - 1));
    ui.next.addEventListener("click", () => current?.pdf && current.page < current.pages && showPage(current.page + 1));
    $("viewer-close").addEventListener("click", close);
    // Un clic sur le voile (hors de la page et de la citation) referme.
    ui.root.addEventListener("click", (event) => {
        if (event.target === ui.root || event.target === ui.stage) close();
    });
    document.addEventListener("keydown", (event) => {
        if (!current) return;
        if (event.key === "Escape") close();
        else if (event.key === "ArrowLeft") ui.prev.click();
        else if (event.key === "ArrowRight") ui.next.click();
    });

    return { open, close };
}

function excerpt(text) {
    const clean = String(text).replace(/\s+/g, " ").trim();
    return clean.length > QUOTE_CHARS ? `${clean.slice(0, QUOTE_CHARS - 1)}…` : clean;
}
