import { test } from "node:test";
import assert from "node:assert/strict";
import { autoLoadDecision, isMobileDevice } from "../js/device_guard.js";

const IPHONE = { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1", platform: "iPhone", maxTouchPoints: 5 };
const IPAD = { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15", platform: "MacIntel", maxTouchPoints: 5 };
const MAC = { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15", platform: "MacIntel", maxTouchPoints: 0 };
const WINDOWS = { userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/142.0 Safari/537.36", platform: "Win32", maxTouchPoints: 0 };

test("mobile : iPhone, iPad (même déguisé en Mac) et Android ; pas les ordinateurs", () => {
    assert.equal(isMobileDevice(IPHONE), true);
    assert.equal(isMobileDevice(IPAD), true);
    assert.equal(isMobileDevice({ userAgent: "Mozilla/5.0 (Linux; Android 15; Pixel 9) Chrome/142.0 Mobile" }), true);
    assert.equal(isMobileDevice(MAC), false);
    assert.equal(isMobileDevice(WINDOWS), false);
});

test("chargement automatique : ordinateur oui, mobile non, et jamais juste après un plantage", () => {
    const now = 1_000_000_000;
    assert.deepEqual(autoLoadDecision({ device: WINDOWS, lastAttempt: null, now }), { auto: true });
    assert.deepEqual(autoLoadDecision({ device: IPHONE, lastAttempt: null, now }), { auto: false, reason: "mobile" });
    assert.deepEqual(autoLoadDecision({ device: WINDOWS, lastAttempt: String(now - 60_000), now }), { auto: false, reason: "crash" });
    // Un chargement inachevé très ancien (onglet fermé) ne bloque plus.
    assert.deepEqual(autoLoadDecision({ device: WINDOWS, lastAttempt: String(now - 3600_000), now }), { auto: true });
});
