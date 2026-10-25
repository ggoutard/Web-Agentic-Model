import { $, escapeHTML, flip } from "./ui_utils.js";
import { COLORS, ACCESSORIES, MAX_NAME_LENGTH, MAX_MISSION_LENGTH } from "./profile.js";
import { CREW, findCrew } from "./crew.js";

const GEAR_ICONS = {
    lunettes: `<circle cx="7" cy="13" r="3.5"/><circle cx="17" cy="13" r="3.5"/><path d="M10.5 12.5c1-.8 2-.8 3 0"/>`,
    casque: `<path d="M4 15v-3a8 8 0 0 1 16 0v3"/><rect x="3" y="14" width="4" height="6" rx="1.5"/><rect x="17" y="14" width="4" height="6" rx="1.5"/>`,
    noeud: `<path d="M12 12 4 8v8zM12 12l8-4v8z"/><circle cx="12" cy="12" r="1.6"/>`,
    antenne: `<path d="M12 21V9"/><circle cx="12" cy="6" r="2.5"/><path d="M7 3.5a7 7 0 0 0 0 5M17 3.5a7 7 0 0 1 0 5"/>`,
};

/**
 * Atelier de personnalisation : le personnage passe au premier plan, on modifie son nom, son
 * apparence et, si l'on veut, sa mission. Chaque modification est enregistrée aussitôt.
 * Choisir un personnage de l'équipe remplace nom, couleur et accessoires ; il fait son entrée.
 * onScenario(member) charge ses documents fictifs ; onPrompt(text) prépare une demande d'exemple.
 */
export function createStudio({ app, characterEl, character, getProfile, onChange, onClose, onScenario, onPrompt }) {
    const ui = {
        crew: $("studio-crew"),
        crewDetail: $("studio-crew-detail"),
        name: $("studio-name"),
        colors: $("studio-colors"),
        gear: $("studio-accessories"),
        mission: $("studio-mission"),
        missionCount: $("studio-mission-count"),
    };

    let draft = null;
    let previousFocus = null;
    const isOpen = () => app.dataset.studio === "open";

    function render() {
        ui.name.value = draft.name;

        ui.crew.replaceChildren(...CREW.map((member) => {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "crew-card";
            button.style.setProperty("--swatch", member.color);
            button.setAttribute("aria-pressed", String(draft.crew === member.id));
            button.innerHTML = `<span class="crew-dot" aria-hidden="true"></span><span class="crew-name">${escapeHTML(member.name)}</span><span class="crew-role">${escapeHTML(member.role)}</span>`;
            button.addEventListener("click", () => {
                if (draft.crew === member.id) return;
                draft = { ...draft, crew: member.id, name: member.name, color: member.color, accessories: [...member.accessories] };
                character.setColor(member.color);
                character.setAccessories(member.accessories);
                character.gesture(member.entrance);
                render();
            });
            return button;
        }));
        renderCrewDetail();

        ui.colors.replaceChildren(...COLORS.map((color) => {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "swatch";
            button.style.setProperty("--swatch", color.hex);
            button.setAttribute("aria-label", color.label);
            button.setAttribute("aria-pressed", String(draft.color === color.hex));
            button.title = color.label;
            button.addEventListener("click", () => {
                draft.color = color.hex;
                character.setColor(color.hex);
                character.gesture("hop");
                render();
            });
            return button;
        }));

        ui.gear.replaceChildren(...ACCESSORIES.map((item) => {
            const worn = draft.accessories.includes(item.id);
            const button = document.createElement("button");
            button.type = "button";
            button.className = "gear";
            button.setAttribute("aria-pressed", String(worn));
            button.innerHTML = `
                <svg viewBox="0 0 24 24" aria-hidden="true">${GEAR_ICONS[item.id]}</svg>
                <span class="gear-name">${escapeHTML(item.label)}</span>
                <span class="gear-hint">${escapeHTML(item.hint)}</span>`;
            button.addEventListener("click", () => {
                draft.accessories = worn ? draft.accessories.filter((id) => id !== item.id) : [...draft.accessories, item.id];
                character.setAccessories(draft.accessories);
                render();
            });
            return button;
        }));

        renderMissionCount();
        persist();
    }

    function renderCrewDetail() {
        const member = findCrew(draft.crew);
        const scenario = member.scenario;
        ui.crewDetail.innerHTML = `
            <p class="crew-pitch">${escapeHTML(member.pitch)}</p>
            ${member.useCases.length ? `<ul class="crew-uses">${member.useCases.map((use) => `<li>${escapeHTML(use)}</li>`).join("")}</ul>` : ""}
            ${member.agent ? `<p class="crew-tools">Outils : ${member.agent.tools.map((name) => `<code>${escapeHTML(name)}</code>`).join(" ")}</p>` : ""}
            ${scenario ? `
                <div class="crew-scenario">
                    <p><b>Scénario fictif — ${escapeHTML(scenario.label)}.</b> ${escapeHTML(scenario.story)}</p>
                    <button type="button" class="text-btn" data-scenario>Charger le scénario (${scenario.documents.length + (scenario.withSample ? 1 : 0)} documents)</button>
                    <div class="crew-prompts">${scenario.prompts.map((text, i) => `<button type="button" class="crew-prompt" data-prompt="${i}">${escapeHTML(text)}</button>`).join("")}</div>
                </div>` : ""}`;
        ui.crewDetail.querySelector("[data-scenario]")?.addEventListener("click", (event) => {
            onScenario(member);
            event.currentTarget.textContent = "Scénario chargé";
            event.currentTarget.disabled = true;
        });
        for (const button of ui.crewDetail.querySelectorAll("[data-prompt]")) {
            button.addEventListener("click", () => {
                onScenario(member);
                close();
                onPrompt(scenario.prompts[Number(button.dataset.prompt)]);
            });
        }
    }

    function renderMissionCount() {
        ui.missionCount.textContent = `${ui.mission.value.length} / ${MAX_MISSION_LENGTH}`;
    }

    // Enregistrement automatique ; un nom vide garde le précédent.
    function persist() {
        onChange({
            ...structuredClone(draft),
            name: ui.name.value.trim().slice(0, MAX_NAME_LENGTH) || getProfile().name,
            mission: ui.mission.value.trim().slice(0, MAX_MISSION_LENGTH),
        });
    }

    // `section` : "crew" fait défiler jusqu'au choix du personnage.
    function open(section) {
        if (isOpen()) return;
        draft = structuredClone(getProfile());
        previousFocus = document.activeElement;
        ui.mission.value = draft.mission;
        render();
        flip(characterEl, () => { app.dataset.studio = "open"; });
        character.setInteractive(true);
        character.setMood("idle");
        setTimeout(() => (section === "crew" ? ui.crew.querySelector("[aria-pressed=true]") : ui.name)?.focus({ preventScroll: true }), 450);
        if (section === "crew") ui.crew.scrollIntoView({ block: "start" });
    }

    function close() {
        if (!isOpen()) return;
        character.setInteractive(false);
        flip(characterEl, () => { delete app.dataset.studio; });
        onClose();
        previousFocus?.focus?.({ preventScroll: true });
    }

    ui.name.maxLength = MAX_NAME_LENGTH;
    ui.name.addEventListener("input", () => {
        draft.name = ui.name.value.trim();
        persist();
    });
    ui.mission.maxLength = MAX_MISSION_LENGTH;
    ui.mission.addEventListener("input", () => {
        draft.mission = ui.mission.value;
        renderMissionCount();
        persist();
    });
    ui.name.addEventListener("keydown", (event) => {
        if (event.key === "Enter") close();
    });
    $("studio-close").addEventListener("click", close);
    $("studio-backdrop").addEventListener("click", close);
    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && isOpen()) close();
    });

    // Le personnage s'ouvre au clic ou au clavier ; dans l'atelier, le clic sert à le faire tourner.
    characterEl.addEventListener("click", () => { if (!isOpen()) open(); });
    characterEl.addEventListener("keydown", (event) => {
        if (!isOpen() && (event.key === "Enter" || event.key === " ")) {
            event.preventDefault();
            open();
        }
    });

    return { open, isOpen };
}
