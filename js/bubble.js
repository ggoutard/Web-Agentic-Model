import { escapeHTML } from "./ui_utils.js";

// Bulle de parole du personnage : ses réactions, ses réponses courtes, et ce qu'il est en train de faire.

const ROTATE_MS = 2200;
const TYPING = `<span class="typing"><i></i><i></i><i></i></span>`;

export function createBubble(element) {
    let timer = 0;
    let rotation = 0;

    function show(html) {
        clearTimeout(timer);
        clearInterval(rotation);
        element.innerHTML = html;
        element.hidden = false;
        element.classList.remove("is-leaving");
    }

    return {
        // `html` doit déjà être échappé.
        show,
        typing(prefix = "") {
            show(`${prefix}${TYPING}`);
        },
        // Phrase de travail (« Je cherche… ») qui change toutes les deux secondes tant que l'étape dure.
        // `prefix` : contenu déjà affiché au-dessus (question, début de réponse).
        working(lines, prefix = "") {
            let index = Math.floor(Math.random() * lines.length);
            const render = () => {
                element.innerHTML = `${prefix}<p class="bubble-status">${escapeHTML(lines[index % lines.length])}${TYPING}</p>`;
            };
            show("");
            render();
            if (lines.length > 1) {
                rotation = setInterval(() => {
                    index += 1;
                    render();
                }, ROTATE_MS);
            }
        },
        hide(delay = 0) {
            clearTimeout(timer);
            clearInterval(rotation);
            timer = setTimeout(() => {
                element.classList.add("is-leaving");
                timer = setTimeout(() => { element.hidden = true; }, 250);
            }, delay);
        },
    };
}
