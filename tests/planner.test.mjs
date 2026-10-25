// Tests de la réflexion avant réponse : node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";

import { planMessages, parsePlan, mergeReadings, chooseMessages, parseChoice, quote } from "../js/agents/planner.js";

test("plan : documents disponibles listés, lectures nettoyées, la question à défaut", () => {
    const [system] = planMessages("Que dois-je faire pour un déplacement ?", [{ name: "guide", title: "Guide des voyages", summary: "Règles de déplacement." }]);
    assert.match(system.content, /- Guide des voyages : Règles de déplacement\./);
    assert.deepEqual(parsePlan("1. plafond des repas\n- **réservation du train**\nhôtel\n4. avance de frais", "q"), ["plafond des repas", "réservation du train", "hôtel"]);
    assert.deepEqual(parsePlan("", "Que faire ?"), ["Que faire ?"]);
});

test("lectures fusionnées : sans doublon, bornées", () => {
    const a = { id: "a" }, b = { id: "b" }, c = { id: "c" };
    assert.deepEqual(mergeReadings([[a, b], [b, c], [a]]), [a, b, c]);
    assert.deepEqual(mergeReadings([[a, b, c]], 2), [a, b]);
});

test("choix du passage : un numéro valide, sinon le premier", () => {
    const sources = [{ index: 1, document: "A", text: "x" }, { index: 2, document: "B", text: "y" }];
    assert.match(chooseMessages("q", sources)[0].content, /\[2\] \(B\) y/);
    assert.equal(parseChoice("2", 2), 2);
    assert.equal(parseChoice("Le 7", 2), 1);
    assert.equal(parseChoice("aucun", 2), 1);
});

test("citation : coupée sur un mot", () => {
    assert.equal(quote("un  deux\ntrois"), "un deux trois");
    const long = quote("mot ".repeat(200), 50);
    assert.ok(long.endsWith("mot…") && long.length <= 51);
});
