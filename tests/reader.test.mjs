// Tests de l'agent lecteur, sans GPU : node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";

import { createReader, readFile, parseSheet, fallbackSheet, readingMessages } from "../js/agents/reader.js";

const item = { name: "facture-octobre", text: "Facture n°42\nMontant HT : 1 200 €\nTVA 20 %\nTotal TTC : 1 440 €\nÀ régler avant le 30 novembre." };

// ---------- Compréhension ----------

test("fiche : JSON valide, même entouré de texte", () => {
    const raw = `Voici : ${JSON.stringify({
        titre: "Facture d'octobre",
        resume: "Facture de 1 440 € TTC à régler.",
        points: ["Total 1 440 € TTC", "Échéance : 30 novembre"],
        concepts: ["Paiement", "comptabilité", "paiement"],
        reaction: "Une facture, je la garde en tête !",
    })}`;
    assert.deepEqual(parseSheet(raw, item), {
        title: "Facture d'octobre",
        summary: "Facture de 1 440 € TTC à régler.",
        points: ["Total 1 440 € TTC", "Échéance : 30 novembre"],
        concepts: ["paiement", "comptabilité"],
        reaction: "Une facture, je la garde en tête !",
    });
});

test("fiche : JSON cassé ou incomplet → fiche minimale", () => {
    const broken = parseSheet('{"titre": "x", ', item);
    assert.equal(broken.title, "Facture n°42");
    assert.deepEqual(broken.points, []);
    const partial = parseSheet('{"resume": "Une facture.", "points": "pas une liste"}', item);
    assert.equal(partial.summary, "Une facture.");
    assert.deepEqual(partial.points, []);
    assert.ok(partial.concepts.length > 0);
});

test("fiche : réaction très courte, listes bornées", () => {
    const raw = JSON.stringify({
        reaction: "un deux trois quatre cinq six sept huit neuf dix",
        points: ["a", "b", "c", "d", "e"],
        concepts: Array.from({ length: 20 }, (_, i) => `c${i}`),
    });
    const sheet = parseSheet(raw, item);
    assert.equal(sheet.reaction.split(" ").length, 8);
    assert.equal(sheet.points.length, 3);
    assert.equal(sheet.concepts.length, 8);
});

test("fiche minimale : titre de la première ligne, concepts fréquents", () => {
    const sheet = fallbackSheet("cr", "# Réunion budget\nLe budget marketing augmente. Le budget logistique baisse. Budget validé.");
    assert.equal(sheet.title, "Réunion budget");
    assert.equal(sheet.concepts[0], "budget");
});

test("prompt de lecture : demande résumé, points, concepts et tronque le document", () => {
    const messages = readingMessages({ name: "long", text: "x".repeat(10_000) }, "Tu t'appelles Cubi.");
    assert.match(messages[0].content, /^Tu t'appelles Cubi\./);
    for (const key of ["titre", "resume", "points", "concepts", "reaction"]) assert.ok(messages[0].content.includes(`"${key}"`));
    assert.ok(messages[1].content.length < 2200);
});

// ---------- Lecture ----------

test("lecture : texte accepté, formats inconnus et fichiers vides refusés", async () => {
    assert.match((await readFile(new File(["x"], "photo.png", { type: "image/png" }))).error, /\.png/);
    assert.match((await readFile(new File(["   "], "vide.txt", { type: "text/plain" }))).error, /vide/);
    const ok = await readFile(new File(["Bonjour"], "note.md", { type: "" }), { x: 1, y: 2 });
    assert.deepEqual(ok, { name: "note", text: "Bonjour", origin: { x: 1, y: 2 } });
});

test("lecture : PDF via l'extracteur fourni, scans et PDF illisibles signalés", async () => {
    const pdf = new File(["%PDF-1.7"], "contrat.pdf", { type: "application/pdf" });
    const read = await readFile(pdf, null, { extractPdf: async () => "  Contrat de prestation  " });
    // Le fichier d'origine est gardé pour rouvrir la page d'une citation.
    assert.deepEqual(read, { name: "contrat", text: "Contrat de prestation", origin: null, file: pdf });
    assert.match((await readFile(pdf, null, { extractPdf: async () => "" })).error, /scans/);
    assert.match((await readFile(pdf, null, { extractPdf: async () => { throw new Error("chiffré"); } })).error, /illisible/);
    assert.match((await readFile(pdf)).error, /PDF/);
});

// ---------- File de traitement ----------

test("file : un document à la fois, étapes dans l'ordre, rejet sans indexation", async () => {
    const log = [];
    const stored = [];
    const reader = createReader({
        understand: async (doc) => { log.push(`comprend ${doc.name}`); return fallbackSheet(doc.name, doc.text); },
        store: (doc) => stored.push(doc.name),
        onEvent: async (event) => { await new Promise((r) => setTimeout(r, 1)); log.push(`${event.type} ${event.item.name}`); },
    });
    reader.enqueue([item, { name: "scan", text: "", error: "format" }]);
    await reader.enqueue([{ name: "cr", text: "Compte rendu de réunion." }]);

    assert.deepEqual(log, [
        "received facture-octobre", "reading facture-octobre", "comprend facture-octobre", "understood facture-octobre", "stored facture-octobre",
        "received scan", "rejected scan",
        "received cr", "reading cr", "comprend cr", "understood cr", "stored cr",
    ]);
    assert.deepEqual(stored, ["facture-octobre", "cr"]);
    assert.equal(reader.busy, false);
});

test("file : un document déjà lu est refusé", async () => {
    const events = [];
    const reader = createReader({
        understand: async () => assert.fail("pas de lecture pour un doublon"),
        store: () => assert.fail("pas d'indexation pour un doublon"),
        findDuplicate: (doc) => doc.text === item.text,
        onEvent: (event) => events.push(event),
    });
    await reader.enqueue([{ ...item }]);
    assert.deepEqual(events.map((e) => e.type), ["received", "rejected"]);
});

test("file : si le modèle échoue, le document est quand même indexé", async () => {
    const stored = [];
    const reader = createReader({ understand: async () => { throw new Error("GPU"); }, store: (doc, sheet) => stored.push(sheet.title) });
    const warn = console.warn;
    console.warn = () => {};
    await reader.enqueue([item]);
    console.warn = warn;
    assert.deepEqual(stored, ["Facture n°42"]);
});

// ---------- Recherche sémantique ----------

test("recherche : les concepts de la fiche retrouvent un document sans le mot exact", async () => {
    globalThis.localStorage ??= { getItem: () => null, setItem: () => {} };
    globalThis.crypto ??= (await import("node:crypto")).webcrypto;
    const { KnowledgeBase } = await import("../js/knowledge.js");
    const { LogicalRAGPipeline } = await import("../js/rag/pipeline.js");

    const knowledge = new KnowledgeBase();
    const pipeline = new LogicalRAGPipeline(null);
    knowledge.attach(pipeline);
    knowledge.add("note-repas", "Le déjeuner client du 3 mars a coûté 168 euros pour quatre convives.", {
        title: "Déjeuner client",
        summary: "Repas d'affaires de 168 euros.",
        points: [],
        concepts: ["dépenses", "frais professionnels", "restaurant"],
    });
    knowledge.add("planning", "Le planning de l'équipe est publié chaque lundi.", { concepts: ["organisation"] });

    const sources = pipeline.search("Quelles dépenses ai-je faites ?");
    assert.ok(sources.length > 0);
    assert.equal(sources[0].document, "note-repas");
});
