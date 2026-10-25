import { loadEngine, isFirstVisit } from "./engine.js";
import { LogicalRAGPipeline } from "./rag/pipeline.js";
import { BonsaiAdapter } from "./rag/model_adapter.js";
import { KnowledgeBase } from "./knowledge.js";
import { createCharacter } from "./character.js";
import { createStudio } from "./studio.js";
import { createMissionPanel, markCitations } from "./mission.js";
import { createViewer } from "./pdf_viewer.js";
import { createMailbox } from "./mailbox.js";
import { splitAnswer, splitPartial, tidyAnswer } from "./answer_format.js";
import { routeQuestion, MODES } from "./router.js";
import { fly, bump, center, handsPoint } from "./fly.js";
import { createBubble } from "./bubble.js";
import { createTour } from "./tour.js";
import { createBridge } from "./bridge.js";
import { STATUS_LINES } from "./status_lines.js";
import { rankDocuments, rankingReport, recommendationMessages, criteriaMessages, parseCriteria, formatScore, MAX_DOCUMENTS } from "./agents/ranker.js";
import { planMessages, parsePlan, mergeReadings, chooseMessages, parseChoice, quote } from "./agents/planner.js";
import { loadFile } from "./file_store.js";
import { openPdf, pageTexts } from "./pdf_text.js";
import { bestPage, preciseExcerpt } from "./locate.js";
import { createDocumentDrop } from "./document_drop.js";
import { loadProfile, saveProfile, personaPrompt } from "./profile.js";
import { findCrew } from "./crew.js";
import { runAgent } from "./agents/runner.js";
import { TOOLS } from "./agents/tools.js";
import { $, escapeHTML, formatNumber, renderAnswer, autoResize } from "./ui_utils.js";

// Part de la barre de chargement attribuée à chaque étape.
const STEP_WEIGHTS = { download: [0, 0.7], upload: [0.7, 0.85], compile: [0.85, 0.95], tune: [0.95, 1] };

// Après une réponse : il suit la souris ce temps-là, puis retourne à ses occupations.
const ATTENTION_SECONDS = 10;
// Une bulle reste affichée ce temps-là ; tout reste lisible dans la conversation, à droite.
const BUBBLE_SECONDS = 15;

const DOC_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/></svg>`;

const ui = {
    app: $("app"),
    form: $("prompt"),
    input: $("input"),
    send: $("send"),
    attach: $("btn-attach"),
    mailbox: $("btn-mailbox"),
    chatToggle: $("btn-chat"),
    fileInput: $("file-input"),
    attachments: $("attachments"),
    progress: $("progress-fill"),
    note: $("note"),
    docsDialog: $("docs-dialog"),
    docList: $("doc-list"),
    docEmpty: $("doc-empty"),
    pasteText: $("paste-text"),
    pasteBtn: $("btn-paste"),
};

const knowledge = new KnowledgeBase();
let profile = loadProfile();
let runtime = null;
let abort = null;

// ---------- Personnage et personnalisation ----------

const characterEl = $("character");
const bubble = createBubble($("bubble"));
let character = null;
let mood = "sleep";
try {
    character = createCharacter(characterEl, { color: profile.color, accessories: profile.accessories });
} catch (error) {
    console.warn("Personnage 3D indisponible (WebGL) :", error);
    characterEl.closest(".character-slot").hidden = true;
}
// Invisible pendant le chargement : on laisse la carte graphique au modèle.
character?.setPaused(true);

function setMood(next) {
    mood = next;
    if (!studio?.isOpen()) character?.setMood(next);
}

function applyProfile() {
    // Le personnage choisi donne son nom à l'application (en haut à gauche et dans l'onglet).
    $("brand").textContent = profile.name;
    document.title = `${profile.name} — votre secrétaire IA locale`;
    characterEl.setAttribute("aria-label", `Personnaliser ${profile.name}`);
    ui.input.placeholder = `Demander à ${profile.name}`;
    if (!runtime) return;
    const persona = personaPrompt(profile);
    // Nouveau rôle : on oublie les échanges écrits avec l'ancien, sinon le modèle continue sur sa lancée.
    if (persona !== runtime.pipeline.persona) runtime.pipeline.resetConversation();
    runtime.pipeline.persona = persona;
    runtime.pipeline.mission = profile.mission;
}

const studio = character && createStudio({
    app: ui.app,
    characterEl,
    character,
    getProfile: () => profile,
    onChange: (next) => {
        profile = next;
        saveProfile(profile);
        applyProfile();
    },
    onClose: () => character.setMood(mood),
    onScenario: loadScenario,
    // La demande d'exemple attend dans le champ : on peut la relire avant de l'envoyer.
    onPrompt: (text) => {
        ui.input.value = text;
        autoResize(ui.input);
        updateSend();
        ui.input.focus();
    },
});

applyProfile();

// Documents fictifs d'un personnage : ajoutés une seule fois, déjà résumés (pas de lecture par le modèle).
function loadScenario(member) {
    const scenario = member.scenario;
    if (!scenario) return;
    if (scenario.withSample) knowledge.addSample();
    for (const doc of scenario.documents) {
        if (!knowledge.findByName(doc.name)) knowledge.add(doc.name, doc.text, doc.sheet);
    }
}

// ---------- État général ----------

function setNote(html, { error = false } = {}) {
    ui.note.innerHTML = html;
    ui.note.classList.toggle("is-error", error);
}

function updateSend() {
    // Pendant un travail, un texte saisi part comme remarque ; sans texte, le bouton arrête.
    const remark = Boolean(abort) && ui.input.value.trim() !== "";
    ui.send.classList.toggle("is-stop", Boolean(abort) && !remark);
    ui.send.setAttribute("aria-label", remark ? "Envoyer la remarque" : abort ? "Arrêter" : "Envoyer");
    ui.send.disabled = !runtime || (!abort && ui.input.value.trim() === "");
}

// ---------- Documents ----------

function renderDocuments() {
    const docs = knowledge.documents;
    ui.attach.dataset.count = docs.length > 0 ? String(docs.length) : "";
    ui.docEmpty.hidden = docs.length > 0;
    ui.docList.replaceChildren(...docs.map((doc) => {
        const item = document.createElement("li");
        item.className = "doc-item";
        const words = doc.text.trim().split(/\s+/).length;
        const sub = doc.summary || `${formatNumber(words)} mots`;
        item.innerHTML = `
            ${DOC_ICON}
            <span class="doc-meta"><span class="doc-name">${escapeHTML(doc.title || doc.name)}</span><span class="doc-sub">${escapeHTML(sub)}</span></span>
            <button type="button" class="icon-btn" aria-label="Retirer ${escapeHTML(doc.name)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>`;
        item.title = doc.name;
        item.querySelector("button").addEventListener("click", () => knowledge.remove(doc.id));
        return item;
    }));
}

// ---------- Conversation (volet de droite) et boîte aux lettres ----------

// Une citation ouvre le document d'origine par-dessus l'interface, le passage surligné.
const viewer = createViewer({ findDocument: (name) => knowledge.findByName(name) });
const cite = (source) => viewer.open({ document: source.document, passage: source.excerpt ?? source.text, page: source.page ?? null });
const missions = createMissionPanel({ app: ui.app, toggle: ui.chatToggle, getOwner: () => profile.name, onCite: cite });
const mailbox = createMailbox({
    button: ui.mailbox,
    // Un extrait s'ouvre directement sur sa page ; un rapport, dans la conversation.
    onOpen: (record) => (record.extract ? viewer.open(record.extract) : missions.show(record)),
    getAuthor: () => profile.name,
});

// TextEdit, ouvert dans un autre onglet du même site, envoie ses passages à relire ou ses questions.
const bridge = createBridge({
    getRuntime: () => runtime,
    getName: () => profile.name,
    character,
    bubble,
    missions,
    setMood,
});

// Glisser-déposer et import : l'agent lecteur lit, résume et indexe chaque document.
const documentDrop = createDocumentDrop({
    app: ui.app,
    characterEl,
    character,
    bubble,
    tray: ui.attach,
    missions,
    knowledge,
    getRuntime: () => runtime,
    getPersona: () => personaPrompt(profile),
    restoreMood: () => character?.setMood(mood),
    // Sa réaction reste dans la bulle, avec un lien vers la fiche quand elle a du contenu.
    onRead: (item, sheet, record, mission) => {
        missionRecords.set(record.id, record);
        mission.answer(`<p>${escapeHTML(sheet.reaction)}</p>`);
        bubble.show(`<div class="bubble-text"><p>${escapeHTML(sheet.reaction)}</p></div>${record.report ? reportLink(record) : ""}`);
        bubble.hide(BUBBLE_SECONDS * 1000);
        character?.wake(ATTENTION_SECONDS, { startle: false });
    },
});

knowledge.onChange(() => {
    renderDocuments();
});

ui.attach.addEventListener("click", () => ui.docsDialog.showModal());
$("btn-import").addEventListener("click", () => ui.fileInput.click());

ui.fileInput.addEventListener("change", () => {
    const files = [...(ui.fileInput.files ?? [])];
    ui.fileInput.value = "";
    ui.docsDialog.close();
    documentDrop.importFiles(files);
});

$("btn-sample").addEventListener("click", () => knowledge.addSample());
ui.pasteText.addEventListener("input", () => { ui.pasteBtn.disabled = ui.pasteText.value.trim() === ""; });
ui.pasteBtn.addEventListener("click", () => {
    const text = ui.pasteText.value.trim();
    if (!text) return;
    ui.pasteText.value = "";
    ui.pasteBtn.disabled = true;
    ui.docsDialog.close();
    documentDrop.importText(`Texte ${knowledge.documents.length + 1}`, text);
});

for (const dialog of [ui.docsDialog, $("info-dialog")]) {
    dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });
}
$("btn-info").addEventListener("click", () => $("info-dialog").showModal());
// Sans personnage 3D (WebGL absent), pas d'atelier : le bouton disparaît.
$("btn-crew").hidden = !studio;
$("btn-crew").addEventListener("click", () => studio?.open("crew"));

// ---------- Réponses ----------
// Une réponse courte s'écrit dans la bulle du personnage ; le développement (et la réflexion de
// l'agent) s'affiche dans le volet de droite, qui ne s'ouvre que lorsqu'il y a quelque chose à lire.

function reportLink(record) {
    return `<button type="button" class="report-link" data-mission="${record.id}">Voir le détail <span aria-hidden="true">→</span></button>`;
}

// Sources de la réponse affichée dans la bulle, pour ses citations cliquables.
let bubbleSources = [];

$("bubble").addEventListener("click", (event) => {
    const cited = event.target.closest("[data-source]");
    if (cited) {
        const source = bubbleSources.find((s) => String(s.index) === cited.dataset.source);
        if (source) cite(source);
        return;
    }
    const link = event.target.closest(".report-link");
    if (!link) return;
    const record = missionRecords.get(link.dataset.mission) ?? mailbox.find(link.dataset.mission);
    if (!record) return;
    missions.show(record);
    mailbox.markRead(record.id);
});

// Documents cités par une réponse courte, en bas de la bulle.
function citedDocuments(text, sources) {
    const cited = new Set([...text.matchAll(/\[(\d+)\]/g)].map((m) => sources[Number(m[1]) - 1]?.document).filter(Boolean));
    return cited.size ? `<p class="bubble-sources">Source : ${[...cited].map(escapeHTML).join(", ")}</p>` : "";
}

// Le personnage prend le livrable et le dépose dans la boîte aux lettres.
async function deliver(record) {
    if (character && !studio?.isOpen()) {
        character.setDocument("hold");
        await sleep(450);
        character.setDocument("toss");
        await fly({ from: handsPoint(characterEl), to: center(ui.mailbox), character, className: "flying-letter" });
    }
    bump(ui.mailbox);
    mailbox.deliver(record);
}

// Le document sort de son ordinateur : il le prend et le pose dans la conversation, sur sa feuille.
async function handOver(target) {
    if (!character || studio?.isOpen() || !target?.getClientRects().length) return;
    character.setDocument("hold");
    await sleep(600);
    character.setDocument("toss");
    await fly({ from: handsPoint(characterEl), to: center(target), character, shrink: false });
}

// Réponse dite de vive voix : il parle le temps de la phrase, puis se tait.
let speaking = 0;
function speak(text) {
    clearTimeout(speaking);
    setMood("talk");
    speaking = setTimeout(() => { if (mood === "talk") setMood("idle"); }, Math.min(5000, Math.max(1200, text.length * 55)));
}

const missionRecords = new Map();
// Travail en cours : ses remarques reçues en route ; `live` s'il peut en tenir compte tout de suite.
let job = null;
// Demandes arrivées pendant un travail qui ne peut pas les intégrer : traitées juste après.
const pending = [];

function remark(text) {
    const note = text.trim();
    if (job?.live) {
        job.remarks.push(note);
        job.mission.remark(note);
        job.mission.step("Remarque reçue", excerpt(note, 70)).done("ajoutée à la grille, documents déjà lus repris");
    } else {
        missions.user(note);
        pending.push(note);
        missions.note("Noté : je m'en occupe juste après.");
    }
    character?.gesture("hop");
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function send(text) {
    const question = text.trim();
    if (!question) return;
    if (!runtime) {
        setNote("Je me prépare encore — encore un instant.");
        return;
    }
    if (abort) return;

    ui.attachments.replaceChildren();
    ui.attachments.hidden = true;
    // La question reste en rappel en haut de la bulle.
    const head = `<p class="bubble-question">${escapeHTML(question)}</p>`;
    bubble.working(STATUS_LINES.thinking, head);
    missions.user(question);
    // Petit sursaut : il a bien reçu le message. Dès le premier message, il vit sa vie entre deux
    // échanges et ne réagit plus qu'à la conversation.
    character?.setAutonomous(true);
    character?.wake(ATTENTION_SECONDS);

    abort = new AbortController();
    updateSend();
    setMood("think");
    // Aiguillage : échange cordial, réponse courte ou réponse détaillée (voir router.js).
    // Une mission court-circuite l'aiguillage : chaque demande va droit au modèle, avec elle seule.
    // Un personnage de l'équipe traite lui-même, avec ses outils, tout ce qui n'est ni un échange
    // cordial, ni un classement, ni la recherche d'un passage (ces chemins dédiés restent plus fiables).
    const member = findCrew(profile.crew);
    const routed = profile.mission ? null : routeQuestion(question, { documents: knowledge.documents.length });
    const route = profile.mission
        ? { mode: "mission", reason: "consignes remplacées par la mission" }
        : member.agent && (routed.mode === "simple" || routed.mode === "complet")
            ? { ...routed, mode: "agent", reason: `${member.role} : outils ${member.agent.tools.length}` }
            : routed;
    ui.input.placeholder = route.mode === "classement" ? `Une remarque pour ${profile.name} pendant qu'il travaille ?` : `Votre prochaine demande pour ${profile.name}…`;
    const mode = MODES[route.mode];
    const detailed = route.mode === "complet" || route.mode === "classement" || route.mode === "agent";
    const mission = missions.begin({ kind: "question", title: question });
    mission.step("Analyse de la demande").done(`${mode.label} · ${route.reason}`);
    mission.step(`Rôle : ${profile.name}`).done(profile.mission ? excerpt(profile.mission, 70) : "secrétaire (par défaut)");
    const waiting = mission.step("En attente du modèle");
    job = { mission, remarks: [], live: route.mode === "classement" };

    try {
        const signal = abort.signal;
        const result = await runtime.adapter.exclusive(() => {
            waiting.done();
            if (route.mode === "classement") return answerByRanking(question, head, mission, mode, signal);
            if (route.mode === "retrouver") return answerByLocating(question, head, mission, signal);
            if (route.mode === "agent") return answerWithAgent(question, head, mission, member.agent, signal);
            return answerFromDocuments(question, head, mission, mode, signal);
        });

        // Chaque source garde, pour la visionneuse, les phrases précises qui répondent à la question.
        for (const source of result.sources) source.excerpt ??= preciseExcerpt(question, source.text);
        // Hors mode détaillé, tout reste dans la bulle, même si le modèle a tenté un rapport.
        const split = detailed ? splitAnswer(result.text) : { chat: tidyAnswer(splitPartial(result.text).chat), report: "" };
        const chat = split.chat;
        const report = [result.reportPrefix, split.report].filter(Boolean).join("\n\n");
        mission.report(report);
        mission.sources(result.sources);
        const hasReport = Boolean(report) || mission.record.deliverables.length > 0;
        // Un passage retrouvé devient un « extrait » : rouvert depuis la boîte aux lettres, il montre sa page.
        const extract = result.extract ?? null;
        if (extract) {
            mission.record.kind = "extrait";
            mission.record.extract = extract;
        }
        // La boîte aux lettres ne reçoit que les livrables demandés (rapport, note, courrier, extrait…).
        const mailed = (hasReport || extract) && (route.deliver || mission.record.deliverables.length > 0);
        if (mailed) mission.step(extract ? "Extrait déposé dans la boîte aux lettres" : "Livrable déposé dans la boîte aux lettres").done();
        mission.record.summary = chat;
        const record = mission.finish(abort.signal.aborted ? "stopped" : "done");
        missionRecords.set(record.id, record);
        const passageLink = extract ? `<button type="button" class="report-link" data-source="1">Voir le passage surligné <span aria-hidden="true">→</span></button>` : "";
        const text = (chat ? renderAnswer(chat, result.sources.length) : "<p>(réponse vide)</p>") + passageLink;
        bubble.show(`${head}<div class="bubble-text">${text}</div>${hasReport ? reportLink(record) : extract ? "" : citedDocuments(chat, result.sources)}`);
        bubbleSources = result.sources;
        markCitations($("bubble"), result.sources);
        mission.answer(text);
        if (hasReport) mission.reveal();
        // Après avoir écrit en silence, il se lève, donne sa réponse et tend son document.
        const wrote = job.wrote;
        character?.setActivity(null);
        if (wrote || result.silent) speak(chat);
        else setMood("idle");
        if (mailed) deliver(record);
        else if (hasReport && wrote) handOver(mission.reportElement);
        // Il garde l'attention sur vous un moment, puis retourne à ses occupations ; la bulle s'efface.
        character?.wake(ATTENTION_SECONDS, { startle: false });
        bubble.hide(BUBBLE_SECONDS * 1000);
    } catch (error) {
        console.error("Erreur de génération :", error);
        mission.step("Erreur").fail(error.message);
        mission.finish("error");
        const failure = `<p class="bubble-error">Je n'ai pas pu répondre : ${escapeHTML(error.message)}</p>`;
        bubble.show(`${head}${failure}`);
        bubble.hide(BUBBLE_SECONDS * 1000);
        mission.answer(failure);
        setMood("sad");
    } finally {
        const stopped = abort?.signal.aborted;
        abort = null;
        job = null;
        character?.setActivity(null);
        applyProfile();
        updateSend();
        ui.input.focus();
        if (stopped) pending.length = 0;
        const next = pending.shift();
        if (next) setTimeout(() => send(next), 400);
    }
}

// Texte en cours de génération : la phrase naturelle dans la bulle ; dès que le modèle passe au
// développement (après « --- »), le volet de droite s'ouvre et le reçoit, et la bulle dit qu'il rédige.
// `reportPrefix` : début du développement déjà connu (le classement, par exemple).
function streamInto(head, mission, writing, { detailed = true, reportPrefix = "" } = {}) {
    let drafting = false;
    return (partial) => {
        if (mood !== "talk") setMood("talk");
        const split = splitPartial(partial);
        const report = detailed ? split.report : "";
        if (split.chat.trim()) mission.answer(renderAnswer(split.chat));
        if (!report) {
            bubble.show(`${head}<div class="bubble-text">${renderAnswer(split.chat)}<span class="caret"></span></div>`);
            return;
        }
        if (!drafting) {
            drafting = true;
            bubble.working(STATUS_LINES.writing, `${head}<div class="bubble-text">${renderAnswer(split.chat)}</div>`);
            mission.reveal();
            writing.update("développement en cours");
            // Un développement à écrire : il s'installe à son ordinateur.
            character?.setActivity("laptop");
            if (job) job.wrote = true;
        }
        mission.report([reportPrefix, report].filter(Boolean).join("\n\n"));
    };
}

// Sans compétence : recherche dans les documents puis une seule génération.
async function answerFromDocuments(question, head, mission, mode, signal) {
    let ranked = null;
    if (mode.retrieve && mode === MODES.complet && !knowledge.isEmpty) {
        // Réponse détaillée : il réfléchit d'abord à ce qu'il doit lire, puis fait chaque lecture.
        ranked = await readDocuments(question, head, mission, signal);
        if (signal.aborted) return { text: "", sources: [] };
    } else if (mode.retrieve) {
        character?.setActivity("screen");
        bubble.working(STATUS_LINES.searching, head);
        const searching = mission.step("Recherche dans vos documents");
        const found = runtime.pipeline.search(question);
        searching.done(describeFound(found));
        // Réponse courte : il se relève pour la dire.
        character?.setActivity(null);
    }

    const writing = mission.step("Rédaction de la réponse");
    const options = { maxTokens: mode.maxTokens, retrieve: mode.retrieve, instructions: mode.instructions, ranked, signal };
    const result = await runtime.pipeline.generate(question, options, streamInto(head, mission, writing, { detailed: mode === MODES.complet }));
    const stats = runtime.adapter.lastStats;
    writing.done(stats?.tokensPerSecond ? `${formatNumber(stats.tokensPerSecond, 1)} tokens/s` : "");
    return { text: result.answer, sources: result.sources };
}

// Appels de fonction : le modèle choisit ses outils (lister, lire, calculer, dater, noter) ; chaque
// appel devient une étape visible de la mission, et sa réponse finale arrive comme les autres.
async function answerWithAgent(question, head, mission, agent, signal) {
    const calls = new Map();
    const writing = mission.step("Rédaction de la réponse");
    let stream = streamInto(head, mission, writing);
    let text = "";
    character?.setActivity("screen");
    try {
        await runAgent({
            session: runtime.adapter.session,
            agent: { ...agent, instructions: `${personaPrompt(profile)}\n\n${agent.instructions}` },
            input: question,
            history: runtime.pipeline.history.slice(-4),
            context: { pipeline: runtime.pipeline, knowledge, addDeliverable: (item) => mission.deliverable(item) },
            signal,
            onEvent(event) {
                if (event.type === "step") {
                    // Nouvelle étape : le texte d'avant n'était qu'un préambule à l'appel d'outil.
                    text = "";
                    stream = streamInto(head, mission, writing);
                } else if (event.type === "text") {
                    text += event.text;
                    // Un appel d'outil s'écrit aussi en texte : on ne le montre pas comme une réponse.
                    if (!/<tool_call>|^\s*\{/.test(text)) stream(text);
                } else if (event.type === "tool-start") {
                    character?.setActivity("screen");
                    bubble.working(`${TOOLS[event.name]?.label ?? event.name}…`, head);
                    calls.set(event.id, mission.step(TOOLS[event.name]?.label ?? event.name, excerpt(describeArgs(event.args), 70)));
                } else if (event.type === "tool-end") {
                    const step = calls.get(event.id);
                    if (event.error) step?.fail(event.error);
                    else step?.done(excerpt(event.output.replace(/\s+/g, " "), 70));
                } else if (event.type === "final") {
                    text = event.text;
                }
            },
        });
    } catch (error) {
        if (!signal.aborted) throw error;
    }
    character?.setActivity(null);
    writing.done(`${calls.size} appel${calls.size > 1 ? "s" : ""} d'outil`);
    runtime.pipeline.remember(question, text);
    return { text, sources: [] };
}

function describeArgs(args) {
    const values = Object.values(args ?? {}).map(String).filter(Boolean);
    return values.length ? values.join(" · ") : "sans paramètre";
}

function describeFound(found) {
    const documents = new Set(found.map((source) => source.document)).size;
    return found.length ? `${found.length} passage${found.length > 1 ? "s" : ""} · ${documents} document${documents > 1 ? "s" : ""}` : "aucun passage pertinent";
}

// Réflexion puis lectures : le modèle prévoit quelques recherches, chacune lue à l'écran ; les
// passages de toutes les lectures sont réunis pour une seule rédaction.
async function readDocuments(question, head, mission, signal) {
    character?.setActivity("screen");
    bubble.working(STATUS_LINES.planning, head);
    const planning = mission.step("Réflexion : ce que je dois lire");
    const plan = parsePlan(await runtime.adapter.infer(planMessages(question, knowledge.documents), 70, null, { signal }), question);
    planning.done(plan.join(" · "));
    const readings = [];
    for (const [i, query] of plan.entries()) {
        if (signal.aborted) return null;
        bubble.working(STATUS_LINES.searching, head);
        const reading = mission.step(`Lecture ${i + 1} · ${excerpt(query, 50)}`);
        const chunks = runtime.pipeline.searchChunks(query);
        readings.push(chunks);
        reading.done(describeFound(runtime.pipeline.toSources(chunks)));
        // Le temps de parcourir l'écran : les lectures restent visibles une à une.
        await sleep(350);
    }
    const passages = mergeReadings(readings);
    mission.step("Analyse des lectures").done(`${passages.length} passage${passages.length > 1 ? "s" : ""} retenu${passages.length > 1 ? "s" : ""}`);
    return passages.length ? passages : null;
}

// « Donne-moi le PDF qui… » : le passage le plus précis, sa page dans le document d'origine,
// et la citation ; on l'ouvre surligné d'un clic.
async function answerByLocating(question, head, mission, signal) {
    character?.setActivity("screen");
    bubble.working(STATUS_LINES.locating, head);
    const searching = mission.step("Recherche du passage");
    const found = runtime.pipeline.search(question);
    searching.done(describeFound(found));
    if (found.length === 0) {
        return { text: "Je n'ai trouvé aucun passage qui corresponde dans vos documents.", sources: [], silent: true };
    }

    // Choix du passage le plus précis : un chiffre, comme un modèle de décision.
    const choosing = mission.step("Choix du passage le plus précis");
    const pick = found.length > 1 ? parseChoice(await runtime.adapter.infer(chooseMessages(question, found), 2, null, { signal }), found.length) : 1;
    if (signal.aborted) return { text: "", sources: [] };
    const chosen = found[pick - 1];
    // Dans l'extrait trouvé, les phrases précises qui répondent : c'est ce qu'on surligne et cite.
    const passage = preciseExcerpt(question, chosen.text);
    const doc = knowledge.findByName(chosen.document);
    choosing.done(`extrait ${pick} · ${doc?.title || chosen.document}`);

    // Dans un PDF conservé, la page où se trouve le passage.
    let page = null;
    const blob = doc?.pdf ? await loadFile(doc.id) : null;
    if (blob) {
        const paging = mission.step("Ouverture du PDF d'origine");
        const pdf = await openPdf(blob);
        try {
            page = bestPage(passage, await pageTexts(pdf)).page;
            paging.done(`page ${page} / ${pdf.numPages}`);
        } finally {
            pdf.destroy();
        }
    }

    const name = doc?.title || chosen.document;
    const source = { ...chosen, index: 1, page, excerpt: passage };
    return {
        text: `C'est dans « ${name} »${page ? `, page ${page}` : ""} [1] :\n\n« ${quote(passage)} »`,
        sources: [source],
        extract: { document: chosen.document, passage, page },
        silent: true,
    };
}

// Plusieurs documents à départager : chacun reçoit une note, puis le meilleur est recommandé.
async function answerByRanking(question, head, mission, mode, signal) {
    const documents = knowledge.documents;
    const total = Math.min(documents.length, MAX_DOCUMENTS);
    const remarks = job.remarks;
    job.wrote = true;
    mission.reveal();

    // Longue tâche : il s'assoit à son bureau. D'abord, sa grille d'évaluation.
    character?.setActivity("laptop");
    bubble.working(STATUS_LINES.grid, head);
    const grid = mission.step("Grille d'évaluation");
    const criteria = parseCriteria(await runtime.adapter.infer(criteriaMessages(question), 60, null, { signal }));
    if (criteria.length === 0) criteria.push(question);
    grid.done(criteria.join(" · "));
    if (signal.aborted) return { text: "", sources: [] };

    // Puis il lit chaque document et le note sur chaque critère (et sur chaque remarque reçue).
    character?.setActivity("read");
    bubble.working(STATUS_LINES.ranking, head);
    const scoring = mission.step("Évaluation des documents", `0 / ${total}`);
    let current = null;
    let count = 0;
    const ranked = await rankDocuments({
        infer: (...args) => runtime.adapter.infer(...args),
        request: question,
        getCriteria: () => [...criteria, ...remarks],
        documents,
        signal,
        onStart: (doc) => { current = mission.step(`Lecture · ${doc.title || doc.name}`); },
        onScore: ({ score, scores }) => {
            const detail = Object.values(scores).map((note) => note ?? "?").join(" · ");
            current.done(score == null ? "note illisible" : `${formatScore(score)}/9 (${detail})`);
            count = Math.min(count + 1, total);
            scoring.update(`${count} / ${total}`);
        },
    });
    // Les remarques suivantes arrivent trop tard pour les notes : elles seront traitées après.
    job.live = false;
    if (signal.aborted || ranked.length === 0) {
        scoring.fail("interrompue");
        return { text: "", sources: [] };
    }
    scoring.done(documents.length > total ? `${total} premiers documents sur ${documents.length}` : `${total} documents notés`);

    // Enfin, il rédige sa recommandation à l'ordinateur.
    const ranking = rankingReport(ranked);
    mission.report(ranking);
    character?.setActivity("laptop");
    bubble.working(STATUS_LINES.deciding, head);
    const writing = mission.step("Rédaction de la recommandation");
    const { messages, sources } = recommendationMessages({ persona: personaPrompt(profile), request: question, criteria, remarks, ranked, format: mode.instructions });
    const text = await runtime.adapter.infer(messages, mode.maxTokens, streamInto(head, mission, writing, { reportPrefix: ranking }), { signal });
    writing.done();
    runtime.pipeline.remember(question, text);
    return { text, sources, reportPrefix: ranking };
}

function excerpt(text, max) {
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

ui.input.addEventListener("input", () => {
    autoResize(ui.input);
    updateSend();
});

ui.input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        ui.form.requestSubmit();
    }
});

ui.form.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = ui.input.value;
    if (abort && !text.trim()) {
        abort.abort();
        return;
    }
    if (!text.trim() || !runtime) return;
    ui.input.value = "";
    autoResize(ui.input);
    updateSend();
    if (abort) remark(text);
    else send(text);
});

// ---------- Chargement du modèle ----------

function createEtaTracker() {
    let start = null;
    return (loaded, total) => {
        start ??= { time: performance.now(), loaded };
        const elapsed = (performance.now() - start.time) / 1000;
        const rate = (loaded - start.loaded) / elapsed;
        if (elapsed < 2 || rate <= 0) return "";
        const remaining = Math.ceil((total - loaded) / rate);
        return remaining < 60 ? ` · encore ~${remaining} s` : ` · encore ~${Math.ceil(remaining / 60)} min`;
    };
}

const tour = createTour();

// La barre de chargement s'ouvre en barre de saisie, puis le personnage arrive au-dessus.
// Sans moteur (erreur), la visite guidée reste : on voit au moins ce que je sais faire.
function reveal(state) {
    const dock = ui.form.parentElement;
    const before = dock.getBoundingClientRect().top;
    if (state === "ready") tour.stop();
    ui.app.dataset.boot = state;
    const shift = before - dock.getBoundingClientRect().top;
    dock.animate([{ transform: `translateY(${shift}px)` }, { transform: "none" }], { duration: 700, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" });
    character?.setPaused(false);
    if (state === "ready") setTimeout(() => character?.gesture("wave"), 1300);
}

async function boot() {
    const firstVisit = isFirstVisit();
    setNote(firstVisit ? "Première visite : je télécharge mon modèle une seule fois (429 Mo)." : "Je me réveille…");
    // Le temps du chargement, on montre ce que je sais faire.
    tour.start();
    const eta = createEtaTracker();

    try {
        const { engine, backend, model } = await loadEngine({
            onProgress: ({ step, fraction, loadedBytes, totalBytes, backend }) => {
                const [start, end] = STEP_WEIGHTS[step];
                const overall = start + (end - start) * (fraction ?? 0);
                const percent = Math.round(overall * 100);
                ui.progress.style.width = `${(overall * 100).toFixed(1)}%`;
                ui.progress.parentElement.setAttribute("aria-valuenow", String(percent));
                bridge.loading(percent);
                if (backend === "cpu" && step === "download") {
                    const size = totalBytes ? ` · ${formatNumber(loadedBytes / 1e6)} / ${formatNumber(totalBytes / 1e6)} Mo${eta(loadedBytes, totalBytes)}` : "";
                    setNote(`Pas de carte graphique : je charge un modèle plus léger pour le processeur${size}`);
                } else if (step === "download" && totalBytes && firstVisit) {
                    setNote(`Téléchargement de mon modèle · ${formatNumber(loadedBytes / 1e6)} / ${formatNumber(totalBytes / 1e6)} Mo${eta(loadedBytes, totalBytes)}`);
                } else if (step !== "download") {
                    setNote(`Je me réveille… ${percent} %`);
                }
            },
        });

        const adapter = new BonsaiAdapter(engine);
        const pipeline = new LogicalRAGPipeline(adapter);
        knowledge.attach(pipeline);
        runtime = { adapter, pipeline };
        applyProfile();

        setNote(backend === "cpu" ? `Sans carte graphique, je tourne sur le processeur (${escapeHTML(model.name)}) : mes réponses sont plus lentes.` : "");
        setMood("idle");
        updateSend();
        reveal("ready");
        bridge.ready();
    } catch (error) {
        console.error("Erreur moteur :", error, { gpu: error.gpuName, étape: error.step, webgpu: error.diagnostic });
        tour.start();
        setMood("sad");
        reveal("error");
        const message = error.deviceLost
            ? "Ma carte graphique n'a pas tenu. Sur un PC portable, activez le GPU haute performance pour votre navigateur (Paramètres Windows → Écran → Graphiques)."
            : error.message;
        bridge.failed(message);
        setNote(`${escapeHTML(message)} <button type="button" class="text-btn" id="btn-retry">Réessayer</button>`, { error: true });
        $("btn-retry").addEventListener("click", () => location.reload());
    }
}

applyProfile();
renderDocuments();
updateSend();
boot();
