import { TOOLS, toolSchemas } from "./tools.js";
import { REPLY_FORMAT } from "../answer_format.js";

const MAX_TOKENS_PER_STEP = 512;

const AGENT_RULES = `Règles :
- Utilise les outils dès qu'ils peuvent fournir une information ; n'invente jamais une donnée qu'un outil peut obtenir.
- Appelle un outil à la fois et attends son résultat.
- Quand tu t'appuies sur un passage trouvé par rechercher_documents, cite son numéro entre crochets, par exemple [1].
- Quand tu as les informations nécessaires, donne ta réponse finale en français, de façon concise.`;

/**
 * Exécute un agent : le modèle alterne réponses et appels d'outils jusqu'à une réponse finale
 * ou jusqu'à `agent.maxSteps` étapes.
 *
 * onEvent reçoit, dans l'ordre :
 *   { type: "step", step }
 *   { type: "reasoning" | "text", text }                 (flux du modèle)
 *   { type: "tool-start", id, name, args }
 *   { type: "tool-end", id, name, output, error, ms }
 *   { type: "final", text, forced }
 */
export async function runAgent({ session, agent, input, history = [], context, signal, onEvent }) {
    const schemas = toolSchemas(agent.tools);
    const messages = [
        { role: "system", content: [agent.instructions, AGENT_RULES, agent.format ?? REPLY_FORMAT, agent.reminder].filter(Boolean).join("\n\n") },
        ...history,
        { role: "user", content: input },
    ];
    const stats = { steps: 0, toolCalls: 0, tokens: 0 };

    for (let step = 1; step <= agent.maxSteps; step++) {
        stats.steps = step;
        onEvent({ type: "step", step });

        const result = await generate(session, messages, {
            tools: schemas.length > 0 ? schemas : undefined,
            enable_thinking: agent.reasoning,
            signal,
        }, onEvent);
        stats.tokens += result.usage?.completion_tokens ?? 0;

        if (result.finish_reason !== "tool_calls") {
            onEvent({ type: "final", text: result.message.content ?? "", forced: false });
            return stats;
        }

        messages.push(result.message);
        for (const call of result.message.tool_calls) {
            stats.toolCalls += 1;
            const output = await executeTool(call, context, onEvent);
            messages.push({ role: "tool", tool_call_id: call.id, name: call.function.name, content: output });
        }
    }

    // Limite atteinte : on demande une réponse finale sans outils.
    messages.push({ role: "user", content: "Tu as atteint le nombre maximal d'étapes. Donne maintenant ta réponse finale avec les informations obtenues." });
    const result = await generate(session, messages, { enable_thinking: false, signal }, onEvent);
    stats.tokens += result.usage?.completion_tokens ?? 0;
    onEvent({ type: "final", text: result.message.content ?? "", forced: true });
    return stats;
}

async function generate(session, messages, options, onEvent) {
    const turn = session.generate(messages, { ...options, max_new_tokens: MAX_TOKENS_PER_STEP });
    for await (const event of turn) {
        if (event.type === "text" || event.type === "reasoning") onEvent({ type: event.type, text: event.text });
    }
    const result = await turn.result;
    options.signal?.throwIfAborted();
    return result;
}

async function executeTool(call, context, onEvent) {
    const { id, function: { name, arguments: args } } = call;
    onEvent({ type: "tool-start", id, name, args });
    const started = performance.now();

    let output;
    let error = null;
    try {
        const tool = TOOLS[name];
        if (!tool) throw new Error(`outil inconnu « ${name} »`);
        if (call.errors?.length) throw new Error(call.errors.join(" ; "));
        output = await tool.run(args ?? {}, context);
    } catch (e) {
        error = e.message;
        output = `Erreur : ${e.message}. Corrige l'appel ou réponds avec les informations disponibles.`;
    }

    onEvent({ type: "tool-end", id, name, output, error, ms: performance.now() - started });
    return output;
}
