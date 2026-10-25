import { $ } from "./ui_utils.js";

const SLIDE_MS = 7000;

/**
 * Visite guidée : quelques cartes qui défilent pendant le premier téléchargement du modèle (ou à la
 * place du personnage si l'appareil ne peut pas le faire tourner). Défilement automatique, mis en
 * pause au survol ou au clavier ; flèches et points pour naviguer.
 */
export function createTour() {
    const root = $("tour");
    const slides = [...root.querySelectorAll(".tour-slide")];
    const dots = [...$("tour-dots").children];
    let index = 0;
    let timer = 0;
    let paused = false;

    function show(next) {
        index = (next + slides.length) % slides.length;
        slides.forEach((slide, i) => {
            slide.classList.toggle("is-active", i === index);
            slide.setAttribute("aria-hidden", String(i !== index));
        });
        dots.forEach((dot, i) => dot.setAttribute("aria-current", String(i === index)));
        schedule();
    }

    function schedule() {
        clearTimeout(timer);
        if (!paused && !root.hidden) timer = setTimeout(() => show(index + 1), SLIDE_MS);
    }

    const pause = (value) => () => {
        paused = value;
        schedule();
    };
    root.addEventListener("pointerenter", pause(true));
    root.addEventListener("pointerleave", pause(false));
    root.addEventListener("focusin", pause(true));
    root.addEventListener("focusout", pause(false));
    $("tour-prev").addEventListener("click", () => show(index - 1));
    $("tour-next").addEventListener("click", () => show(index + 1));
    dots.forEach((dot, i) => dot.addEventListener("click", () => show(i)));

    return {
        start() {
            root.hidden = false;
            show(0);
        },
        stop() {
            clearTimeout(timer);
            root.hidden = true;
        },
    };
}
