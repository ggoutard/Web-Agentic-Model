// Outils mis à disposition des agents. Tout s'exécute dans le navigateur.
// Chaque outil : schéma JSON (envoyé au modèle) + fonction `run(args, context)` qui renvoie du texte.

const DATE_FORMAT = { weekday: "long", day: "numeric", month: "long", year: "numeric" };
const formatDate = (date) => date.toLocaleDateString("fr-FR", DATE_FORMAT);
// Le contexte du petit modèle est court : un document lu en entier est tronqué.
const MAX_READ_CHARS = 2400;

export const TOOLS = {
    rechercher_documents: {
        label: "Recherche documentaire",
        summary: "Cherche les passages pertinents dans la base de connaissances.",
        parameters: {
            type: "object",
            properties: {
                requete: { type: "string", description: "Mots-clés ou question à rechercher" },
            },
            required: ["requete"],
        },
        run({ requete }, { pipeline }) {
            const results = pipeline.search(requete);
            if (results.length === 0) return "Aucun passage trouvé dans la base de connaissances.";
            return results.map((r) => `[${r.index}] (${r.document}) ${r.text}`).join("\n\n");
        },
    },

    lister_documents: {
        label: "Liste des documents",
        summary: "Donne le nom et le résumé de chaque document de la base.",
        parameters: { type: "object", properties: {} },
        run(_, { knowledge }) {
            if (knowledge.documents.length === 0) return "La base ne contient aucun document.";
            return knowledge.documents.map((doc) => `- ${doc.name}${doc.summary ? ` : ${doc.summary}` : ""}`).join("\n");
        },
    },

    lire_document: {
        label: "Lecture d'un document",
        summary: "Renvoie le texte d'un document à partir de son nom (ou d'une partie de son nom).",
        parameters: {
            type: "object",
            properties: {
                nom: { type: "string", description: "Nom du document, tel que donné par lister_documents" },
            },
            required: ["nom"],
        },
        run({ nom }, { knowledge }) {
            const doc = findDocument(knowledge.documents, String(nom ?? ""));
            if (!doc) throw new Error(`aucun document ne correspond à « ${nom} » ; appelle lister_documents`);
            const text = doc.text.length > MAX_READ_CHARS ? `${doc.text.slice(0, MAX_READ_CHARS)}\n[…suite tronquée]` : doc.text;
            return `${doc.name}\n\n${text}`;
        },
    },

    calculer: {
        label: "Calculatrice",
        summary: "Évalue une expression arithmétique (+, -, *, /, %, parenthèses).",
        parameters: {
            type: "object",
            properties: {
                expression: { type: "string", description: "Expression à calculer, par exemple (35 * 4) - 168" },
            },
            required: ["expression"],
        },
        run({ expression }) {
            const value = evaluateExpression(String(expression));
            return `${expression} = ${Number(value.toFixed(6)).toLocaleString("fr-FR")}`;
        },
    },

    date_actuelle: {
        label: "Date du jour",
        summary: "Donne la date d'aujourd'hui.",
        parameters: { type: "object", properties: {} },
        run() {
            const today = new Date();
            return `Nous sommes le ${formatDate(today)} (${toISODate(today)}).`;
        },
    },

    decaler_date: {
        label: "Calcul d'échéance",
        summary: "Ajoute un nombre de jours (calendaires ou ouvrés) à une date.",
        parameters: {
            type: "object",
            properties: {
                jours: { type: "integer", description: "Nombre de jours à ajouter (négatif pour reculer)" },
                jours_ouvres: { type: "boolean", description: "true pour ne compter que du lundi au vendredi" },
                date: { type: "string", description: "Date de départ au format AAAA-MM-JJ ; aujourd'hui si absente" },
            },
            required: ["jours"],
        },
        run({ jours, jours_ouvres = false, date }) {
            const start = date ? new Date(`${date}T12:00:00`) : new Date();
            if (Number.isNaN(start.getTime())) throw new Error(`date invalide : ${date}`);
            const result = jours_ouvres ? addBusinessDays(start, jours) : addDays(start, jours);
            const unit = jours_ouvres ? "jours ouvrés" : "jours";
            return `${formatDate(start)} + ${jours} ${unit} = ${formatDate(result)} (${toISODate(result)}).`;
        },
    },

    creer_note: {
        label: "Livrable",
        summary: "Enregistre une note de synthèse dans les livrables.",
        parameters: {
            type: "object",
            properties: {
                titre: { type: "string", description: "Titre court de la note" },
                contenu: { type: "string", description: "Contenu de la note" },
            },
            required: ["titre", "contenu"],
        },
        run({ titre, contenu }, { addDeliverable }) {
            addDeliverable({ title: titre, content: contenu });
            return `Note « ${titre} » enregistrée dans les livrables.`;
        },
    },
};

export function toolSchemas(toolNames) {
    return toolNames
        .filter((name) => TOOLS[name])
        .map((name) => ({
            type: "function",
            function: { name, description: TOOLS[name].summary, parameters: TOOLS[name].parameters },
        }));
}

// Nom exact, puis nom contenu, puis le plus de mots en commun (« CV de Karim » → « CV — Karim Benali »).
export function findDocument(documents, query) {
    const fold = (text) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    const wanted = fold(query).trim();
    if (!wanted) return null;
    const names = documents.map((doc) => fold(`${doc.name} ${doc.title ?? ""}`));
    const exact = documents.find((doc) => fold(doc.name) === wanted);
    if (exact) return exact;
    const contained = documents.find((_, i) => names[i].includes(wanted));
    if (contained) return contained;
    const words = wanted.split(/[^a-z0-9]+/).filter((w) => w.length > 2);
    let best = null;
    let bestScore = 0;
    documents.forEach((doc, i) => {
        const score = words.filter((w) => names[i].includes(w)).length;
        if (score > bestScore) { best = doc; bestScore = score; }
    });
    return best;
}

// ---------- Dates ----------

function toISODate(date) {
    const pad = (n) => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function addDays(date, days) {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
}

function addBusinessDays(date, days) {
    const result = new Date(date);
    const direction = Math.sign(days);
    let remaining = Math.abs(days);
    while (remaining > 0) {
        result.setDate(result.getDate() + direction);
        const day = result.getDay();
        if (day !== 0 && day !== 6) remaining -= 1;
    }
    return result;
}

// ---------- Calculatrice (analyseur récursif, sans eval) ----------

export function evaluateExpression(input) {
    const src = input.replace(/(\d),(\d)/g, "$1.$2").replace(/[×x]/g, "*").replace(/÷/g, "/").replace(/\s+/g, "");
    let pos = 0;

    const fail = (message) => { throw new Error(`expression invalide (${message}) : ${input}`); };

    function parseSum() {
        let value = parseProduct();
        while (src[pos] === "+" || src[pos] === "-") {
            const op = src[pos++];
            const right = parseProduct();
            value = op === "+" ? value + right : value - right;
        }
        return value;
    }

    function parseProduct() {
        let value = parseUnary();
        while (src[pos] === "*" || src[pos] === "/" || src[pos] === "%") {
            const op = src[pos++];
            const right = parseUnary();
            if (op !== "*" && right === 0) fail("division par zéro");
            value = op === "*" ? value * right : op === "/" ? value / right : value % right;
        }
        return value;
    }

    function parseUnary() {
        if (src[pos] === "-") { pos++; return -parseUnary(); }
        if (src[pos] === "+") { pos++; return parseUnary(); }
        return parsePrimary();
    }

    function parsePrimary() {
        if (src[pos] === "(") {
            pos++;
            const value = parseSum();
            if (src[pos] !== ")") fail("parenthèse manquante");
            pos++;
            return value;
        }
        const match = /^\d+(\.\d+)?/.exec(src.slice(pos));
        if (!match) fail(`caractère inattendu « ${src[pos] ?? "fin"} »`);
        pos += match[0].length;
        return Number(match[0]);
    }

    const value = parseSum();
    if (pos !== src.length) fail(`caractère inattendu « ${src[pos]} »`);
    return value;
}
