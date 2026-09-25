// src/content.js — ALL personal content for andrewgerstenslager.com lives here.
// Anything wrapped in TODO('…') renders as a clearly marked "AWAITING DATA" placeholder
// until you replace it with a plain string. Links/images with null render as "PENDING".
// Keep this file plain data (no DOM, no imports).
export const PH_NOTE = '— replace in src/content.js';
export const TODO = (label) => ({ todo: true, label });

export const site = {
    name: 'Andrew Gerstenslager',          // known
    domain: 'andrewgerstenslager.com',     // known
    callsign: 'AG-01',                     // decorative UI code, not biographical
    tagline: TODO('ONE-LINE TAGLINE'),
    metaDescription: TODO('SEARCH / SOCIAL DESCRIPTION (≤155 CHARS)'),
};

export const sections = [   // target = abstract globe coordinates (UI choice, not places)
    { id: 'about',     index: '01', label: 'About',     file: 'DOSSIER',     target: { lat: 18,  lon: -32 } },
    { id: 'portfolio', index: '02', label: 'Portfolio', file: 'OPERATIONS',  target: { lat: -12, lon: 64 } },
    { id: 'demos',     index: '03', label: 'Demos',     file: 'SIMULATIONS', target: { lat: 36,  lon: 141 } },
    { id: 'contact',   index: '04', label: 'Contact',   file: 'COMMS',       target: { lat: -28, lon: -118 } },
];

export const about = {
    portrait: null,                         // e.g. '/portrait.jpg' placed in public/
    summary: [TODO('BIO PARAGRAPH 1 (2–4 SENTENCES)'), TODO('BIO PARAGRAPH 2')],
    facts: [
        { label: 'ROLE',   value: TODO('CURRENT ROLE') },
        { label: 'BASE',   value: TODO('CITY / REGION') },
        { label: 'FOCUS',  value: TODO('AREAS OF FOCUS') },
        { label: 'STATUS', value: TODO('AVAILABILITY') },
    ],
    timeline: [
        { when: TODO('YYYY – YYYY'), title: TODO('ROLE · ORGANIZATION'), detail: TODO('ONE-LINE SUMMARY') },
        { when: TODO('YYYY – YYYY'), title: TODO('ROLE · ORGANIZATION'), detail: TODO('ONE-LINE SUMMARY') },
        { when: TODO('YYYY – YYYY'), title: TODO('ROLE · ORGANIZATION'), detail: TODO('ONE-LINE SUMMARY') },
    ],
    skills: [
        { group: 'CORE',  items: [TODO('SKILL'), TODO('SKILL'), TODO('SKILL')] },
        { group: 'TOOLS', items: [TODO('TOOL'), TODO('TOOL')] },
    ],
    resume: { label: 'RÉSUMÉ.PDF', href: null },   // e.g. '/resume.pdf' in public/
};

const project = (n) => ({
    id: `op-0${n}`, title: TODO('PROJECT TITLE'), year: TODO('YYYY'), role: TODO('YOUR ROLE'),
    summary: TODO('ONE-SENTENCE SUMMARY'), body: [TODO('LONGER DESCRIPTION PARAGRAPH')],
    stack: [TODO('TECH'), TODO('TECH')], image: null,   // '/projects/op-0N.jpg' (16:9)
    links: [{ label: 'SOURCE', href: null }, { label: 'LIVE', href: null }],
});
export const projects = [project(1), project(2), project(3), project(4)];

export const demos = [
    { id: 'sim-00', builtin: 'globe-lab', title: 'ORBITAL WIREFRAME',   // describes THIS site, not the owner
      summary: 'The globe on this page: Three.js, custom GLSL shaders and HDR bloom. Adjust it live.' },
    { id: 'sim-01', title: TODO('DEMO TITLE'), summary: TODO('WHAT IT SHOWS'), href: null, image: null },
    { id: 'sim-02', title: TODO('DEMO TITLE'), summary: TODO('WHAT IT SHOWS'), href: null, image: null },
];

export const contact = {
    note: TODO('PREFERRED WAY TO REACH YOU / RESPONSE TIME'),
    email: null,                                          // 'name@domain' → mailto row + COPY button
    links: [
        { label: 'GITHUB',   handle: TODO('@HANDLE'),    href: null },
        { label: 'LINKEDIN', handle: TODO('/in/HANDLE'), href: null },
    ],
};
