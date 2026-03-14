import './main.css';
import { WireframeGlobe } from './globe.js';
import { GlobeControls } from './controls.js';
import { UIController } from './ui.js';

/**
 * Circle diameter as a fraction of the HUD container width.
 * Matches the SVG: circle r=280 in viewBox 1000 → diameter 560/1000 = 0.56
 */
const CIRCLE_FRAC = 0.52;

document.addEventListener('DOMContentLoaded', () => {
    const canvas = document.getElementById('globe-canvas');
    const hudEl = document.getElementById('hud');
    const hudWrapper = document.getElementById('hud-wrapper');
    const nameHeader = document.getElementById('name-header');
    const navButtons = document.getElementById('nav-buttons');
    const returnNav = document.getElementById('return-nav');

    // ── 0. HUD sizing — largest square that fits ───────────
    const sizeHud = () => {
        // Measure name and button heights (they sit outside the box)
        const nameH = nameHeader.offsetHeight;
        const navH = navButtons.offsetHeight;
        const margin = 16; // breathing room at viewport edges

        const availW = window.innerWidth - margin * 2;
        const availH = window.innerHeight - nameH - navH - margin * 2;
        const size = Math.floor(Math.min(availW, availH));

        hudEl.style.width = size + 'px';
        hudEl.style.height = size + 'px';
    };
    sizeHud();

    // ── 1. Three.js globe ──────────────────────────────────
    const globe = new WireframeGlobe(canvas);
    globe.fitToContainer(hudEl, CIRCLE_FRAC);

    // ── 2. Input controls ──────────────────────────────────
    const controls = new GlobeControls(canvas, {
        onRotate: (q) => globe.applyRotation(q),
        onVelocity: (v) => globe.setVelocity(v),
        onZoom: (delta) => globe.applyZoomDelta(delta),
    });

    // ── 3. UI overlay ──────────────────────────────────────
    const ui = new UIController();

    // Update UI each frame
    const updateUI = () => {
        ui.setZoom(globe.zoomFraction);
        ui.setVelocity(globe.velocityFraction);
        requestAnimationFrame(updateUI);
    };
    requestAnimationFrame(updateUI);

    // ── 4. Resize — HUD first, then globe ──────────────────
    window.addEventListener('resize', () => {
        sizeHud();
        globe.handleResize();
        globe.fitToContainer(hudEl, CIRCLE_FRAC);
    });

    // ── 5. Zoom slider drag ────────────────────────────────
    const sliderHandle = document.getElementById('zoom-slider-handle');
    if (sliderHandle) {
        let dragging = false;

        const onDrag = (clientX) => {
            const rect = ui.getZoomTrackRect();
            if (!rect) return;
            const frac = (clientX - rect.left) / rect.width;
            globe.zoomFraction = frac;
        };

        sliderHandle.addEventListener('mousedown', (e) => {
            if (!controls.enabled) return;
            e.preventDefault();
            e.stopPropagation();
            dragging = true;
            onDrag(e.clientX);
        });
        document.addEventListener('mousemove', (e) => {
            if (!dragging) return;
            e.preventDefault();
            onDrag(e.clientX);
        });
        document.addEventListener('mouseup', () => { dragging = false; });

        sliderHandle.addEventListener('touchstart', (e) => {
            if (!controls.enabled) return;
            e.preventDefault();
            e.stopPropagation();
            dragging = true;
            if (e.touches.length) onDrag(e.touches[0].clientX);
        }, { passive: false });
        document.addEventListener('touchmove', (e) => {
            if (!dragging) return;
            e.preventDefault();
            if (e.touches.length) onDrag(e.touches[0].clientX);
        }, { passive: false });
        document.addEventListener('touchend', () => { dragging = false; });
    }

    // ── 6. Navigation buttons ──────────────────────────────
    let savedZoom = null;

    const enterView = () => {
        savedZoom = globe.camera.position.z;
        globe.zoomTo(0.75);
        globe.rotationEnabled = true;
        controls.enabled = false;
        globe.setTrianglesVisible(false);
        ui.enterViewMode();
    };

    const exitView = () => {
        globe.zoomTo(savedZoom ?? globe._baseZoom);
        controls.enabled = true;
        globe.setTrianglesVisible(true);
        ui.exitViewMode();
    };

    document.getElementById('about-btn')?.addEventListener('click', enterView);
    document.getElementById('portfolio-btn')?.addEventListener('click', enterView);
    document.getElementById('demos-btn')?.addEventListener('click', enterView);
    document.getElementById('return-btn')?.addEventListener('click', exitView);
});
