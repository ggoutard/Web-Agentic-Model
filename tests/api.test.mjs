// Tests de l'API (sdk/cubi.js → api.html) : ce qu'il annonce, sa lecture d'un long document, sa réflexion.
import { test } from "node:test";
import assert from "node:assert/strict";

import { runTask } from "../js/api/tasks.js";

// Faux modèle : une note pour la partie qui parle de 42, « RIEN » pour les autres, puis la réponse finale.
function fakeAdapter() {
    const calls = [];
    return {
        calls,
        async infer(messages, maxTokens, onText, { onThought } = {}) {
            const system = messages[0].content;
            calls.push(system);
            const reply = /partie \d+ sur/.test(system) ? (system.includes("42") ? "La réponse est 42." : "RIEN") : "C'est 42.";
            onThought?.("Je regarde mes notes.");
            onText?.(reply);
            return reply;
        },
    };
}

test("un long document est lu en entier, partie par partie, puis il répond avec ses notes", async () => {
    const parts = Array.from({ length: 30 }, (_, i) => `Paragraphe ${i} ${i === 17 ? "le nombre 42 " : ""}${"mot ".repeat(100)}`);
    const adapter = fakeAdapter();
    const events = [];
    const result = await runTask(adapter, { action: "ask", instruction: "Quel nombre ?", document: parts.join("\n\n"), think: true }, (e) => events.push(e));
    assert.equal(adapter.calls.length, 4);
    assert.match(adapter.calls.at(-1), /Tes notes de lecture :\nPartie 2 : La réponse est 42\./);
    assert.equal(result.text, "C'est 42.");
    assert.match(events[0].text, /Je lis tout le document \(\d+ mots\), en 3 parties/);
    assert.match(result.thought, /^Partie 1\/3 : rien d'utile ici\.\nPartie 2\/3 : La réponse est 42\./);
    assert.match(result.thought, /Je regarde mes notes\.$/);
});

test("un court document est lu d'un coup ; une réécriture ne lit que le passage", async () => {
    const adapter = fakeAdapter();
    await runTask(adapter, { action: "ask", instruction: "Quel nombre ?", document: "Le nombre est 42." }, () => {});
    assert.equal(adapter.calls.length, 1);
    assert.match(adapter.calls[0], /Voici le document complet :\n"""\nLe nombre est 42\./);
    await runTask(adapter, { action: "sobre", text: "Un texte.", document: "Tout le document." }, () => {});
    assert.doesNotMatch(adapter.calls.at(-1), /Tout le document/);
});

test("une réécriture ne réfléchit pas ; une question réfléchit, en français", async () => {
    const seen = [];
    const adapter = { async infer(messages, maxTokens, onText, options = {}) { seen.push({ think: options.think, system: messages[0].content }); return "Texte."; } };
    await runTask(adapter, { action: "consigne", instruction: "corrige les fautes", text: "Un texte.", think: true }, () => {});
    assert.equal(seen[0].think, false);
    await runTask(adapter, { action: "ask", instruction: "Pourquoi ?", text: "Un texte.", think: true }, () => {});
    assert.equal(seen[1].think, true);
    assert.match(seen[1].system, /réfléchis brièvement, en français/);
});

test("la suite s'ajoute après le passage ; le code revient sans bloc ```", async () => {
    const reply = (text) => ({ async infer() { return text; } });
    const next = await runTask(reply("Puis la nuit tomba."), { action: "suite", text: "Le jour finit ⟦1⟧." }, () => {});
    assert.equal(next.text, "Le jour finit ⟦1⟧.\n\nPuis la nuit tomba.");
    const code = await runTask(reply("```python\nfor i in range(3):\n    print(i)\n```"), { action: "consigne", instruction: "corrige", text: "for i in range(3) print(i)", code: true }, () => {});
    assert.equal(code.text, "for i in range(3):\n    print(i)");
});

test("ajouter du contenu : il choisit l'endroit dans le plan, puis il écrit en Markdown", async () => {
    const calls = [];
    const adapter = { async infer(messages) { calls.push(messages[0].content); return calls.length === 1 ? "2" : "## Résultats\n\nLes **mesures** confirment."; } };
    const outline = [{ label: "## Introduction", text: "Intro." }, { label: "## Méthode", text: "On mesure." }, { label: "la fin du document", text: "" }];
    const result = await runTask(adapter, { action: "insert", instruction: "ajoute une section résultats", document: "# Doc\n\n## Introduction\n\nIntro.", outline }, () => {});
    assert.equal(result.place, 1);
    assert.equal(result.insert, true);
    assert.match(calls[0], /1\. ## Introduction\n2\. ## Méthode\n3\. la fin du document/);
    assert.match(calls[1], /Ton texte sera ajouté après « ## Méthode »/);
    assert.match(calls[1], /\*\*gras\*\*/);
    assert.equal(result.text, "## Résultats\n\nLes **mesures** confirment.");
});

test("un numéro d'endroit absurde : à la fin", async () => {
    const { parsePlace } = await import("../js/agents/editor.js");
    assert.equal(parsePlace("2", 3), 1);
    assert.equal(parsePlace("Après la 3.", 3), 2);
    assert.equal(parsePlace("9", 3), null);
    assert.equal(parsePlace("aucune idée", 3), null);
});

test("code rendu tel quel : il recommence une fois, avec la consigne", async () => {
    const calls = [];
    const adapter = { async infer(messages) { calls.push(messages); return calls.length === 1 ? "x = 1" : "Voici le code modifié :\n```python\nx = 2\n```\nJ'ai remplacé 1 par 2."; } };
    const result = await runTask(adapter, { action: "consigne", instruction: "mets x à 2", text: "x = 1", code: true }, () => {});
    assert.equal(calls.length, 2);
    assert.match(calls[0][1].content, /^Consigne : mets x à 2\n\nCode :\n```\nx = 1\n```$/);
    assert.match(calls[1].at(-1).content, /sans le modifier\. Applique vraiment cette consigne : mets x à 2/);
    assert.equal(result.text, "x = 2");
});
