// Tests de l'agent rédacteur (demandes venues de TextEdit) : node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";

import { taskMessages, isQuestion, cleanRewrite, markersIntact } from "../js/agents/editor.js";

test("consigne libre : une question appelle une réponse, une consigne une réécriture", () => {
    for (const q of ["Pourquoi cette porte est-elle auto-inverse ?", "explique ce passage", "Quel est le résultat", "Résume ce paragraphe"]) assert.ok(isQuestion(q), q);
    for (const c of ["Formule plus sobrement", "rends ça plus scientifique", "traduis en anglais"]) assert.ok(!isQuestion(c), c);
});

test("réécriture : consigne du bouton ou consigne libre, marqueurs à garder, longueur adaptée", () => {
    const sober = taskMessages({ action: "sobre", text: "Un résultat absolument incroyable ⟦1⟧ !" });
    assert.equal(sober.rewrite, true);
    assert.match(sober.messages[0].content, /plus sobre/);
    assert.match(sober.messages[0].content, /⟦1⟧, ⟦2⟧… remplacent des formules/);
    assert.equal(sober.messages[1].content, "Un résultat absolument incroyable ⟦1⟧ !");
    assert.equal(sober.maxTokens, 95);
    const free = taskMessages({ action: "consigne", instruction: "Rends-le plus scientifique", text: "x".repeat(2600) });
    assert.match(free.messages[0].content, /en suivant cette consigne : Rends-le plus scientifique/);
    assert.equal(free.maxTokens, 900);
});

test("question : le passage sélectionné sert de contexte, le texte n'est pas réécrit", () => {
    const ask = taskMessages({ action: "consigne", instruction: "Pourquoi H est-elle auto-inverse ?", text: "La porte de Hadamard est auto-inverse.", title: "TER quantique" });
    assert.equal(ask.rewrite, false);
    assert.match(ask.messages[0].content, /« TER quantique »/);
    assert.match(ask.messages[0].content, /"""\nLa porte de Hadamard est auto-inverse\.\n"""/);
    assert.equal(ask.messages[1].content, "Pourquoi H est-elle auto-inverse ?");
});

test("nettoyage : préambule, guillemets et bloc de code retirés", () => {
    assert.equal(cleanRewrite("Voici le texte corrigé :\n\nLe chat dort."), "Le chat dort.");
    assert.equal(cleanRewrite("« Le chat dort. »"), "Le chat dort.");
    assert.equal(cleanRewrite("```\nLe chat dort.\n```"), "Le chat dort.");
    // Des guillemets à l'intérieur du texte sont gardés.
    assert.equal(cleanRewrite("« Il a dit « oui ». »"), "« Il a dit « oui ». »");
});

test("marqueurs : tous présents une seule fois, aucun inventé", () => {
    assert.ok(markersIntact("a ⟦1⟧ b ⟦2⟧", "b ⟦2⟧ puis a ⟦1⟧"));
    assert.ok(!markersIntact("a ⟦1⟧ b ⟦2⟧", "a b ⟦2⟧"));
    assert.ok(!markersIntact("a ⟦1⟧", "a ⟦1⟧ ⟦1⟧"));
    assert.ok(!markersIntact("a", "a ⟦3⟧"));
});

test("API : « ask » répond toujours, « rewrite » réécrit toujours, le contexte est facultatif", () => {
    const ask = taskMessages({ action: "ask", instruction: "Formule une introduction", text: "Le texte." });
    assert.equal(ask.rewrite, false);
    assert.match(ask.messages[0].content, /Le texte\./);
    const plain = taskMessages({ action: "ask", instruction: "Bonjour !" });
    assert.equal(plain.rewrite, false);
    assert.match(plain.messages[0].content, /Tu es Cubi/);
    const rw = taskMessages({ action: "rewrite", instruction: "Pourquoi pas plus court ?", text: "Un texte." });
    assert.equal(rw.rewrite, true);
});

test("une consigne libre qui demande une action prête la prend, même mal tapée", () => {
    const fix = taskMessages({ action: "consigne", instruction: "corrige els faute stp", text: "La machine à compris." });
    assert.equal(fix.rewrite, true);
    assert.match(fix.messages[0].content, /Corrige l'orthographe, la grammaire/);
    const sober = taskMessages({ action: "consigne", instruction: "formule plus sobrement", text: "Génial !" });
    assert.match(sober.messages[0].content, /plus sobre et plus neutre/);
    const free = taskMessages({ action: "consigne", instruction: "traduis en anglais", text: "Bonjour." });
    assert.match(free.messages[0].content, /en suivant cette consigne : traduis en anglais/);
});

test("marqueurs malmenés par le modèle : remis d'aplomb plutôt que la réécriture jetée", async () => {
    const { repairMarkers } = await import("../js/agents/editor.js");
    const sent = "La porte ⟦1⟧ est vraiment super important, voir ⟦2⟧ pour la suite.";
    // oubliés : remis après le mot qui les précédait
    const fixed = repairMarkers(sent, "La porte est importante, voir pour la suite.");
    assert.ok(markersIntact(sent, fixed), fixed);
    assert.equal(fixed, "La porte ⟦1⟧ est importante, voir ⟦2⟧ pour la suite.");
    // écrits autrement, en double ou inventés
    assert.equal(repairMarkers(sent, "La porte [[1]] est importante, voir [2] pour la suite."), "La porte ⟦1⟧ est importante, voir ⟦2⟧ pour la suite.");
    assert.equal(repairMarkers(sent, "La porte ⟦1⟧ ⟦1⟧ est importante ⟦7⟧, voir ⟦2⟧ pour la suite."), "La porte ⟦1⟧ est importante, voir ⟦2⟧ pour la suite.");
    // collé à un mot (un lien) : recollé au même mot
    assert.equal(repairMarkers("voir [le cours⟦3⟧ demain", "voir [le cours demain"), "voir [le cours⟦3⟧ demain");
    assert.equal(repairMarkers("voir ⟦3⟧cours demain", "voir le cours demain"), "voir le ⟦3⟧cours demain");
    // au tout début
    assert.equal(repairMarkers("⟦1⟧ est une porte.", "C'est une porte."), "⟦1⟧ C'est une porte.");
    // sans marqueur : rien ne change, même des crochets ordinaires
    assert.equal(repairMarkers("Un texte [1].", "Un texte corrigé [1]."), "Un texte corrigé [1].");
});

test("développer : il garde le texte et ajoute, avec de la place ; la suite ; le code", () => {
    const grow = taskMessages({ action: "consigne", instruction: "developpe cette partie", text: "x".repeat(260) });
    assert.match(grow.messages[0].content, /Garde les phrases existantes/);
    assert.ok(grow.maxTokens >= 300, String(grow.maxTokens));
    const next = taskMessages({ action: "consigne", instruction: "écris la suite", text: "Un début." });
    assert.equal(next.append, true);
    assert.match(next.messages[0].content, /Réponds uniquement par la suite/);
    const code = taskMessages({ action: "consigne", instruction: "corrige le bug", text: "for i in range(3) print(i)", code: true });
    assert.match(code.messages[0].content, /développeur attentif/);
    assert.doesNotMatch(code.messages[0].content, /marqueurs/);
});

test("il voit ce que cachent les marqueurs, et garde le Markdown", () => {
    const { messages } = taskMessages({ action: "corriger", text: "On calcule ⟦1⟧ avec **soin**.", keep: ["`x = 2 * y`"] });
    assert.match(messages[0].content, /⟦1⟧ = `x = 2 \* y`/);
    assert.match(messages[0].content, /\*\*gras\*\*, \*italique\*/);
});

test("sur du code : la demande telle quelle, jamais une consigne prête pour du texte", () => {
    const fix = taskMessages({ action: "consigne", instruction: "corrige le code", text: "for i in range(3) print(i)", code: true });
    assert.equal(fix.rewrite, true);
    assert.doesNotMatch(fix.messages[0].content, /orthographe/);
    assert.match(fix.messages[0].content, /Modifie ce code en suivant cette consigne : corrige le code/);
    const loop = taskMessages({ action: "consigne", instruction: "continue la boucle jusqu'à 10", text: "for i in range(3): pass", code: true });
    assert.equal(loop.append, false);
    assert.equal(taskMessages({ action: "consigne", instruction: "donne un meilleur nom à la variable", text: "x = 1", code: true }).rewrite, true);
    assert.equal(taskMessages({ action: "consigne", instruction: "que fait ce code ?", text: "x = 1", code: true }).rewrite, false);
});
