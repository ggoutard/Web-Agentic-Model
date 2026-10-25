import { $, escapeHTML } from "./ui_utils.js";
import { downloadReportPdf } from "./report_pdf.js";

const STORAGE_KEY = "secretary-mailbox";
const MAX_LETTERS = 40;
const KIND_LABELS = { question: "Rapport", document: "Lecture", agent: "Mission", extrait: "Extrait" };

const DOWNLOAD_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 19h14"/></svg>`;
const DELETE_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12"/></svg>`;

/**
 * Boîte aux lettres : les livrables demandés (rapports, notes, courriers…) y sont déposés par le
 * personnage. On peut les rouvrir dans le volet de droite, les télécharger ou les supprimer.
 * Conservée dans le navigateur.
 */
export function createMailbox({ button, onOpen, getAuthor = () => "" }) {
    const dialog = $("mailbox-dialog");
    const list = $("mailbox-list");
    const empty = $("mailbox-empty");
    let letters = load();

    function render() {
        const unread = letters.filter((letter) => !letter.read).length;
        button.dataset.count = unread > 0 ? String(unread) : "";
        button.setAttribute("aria-label", unread > 0 ? `Boîte aux lettres, ${unread} non lu${unread > 1 ? "s" : ""}` : "Boîte aux lettres");
        empty.hidden = letters.length > 0;
        list.replaceChildren(...letters.map((letter) => {
            const item = document.createElement("li");
            const date = new Date(letter.createdAt).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
            item.className = "letter-row";
            item.innerHTML = `
                <button type="button" class="letter" data-unread="${!letter.read}">
                    <span class="letter-kind">${escapeHTML(KIND_LABELS[letter.kind] ?? "Rapport")} · ${escapeHTML(date)}</span>
                    <span class="letter-title">${escapeHTML(letter.title)}</span>
                </button>
                <button type="button" class="icon-btn" data-action="download" aria-label="Télécharger « ${escapeHTML(letter.title)} » en PDF" title="Télécharger en PDF">${DOWNLOAD_ICON}</button>
                <button type="button" class="icon-btn" data-action="delete" aria-label="Supprimer « ${escapeHTML(letter.title)} »" title="Supprimer">${DELETE_ICON}</button>`;
            item.querySelector(".letter").addEventListener("click", () => {
                letter.read = true;
                save();
                render();
                dialog.close();
                onOpen(letter);
            });
            item.querySelector('[data-action="download"]').addEventListener("click", () => {
                downloadReportPdf(letter, { author: getAuthor() }).catch((error) => console.error("Export PDF :", error));
            });
            item.querySelector('[data-action="delete"]').addEventListener("click", () => {
                letters = letters.filter((l) => l.id !== letter.id);
                save();
                render();
            });
            return item;
        }));
    }

    function save() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(letters));
        } catch {
            console.warn("Stockage local indisponible : la boîte aux lettres ne sera pas conservée.");
        }
    }

    button.addEventListener("click", () => dialog.showModal());
    dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });
    render();

    return {
        deliver(record) {
            letters = [{ ...structuredClone(record), read: false }, ...letters.filter((l) => l.id !== record.id)].slice(0, MAX_LETTERS);
            save();
            render();
        },
        markRead(id) {
            const letter = letters.find((l) => l.id === id);
            if (letter && !letter.read) {
                letter.read = true;
                save();
                render();
            }
        },
        find: (id) => letters.find((l) => l.id === id),
    };
}

function load() {
    try {
        const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
        return Array.isArray(stored) ? stored : [];
    } catch {
        return [];
    }
}
