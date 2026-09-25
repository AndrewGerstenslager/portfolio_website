import { PH_NOTE, about, projects, demos, contact, site, sections } from './content.js';

/**
 * Panel renderer — turns src/content.js into the DOM of the open file.
 * DOM is built with createElement + textContent only (never innerHTML with content).
 *
 * Two modes:
 * - Drafts (`npm run dev`, or any URL with ?drafts): every TODO() / null field renders
 *   as a hatched "awaiting data" redaction with a hint naming src/content.js.
 * - Production: TODO() fields and null links/images are left out; a group left empty
 *   disappears with its heading, and a file with nothing real renders one "sealed" card.
 *   Filling in content.js makes the real layout appear with no other change.
 */

export const DRAFTS = import.meta.env.DEV || new URLSearchParams(location.search).has('drafts');

const SVG_NS = 'http://www.w3.org/2000/svg';
const PH_TITLE = 'Placeholder — edit src/content.js';
const MEDIA_FIELDS = new Set(['href', 'image', 'portrait', 'email']);

// ── DOM helpers ────────────────────────────────────────

/** el(tag, { class, text, attrs, dataset, style, on }, ...children) */
export function el(tag, props = null, ...children) {
    const node = document.createElement(tag);
    if (props) applyProps(node, props);
    append(node, children);
    return node;
}

function svg(tag, attrs = null, ...children) {
    const node = document.createElementNS(SVG_NS, tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
    append(node, children);
    return node;
}

function applyProps(node, { class: cls, text, attrs, dataset, style, on }) {
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    if (attrs) {
        for (const [k, v] of Object.entries(attrs)) {
            if (v == null || v === false) continue;
            node.setAttribute(k, v === true ? '' : String(v));
        }
    }
    if (dataset) Object.assign(node.dataset, dataset);
    if (style) for (const [k, v] of Object.entries(style)) node.style.setProperty(k, String(v));
    if (on) for (const [type, fn] of Object.entries(on)) node.addEventListener(type, fn);
}

function append(node, children) {
    for (const child of children) {
        if (child == null || child === false) continue;
        if (Array.isArray(child)) append(node, child);
        else node.append(child); // strings become text nodes
    }
}

const isTodo = (v) => v != null && typeof v === 'object' && v.todo === true;
const aria = { 'aria-hidden': 'true' };

/** A value that is real content (not TODO(), null or blank). */
export const isReal = (v) => (typeof v === 'string' && v.trim() !== '') || typeof v === 'number';
/** Whether a field renders: always in drafts, only when real in production. */
const show = (v) => DRAFTS || isReal(v);
/** Drafts keep every entry; production keeps entries whose `pick(entry)` is real. */
const keep = (list, pick = (x) => x) => (DRAFTS ? list : list.filter((x) => isReal(pick(x))));
/** Production keeps entries where at least one of `keys` is real. */
const keepAny = (list, keys) => (DRAFTS ? list : list.filter((x) => keys.some((k) => isReal(x[k]))));

// ── Content → nodes ────────────────────────────────────

/**
 * Plain string → text node. TODO('…') → hatched inline redaction (or a paragraph-sized
 * block when `block`). null → "PENDING". `note: false` drops the visible
 * "— replace in src/content.js" suffix on small items (chips, years); the title tooltip remains.
 */
export function txt(v, { block = false, note = true } = {}) {
    if (typeof v === 'string' || typeof v === 'number') return document.createTextNode(String(v));
    if (!DRAFTS) return document.createTextNode('');   // renderers filter first; never leak a hint
    if (isTodo(v)) return block ? phBlock(v.label) : phInline(v.label, note);
    return phInline('PENDING', false);
}

function phInline(label, note) {
    return el('span', { class: 'ph', attrs: { title: PH_TITLE } },
        el('span', { class: 'ph-label', text: label }),
        note ? el('span', { class: 'ph-note', text: ` ${PH_NOTE}` }) : null);
}

function phBlock(label) {
    return el('div', { class: 'ph-block', attrs: { title: PH_TITLE } },
        el('p', { class: 'ph-block-label' },
            el('span', { class: 'ph-label', text: label }),
            el('span', { class: 'ph-note', text: ` ${PH_NOTE}` })),
        el('span', { class: 'ph-bar', attrs: aria }),
        el('span', { class: 'ph-bar', attrs: aria }),
        el('span', { class: 'ph-bar', attrs: aria }));
}

/** A paragraph: real text in a <p>, or a block redaction while it is still TODO. */
function para(v, cls = 'prose-p') {
    return typeof v === 'string' ? el('p', { class: cls, text: v }) : txt(v, { block: true });
}

/** <a> for a real href, else a non-focusable dashed "LINK PENDING" slot. */
export function linkOrPending({ label, href }, pendingText = `${label} — LINK PENDING`) {
    if (href) {
        return el('a', { class: 'btn-link', attrs: { href, target: '_blank', rel: 'noopener' } },
            label, el('span', { attrs: aria, text: '↗' }),
            el('span', { class: 'sr-only', text: ' (opens in new tab)' }));
    }
    return el('span', { class: 'link-pending', attrs: { role: 'link', 'aria-disabled': 'true' }, text: pendingText });
}

function crosshair() {
    return svg('svg', { class: 'media-x', viewBox: '0 0 64 64', 'aria-hidden': 'true', focusable: 'false' },
        svg('circle', { cx: 32, cy: 32, r: 14 }),
        svg('circle', { cx: 32, cy: 32, r: 2 }),
        svg('path', { d: 'M32 4v14M32 46v14M4 32h14M46 32h14' }),
        svg('path', { class: 'media-x-corners', d: 'M8 16V8h8M48 8h8v8M56 48v8h-8M16 56H8v-8' }));
}

/** Image, or a hatched "NO IMAGERY ON FILE" plate with a faint watermark code. */
function media(src, code, { square = false, alt = '' } = {}) {
    if (src) {
        return el('img', { class: square ? 'media media-square' : 'media',
            attrs: { src, alt, loading: 'lazy', decoding: 'async' } });
    }
    return el('div', { class: square ? 'media-ph media-ph-square' : 'media-ph',
        attrs: { role: 'img', 'aria-label': 'No image on file (placeholder)', title: PH_TITLE } },
        el('span', { class: 'media-wm', attrs: aria, text: code }),
        crosshair(),
        el('span', { class: 'media-note', attrs: aria, text: 'NO IMAGERY ON FILE' }));
}

function blockHeading(text) {
    return el('h3', { class: 'h-block' }, el('span', { attrs: aria, text: '■ ' }), text);
}

// ── Counting placeholders ──────────────────────────────

/** Counts TODO() objects plus unset href / image / portrait / email fields. */
export function countTodos(node) {
    if (node == null || typeof node !== 'object') return 0;
    if (isTodo(node)) return 1;
    if (Array.isArray(node)) return node.reduce((n, v) => n + countTodos(v), 0);
    let n = 0;
    for (const [key, value] of Object.entries(node)) {
        if (value === null && MEDIA_FIELDS.has(key)) n += 1;
        else n += countTodos(value);
    }
    return n;
}

// ── Tabs ───────────────────────────────────────────────

export function renderTabs(container, sections, onSelect) {
    container.replaceChildren(...sections.map((s) => el('button', {
        class: 'tab', attrs: { type: 'button' }, dataset: { section: s.id },
        on: { click: (e) => onSelect(s.id, e.currentTarget) },
    },
    el('span', { class: 'tab-idx', attrs: aria, text: s.index }),
    el('span', { class: 'tab-label', text: s.label }))));
}

// ── Sealed file (production, nothing real to show yet) ─

const SEALED_BARS = [100, 83, 94, 58];
const LAB_HASH = '#demos/sim-00';

/**
 * One composed card instead of a wall of empty fields: redaction bars, a stamp and
 * a way onward to the live simulation. Only rendered outside drafts.
 */
function sealedCard(sectionId, ctx) {
    const sec = sections.find((s) => s.id === sectionId);
    const titleId = `sealed-${sectionId}`;
    const bars = el('div', { class: 'sealed-bars', attrs: aria },
        SEALED_BARS.map((w, i) => el('span', { style: { '--w': `${w}%`, '--j': i } })));
    return el('section', { class: 'sealed', attrs: { 'aria-labelledby': titleId } },
        el('p', { class: 'sealed-meta', attrs: aria },
            el('span', { text: 'CLEARANCE · RESTRICTED' }),
            el('span', { text: `REF ${site.callsign}-${sec.index} · ${sec.file}` })),
        el('div', { class: 'sealed-plate' }, bars,
            el('span', { class: 'sealed-stamp', attrs: aria, text: 'SEALED' })),
        el('div', { class: 'sealed-copy' },
            el('h3', { class: 'sealed-title', attrs: { id: titleId }, text: 'File sealed' }),
            el('p', { class: 'sealed-sub', text: 'Declassification pending' })),
        el('button', { class: 'sealed-link', attrs: { type: 'button' },
            on: { click: () => ctx.navigate(LAB_HASH) } },
        el('span', { class: 'sealed-link-k', text: ctx.webgl ? 'Live now' : 'Also on file' }),
        el('span', { class: 'sealed-link-v' }, '03 Simulations', el('span', { attrs: aria, text: ' ►' }))));
}

/** Slim variant for a sealed group inside an otherwise real file. */
function sealedStrip(label) {
    return el('div', { class: 'sealed-strip' },
        el('span', { class: 'sealed-strip-bar', attrs: aria }),
        el('p', null, el('span', { class: 'sealed-strip-k', text: label }),
            el('span', { class: 'sealed-strip-v', text: 'Declassification pending' })));
}

const sealedRes = (sectionId, ctx, data) => {
    const root = sealedCard(sectionId, ctx);
    return { root, blocks: [root], data, sealed: true };
};

// ── ABOUT / DOSSIER ────────────────────────────────────

const visibleTimeline = () => keepAny(about.timeline, ['when', 'title', 'detail']);
const visibleSkills = () => about.skills
    .map((g) => ({ group: g.group, items: keep(g.items) }))
    .filter((g) => g.items.length);

function aboutIsEmpty() {
    return !about.portrait && !keep(about.summary).length && !keep(about.facts, (f) => f.value).length &&
        !visibleTimeline().length && !visibleSkills().length && !about.resume.href;
}

function renderAbout(ctx) {
    if (!DRAFTS && aboutIsEmpty()) return sealedRes('about', ctx, about);

    const portrait = show(about.portrait)
        ? media(about.portrait, site.callsign, { square: true, alt: 'Portrait of Andrew Gerstenslager' }) : null;
    const factList = keep(about.facts, (f) => f.value);
    const facts = factList.length ? el('dl', { class: 'facts' }, factList.map((f) => el('div', { class: 'fact' },
        el('dt', { text: f.label }),
        el('dd', null, txt(f.value))))) : null;

    const paras = keep(about.summary);
    const summary = paras.length ? el('div', { class: 'prose' }, paras.map((p) => para(p))) : null;

    const tl = visibleTimeline();
    const timeline = tl.length ? el('section', { class: 'block' },
        blockHeading('Service record'),
        el('ol', { class: 'timeline' }, tl.map((t) => el('li', { class: 'tl-item' },
            show(t.when) ? el('p', { class: 'tl-when' }, txt(t.when, { note: false })) : null,
            show(t.title) ? el('p', { class: 'tl-title' }, txt(t.title)) : null,
            show(t.detail) ? el('p', { class: 'tl-detail' }, txt(t.detail)) : null)))) : null;

    const groups = visibleSkills();
    const skills = groups.length ? el('section', { class: 'block' },
        blockHeading('Capabilities'),
        el('div', { class: 'skill-groups' }, groups.map((g) => el('div', { class: 'skill-group' },
            el('p', { class: 'skill-group-name', text: g.group }),
            el('ul', { class: 'tags' }, g.items.map((s) => el('li', { class: 'tag' }, txt(s, { note: false })))))))) : null;

    const resume = show(about.resume.href) ? el('div', { class: 'link-row' }, linkOrPending(about.resume)) : null;

    const side = [portrait, facts].filter(Boolean);
    const main = [summary, timeline, skills, resume].filter(Boolean);
    const root = el('div', { class: side.length && main.length ? 'dossier' : 'dossier dossier-solo' },
        side.length ? el('div', { class: 'dossier-side' }, side) : null,
        main.length ? el('div', { class: 'dossier-main' }, main) : null);

    return { root, blocks: [...side, ...main], data: about };
}

// ── PORTFOLIO / OPERATIONS ─────────────────────────────

const opCode = (p) => p.id.toUpperCase();
const visibleProjects = () => keep(projects, (p) => p.title);
const visibleLinks = (links) => (DRAFTS ? links : links.filter((l) => l.href));

function stackTags(stack, label = null) {
    const items = keep(stack);
    return items.length ? el('ul', { class: 'tags', attrs: label ? { 'aria-label': label } : null },
        items.map((s) => el('li', { class: 'tag' }, txt(s, { note: false })))) : null;
}

function linkRow(links) {
    const list = visibleLinks(links);
    return list.length ? el('div', { class: 'link-row' }, list.map((l) => linkOrPending(l))) : null;
}

function projectCard(p, ctx) {
    const code = opCode(p);
    return el('article', { class: 'card' },
        show(p.image) ? media(p.image, code, { alt: '' }) : null,
        el('div', { class: 'card-body' },
            el('p', { class: 'card-code' }, code, show(p.year) ? [' · ', txt(p.year, { note: false })] : null),
            el('h3', { class: 'card-title' },
                el('button', { class: 'card-open', attrs: { type: 'button' }, dataset: { item: p.id },
                    on: { click: () => ctx.navigate(`#portfolio/${p.id}`) } }, txt(p.title))),
            show(p.summary) ? el('p', { class: 'card-summary' }, txt(p.summary, { note: false })) : null,
            stackTags(p.stack, 'Stack'),
            linkRow(p.links)));
}

function renderPortfolio(itemId, ctx) {
    const list = visibleProjects();
    if (itemId) {
        const p = list.find((x) => x.id === itemId);
        if (p) return renderProject(p, ctx);
    }
    if (!list.length) return { ...sealedRes('portfolio', ctx, projects), notFound: !!itemId };

    const n = list.length;
    const intro = el('p', { class: 'file-meta' },
        `${n} OPERATION${n === 1 ? '' : 'S'} ON FILE · SELECT ONE TO OPEN ITS BRIEF`);
    const grid = el('div', { class: 'card-grid' }, list.map((p) => projectCard(p, ctx)));
    return {
        root: el('div', { class: 'ops' }, intro, grid),
        blocks: [intro, ...grid.children],
        data: projects,
        notFound: !!itemId,
    };
}

function renderProject(p, ctx) {
    const code = opCode(p);
    const back = el('button', { class: 'back-btn', attrs: { type: 'button' },
        on: { click: () => ctx.navigate('#portfolio') } },
    el('span', { attrs: aria, text: '◄' }), 'All operations');

    const head = el('header', { class: 'brief-head' },
        el('p', { class: 'card-code' }, `OPERATION ${code} · BRIEF`),
        el('h3', { class: 'brief-title' }, txt(p.title)),
        show(p.summary) ? el('p', { class: 'brief-summary' }, txt(p.summary)) : null);

    const stack = stackTags(p.stack);
    const factRows = [
        show(p.role) ? el('div', { class: 'fact' }, el('dt', { text: 'ROLE' }), el('dd', null, txt(p.role))) : null,
        show(p.year) ? el('div', { class: 'fact' }, el('dt', { text: 'YEAR' }), el('dd', null, txt(p.year, { note: false }))) : null,
        stack ? el('div', { class: 'fact' }, el('dt', { text: 'STACK' }), el('dd', null, stack)) : null,
    ].filter(Boolean);
    const meta = factRows.length ? el('dl', { class: 'facts facts-inline' }, factRows) : null;

    const paras = keep(p.body);
    const body = paras.length ? el('div', { class: 'prose' }, paras.map((b) => para(b))) : null;
    const plate = show(p.image) ? media(p.image, code, { alt: '' }) : null;
    const links = linkRow(p.links);

    const blocks = [back, head, meta, body, plate, links].filter(Boolean);
    return {
        root: el('article', { class: 'brief' }, blocks),
        blocks,
        data: p,
        focusEl: back,
    };
}

// ── DEMOS / SIMULATIONS ────────────────────────────────

function labSwitch(key, label, ctx, disabled) {
    const on = !!ctx.labState[key];
    const state = el('span', { class: 'switch-state', attrs: aria, text: on ? 'ON' : 'OFF' });
    const btn = el('button', {
        class: 'switch',
        attrs: { type: 'button', role: 'switch', 'aria-checked': String(on), disabled },
        dataset: { opt: key },
    },
    el('span', { class: 'switch-label', text: label }),
    state,
    el('span', { class: 'switch-track', attrs: aria }, el('i')));
    btn.addEventListener('click', () => {
        const next = btn.getAttribute('aria-checked') !== 'true';
        btn.setAttribute('aria-checked', String(next));
        state.textContent = next ? 'ON' : 'OFF';
        ctx.onLab(key, next);
    });
    return btn;
}

function renderLab(demo, ctx) {
    const offline = !ctx.webgl;
    const rate = ctx.labState.spinRate;
    const rateOut = el('span', { class: 'lab-rate', attrs: aria, text: `${rate.toFixed(1)}×` });
    const range = el('input', {
        class: 'range', attrs: {
            id: 'lab-spin', type: 'range', min: 0, max: 300, step: 10,
            value: Math.round(rate * 100), 'aria-valuetext': `${rate.toFixed(1)} times`, disabled: offline,
        },
    });
    range.style.setProperty('--fill', `${Math.round(rate * 100) / 3}%`);
    range.addEventListener('input', () => {
        const v = Number(range.value) / 100;
        rateOut.textContent = `${v.toFixed(1)}×`;
        range.setAttribute('aria-valuetext', `${v.toFixed(1)} times`);
        range.style.setProperty('--fill', `${Number(range.value) / 3}%`);
        ctx.onLab('spinRate', v);
    });

    const switches = el('div', { class: 'lab-switches' },
        labSwitch('bloom', 'Bloom', ctx, offline),
        labSwitch('rings', 'Orbital ring', ctx, offline),
        labSwitch('tracers', 'Surface tracks', ctx, offline));

    const actions = el('div', { class: 'lab-actions' },
        el('button', { class: 'lab-btn', attrs: { type: 'button', disabled: offline },
            on: { click: () => ctx.onLab('impulse') } }, el('span', { attrs: aria, text: '► ' }), 'Impulse'),
        el('button', { class: 'lab-btn', attrs: { type: 'button', disabled: offline },
            on: { click: () => ctx.onLab('reset') } }, el('span', { attrs: aria, text: '■ ' }), 'Reset view'));

    const stats = el('p', { class: 'lab-stats', attrs: { id: 'lab-stats' },
        text: offline ? 'RENDERER OFFLINE · STATIC MODE' : 'TIER\u00a0---- · --\u00a0FPS · --\u00a0DRAW\u00a0CALLS' });

    const card = el('article', { class: offline ? 'card lab is-offline' : 'card lab', attrs: { id: 'lab' } },
        el('div', { class: 'lab-info' },
            el('p', { class: 'card-code' },
                el('span', { class: 'live-dot', attrs: aria }),
                `${demo.id.toUpperCase()} · ${offline ? 'VISUAL OFFLINE' : 'LIVE ON THIS PAGE'}`),
            el('h3', { class: 'card-title', text: demo.title }),
            el('p', { class: 'card-summary lab-summary', text: demo.summary }),
            offline ? el('p', { class: 'lab-offline', text: 'WEBGL UNAVAILABLE IN THIS BROWSER · CONTROLS DISABLED' }) : null,
            stats),
        el('div', { class: 'lab-controls' },
            switches,
            el('div', { class: 'lab-spin' },
                el('label', { class: 'lab-spin-label', attrs: { for: 'lab-spin' } }, 'Spin rate'),
                rateOut, range),
            actions));

    return { card, firstControl: switches.firstElementChild };
}

/** External demo: a card with its image, or a compact row while it has none. */
function demoCard(d) {
    const code = d.id.toUpperCase();
    const title = d.href
        ? el('a', { class: 'card-open', attrs: { href: d.href, target: '_blank', rel: 'noopener' } }, txt(d.title))
        : txt(d.title);
    const launch = show(d.href) ? linkOrPending({ label: 'LAUNCH', href: d.href }) : null;
    return el('article', { class: d.image ? 'card' : 'card card-row', dataset: { item: d.id }, attrs: { tabindex: '-1' } },
        d.image ? media(d.image, code, { alt: '' }) : null,
        el('div', { class: 'card-body' },
            el('p', { class: 'card-code', text: `${code} · EXTERNAL` }),
            el('h3', { class: 'card-title' }, title),
            show(d.summary) ? el('p', { class: 'card-summary' }, txt(d.summary, { note: false })) : null,
            launch ? el('div', { class: 'link-row' }, launch) : null));
}

function renderDemos(itemId, ctx) {
    const lab = demos.find((d) => d.builtin === 'globe-lab');
    const others = keep(demos.filter((d) => d !== lab), (d) => d.title);
    const labView = lab ? renderLab(lab, ctx) : null;
    const cards = others.map(demoCard);
    const grid = cards.length ? el('div', { class: 'card-grid sim-grid' }, cards) : null;

    const res = {
        root: el('div', { class: 'sims' }, labView?.card, grid),
        blocks: [labView?.card, ...cards].filter(Boolean),
        data: demos,
    };
    if (itemId) {
        if (lab && itemId === lab.id) {
            res.scrollTo = labView.card;
            res.focusEl = labView.firstControl;
        } else {
            const card = cards.find((c) => c.dataset.item === itemId);
            if (card) { res.scrollTo = card; res.focusEl = card; } else res.notFound = true;
        }
    }
    return res;
}

// ── CONTACT / COMMS ────────────────────────────────────

function commRow(channel, label, ...content) {
    return el('div', { class: 'comm-row' },
        el('span', { class: 'comm-ch', attrs: aria, text: channel }),
        el('span', { class: 'comm-label', text: label }),
        el('span', { class: 'comm-val' }, content));
}

function emailRow(ctx) {
    if (!contact.email) {
        return DRAFTS ? commRow('CH-01', 'EMAIL', el('span', { class: 'link-pending', attrs: { role: 'link', 'aria-disabled': 'true' },
            text: 'EMAIL — PENDING' })) : null;
    }
    const copy = el('button', { class: 'copy-btn', attrs: { type: 'button', 'aria-label': 'Copy email address' },
        text: 'COPY' });
    copy.addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(contact.email);
            copy.textContent = 'COPIED';
            ctx.log('EMAIL COPIED');
            ctx.announce('Email copied');
            setTimeout(() => { copy.textContent = 'COPY'; }, 1600);
        } catch {
            ctx.log('CLIPBOARD UNAVAILABLE');
        }
    });
    return commRow('CH-01', 'EMAIL',
        el('a', { class: 'comm-link', attrs: { href: `mailto:${contact.email}` }, text: contact.email }), copy);
}

function linkRowFor(l, ch) {
    if (l.href) {
        const handle = isReal(l.handle) ? l.handle : l.href.replace(/^https?:\/\//, '').replace(/\/$/, '');
        return el('a', { class: 'comm-row comm-row-link', attrs: { href: l.href, target: '_blank', rel: 'noopener' } },
            el('span', { class: 'comm-ch', attrs: aria, text: ch }),
            el('span', { class: 'comm-label', text: l.label }),
            el('span', { class: 'comm-val' }, handle,
                el('span', { attrs: aria, text: ' ↗' }),
                el('span', { class: 'sr-only', text: ' (opens in new tab)' })));
    }
    if (!DRAFTS) return null;
    return commRow(ch, l.label, txt(l.handle, { note: false }),
        el('span', { class: 'link-pending link-pending-sm', attrs: { role: 'link', 'aria-disabled': 'true' },
            text: 'LINK PENDING' }));
}

function renderContact(_itemId, ctx) {
    const note = show(contact.note) ? el('div', { class: 'prose' }, para(contact.note)) : null;
    const rows = [emailRow(ctx), ...contact.links.map((l, i) => linkRowFor(l, `CH-0${i + 2}`))].filter(Boolean);
    const channels = rows.length ? el('div', { class: 'comms' }, rows) : null;

    // The known domain is always on file: a small sign-off in drafts, the headline in production
    const domain = DRAFTS
        ? el('p', { class: 'comm-domain' }, el('span', { class: 'live-dot', attrs: aria }), site.domain)
        : el('div', { class: 'freq' },
            el('p', { class: 'freq-k' }, el('span', { class: 'live-dot', attrs: aria }), 'Primary frequency'),
            el('p', { class: 'freq-v', text: site.domain }),
            el('p', { class: 'freq-meta', attrs: aria, text: `${site.callsign} · LINK NOMINAL` }));

    const strip = !DRAFTS && !rows.length ? sealedStrip('Direct channels sealed') : null;
    const blocks = DRAFTS ? [note, channels, domain] : [domain, note, channels, strip];
    const list = blocks.filter(Boolean);
    return { root: el('div', { class: 'comms-file' }, list), blocks: list, data: contact };
}

// ── Entry point ────────────────────────────────────────

const RENDERERS = {
    about: (_item, ctx) => renderAbout(ctx),
    portfolio: renderPortfolio,
    demos: renderDemos,
    contact: renderContact,
};

/** Section ids whose production render is the sealed card (for boot + log lines). */
export function sealedSections() {
    if (DRAFTS) return [];
    const out = [];
    if (aboutIsEmpty()) out.push('about');
    if (!visibleProjects().length) out.push('portfolio');
    return out;
}

/**
 * Renders a file into the panel body.
 * ctx = { navigate(hash), onLab(action, value), labState, log(msg), announce(msg), webgl }
 * Returns { todoCount, focusEl | null, notFound, sealed }.
 */
export function renderSection(bodyEl, sectionId, itemId, ctx) {
    const render = RENDERERS[sectionId];
    if (!render) {
        bodyEl.replaceChildren();
        return { todoCount: 0, focusEl: null, notFound: true, sealed: false };
    }
    const hasItem = sectionId === 'portfolio' || sectionId === 'demos';
    const res = render(hasItem ? itemId : null, ctx);

    res.blocks.forEach((b, i) => {
        b.classList.add('reveal');
        b.style.setProperty('--i', String(Math.min(i, 10)));
    });
    bodyEl.replaceChildren(el('div', { class: `file file-${sectionId}${res.sealed ? ' is-sealed' : ''}` }, res.root));

    bodyEl.scrollTop = 0;
    if (res.scrollTo) {
        // offsetTop ignores the reveal transform; both are relative to the positioned panel
        bodyEl.scrollTop = Math.max(0, res.scrollTo.offsetTop - bodyEl.offsetTop - 16);
    }

    return {
        todoCount: countTodos(res.data),
        focusEl: res.focusEl ?? null,
        notFound: !!res.notFound || (!hasItem && !!itemId),
        sealed: !!res.sealed,
    };
}
