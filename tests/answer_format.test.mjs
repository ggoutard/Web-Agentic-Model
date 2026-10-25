// Tests du partage réponse courte (conversation) / rapport (fenêtre de mission) : node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";

import { splitAnswer, splitPartial, renderReport } from "../js/answer_format.js";

test("séparateur --- : phrase pour la conversation, rapport pour la fenêtre", () => {
    const text = "Oui, trois règles s'appliquent.\n\n---\n## Règles\n- Repas : 35 € [1]\n- Écran : accord préalable";
    assert.deepEqual(splitAnswer(text), {
        chat: "Oui, trois règles s'appliquent.",
        report: "## Règles\n- Repas : 35 € [1]\n- Écran : accord préalable",
    });
});

test("réponse simple : tout reste dans la conversation", () => {
    assert.deepEqual(splitAnswer("L'atelier ferme à 18 h [1]."), { chat: "L'atelier ferme à 18 h [1].", report: "" });
});

test("sans séparateur mais long ou structuré : premier paragraphe en conversation, le reste en rapport", () => {
    const text = "Voici la synthèse de vos documents.\n\n## Horaires\nDe 9 h à 18 h.\n\n## Congés\n- Demande 30 jours avant";
    const { chat, report } = splitAnswer(text);
    assert.equal(chat, "Voici la synthèse de vos documents.");
    assert.match(report, /^## Horaires/);

    const listOnly = splitAnswer("- un\n- deux\n- trois");
    assert.equal(listOnly.chat, "Voici le détail.");
    assert.equal(listOnly.report, "- un\n- deux\n- trois");
});

test("rapport seul (le modèle commence par ---) : phrase par défaut", () => {
    assert.deepEqual(splitAnswer("---\n## Détail\nTexte"), { chat: "Voici le détail.", report: "## Détail\nTexte" });
});

test("pendant la génération : la suite du séparateur part dans le rapport", () => {
    assert.deepEqual(splitPartial("Bonjour, je regarde"), { chat: "Bonjour, je regarde", report: "" });
    assert.deepEqual(splitPartial("C'est fait.\n---\n## Tit"), { chat: "C'est fait.", report: "## Tit" });
});

test("rendu du rapport : titres, listes, gras, citations valides, HTML échappé", () => {
    const html = renderReport("## Synthèse\nUn **point** [1] et [9].\n- a\n- b\n1. premier\n<script>", 2);
    assert.equal(html, '<h3>Synthèse</h3><p>Un <strong>point</strong> <sup class="fn-ref">1</sup> et [9].</p><ul><li>a</li><li>b</li></ul><ol><li>premier</li></ol><p>&lt;script&gt;</p>');
});

test("nettoyage : les paragraphes répétés par le modèle sont retirés", async () => {
    const { tidyAnswer } = await import("../js/answer_format.js");
    assert.equal(tidyAnswer("Bonjour.\n\nJe suis là.\n\nbonjour.\n\nJe  suis là."), "Bonjour.\n\nJe suis là.");
});

test("PDF : blocs du rapport, gras, caractères hors police remplacés", async () => {
    const { reportBlocks, inlineRuns, pdfSafe, reportTitle, fileName } = await import("../js/report_pdf.js");
    assert.deepEqual(reportBlocks("## Synthèse\n- Plafond **35 €** [1]\n\n1. Alice\n2. Chloé\n### Détail\nTexte."), [
        { type: "h2", text: "Synthèse" },
        { type: "li", text: "Plafond **35 €** [1]" },
        { type: "ol", text: "Alice", n: 1 },
        { type: "ol", text: "Chloé", n: 2 },
        { type: "h3", text: "Détail" },
        { type: "p", text: "Texte." },
    ]);
    assert.deepEqual(inlineRuns("Plafond **35 €** par repas"), [{ text: "Plafond ", bold: false }, { text: "35 €", bold: true }, { text: " par repas", bold: false }]);
    assert.equal(pdfSafe("Voir → page 2 ≥ 3 ✅ « œuvre » — 35 €"), "Voir -> page 2 >= 3  « œuvre » — 35 €");
    assert.equal(reportTitle({ kind: "question", title: "Quel CV ?" }), "Quel CV ?");
    assert.equal(reportTitle({ kind: "question", title: " " }), "Rapport");
    assert.equal(fileName({ title: "Quel CV / poste ?" }), "Quel CV poste");
});
