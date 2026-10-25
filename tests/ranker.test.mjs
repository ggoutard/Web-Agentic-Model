// Tests de l'agent évaluateur, sans GPU : node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";

import { rankDocuments, parseScore, parseCriteria, documentExcerpt, scoreMessages, rankingReport, recommendationMessages } from "../js/agents/ranker.js";

const cvs = [
    { name: "cv-alice.pdf", title: "CV Alice", summary: "Comptable, 8 ans d'expérience.", text: "Comptabilité générale, bilans, fiscalité." },
    { name: "cv-bruno.pdf", title: "CV Bruno", summary: "Développeur web.", text: "JavaScript, React." },
    { name: "cv-chloe.pdf", title: "CV Chloé", summary: "Assistante comptable.", text: "Saisie comptable, rapprochements bancaires." },
];

test("note : premier chiffre de la réponse, bornée, null sinon", () => {
    assert.equal(parseScore("7"), 7);
    assert.equal(parseScore(" 8/9"), 8);
    assert.equal(parseScore("12"), 9);
    assert.equal(parseScore("bien"), null);
});

test("prompt : consigne et demande d'abord, puis le document, puis le critère (préfixes communs)", () => {
    const [a] = scoreMessages("un comptable", cvs[0]);
    const [b] = scoreMessages("un comptable", cvs[1]);
    assert.equal(a.content, b.content);
    const one = scoreMessages("un comptable", cvs[0], "expérience")[1].content;
    const two = scoreMessages("un comptable", cvs[0], "fiscalité")[1].content;
    assert.match(one, /CV Alice/);
    assert.equal(one.slice(0, one.indexOf("Critère")), two.slice(0, two.indexOf("Critère")));
});

test("grille : critères courts, sans puces ni doublons, quatre au plus", () => {
    assert.deepEqual(parseCriteria("1. Expérience en comptabilité\n- **Maîtrise de la fiscalité**\n- expérience en comptabilité\n\nAnglais courant.\nDisponibilité\nRigueur"), ["Expérience en comptabilité", "Maîtrise de la fiscalité", "Anglais courant", "Disponibilité"]);
});

test("extrait : fiche puis texte, tronqué", () => {
    const long = { ...cvs[0], text: "mot ".repeat(5000) };
    const excerpt = documentExcerpt(long, 500);
    assert.ok(excerpt.startsWith("Comptable, 8 ans"));
    assert.ok(excerpt.length <= 520);
});

test("classement : une note par document, du meilleur au moins bon, égalités départagées", async () => {
    const notes = { "CV Alice": "8", "CV Bruno": "1", "CV Chloé": "8" };
    const calls = [];
    const infer = async (messages, maxTokens) => {
        calls.push(maxTokens);
        return notes[/« (.+?) »/.exec(messages[1].content)[1]];
    };
    const seen = [];
    const ranked = await rankDocuments({ infer, request: "Quel CV pour un poste de comptable avec bilans et fiscalité ?", documents: cvs, onScore: (r) => seen.push(r.doc.title) });
    assert.deepEqual(calls, [2, 2, 2]);
    assert.deepEqual(seen, ["CV Alice", "CV Bruno", "CV Chloé"]);
    assert.deepEqual(ranked.map((r) => r.doc.title), ["CV Alice", "CV Chloé", "CV Bruno"]);
    assert.match(rankingReport(ranked), /1\. \*\*CV Alice\*\* — 8\/9/);
});

test("classement : arrêt demandé, on s'arrête", async () => {
    const controller = new AbortController();
    const infer = async () => { controller.abort(); return "5"; };
    const ranked = await rankDocuments({ infer, request: "x", documents: cvs, signal: controller.signal });
    assert.equal(ranked.length, 0);
});

test("recommandation : les meilleurs documents numérotés comme sources", () => {
    const ranked = cvs.map((doc, i) => ({ doc, score: 9 - i, overlap: 0 }));
    const { messages, sources } = recommendationMessages({ persona: "Tu t'appelles Ada.", request: "Quel CV ?", criteria: ["Expérience"], remarks: ["Anglais exigé"], ranked, top: 2 });
    assert.match(messages[0].content, /Remarques de l'utilisateur pendant l'analyse, à respecter : Anglais exigé/);
    assert.equal(messages[1].content, "Quel CV ?");
    assert.ok(messages[0].content.startsWith("Tu t'appelles Ada."));
    assert.match(messages[0].content, /\[1\] « CV Alice »/);
    assert.deepEqual(sources.map((s) => s.document), ["CV Alice", "CV Bruno"]);
});

test("classement : plusieurs critères, moyenne, et remarque ajoutée en cours de route", async () => {
    const criteria = ["Expérience", "Fiscalité"];
    const notes = { "CV Alice": { Expérience: 8, Fiscalité: 9, Anglais: 2 }, "CV Bruno": { Expérience: 3, Fiscalité: 1, Anglais: 9 }, "CV Chloé": { Expérience: 5, Fiscalité: 6, Anglais: 9 } };
    let calls = 0;
    const infer = async (messages) => {
        calls += 1;
        const doc = /« (.+?) »/.exec(messages[1].content)[1];
        const criterion = /Critère : (.+)\n/.exec(messages[1].content)[1];
        // Remarque de l'utilisateur pendant la notation du deuxième document.
        if (doc === "CV Bruno" && !criteria.includes("Anglais")) criteria.push("Anglais");
        return String(notes[doc][criterion]);
    };
    const ranked = await rankDocuments({ infer, request: "Un comptable", getCriteria: () => criteria, documents: cvs });
    // Chaque document finit noté sur les trois critères, Alice compris (reprise en seconde passe).
    assert.ok(ranked.every((r) => Object.keys(r.scores).length === 3));
    assert.equal(calls, 9);
    assert.deepEqual(ranked.map((r) => r.doc.title), ["CV Chloé", "CV Alice", "CV Bruno"]);
    assert.match(rankingReport(ranked), /CV Chloé\*\* — 6,7\/9 \(Expérience 5 · Fiscalité 6 · Anglais 9\)/);
});
