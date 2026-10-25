// Cubi, l'IA locale de Logical, dans n'importe quelle page : un modèle de langage qui tourne dans le navigateur
// (WebGPU), sans serveur ni compte. Une ligne pour l'intégrer, puis des petites tâches à lui confier.
//
//   import { connect } from "https://ggoutard.github.io/Web-Agentic-Model/sdk/cubi.js";
//   const cubi = connect();                          // mode léger : le modèle seul, rien d'affiché
//   const { text } = await cubi.ask("Résume", { document: texte, onStep, onThought, onText });
//   const { text: propre } = await cubi.rewrite("un texte a corigé", "corriger");
//
// - Mode léger (par défaut) : une iframe invisible (api.html) qui ne charge que le modèle.
// - Avec le personnage : connect({ ui: true, container }) ouvre Logical en entier dans `container` : on le voit
//   travailler. Réservé aux pages du même site (Logical y garde vos documents).
// Le modèle (429 Mo) est téléchargé une fois puis gardé par le navigateur. Rien n'est chargé avant connect().

const BASE = new URL("../", import.meta.url);

// Une demande est-elle une question (une réponse) ou une consigne (un texte) ? Pour aiguiller avant d'envoyer.
export { isQuestion } from "../js/agents/editor.js";

/**
 * Démarre Cubi. options : { ui = false, container, title }.
 * Renvoie { frame, state, on, ask, rewrite, run, cancel, hello, destroy }.
 */
export function connect({ ui = false, container = null, title = document.title } = {}) {
    const src = new URL(ui ? "./" : "api.html", BASE);
    const origin = src.origin;
    if (ui && origin !== location.origin) throw new Error("Cubi avec personnage : seulement sur le même site que Logical. Utilisez le mode léger.");

    const frame = document.createElement("iframe");
    frame.src = src.href;
    frame.title = "Cubi, l'IA locale de Logical";
    if (!ui) {
        // Invisible mais dans la fenêtre : une iframe hors écran ou masquée peut être ralentie par le navigateur.
        frame.setAttribute("aria-hidden", "true");
        frame.tabIndex = -1;
        Object.assign(frame.style, { position: "fixed", right: "0", bottom: "0", width: "1px", height: "1px", border: "0", opacity: "0", pointerEvents: "none" });
    }
    (container ?? document.body).append(frame);

    const state = { phase: "loading", progress: 0, message: "", step: "" };
    const listeners = { state: new Set(), greet: new Set() };
    const pending = new Map();      // id → { resolve, reject, callbacks }
    const waiting = [];             // demandes envoyées avant qu'il soit prêt
    let seq = 0;
    let docTitle = title;

    const send = (message) => frame.contentWindow?.postMessage(message, origin);
    const emit = (type, value) => listeners[type]?.forEach((fn) => fn(value));

    function onMessage(event) {
        if (event.source !== frame.contentWindow || event.origin !== origin) return;
        const data = event.data || {};
        if (data.type === "state") {
            const wasReady = state.phase === "ready";
            Object.assign(state, { phase: data.phase, progress: data.progress | 0, message: data.message || "", step: data.step || "" });
            if (state.phase === "ready" && !wasReady) {
                // Prêt : il dit bonjour, puis traite ce qu'on lui a confié pendant son réveil.
                send({ type: "hello", title: docTitle });
                for (const message of waiting.splice(0)) send(message);
            }
            if (state.phase === "error") for (const [id, job] of pending) { pending.delete(id); job.reject(new Error(state.message || "Cubi est indisponible.")); }
            emit("state", { ...state });
        } else if (data.type === "greet") {
            emit("greet", data.text);
        } else {
            const job = pending.get(data.id);
            if (!job) return;
            const { onStart, onStep, onThought, onText } = job.callbacks;
            if (data.type === "working") onStart?.();
            else if (data.type === "step") onStep?.(data.text);
            else if (data.type === "thought") onThought?.(data.text);
            else if (data.type === "partial") onText?.(data.text);
            else if (data.type === "result") {
                pending.delete(data.id);
                const { type, id, ...result } = data;
                job.resolve({ thought: "", ...result });
            }
            else if (data.type === "failed") { pending.delete(data.id); job.reject(new Error(data.error || "Échec.")); }
        }
    }
    addEventListener("message", onMessage);
    frame.addEventListener("load", () => send({ type: "hello", title: docTitle }));

    /**
     * Une demande brute. task : { action, instruction, text, document, think, batch, part, of }.
     * callbacks : { onStart, onStep, onThought, onText, signal }. Renvoie { text, rewrite, thought }.
     */
    function run(task, { signal, ...callbacks } = {}) {
        const id = task.id ?? `t${++seq}`;
        const message = { type: "task", title: docTitle, ...task, id, batch: task.batch ?? id };
        return new Promise((resolve, reject) => {
            if (state.phase === "error") { reject(new Error(state.message || "Cubi est indisponible.")); return; }
            if (signal?.aborted) { reject(new DOMException("Arrêté.", "AbortError")); return; }
            pending.set(id, { resolve, reject, callbacks });
            signal?.addEventListener("abort", () => cancel(message.batch), { once: true });
            if (state.phase === "ready") send(message);
            else waiting.push(message);
        });
    }

    function cancel(batch) {
        for (let i = waiting.length - 1; i >= 0; i--) {
            if (waiting[i].type !== "task" || waiting[i].batch !== batch) continue;
            const [message] = waiting.splice(i, 1);
            pending.get(message.id)?.reject(new DOMException("Arrêté.", "AbortError"));
            pending.delete(message.id);
        }
        send({ type: "cancel", batch });
    }

    return {
        frame,
        get state() { return { ...state }; },
        /** type : "state" ({ phase: loading | ready | error, progress, message }) ou "greet" (texte). */
        on(type, fn) { listeners[type]?.add(fn); return () => listeners[type]?.delete(fn); },
        /** Le titre du document en cours ; il dit bonjour quand il est prêt. */
        hello(title = docTitle) { docTitle = title; send({ type: "hello", title }); },
        /**
         * Une question ou une demande libre. context : le passage sélectionné ; document : tout le texte, qu'il lit
         * en entier (en plusieurs parties s'il est long). think : il réfléchit d'abord (sa réflexion dans onThought).
         */
        ask(instruction, { context = "", document = "", think = true, ...options } = {}) {
            return run({ action: "ask", instruction, text: context, document, think }, options);
        },
        /**
         * Ajoute du contenu à un document : il choisit l'endroit dans le plan, puis il écrit (en Markdown).
         * outline : [{ label, text }] (titres ou paragraphes, le dernier pour la fin). Renvoie { text, place }.
         */
        compose(instruction, { document = "", outline = [], ...options } = {}) {
            return run({ action: "insert", instruction, document, outline, text: "" }, options);
        },
        /** Quelle partie d'un document modifier : outline, [{ label }]. Renvoie { place } (son index, ou null). */
        locate(instruction, { outline = [], ...options } = {}) {
            return run({ action: "locate", instruction, outline, text: "" }, options);
        },
        /** Réécrit un texte : how = corriger | sobre | clair | court | developper | suite, ou une consigne libre. */
        async rewrite(text, how = "corriger", { think = false, ...options } = {}) {
            const preset = ["corriger", "sobre", "clair", "court", "developper", "suite"].includes(how);
            const result = await run({ action: preset ? how : "rewrite", instruction: preset ? "" : how, text, think }, options);
            return { ...result, changed: result.text.replace(/\s+/g, " ").trim() !== text.replace(/\s+/g, " ").trim() };
        },
        run,
        cancel,
        destroy() {
            removeEventListener("message", onMessage);
            for (const [, job] of pending) job.reject(new DOMException("Arrêté.", "AbortError"));
            pending.clear();
            frame.remove();
        },
    };
}
