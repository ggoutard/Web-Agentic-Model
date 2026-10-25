import { escapeHTML } from "./ui_utils.js";
import { createReader, readFile, readingMessages, parseSheet, fallbackSheet } from "./agents/reader.js";
import { extractPdfText } from "./pdf_text.js";
import { fly, bump, center, handsPoint } from "./fly.js";
import { formatNumber } from "./ui_utils.js";
import { STATUS_LINES } from "./status_lines.js";
import { saveFile } from "./file_store.js";

const READING_TOKENS = 260;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Mise en scène de l'agent lecteur : on dépose un document n'importe où sur la page, le personnage
 * le suit des yeux, le lit et réagit en quelques mots (générés par le modèle). Pendant ce temps, la
 * volet de droite montre chaque étape, puis la fiche du document quand elle a du contenu.
 */
export function createDocumentDrop({ app, characterEl, character, bubble, tray, missions, knowledge, getRuntime, getPersona, restoreMood, onRead }) {
    let dragDepth = 0;
    // Mission en cours pour chaque document.
    const runs = new Map();

    const reader = createReader({
        understand,
        store: (item, sheet) => {
            const doc = knowledge.add(item.name, item.text, {
                title: sheet.title,
                summary: sheet.summary,
                points: sheet.points,
                concepts: sheet.concepts,
                pdf: Boolean(item.file),
            });
            // Le PDF d'origine est gardé pour rouvrir la page d'une citation et y surligner le passage.
            if (item.file) saveFile(doc.id, item.file);
            return doc;
        },
        findDuplicate: (item) => knowledge.documents.find((doc) => doc.text === item.text),
        onEvent: stage,
    });

    // ---------- Étapes visibles ----------

    async function stage(event) {
        const { item } = event;
        switch (event.type) {
        case "received": {
            await fly({ from: item.origin, to: handsPoint(characterEl), character });
            character?.setDocument(item.error ? "none" : "hold");
            character?.gesture("hop");
            bubble.show(escapeHTML(`« ${item.name} »`));
            const mission = missions.begin({ kind: "document", title: item.name });
            runs.set(item, mission);
            const words = item.text ? item.text.split(/\s+/).length : 0;
            mission.step("Réception du document").done(words ? `${formatNumber(words)} mots extraits` : "");
            await sleep(450);
            break;
        }
        case "rejected": {
            const mission = runs.get(item);
            mission?.step("Lecture").fail(event.reason);
            mission?.finish("error");
            runs.delete(item);
            character?.setDocument("none");
            character?.setMood("sad");
            bubble.show(escapeHTML(event.reason));
            await sleep(2200);
            restoreMood();
            bubble.hide();
            break;
        }
        case "reading":
            runs.get(item).reading = runs.get(item).step("Lecture et compréhension", getRuntime() ? "" : "sans modèle : fiche minimale");
            character?.setDocument("read");
            character?.setMood("think");
            bubble.working(STATUS_LINES.reading);
            break;
        case "understood": {
            const mission = runs.get(item);
            mission.reading.done(`${event.sheet.points.length} point${event.sheet.points.length > 1 ? "s" : ""} clé${event.sheet.points.length > 1 ? "s" : ""}`);
            mission.report(sheetReport(event.sheet));
            if (event.sheet.title) mission.retitle(event.sheet.title);
            // La fiche est un développement : elle s'affiche dans le volet de droite.
            if (mission.record.report) mission.reveal();
            character?.setMood("talk");
            bubble.show(escapeHTML(event.sheet.reaction));
            await sleep(1500);
            character?.setMood("idle");
            break;
        }
        case "stored": {
            const mission = runs.get(item);
            runs.delete(item);
            mission.step("Mémorisation pour la recherche").done(`${knowledge.documents.length} document${knowledge.documents.length > 1 ? "s" : ""} en mémoire`);
            const record = mission.finish("done");
            // Le personnage range le document avec les autres (bouton « + »).
            character?.setDocument("toss");
            await fly({ from: handsPoint(characterEl), to: center(tray), character });
            bump(tray);
            restoreMood();
            onRead(item, event.sheet, record, mission);
            break;
        }
        }
    }

    function sheetReport(sheet) {
        return [
            sheet.summary,
            sheet.points.length ? `## Points clés\n${sheet.points.map((point) => `- ${point}`).join("\n")}` : "",
        ].filter(Boolean).join("\n\n");
    }

    async function understand(item) {
        const runtime = getRuntime();
        if (!runtime) {
            await sleep(700);
            return fallbackSheet(item.name, item.text);
        }
        const raw = await runtime.adapter.exclusive(() => runtime.adapter.infer(readingMessages(item, getPersona()), READING_TOKENS));
        return parseSheet(raw, item);
    }

    // ---------- Dépôt sur toute la page ----------

    const hasFiles = (event) => event.dataTransfer?.types.includes("Files");
    const accepting = () => app.dataset.studio !== "open";

    function setDropping(value) {
        if (value) app.dataset.dropping = "true";
        else delete app.dataset.dropping;
        if (!reader.busy) character?.setDocument(value ? "await" : "none");
        if (!value) character?.lookAt(null);
    }

    window.addEventListener("dragenter", (event) => {
        if (!hasFiles(event) || !accepting()) return;
        event.preventDefault();
        if (dragDepth++ === 0) setDropping(true);
    });
    window.addEventListener("dragover", (event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = accepting() ? "copy" : "none";
        if (accepting()) character?.lookAt({ x: event.clientX, y: event.clientY });
    });
    window.addEventListener("dragleave", (event) => {
        if (!hasFiles(event) || !accepting()) return;
        if (--dragDepth <= 0) {
            dragDepth = 0;
            setDropping(false);
        }
    });
    window.addEventListener("drop", (event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        dragDepth = 0;
        setDropping(false);
        if (!accepting()) return;
        receiveFiles([...event.dataTransfer.files], { x: event.clientX, y: event.clientY });
    });

    async function receiveFiles(files, origin) {
        const items = await Promise.all(files.map((file) => readFile(file, origin, { extractPdf: extractPdfText })));
        return reader.enqueue(items);
    }

    return {
        // Fichiers choisis avec le bouton d'import : ils partent du bouton « + ».
        importFiles: (files) => receiveFiles(files, center(tray)),
        importText: (name, text) => reader.enqueue([{ name, text, origin: center(tray) }]),
    };
}
