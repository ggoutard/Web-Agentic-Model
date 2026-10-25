// Racine grossière : pluriels et féminins se rejoignent (« portes » → « porte »).
export function stem(word) {
    return word.length > 4 ? word.replace(/(?:es|s|x|e)$/, "") : word;
}

// Classement BM25 : un mot rare de la question (« Hadamard ») pèse plus qu'un mot présent partout
// (« porte ») ; un passage long ne gagne pas juste parce qu'il répète plus de mots.
const K1 = 1.2;
const B = 0.75;

export class HeterogeneousGraph {
    constructor() {
        this.entities = new Map();
        this.chunks   = new Map();
        this.edges    = [];
        this._chunkId = 0;
    }

    addChunk(text, entityNames = []) {
        const id = `chunk_${this._chunkId++}`;
        const tokens = this._tokenize(text);
        this.chunks.set(id, { id, text, tokens });

        for (const name of entityNames) {
            const key = name.toLowerCase().trim();
            if (!this.entities.has(key)) {
                this.entities.set(key, { id: key, label: name, chunks: [] });
            }
            const entity = this.entities.get(key);
            if (!entity.chunks.includes(id)) {
                entity.chunks.push(id);
            }
            this.edges.push({ from: key, to: id, type: "entity-chunk" });
        }

        for (let i = 0; i < entityNames.length - 1; i++) {
            const a = entityNames[i].toLowerCase().trim();
            const b = entityNames[i + 1].toLowerCase().trim();
            if (a !== b) {
                this.edges.push({ from: a, to: b, type: "entity-entity" });
            }
        }

        return id;
    }

    query(keywords, topK = 7) {
        const kws = keywords.map(k =>
            k.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
        );
        const scores = new Map();
        const stems = kws.map(stem);
        const all = [...this.chunks.values()];
        const averageLength = all.reduce((sum, chunk) => sum + chunk.tokens.length, 0) / Math.max(all.length, 1);
        const matches = (token, kw) => stem(token) === kw || (kw.length >= 5 && token.startsWith(kw));

        for (const kw of stems) {
            const frequencies = all.map((chunk) => chunk.tokens.filter((t) => matches(t, kw)).length);
            const df = frequencies.filter(Boolean).length;
            if (df === 0) continue;
            const idf = Math.log(1 + (all.length - df + 0.5) / (df + 0.5));
            all.forEach((chunk, i) => {
                const tf = frequencies[i];
                if (!tf) return;
                const norm = tf * (K1 + 1) / (tf + K1 * (1 - B + B * chunk.tokens.length / averageLength));
                scores.set(chunk.id, (scores.get(chunk.id) || 0) + idf * norm);
            });
        }

        for (const [eid, entity] of this.entities) {
            const normEid = eid.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            for (const kw of kws) {
                if (normEid.includes(kw) || kw.includes(normEid)) {
                    // Concept du document : un léger bonus, qui ne doit pas écraser le passage précis.
                    for (const cid of entity.chunks) {
                        scores.set(cid, (scores.get(cid) || 0) + 0.5);
                    }
                }
            }
        }

        return [...scores.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, Math.min(topK, 7))
            .map(([id]) => this.chunks.get(id));
    }

    multiHop(startEntityName, depth = 2) {
        const start = startEntityName.toLowerCase().trim();
        const visited = new Set([start]);
        const result  = { entities: [], chunks: [] };
        let frontier  = [start];

        for (let d = 0; d < depth; d++) {
            const next = [];
            for (const node of frontier) {
                for (const edge of this.edges) {
                    if (edge.from === node && edge.type === "entity-entity" && !visited.has(edge.to)) {
                        visited.add(edge.to);
                        next.push(edge.to);
                        result.entities.push(this.entities.get(edge.to));
                    }
                    if (edge.from === node && edge.type === "entity-chunk") {
                        const chunk = this.chunks.get(edge.to);
                        if (chunk && !result.chunks.includes(chunk)) {
                            result.chunks.push(chunk);
                        }
                    }
                }
            }
            frontier = next;
            if (frontier.length === 0) break;
        }

        return result;
    }

    stats() {
        return {
            entities: this.entities.size,
            chunks:   this.chunks.size,
            edges:    this.edges.length
        };
    }

    _tokenize(text) {
        return text
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .split(/[\W_]+/)
            .filter(t => t.length > 1);
    }
}
