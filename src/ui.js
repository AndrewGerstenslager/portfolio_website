import { sections, site } from './content.js';

/**
 * UI controller — the HTML HUD around the globe: view state, panel header,
 * telemetry readouts, sparkline, system log, clocks and the boot sequence.
 * Pure DOM; it never talks to the globe (main.js feeds it numbers).
 */

const SPARK_N = 60;
const LOG_KEEP = 8;
const BOOT_LINE_AT = [0, 110, 220, 330, 440, 550];
export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 1.25;

const pad = (n, w) => String(n).padStart(w, '0');
export const fmtLat = (lat) => `${Math.abs(lat).toFixed(1).padStart(4, '0')}°${lat < 0 ? 'S' : 'N'}`;
export const fmtLon = (lon) => `${Math.abs(lon).toFixed(1).padStart(5, '0')}°${lon < 0 ? 'W' : 'E'}`;
const hms = (s) => `${pad(Math.floor(s / 3600) % 100, 2)}:${pad(Math.floor(s / 60) % 60, 2)}:${pad(s % 60, 2)}`;
const utcNow = () => {
    const d = new Date();
    return `${pad(d.getUTCHours(), 2)}:${pad(d.getUTCMinutes(), 2)}:${pad(d.getUTCSeconds(), 2)}`;
};

export class UIController {
    constructor() {
        const $ = (id) => document.getElementById(id);
        this.html = document.documentElement;

        // Readouts
        this.omega = $('t-omega');
        this.node = $('t-node');
        this.lat = $('t-lat');
        this.lon = $('t-lon');
        this.cursor = $('t-cursor');
        this.mag = $('t-mag');
        this.render = $('t-render');
        this.chipOmega = $('c-omega');
        this.chipMag = $('c-mag');
        this.zoom = $('zoom');
        this.railL = document.querySelector('.rail-l');
        this.files = $('files');
        this.tag = $('cursor-tag');
        this.tagText = this.tag?.querySelector('.tag-text');
        this._renderFiles();

        // Sparkline
        const spark = $('t-spark');
        this.spark = spark;
        this.sparkLine = spark?.querySelector('.spark-line');
        this.sparkArea = spark?.querySelector('.spark-area');
        this.sparkDot = spark?.querySelector('.spark-dot');
        this._samples = new Float32Array(SPARK_N);
        this._head = 0;
        this._count = 0;
        this._sparkShown = false;
        this._tick = 0;

        // Clocks, log, live region
        this.utc = $('utc');
        this.met = $('met');
        this.logEl = $('log');
        this.live = $('sr-live');

        // Panel
        this.panel = $('panel');
        this.kicker = $('panel-kicker');
        this.title = $('panel-title');
        this.type = this.title.querySelector('.type');
        this.target = $('panel-target');
        this.pending = $('panel-pending');
        this.footBtns = [...this.panel.querySelectorAll('.foot-btn')];

        // Boot
        this.boot = $('boot');
        this.bootText = $('boot-text');
        this.bootBar = this.boot?.querySelector('.boot-bar');

        this._shown = new WeakMap(); // element → last written text
    }

    /** textContent write only when the value changed */
    _set(el, text) {
        if (!el || this._shown.get(el) === text) return;
        this._shown.set(el, text);
        el.textContent = text;
    }

    // ── View state ─────────────────────────────────────────

    /** Home (null) or an open file. `switching` = file→file or list↔item (fast body reveal). */
    setView(sectionId, { switching = false } = {}) {
        const html = this.html;
        html.dataset.view = sectionId ? 'section' : 'home';
        if (sectionId) html.dataset.open = sectionId;
        else delete html.dataset.open;

        for (const b of document.querySelectorAll('.cmd[data-section], .tab[data-section]')) {
            if (b.dataset.section === sectionId) b.setAttribute('aria-current', 'page');
            else b.removeAttribute('aria-current');
        }
        // Set before the body renders so the reveal delays pick it up
        this.panel.style.setProperty('--reveal-base', switching ? '80ms' : '600ms');
        this.panel.hidden = !sectionId;
    }

    /** Header for a newly opened file; target = globe.focus() result or null. */
    setPanelHeader(section, target, todoCount, { switching = false } = {}) {
        const label = section.label.toUpperCase();
        this.kicker.textContent = `FILE ${section.index} // ${section.file}`;
        this.type.textContent = label;
        this.type.style.setProperty('--n', String(label.length));

        this.setTarget(target);
        this.setPending(todoCount);

        // Footer: previous / next file (wrapping)
        const i = sections.indexOf(section);
        const n = sections.length;
        const prev = sections[(i - 1 + n) % n];
        const next = sections[(i + 1) % n];
        this.footBtns[0].textContent = `◄ ${prev.index} ${prev.label.toUpperCase()}`;
        this.footBtns[0].setAttribute('aria-label', `Previous file: ${prev.label}`);
        this.footBtns[1].textContent = `${next.index} ${next.label.toUpperCase()} ►`;
        this.footBtns[1].setAttribute('aria-label', `Next file: ${next.label}`);

        // Restart the power-on (or the lighter switch) animation
        const p = this.panel;
        p.classList.remove('is-entering', 'is-switching');
        void p.offsetWidth;
        p.classList.add(switching ? 'is-switching' : 'is-entering');
    }

    /** Target line under the title; null (no globe yet / static mode) hides it. */
    setTarget(target) {
        if (target) {
            this.target.hidden = false;
            this.target.textContent = `TARGET NODE ${pad(target.node, 3)} · ${fmtLat(target.lat)} ${fmtLon(target.lon)}`;
        } else {
            this.target.hidden = true;
        }
    }

    setPending(todoCount) {
        this.pending.hidden = !(todoCount > 0);
        this.pending.textContent = `${todoCount} FIELD${todoCount === 1 ? '' : 'S'} AWAITING DATA`;
    }

    // ── Telemetry (10 Hz from main.js) ─────────────────────

    updateTelemetry(t) {
        const w = Math.min(Math.max(t.omegaDegPerSec || 0, 0), 999.9);
        const ws = w.toFixed(1).padStart(4, '0');
        this._set(this.omega, ws);
        this._set(this.chipOmega, ws);
        this._set(this.lat, fmtLat(t.facingLat || 0));
        this._set(this.lon, fmtLon(t.facingLon || 0));
        this._set(this.node, pad(t.facingNode || 0, 3));
        const z = (t.zoom ?? 1).toFixed(2);
        this._set(this.mag, `${z}×`);
        this._set(this.chipMag, z);
        const tier = String(t.tier || '').toUpperCase();
        this._set(this.render, `${Math.round(t.fps || 0)} FPS · ${tier}`);

        // Sparkline ring buffer; redraw only while the rail is on screen
        this._samples[this._head] = w;
        this._head = (this._head + 1) % SPARK_N;
        this._count = Math.min(this._count + 1, SPARK_N);
        if (this._tick % 10 === 0) {
            this._sparkShown = !!this.railL && this.railL.offsetParent !== null &&
                !!this.spark && this.spark.getClientRects().length > 0;
        }
        if (this._sparkShown) this._drawSpark();

        // Globe Lab stats line at 2 Hz while it is on screen
        if (this._tick % 5 === 0) {
            const stats = document.getElementById('lab-stats');
            if (stats && !this.html.classList.contains('no-webgl') && stats.offsetParent !== null) {
                this._set(stats, `TIER\u00a0${tier} ·\u00a0${Math.round(t.fps || 0)}\u00a0FPS ·\u00a0${t.drawCalls ?? 0}\u00a0DRAW\u00a0CALLS`);
            }
        }
        this._tick++;
    }

    _drawSpark() {
        const n = this._count;
        if (n < 2 || !this.sparkLine) return;
        let max = 10;
        for (let i = 0; i < n; i++) max = Math.max(max, this._samples[i]);
        max *= 1.15;
        let pts = '';
        let x = 0;
        let y = 0;
        const start = (this._head - n + SPARK_N) % SPARK_N;
        for (let i = 0; i < n; i++) {
            const v = this._samples[(start + i) % SPARK_N];
            x = ((SPARK_N - n + i) / (SPARK_N - 1)) * 200;
            y = 31 - (v / max) * 28;
            pts += `${x.toFixed(1)},${y.toFixed(1)} `;
        }
        const x0 = (((SPARK_N - n) / (SPARK_N - 1)) * 200).toFixed(1);
        this.sparkLine.setAttribute('points', pts);
        this.sparkArea.setAttribute('d', `M${x0},32 L${pts.trim().replaceAll(' ', ' L')} L${x.toFixed(1)},32 Z`);
        this.spark.classList.add('has-data');
        this.sparkDot.setAttribute('cx', x.toFixed(1));
        this.sparkDot.setAttribute('cy', y.toFixed(1));
    }

    setCursor(hit, lat, lon) {
        this._set(this.cursor, hit ? `${fmtLat(lat)} ${fmtLon(lon)}` : 'NO CONTACT');
    }

    setZoomUI(z) {
        if (!this.zoom) return;
        const v = Math.round(Math.min(Math.max(z, ZOOM_MIN), ZOOM_MAX) * 100);
        const lo = ZOOM_MIN * 100;
        this.zoom.value = String(v);
        this.zoom.style.setProperty('--fill', `${((v - lo) / (ZOOM_MAX * 100 - lo)) * 100}%`);
        this.zoom.setAttribute('aria-valuetext', `${(v / 100).toFixed(2)} times`);
        this._set(this.mag, `${(v / 100).toFixed(2)}×`);
        this._set(this.chipMag, (v / 100).toFixed(2));
    }

    /** Static-mode readouts: honest dashes instead of frozen numbers. */
    setOffline() {
        this._set(this.omega, '--.-');
        this._set(this.lat, '--.-°N');
        this._set(this.lon, '---.-°E');
        this._set(this.node, '---');
        this._set(this.render, 'OFFLINE');
        this._set(this.cursor, 'NO CONTACT');
    }

    startClocks() {
        const tick = () => {
            this._set(this.utc, utcNow());
            this._set(this.met, hms(Math.floor(performance.now() / 1000)));
        };
        tick();
        // Align to the next UTC second boundary
        setTimeout(() => {
            tick();
            setInterval(tick, 1000);
        }, 1000 - (Date.now() % 1000));
    }

    // ── File index (right rail) ────────────────────────────

    /** Once the globe knows its mesh, show the node each file's marker lands on (id → {lat, lon}). */
    setFileSectors(at) {
        this._renderFiles(at);
    }

    /** Mirrors the telemetry rail: one row per file with its sector on the globe. */
    _renderFiles(at = null) {
        if (!this.files) return;
        const sector = ({ lat, lon }) => `${pad(Math.abs(Math.round(lat)), 2)}°${lat < 0 ? 'S' : 'N'} ${pad(Math.abs(Math.round(lon)), 3)}°${lon < 0 ? 'W' : 'E'}`;
        this.files.replaceChildren(...sections.map((s) => {
            const li = document.createElement('li');
            li.dataset.section = s.id;
            const idx = document.createElement('span');
            idx.className = 'f-idx';
            idx.textContent = s.index;
            const name = document.createElement('span');
            name.className = 'f-name';
            name.textContent = s.file;
            const loc = document.createElement('span');
            loc.className = 'f-at';
            loc.textContent = sector(at?.get(s.id) ?? s.target);
            li.append(idx, name, loc);
            return li;
        }));
    }

    /** Highlights the file the globe is previewing (null clears). */
    setPreview(sectionId) {
        if (!this.files) return;
        for (const li of this.files.children) li.classList.toggle('is-hot', li.dataset.section === sectionId);
    }

    // ── Cursor tag (fine pointers over the globe) ──────────

    moveTag(x, y) {
        if (this.tag) this.tag.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    }

    /** text = null hides the tag; hot = the cursor is on a file's target sector. */
    setTag(text, hot = false) {
        if (!this.tag) return;
        this.tag.hidden = text == null;
        if (text == null) return;
        this._set(this.tagText, text);
        this.tag.classList.toggle('is-hot', hot);
    }

    // ── System log ─────────────────────────────────────────

    log(msg, { announce = false } = {}) {
        if (this.logEl) {
            const li = document.createElement('li');
            li.className = 'new';
            const ts = document.createElement('span');
            ts.className = 'ts';
            ts.textContent = utcNow();
            const m = document.createElement('span');
            m.textContent = msg;
            li.append(ts, m);
            this.logEl.append(li);
            while (this.logEl.children.length > LOG_KEEP) this.logEl.firstElementChild.remove();
            setTimeout(() => li.classList.remove('new'), 1000);
        }
        if (announce) this.announce(msg);
    }

    announce(msg) {
        if (!this.live) return;
        this.live.textContent = '';
        setTimeout(() => { this.live.textContent = msg; }, 60);
    }

    // ── Boot sequence ──────────────────────────────────────

    /**
     * Prints the boot log over the deep-blue overlay, reveals the globe at 450 ms,
     * hands over to the HUD intro at 1300 ms and to 'ready' at 1900 ms.
     * Any key or pointer press skips straight to 'ready'.
     */
    runBoot({ renderer, mesh, dossier, onReveal, onDone }) {
        const html = this.html;
        if (html.dataset.phase !== 'boot' || !this.boot) {
            onDone?.();
            return;
        }

        // renderer / mesh may be promises of { v, warn } while the globe module loads
        const lines = [
            { k: `${site.callsign} // ${site.domain.toUpperCase()}`, v: 'BUILD 2026.09', head: true },
            { k: '> TYPEFACE', v: '…', font: true },
            { k: '> RENDERER', v: renderer },
            mesh ? { k: '> GEODESIC MESH', v: mesh } : null,
            { k: '> DOSSIER', v: `${sections.length} FILES · ${dossier}` },
            { k: '> ESTABLISHING ORBIT', cursor: true },
        ].filter(Boolean);

        // Typeface check races an 800 ms timeout
        let fontValue = null;
        let fontEl = null;
        const setFont = (v) => {
            fontValue = v;
            if (fontEl) {
                fontEl.textContent = v;
                fontEl.classList.toggle('is-warn', v !== 'OK');
            }
        };
        const fontCheck = document.fonts
            ? document.fonts.load('16px "Departure Mono"')
                .then(() => (document.fonts.check('16px "Departure Mono"') ? 'OK' : 'FALLBACK'))
            : Promise.resolve('FALLBACK');
        Promise.race([fontCheck, new Promise((r) => setTimeout(() => r('FALLBACK'), 800))])
            .then(setFont, () => setFont('FALLBACK'));

        const timers = [];
        const at = (ms, fn) => timers.push(setTimeout(fn, ms));
        let revealed = false;
        let finished = false;
        const reveal = () => {
            if (revealed) return;
            revealed = true;
            onReveal?.();
        };

        this.bootText.replaceChildren();
        lines.forEach((line, i) => at(BOOT_LINE_AT[Math.min(i, BOOT_LINE_AT.length - 1)], () => {
            const row = document.createElement('div');
            row.className = line.head ? 'boot-line is-head' : 'boot-line';
            const k = document.createElement('span');
            k.className = 'k';
            k.textContent = line.k;
            row.append(k);
            if (line.cursor) {
                const c = document.createElement('span');
                c.className = 'boot-cursor';
                c.textContent = '▌';
                row.append(c);
            } else {
                if (!line.head) {
                    const dots = document.createElement('span');
                    dots.className = 'dots';
                    row.append(dots);
                }
                const v = document.createElement('span');
                v.className = 'v';
                const put = (r) => {
                    v.textContent = typeof r === 'string' ? r : r.v;
                    v.classList.toggle('is-warn', !!r.warn);
                };
                if (line.v && typeof line.v.then === 'function') {
                    v.textContent = '…';
                    line.v.then(put, () => put({ v: 'FAULT', warn: true }));
                } else {
                    put(line.v);
                }
                if (line.font) {
                    fontEl = v;
                    if (fontValue) setFont(fontValue);
                }
                row.append(v);
            }
            this.bootText.append(row);
            this.bootBar?.style.setProperty('--p', String((i + 1) / lines.length));
        }));

        const finish = () => {
            if (finished) return;
            finished = true;
            timers.forEach(clearTimeout);
            window.removeEventListener('keydown', skip, true);
            window.removeEventListener('pointerdown', skip, true);
            reveal();
            html.dataset.phase = 'ready';
            this.boot.classList.remove('is-revealing', 'is-fading');
            try { sessionStorage.setItem('ag-booted', '1'); } catch { /* private mode */ }
            onDone?.();
        };
        const skip = () => finish();

        at(450, () => {
            reveal();
            this.boot.classList.add('is-revealing');
        });
        at(1100, () => this.boot.classList.add('is-fading'));
        at(1300, () => { html.dataset.phase = 'intro'; });
        at(1900, finish);

        // Capture phase so the skip runs before any other key handling
        window.addEventListener('keydown', skip, true);
        window.addEventListener('pointerdown', skip, true);
    }
}
