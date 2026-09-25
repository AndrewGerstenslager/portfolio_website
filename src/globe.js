import {
    WebGLRenderer, WebGLRenderTarget, Scene, Group, PerspectiveCamera, Vector2, Vector3, Quaternion,
    Sphere, Raycaster, IcosahedronGeometry, Color, MathUtils, SRGBColorSpace, NoToneMapping, HalfFloatType,
} from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import {
    R, COLORS, buildBackdrop, buildStars, buildWire, buildNodes, uniqueVertices, buildAtmosphere,
    buildInnerGlow, buildOrbit, buildBezel, buildMarker, buildTracers,
} from './globe/parts.js';
import {
    Tween, easeInOutCubic, easeOutCubic, easeOutExpo, easeInOutSine, linear,
    latLonToVec3, vec3ToLatLon, nearestDir, round1, _v0, _v1, _v2, _q0, _q1, _m0, _ndc,
} from './globe/math.js';

/**
 * WireframeGlobe — the Three.js stage: geodesic wire globe with bloom,
 * atmosphere, orbit ring, bezel, tracers and a focus marker.
 *
 * Rendering only. It never reads the DOM: main.js measures the layout and
 * hands over a viewport (setViewport) and a screen-space frame (setFrame);
 * the globe is drawn head-on into that circle via a camera lens shift.
 */

const FOV = 35;
const TAN_HALF = Math.tan(MathUtils.degToRad(FOV / 2));
const MAX_OMEGA = 12.5;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 1;
const HOME_LAT = 15;
const HOME_LON = 0;

// uReveal runs a little past [0, 1] so no seed is visible at the start
// and every seed (max 1.0) is past its hot leading edge at the end.
const REVEAL_FROM = -0.05;
const REVEAL_TO = 1.1;

const TIERS = {
    high:   { prCap: 2,   composer: true,  msaa: true,  stars: 1600, tracers: 5 },
    medium: { prCap: 1.5, composer: true,  msaa: false, stars: 900,  tracers: 5 },
    low:    { prCap: 1,   composer: false, msaa: false, stars: 600,  tracers: 3 },
};
const TIER_ORDER = ['high', 'medium', 'low'];

// Tuned by eye: the spec's 0.8 / 0.5 / 0.3 washed the navy backdrop brown
// (every wire pixel passes a 0.3 threshold and the widest mips spread it
// over the whole screen). Radius 0 + tapered mip weights keep the glow on
// the wire; the higher threshold leaves stars, grid and rings unbloomed.
const BLOOM_RADIUS = 0;
const BLOOM_THRESHOLD = 0.5;
const BLOOM_MIP_WEIGHTS = [1.0, 0.7, 0.35, 0.12, 0.04];
const BLOOM_INTRO = 2.0;
const MODES = {
    home:    { tracers: 1,   bloom: 0.9, idle: 1 },
    section: { tracers: 0.5, bloom: 0.8, idle: 0 },
};

const ADAPT_FRAMES = 120;
const ADAPT_LIMIT_MS = 22;
const SCAN_EVERY = 8;
const PULSE_MS = 1400;
const MARKER_PING = 1.6;

const Y_AXIS = new Vector3(0, 1, 0);
const X_AXIS = new Vector3(1, 0, 0);

const toBool = (v) => (typeof v === 'string' ? !['', '0', 'false', 'off'].includes(v.trim().toLowerCase()) : !!v);
const smoothstep = (a, b, x) => { const t = MathUtils.clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

export class WireframeGlobe {
    constructor(canvas, { quality = 'high', adaptive = true, reducedMotion = false, intro = false } = {}) {
        let renderer;
        try {
            renderer = new WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
        } catch (err) {
            throw new Error('WEBGL_UNAVAILABLE');
        }
        renderer.setClearColor(COLORS.deep, 1);
        renderer.outputColorSpace = SRGBColorSpace;
        renderer.toneMapping = NoToneMapping;
        renderer.info.autoReset = false;
        this._renderer = renderer;

        // ── Tier ──
        const floatRT = renderer.extensions.has('EXT_color_buffer_float')
            || renderer.extensions.has('EXT_color_buffer_half_float');
        this._tier = TIERS[quality] ? quality : 'medium';
        if (!floatRT) this._tier = 'low';
        this._adaptive = !!adaptive;
        this._reduced = !!reducedMotion;
        this._listeners = { tier: [] };

        // ── Viewport / frame state ──
        this._w = 1;
        this._h = 1;
        this._dpr = 1;
        this._pr = 1;
        this._dbSize = new Vector2(1, 1);
        this._hasViewport = false;
        this._hasFrame = false;
        this._frame = { cx: 0, cy: 0, D: 0 };       // displayed
        this._frameFrom = { cx: 0, cy: 0, D: 0 };
        this._frameTo = { cx: 0, cy: 0, D: 0 };     // target
        this._frameTw = new Tween(easeInOutCubic);
        this._swoopSign = 0;
        this._yaw = 0;
        this._deff = 1;

        // ── Motion ──
        this._zoomTarget = 1;
        this._zoomCur = 1;
        this._vel = new Vector3();
        this._spinRate = 1;
        this._lastRotateAt = -Infinity;
        this._dragRate = 0;
        this._orientTw = new Tween(easeInOutCubic);
        this._qFrom = new Quaternion();
        this._qTo = new Quaternion();
        this._orientPulse = false;
        this._orientKind = '';
        this._pointer = new Vector2();

        // ── Focus / marker / pulse ──
        this._focusNode = -1;
        this._focusDir = new Vector3(0, 0, 1);
        this._markerAlpha = 0;
        this._markerFrom = 0;
        this._markerTo = 0;
        this._markerTw = new Tween(linear);
        this._markerPingAt = 0;
        this._pulseTw = new Tween(linear);

        // ── Mode ──
        this._mode = 'home';
        this._modeFrom = { ...MODES.home };
        this._modeCur = { ...MODES.home };
        this._modeTw = new Tween(easeInOutCubic);
        this._scanClock = SCAN_EVERY - 3;
        this._scanTw = new Tween(easeInOutSine);

        // ── Intro ──
        this._introPending = !!intro;     // hidden or drawing in
        this._introEnded = !intro;
        this._introEndedAt = -1;
        this._revealTw = new Tween(easeOutCubic);
        this._scaleTw = new Tween(easeOutExpo);
        this._bloomTw = new Tween(easeOutCubic);
        this._fadeTw = new Tween(easeOutCubic);
        this._fadeLateTw = new Tween(easeOutCubic);
        this._introTweens = [this._revealTw, this._scaleTw, this._bloomTw, this._fadeTw, this._fadeLateTw];
        if (intro) this._introTweens.forEach((t) => t.reset());

        // ── Options ──
        this._opts = { bloom: true, rings: true, tracers: true, bezel: true };
        this._cap = 0;

        // ── Clock / loop ──
        this._now = 0;           // ms, real time (drives tweens)
        this._time = 0;          // s, motion time (frozen under reduced motion)
        this._tLast = -1;
        this._tLastRender = -1;
        this._firstRenderAt = -1;
        this._dirty = true;
        this._fps = 60;
        this._drawCalls = 0;

        // ── Adaptive downgrade ──
        this._adaptBuf = new Float32Array(ADAPT_FRAMES);
        this._adaptIdx = 0;
        this._adaptCount = 0;
        this._adaptSum = 0;
        this._adaptWait = 0;
        this._adaptArmed = false;

        // ── Picking ──
        this._raycaster = new Raycaster();
        this._sphere = new Sphere(new Vector3(), R);
        this._ll = { lat: 0, lon: 0 };

        this._buildScene();
        this._applyIntroValues();
        this._resetOrientation();

        this._tick = this._tick.bind(this);
    }

    // ── Scene ──────────────────────────────────────────

    _buildScene() {
        const U = this._u = {
            uTime: { value: 0 },
            uPixelRatio: { value: 1 },
            uResolution: { value: new Vector2(1, 1) },
            uCenterPx: { value: new Vector2() },
            uRadiusPx: { value: 1 },
            uPxScale: { value: 1 },
            uRadiusScale: { value: 1 },
            uReveal: { value: REVEAL_TO },
            uScanY: { value: 2 },
            uScanAmt: { value: 0 },
            uPingDir: { value: new Vector3(0, 0, 1) },
            uPingT: { value: 0 },
            uAtmo: { value: 1 },
            uColor: { value: new Color(COLORS.brand) },
            uHot: { value: new Color(COLORS.hot) },
        };

        this._scene = new Scene();
        this._camera = new PerspectiveCamera(FOV, 1, 0.1, 200);

        const T = TIERS[this._tier];
        this._maxStars = T.stars;
        this._maxTracers = T.tracers;

        this._backdrop = buildBackdrop(U);
        this._stars = buildStars(T.stars, U);
        this._scene.add(this._backdrop.object3D, this._stars.object3D);

        this._root = new Group();
        this._spin = new Group();
        this._scene.add(this._root);

        const ico = new IcosahedronGeometry(R, 3);
        const verts = uniqueVertices(ico);
        this._wire = buildWire(ico, U);
        this._nodes = buildNodes(verts, U);
        ico.dispose();
        this._nodeDirs = this._nodes.nodeDirs;
        this._stats = Object.freeze({ nodes: this._nodes.count, edges: this._wire.edgeCount });

        this._atmo = buildAtmosphere(U);
        this._inner = buildInnerGlow(U);
        this._orbit = buildOrbit(U);
        this._bezel = buildBezel();
        this._marker = buildMarker();
        this._tracers = buildTracers(T.tracers, U);

        this._spin.add(this._wire.object3D, this._nodes.object3D, this._tracers.object3D, this._marker.object3D);
        this._root.add(this._atmo.object3D, this._inner.object3D, this._spin, this._orbit.object3D, this._bezel.object3D);
    }

    // ── Public API: layout ─────────────────────────────

    setViewport(widthCss, heightCss, devicePixelRatio = 1) {
        this._w = Math.max(1, Number(widthCss) || 1);
        this._h = Math.max(1, Number(heightCss) || 1);
        this._dpr = Number(devicePixelRatio) > 0 ? Number(devicePixelRatio) : 1;
        this._hasViewport = true;
        this._applyViewport();
    }

    setFrame(frame, { duration = 0, swoop = false } = {}) {
        const cx = Number(frame?.cx), cy = Number(frame?.cy), D = Math.max(1, Number(frame?.diameter));
        if (!Number.isFinite(cx) || !Number.isFinite(cy) || !Number.isFinite(D)) return;
        const to = this._frameTo;
        if (this._hasFrame && Math.abs(to.cx - cx) < 0.5 && Math.abs(to.cy - cy) < 0.5 && Math.abs(to.D - D) < 0.5) return;

        if (this._reduced) duration = 0;
        const from = this._frameFrom, cur = this._frame;
        from.cx = cur.cx; from.cy = cur.cy; from.D = cur.D;
        to.cx = cx; to.cy = cy; to.D = D;

        if (!this._hasFrame || !(duration > 0)) {
            cur.cx = cx; cur.cy = cy; cur.D = D;
            this._frameTw.stop();
            this._yaw = 0;
        } else {
            this._swoopSign = swoop && !this._reduced ? (Math.sign(cx - from.cx) || 1) : 0;
            this._frameTw.start(this._now, duration);
        }
        this._hasFrame = true;
        this._dirty = true;
    }

    getFrame(out) {
        out.cx = this._frame.cx;
        out.cy = this._frame.cy;
        out.diameter = this._frame.D;
        out.effectiveDiameter = this._effectiveDiameter();
        return out;
    }

    // ── Public API: mode / focus ───────────────────────

    setMode(mode) {
        if (!MODES[mode]) return;
        if (mode === this._mode) return;
        this._mode = mode;
        Object.assign(this._modeFrom, this._modeCur);
        this._modeTw.start(this._now, this._reduced ? 0 : 400);
        if (!this._modeTw.active) Object.assign(this._modeCur, MODES[mode]);
        if (mode === 'home') {
            this.focus(null);
        } else {
            this._scanTw.stop();
            this._u.uScanAmt.value = 0;
        }
        this._dirty = true;
    }

    focus(target, { duration = 1000, pulse = true } = {}) {
        if (target == null) {
            if (this._focusNode >= 0 || this._markerTo > 0) {
                this._focusNode = -1;
                if (this._orientTw.active && this._orientKind === 'focus') {
                    this._orientTw.stop();
                    this._orientPulse = false;
                }
                this._fadeMarker(0, this._reduced ? 0 : 200, 0);
            }
            this._dirty = true;
            return null;
        }
        const lat = Number(target.lat), lon = Number(target.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

        const node = nearestDir(this._nodeDirs, latLonToVec3(lat, lon, _v0));
        const n = this._focusDir.fromArray(this._nodeDirs, node * 3);
        this._focusNode = node;
        this._placeMarker(n);

        // Node → +Z (north up), then nudge it right of and above centre
        this._facingQuat(n, this._qTo);
        _q0.setFromAxisAngle(X_AXIS, -0.18);
        _q1.setFromAxisAngle(Y_AXIS, 0.30);
        this._qTo.premultiply(_q0).premultiply(_q1);

        const dur = this._reduced ? 0 : Math.max(0, Number(duration) || 0);
        this._markerAlpha = 0;
        this._fadeMarker(1, dur > 0 ? 300 : 0, dur * 0.7);
        this._startOrient(dur, !!pulse, 'focus');
        this._dirty = true;

        vec3ToLatLon(n, this._ll);
        return { node, lat: round1(this._ll.lat), lon: round1(this._ll.lon) };
    }

    pulse() {
        if (this._reduced) return;
        if (this._focusNode >= 0) {
            this._u.uPingDir.value.copy(this._focusDir);
        } else {
            this._facingLocal(this._u.uPingDir.value);
        }
        this._pulseTw.start(this._now, PULSE_MS);
        this._markerPingAt = this._time;
        this._dirty = true;
    }

    playIntro({ duration = 1100 } = {}) {
        this._introPending = true;
        this._introEnded = false;
        if (this._reduced) {
            this._introTweens.forEach((t) => t.finish());
        } else {
            const now = this._now;
            this._revealTw.start(now, Math.max(0, Number(duration) || 0));
            this._scaleTw.start(now, 1400);
            this._bloomTw.start(now, 1200);
            this._fadeTw.start(now, 1000);
            this._fadeLateTw.start(now, 1000, 300);
            this._tracers.resetTrails();
        }
        this._applyIntroValues();
        this._dirty = true;
    }

    // ── Public API: motion ─────────────────────────────

    applyRotation(q) {
        this._spin.quaternion.premultiply(q).normalize();
        if (this._orientTw.active) {
            this._orientTw.stop();
            this._orientPulse = false;
        }
        const now = performance.now();
        const gap = (now - this._lastRotateAt) / 1000;
        if (gap > 0.001 && gap < 0.25) {
            const angle = 2 * Math.acos(Math.min(1, Math.abs(q.w)));
            this._dragRate += (angle / gap - this._dragRate) * 0.35;
        } else if (gap >= 0.25) {
            this._dragRate = 0;
        }
        this._lastRotateAt = now;
        this._dirty = true;
    }

    setAngularVelocity(v) {
        this._vel.copy(v);
        const len = this._vel.length();
        if (len > MAX_OMEGA) this._vel.multiplyScalar(MAX_OMEGA / len);
        // A real impulse takes over from an in-flight focus/reset turn
        if (len > 1e-6 && this._orientTw.active) {
            this._orientTw.stop();
            this._orientPulse = false;
        }
        this._dirty = true;
    }

    setZoom(value) {
        const z = Number(value);
        if (!Number.isFinite(z)) return;
        this._zoomTarget = MathUtils.clamp(z, ZOOM_MIN, ZOOM_MAX);
        if (this._reduced) this._zoomCur = this._zoomTarget;
        this._dirty = true;
    }

    getZoom() {
        return this._zoomTarget;
    }

    zoomBy(factor) {
        const f = Number(factor);
        if (!(f > 0)) return;
        this.setZoom(this._zoomTarget * f);
    }

    resetView() {
        this._zoomTarget = 1;
        if (this._reduced) this._zoomCur = 1;
        this._facingQuat(latLonToVec3(HOME_LAT, HOME_LON, _v0), this._qTo);
        this._startOrient(this._reduced ? 0 : 600, false, 'reset');
        this._dirty = true;
    }

    setPointer(x, y) {
        if (x == null || y == null) {
            this._pointer.set(0, 0);
            return;
        }
        this._pointer.set(
            MathUtils.clamp((x / this._w) * 2 - 1, -1, 1),
            MathUtils.clamp((y / this._h) * 2 - 1, -1, 1),
        );
    }

    pick(x, y, out) {
        out.hit = false;
        _ndc.set((x / this._w) * 2 - 1, -((y / this._h) * 2 - 1));
        this._raycaster.setFromCamera(_ndc, this._camera);
        if (this._raycaster.ray.intersectSphere(this._sphere, _v1) === null) return out;
        _v1.normalize().applyQuaternion(_q1.copy(this._spin.quaternion).invert());
        vec3ToLatLon(_v1, out);
        out.node = nearestDir(this._nodeDirs, _v1);
        out.hit = true;
        return out;
    }

    // ── Public API: settings ───────────────────────────

    setReducedMotion(on) {
        const reduced = !!on;
        if (reduced === this._reduced) return;
        this._reduced = reduced;
        if (reduced) {
            // Land every transition where it was heading
            if (this._frameTw.active) {
                this._frameTw.finish();
                Object.assign(this._frame, this._frameTo);
                this._yaw = 0;
            }
            if (this._orientTw.active) {
                this._orientTw.finish();
                this._spin.quaternion.copy(this._qTo);
                this._orientPulse = false;
            }
            this._introTweens.forEach((t) => { if (t.active) t.finish(); });
            if (this._modeTw.active) { this._modeTw.finish(); Object.assign(this._modeCur, MODES[this._mode]); }
            if (this._markerTw.active) { this._markerTw.finish(); this._markerAlpha = this._markerTo; }
            this._pulseTw.stop();
            this._scanTw.stop();
            this._u.uPingT.value = 0;
            this._u.uScanAmt.value = 0;
            this._zoomCur = this._zoomTarget;
            this._stars.object3D.rotation.set(0, 0, 0);
            this._applyIntroValues();
        } else {
            this._tracers.resetTrails();
        }
        this._dirty = true;
    }

    setOption(name, value) {
        switch (name) {
            case 'bloom': this._opts.bloom = toBool(value); break;
            case 'rings': this._opts.rings = toBool(value); break;
            case 'bezel': this._opts.bezel = toBool(value); break;
            case 'tracers': {
                const on = toBool(value);
                if (on && !this._opts.tracers) this._tracers.resetTrails();
                this._opts.tracers = on;
                break;
            }
            case 'spinRate': {
                const r = Number(value);
                if (Number.isFinite(r)) this._spinRate = MathUtils.clamp(r, 0, 3);
                break;
            }
            default: return;
        }
        this._dirty = true;
    }

    setFrameCap(fps) {
        const f = Number(fps);
        this._cap = Number.isFinite(f) && f > 0 ? f : 0;
    }

    getTelemetry(out) {
        const holding = performance.now() - this._lastRotateAt < 100;
        out.omegaDegPerSec = (holding ? this._dragRate : this._vel.length()) * (180 / Math.PI);
        this._facingLocal(_v2);
        vec3ToLatLon(_v2, this._ll);
        out.facingLat = this._ll.lat;
        out.facingLon = this._ll.lon;
        out.facingNode = nearestDir(this._nodeDirs, _v2);
        out.zoom = this._zoomTarget;
        out.fps = this._fps;
        out.tier = this._tier;
        out.drawCalls = this._drawCalls;
        return out;
    }

    getStats() {
        return this._stats;
    }

    on(event, cb) {
        if (this._listeners[event] && typeof cb === 'function') this._listeners[event].push(cb);
    }

    // ── Public API: lifecycle ──────────────────────────

    start() {
        this._renderer.setAnimationLoop(this._tick);
    }

    stop() {
        this._renderer.setAnimationLoop(null);
        this._tLast = -1;
        this._tLastRender = -1;
    }

    dispose() {
        this.stop();
        this._disposeComposer();
        this._tracers.dispose();
        const seen = new Set();
        this._scene.traverse((o) => {
            if (o.geometry && !seen.has(o.geometry)) { seen.add(o.geometry); o.geometry.dispose(); }
            const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
            mats.forEach((m) => { if (!seen.has(m)) { seen.add(m); m.dispose(); } });
        });
        this._listeners.tier.length = 0;
        this._renderer.dispose();
    }

    // ── Loop ───────────────────────────────────────────

    _tick(t) {
        if (!this._hasViewport || !this._hasFrame) {
            this._tLast = t;
            return;
        }
        if (this._cap > 0 && this._tLastRender >= 0 && t - this._tLastRender < 1000 / this._cap - 1) return;

        const elapsed = this._tLast < 0 ? 0 : Math.max(0, (t - this._tLast) / 1000);
        this._tLast = t;
        const dt = Math.min(elapsed, 0.05);          // motion: clamped, frame-rate independent
        const realDt = Math.min(elapsed, 1);         // tweens: real time, guarded against stalls
        this._now += realDt * 1000;
        const motion = !this._reduced;
        if (motion) this._time += dt;

        const animating = this._update(dt, realDt, motion);
        if (!motion && !this._dirty && !animating) return;

        this._dirty = false;
        this._tLastRender = t;
        if (this._firstRenderAt < 0) this._firstRenderAt = this._now;
        this._render(dt);

        if (elapsed > 0) {
            this._fps += (1 / elapsed - this._fps) * (1 - Math.exp(-elapsed / 0.5));
            this._sampleAdaptive(Math.min(elapsed, 0.25) * 1000);
        }
    }

    _update(dt, uiDt, motion) {
        const now = this._now;
        const U = this._u;
        let animating = false;

        // Frame tween (+ swoop yaw)
        if (this._frameTw.update(now)) {
            const k = this._frameTw.value, a = this._frameFrom, b = this._frameTo, f = this._frame;
            f.cx = a.cx + (b.cx - a.cx) * k;
            f.cy = a.cy + (b.cy - a.cy) * k;
            f.D = a.D + (b.D - a.D) * k;
            this._yaw = this._frameTw.active ? 0.18 * Math.sin(Math.PI * k) * this._swoopSign : 0;
            animating = true;
        }

        // User zoom smoothing (real time, so it stays responsive on slow frames)
        const dz = this._zoomTarget - this._zoomCur;
        if (Math.abs(dz) > 1e-4) {
            this._zoomCur += dz * (1 - Math.exp(-12 * uiDt));
            animating = true;
        } else {
            this._zoomCur = this._zoomTarget;
        }

        // Intro
        const intro = this._introTweens;
        let introRunning = false, introActive = false;
        for (let i = 0; i < intro.length; i++) {
            if (intro[i].update(now)) introRunning = true;
            if (intro[i].active) introActive = true;
        }
        if (introRunning) {
            this._applyIntroValues();
            animating = true;
        }
        if (this._introPending && !introActive && this._revealTw.value >= 1) {
            this._introPending = false;
            this._introEnded = true;
            this._introEndedAt = now;
        }

        // Mode blend
        if (this._modeTw.update(now)) {
            const k = this._modeTw.value, a = this._modeFrom, b = MODES[this._mode], c = this._modeCur;
            c.tracers = a.tracers + (b.tracers - a.tracers) * k;
            c.bloom = a.bloom + (b.bloom - a.bloom) * k;
            c.idle = a.idle + (b.idle - a.idle) * k;
            animating = true;
        }

        // Orientation tween (focus / reset) or free integration
        if (this._orientTw.update(now)) {
            this._spin.quaternion.slerpQuaternions(this._qFrom, this._qTo, this._orientTw.value);
            this._vel.set(0, 0, 0);
            animating = true;
            if (!this._orientTw.active && this._orientPulse) {
                this._orientPulse = false;
                this.pulse();
            }
        } else if (performance.now() - this._lastRotateAt >= 100) {
            const idle = motion ? 0.1 * this._spinRate * this._modeCur.idle : 0;
            _v0.set(0, idle, 0);
            this._vel.lerp(_v0, 1 - Math.pow(0.30, dt));
            let w = this._vel.length();
            if (!motion && w < 0.005) { this._vel.set(0, 0, 0); w = 0; }
            if (w > 1e-5) {
                _q0.setFromAxisAngle(_v0.copy(this._vel).divideScalar(w), w * dt);
                this._spin.quaternion.premultiply(_q0).normalize();
            }
            if (w > 1e-4) animating = true;
        }

        // Scan sweep (home, motion allowed)
        if (motion && this._mode === 'home' && this._introEnded) {
            this._scanClock += dt;
            if (!this._scanTw.active && this._scanClock >= SCAN_EVERY) {
                this._scanClock = 0;
                this._scanTw.start(now, 1600);
            }
        }
        if (this._scanTw.update(now)) {
            U.uScanY.value = 1.3 - 2.6 * this._scanTw.value;
            U.uScanAmt.value = this._scanTw.active ? 0.6 : 0;
        }

        // Pulse
        let swell = 0;
        if (this._pulseTw.update(now)) {
            const tp = this._pulseTw.raw * (PULSE_MS / 1000);
            U.uPingT.value = this._pulseTw.active ? this._pulseTw.raw : 0;
            swell = this._pulseTw.active ? 0.5 * Math.sin(Math.PI * Math.min(tp / 0.7, 1)) : 0;
        }

        // Marker fade
        if (this._markerTw.update(now)) {
            this._markerAlpha = this._markerFrom + (this._markerTo - this._markerFrom) * this._markerTw.value;
            animating = true;
        }

        this._updateLens();
        this._updateParts(dt, motion);

        // Bloom strength = mode base + intro flare + pulse swell
        if (this._bloomPass) {
            const base = this._modeCur.bloom;
            this._bloomPass.strength = base + (BLOOM_INTRO - base) * (1 - this._bloomTw.value) + swell;
            this._bloomPass.enabled = this._opts.bloom;
        }

        return animating;
    }

    _updateLens() {
        const f = this._frame, W = this._w, H = this._h, pr = this._pr, U = this._u;
        const deff = this._deff = this._effectiveDiameter();
        const alpha = Math.atan((deff * TAN_HALF) / H);       // atan(2·r·tanHalf / H), r = deff / 2
        const z = R / Math.sin(alpha);
        const cam = this._camera;
        cam.position.set(Math.sin(this._yaw) * z, 0, Math.cos(this._yaw) * z);
        cam.lookAt(0, 0, 0);
        const far = Math.max(200, z + 80);
        if (cam.far !== far) cam.far = far;
        cam.setViewOffset(W, H, W / 2 - f.cx, H / 2 - f.cy, W, H);   // updates the projection

        U.uPxScale.value = deff / 400;
        U.uRadiusScale.value = (MathUtils.clamp(deff / 160, 1.3, 2.4) * 160) / deff;
        U.uCenterPx.value.set(f.cx * pr, this._dbSize.y - f.cy * pr);
        U.uRadiusPx.value = (deff / 2) * pr;
    }

    _updateParts(dt, motion) {
        const U = this._u, time = this._time;
        U.uTime.value = time;

        // Stars: slow drift + pointer parallax
        const st = this._stars;
        st.uniforms.uDrift.value = time * 0.003;
        if (motion) {
            const k = 1 - Math.exp(-3 * dt), g = st.object3D.rotation;
            g.x += (-this._pointer.y * 0.03 - g.x) * k;
            g.y += (this._pointer.x * 0.03 - g.y) * k;
        }

        // Orbit: precession + satellites
        const orbit = this._orbit;
        orbit.object3D.visible = this._opts.rings;
        orbit.object3D.rotation.y = 0.02 * time;
        orbit.uniforms.uSatAngle.value = time * 0.35;

        // Bezel: faces the camera, slow roll
        const bezel = this._bezel;
        bezel.object3D.visible = this._opts.bezel;
        bezel.object3D.quaternion.copy(this._camera.quaternion);
        bezel.spinner.rotation.z = -0.01 * time;

        // Tracers
        const tr = this._tracers;
        tr.object3D.visible = this._opts.tracers;
        tr.trailGroup.visible = motion;
        const tracersAlpha = this._modeCur.tracers * this._fadeTw.value;
        tr.headUniforms.uOpacity.value = 0.9 * tracersAlpha;
        tr.trailUniforms.uTracersAlpha.value = tracersAlpha;
        if (this._opts.tracers) tr.update(motion ? dt : 0, time, this._deff, motion, motion);

        // Marker
        this._updateMarker(motion);
    }

    _updateMarker(motion) {
        const m = this._marker;
        m.object3D.visible = this._markerAlpha > 0.001;
        if (!m.object3D.visible) return;
        // Dim when the node turns away from the viewer
        const nW = _v1.copy(this._focusDir).applyQuaternion(this._spin.quaternion);
        const view = _v2.copy(this._camera.position).addScaledVector(nW, -R).normalize();
        const vis = this._markerAlpha * (0.25 + 0.75 * smoothstep(-0.2, 0.3, nW.dot(view)));
        let pingAlpha = 0.5, pingScale = 1;
        if (motion) {
            const phase = (((this._time - this._markerPingAt) % MARKER_PING) + MARKER_PING) % MARKER_PING / MARKER_PING;
            pingAlpha = 1 - phase;
            pingScale = 1 + 1.6 * phase;
        }
        m.setOpacity(vis, pingAlpha, pingScale);
        m.object3D.scale.setScalar(MathUtils.clamp(400 / this._deff, 1, 2));
    }

    _render(dt) {
        const r = this._renderer;
        r.info.reset();
        if (this._composer) this._composer.render(dt);
        else r.render(this._scene, this._camera);
        this._drawCalls = r.info.render.calls;
    }

    // ── Internals ──────────────────────────────────────

    _effectiveDiameter() {
        return Math.max(1, this._frame.D * this._zoomCur * this._introScale());
    }

    _introScale() {
        return 0.82 + 0.18 * this._scaleTw.value;
    }

    _applyIntroValues() {
        const U = this._u;
        U.uReveal.value = REVEAL_FROM + (REVEAL_TO - REVEAL_FROM) * this._revealTw.value;
        const fade = this._fadeTw.value, late = this._fadeLateTw.value;
        U.uAtmo.value = fade;
        this._stars.uniforms.uOpacity.value = fade;
        this._orbit.uniforms.uOpacity.value = late;
        this._bezel.setOpacity(late);
    }

    _applyViewport() {
        const T = TIERS[this._tier];
        const pr = Math.min(this._dpr, 2, T.prCap);
        const r = this._renderer;
        if (r.getPixelRatio() !== pr) r.setPixelRatio(pr);
        r.setSize(this._w, this._h, false);
        r.getDrawingBufferSize(this._dbSize);
        this._pr = pr;
        this._camera.aspect = this._w / this._h;

        const U = this._u;
        U.uResolution.value.copy(this._dbSize);
        U.uPixelRatio.value = pr;

        // Star window: always wider than the (lens-shifted) view
        const aspect = this._w / this._h;
        this._stars.uniforms.uAzHalf.value = Math.min(Math.PI * 0.95, Math.atan(2 * aspect * TAN_HALF) + 0.35);
        this._stars.uniforms.uElHalf.value = Math.atan(2 * TAN_HALF) + 0.3;

        if (!T.composer) {
            this._disposeComposer();
        } else {
            const samples = T.msaa && this._w * this._h * pr * pr <= 4.2e6 ? 4 : 0;
            if (!this._composer || this._samples !== samples) {
                this._buildComposer(samples);
            } else {
                this._composer.setPixelRatio(pr);
                this._composer.setSize(this._w, this._h);
            }
        }
        this._dirty = true;
    }

    _buildComposer(samples) {
        this._disposeComposer();
        const rt = new WebGLRenderTarget(1, 1, { type: HalfFloatType, samples });
        const composer = new EffectComposer(this._renderer, rt);
        composer.setPixelRatio(this._pr);
        composer.setSize(this._w, this._h);
        composer.addPass(new RenderPass(this._scene, this._camera));
        this._bloomPass = new UnrealBloomPass(new Vector2(this._w, this._h), MODES.home.bloom, BLOOM_RADIUS, BLOOM_THRESHOLD);
        this._bloomPass.compositeMaterial.uniforms.bloomFactors.value = BLOOM_MIP_WEIGHTS;
        composer.addPass(this._bloomPass);
        this._outputPass = new OutputPass();
        composer.addPass(this._outputPass);
        this._composer = composer;
        this._samples = samples;
    }

    _disposeComposer() {
        if (!this._composer) return;
        this._composer.passes.forEach((p) => p.dispose());
        this._composer.dispose();
        this._composer = null;
        this._bloomPass = null;
        this._outputPass = null;
        this._samples = -1;
    }

    _setTier(tier) {
        this._tier = tier;
        const T = TIERS[tier];
        this._stars.setCount(Math.min(T.stars, this._maxStars));
        this._tracers.setCount(Math.min(T.tracers, this._maxTracers));
        this._applyViewport();
        this._listeners.tier.forEach((cb) => cb({ tier }));
    }

    _sampleAdaptive(ms) {
        if (!this._adaptive || this._reduced || this._tier === 'low' || this._introPending) return;
        if (!this._adaptArmed) {
            // 120 frames after a played intro, otherwise 2 s after the first render
            if (this._introEndedAt >= 0) {
                this._adaptWait = ADAPT_FRAMES;
            } else if (this._firstRenderAt < 0 || this._now - this._firstRenderAt < 2000) {
                return;
            }
            this._adaptArmed = true;
        }
        if (this._adaptWait > 0) {
            this._adaptWait--;
            return;
        }
        const buf = this._adaptBuf, i = this._adaptIdx;
        this._adaptSum += ms - buf[i];
        buf[i] = ms;
        this._adaptIdx = (i + 1) % ADAPT_FRAMES;
        if (this._adaptCount < ADAPT_FRAMES) this._adaptCount++;
        if (this._adaptCount < ADAPT_FRAMES) return;

        const limit = this._cap > 0 ? Math.max(ADAPT_LIMIT_MS, 1000 / this._cap + 8) : ADAPT_LIMIT_MS;
        if (this._adaptSum / ADAPT_FRAMES > limit) {
            const next = TIER_ORDER[TIER_ORDER.indexOf(this._tier) + 1];
            buf.fill(0);
            this._adaptSum = 0;
            this._adaptCount = 0;
            this._adaptIdx = 0;
            this._adaptWait = ADAPT_FRAMES;
            if (next) this._setTier(next);
        }
    }

    _startOrient(duration, pulseOnArrival, kind) {
        this._orientKind = kind;
        this._qFrom.copy(this._spin.quaternion);
        this._vel.set(0, 0, 0);
        if (duration > 0) {
            this._orientPulse = pulseOnArrival;
            this._orientTw.start(this._now, duration);
        } else {
            this._orientTw.stop();
            this._orientPulse = false;
            this._spin.quaternion.copy(this._qTo);
            if (pulseOnArrival) this.pulse();
        }
    }

    _resetOrientation() {
        this._facingQuat(latLonToVec3(HOME_LAT, HOME_LON, _v0), this._spin.quaternion);
    }

    /** Quaternion that turns local direction n to +Z with north up */
    _facingQuat(n, out) {
        const x = _v1.crossVectors(Y_AXIS, n);
        if (x.lengthSq() < 1e-8) x.copy(X_AXIS); else x.normalize();
        const y = _v2.crossVectors(n, x);
        _m0.makeBasis(x, y, n);
        return out.setFromRotationMatrix(_m0).invert();
    }

    /** Local (spin-space) unit direction of the point facing the camera */
    _facingLocal(out) {
        return out.copy(this._camera.position).normalize().applyQuaternion(_q1.copy(this._spin.quaternion).invert());
    }

    _placeMarker(n) {
        const g = this._marker.object3D;
        g.position.copy(n).multiplyScalar(R * 1.002);
        g.quaternion.setFromUnitVectors(_v1.set(0, 0, 1), n);
    }

    _fadeMarker(to, duration, delay) {
        this._markerFrom = this._markerAlpha;
        this._markerTo = to;
        this._markerTw.start(this._now, duration, delay);
        if (!this._markerTw.active) this._markerAlpha = to;
        this._dirty = true;
    }
}
