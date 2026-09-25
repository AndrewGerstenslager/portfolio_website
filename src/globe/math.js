import { Vector2, Vector3, Quaternion, Matrix4, MathUtils } from 'three';

/**
 * Small math helpers shared by the globe modules: easings, lat/lon
 * conversion, a clock-driven Tween and module-level scratch objects.
 */

// ── Scratch objects (never hold state across calls) ─────
export const _v0 = new Vector3();
export const _v1 = new Vector3();
export const _v2 = new Vector3();
export const _v3 = new Vector3();
export const _v4 = new Vector3();
export const _q0 = new Quaternion();
export const _q1 = new Quaternion();
export const _m0 = new Matrix4();
export const _ndc = new Vector2();

// ── Easings (t in [0, 1]) ──────────────────────────────
export const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
export const easeOutExpo = (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));
export const easeInOutSine = (t) => -(Math.cos(Math.PI * t) - 1) / 2;
export const linear = (t) => t;

// ── Lat / lon ──────────────────────────────────────────
const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

/** Degrees → unit vector: x = cos(lat)·sin(lon), y = sin(lat), z = cos(lat)·cos(lon) */
export function latLonToVec3(lat, lon, out) {
    const la = lat * D2R;
    const lo = lon * D2R;
    const c = Math.cos(la);
    return out.set(c * Math.sin(lo), Math.sin(la), c * Math.cos(lo));
}

/** Unit vector → {lat, lon} in degrees (fills out) */
export function vec3ToLatLon(v, out) {
    const len = v.length() || 1;
    out.lat = Math.asin(MathUtils.clamp(v.y / len, -1, 1)) * R2D;
    out.lon = Math.atan2(v.x, v.z) * R2D;
    return out;
}

/** Index of the unit vector in dirs (Float32Array of xyz) with the largest dot against v */
export function nearestDir(dirs, v) {
    let best = 0;
    let bestDot = -Infinity;
    for (let i = 0, n = dirs.length / 3; i < n; i++) {
        const d = dirs[i * 3] * v.x + dirs[i * 3 + 1] * v.y + dirs[i * 3 + 2] * v.z;
        if (d > bestDot) { bestDot = d; best = i; }
    }
    return best;
}

export const round1 = (x) => Math.round(x * 10) / 10;

/** Seeded PRNG (mulberry32) so the scene looks the same on every load */
export function seededRandom(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// ── Tween ──────────────────────────────────────────────

/**
 * Progress tracker driven by the globe clock (ms), not Date.now.
 * start() arms it; update(now) sets `value` (eased, 0..1) and returns true
 * while it is running — including the frame on which it completes.
 */
export class Tween {
    constructor(ease = linear) {
        this.ease = ease;
        this.active = false;
        this.value = 1;
        this.raw = 1;
        this._t0 = 0;
        this._dur = 0;
    }

    start(now, duration, delay = 0, ease = this.ease) {
        this.ease = ease;
        this._t0 = now + delay;
        this._dur = duration;
        if (duration <= 0 && delay <= 0) {
            this.finish();
            return this;
        }
        this.active = true;
        this.raw = 0;
        this.value = this.ease(0);
        return this;
    }

    update(now) {
        if (!this.active) return false;
        const t = this._dur > 0 ? (now - this._t0) / this._dur : (now >= this._t0 ? 1 : 0);
        if (t >= 1) {
            this.finish();
        } else {
            this.raw = Math.max(0, t);
            this.value = this.ease(this.raw);
        }
        return true;
    }

    finish() {
        this.active = false;
        this.raw = 1;
        this.value = 1;
    }

    /** Park at the start (value = ease(0)) without running */
    reset() {
        this.active = false;
        this.raw = 0;
        this.value = this.ease(0);
    }

    stop() {
        this.active = false;
    }
}
