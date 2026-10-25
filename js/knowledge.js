import { SAMPLE_DOCUMENT } from "./sample_document.js";
import { deleteFile } from "./file_store.js";

const STORAGE_KEY = "knowledge-documents";

// Documents de l'utilisateur : conservés dans le navigateur et indexés dans le pipeline RAG.
export class KnowledgeBase {
    constructor() {
        this.documents = load();
        this.pipeline = null;
        this.listeners = new Set();
    }

    attach(pipeline) {
        this.pipeline = pipeline;
        this.reindex();
    }

    onChange(listener) {
        this.listeners.add(listener);
    }

    // sheet : fiche produite par l'agent lecteur { title, summary, points, concepts }.
    add(name, text, sheet = {}) {
        const doc = { id: crypto.randomUUID(), name, text, addedAt: Date.now(), ...sheet };
        this.documents.push(doc);
        if (this.pipeline) ingest(this.pipeline, doc);
        this.commit();
        return doc;
    }

    remove(id) {
        this.documents = this.documents.filter((doc) => doc.id !== id);
        deleteFile(id);
        this.reindex();
        this.commit();
    }

    addSample() {
        if (!this.hasSample()) this.add(SAMPLE_DOCUMENT.name, SAMPLE_DOCUMENT.text, SAMPLE_DOCUMENT.sheet);
    }

    hasSample() {
        return this.documents.some((doc) => doc.name === SAMPLE_DOCUMENT.name);
    }

    // Les citations désignent un document par son nom.
    findByName(name) {
        return this.documents.find((doc) => doc.name === name || doc.title === name) ?? null;
    }

    get isEmpty() {
        return this.documents.length === 0;
    }

    // Le graphe ne sait pas retirer un passage : on réindexe tout.
    reindex() {
        if (!this.pipeline) return;
        this.pipeline.clearKnowledge();
        for (const doc of this.documents) ingest(this.pipeline, doc);
    }

    commit() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(this.documents));
        } catch {
            console.warn("Stockage local indisponible ou plein : les documents ne seront pas conservés.");
        }
        for (const listener of this.listeners) listener();
    }
}

// Les concepts de la fiche deviennent des entités du graphe, rattachées à tous les passages du
// document : une question qui emploie un synonyme retrouve quand même le document. La fiche
// elle-même (résumé, points clés) est indexée comme un passage à part.
function ingest(pipeline, doc) {
    const entities = [doc.name, ...(doc.concepts ?? [])];
    pipeline.ingest(doc.text, entities, doc.name);
    const sheet = [doc.title, doc.summary, ...(doc.points ?? [])].filter(Boolean).join(". ");
    if (doc.summary || doc.points?.length) pipeline.ingest(sheet, entities, doc.name);
}

function load() {
    try {
        const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
        return Array.isArray(stored) ? stored : [];
    } catch {
        return [];
    }
}
