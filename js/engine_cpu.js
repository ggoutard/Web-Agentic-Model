import { Wllama } from "./vendor/wllama/index.js";

// Sans carte graphique : llama.cpp compilé en WebAssembly (wllama), sur le processeur.
// Bonsai ne s'y charge pas (poids ternaires « tournés » par Hadamard, propres à PrismML) : on prend
// le plus petit Qwen3.5, même architecture et mêmes appels d'outils, téléchargé une fois puis gardé
// en cache par le navigateur.
export const CPU_MODEL_INFO = {
    name: "Qwen3.5-0.8B",
    origin: "Qwen3.5-0.8B-Q4_K_M · Qwen, quantifié par Unsloth",
    url: "https://huggingface.co/unsloth/Qwen3.5-0.8B-GGUF/resolve/main/Qwen3.5-0.8B-Q4_K_M.gguf",
    sizeMb: 533,
};

const CONTEXT_TOKENS = 8192;

/**
 * Même interface que le moteur Bonsai : engine.create_session().generate(messages, options)
 * renvoie un flux d'événements { type: "text" | "reasoning", text } et une promesse `result`
 * { message, finish_reason, usage, timings }.
 */
export async function loadCpuEngine({ onProgress = () => {} } = {}) {
    const wllama = new Wllama(
        { default: new URL("./vendor/wllama/wllama.wasm", import.meta.url).href },
        { suppressNativeLog: true, allowOffline: true },
    );
    await wllama.loadModelFromUrl(CPU_MODEL_INFO.url, {
        n_ctx: CONTEXT_TOKENS,
        // Processeur seulement, même si le navigateur expose une carte graphique défaillante.
        n_gpu_layers: 0,
        progressCallback: ({ loaded, total }) => {
            onProgress({ step: "download", fraction: total ? loaded / total : undefined, loadedBytes: loaded, totalBytes: total });
            if (total && loaded >= total) onProgress({ step: "upload" });
        },
    });
    return { create_session: () => ({ generate: (messages, options) => generate(wllama, messages, options) }) };
}

function generate(wllama, messages, { max_new_tokens = 512, enable_thinking = false, signal, tools } = {}) {
    let settle;
    let fail;
    const result = new Promise((resolve, reject) => { settle = resolve; fail = reject; });
    // Sans lecteur, une erreur de génération ne doit pas finir en « Uncaught (in promise) ».
    result.catch(() => {});

    async function* events() {
        let content = "";
        const calls = [];
        let finish = "stop";
        let timings = null;
        try {
            const stream = await wllama.createChatCompletion({
                messages: messages.map(toOpenAI),
                tools,
                max_tokens: max_new_tokens,
                stream: true,
                abortSignal: signal,
                cache_prompt: true,
                chat_template_kwargs: { enable_thinking },
            });
            for await (const chunk of stream) {
                const choice = chunk.choices?.[0];
                const delta = choice?.delta ?? {};
                if (delta.reasoning_content) yield { type: "reasoning", text: delta.reasoning_content };
                if (delta.content) {
                    content += delta.content;
                    yield { type: "text", text: delta.content };
                }
                for (const part of delta.tool_calls ?? []) {
                    const call = (calls[part.index ?? 0] ??= { id: "", name: "", arguments: "" });
                    if (part.id) call.id = part.id;
                    if (part.function?.name) call.name += part.function.name;
                    if (part.function?.arguments) call.arguments += part.function.arguments;
                }
                if (choice?.finish_reason) finish = choice.finish_reason;
                if (chunk.timings) timings = chunk.timings;
            }
            const toolCalls = calls.filter(Boolean).map(fromOpenAI);
            settle({
                message: { role: "assistant", content, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) },
                finish_reason: toolCalls.length ? "tool_calls" : finish,
                usage: { completion_tokens: timings?.predicted_n ?? 0 },
                timings: { tokens_per_second: timings?.predicted_per_second ?? null, ttft_ms: timings?.prompt_ms ?? null },
            });
        } catch (error) {
            fail(error);
            throw error;
        }
    }

    const iterator = events();
    return { [Symbol.asyncIterator]: () => iterator, result };
}

// Les agents gardent les arguments d'outil en objet ; l'API OpenAI les attend en texte JSON.
function toOpenAI(message) {
    if (message.role === "tool") return { role: "tool", tool_call_id: message.tool_call_id, content: message.content };
    if (!message.tool_calls) return { role: message.role, content: message.content ?? "" };
    return {
        role: "assistant",
        content: message.content ?? "",
        tool_calls: message.tool_calls.map((call) => ({
            id: call.id,
            type: "function",
            function: { name: call.function.name, arguments: JSON.stringify(call.function.arguments ?? {}) },
        })),
    };
}

function fromOpenAI(call, index) {
    let args = {};
    const errors = [];
    try {
        args = call.arguments.trim() ? JSON.parse(call.arguments) : {};
    } catch {
        errors.push(`arguments illisibles : ${call.arguments}`);
    }
    return { id: call.id || `call-${index}`, type: "function", function: { name: call.name, arguments: args }, ...(errors.length ? { errors } : {}) };
}
