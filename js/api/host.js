import { loadEngine, LOAD_STEPS } from "../engine.js";
import { BonsaiAdapter } from "../rag/model_adapter.js";
import { runTask } from "./tasks.js";

// Cubi en mode léger : le modèle seul, sans personnage ni interface, dans une iframe invisible (sdk/cubi.js).
// La page qui l'intègre lui envoie des demandes ; il répond avec ce qu'il fait, sa réflexion et sa réponse.
// Même protocole que bridge.js. Il ne lit que ce qu'on lui envoie : rien de la base de documents de Logical.

const NAME = "Cubi";
// Part de chaque étape du chargement dans la barre de progression.
const STEP_WEIGHTS = { download: [0, 0.8], upload: [0.8, 0.9], compile: [0.9, 0.97], tune: [0.97, 1] };

const state = { phase: "loading", progress: 0, message: "" };
const queue = [];
let adapter = null;
let origin = null;      // la page qui l'intègre : fixée à son premier message
let current = null;
let running = false;

const standalone = window.parent === window;
const post = (message) => origin && window.parent.postMessage(message, origin);
const announce = () => post({ type: "state", ...state, name: NAME });

addEventListener("message", (event) => {
    if (event.source !== window.parent || !event.data || typeof event.data !== "object") return;
    if (!origin && event.data.type === "hello") origin = event.origin;
    if (event.origin !== origin) return;
    const data = event.data;
    if (data.type === "hello") {
        announce();
        if (state.phase === "ready") post({ type: "greet", text: `Bonjour ! On bosse sur « ${String(data.title || "votre document")} » ?` });
    } else if (data.type === "task" && typeof data.id === "string") {
        queue.push({ ...data, batch: data.batch ?? data.id });
        run();
    } else if (data.type === "cancel") {
        const batch = data.batch ?? data.id;
        for (let i = queue.length - 1; i >= 0; i--) {
            if (queue[i].batch !== batch) continue;
            post({ type: "failed", id: queue[i].id, error: "Arrêté." });
            queue.splice(i, 1);
        }
        if (current?.batch === batch) current.abort.abort();
    }
});

async function run() {
    if (running) return;
    running = true;
    while (queue.length && state.phase === "ready") await handle(queue.shift());
    running = false;
}

async function handle(task) {
    current = { batch: task.batch, abort: new AbortController() };
    post({ type: "working", id: task.id });
    try {
        const result = await runTask(adapter, task, (event) => post({ ...event, id: task.id }), current.abort.signal);
        if (current.abort.signal.aborted) post({ type: "failed", id: task.id, error: "Arrêté." });
        else post({ type: "result", id: task.id, ...result });
    } catch (error) {
        post({ type: "failed", id: task.id, error: error.message });
    } finally {
        current = null;
    }
}

async function boot() {
    if (standalone) document.body.dataset.standalone = "";
    try {
        const { engine } = await loadEngine({
            onProgress: ({ step, fraction }) => {
                const [start, end] = STEP_WEIGHTS[step] ?? [0, 1];
                const percent = Math.round((start + (end - start) * (fraction ?? 0)) * 100);
                if (percent === state.progress) return;
                state.progress = percent;
                state.step = LOAD_STEPS.includes(step) ? step : "";
                announce();
            },
        });
        adapter = new BonsaiAdapter(engine);
        Object.assign(state, { phase: "ready", progress: 100, step: "" });
        announce();
        run();
    } catch (error) {
        Object.assign(state, {
            phase: "error",
            message: error.deviceLost ? "La carte graphique n'a pas tenu." : error.message,
        });
        announce();
    }
}

// Ouverte seule (pas dans une page), elle ne charge rien : elle explique comment l'utiliser.
if (!standalone) boot();
