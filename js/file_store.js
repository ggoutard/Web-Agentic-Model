// Fichiers d'origine des documents (PDF), gardés dans le navigateur (IndexedDB) pour pouvoir
// rouvrir la bonne page et y surligner un passage. Le texte, lui, reste dans la base de documents.
// Si le navigateur refuse le stockage, tout fonctionne quand même, sans la vue d'origine.

const DB_NAME = "logical-files";
const STORE = "files";

let opening = null;

function open() {
    opening ??= new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = () => request.result.createObjectStore(STORE);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => {
            opening = null;
            reject(request.error);
        };
    });
    return opening;
}

async function run(mode, action) {
    const db = await open();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE, mode);
        const request = action(transaction.objectStore(STORE));
        transaction.oncomplete = () => resolve(request?.result);
        transaction.onerror = () => reject(transaction.error);
    });
}

export async function saveFile(id, blob) {
    try {
        await run("readwrite", (store) => store.put(blob, id));
        return true;
    } catch (error) {
        console.warn("Fichier d'origine non conservé :", error);
        return false;
    }
}

export async function loadFile(id) {
    try {
        return (await run("readonly", (store) => store.get(id))) ?? null;
    } catch {
        return null;
    }
}

export async function deleteFile(id) {
    try {
        await run("readwrite", (store) => store.delete(id));
    } catch {
        // Rien à nettoyer si le stockage est indisponible.
    }
}
