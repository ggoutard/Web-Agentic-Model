// Tests de la recherche dans les documents (sans modèle) : node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";

import { LogicalRAGPipeline } from "../js/rag/pipeline.js";
import { chunkText } from "../js/rag/chunking.js";

// Page 13 d'un rapport de stage : la section Hadamard est courte, « porte » est partout.
const PAGE = `6 Les portes
En programmation quantique, un qubit peut subir des opérations que l'on appelle portes.
Dans le cas de notre simulation quantique, cela se réfère à des opérations matricielles, plus exactement des produits scalaires entre nos qubits et d'autres matrices, nos portes.
Les portes de Pauli
Les portes élémentaires qui effectuent des rotations dans les trois axes de l'espace de Hilbert pour ce qubit. Chacune représente une base de changement d'orientation des qubits et elles sont auto-inverses.
La porte X
La porte Y
La porte Z
La porte de Hadamard
Porte auto-inverse qui applique une superposition quantique, une propriété physique qui va créer un état second au qubit. Dans le cadre de notre simulation, on n'ajoute pas un nouveau qubit ; le résultat est dans le vecteur du qubit qui subit la rotation.
Les portes de déphasage
Elles appliquent un déphasage, ce qui change d'état sans modifier les probabilités qui leur sont associées.
La porte S
La porte T
Les portes de rotations
Les portes de rotations sont comme les portes de Pauli, elles effectuent des rotations autour des axes X, Y, Z, mais à la différence que ces rotations permettent des rotations fixes sur un θ arbitraire.
La porte RX
La porte RY
La porte RZ`;

test("découpage : une section par passage, avec son titre ; les listes restent dans leur section", () => {
    const chunks = chunkText(PAGE);
    const hadamard = chunks.find((c) => c.includes("superposition"));
    assert.ok(hadamard.startsWith("La porte de Hadamard\n"), hadamard);
    assert.ok(!hadamard.includes("déphasage"));
    assert.ok(chunks.some((c) => c.startsWith("Les portes de Pauli") && c.includes("La porte Z")));
});

test("recherche : le mot rare de la question l'emporte sur le mot répété partout", () => {
    const pipeline = new LogicalRAGPipeline(null);
    pipeline.ingest(PAGE, ["TER ML Quantique"], "TER ML Quantique");
    const [first] = pipeline.search("c'est quoi une porte de hadamard ?");
    assert.match(first.text, /^La porte de Hadamard\nPorte auto-inverse qui applique une superposition/);
    assert.match(pipeline.search("à quoi servent les portes de déphasage")[0].text, /^Les portes de déphasage/);
});

test("recherche : « porte » ne trouve plus « apporte »", () => {
    const pipeline = new LogicalRAGPipeline(null);
    pipeline.ingest("Ce projet apporte une aide aux étudiants.", ["a"], "a");
    pipeline.ingest("La porte du bâtiment ferme à 18 h.", ["b"], "b");
    const found = pipeline.search("quelle porte ferme");
    assert.equal(found[0].document, "b");
    assert.ok(!found.some((s) => s.document === "a"));
});
