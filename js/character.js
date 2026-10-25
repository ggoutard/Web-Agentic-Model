import * as THREE from "./vendor/three.module.min.js";
import { RoundedBoxGeometry } from "./vendor/RoundedBoxGeometry.js";

// Personnage 3D de la secrétaire : un cube aux arêtes douces.
// Rendu léger (WebGL, en pause hors écran) : 60 i/s, 30 i/s pendant que le modèle de langage
// travaille, pour lui laisser la carte graphique.

const FPS = 60;
const BUSY_FPS = 30;
// Nombre maximal de pixels du canevas (l'atelier l'affiche en grand) : au-delà, la résolution baisse.
const PIXEL_BUDGET = 1_600_000;
const MOODS = ["sleep", "idle", "think", "talk", "sad"];
const BODY = { width: 1.7, height: 1.55, depth: 1.45 };
const FACE_Z = BODY.depth / 2;
const TOP_Y = BODY.height / 2;
// Document : "await" (bras tendus pour l'attraper), "hold", "read", "toss" (lancé vers le classeur).
const DOC_MODES = ["none", "await", "hold", "read", "toss"];
const DOC_POSES = {
    none: { y: -0.55, z: FACE_Z + 0.3, tilt: -0.2, scale: 0.001 },
    await: { y: -0.55, z: FACE_Z + 0.3, tilt: -0.2, scale: 0.001 },
    hold: { y: -0.55, z: FACE_Z + 0.32, tilt: -0.2, scale: 1 },
    // Pour lire, il retourne la feuille vers lui : on en voit le dos.
    read: { y: -0.4, z: FACE_Z + 0.42, tilt: 0.55, turn: Math.PI, scale: 1 },
    toss: { y: -1.5, z: FACE_Z + 0.9, tilt: 0.4, scale: 0.001, x: -1.9 },
};
// Pause : sans souris ni clavier pendant `after` secondes, il s'assoit et s'occupe ; il change
// d'occupation toutes les `length` secondes et se lève d'un bond dès qu'on revient.
const BREAK = { after: 25, length: 35 };
const BREAK_ACTIVITIES = ["coffee", "laptop", "read"];
// Postures de travail : celles des pauses, plus "screen" (il lit sur son ordinateur, sans taper).
const WORK_ACTIVITIES = [...BREAK_ACTIVITIES, "screen"];
// Hauteur dont il s'enfonce une fois assis.
const SIT_DROP = 0.14;
// Durée (s) de chaque entrée en scène, voir gesture().
const ENTRANCES = { drop: 0.9, spin: 1, pop: 0.8 };
// Déplacement des yeux sur la face quand il regarde quelque chose (au-delà, ils glisseraient sur
// l'arrondi du cube) ; la bouche et les joues suivent à moitié, pour que tout le visage regarde.
const GAZE = { x: 0.12, y: 0.08, face: 0.5 };

export function createCharacter(container, { color = "#7cc6f2", accessories = [] } = {}) {
    // Sur un écran haute densité, la résolution suffit à lisser les bords : pas d'antialiasing.
    const renderer = new THREE.WebGLRenderer({ antialias: window.devicePixelRatio < 2, alpha: true, powerPreference: "low-power" });
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = 1.1;
    container.append(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 50);
    camera.position.set(0, 0.35, 6.8);
    camera.lookAt(0, -0.05, 0);

    scene.add(new THREE.HemisphereLight(0xffffff, 0x3a3f55, 1.4));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(2, 3, 4);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x9fd3ff, 2.4);
    rim.position.set(-3, 2, -3);
    scene.add(rim);

    const parts = buildBody(color);
    scene.add(parts.rig, parts.floor);
    const gear = buildAccessories();
    for (const group of Object.values(gear)) parts.rig.add(group);
    const sheet = buildDocument();
    parts.rig.add(sheet);
    const props = buildProps();
    scene.add(props.chair);
    parts.rig.add(props.mug, props.laptop);
    precompile(renderer, scene, camera);

    // ---------- État ----------

    let mood = "sleep";
    let interactive = false;
    const pointer = { x: 0, y: 0, clientX: 0, clientY: 0, seen: false };
    const look = { x: 0, y: 0 };
    const gaze = { x: 0, y: 0 };
    let gazeTarget = null;
    const spin = { value: 0, velocity: 0, dragging: false, lastX: 0 };
    const targetColor = new THREE.Color(color);
    const wornTargets = new Map(Object.keys(gear).map((id) => [id, accessories.includes(id) ? 1 : 0]));
    for (const [id, target] of wornTargets) gear[id].scale.setScalar(target || 0.001);
    let nextBlink = 2;
    let blinkUntil = 0;
    // Parole : syllabes alternant bouche ronde ouverte et bouche fermée.
    const speech = { open: 0, target: 0, next: 0 };
    const gesture = { name: null, start: 0 };
    let docMode = "none";
    let tossTimer = 0;
    // Pause en cours : activité, part assise (0 à 1), gorgée de café, page tournée.
    const rest = { activity: null, since: 0, lastActive: 0, sit: 0, sipStart: -10, nextSip: 0, nextPage: 0 };
    // Travail demandé par l'application (longue tâche) : mêmes postures, mais il ne se lève pas
    // quand on bouge la souris.
    let work = null;
    // Mode autonome (après le premier message) : il vit sa vie et ne suit la souris que pendant
    // un court moment d'attention, quand on lui écrit ; la souris et le clavier ne le dérangent plus.
    let autonomous = false;
    let attentionUntil = 0;

    // Position du personnage, relue au plus deux fois par seconde (pas à chaque mouvement de souris).
    let rect = container.getBoundingClientRect();
    let rectAge = 0;
    // L'utilisateur est là : fin de la pause, il se lève d'un bond.
    const noticeUser = () => {
        if (autonomous) return;
        rest.lastActive = clock.elapsedTime;
        if (!rest.activity) return;
        rest.activity = null;
        gesture.name = "hop";
        gesture.start = clock.elapsedTime;
    };
    const onPointerMove = (event) => {
        noticeUser();
        pointer.x = THREE.MathUtils.clamp((event.clientX - (rect.left + rect.width / 2)) / window.innerWidth * 2, -1, 1);
        pointer.y = THREE.MathUtils.clamp((event.clientY - (rect.top + rect.height / 2)) / window.innerHeight * 2, -1, 1);
        pointer.clientX = event.clientX;
        pointer.clientY = event.clientY;
        pointer.seen = true;
        if (spin.dragging) {
            const dx = event.clientX - spin.lastX;
            spin.lastX = event.clientX;
            spin.value += dx * 0.012;
            spin.velocity = dx * 0.012;
        }
    };
    const onPointerDown = (event) => {
        if (!interactive) return;
        spin.dragging = true;
        spin.lastX = event.clientX;
        renderer.domElement.setPointerCapture(event.pointerId);
    };
    const onPointerUp = () => { spin.dragging = false; };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("keydown", noticeUser);
    window.addEventListener("pointerdown", noticeUser);
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointerup", onPointerUp);
    renderer.domElement.addEventListener("pointercancel", onPointerUp);

    // ---------- Animation ----------

    const clock = new THREE.Clock();
    let sinceFrame = 0;
    let dt = 1 / FPS;
    // Lissage indépendant de la fréquence d'affichage : `k` est la part parcourue en 1/30 s.
    const damp = (k) => 1 - Math.pow(1 - k, dt * 30);
    let visible = true;
    let frameId = 0;
    let paused = false;

    // Direction d'un point de l'écran par rapport au personnage, de -1 à 1 sur chaque axe.
    const towards = (x, y) => ({
        x: THREE.MathUtils.clamp((x - (rect.left + rect.width / 2)) / (rect.width * 0.6), -1, 1),
        y: THREE.MathUtils.clamp((y - (rect.top + rect.height / 2)) / (rect.height * 0.6), -1, 1),
    });

    function animate(t) {
        const awake = mood !== "sleep";
        // Pendant la lecture, il reste immobile : seuls ses yeux bougent, vers la feuille.
        const reading = docMode === "read";
        const { rig, eyes, mouth, mouthOpen, cheeks, arms, legs, floor, bodyMaterial } = parts;

        // Pause : seulement au repos, sans document ni geste en cours.
        const free = mood === "idle" && docMode === "none" && !interactive && !gazeTarget && !gesture.name;
        if (!free) rest.activity = null;
        else if (restless(t) && (!rest.activity || t - rest.since > BREAK.length)) startBreak(t);
        const activity = work ?? rest.activity;
        rest.sit += ((activity ? 1 : 0) - rest.sit) * damp(0.08);
        const sit = rest.sit;
        const sipping = activity === "coffee" ? sipAmount(t) : 0;

        // Rotation libre (glisser) avec inertie ; retour face caméra hors de l'atelier.
        if (!spin.dragging) {
            if (interactive) {
                spin.value += spin.velocity * dt * 30;
                spin.velocity *= Math.pow(0.92, dt * 30);
            } else {
                spin.value += (nearestTurn(spin.value) - spin.value) * damp(0.08);
                spin.velocity = 0;
            }
        }

        // Respiration / sautillement, plus un saut éventuel.
        const bobSpeed = mood === "think" ? 5 : mood === "talk" ? 7 : mood === "sleep" ? 1.2 : 2.2;
        const bobAmp = reading ? 0 : mood === "sleep" ? 0.02 : mood === "sad" ? 0.015 : 0.05 - sit * 0.035;
        let hop = 0;
        if (gesture.name === "hop") {
            const p = (t - gesture.start) / 0.55;
            if (p < 1) hop = Math.sin(p * Math.PI) * 0.4;
            else gesture.name = null;
        }
        // Entrées en scène d'un nouveau personnage : il tombe du ciel, tourne sur lui-même ou surgit.
        let fall = 0;
        let twirl = 0;
        let grow = 1;
        if (ENTRANCES[gesture.name]) {
            const p = (t - gesture.start) / ENTRANCES[gesture.name];
            if (p >= 1) gesture.name = null;
            else if (gesture.name === "drop") fall = p < 0.6 ? (1 - p / 0.6) ** 2 * 3 : Math.sin((p - 0.6) / 0.4 * Math.PI) * 0.18;
            else if (gesture.name === "spin") { twirl = (1 - (1 - p) ** 3) * Math.PI * 2; hop = Math.sin(p * Math.PI) * 0.25; }
            else grow = 1 - Math.cos(p * Math.PI * 3) * (1 - p) ** 2;
        }
        const settling = reading || (sit > 0.01 && sit < 0.99);
        rig.position.y += (Math.sin(t * bobSpeed) * bobAmp + hop + fall - sit * SIT_DROP - rig.position.y) * (settling ? damp(0.2) : 1);
        rig.scale.setScalar(grow);
        rig.scale.y = grow * (1 + (mood === "sleep" ? Math.sin(t * 1.2) * 0.015 : 0));

        // Tête : suit la souris quand il est éveillé (sauf dans l'atelier, où l'on fait tourner).
        const attentive = !autonomous || t < attentionUntil;
        const follow = awake && !interactive && !reading && !gazeTarget && !activity && attentive;
        // Penché sur son écran ou sa feuille ; la tête un peu en arrière pour boire.
        const atComputer = activity === "laptop" || activity === "screen";
        const lean = atComputer || activity === "read" ? 0.12 : activity === "coffee" ? -0.08 * sipping : 0;
        look.x += ((follow ? pointer.x * 0.45 : 0) - look.x) * damp(0.08);
        look.y += ((follow ? pointer.y * 0.18 : activity ? lean : awake ? 0 : 0.08) - look.y) * damp(0.08);
        const wobble = mood === "think" && !reading && !activity ? Math.sin(t * 1.6) * 0.18 : 0;
        rig.rotation.y = look.x + spin.value + wobble + twirl;
        rig.rotation.x = look.y;
        rig.rotation.z = reading ? 0 : mood === "sleep" ? 0.08 : mood === "sad" ? -0.05 : Math.sin(t * 1.1) * 0.02;

        // Yeux : vers la feuille qu'il lit, le document qu'on glisse / qui vole, sinon la souris.
        let target = { x: 0, y: 0 };
        if (reading || activity === "read") target = { x: 0, y: 1 };
        else if (activity === "laptop") target = { x: Math.sin(t * 0.9) * 0.35, y: 0.75 };
        // Lecture à l'écran : les yeux balaient chaque ligne de gauche à droite, puis descendent.
        else if (activity === "screen") {
            const line = (t * 0.7) % 1;
            target = { x: -0.5 + line * 1.0, y: 0.55 + Math.floor((t * 0.7) % 6) * 0.07 };
        }
        else if (activity === "coffee") target = { x: Math.sin(t * 0.25) * 0.6, y: -0.15 };
        else if (gazeTarget) target = towards(gazeTarget.x, gazeTarget.y);
        else if (awake && !interactive && pointer.seen && attentive) target = towards(pointer.clientX, pointer.clientY);
        gaze.x += (target.x - gaze.x) * damp(0.4);
        gaze.y += (target.y - gaze.y) * damp(0.4);
        const moodOffset = mood === "think" && !reading ? 0.05 : mood === "sad" ? -0.04 : 0;
        eyes.position.x = gaze.x * GAZE.x;
        for (const cheek of cheeks) {
            cheek.position.x = cheek.userData.x + gaze.x * GAZE.x * GAZE.face;
            cheek.position.y = cheek.userData.y - gaze.y * GAZE.y * GAZE.face;
        }
        eyes.position.y += (moodOffset - gaze.y * GAZE.y - eyes.position.y) * damp(0.3);
        if (awake && t > nextBlink) {
            blinkUntil = t + 0.12;
            nextBlink = t + 2.5 + Math.random() * 3;
        }
        // Les yeux se ferment de plaisir pendant la gorgée de café.
        const closed = !awake || t < blinkUntil || sipping > 0.6;
        eyes.scale.y += ((closed ? 0.08 : 1) - eyes.scale.y) * damp(0.35);

        // Bouche.
        const happy = gesture.name === "hop" || gesture.name === "wave" || docMode === "await" || activity === "coffee";
        mouth.rotation.z = mood === "sad" && !happy ? 0 : Math.PI;
        mouth.position.x = gaze.x * GAZE.x * GAZE.face;
        mouth.position.y = (mood === "sad" && !happy ? -0.16 : -0.08) - gaze.y * GAZE.y * GAZE.face;
        // Il ne parle pas pendant qu'il écrit à l'ordinateur : il est concentré, bouche fermée.
        const talking = mood === "talk" && !atComputer;
        if (talking) {
            if (t > speech.next) {
                const opening = speech.target === 0;
                speech.target = opening ? 0.55 + Math.random() * 0.45 : 0;
                // Voyelles un peu plus longues que les fermetures ; une pause de temps en temps.
                speech.next = t + (opening ? 0.09 + Math.random() * 0.1 : Math.random() < 0.12 ? 0.25 : 0.05 + Math.random() * 0.06);
            }
        } else {
            speech.target = 0;
        }
        speech.open += (speech.target - speech.open) * damp(0.55);
        const speaking = speech.open > 0.12;
        // Bouche fermée pendant la parole : un trait à peine courbé.
        mouth.visible = !speaking;
        mouth.scale.set(happy ? 1.4 : 1, talking ? 0.3 : happy ? 1.4 : 1, 1);
        mouthOpen.visible = speaking;
        mouthOpen.position.x = mouth.position.x;
        mouthOpen.position.y = mouth.position.y - 0.035;
        mouthOpen.scale.set(0.75 + speech.open * 0.25, speech.open, 1);

        // Bras (le bras droit peut saluer).
        const armLift = mood === "think" ? 0.9 + Math.sin(t * 5) * 0.15 : mood === "talk" ? 0.6 + Math.sin(t * 7) * 0.2 : mood === "sleep" ? 0.15 : 0.45 + Math.sin(t * 2.2) * 0.06;
        arms[0].rotation.z = -armLift;
        arms[1].rotation.z = armLift;
        if (gesture.name === "wave") {
            const p = (t - gesture.start) / 1.6;
            if (p < 1) arms[1].rotation.z = 2.5 + Math.sin(t * 13) * 0.35;
            else gesture.name = null;
        }

        // Document : bras levés pour l'attraper, puis tendus vers l'avant pour le tenir.
        const holding = docMode === "hold" || reading;
        if (docMode === "await") {
            const reach = 2.3 + Math.sin(t * 9) * 0.25;
            arms[0].rotation.z = -reach;
            arms[1].rotation.z = reach;
        } else if (holding) {
            arms[0].rotation.z = -0.25;
            arms[1].rotation.z = 0.25;
        }
        // Pendant la pause : tasse ou feuille tenue devant lui, ou frappe au clavier.
        let armReach = holding ? -1.1 : 0;
        if (activity === "coffee" || activity === "read") {
            arms[0].rotation.z = -0.25;
            arms[1].rotation.z = 0.25;
            armReach = activity === "coffee" ? -1.1 - sipping * 0.5 : -1.1;
        }
        arms.forEach((arm, i) => {
            // Il tape ; en lisant à l'écran, une main fait défiler de temps en temps.
            const typing = activity === "laptop" ? Math.sin(t * 17 + i * Math.PI) * 0.09
                : activity === "screen" && i === 1 ? Math.max(0, Math.sin(t * 1.4)) ** 8 * 0.18 : 0;
            if (atComputer) arm.rotation.z = (i ? 1 : -1) * 0.3;
            arm.rotation.x += ((atComputer ? -0.95 + typing : armReach) - arm.rotation.x) * damp(atComputer ? 0.5 : 0.2);
        });

        const pose = activity === "read" && docMode === "none" ? DOC_POSES.read : DOC_POSES[docMode];
        const ease = docMode === "toss" ? 0.14 : 0.2;
        sheet.position.x += ((pose.x ?? 0) - sheet.position.x) * damp(ease);
        sheet.position.y += (pose.y - sheet.position.y) * damp(ease);
        sheet.position.z += (pose.z - sheet.position.z) * damp(ease);
        sheet.rotation.x += (pose.tilt - sheet.rotation.x) * damp(ease);
        sheet.rotation.y += ((pose.turn ?? 0) - sheet.rotation.y) * damp(0.16);
        // De temps en temps, il tourne la page.
        if (activity === "read" && t > rest.nextPage) {
            sheet.rotation.z = 0.3;
            rest.nextPage = t + 5 + Math.random() * 4;
        }
        sheet.rotation.z = docMode === "toss" ? sheet.rotation.z + dt * 7.5 : sheet.rotation.z * Math.pow(0.8, dt * 30);
        sheet.scale.setScalar(Math.max(sheet.scale.x + (pose.scale - sheet.scale.x) * damp(ease), 0.001));
        sheet.visible = sheet.scale.x > 0.01;

        // Debout, les pieds restent au sol ; assis, les jambes partent en avant et se balancent.
        legs.forEach((leg, i) => {
            const standing = -0.98 - rig.position.y * 0.6 + hop;
            leg.position.y = standing + (-0.84 - standing) * sit;
            leg.position.z = 0.55 * sit;
            leg.rotation.x = -sit * (1.35 + Math.sin(t * 2.4 + i * Math.PI) * 0.15);
        });
        animateProps(t, activity, sipping);
        floor.material.opacity = 0.55 - rig.position.y;

        // Couleur et accessoires : transitions douces.
        bodyMaterial.color.lerp(targetColor, damp(0.12));
        floor.material.color.copy(bodyMaterial.color);
        for (const [id, target] of wornTargets) {
            const group = gear[id];
            const next = group.scale.x + (target - group.scale.x) * damp(0.2);
            group.scale.setScalar(Math.max(next, 0.001));
            group.visible = group.scale.x > 0.01;
        }
        gear.antenne.children[1].position.y = TOP_Y + 0.42 + Math.sin(t * 3) * 0.03;
    }

    // Assez longtemps sans rien à faire pour s'occuper : en mode autonome, dès la fin de son moment
    // d'attention ; sinon, au bout de BREAK.after secondes sans souris ni clavier.
    function restless(t) {
        return autonomous ? t > attentionUntil : t - rest.lastActive > BREAK.after;
    }

    function startBreak(t) {
        const choices = BREAK_ACTIVITIES.filter((name) => name !== rest.activity);
        rest.activity = choices[Math.floor(Math.random() * choices.length)];
        rest.since = t;
        rest.nextSip = t + 2;
        rest.nextPage = t + 4;
    }

    // Gorgée de café : 0 (tasse basse) → 1 (aux lèvres) → 0, toutes les 5 à 8 secondes.
    function sipAmount(t) {
        if (t > rest.nextSip) {
            rest.sipStart = t;
            rest.nextSip = t + 5 + Math.random() * 3;
        }
        const p = (t - rest.sipStart) / 1.8;
        return p >= 0 && p < 1 ? Math.sin(p * Math.PI) ** 2 : 0;
    }

    function animateProps(t, activity, sipping) {
        const { chair, mug, steam, laptop } = props;
        const grow = (object, shown, k = 0.15) => {
            const next = object.scale.x + ((shown ? 1 : 0) - object.scale.x) * damp(k);
            object.scale.setScalar(Math.max(next, 0.001));
            object.visible = object.scale.x > 0.01;
        };
        grow(chair, rest.sit > 0.05 && activity !== null, 0.12);
        grow(mug, activity === "coffee");
        grow(laptop, activity === "laptop" || activity === "screen");
        // Tasse : de la poitrine aux lèvres, inclinée pour boire.
        mug.position.y = -0.42 + sipping * 0.24;
        mug.position.z = FACE_Z + 0.28 - sipping * 0.04;
        mug.rotation.x = -sipping * 0.55;
        steam.forEach((puff, i) => {
            const phase = (t * 0.45 + i / steam.length) % 1;
            puff.position.set(Math.sin(t * 2 + i * 2) * 0.04, 0.16 + phase * 0.4, 0);
            puff.scale.setScalar(0.6 + phase * 0.8);
            puff.material.opacity = (1 - phase) * 0.35 * (1 - sipping);
        });
        // Écran : léger scintillement pendant qu'il tape.
        laptop.userData.screen.material.color.setHSL(0.56, 0.6, 0.62 + Math.sin(t * 9) * 0.03);
    }

    function loop() {
        frameId = requestAnimationFrame(loop);
        sinceFrame += clock.getDelta();
        // Marge de 2 ms : avec la gigue de requestAnimationFrame, un seuil exact sauterait des images
        // de façon irrégulière (saccades). Au-delà de 0,1 s (onglet en arrière-plan), on ne rattrape pas.
        const interval = 1 / (mood === "think" || mood === "talk" || rest.activity || work ? BUSY_FPS : FPS);
        if (!visible || paused || sinceFrame < interval - 0.002) return;
        dt = Math.min(sinceFrame, 0.1);
        sinceFrame = 0;
        rectAge += dt;
        if (rectAge > 0.5) {
            rect = container.getBoundingClientRect();
            rectAge = 0;
        }
        animate(clock.elapsedTime);
        renderer.render(scene, camera);
    }

    // ---------- Taille et visibilité ----------

    // Taille de mise en page (sans les transformations des animations de transition).
    const resize = () => {
        const width = container.clientWidth;
        const height = container.clientHeight;
        if (width === 0 || height === 0) return;
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5, Math.sqrt(PIXEL_BUDGET / (width * height))));
        renderer.setSize(width, height, false);
        rect = container.getBoundingClientRect();
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);
    const visibilityObserver = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting && !document.hidden; });
    visibilityObserver.observe(container);
    const onVisibility = () => { visible = !document.hidden; };
    document.addEventListener("visibilitychange", onVisibility);

    resize();
    loop();

    return {
        setMood(next) {
            if (MOODS.includes(next)) mood = next;
            rest.lastActive = clock.elapsedTime;
        },
        setColor(hex) {
            targetColor.set(hex);
        },
        setAccessories(ids) {
            for (const id of wornTargets.keys()) wornTargets.set(id, ids.includes(id) ? 1 : 0);
        },
        // Atelier : rotation à la souris au lieu du suivi du regard.
        setInteractive(value) {
            interactive = value;
            spin.dragging = false;
        },
        setDocument(mode) {
            if (!DOC_MODES.includes(mode)) return;
            clearTimeout(tossTimer);
            if (mode === "hold" && docMode !== "hold" && docMode !== "read") {
                // Le document apparaît dans les mains, depuis le haut.
                sheet.position.set(0, 0.6, FACE_Z + 0.5);
                sheet.scale.setScalar(0.4);
            }
            if (mode === "toss") tossTimer = setTimeout(() => { docMode = "none"; sheet.position.set(0, -0.55, FACE_Z + 0.3); }, 700);
            docMode = mode;
        },
        // Longue tâche : "laptop" (il rédige), "screen" (il lit à l'écran), "read" (il lit une
        // feuille) ; null, il se lève.
        setActivity(name) {
            const next = WORK_ACTIVITIES.includes(name) ? name : null;
            if (next === work) return;
            if (next === "read") rest.nextPage = clock.elapsedTime + 3;
            work = next;
            rest.lastActive = clock.elapsedTime;
        },
        setAutonomous(value) {
            autonomous = value;
        },
        // On lui écrit : il lâche ce qu'il faisait (petit sursaut) et suit la souris quelques secondes.
        wake(seconds = 10, { startle = true } = {}) {
            attentionUntil = clock.elapsedTime + seconds;
            rest.lastActive = clock.elapsedTime;
            rest.activity = null;
            if (startle) {
                gesture.name = "hop";
                gesture.start = clock.elapsedTime;
            }
        },
        // Point de l'écran à regarder (le document qu'on glisse, qui vole…) ; null pour suivre la souris.
        lookAt(point) {
            gazeTarget = point;
            rest.lastActive = clock.elapsedTime;
        },
        // Suspend le rendu, par exemple pour laisser la carte graphique au chargement du modèle.
        setPaused(value) {
            paused = value;
        },
        gesture(name) {
            gesture.name = name;
            gesture.start = clock.elapsedTime;
        },
        dispose() {
            cancelAnimationFrame(frameId);
            window.removeEventListener("pointermove", onPointerMove);
            window.removeEventListener("keydown", noticeUser);
            window.removeEventListener("pointerdown", noticeUser);
            document.removeEventListener("visibilitychange", onVisibility);
            resizeObserver.disconnect();
            visibilityObserver.disconnect();
            renderer.dispose();
            renderer.domElement.remove();
        },
    };
}

// Angle de face le plus proche (multiple de 2π), pour revenir sans faire de tours inutiles.
const nearestTurn = (angle) => Math.round(angle / (Math.PI * 2)) * Math.PI * 2;

function buildBody(color) {
    const rig = new THREE.Group();

    const bodyMaterial = new THREE.MeshPhysicalMaterial({
        color,
        roughness: 0.42,
        clearcoat: 0.55,
        clearcoatRoughness: 0.3,
    });
    rig.add(new THREE.Mesh(new RoundedBoxGeometry(BODY.width, BODY.height, BODY.depth, 8, 0.34), bodyMaterial));

    // Yeux noirs brillants, avec un reflet blanc.
    const eyes = new THREE.Group();
    const eyeMaterial = new THREE.MeshPhysicalMaterial({ color: 0x0b0b10, roughness: 0.08, clearcoat: 1 });
    const glintMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
    for (const side of [-1, 1]) {
        const eye = new THREE.Mesh(new THREE.SphereGeometry(0.19, 28, 18), eyeMaterial);
        eye.scale.z = 0.55;
        eye.position.set(side * 0.36, 0.13, FACE_Z);
        const glint = new THREE.Mesh(new THREE.SphereGeometry(0.055, 12, 8), glintMaterial);
        glint.position.set(side * 0.36 + 0.065, 0.21, FACE_Z + 0.095);
        eyes.add(eye, glint);
    }
    rig.add(eyes);

    // Joues roses.
    const cheekMaterial = new THREE.MeshBasicMaterial({ color: 0xf5a3b7, transparent: true, opacity: 0.9 });
    const cheeks = [-1, 1].map((side) => {
        const cheek = new THREE.Mesh(new THREE.CircleGeometry(0.11, 24), cheekMaterial);
        cheek.scale.y = 0.7;
        cheek.position.set(side * 0.58, -0.1, FACE_Z + 0.002);
        cheek.userData = { x: side * 0.58, y: -0.1 };
        rig.add(cheek);
        return cheek;
    });

    // Bouche : arc de tore (sourire quand tourné de π).
    const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.02, 8, 24, Math.PI), new THREE.MeshBasicMaterial({ color: 0x0b0b10 }));
    mouth.position.set(0, -0.08, FACE_Z + 0.01);
    mouth.rotation.z = Math.PI;
    rig.add(mouth);
    // Bouche ouverte quand il parle : un rond sombre, la langue au fond.
    const mouthOpen = new THREE.Mesh(new THREE.CircleGeometry(0.07, 24), new THREE.MeshBasicMaterial({ color: 0x0b0b10 }));
    const tongue = new THREE.Mesh(new THREE.CircleGeometry(0.04, 20, 0, Math.PI), new THREE.MeshBasicMaterial({ color: 0xe0607a }));
    tongue.rotation.z = Math.PI;
    tongue.position.set(0, -0.03, 0.001);
    mouthOpen.add(tongue);
    mouthOpen.position.set(0, -0.115, FACE_Z + 0.01);
    mouthOpen.visible = false;
    rig.add(mouthOpen);

    // Bras et jambes arrondis.
    const arms = [-1, 1].map((side) => {
        const pivot = new THREE.Group();
        pivot.position.set(side * 0.9, 0, 0.08);
        const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.14, 0.32, 6, 14), bodyMaterial);
        arm.position.set(side * 0.06, -0.24, 0);
        pivot.add(arm);
        rig.add(pivot);
        return pivot;
    });
    const legs = [-1, 1].map((side) => {
        const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.18, 0.18, 6, 14), bodyMaterial);
        leg.position.set(side * 0.34, -0.98, 0);
        rig.add(leg);
        return leg;
    });

    // Halo au sol, de la couleur du personnage.
    const floor = new THREE.Mesh(
        new THREE.CircleGeometry(1.25, 48),
        new THREE.MeshBasicMaterial({ color, map: radialTexture(), transparent: true, opacity: 0.55, depthWrite: false }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -1.28;

    return { rig, eyes, mouth, mouthOpen, cheeks, arms, legs, floor, bodyMaterial };
}

function buildAccessories() {
    const dark = new THREE.MeshPhysicalMaterial({ color: 0x1d1d23, roughness: 0.3, clearcoat: 0.6 });

    // Lunettes : deux cerclages et un pont devant les yeux.
    const lunettes = new THREE.Group();
    for (const side of [-1, 1]) {
        const rim = new THREE.Mesh(new THREE.TorusGeometry(0.25, 0.032, 10, 36), dark);
        rim.position.set(side * 0.36, 0.13, FACE_Z + 0.09);
        lunettes.add(rim);
    }
    const bridge = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.22, 8), dark);
    bridge.rotation.z = Math.PI / 2;
    bridge.position.set(0, 0.17, FACE_Z + 0.09);
    lunettes.add(bridge);

    // Casque audio : arceau au-dessus de la tête et deux écouteurs.
    const casque = new THREE.Group();
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.055, 10, 40, Math.PI), dark);
    band.scale.x = 1.48;
    band.position.y = 0.32;
    casque.add(band);
    const cushion = new THREE.MeshPhysicalMaterial({ color: 0xf5a3b7, roughness: 0.6 });
    for (const side of [-1, 1]) {
        const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.16, 28), dark);
        cup.rotation.z = Math.PI / 2;
        cup.position.set(side * 0.92, 0.3, 0);
        const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.05, 28), cushion);
        pad.rotation.z = Math.PI / 2;
        pad.position.set(side * 0.84, 0.3, 0);
        casque.add(cup, pad);
    }

    // Nœud papillon sous la bouche.
    const noeud = new THREE.Group();
    const red = new THREE.MeshPhysicalMaterial({ color: 0xe5484d, roughness: 0.35, clearcoat: 0.5 });
    for (const side of [-1, 1]) {
        const wing = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.24, 4), red);
        wing.rotation.z = side * Math.PI / 2;
        wing.position.set(side * 0.13, -0.47, FACE_Z + 0.06);
        noeud.add(wing);
    }
    const knot = new THREE.Mesh(new THREE.SphereGeometry(0.06, 16, 12), red);
    knot.position.set(0, -0.47, FACE_Z + 0.08);
    noeud.add(knot);

    // Antenne lumineuse sur le dessus.
    const antenne = new THREE.Group();
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.36, 8), dark);
    stem.position.y = TOP_Y + 0.18;
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.09, 20, 14), new THREE.MeshBasicMaterial({ color: 0xffd166 }));
    bulb.position.y = TOP_Y + 0.42;
    antenne.add(stem, bulb);

    return { lunettes, casque, noeud, antenne };
}

// Feuille de papier avec quelques lignes de texte.
function buildDocument() {
    const sheet = new THREE.Group();
    const paper = new THREE.Mesh(
        new RoundedBoxGeometry(0.78, 0.98, 0.03, 2, 0.012),
        // Légèrement émissif : le papier reste clair même tourné vers l'ombre.
        new THREE.MeshStandardMaterial({ color: 0xf7f5f0, roughness: 0.85, emissive: 0x4a4946 }),
    );
    sheet.add(paper);
    // Lignes de texte au recto ; au verso, les mêmes en transparence, inversées.
    const ink = new THREE.MeshBasicMaterial({ color: 0xb9bcc6 });
    const title = new THREE.MeshBasicMaterial({ color: 0x5b8fd6 });
    const inkThrough = new THREE.MeshStandardMaterial({ color: 0xc4c3be, roughness: 0.85, emissive: 0x3a3936 });
    const widths = [0.42, 0.56, 0.5, 0.56, 0.34, 0.52, 0.46];
    widths.forEach((width, i) => {
        const geometry = new THREE.PlaneGeometry(width, i === 0 ? 0.06 : 0.035);
        const y = 0.36 - i * 0.11 - (i > 0 ? 0.04 : 0);
        const front = new THREE.Mesh(geometry, i === 0 ? title : ink);
        front.position.set(-0.29 + width / 2, y, 0.017);
        const back = new THREE.Mesh(geometry, inkThrough);
        back.rotation.y = Math.PI;
        back.position.set(0.29 - width / 2, y, -0.017);
        sheet.add(front, back);
    });
    sheet.scale.setScalar(0.001);
    sheet.visible = false;
    return sheet;
}

// Accessoires de pause : chaise de bureau (posée au sol), tasse de café et ordinateur portable.
function buildProps() {
    const dark = new THREE.MeshPhysicalMaterial({ color: 0x2a2c33, roughness: 0.45, clearcoat: 0.4 });
    const metal = new THREE.MeshStandardMaterial({ color: 0xa7adb8, roughness: 0.3, metalness: 0.6 });

    const chair = new THREE.Group();
    const seat = new THREE.Mesh(new RoundedBoxGeometry(1.75, 0.1, 1.4, 4, 0.05), dark);
    seat.position.y = -SIT_DROP - BODY.height / 2 - 0.05;
    const back = new THREE.Mesh(new RoundedBoxGeometry(1.45, 1.6, 0.1, 4, 0.05), dark);
    back.position.set(0, 0.05, -BODY.depth / 2 - 0.1);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.2, 12), metal);
    pole.position.y = -1.1;
    chair.add(seat, back, pole);
    for (let i = 0; i < 5; i++) {
        const angle = (i / 5) * Math.PI * 2;
        const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.04, 0.06), metal);
        spoke.position.set(Math.cos(angle) * 0.25, -1.2, Math.sin(angle) * 0.25);
        spoke.rotation.y = -angle;
        const wheel = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), dark);
        wheel.position.set(Math.cos(angle) * 0.5, -1.24, Math.sin(angle) * 0.5);
        chair.add(spoke, wheel);
    }

    const mug = new THREE.Group();
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.11, 0.26, 24), new THREE.MeshPhysicalMaterial({ color: 0xf3efe6, roughness: 0.3, clearcoat: 0.6 }));
    const coffee = new THREE.Mesh(new THREE.CircleGeometry(0.115, 20), new THREE.MeshBasicMaterial({ color: 0x4a2c1a }));
    coffee.rotation.x = -Math.PI / 2;
    coffee.position.y = 0.12;
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.022, 8, 16), cup.material);
    handle.position.x = 0.15;
    mug.add(cup, coffee, handle);
    const steam = [0, 1, 2].map(() => {
        const puff = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }));
        mug.add(puff);
        return puff;
    });

    // Portable sur les genoux : clavier vers lui, écran tourné vers lui, dos (et logo) vers nous.
    const laptop = new THREE.Group();
    laptop.position.set(0, -0.78, FACE_Z + 0.36);
    const base = new THREE.Mesh(new RoundedBoxGeometry(1.0, 0.05, 0.62, 2, 0.02), metal);
    const lid = new THREE.Group();
    lid.position.set(0, 0.025, 0.31);
    lid.rotation.x = 0.22;
    const shell = new THREE.Mesh(new RoundedBoxGeometry(1.0, 0.5, 0.035, 2, 0.015), metal);
    shell.position.y = 0.25;
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.42), new THREE.MeshBasicMaterial({ color: 0x8ecbf0 }));
    screen.rotation.y = Math.PI;
    screen.position.set(0, 0.25, -0.019);
    const logo = new THREE.Mesh(new THREE.CircleGeometry(0.05, 20), new THREE.MeshBasicMaterial({ color: 0xe8edf5 }));
    logo.position.set(0, 0.27, 0.019);
    lid.add(shell, screen, logo);
    laptop.add(base, lid);
    laptop.userData.screen = screen;

    for (const prop of [chair, mug, laptop]) {
        prop.scale.setScalar(0.001);
        prop.visible = false;
    }
    return { chair, mug, steam, laptop };
}

// Compile tous les shaders d'emblée, y compris ceux des objets encore cachés (accessoires, feuille) :
// sinon la première apparition d'un objet fige l'animation le temps de la compilation.
function precompile(renderer, scene, camera) {
    const hidden = [];
    scene.traverse((object) => {
        if (!object.visible) {
            hidden.push(object);
            object.visible = true;
        }
    });
    renderer.compile(scene, camera);
    for (const object of hidden) object.visible = false;
}

function radialTexture() {
    const size = 128;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d");
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, "rgba(255,255,255,0.55)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    return new THREE.CanvasTexture(canvas);
}
