import { Qwen3_5ForConditionalGeneration } from "./vendor/qwen35-bonsai.js";
import { createSplitFetch } from "./split_fetch.js";

// Qwen3.5-2B en ternaire (PrismML), hébergé dans le dépôt : aucun appel externe.
export const MODEL_INFO = {
    name: "Qwen3.5-2B ternaire",
    origin: "Ternary-Bonsai-2-2B · PrismML",
    manifest: "./model/Ternary-Bonsai-2-2B-PTQ1_0/manifest.json",
};

const CACHE_FLAG_KEY = "model-cached";

// Raisons d'indisponibilité renvoyées par le moteur, traduites pour l'utilisateur.
const UNAVAILABLE_REASONS = {
    "WebGPU isn't available in this browser. Try a recent Chrome or Edge.": "WebGPU n'est pas disponible dans ce navigateur. Utilisez une version récente de Chrome ou Edge.",
    "No WebGPU adapter is available on this device.": "Aucune carte graphique compatible WebGPU n'a été trouvée sur cet appareil.",
};

// Étapes affichées à l'utilisateur, dans l'ordre.
export const LOAD_STEPS = ["download", "upload", "compile", "tune"];

// Messages du moteur → étape affichée.
const ENGINE_STEPS = {
    "Uploading to GPU": "upload",
    "Preparing weight upload": "upload",
    "Compiling kernels (warmup)": "compile",
    "Tuning decode pipeline": "tune",
};

export function isFirstVisit() {
    try { return localStorage.getItem(CACHE_FLAG_KEY) !== MODEL_INFO.manifest; } catch { return true; }
}

/**
 * Charge Bonsai sur la carte graphique ; sans carte graphique utilisable, un modèle plus petit sur le
 * processeur (voir engine_cpu.js). Une coupure réseau pendant le téléchargement ne déclenche pas
 * la bascule : le processeur aurait le même problème, et un modèle de plus à télécharger.
 * onProgress reçoit { step, fraction?, loadedBytes?, totalBytes? } ; step ∈ LOAD_STEPS.
 * Renvoie { engine, gpuName, backend: "gpu" | "cpu", model }.
 * En cas d'échec, l'erreur porte `gpuName`, `step` et `diagnostic` pour l'affichage.
 */
export async function loadEngine({ onProgress = () => {} } = {}) {
    try {
        return { ...(await loadGpuEngine({ onProgress })), backend: "gpu", model: MODEL_INFO };
    } catch (error) {
        if (error.step === "download" && !error.noGpu) throw error;
        console.warn("[chargement] carte graphique inutilisable, bascule sur le processeur :", error.message);
        onProgress({ step: "download", fraction: 0, backend: "cpu" });
        try {
            // Chargé seulement s'il sert : wllama pèse 9 Mo avec son WebAssembly.
            const { loadCpuEngine, CPU_MODEL_INFO } = await import("./engine_cpu.js");
            const engine = await loadCpuEngine({ onProgress: (event) => onProgress({ ...event, backend: "cpu" }) });
            return { engine, gpuName: error.gpuName, backend: "cpu", model: CPU_MODEL_INFO };
        } catch (cpuError) {
            cpuError.step ??= "download";
            cpuError.message = `Ni carte graphique (${error.message}) ni processeur : ${cpuError.message}`;
            throw cpuError;
        }
    }
}

async function loadGpuEngine({ onProgress }) {
    let gpuName = "inconnu";
    let step = "download";
    let diagnostic = null;
    const startTime = performance.now();
    let stepStart = startTime;

    const enterStep = (next) => {
        if (next === step) return;
        const now = performance.now();
        console.info(`[chargement] ${step} : ${((now - stepStart) / 1000).toFixed(1)} s`);
        step = next;
        stepStart = now;
    };

    try {
        if (!navigator.gpu) throw Object.assign(new Error("WebGPU n'est pas disponible dans ce navigateur."), { noGpu: true });

        const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
        if (adapter) {
            const { vendor, architecture, description } = adapter.info ?? {};
            gpuName = [vendor, architecture, description].filter(Boolean).join(" / ") || "inconnu";
            console.info(`[chargement] GPU utilisé : ${gpuName}`);
        }

        const split = await createSplitFetch(new URL(MODEL_INFO.manifest, location.href).href);
        const availability = await Qwen3_5ForConditionalGeneration.checkAvailability(split.url, { fetch: split.fetch, mmproj: null });
        if (!availability.ok) throw Object.assign(new Error(UNAVAILABLE_REASONS[availability.reason] ?? availability.reason), { noGpu: true });

        // mmproj: null → pas de module vision, 0,35 Go de moins à télécharger.
        const engine = await Qwen3_5ForConditionalGeneration.from_pretrained(split.url, {
            fetch: split.fetch,
            mmproj: null,
            onProgress: (e) => {
                if (e.kind === "bytes") {
                    onProgress({ step: "download", fraction: e.fraction, loadedBytes: e.loaded, totalBytes: e.total });
                    return;
                }
                const next = ENGINE_STEPS[e.message];
                if (next) enterStep(next);
                const fraction = e.kind === "tensors" && e.total ? e.loaded / e.total : undefined;
                onProgress({ step, fraction });
            },
            runtimeOptions: {
                diagnosticSink: (d) => {
                    diagnostic = d.message;
                    console.error(`[WebGPU] ${d.message}`);
                },
            },
        });

        enterStep("ready");
        console.info(`[chargement] total : ${((performance.now() - startTime) / 1000).toFixed(1)} s`);
        try { localStorage.setItem(CACHE_FLAG_KEY, MODEL_INFO.manifest); } catch { /* stockage indisponible */ }
        return { engine, gpuName };
    } catch (error) {
        error.gpuName = gpuName;
        error.step = step;
        error.diagnostic = diagnostic;
        error.deviceLost = /lost|hung/i.test(`${error.message} ${diagnostic ?? ""}`);
        throw error;
    }
}
