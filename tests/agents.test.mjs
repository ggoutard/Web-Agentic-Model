// Tests de la logique des agents, sans GPU : node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";

import { evaluateExpression, TOOLS, toolSchemas } from "../js/agents/tools.js";
import { runAgent } from "../js/agents/runner.js";
import { AGENT_TEMPLATES } from "../js/agents/templates.js";

// ---------- Calculatrice ----------

test("calculatrice : priorités, parenthèses, décimales françaises", () => {
    assert.equal(evaluateExpression("35 * 4"), 140);
    assert.equal(evaluateExpression("168 - 35 * 4"), 28);
    assert.equal(evaluateExpression("(168 - 140) / 4"), 7);
    assert.equal(evaluateExpression("-2 + 5"), 3);
    assert.equal(evaluateExpression("12,5 × 2"), 25);
    assert.equal(evaluateExpression("10 % 4"), 2);
});

test("calculatrice : refuse le code et les erreurs", () => {
    assert.throws(() => evaluateExpression("alert(1)"));
    assert.throws(() => evaluateExpression("2 +"));
    assert.throws(() => evaluateExpression("(1 + 2"));
    assert.throws(() => evaluateExpression("1 / 0"), /division par zéro/);
});

// ---------- Dates ----------

test("decaler_date : jours ouvrés sautent le week-end", () => {
    // Vendredi 23 octobre 2026 + 1 jour ouvré = lundi 26 octobre.
    const out = TOOLS.decaler_date.run({ jours: 1, jours_ouvres: true, date: "2026-10-23" });
    assert.match(out, /2026-10-26/);
    const calendar = TOOLS.decaler_date.run({ jours: 1, date: "2026-10-23" });
    assert.match(calendar, /2026-10-24/);
});

test("decaler_date : refuse une date invalide", () => {
    assert.throws(() => TOOLS.decaler_date.run({ jours: 1, date: "pas une date" }));
});

// ---------- Schémas ----------

test("chaque modèle d'agent n'utilise que des outils existants", () => {
    for (const agent of AGENT_TEMPLATES) {
        assert.equal(toolSchemas(agent.tools).length, agent.tools.length, agent.id);
    }
});

// ---------- Boucle d'agent avec un faux modèle ----------

// Simule session.generate : renvoie les réponses prévues, dans l'ordre, et enregistre les messages reçus.
function fakeSession(replies) {
    const calls = [];
    return {
        calls,
        generate(messages, options) {
            calls.push({ messages: structuredClone(messages), options });
            const reply = replies.shift();
            const events = reply.text ? [{ type: "text", text: reply.text }] : [];
            return {
                async *[Symbol.asyncIterator]() { yield* events; },
                result: Promise.resolve({
                    finish_reason: reply.toolCalls ? "tool_calls" : "stop",
                    message: { role: "assistant", content: reply.text ?? "", ...(reply.toolCalls ? { tool_calls: reply.toolCalls } : {}) },
                    usage: { completion_tokens: 10 },
                }),
            };
        },
    };
}

const call = (id, name, args, errors) => ({ id, type: "function", function: { name, arguments: args }, ...(errors ? { errors } : {}) });

test("boucle : outil → résultat renvoyé au modèle → réponse finale", async () => {
    const session = fakeSession([
        { toolCalls: [call("c1", "calculer", { expression: "35 * 4" })] },
        { text: "Le plafond est de 140 euros : NON CONFORME." },
    ]);
    const events = [];
    const agent = { instructions: "Contrôle.", tools: ["calculer"], maxSteps: 3, reasoning: false };

    const stats = await runAgent({ session, agent, input: "168 € pour 4 ?", context: {}, onEvent: (e) => events.push(e) });

    assert.deepEqual(stats, { steps: 2, toolCalls: 1, tokens: 20 });
    const toolMessage = session.calls[1].messages.at(-1);
    assert.equal(toolMessage.role, "tool");
    assert.equal(toolMessage.tool_call_id, "c1");
    assert.match(toolMessage.content, /= 140/);
    assert.equal(events.at(-1).type, "final");
    assert.equal(events.at(-1).forced, false);
    assert.equal(session.calls[0].options.tools.length, 1);
});

test("boucle : une erreur d'outil est renvoyée au modèle au lieu de tout arrêter", async () => {
    const session = fakeSession([
        { toolCalls: [call("c1", "calculer", { expression: "2 +" })] },
        { text: "Je n'ai pas pu calculer." },
    ]);
    const events = [];
    await runAgent({
        session,
        agent: { instructions: "", tools: ["calculer"], maxSteps: 3, reasoning: false },
        input: "?",
        context: {},
        onEvent: (e) => events.push(e),
    });
    const end = events.find((e) => e.type === "tool-end");
    assert.ok(end.error);
    assert.match(session.calls[1].messages.at(-1).content, /^Erreur/);
});

test("boucle : arguments invalides signalés par le moteur", async () => {
    const session = fakeSession([
        { toolCalls: [call("c1", "calculer", {}, ['required argument "expression" is missing'])] },
        { text: "ok" },
    ]);
    const events = [];
    await runAgent({ session, agent: { instructions: "", tools: ["calculer"], maxSteps: 2, reasoning: false }, input: "?", context: {}, onEvent: (e) => events.push(e) });
    assert.match(events.find((e) => e.type === "tool-end").error, /expression/);
});

test("boucle : limite d'étapes → réponse de synthèse forcée, sans outils", async () => {
    const session = fakeSession([
        { toolCalls: [call("c1", "date_actuelle", {})] },
        { toolCalls: [call("c2", "date_actuelle", {})] },
        { text: "Synthèse." },
    ]);
    const events = [];
    const stats = await runAgent({
        session,
        agent: { instructions: "", tools: ["date_actuelle"], maxSteps: 2, reasoning: false },
        input: "?",
        context: {},
        onEvent: (e) => events.push(e),
    });
    assert.equal(stats.toolCalls, 2);
    assert.equal(events.at(-1).forced, true);
    assert.equal(session.calls[2].options.tools, undefined);
});

test("outil creer_note : alimente les livrables", () => {
    const delivered = [];
    const out = TOOLS.creer_note.run({ titre: "Avis", contenu: "Non conforme" }, { addDeliverable: (d) => delivered.push(d) });
    assert.deepEqual(delivered, [{ title: "Avis", content: "Non conforme" }]);
    assert.match(out, /Avis/);
});

test("boucle : l'historique est inséré entre la consigne et la question", async () => {
    const session = fakeSession([{ text: "ok" }]);
    const history = [{ role: "user", content: "avant" }, { role: "assistant", content: "réponse" }];
    await runAgent({ session, agent: { instructions: "", tools: [], maxSteps: 1, reasoning: false }, input: "maintenant", history, context: {}, onEvent: () => {} });
    assert.deepEqual(session.calls[0].messages.slice(1).map((m) => m.content), ["avant", "réponse", "maintenant"]);
});

// ---------- Profil de l'agent ----------

test("persona : la mission remplace le rôle par défaut, mot pour mot", async () => {
    const { personaPrompt, DEFAULT_PROFILE } = await import("../js/profile.js");
    assert.match(personaPrompt(DEFAULT_PROFILE), /^Tu t'appelles Cubi\. Tu es la secrétaire/);
    assert.equal(personaPrompt({ ...DEFAULT_PROFILE, name: "Ada", mission: "Tu contrôles les frais." }), "Tu contrôles les frais.");
});

test("mission : seule consigne système, sans extraits ni format, comme un Modelfile", async () => {
    const { LogicalRAGPipeline } = await import("../js/rag/pipeline.js");
    const mission = "Ta mission est de répondre toujours blabla.";
    const pipeline = new LogicalRAGPipeline(null);
    pipeline.persona = "Tu t'appelles Cubi.";
    pipeline.mission = mission;
    const [system, user] = pipeline.buildPrompt("Quelle est la capitale de la France ?", [{ text: "Paris est la capitale." }], "Réponds en une phrase.");
    assert.deepEqual(system, { role: "system", content: mission });
    assert.equal(user.content, "Quelle est la capitale de la France ?");
});

test("boucle : le format de réponse suit le mode choisi par l'aiguillage", async () => {
    const session = fakeSession([{ text: "ok" }]);
    await runAgent({ session, agent: { instructions: "Rôle.", format: "Réponds en une phrase.", tools: [], maxSteps: 1, reasoning: false }, input: "?", context: {}, onEvent: () => {} });
    const system = session.calls[0].messages[0].content;
    assert.match(system, /^Rôle\./);
    assert.match(system, /Réponds en une phrase\.$/);
    assert.doesNotMatch(system, /---/);
});

// ---------- Équipe ----------

test("équipe : un personnage renommé garde son métier ; la mission l'emporte toujours", async () => {
    const { personaPrompt, DEFAULT_PROFILE } = await import("../js/profile.js");
    const rhea = personaPrompt({ ...DEFAULT_PROFILE, crew: "rhea", name: "Iris" });
    assert.match(rhea, /^Tu t'appelles Iris\. Tu es chargée de recrutement/);
    assert.equal(personaPrompt({ ...DEFAULT_PROFILE, crew: "rhea", mission: "Réponds blabla." }), "Réponds blabla.");
});

test("outils : lire_document retrouve un document par une partie de son nom", async () => {
    const { CREW } = await import("../js/crew.js");
    const documents = CREW.find((m) => m.id === "plume").scenario.documents.map((d) => ({ name: d.name, text: d.text, ...d.sheet }));
    const output = TOOLS.lire_document.run({ nom: "lettre de Mme Perrin" }, { knowledge: { documents } });
    assert.match(output, /suspension Arc livrée cassée/);
    assert.throws(() => TOOLS.lire_document.run({ nom: "zzz" }, { knowledge: { documents } }), /lister_documents/);
});
