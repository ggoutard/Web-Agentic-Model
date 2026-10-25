import { $, escapeHTML } from "./ui_utils.js";
import { renderReport } from "./answer_format.js";
import { downloadReportPdf } from "./report_pdf.js";

const STATUS_LABELS = { running: "En cours", done: "Terminé", stopped: "Interrompu", error: "Erreur" };
const TYPING = `<span class="typing"><i></i><i></i><i></i></span>`;
const PDF_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 19h14"/></svg>`;

/**
 * Volet de droite : toute la conversation, avec, pour chaque réponse, les actions de l'agent
 * (son « ordinateur », ligne par ligne), la réponse, puis le développement et ses sources.
 *
 * Chaque réponse est un simple objet (enregistrable dans la boîte aux lettres) :
 *   { id, kind, title, status, steps: [{ text, detail, state }], report, sources, deliverables, createdAt }
 */
export function createMissionPanel({ app, toggle, getOwner, onCite = () => {} }) {
    const ui = {
        panel: $("mission"),
        log: $("chat-log"),
        empty: $("chat-empty"),
    };
    const turns = new Map();
    // Ouvert automatiquement au premier message sur grand écran, sauf si l'utilisateur l'a refermé.
    let closedByUser = false;

    function setOpen(open) {
        if (open) app.dataset.mission = "open";
        else delete app.dataset.mission;
        ui.panel.inert = !open;
        toggle.setAttribute("aria-expanded", String(open));
    }

    function append(item) {
        ui.log.append(item);
        ui.empty.hidden = true;
        if (!closedByUser && app.dataset.mission !== "open" && matchMedia("(min-width: 1100px)").matches) setOpen(true);
        scrollToEnd();
        return item;
    }

    // On ne suit le bas que si l'utilisateur y est déjà : il peut remonter lire pendant l'écriture.
    function scrollToEnd(force = false) {
        const { log } = ui;
        if (force || log.scrollHeight - log.scrollTop - log.clientHeight < 120) log.scrollTop = log.scrollHeight;
    }

    function message(className, html) {
        const item = document.createElement("li");
        item.className = `chat-msg ${className}`;
        item.innerHTML = html;
        return append(item);
    }

    function turnElement(record) {
        const item = document.createElement("li");
        item.className = "chat-msg chat-assistant turn";
        item.dataset.id = record.id;
        item.innerHTML = `
            <details class="computer">
                <summary class="computer-bar"><i></i><i></i><i></i><span>Ordinateur de <b></b></span><span class="computer-count"></span><span class="computer-status"></span></summary>
                <ol class="computer-log"></ol>
            </details>
            <ul class="turn-remarks" hidden></ul>
            <div class="turn-answer">${TYPING}</div>
            <article class="report" hidden></article>
            <div class="sources" hidden></div>
            <div class="turn-tools" hidden><button type="button" class="report-link report-pdf">${PDF_ICON}Télécharger en PDF</button></div>`;
        const parts = {
            item,
            computer: item.querySelector(".computer"),
            owner: item.querySelector(".computer-bar b"),
            count: item.querySelector(".computer-count"),
            status: item.querySelector(".computer-status"),
            log: item.querySelector(".computer-log"),
            remarks: item.querySelector(".turn-remarks"),
            answer: item.querySelector(".turn-answer"),
            report: item.querySelector(".report"),
            sources: item.querySelector(".sources"),
            record,
            tools: item.querySelector(".turn-tools"),
            steps: new Map(),
        };
        parts.owner.textContent = getOwner();
        parts.tools.querySelector(".report-pdf").addEventListener("click", async (event) => {
            const button = event.currentTarget;
            button.disabled = true;
            try {
                await downloadReportPdf(record, { author: getOwner() });
            } catch (error) {
                console.error("Export PDF :", error);
            } finally {
                button.disabled = false;
            }
        });
        for (const step of record.steps) parts.log.append(stepElement(parts, step));
        turns.set(record.id, parts);
        renderStatus(parts, record);
        renderBody(parts, record);
        return parts;
    }

    function renderStatus(parts, record) {
        parts.item.dataset.state = record.status;
        parts.status.textContent = STATUS_LABELS[record.status];
        parts.status.dataset.state = record.status;
        const count = record.steps.length;
        parts.count.textContent = `${count} action${count > 1 ? "s" : ""}`;
    }

    function renderBody(parts, record) {
        const deliverables = record.deliverables.map((d) => `
            <section class="report-deliverable"><h4>${escapeHTML(d.title)}</h4><p>${escapeHTML(d.content)}</p></section>`).join("");
        parts.report.innerHTML = renderReport(record.report, record.sources.length) + deliverables;
        parts.report.hidden = !record.report && record.deliverables.length === 0;
        // Une puce par document, avec les numéros des passages cités.
        const byDocument = new Map();
        for (const source of record.sources) byDocument.set(source.document, [...(byDocument.get(source.document) ?? []), source]);
        parts.sources.innerHTML = [...byDocument].map(([document, passages]) =>
            `<span class="source" role="button" tabindex="0" data-source="${passages[0].index}" title="Voir le passage dans le document"><b>${passages.map((p) => p.index).join(", ")}</b><span>${escapeHTML(document)}</span></span>`).join("");
        markCitations(parts.report, record.sources);
        parts.sources.hidden = record.sources.length === 0;
        // Document terminé : il peut sortir en PDF.
        parts.tools.hidden = record.status !== "done" || parts.report.hidden;
    }

    function stepElement(parts, step) {
        const item = document.createElement("li");
        item.className = "computer-line";
        parts.steps.set(step, item);
        updateStep(parts, step);
        return item;
    }

    function updateStep(parts, step) {
        const item = parts.steps.get(step);
        if (!item) return;
        item.dataset.state = step.state;
        item.innerHTML = `<span class="computer-text">${escapeHTML(step.text)}</span>${step.detail ? `<span class="computer-detail">${escapeHTML(step.detail)}</span>` : ""}`;
    }

    // Commence une réponse dans la conversation ; renvoie de quoi la faire avancer.
    function begin({ kind, title }) {
        const record = {
            id: crypto.randomUUID(),
            kind,
            title,
            status: "running",
            steps: [],
            report: "",
            sources: [],
            deliverables: [],
            createdAt: Date.now(),
        };
        if (kind === "document") message("chat-note", `Document déposé : <b>${escapeHTML(title)}</b>`);
        const parts = turnElement(record);
        // Les actions restent visibles pendant le travail, puis se replient.
        parts.computer.open = true;
        append(parts.item);
        let reportFrame = 0;

        return {
            record,
            // La feuille du développement, vers laquelle le personnage lance son document.
            reportElement: parts.report,
            reveal() {
                setOpen(true);
            },
            step(text, detail = "") {
                const step = { text, detail, state: "running" };
                record.steps.push(step);
                parts.log.append(stepElement(parts, step));
                parts.log.scrollTop = parts.log.scrollHeight;
                renderStatus(parts, record);
                scrollToEnd();
                const settle = (state) => (next = "") => {
                    step.state = state;
                    step.detail = next || step.detail;
                    updateStep(parts, step);
                };
                return { done: settle("done"), fail: settle("error"), update: (next) => { step.detail = next; updateStep(parts, step); } };
            },
            // Remarque de l'utilisateur reçue pendant le travail : elle s'affiche dans cet échange.
            remark(text) {
                const line = document.createElement("li");
                line.className = "chat-msg chat-user";
                line.textContent = text;
                parts.remarks.append(line);
                parts.remarks.hidden = false;
                scrollToEnd(true);
            },
            // Réponse courte (HTML déjà échappé), éventuellement en cours d'écriture.
            answer(html) {
                parts.answer.innerHTML = html;
                markCitations(parts.answer, record.sources);
                parts.answer.hidden = false;
                scrollToEnd();
            },
            // Rapport en cours d'écriture : un rendu par image au plus.
            report(markdown) {
                record.report = markdown;
                if (reportFrame) return;
                reportFrame = requestAnimationFrame(() => {
                    reportFrame = 0;
                    renderBody(parts, record);
                    scrollToEnd();
                });
            },
            retitle(next) {
                record.title = next;
            },
            sources(list) {
                record.sources = list;
                renderBody(parts, record);
            },
            deliverable(item) {
                record.deliverables.push(item);
                renderBody(parts, record);
            },
            finish(status) {
                record.status = status;
                for (const step of record.steps) {
                    if (step.state === "running") {
                        step.state = status === "done" ? "done" : "error";
                        updateStep(parts, step);
                    }
                }
                cancelAnimationFrame(reportFrame);
                reportFrame = 0;
                renderStatus(parts, record);
                renderBody(parts, record);
                if (status === "done") parts.computer.open = false;
                // Plus rien à attendre : on retire les points de suspension restés sans réponse.
                if (parts.answer.querySelector(".typing")) parts.answer.hidden = true;
                return record;
            },
        };
    }

    // Affiche une réponse : celle de la conversation si elle y est encore, sinon une copie archivée.
    function show(record) {
        let parts = turns.get(record.id);
        if (!parts) {
            message("chat-note", "Depuis la boîte aux lettres");
            parts = turnElement(record);
            parts.answer.remove();
            append(parts.item);
        }
        setOpen(true);
        parts.item.scrollIntoView({ block: "start", behavior: "smooth" });
        parts.item.classList.remove("is-flash");
        void parts.item.offsetWidth;
        parts.item.classList.add("is-flash");
    }

    // Un numéro de citation ou une source : la visionneuse montre le passage dans son document.
    function cite(event) {
        const target = event.target.closest("[data-source]");
        const turn = target?.closest(".turn");
        if (!turn) return;
        const record = [...turns.values()].find((parts) => parts.item === turn)?.record;
        const source = record?.sources.find((s) => String(s.index) === target.dataset.source);
        if (source) onCite(source);
    }
    ui.log.addEventListener("click", cite);
    ui.log.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") cite(event);
    });

    toggle.addEventListener("click", () => {
        const open = app.dataset.mission !== "open";
        closedByUser = !open;
        setOpen(open);
    });
    $("mission-close").addEventListener("click", () => {
        closedByUser = true;
        setOpen(false);
    });
    setOpen(false);

    return {
        begin,
        show,
        user(text) {
            message("chat-user", escapeHTML(text));
        },
        note(html) {
            message("chat-note", html);
        },
    };
}

// Les numéros [n] qui renvoient à une source deviennent cliquables.
export function markCitations(container, sources) {
    for (const ref of container.querySelectorAll(".fn-ref")) {
        if (!sources.some((source) => String(source.index) === ref.textContent)) continue;
        ref.dataset.source = ref.textContent;
        ref.title = "Voir le passage dans le document";
    }
}
