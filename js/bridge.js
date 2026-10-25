import { escapeHTML, renderAnswer } from "./ui_utils.js";
import { ACTIONS, taskMessages } from "./agents/editor.js";
import { runTask } from "./api/tasks.js";

// Canal partagé avec TextEdit : ouvert dans TextEdit (iframe), on ne parle qu'à la page qui nous
// contient ; ouvert dans son propre onglet, on écoute les onglets du même site (BroadcastChannel).
const CHANNEL = "cubi";
const WORKING_LINES = {
    rewrite: ["Je relis votre texte…", "Je pèse chaque mot…", "Je reformule…"],
    answer: ["Je lis le passage…", "Je réfléchis à votre question…"],
};

/**
 * Pont avec TextEdit : l'éditeur envoie des passages (sélection ou paragraphe) ; ici, le modèle les
 * réécrit ou répond, et le personnage travaille à son bureau pendant ce temps. Les demandes passent
 * une par une, comme les questions du chat (même session sur la carte graphique).
 *
 * Messages reçus : { type: "hello", title } · { type: "task", id, batch, part, of, action, instruction, text, title, think }
 *                  · { type: "cancel", batch }
 * Messages envoyés : { type: "state", phase, progress, message, name } · { type: "greet", text }
 *                    · { type: "working", id } · { type: "step" | "thought" | "partial", id, text }
 *                    · { type: "result", id, text, rewrite, thought } · { type: "failed", id, error }
 * Le même protocole que le mode léger (api.html) : voir sdk/cubi.js.
 */
export function createBridge({ getRuntime, getName, character, bubble, missions, setMood }) {
    const embedded = window.parent !== window;
    if (!embedded && !("BroadcastChannel" in window)) return { loading() {}, ready() {}, failed() {} };
    const channel = embedded ? null : new BroadcastChannel(CHANNEL);
    const state = { phase: "loading", progress: 0, message: "" };
    const queue = [];
    const batches = new Map();
    let greeted = "";
    let running = false;
    let current = null;

    const post = embedded ? (message) => window.parent.postMessage(message, location.origin) : (message) => channel.postMessage(message);
    const announce = () => post({ type: "state", ...state, name: getName() });

    function greet(title) {
        const text = `Bonjour ! On bosse sur « ${title || "votre document"} » ?`;
        post({ type: "greet", text });
        if (greeted === title) return;
        greeted = title;
        missions.note(`TextEdit est connecté · <b>${escapeHTML(title || "document sans titre")}</b>`);
        bubble.show(`<div class="bubble-text"><p>${escapeHTML(text)}</p></div>`);
        bubble.hide(8000);
        character?.setAutonomous(true);
        character?.wake(10);
        character?.gesture("wave");
    }

    function receive(data) {
        if (!data || typeof data !== "object") return;
        if (data.type === "hello") {
            announce();
            if (state.phase === "ready") greet(String(data.title ?? ""));
        } else if (data.type === "task" && typeof data.text === "string") {
            queue.push(data);
            run();
        } else if (data.type === "cancel") {
            for (let i = queue.length - 1; i >= 0; i--) if (queue[i].batch === (data.batch ?? data.id)) queue.splice(i, 1);
            if (current && current.batch === (data.batch ?? data.id)) current.abort.abort();
        }
    }
    if (embedded) {
        window.addEventListener("message", (event) => {
            if (event.source === window.parent && event.origin === location.origin) receive(event.data);
        });
    } else {
        channel.addEventListener("message", ({ data }) => receive(data));
    }

    // Une demande de TextEdit = un échange dans la conversation, avec un pas par paragraphe.
    function batchFor(task) {
        let batch = batches.get(task.batch);
        if (!batch) {
            const label = ACTIONS[task.action]?.label ?? (task.instruction ? `« ${task.instruction} »` : "Demande");
            missions.note(`TextEdit demande : <b>${escapeHTML(label)}</b>`);
            const mission = missions.begin({ kind: "texte", title: `${label} · ${task.title || "TextEdit"}` });
            mission.reveal();
            batch = { mission, changed: 0, done: 0, of: task.of ?? 1, answer: "" };
            batches.set(task.batch, batch);
            character?.setAutonomous(true);
            character?.wake(10);
        }
        return batch;
    }

    async function run() {
        if (running) return;
        running = true;
        while (queue.length && state.phase === "ready") {
            const task = queue.shift();
            await getRuntime().adapter.exclusive(() => handle(task));
        }
        running = false;
    }

    async function handle(task) {
        const batch = batchFor(task);
        const { rewrite } = taskMessages(task);
        const step = batch.mission.step(task.of > 1 ? `Paragraphe ${task.part}/${task.of}` : rewrite ? "Réécriture du passage" : "Réponse à la question");
        current = { batch: task.batch, abort: new AbortController() };
        post({ type: "working", id: task.id });
        // Il écrit à son ordinateur (réécriture) ou lit à l'écran (question), bouche fermée.
        character?.setActivity(rewrite ? "laptop" : "screen");
        setMood("think");
        bubble.working(rewrite ? WORKING_LINES.rewrite : WORKING_LINES.answer);

        try {
            const result = await runTask(getRuntime().adapter, task, (event) => post({ ...event, id: task.id }), current.abort.signal);
            if (current.abort.signal.aborted) {
                step.fail("arrêté");
                post({ type: "failed", id: task.id, error: "Arrêté." });
            } else {
                const same = rewrite && result.text.replace(/\s+/g, " ") === task.text.replace(/\s+/g, " ");
                if (rewrite && !same) batch.changed += 1;
                if (!rewrite) batch.answer = result.text;
                step.done(rewrite ? (same ? "rien à changer" : "modifié") : "répondu");
                post({ type: "result", id: task.id, ...result });
            }
        } catch (error) {
            step.fail(error.message);
            post({ type: "failed", id: task.id, error: error.message });
        } finally {
            current = null;
        }

        batch.done += 1;
        if (batch.done >= batch.of) finishBatch(task.batch, batch);
    }

    function finishBatch(id, batch) {
        batches.delete(id);
        const summary = batch.answer
            ? renderAnswer(batch.answer)
            : `<p>${batch.of > 1 ? `${batch.of} paragraphes relus, ${batch.changed} à modifier.` : batch.changed ? "Passage réécrit." : "Rien à changer."} Les propositions sont dans TextEdit.</p>`;
        batch.mission.answer(summary);
        batch.mission.finish("done");
        // D'autres demandes attendent : il reste à son bureau.
        if (queue.length) return;
        character?.setActivity(null);
        setMood("idle");
        bubble.show(`<div class="bubble-text"><p>${batch.answer ? "J'ai répondu dans TextEdit." : "C'est fait ! Tout est dans TextEdit."}</p></div>`);
        bubble.hide(15000);
        character?.wake(10, { startle: false });
    }

    return {
        loading(progress) {
            state.phase = "loading";
            state.progress = progress;
            announce();
        },
        ready() {
            state.phase = "ready";
            state.progress = 100;
            announce();
            run();
        },
        failed(message) {
            state.phase = "error";
            state.message = message;
            announce();
        },
    };
}
