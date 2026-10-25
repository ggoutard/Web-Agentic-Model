// Tests de l'aiguillage des demandes : node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";

import { routeQuestion } from "../js/router.js";

const mode = (text) => routeQuestion(text).mode;

test("politesses : échange cordial, sans recherche ni rapport", () => {
    for (const text of ["Bonjour", "bonjour Cubi !", "Salut, ça va ?", "Merci beaucoup", "Comment vas-tu ?", "Qui es-tu ?", "ok merci", "Bonne journée à toi"]) {
        assert.equal(mode(text), "conversation", text);
    }
});

test("une politesse suivie d'une vraie question n'est pas un simple échange", () => {
    assert.equal(mode("Bonjour, quand ferme l'atelier ?"), "simple");
    assert.equal(mode("Merci ! Et pour les congés d'été ?"), "simple");
});

test("questions ponctuelles : réponse courte", () => {
    assert.equal(mode("Quand ferme l'atelier ?"), "simple");
    assert.equal(mode("Qui est mon contact chez le client ?"), "simple");
});

test("demandes de détail : réponse complète, sans boîte aux lettres", () => {
    for (const text of ["Résume mes documents", "Liste les échéances", "Compare les deux devis", "Combien coûte un repas pour 4 ?"]) {
        assert.deepEqual([routeQuestion(text).mode, routeQuestion(text).deliver], ["complet", false], text);
    }
});

test("livrables demandés : réponse complète déposée dans la boîte aux lettres", () => {
    for (const text of ["Fais-moi un rapport sur les frais", "Rédige une note pour l'équipe", "prépare un courrier de relance", "J'ai besoin d'un rapport"]) {
        assert.deepEqual([routeQuestion(text).mode, routeQuestion(text).deliver], ["complet", true], text);
    }
});

test("prompt : la mission ouvre la consigne et rien ne la contredit", async () => {
    const { LogicalRAGPipeline } = await import("../js/rag/pipeline.js");
    const pipeline = new LogicalRAGPipeline(null);
    pipeline.persona = "Tu t'appelles Ada. Tu contrôles les notes de frais.";
    const [system] = pipeline.buildPrompt("Bonjour", [], "Réponds en une phrase.");
    assert.match(system.content, /^Tu t'appelles Ada\. Tu contrôles les notes de frais\./);
    assert.doesNotMatch(system.content, /assistant professionnel/);
});

test("classement : plusieurs documents et une demande de choix", () => {
    const two = { documents: 10 };
    for (const text of ["Quel CV recommandes-tu pour le poste de comptable ?", "Classe ces candidatures", "Lequel est le plus adapté ?", "Trouve le meilleur devis"]) {
        assert.equal(routeQuestion(text, two).mode, "classement", text);
    }
    assert.equal(routeQuestion("Fais-moi un rapport : quel est le meilleur CV ?", two).deliver, true);
    // Un seul document : rien à départager.
    assert.notEqual(routeQuestion("Quel CV recommandes-tu ?", { documents: 1 }).mode, "classement");
    assert.equal(routeQuestion("Bonjour", two).mode, "conversation");
});

test("retrouver : demander le document, la page ou le passage précis", () => {
    const docs = { documents: 4 };
    for (const text of ["Donne-moi le PDF qui parle des frais de repas", "Montre-moi le passage sur les congés", "Où est-il écrit que le plafond est de 35 € ?", "Dans quel document parle-t-on de télétravail ?", "À quelle page sont les horaires ?", "Trouve-moi la clause de résiliation"]) {
        assert.equal(routeQuestion(text, docs).mode, "retrouver", text);
    }
    assert.equal(routeQuestion("Donne-moi le PDF sur les frais", docs).deliver, true);
    // Sans document, rien à retrouver ; le classement reste prioritaire.
    assert.notEqual(routeQuestion("Donne-moi le PDF sur les frais").mode, "retrouver");
    assert.equal(routeQuestion("Trouve le document le plus adapté", docs).mode, "classement");
});
