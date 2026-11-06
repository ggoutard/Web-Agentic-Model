// Garde-fou mémoire : sur téléphone, le modèle (429 Mo, ou 533 Mo sur le processeur) dépasse souvent
// la mémoire qu'un navigateur mobile accorde à un onglet. Safari tue alors l'onglet et recharge la
// page, qui relance le chargement : la page plante en boucle. On ne charge donc pas automatiquement
// sur mobile, ni après un chargement qui n'a pas abouti (signe que l'onglet a planté).

export const LOADING_KEY = "cubi-loading-since";
// Au-delà, un chargement inachevé est considéré comme abandonné (onglet fermé), pas comme un plantage.
const CRASH_WINDOW_MS = 15 * 60 * 1000;

export function isMobileDevice({ userAgent = "", platform = "", maxTouchPoints = 0 } = {}) {
    if (/iPhone|iPad|iPod|Android/i.test(userAgent)) return true;
    // iPad récent : il se présente comme un Mac, mais tactile.
    return platform === "MacIntel" && maxTouchPoints > 1;
}

/**
 * Faut-il lancer le chargement du modèle tout seul ?
 * Renvoie { auto: true } ou { auto: false, reason: "crash" | "mobile" }.
 */
export function autoLoadDecision({ device, lastAttempt, now = Date.now() }) {
    const started = Number(lastAttempt);
    if (Number.isFinite(started) && started > 0 && now - started < CRASH_WINDOW_MS) return { auto: false, reason: "crash" };
    if (isMobileDevice(device)) return { auto: false, reason: "mobile" };
    return { auto: true };
}

const storage = {
    get() { try { return localStorage.getItem(LOADING_KEY); } catch { return null; } },
    set() { try { localStorage.setItem(LOADING_KEY, String(Date.now())); } catch { /* stockage indisponible */ } },
    clear() { try { localStorage.removeItem(LOADING_KEY); } catch { /* stockage indisponible */ } },
};

export const loadingMarker = storage;
