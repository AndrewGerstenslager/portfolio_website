import './main.css';
import { UIController } from './ui.js';
import { renderSection, renderTabs, countTodos, sealedSections, txt, isReal, DRAFTS } from './panel.js';
import { site, sections, about, projects, demos, contact } from './content.js';

// ── Elements & environment ─────────────────────────────
const html = document.documentElement;
const canvas = document.getElementById('globe-canvas');
const anchor = document.getElementById('globe-anchor');
const panelEl = document.getElementById('panel');
const panelBody = document.getElementById('panel-body');
const panelTitle = document.getElementById('panel-title');
const tabsEl = panelEl.querySelector('.panel-tabs');
const navEl = document.getElementById('nav');
const zoomRange = document.getElementById('zoom');
const cursorReadout = document.querySelector('.readout-cursor');

const ui = new UIController();
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const finePointer = matchMedia('(hover: hover) and (pointer: fine)');
const params = new URLSearchParams(location.search);
const forced = ['high', 'medium', 'low'].includes(params.get('quality')) ? params.get('quality') : null;
const quality = forced ?? ((matchMedia('(pointer: fine)').matches && (navigator.hardwareConcurrency || 4) >= 8) ? 'high' : 'medium');
const allContent = { site, about, projects, demos, contact };
const SECTION_BY_ID = new Map(sections.map((s) => [s.id, s]));
const booting = html.dataset.phase === 'boot';

// Everything main.js may call on the globe (§2.4). If the build ships a globe
// without this surface, the page runs in static mode instead of throwing.
const GLOBE_API = [
    'setViewport', 'setFrame', 'getFrame', 'setMode', 'focus', 'pulse', 'playIntro',
    'applyRotation', 'setAngularVelocity', 'setZoom', 'getZoom', 'zoomBy', 'resetView',
    'setPointer', 'pick', 'setReducedMotion', 'setOption', 'setFrameCap', 'getTelemetry',
    'getStats', 'on', 'start', 'stop', 'dispose',
];

// ── 1. Globe (WebGL, loaded after the text) with static fallback ──
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

// Three.js + bloom are ~450 KB, so they arrive as their own chunk while the HUD paints.
const globeModules = hasGL ? Promise.all([import('./globe.js'), import('./controls.js')]) : null;

let globe = null;
let staticMode = false;
let controls = null;
let telTimer = 0;
let introRequested = false;
let glLost = false;

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
    ui.log('GL FAULT → STATIC MODE');
}

function enterStaticMode() {
    if (staticMode) return;
    staticMode = true;
    html.classList.add('no-webgl');
    anchor.removeAttribute('tabindex');
    anchor.setAttribute('aria-label', 'Globe visual offline');
    ui.setOffline();
    ui.setTarget(null);
    ui.setTag(null);
    // A Globe Lab that is already on screen loses its controls in place
    const lab = document.getElementById('lab');
    if (lab) {
        lab.classList.add('is-offline');
        for (const c of lab.querySelectorAll('button:not([data-opt="keys"]), input')) c.disabled = true;
        const stats = document.getElementById('lab-stats');
        if (stats) stats.textContent = 'RENDERER OFFLINE ·\u00a0STATIC MODE';
    }
}

if (!hasGL) enterStaticMode();
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
    const s = { bloom: true, rings: true, tracers: true, keys: true, spinRate: 1 };
    try {
        const saved = JSON.parse(localStorage.getItem(LAB_KEY) || 'null');
        if (saved && typeof saved === 'object') {
            for (const k of ['bloom', 'rings', 'tracers', 'keys']) if (typeof saved[k] === 'boolean') s[k] = saved[k];
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

const IMPULSE = { x: 0.4, y: 2.2, z: 0 };   // rad/s; the globe copies x/y/z
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
        case 'keys':
            labState.keys = !!value;
            ui.log(`KEY SHORTCUTS ${value ? 'ON' : 'OFF'}`);
            break;
        case 'spinRate':
            labState.spinRate = Math.min(Math.max(Number(value) || 0, 0), 3);
            withGlobe((g) => g.setOption('spinRate', labState.spinRate));
            clearTimeout(spinLogTimer);
            spinLogTimer = setTimeout(() => ui.log(`SPIN RATE ${labState.spinRate.toFixed(1)}×`), 400);
            break;
        case 'impulse':
            withGlobe((g) => g.setAngularVelocity(IMPULSE));
            ui.log('IMPULSE APPLIED');
            return;
        case 'reset':
            resetView();
            return;
        default:
            return;
    }
    saveLab();
}

// Inside a file, "reset" re-locks onto the file's target instead of turning it away
let hotOpenAt = -Infinity;
function resetView() {
    // The dblclick that completes a hot-sector click has already opened the file
    if (performance.now() - hotOpenAt < 600) return;
    const sec = state.section ? SECTION_BY_ID.get(state.section) : null;
    withGlobe((g) => {
        if (sec) { g.setZoom(1); g.focus(sec.target, { pulse: false }); }
        else g.resetView();
    });
    ui.setZoomUI(1);
    ui.log('VIEW RESET');
}

// ── 4. Router ──────────────────────────────────────────
const state = { section: null, item: null };
let lastOpener = null;
let keyboardNav = false;   // last input was a key press (decides where focus lands)
let routing = false;       // true while applyRoute moves focus (suppresses the nav preview)

const ctx = {
    navigate: (hash) => navigate(hash),
    onLab,
    labState,
    log: (msg) => ui.log(msg),
    announce: (msg) => ui.announce(msg),
    // The globe may still be loading; only a failed or missing renderer counts as offline
    get webgl() { return hasGL && !staticMode; },
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

function focusQuietly(el) {
    routing = true;
    try { el?.focus({ preventScroll: true }); } finally { routing = false; }
}

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
    endPreview(false);
    ui.setTag(null);

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
    const pending = DRAFTS && res ? res.todoCount : 0;

    // 4. Glide the globe to its new slot (the attribute change above forces layout here)
    const still = initial || reduced.matches;
    const dur = still ? 0 : (prev && section ? 0 : (prev || section ? 1100 : 0));
    syncFrame(dur, dur > 0);

    // 5. Mode
    withGlobe((g) => g.setMode(section ? 'section' : 'home'));

    // 6. Target lock + header
    if (sec && section !== prev) {
        const r = withGlobe((g) => g.focus(sec.target, { duration: still ? 0 : (prev ? 900 : 1100), pulse: !initial })) ?? null;
        ui.setPanelHeader(sec, r, pending, { switching: !!prev });
    } else if (sec) {
        ui.setPending(pending);
    }

    // 7. Title
    document.title = sec ? `${sec.label} — ${site.name}` : site.name;

    // 8. Focus (never on the initial deep load). Pointer users land on the quiet title;
    //    keyboard users go straight to the item's first control.
    if (!initial) {
        if (sec) {
            const lost = !document.activeElement || document.activeElement === document.body ||
                !document.activeElement.isConnected;
            const itemFocus = keyboardNav ? res.focusEl : null;
            if (!fromHistory) {
                const back = section === prev && prevItem && !item
                    ? panelBody.querySelector(`[data-item="${CSS.escape(prevItem)}"]`) : null;
                focusQuietly(itemFocus ?? (keyboardNav ? back : null) ?? panelTitle);
            } else if (lost || hadFocusInPanel) {
                focusQuietly(itemFocus ?? panelTitle);
            }
        } else if (prev) {
            const active = document.activeElement;
            if (hadFocusInPanel || !active || active === document.body || lastOpener === active) {
                const opener = isShown(lastOpener) ? lastOpener : document.querySelector(`#nav .cmd[data-section="${prev}"]`);
                focusQuietly(opener);
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
navEl.addEventListener('click', (e) => {
    const btn = e.target.closest('.cmd[data-section]');
    if (!btn) return;
    endPreview(false);
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

// ── 6. Nav → globe preview (home, hover-capable pointers) ──
// Hovering or keyboard-focusing a command for 150 ms turns the globe toward that
// file's sector and shows the marker; leaving releases it and the idle spin resumes.
const PREVIEW_DELAY = 150;
let previewTimer = 0;
let previewId = null;

const canPreview = () => !!globe && !state.section && finePointer.matches && !reduced.matches &&
    html.dataset.phase === 'ready';

function schedulePreview(id) {
    clearTimeout(previewTimer);
    if (!canPreview()) return;
    previewTimer = setTimeout(() => {
        if (!canPreview() || previewId === id) return;
        const sec = SECTION_BY_ID.get(id);
        if (!sec) return;
        previewId = id;
        withGlobe((g) => g.focus(sec.target, { duration: 1000, pulse: false }));
        ui.setPreview(id);
    }, PREVIEW_DELAY);
}

/** release = hand the globe back to its idle spin (skipped when a route takes over). */
function endPreview(release = true) {
    clearTimeout(previewTimer);
    previewTimer = 0;
    if (previewId == null) return;
    previewId = null;
    ui.setPreview(null);
    if (release && !state.section) withGlobe((g) => g.focus(null));
}

navEl.addEventListener('pointerover', (e) => {
    const btn = e.target.closest('.cmd[data-section]');
    if (btn && e.pointerType === 'mouse') schedulePreview(btn.dataset.section);
});
navEl.addEventListener('pointerout', (e) => {
    const btn = e.target.closest('.cmd[data-section]');
    if (!btn || btn.contains(e.relatedTarget)) return;
    // Moving straight onto the next command keeps the globe busy instead of bouncing home
    if (e.relatedTarget?.closest?.('#nav .cmd[data-section]')) return;
    if (btn !== document.activeElement || !btn.matches(':focus-visible')) endPreview();
});
// A press only cancels a pending preview; an active one is released by pointerout/focusout,
// or handed over to the route by the click handler
navEl.addEventListener('pointerdown', () => { clearTimeout(previewTimer); previewTimer = 0; });
navEl.addEventListener('focusin', (e) => {
    const btn = e.target.closest('.cmd[data-section]');
    if (btn && !routing && btn.matches(':focus-visible')) schedulePreview(btn.dataset.section);
});
navEl.addEventListener('focusout', (e) => {
    if (!navEl.contains(e.relatedTarget)) endPreview();
});

// ── 7. Keyboard ────────────────────────────────────────
document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.isComposing || e.metaKey) return;
    // AltGr (Win: Ctrl+Alt) / Option (mac) is how many layouts type [ and ]: match the produced char
    if ((e.altKey || e.ctrlKey) && e.key !== '[' && e.key !== ']') return;
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
    if (!labState.keys) return;   // character-key shortcuts can be turned off (WCAG 2.1.4)

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
document.addEventListener('keydown', () => { keyboardNav = true; }, true);
document.addEventListener('pointerdown', () => { keyboardNav = false; }, true);

window.addEventListener('popstate', () => applyRoute({ fromHistory: true }));
window.addEventListener('hashchange', () => applyRoute({ fromHistory: true }));

// ── 8. Input + telemetry ───────────────────────────────
let pointer = null;
let lastDragLog = 0;
const tel = { omegaDegPerSec: 0, facingLat: 0, facingLon: 0, facingNode: 0, zoom: 1, fps: 0, tier: quality, drawCalls: 0 };
const pk = { hit: false, lat: 0, lon: 0, node: 0 };
const pad3 = (n) => String(n).padStart(3, '0');
const fmtLL = (lat, lon) => `${Math.abs(lat).toFixed(1).padStart(4, '0')}°${lat < 0 ? 'S' : 'N'} ${Math.abs(lon).toFixed(1).padStart(5, '0')}°${lon < 0 ? 'W' : 'E'}`;

// Cursor tag: over a file's sector (≤ 9° from its marker node) the tag names it and a click opens it
const HOT_COS = Math.cos(9 * Math.PI / 180);
const unit = (lat, lon) => {
    const a = lat * Math.PI / 180, b = lon * Math.PI / 180;
    return [Math.cos(a) * Math.sin(b), Math.sin(a), Math.cos(a) * Math.cos(b)];
};
let TARGET_DIRS = sections.map((s) => ({ s, d: unit(s.target.lat, s.target.lon) }));
let hotSection = null;
let press = null;

function sectionAt(lat, lon) {
    const [x, y, z] = unit(lat, lon);
    for (const { s, d } of TARGET_DIRS) if (x * d[0] + y * d[1] + z * d[2] >= HOT_COS) return s;
    return null;
}

function setHot(sec) {
    if (hotSection === sec) return;
    hotSection = sec;
    if (sec) html.dataset.hot = sec.id;
    else delete html.dataset.hot;
}

/** Uses the pick telemetryTick just made. */
function updateCursorTag() {
    const tagOn = pointer && !press?.moved && !state.section && finePointer.matches;
    if (!tagOn || !pk.hit) {
        ui.setTag(null);
        setHot(null);
        return;
    }
    const sec = sectionAt(pk.lat, pk.lon);
    setHot(sec);
    ui.setTag(sec ? `${sec.index} ${sec.file} · OPEN ►` : `NODE ${pad3(pk.node)} · ${fmtLL(pk.lat, pk.lon)}`, !!sec);
}

function attachCursorTag() {
    canvas.addEventListener('pointermove', (e) => {
        if (e.pointerType !== 'mouse') return;
        ui.moveTag(e.clientX, e.clientY);
        if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 4) press.moved = true;
    });
    canvas.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'mouse' && e.button === 0) press = { x: e.clientX, y: e.clientY, moved: false };
    });
    canvas.addEventListener('pointerup', (e) => {
        const p = press;
        press = null;
        if (!p || p.moved || e.pointerType !== 'mouse' || state.section) return;
        const sec = hotSection;
        if (!sec) return;
        keyboardNav = false;
        lastOpener = null;
        hotOpenAt = performance.now();
        navigate(`#${sec.id}`);
    });
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
    if (pointer) {
        withGlobe((g) => g.pick(pointer.x, pointer.y, pk));
        if (cursorReadout?.offsetParent) ui.setCursor(pk.hit, pk.lat, pk.lon);
    } else {
        pk.hit = false;
    }
    updateCursorTag();
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

function attachControls(GlobeControls) {
    try {
        controls = new GlobeControls(canvas, {
            keyTarget: anchor,
            onRotate: (q) => withGlobe((g) => g.applyRotation(q)),
            onVelocity: (v) => withGlobe((g) => g.setAngularVelocity(v)),
            onZoom: (f) => {
                withGlobe((g) => g.zoomBy(f));
                if (globe) ui.setZoomUI(globe.getZoom());
            },
            onReset: resetView,
            onPointer: (x, y) => {
                pointer = x == null ? null : { x, y };
                withGlobe((g) => g.setPointer(x, y));
                if (!pointer) {
                    ui.setCursor(false);
                    ui.setTag(null);
                    setHot(null);
                }
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

// ── 9. Content that lives outside the panel ────────────
const tagline = document.getElementById('tagline');
if (DRAFTS || isReal(site.tagline)) tagline.replaceChildren(txt(site.tagline));
if (isReal(site.metaDescription)) {
    document.querySelector('meta[name="description"]')?.setAttribute('content', site.metaDescription);
}

// ── 10. Globe attach (runs whenever the module chunk lands) ──
let rendererReady;
const rendererLine = new Promise((r) => { rendererReady = r; });

function attachGlobe([{ WireframeGlobe }, { GlobeControls }]) {
    let g = null;
    try {
        g = new WireframeGlobe(canvas, {
            quality, adaptive: !forced, reducedMotion: reduced.matches, intro: booting,
        });
        const missing = GLOBE_API.filter((m) => typeof g[m] !== 'function');
        if (missing.length) throw new Error(`globe API mismatch (${missing.join(', ')})`);
        globe = g;
    } catch (err) {
        console.warn('[globe] static mode:', err?.message ?? err);
        try { g?.dispose?.(); } catch { /* already broken */ }
        globe = null;
        enterStaticMode();
        ui.log('VISUAL OFFLINE · STATIC');
        rendererReady(false);
        return;
    }

    attachControls(GlobeControls);
    if (finePointer.matches) attachCursorTag();

    // Targets snap to the nearest mesh node; the file index and hot zones follow the marker
    const nodes = new Map(sections.map((s) => [s.id, withGlobe((gl) => gl.locate?.(s.target)) ?? s.target]));
    TARGET_DIRS = sections.map((s) => ({ s, d: unit(nodes.get(s.id).lat, nodes.get(s.id).lon) }));
    ui.setFileSectors(nodes);

    // Catch the globe up with whatever the router already did
    withGlobe((gl) => gl.setViewport(canvas.clientWidth, canvas.clientHeight, window.devicePixelRatio || 1));
    syncFrame(0);
    withGlobe((gl) => gl.setMode(state.section ? 'section' : 'home'));
    const sec = state.section ? SECTION_BY_ID.get(state.section) : null;
    if (sec) ui.setTarget(withGlobe((gl) => gl.focus(sec.target, { duration: 0, pulse: false })) ?? null);
    applyLab();
    const z = Number(zoomRange?.value) / 100;
    if (Number.isFinite(z) && z !== 1) withGlobe((gl) => gl.setZoom(z));
    withGlobe((gl) => gl.start());
    if (introRequested) withGlobe((gl) => gl.playIntro());
    if (!globe) return;   // a fault above already switched to static mode

    new ResizeObserver(syncViewport).observe(canvas);
    new ResizeObserver(() => syncFrame(0)).observe(anchor);
    window.addEventListener('resize', syncViewport);
    // A DPR-only change (window dragged to a display with a different scale) fires neither
    // 'resize' nor the content-box ResizeObserver
    const watchDpr = () => matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`)
        .addEventListener('change', () => { syncViewport(); watchDpr(); }, { once: true });
    watchDpr();

    // Three swallows context loss (render() just no-ops). If the browser never restores
    // the context (GPU blocklisted, memory reclaim), fall back to the static plate.
    let lostTimer = 0;
    const armLostTimer = () => {
        clearTimeout(lostTimer);
        lostTimer = document.hidden ? 0 : setTimeout(() => degrade(new Error('CONTEXT_LOST')), 5000);
    };
    canvas.addEventListener('webglcontextlost', () => { if (globe) { glLost = true; armLostTimer(); } });
    canvas.addEventListener('webglcontextrestored', () => { glLost = false; clearTimeout(lostTimer); lostTimer = 0; });
    document.addEventListener('visibilitychange', () => { if (glLost && globe) armLostTimer(); });
    withGlobe((gl) => gl.on('tier', ({ tier }) => ui.log(`RENDER TIER → ${String(tier).toUpperCase()}`)));
    startTelemetry();
    telemetryTick();

    const stats = withGlobe((gl) => gl.getStats()) ?? null;
    ui.log(`WEBGL2 · ${quality.toUpperCase()} TIER`);
    if (stats) ui.log(`MESH ${stats.nodes}N / ${stats.edges}E`);
    rendererReady(stats ?? true);
}

// ── 11. Init ───────────────────────────────────────────
const todoTotal = countTodos(allContent);
const sealed = sealedSections().length;
const dossier = DRAFTS
    ? (todoTotal ? `${todoTotal} FIELDS AWAITING DATA` : 'ALL FIELDS LOADED')
    : (sealed ? `${sealed} SEALED` : 'DECLASSIFIED');

ui.startClocks();
ui.setZoomUI(1);
ui.log(`SESSION OPEN · ${site.callsign}`);
if (!hasGL) ui.log('VISUAL OFFLINE · STATIC');
ui.log(DRAFTS ? `DRAFTS · ${todoTotal} PENDING` : `DOSSIER · ${dossier}`);

applyRoute({ initial: true });

globeModules?.then(attachGlobe, (err) => {
    console.warn('[globe] module failed to load, static mode:', err?.message ?? err);
    enterStaticMode();
    ui.log('VISUAL OFFLINE · STATIC');
    rendererReady(false);
});

if (booting) {
    ui.runBoot({
        renderer: hasGL
            ? rendererLine.then((ok) => (ok ? `WEBGL2 · ${quality.toUpperCase()}` : { v: 'OFFLINE → STATIC MODE', warn: true }))
            : { v: 'OFFLINE → STATIC MODE', warn: true },
        mesh: hasGL
            ? rendererLine.then((s) => (s?.nodes ? `${s.nodes} NODES / ${s.edges} EDGES` : { v: 'SKIPPED', warn: true }))
            : null,
        dossier,
        onReveal: () => {
            introRequested = true;
            withGlobe((g) => g.playIntro());
        },
        onDone: () => {},
    });
    clearTimeout(window.__agBootFailsafe);   // runBoot's own timers now own the phase
} else {
    html.dataset.phase = 'ready';
}

if (import.meta.env.DEV) console.info(`[content] ${todoTotal} placeholder fields remain in src/content.js`);
