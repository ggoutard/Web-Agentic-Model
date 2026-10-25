// Profil de la secrétaire : personnage de l'équipe, apparence (personnage 3D) et mission facultative.
import { CREW, findCrew } from "./crew.js";

const STORAGE_KEY = "secretary-profile";

export const COLORS = [
    { id: "ciel", label: "Ciel", hex: "#7cc6f2" },
    { id: "menthe", label: "Menthe", hex: "#7fd8b4" },
    { id: "lavande", label: "Lavande", hex: "#b4a4f0" },
    { id: "peche", label: "Pêche", hex: "#f6b48f" },
    { id: "citron", label: "Citron", hex: "#f2d872" },
    { id: "rose", label: "Rose", hex: "#f39fbf" },
    { id: "graphite", label: "Graphite", hex: "#8b919c" },
];

export const ACCESSORIES = [
    { id: "lunettes", label: "Lunettes", hint: "Lecture attentive" },
    { id: "casque", label: "Casque", hint: "Toujours à l'écoute" },
    { id: "noeud", label: "Nœud papillon", hint: "Tenue de réception" },
    { id: "antenne", label: "Antenne", hint: "Signal local" },
];

const TONE = "Adopte un ton professionnel, précis et posé.";

export const DEFAULT_PROFILE = {
    crew: CREW[0].id,
    name: "Cubi",
    color: COLORS[0].hex,
    accessories: [],
    mission: "",
};

export const MAX_NAME_LENGTH = 24;
export const MAX_MISSION_LENGTH = 500;

export function loadProfile() {
    try {
        const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
        return sanitize({ ...DEFAULT_PROFILE, ...stored });
    } catch {
        return { ...DEFAULT_PROFILE };
    }
}

export function saveProfile(profile) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitize(profile)));
    } catch {
        console.warn("Stockage local indisponible : la personnalisation ne sera pas conservée.");
    }
}

// Consigne système du modèle. Sans mission : la secrétaire par défaut.
// Avec une mission, elle remplace tout, comme le SYSTEM d'un Modelfile : ni nom, ni ton, ni documents,
// ni format. « Ta mission est de répondre toujours blabla » doit donner « blabla », quoi qu'on demande.
export function personaPrompt(profile) {
    if (profile.mission) return profile.mission;
    const member = findCrew(profile.crew);
    // Un personnage de l'équipe renommé garde son métier sous le nouveau nom.
    if (member.persona) return `${member.persona.replace(`Tu t'appelles ${member.name}.`, `Tu t'appelles ${profile.name}.`)} ${TONE}`;
    return `Tu t'appelles ${profile.name}. Tu es la secrétaire de l'utilisateur. ${TONE}`;
}

function sanitize(profile) {
    return {
        crew: findCrew(profile.crew).id,
        name: String(profile.name ?? "").trim().slice(0, MAX_NAME_LENGTH) || DEFAULT_PROFILE.name,
        color: /^#[0-9a-f]{6}$/i.test(profile.color) ? profile.color : DEFAULT_PROFILE.color,
        accessories: Array.isArray(profile.accessories)
            ? profile.accessories.filter((id) => ACCESSORIES.some((a) => a.id === id))
            : [],
        mission: String(profile.mission ?? "").trim().slice(0, MAX_MISSION_LENGTH),
    };
}
