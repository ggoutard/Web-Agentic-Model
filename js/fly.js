// Petites feuilles et lettres qui volent d'un point de l'écran à un autre, suivies des yeux
// par le personnage.

const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

export function center(element) {
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

// Point où le personnage tient un objet (ses mains).
export function handsPoint(characterEl) {
    const rect = characterEl.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height * 0.62 };
}

// Vol en arc ; `className` : "flying-doc" (feuille) ou "flying-letter" (enveloppe).
export async function fly({ from, to, character = null, className = "flying-doc", shrink = true }) {
    if (!from || !to || reducedMotion()) return;
    const item = document.createElement("div");
    item.className = className;
    document.body.append(item);
    const lift = Math.min(from.y, to.y) - 90;
    const at = (x, y, scale, rotate) => `translate(${x}px, ${y}px) translate(-50%, -50%) scale(${scale}) rotate(${rotate}deg)`;
    const animation = item.animate([
        { transform: at(from.x, from.y, 1, -10), opacity: 1 },
        { transform: at((from.x + to.x) / 2, lift, 0.9, 6), offset: 0.5 },
        { transform: at(to.x, to.y, shrink ? 0.3 : 1, 0), opacity: 0.2 },
    ], { duration: 650, easing: "cubic-bezier(0.45, 0, 0.25, 1)" });

    let tracking = requestAnimationFrame(function follow() {
        const box = item.getBoundingClientRect();
        character?.lookAt({ x: box.left + box.width / 2, y: box.top + box.height / 2 });
        tracking = requestAnimationFrame(follow);
    });
    await animation.finished.catch(() => {});
    cancelAnimationFrame(tracking);
    character?.lookAt(null);
    item.remove();
}

export function bump(element) {
    element.animate([{ transform: "scale(1)" }, { transform: "scale(1.3)" }, { transform: "scale(1)" }], { duration: 320, easing: "ease-out" });
}
