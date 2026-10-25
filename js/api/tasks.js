import { taskMessages, cleanRewrite, repairMarkers, readingMessages, splitDocument, countWords, isEmptyNote, FULL_WORDS, placeMessages, parsePlace, writeMessages, targetMessages } from "../agents/editor.js";

// Une demande venue d'une autre page (API) : ce qu'il annonce faire, sa réflexion, puis sa réponse, au fil de l'eau.
// Commun au mode léger (api.html, sans interface) et au mode avec personnage (bridge.js).

// La réflexion s'ajoute à la réponse : de quoi réfléchir sans manquer de place pour répondre.
const THINK_TOKENS = 600;
// Sans consigne, le modèle réfléchit longuement, en anglais.
const THINK_HINT = "\nAvant de répondre, réfléchis brièvement, en français, en quelques lignes.";
// Envoi de la réflexion et du texte en cours : au plus un message tous les PARTIAL_MS.
const PARTIAL_MS = 120;

// Ce qu'il va faire, dit en une phrase avant de commencer.
export function announce(task, rewrite) {
    const total = countWords(task.document);
    if (!rewrite && total) {
        const parts = total > FULL_WORDS ? splitDocument(task.document).length : 1;
        return parts > 1 ? `Je lis tout le document (${total} mots), en ${parts} parties, puis je réponds.` : `Je lis tout le document (${total} mots), puis je réponds.`;
    }
    const words = String(task.text ?? "").split(/\s+/).filter(Boolean).length;
    const passage = words ? `le passage (${words} mot${words > 1 ? "s" : ""})` : "";
    if (rewrite) return `Je relis ${passage || "le texte"} et je le réécris.`;
    return passage ? `Je lis ${passage}, puis je réponds.` : "Je réfléchis à votre demande.";
}

/**
 * Exécute une demande. task : { action, instruction, text, title, think, document }.
 * document : la page entière. Trop longue pour être lue d'un coup, il la lit partie par partie et prend des notes
 * (montrées comme sa réflexion), puis répond à partir de ses notes.
 * emit reçoit { type: "step", text } · { type: "thought", text } · { type: "partial", text } (textes complets).
 * Renvoie { text, rewrite, thought } ; une demande arrêtée (signal) renvoie ce qui était écrit.
 */
export async function runTask(adapter, task, emit, signal) {
    if (task.action === "insert") return insertTask(adapter, task, emit, signal);
    if (task.action === "locate") {
        // Quelle partie modifier : task.outline, [{ label }]. Renvoie { place } (null : il ne sait pas).
        emit({ type: "step", text: "Je cherche la partie à modifier…" });
        const { messages, maxTokens } = targetMessages({ instruction: task.instruction, outline: task.outline ?? [], title: task.title });
        return { text: "", rewrite: false, place: parsePlace(await adapter.infer(messages, maxTokens, null, { signal }), task.outline?.length ?? 0) };
    }
    let { messages, maxTokens, rewrite, append } = taskMessages({ ...task, document: "" });
    // Une réécriture se fait sans réfléchir : sa réflexion prendrait toute la place du texte réécrit.
    const think = Boolean(task.think) && !rewrite;
    emit({ type: "step", text: announce(task, rewrite) });
    // Ses notes de lecture restent en tête de sa réflexion.
    let journal = "";
    if (!rewrite && task.document?.trim()) {
        const reading = countWords(task.document) > FULL_WORDS ? await readAll(adapter, task, emit, signal) : null;
        const notes = reading?.notes ?? null;
        journal = reading ? `${reading.journal}\n` : "";
        ({ messages, maxTokens } = taskMessages(notes === null ? task : { ...task, document: "", notes: notes || "Rien dans le document ne répond directement à la demande." }));
        if (signal?.aborted) return { text: "", rewrite, thought: "" };
    }

    let thought = "";
    const throttled = (type) => {
        let last = 0;
        return (text) => {
            if (type === "thought") text = thought = journal + text;
            const now = performance.now();
            if (now - last < PARTIAL_MS) return;
            last = now;
            emit({ type, text });
        };
    };
    const onThought = throttled("thought");
    const onText = throttled("partial");

    if (think) messages = [{ ...messages[0], content: messages[0].content + THINK_HINT }, ...messages.slice(1)];
    let reply = await adapter.infer(messages, maxTokens + (think ? THINK_TOKENS : 0), onText, { signal, think, onThought });
    if (thought) emit({ type: "thought", text: thought });
    else thought = journal.trim();
    // Toute la place prise par la réflexion : il répond sans réfléchir.
    if (think && !reply && !signal?.aborted) {
        emit({ type: "step", text: "J'ai assez réfléchi, je réponds." });
        reply = await adapter.infer(messages, maxTokens, onText, { signal });
    }
    // Une réécriture garde les marqueurs (formules, code, liens) du passage, même si le modèle les a malmenés.
    // Rendu tel quel alors qu'on demandait un changement précis (du code, une consigne libre) : un second essai, ferme.
    const flat = (t) => String(t).replace(/\s+/g, " ").trim();
    if (rewrite && !append && task.instruction?.trim() && reply.trim() && flat(cleanRewrite(reply)) === flat(task.text) && !signal?.aborted) {
        emit({ type: "step", text: "Je n'ai rien changé : je recommence." });
        const insist = { role: "user", content: `Tu as renvoyé ${task.code ? "le code" : "le passage"} sans le modifier. Applique vraiment cette consigne : ${task.instruction.trim()}. Réponds uniquement par ${task.code ? "le code modifié" : "le passage modifié"}.` };
        reply = await adapter.infer([...messages, { role: "assistant", content: reply }, insist], maxTokens, onText, { signal });
    }
    // La suite s'ajoute après le passage, gardé tel quel (sans marqueur inventé). Le code n'a pas de marqueurs.
    let text = reply.trim();
    if (rewrite && text) {
        const clean = cleanRewrite(reply);
        text = append ? `${task.text}\n\n${repairMarkers("", clean)}` : task.code ? clean : repairMarkers(task.text, clean);
    }
    return { text, rewrite, thought };
}

// Un long document : chaque partie lue avec la demande en tête, ses notes gardées.
async function readAll(adapter, task, emit, signal) {
    const parts = splitDocument(task.document);
    const notes = [];
    let journal = "";
    for (const [i, part] of parts.entries()) {
        if (signal?.aborted) break;
        emit({ type: "step", text: `Je lis la partie ${i + 1} sur ${parts.length}…` });
        const { messages, maxTokens } = readingMessages({ instruction: task.instruction, part, index: i + 1, of: parts.length, title: task.title });
        const note = (await adapter.infer(messages, maxTokens, null, { signal })).trim();
        const useful = !isEmptyNote(note);
        if (useful) notes.push(`Partie ${i + 1} : ${note}`);
        journal += `Partie ${i + 1}/${parts.length} : ${useful ? note : "rien d'utile ici."}\n`;
        emit({ type: "thought", text: journal });
    }
    emit({ type: "step", text: notes.length ? `J'ai tout lu : ${notes.length} partie${notes.length > 1 ? "s" : ""} utile${notes.length > 1 ? "s" : ""}. Je réponds.` : "J'ai tout lu. Je réponds." });
    return { notes: notes.join("\n"), journal };
}

/**
 * Ajouter du contenu au document. task : { instruction, document, outline: [{ label, text }], title }.
 * Il choisit l'endroit (le numéro d'une ligne du plan ; la dernière : la fin), puis il écrit.
 * Renvoie { text, rewrite: false, insert: true, place } : place, l'index de l'endroit dans le plan.
 */
async function insertTask(adapter, task, emit, signal) {
    const outline = task.outline?.length ? task.outline : [{ label: "la fin du document", text: "" }];
    let place = outline.length - 1;
    if (outline.length > 1) {
        emit({ type: "step", text: "Je lis le plan du document et je cherche où l'ajouter…" });
        const { messages, maxTokens } = placeMessages({ instruction: task.instruction, outline, title: task.title });
        place = parsePlace(await adapter.infer(messages, maxTokens, null, { signal }), outline.length) ?? place;
    }
    if (signal?.aborted) return { text: "", rewrite: false, insert: true, place };
    emit({ type: "step", text: `Je l'ajoute après « ${outline[place].label} ». J'écris…` });
    const document = countWords(task.document) <= FULL_WORDS ? task.document ?? "" : "";
    const { messages, maxTokens } = writeMessages({ instruction: task.instruction, outline, place, title: task.title, document });
    let last = 0;
    const reply = await adapter.infer(messages, maxTokens, (text) => {
        const now = performance.now();
        if (now - last < PARTIAL_MS) return;
        last = now;
        emit({ type: "partial", text });
    }, { signal });
    return { text: cleanRewrite(reply), rewrite: false, insert: true, place };
}
