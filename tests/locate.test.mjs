// Tests de la localisation d'un passage dans un document : node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";

import { bestPage, highlightRun, words } from "../js/locate.js";

test("mots : minuscules, sans accents, montants gardés", () => {
    assert.deepEqual(words("Plafond : 35 € par Repas, déjà validé."), ["plafond", "35", "€", "par", "repas", "deja", "valide"]);
});

test("page : celle qui contient le passage, même sans le texte exact", () => {
    const pages = [
        "Sommaire. Introduction à la politique de voyages.",
        "Frais de repas. Le plafond est fixé à 35 € par personne et par repas. Justificatif sous 30 jours.",
        "Hébergement. Les nuits d'hôtel sont plafonnées à 120 €.",
    ];
    assert.equal(bestPage("le plafond est fixé à 35 € par personne et par repas", pages).page, 2);
    assert.equal(bestPage("nuits d'hôtel plafonnées", pages).page, 3);
});

test("surlignage : la suite de lignes du passage, en tolérant une ligne intercalaire", () => {
    const lines = [
        "Article 4 — Frais de repas",
        "Le plafond est fixé à 35 € par personne",
        "",
        "et par repas, boissons comprises.",
        "Article 5 — Hébergement",
        "Les nuits d'hôtel sont remboursées sur facture.",
    ];
    assert.deepEqual(highlightRun("Le plafond est fixé à 35 € par personne et par repas, boissons comprises.", lines), { start: 1, end: 3 });
    assert.equal(highlightRun("Congés payés et RTT", lines), null);
});

test("passage précis : les phrases de l'extrait qui parlent du sujet demandé", async () => {
    const { preciseExcerpt } = await import("../js/locate.js");
    const chunk = "Sommaire. 1. Transports. 2. Frais de repas. 3. Hébergement.\nArticle 1 — Transports\nLe train est privilégié pour les trajets courts.\nArticle 2 — Frais de repas\nLe plafond est fixé à 35 euros par personne et par repas.\nArticle 3 — Hébergement\nLes nuits d'hôtel sont plafonnées à 120 euros.";
    assert.equal(preciseExcerpt("Donne-moi le PDF qui parle des frais de repas", chunk), "Article 2 — Frais de repas Le plafond est fixé à 35 euros par personne et par repas.");
    assert.equal(preciseExcerpt("Où est-il écrit que les nuits d'hôtel sont plafonnées ?", chunk), "Les nuits d'hôtel sont plafonnées à 120 euros.");
    // Rien de reconnaissable : l'extrait entier.
    assert.equal(preciseExcerpt("Donne-moi le document", chunk), chunk);
});

test("passage précis : le titre de section emmène son paragraphe ; le mot rare l'emporte", async () => {
    const { preciseExcerpt, highlightRun } = await import("../js/locate.js");
    const chunk = "La porte de Hadamard\nPorte auto-inverse qui applique une superposition quantique.\nDans le cadre de notre simulation, on n'ajoute pas un nouveau qubit.";
    assert.equal(preciseExcerpt("c'est quoi une porte de hadamard ?", chunk, { maxSentences: 2 }), "La porte de Hadamard Porte auto-inverse qui applique une superposition quantique.");
    // Sur la page, les lignes « Les portes de… » ne sont pas surlignées pour le seul mot « portes ».
    const lines = ["6 Les portes", "Les portes de Pauli", "La porte X", "La porte Y", "La porte de Hadamard", "Porte auto-inverse qui applique une superposition quantique.", "Les portes de déphasage", "Elles appliquent un déphasage.", "Les portes de rotations", "La porte RX"];
    assert.deepEqual(highlightRun("La porte de Hadamard Porte auto-inverse qui applique une superposition quantique.", lines), { start: 4, end: 5 });
});
