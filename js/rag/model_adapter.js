export class BonsaiAdapter {
    constructor(model) {
        this.model = model;
        // Le moteur n'accepte qu'une session à la fois ; elle réutilise le préfixe commun entre deux appels.
        this.session = model ? model.create_session() : null;
        this.ready = !!model;
        this.lastStats = null;
        this._turn = Promise.resolve();
    }

    // Exécute `task` quand la session est libre : le chat et le classement des documents
    // passent chacun leur tour au lieu de se disputer l'unique session.
    exclusive(task) {
        const run = this._turn.then(() => task());
        this._turn = run.catch(() => {});
        return run;
    }

    // Une génération interrompue via `signal` renvoie le texte produit jusque-là.
    // think : le modèle réfléchit d'abord (Qwen3.5) ; sa réflexion arrive au fil de l'eau dans onThought.
    async infer(messages, maxTokens = 512, onUpdate = null, { signal, think = false, onThought = null } = {}) {
        if (!this.session) {
            throw new Error("Moteur Bonsai non initialisé.");
        }

        const turn = this.session.generate(messages, { max_new_tokens: maxTokens, enable_thinking: think, signal });
        let fullReply = "";
        let thought = "";
        try {
            for await (const event of turn) {
                if (event.type === "reasoning") {
                    thought += event.text;
                    if (onThought) onThought(thought);
                    continue;
                }
                if (event.type !== "text") continue;
                fullReply += event.text;
                if (onUpdate) onUpdate(fullReply);
            }
            const result = await turn.result;
            this.lastStats = {
                tokensPerSecond: result.timings?.tokens_per_second ?? null,
                ttftMs: result.timings?.ttft_ms ?? null,
            };
        } catch (error) {
            if (!signal?.aborted) throw error;
        }
        return fullReply.trim();
    }
}

export class MockAdapter {
    async infer(messages) {
        const lastUser = messages.filter(m => m.role === "user").pop();
        const context  = lastUser?.content || "";

        if (context.includes("Je ne sais pas") || !context.trim()) {
            return "Je ne sais pas.";
        }
        return `Réponse basée sur le contexte fourni : "${context.slice(0, 60)}..."`;
    }
}
