import './main.css';
import { Vector3 } from 'three';
import { WireframeGlobe } from './globe.js';
import { GlobeControls } from './controls.js';
import { UIController } from './ui.js';
import { renderSection, renderTabs, countTodos, txt } from './panel.js';
import { site, sections, about, projects, demos, contact } from './content.js';

// ── Elements & environment ─────────────────────────────
const html = document.documentElement;
const canvas = document.getElementById('globe-canvas');
const anchor = document.getElementById('globe-anchor');
const panelEl = document.getElementById('panel');
const panelBody = document.getElementById('panel-body');
const panelTitle = document.getElementById('panel-title');
const tabsEl = panelEl.querySelector('.panel-tabs');
const zoomRange = document.getElementById('zoom');
const cursorReadout = document.querySelector('.readout-cursor');

const ui = new UIController();
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const params = new URLSearchParams(location.search);
const forced = ['high', 'medium', 'low'].includes(params.get('quality')) ? params.get('quality') : null;
const quality = forced ?? ((matchMedia('(pointer: fine)').matches && (navigator.hardwareConcurrency || 4) >= 8) ? 'high' : 'medium');
const allContent = { site, about, projects, demos, contact };
const SECTION_BY_ID = new Map(sections.map((s) => [s.id, s]));

// Everything main.js may call on the globe (§2.4). If the build ships a globe
// without this surface, the page runs in static mode instead of throwing.
const GLOBE_API = [
    'setViewport', 'setFrame', 'getFrame', 'setMode', 'focus', 'pulse', 'playIntro',
    'applyRotation', 'setAngularVelocity', 'setZoom', 'getZoom', 'zoomBy', 'resetView',
    'setPointer', 'pick', 'setReducedMotion', 'setOption', 'setFrameCap', 'getTelemetry',
    'getStats', 'on', 'start', 'stop', 'dispose',
];

// ── 1. Globe (WebGL) with static fallback ──────────────
const hasGL = (() => {
    try {
        const c = document.createElement('canvas');
        const gl = c.getContext('webgl2');
        gl?.getExtension('WEBGL_lose_context')?.loseContext();
        return !!gl;
    } catch {
        return false;
    }
})();

let globe = null;
if (hasGL) {
    let g = null;
    try {
        g = new WireframeGlobe(canvas, {
            quality, adaptive: !forced, reducedMotion: reduced.matches, intro: html.dataset.phase === 'boot',
        });
        const missing = GLOBE_API.filter((m) => typeof g[m] !== 'function');
        if (missing.length) throw new Error(`globe API mismatch (${missing.join(', ')})`);
        globe = g;
    } catch (err) {
        console.warn('[globe] static mode:', err?.message ?? err);
        try { g?.dispose?.(); } catch { /* already broken */ }
        globe = null;
    }
}

/** Run a globe call; a runtime fault drops the page to static mode instead of breaking the UI. */
function withGlobe(fn) {
    if (!globe) return undefined;
    try {
        return fn(globe);
    } catch (err) {
        degrade(err);
        return undefined;
    }
}

let controls = null;
let telTimer = 0;

function degrade(err) {
    if (!globe) return;
    console.warn('[globe] runtime fault, static mode:', err);
    const g = globe;
    globe = null;
    clearInterval(telTimer);
    telTimer = 0;
    try { controls?.dispose(); } catch { /* ignore */ }
    try { g.stop(); g.dispose(); } catch { /* ignore */ }
    enterStaticMode();
    ui.log('RENDERER FAULT → STATIC MODE');
}

function enterStaticMode() {
    html.classList.add('no-webgl');
    anchor.removeAttribute('tabindex');
    anchor.setAttribute('aria-label', 'Globe visual offline');
    ui.setOffline();
    // A Globe Lab that is already on screen loses its controls in place
    const lab = document.getElementById('lab');
    if (lab) {
        lab.classList.add('is-offline');
        for (const c of lab.querySelectorAll('button, input')) c.disabled = true;
        const stats = document.getElementById('lab-stats');
        if (stats) stats.textContent = 'RENDERER OFFLINE · STATIC MODE';
    }
}

if (!globe) enterStaticMode();
if (params.has('debug')) window.__ag = { get globe() { return globe; }, ui };

// ── 2. Frame sync: CSS sizes #globe-anchor, the globe follows ──
function measureFrame() {
    const r = anchor.getBoundingClientRect();
    const cs = getComputedStyle(anchor);
    const num = (name, fallback) => {
        const v = parseFloat(cs.getPropertyValue(name));
        return Number.isFinite(v) ? v : fallback;
    };
    const fit = num('--globe-fit', 0.64);
    return {
        cx: r.left + r.width / 2,
        cy: r.top + r.height / 2,
        diameter: Math.max(24, Math.min(r.width, r.height) * fit),
        bezel: num('--globe-bezel', 0) > 0,
        fps: num('--globe-fps', 0),
    };
}

function syncFrame(duration = 0, swoop = false) {
    if (!globe) return;
    const f = measureFrame();
    withGlobe((g) => {
        g.setFrame({ cx: f.cx, cy: f.cy, diameter: f.diameter }, { duration, swoop });
        g.setOption('bezel', f.bezel);
        g.setFrameCap(f.fps);
    });
}

function syncViewport() {
    withGlobe((g) => g.setViewport(canvas.clientWidth, canvas.clientHeight, window.devicePixelRatio || 1));
    syncFrame(0);
}

// ── 3. Globe Lab state (persisted per browser) ─────────
const LAB_KEY = 'ag-lab';
const LAB_NAMES = { bloom: 'BLOOM', rings: 'ORBITAL RING', tracers: 'SURFACE TRACKS' };
const labState = (() => {
    const s = { bloom: true, rings: true, tracers: true, spinRate: 1 };
    try {
        const saved = JSON.parse(localStorage.getItem(LAB_KEY) || 'null');
        if (saved && typeof saved === 'object') {
            for (const k of ['bloom', 'rings', 'tracers']) if (typeof saved[k] === 'boolean') s[k] = saved[k];
            if (Number.isFinite(saved.spinRate)) s.spinRate = Math.min(Math.max(saved.spinRate, 0), 3);
        }
    } catch { /* storage blocked or corrupt: defaults */ }
    return s;
})();

function saveLab() {
    try { localStorage.setItem(LAB_KEY, JSON.stringify(labState)); } catch { /* storage blocked */ }
}

function applyLab() {
    withGlobe((g) => {
        g.setOption('bloom', labState.bloom);
        g.setOption('rings', labState.rings);
        g.setOption('tracers', labState.tracers);
        g.setOption('spinRate', labState.spinRate);
    });
}

const impulse = new Vector3();
let spinLogTimer = 0;

function onLab(action, value) {
    switch (action) {
        case 'bloom':
        case 'rings':
        case 'tracers':
            labState[action] = !!value;
            withGlobe((g) => g.setOption(action, !!value));
            ui.log(`${LAB_NAMES[action]} ${value ? 'ON' : 'OFF'}`);
            break;
        case 'spinRate':
            labState.spinRate = Math.min(Math.max(Number(value) || 0, 0), 3);
            withGlobe((g) => g.setOption('spinRate', labState.spinRate));
            clearTimeout(spinLogTimer);
            spinLogTimer = setTimeout(() => ui.log(`SPIN RATE ${labState.spinRate.toFixed(1)}×`), 400);
            break;
        case 'impulse':
            withGlobe((g) => g.setAngularVelocity(impulse.set(0.4, 2.2, 0)));
            ui.log('IMPULSE APPLIED');
            return;
        case 'reset':
            withGlobe((g) => g.resetView());
            ui.setZoomUI(1);
            ui.log('VIEW RESET');
            return;
        default:
            return;
    }
    saveLab();
}

// ── 4. Router ──────────────────────────────────────────
const state = { section: null, item: null };
let lastOpener = null;

const ctx = {
    navigate: (hash) => navigate(hash),
    onLab,
    labState,
    log: (msg) => ui.log(msg),
    announce: (msg) => ui.announce(msg),
    get webgl() { return !!globe; },
};

function parse(hash) {
    let raw = '';
    try { raw = decodeURIComponent(hash.replace(/^#\/?/, '')); } catch { return { section: null, item: null, valid: false }; }
    if (!raw) return { section: null, item: null, valid: true };
    const [section, item] = raw.split('/');
    if (!SECTION_BY_ID.has(section)) return { section: null, item: null, valid: false };
    return { section, item: item || null, valid: true };
}

const bareUrl = () => location.pathname + location.search;

function navigate(hash, { replace = false } = {}) {
    const url = hash || bareUrl();
    if (!replace && (hash || '') === location.hash) {
        applyRoute();
        return;
    }
    const entry = { ag: true, fromHome: replace ? !!history.state?.fromHome : state.section == null };
    history[replace ? 'replaceState' : 'pushState'](entry, '', url);
    applyRoute();
}

/** Escape / close button / re-click of the active command. */
function closeFile() {
    if (!state.section) return;
    if (history.state?.fromHome) history.back();
    else navigate('', { replace: true });
}

function stepFile(dir) {
    if (!state.section) return;
    const i = sections.findIndex((s) => s.id === state.section);
    const n = sections.length;
    navigate(`#${sections[(i + dir + n) % n].id}`);
}

const isShown = (el) => !!el && el.isConnected && el.getClientRects().length > 0;

function applyRoute({ initial = false, fromHistory = false } = {}) {
    // 1. Parse
    const route = parse(location.hash);
    if (!route.valid) {
        history.replaceState(null, '', bareUrl());
        ui.log('NO SUCH FILE');
    }
    const { section } = route;
    let { item } = route;
    if (!initial && section === state.section && item === state.item) return;
    const prev = state.section;
    const prevItem = state.item;
    const sec = section ? SECTION_BY_ID.get(section) : null;
    const hadFocusInPanel = panelEl.contains(document.activeElement);
    state.section = section;
    state.item = item;

    // 2. View state
    ui.setView(section, { switching: !!(prev && section) });

    // 3. Render the file
    let res = null;
    if (sec) {
        res = renderSection(panelBody, section, item, ctx);
        if (res.notFound) {
            history.replaceState(history.state, '', `#${section}`);
            item = state.item = null;
            ui.log('FILE NOT FOUND');
        }
    }

    // 4. Glide the globe to its new slot (the attribute change above forces layout here)
    const still = initial || reduced.matches;
    const dur = still ? 0 : (prev && section ? 0 : (prev || section ? 1100 : 0));
    syncFrame(dur, dur > 0);

    // 5. Mode
    withGlobe((g) => g.setMode(section ? 'section' : 'home'));

    // 6. Target lock + header
    if (sec && section !== prev) {
        const r = withGlobe((g) => g.focus(sec.target, { duration: still ? 0 : (prev ? 900 : 1100), pulse: !initial })) ?? null;
        ui.setPanelHeader(sec, r, res.todoCount, { switching: !!prev });
    } else if (sec) {
        ui.setPending(res.todoCount);
    }

    // 7. Title
    document.title = sec ? `${sec.label} — ${site.name}` : site.name;

    // 8. Focus (never on the initial deep load)
    if (!initial) {
        if (sec) {
            const lost = !document.activeElement || document.activeElement === document.body ||
                !document.activeElement.isConnected;
            if (!fromHistory) {
                const back = section === prev && prevItem && !item
                    ? panelBody.querySelector(`[data-item="${CSS.escape(prevItem)}"]`) : null;
                (res.focusEl ?? back ?? panelTitle).focus({ preventScroll: true });
            } else if (lost || hadFocusInPanel) {
                (res.focusEl ?? panelTitle).focus({ preventScroll: true });
            }
        } else if (prev) {
            const active = document.activeElement;
            if (hadFocusInPanel || !active || active === document.body || lastOpener === active) {
                const opener = isShown(lastOpener) ? lastOpener : document.querySelector(`#nav .cmd[data-section="${prev}"]`);
                opener?.focus({ preventScroll: true });
            }
            lastOpener = null;
        }
    }

    // 9. Announce + log
    if (section !== prev) {
        const was = prev ? SECTION_BY_ID.get(prev) : null;
        if (!initial) ui.announce(sec ? `${sec.label} opened` : 'Files closed');
        if (sec) ui.log(`FILE ${sec.index} OPEN · ${sec.file}`);
        else if (was) ui.log(`FILE ${was.index} CLOSED`);
    }
    if (sec && item && item !== prevItem) ui.log(`${item.toUpperCase()} BRIEF OPEN`);
}

// ── 5. Commands, tabs, footer, close, skip link ────────
document.getElementById('nav').addEventListener('click', (e) => {
    const btn = e.target.closest('.cmd[data-section]');
    if (!btn) return;
    if (state.section === btn.dataset.section) {
        lastOpener = btn;
        closeFile();
        return;
    }
    lastOpener = btn;
    navigate(`#${btn.dataset.section}`);
});

renderTabs(tabsEl, sections, (id, btn) => {
    lastOpener = btn;
    navigate(`#${id}`);
});

for (const btn of panelEl.querySelectorAll('.foot-btn')) {
    btn.addEventListener('click', () => stepFile(Number(btn.dataset.step)));
}
panelEl.querySelector('.panel-close').addEventListener('click', closeFile);

document.querySelector('.skip-link').addEventListener('click', (e) => {
    e.preventDefault();
    const pool = state.section ? '.panel-tabs .tab, #nav .cmd' : '#nav .cmd';
    [...document.querySelectorAll(pool)].find(isShown)?.focus();
});

// ── 6. Keyboard ────────────────────────────────────────
document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.isComposing || e.altKey || e.ctrlKey || e.metaKey) return;
    const t = e.target;
    const editing = t instanceof Element && t.matches('input, textarea, select, [contenteditable]:not([contenteditable="false"])');

    if (e.key === 'Escape') {
        if (editing && !t.matches('input[type="range"]')) return;
        if (!state.section) return;
        e.preventDefault();
        if (state.item) navigate(`#${state.section}`);
        else closeFile();
        return;
    }
    if (editing) return;

    if (e.key >= '1' && e.key <= '9' && e.key.length === 1) {
        const sec = sections[Number(e.key) - 1];
        if (!sec) return;
        e.preventDefault();
        lastOpener = null;
        navigate(`#${sec.id}`);
    } else if ((e.key === '[' || e.key === ']') && state.section) {
        e.preventDefault();
        stepFile(e.key === ']' ? 1 : -1);
    }
});

window.addEventListener('popstate', () => applyRoute({ fromHistory: true }));
window.addEventListener('hashchange', () => applyRoute({ fromHistory: true }));

// ── 7. Input + telemetry ───────────────────────────────
let pointer = null;
let lastDragLog = 0;
const tel = { omegaDegPerSec: 0, facingLat: 0, facingLon: 0, facingNode: 0, zoom: 1, fps: 0, tier: quality, drawCalls: 0 };
const pk = { hit: false, lat: 0, lon: 0, node: 0 };

if (globe) {
    try {
        controls = new GlobeControls(canvas, {
            keyTarget: anchor,
            onRotate: (q) => withGlobe((g) => g.applyRotation(q)),
            onVelocity: (v) => withGlobe((g) => g.setAngularVelocity(v)),
            onZoom: (f) => {
                withGlobe((g) => g.zoomBy(f));
                if (globe) ui.setZoomUI(globe.getZoom());
            },
            onReset: () => {
                withGlobe((g) => g.resetView());
                ui.setZoomUI(1);
                ui.log('VIEW RESET');
            },
            onPointer: (x, y) => {
                pointer = x == null ? null : { x, y };
                withGlobe((g) => g.setPointer(x, y));
                if (!pointer) ui.setCursor(false);
            },
            onInteract: (kind) => {
                html.dataset.interacted = '';
                if (kind === 'drag' && performance.now() - lastDragLog > 3000) {
                    lastDragLog = performance.now();
                    ui.log('MANUAL ATTITUDE INPUT');
                }
                if (kind === 'zoom' && globe) ui.log(`MAG ${globe.getZoom().toFixed(2)}×`);
            },
        });
    } catch (err) {
        console.warn('[controls] unavailable:', err?.message ?? err);
        controls = null;
    }
}

zoomRange?.addEventListener('input', () => {
    const z = Number(zoomRange.value) / 100;
    withGlobe((g) => g.setZoom(z));
    ui.setZoomUI(z);
});

function telemetryTick() {
    if (!globe) return;
    withGlobe((g) => g.getTelemetry(tel));
    ui.updateTelemetry(tel);
    if (pointer && cursorReadout?.offsetParent) {
        withGlobe((g) => g.pick(pointer.x, pointer.y, pk));
        ui.setCursor(pk.hit, pk.lat, pk.lon);
    }
}

function startTelemetry() {
    if (!globe || telTimer) return;
    telTimer = setInterval(telemetryTick, 100);
}

document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        withGlobe((g) => g.stop());
        clearInterval(telTimer);
        telTimer = 0;
    } else {
        withGlobe((g) => g.start());
        startTelemetry();
    }
});

reduced.addEventListener('change', (e) => withGlobe((g) => g.setReducedMotion(e.matches)));

// ── 8. Content that lives outside the panel ────────────
const tagline = document.getElementById('tagline');
tagline.replaceChildren(txt(site.tagline));
if (typeof site.metaDescription === 'string') {
    document.querySelector('meta[name="description"]')?.setAttribute('content', site.metaDescription);
}

// ── 9. Init ────────────────────────────────────────────
const todoTotal = countTodos(allContent);
const stats = withGlobe((g) => g.getStats()) ?? null;

ui.startClocks();
ui.log(`SESSION OPEN · ${site.callsign}`);
ui.log(globe ? `RENDERER WEBGL2 · ${quality.toUpperCase()}` : 'RENDERER OFFLINE · STATIC MODE');
if (stats) ui.log(`MESH ${stats.nodes} NODES / ${stats.edges} EDGES`);
ui.log(todoTotal ? `DOSSIER · ${todoTotal} FIELDS AWAITING DATA` : 'DOSSIER · ALL FIELDS LOADED');

withGlobe((g) => g.setViewport(canvas.clientWidth, canvas.clientHeight, window.devicePixelRatio || 1));
applyRoute({ initial: true });
applyLab();
withGlobe((g) => g.start());

if (globe) {
    new ResizeObserver(syncViewport).observe(canvas);
    new ResizeObserver(() => syncFrame(0)).observe(anchor);
    window.addEventListener('resize', syncViewport);
    withGlobe((g) => g.on('tier', ({ tier }) => ui.log(`RENDER TIER → ${String(tier).toUpperCase()}`)));
    startTelemetry();
    telemetryTick();
}

if (html.dataset.phase === 'boot') {
    ui.runBoot({
        webgl: !!globe,
        tier: quality,
        todoCount: todoTotal,
        stats,
        onReveal: () => withGlobe((g) => g.playIntro()),
        onDone: () => {},
    });
} else {
    html.dataset.phase = 'ready';
}

if (import.meta.env.DEV) console.info(`[content] ${todoTotal} placeholder fields remain in src/content.js`);
