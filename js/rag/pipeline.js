import { HeterogeneousGraph, stem } from "./graph.js";
import { splitAnswer } from "../answer_format.js";
import { chunkText } from "./chunking.js";

const TOP_K_MAX = 3;
const HISTORY_WINDOW = 4;

export class LogicalRAGPipeline {
    constructor(modelAdapter) {
        this.graph   = new HeterogeneousGraph();
        this.adapter = modelAdapter;
        this.history = [];
        this.chunkSources = new Map();
        this.persona = "";
        // Mission de l'utilisateur : seule consigne système quand elle existe (voir personaPrompt).
        this.mission = "";
    }

    rewrite(query) {
        const normalized = query
            .trim()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '');

        const cleanQuery = normalized.replace(/\s+/g, ' ');

        let keywords = cleanQuery
            .toLowerCase()
            .split(/[\W_]+/)
            .filter(w => w.length > 1)
            .filter(w => !STOPWORDS.has(w));

        if (keywords.length === 0 && this.history.length > 0) {
            const recentText = this.history
                .slice(-2)
                .map(m => m.content)
                .join(' ')
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '');

            keywords = recentText
                .toLowerCase()
                .split(/[\W_]+/)
                .filter(w => w.length > 1)
                .filter(w => !STOPWORDS.has(w))
                .slice(0, 5);
        }

        return { query: cleanQuery, keywords };
    }

    hybridRetrieve(keywords, k = TOP_K_MAX) {
        return this.graph.query(keywords, Math.min(k, TOP_K_MAX));
    }

    // Départage : un passage qui contient plus de mots différents de la question passe devant
    // (« porte » et « Hadamard » plutôt que « porte » dix fois). À égalité, l'ordre du graphe reste.
    rerank(chunks, query) {
        const qTokens = new Set(this.rewrite(query).keywords.map(stem));
        return chunks
            .map((chunk, order) => ({
                chunk,
                order,
                coverage: new Set(chunk.tokens.map(stem).filter((t) => qTokens.has(t))).size,
            }))
            .sort((a, b) => b.coverage - a.coverage || a.order - b.order)
            .map(item => item.chunk);
    }

    // `instructions` : consignes de forme du mode choisi par l'aiguillage (voir router.js).
    buildPrompt(query, rankedChunks, instructions = "") {
        const messages = [];

        const contextBlock = rankedChunks.length > 0
            ? rankedChunks.map((c, i) => `[${i + 1}] ${c.text}`).join('\n')
            : null;

        const sysContent = contextBlock
            ? `Voici des extraits de documents internes, numérotés :\n\n${contextBlock}\n\nRéponds en français, de façon claire et concise, en t'appuyant sur ces extraits. Cite le numéro de l'extrait utilisé entre crochets, par exemple [1]. Si les extraits ne contiennent pas la réponse, dis-le clairement avant de proposer une réponse générale.`
            : `Réponds en français, de façon claire et concise.`;

        // Une mission remplace toutes les consignes, extraits compris : le modèle ne lit qu'elle.
        const system = this.mission || [this.persona, sysContent, instructions].filter(Boolean).join("\n\n");
        messages.push({ role: "system", content: system });

        for (const turn of this.history.slice(-HISTORY_WINDOW)) {
            messages.push(turn);
        }

        messages.push({ role: "user", content: query });

        return messages;
    }

    // L'historique ne garde que la phrase naturelle : un rapport complet recopié dans le contexte
    // pousse le petit modèle à le répéter aux questions suivantes.
    remember(question, answer) {
        const { chat, report } = splitAnswer(answer);
        this.history.push({ role: "user", content: question });
        this.history.push({ role: "assistant", content: report ? `${chat} (Le détail a été transmis dans un rapport.)` : chat });
    }

    // Passages bruts : plusieurs lectures sont fusionnées avant une seule génération (`ranked`).
    searchChunks(query, k = TOP_K_MAX) {
        return this._retrieve(query, k).ranked;
    }

    // Recherche seule (sans génération), utilisée par l'outil des agents.
    search(query, k = TOP_K_MAX) {
        return this.toSources(this._retrieve(query, k).ranked);
    }

    // options : { maxTokens, signal, retrieve (false pour un simple échange), instructions,
    //            ranked (passages déjà lus, à la place de la recherche) }
    async generate(query, options = {}, onUpdate = null) {
        const retrieved = options.ranked
            ? { cleanQ: this.rewrite(query).query, keywords: [], ranked: options.ranked }
            : options.retrieve === false
            ? { cleanQ: this.rewrite(query).query, keywords: [], ranked: [] }
            : this._retrieve(query, options.k || TOP_K_MAX);
        const { cleanQ, keywords, ranked } = retrieved;
        const messages = this.buildPrompt(cleanQ, ranked, options.instructions);

        const freeAnswer = await this.adapter.infer(messages, options.maxTokens || 512, onUpdate, { signal: options.signal });
        const structured = this._constrainLate(freeAnswer);

        this.remember(cleanQ, freeAnswer);

        return { answer: freeAnswer, structured, chunksUsed: ranked.length, keywords, sources: this.toSources(ranked) };
    }

    _retrieve(query, k) {
        const { query: cleanQ, keywords } = this.rewrite(query);
        const ranked = this.rerank(this.hybridRetrieve(keywords, k), cleanQ);
        return { cleanQ, keywords, ranked };
    }

    // Passages → sources numérotées [1], [2]… avec le nom de leur document.
    toSources(ranked) {
        return ranked.map((chunk, i) => ({
            index: i + 1,
            document: this.chunkSources.get(chunk.id) ?? "Document",
            text: chunk.text,
        }));
    }

    _constrainLate(rawAnswer) {
        return {
            answer:    rawAnswer.trim(),
            timestamp: new Date().toISOString(),
            valid:     rawAnswer.trim().length > 0
        };
    }

    // Passages courts (le contexte du modèle est petit), découpés selon les sections du document.
    ingest(text, entityNames = [], documentName = entityNames[0]) {
        return chunkText(text).map((chunk) => {
            const id = this.graph.addChunk(chunk, entityNames);
            this.chunkSources.set(id, documentName);
            return id;
        });
    }

    // Le graphe ne sait pas retirer un chunk : on le reconstruit à partir des documents restants.
    clearKnowledge() {
        this.graph = new HeterogeneousGraph();
        this.chunkSources.clear();
    }

    resetConversation() {
        this.history = [];
    }

    graphStats() {
        return this.graph.stats();
    }
}

const STOPWORDS = new Set([
    "le","la","de","du","un","au","en","ce","se","sa","me","ma","te","ta","il","ils","on","ne","ca",
    "que","qui","est","les","des","une","dans","sur","par","pour","avec",
    "son","ses","leur","leurs","mais","donc","car","ou","et","si","ni",
    "pas","plus","peu","bien","tout","tous","toute","quel","quelle",
    "the","and","for","are","was","this","that","from","have","not","but",
    "quels","quelles","quand","pourquoi","cest","cela","ceci","quoi","comment","explique","definition"
]);
