/**
 * UI controller — manages HTML-based overlay elements.
 * Keeps all DOM reads/writes out of the rendering loop.
 */

export class UIController {
    constructor() {
        // Indicator elements
        this.zoomBarFill = document.getElementById('zoom-bar-fill');
        this.zoomSliderHandle = document.getElementById('zoom-slider-handle');
        this.velocityBarFill = document.getElementById('velocity-bar-fill');
        this.velocityValue = document.getElementById('velocity-value');

        // Navigation
        this.navButtons = document.getElementById('nav-buttons');
        this.returnNav = document.getElementById('return-nav');
        this.comingSoon = document.getElementById('coming-soon');

        // Indicator containers
        this.zoomIndicator = document.getElementById('zoom-indicator');
        this.velocityIndicator = document.getElementById('velocity-indicator');

        // Decorative frame
        this.decoFrame = document.getElementById('deco-frame');

        // Track bar dimensions
        this.zoomTrack = this.zoomBarFill?.parentElement;
    }

    /** Update zoom bar + slider handle position.  percent: 0–1 */
    setZoom(percent) {
        const clamped = Math.max(0, Math.min(1, percent));
        if (this.zoomBarFill) {
            this.zoomBarFill.style.width = `${clamped * 100}%`;
        }
        if (this.zoomSliderHandle) {
            // Position handle relative to track width
            const trackWidth = this.zoomTrack?.offsetWidth ?? 120;
            const handleWidth = 10;
            const left = clamped * (trackWidth - handleWidth);
            this.zoomSliderHandle.style.left = `${left}px`;
        }
    }

    /** Update velocity bar + readout.  percent: 0–1 */
    setVelocity(percent) {
        const clamped = Math.max(0, Math.min(1, percent));
        if (this.velocityBarFill) {
            this.velocityBarFill.style.width = `${clamped * 100}%`;
        }
        if (this.velocityValue) {
            this.velocityValue.textContent = (clamped * 100).toFixed(2);
        }
    }

    /** Enter "coming soon" view — hide HUD, show message + return button */
    enterViewMode() {
        if (this.navButtons) this.navButtons.classList.add('hidden');
        if (this.zoomIndicator) this.zoomIndicator.classList.add('hidden');
        if (this.velocityIndicator) this.velocityIndicator.classList.add('hidden');
        if (this.decoFrame) this.decoFrame.classList.add('hidden');

        if (this.returnNav) {
            this.returnNav.classList.remove('hidden');
            this.returnNav.classList.add('flex');
        }
        if (this.comingSoon) {
            this.comingSoon.classList.remove('hidden');
            this.comingSoon.classList.add('flex');
        }
    }

    /** Exit "coming soon" view — restore HUD */
    exitViewMode() {
        if (this.navButtons) this.navButtons.classList.remove('hidden');
        if (this.zoomIndicator) this.zoomIndicator.classList.remove('hidden');
        if (this.velocityIndicator) this.velocityIndicator.classList.remove('hidden');
        if (this.decoFrame) this.decoFrame.classList.remove('hidden');

        if (this.returnNav) {
            this.returnNav.classList.add('hidden');
            this.returnNav.classList.remove('flex');
        }
        if (this.comingSoon) {
            this.comingSoon.classList.add('hidden');
            this.comingSoon.classList.remove('flex');
        }
    }

    /** Get zoom track bounding rect for slider drag calculations */
    getZoomTrackRect() {
        return this.zoomTrack?.getBoundingClientRect() ?? null;
    }
}
