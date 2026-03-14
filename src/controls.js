import * as THREE from 'three';

/**
 * Input controller — handles mouse, touch, and wheel interactions for the globe.
 * Emits rotation velocity + zoom changes via callbacks.
 */
export class GlobeControls {
    /**
     * @param {HTMLCanvasElement} canvas
     * @param {object} opts
     * @param {function(THREE.Quaternion)} opts.onRotate  — called with incremental quaternion
     * @param {function(THREE.Vector3)}    opts.onVelocity — called with axis-angle velocity vector
     * @param {function(number)}           opts.onZoom    — called with signed zoom delta
     */
    constructor(canvas, { onRotate, onVelocity, onZoom }) {
        this.canvas = canvas;
        this.onRotate = onRotate;
        this.onVelocity = onVelocity;
        this.onZoom = onZoom;
        this.enabled = true;
        this._isInteracting = false;

        this._setupMouse();
        this._setupTouch();
        this._setupWheel();

        canvas.style.cursor = 'grab';
    }

    get isInteracting() { return this._isInteracting; }
    set isInteracting(v) { this._isInteracting = v; }

    // ── Mouse ──────────────────────────────────────────────
    _setupMouse() {
        let prev = { x: 0, y: 0 };

        this.canvas.addEventListener('mousedown', (e) => {
            if (!this.enabled) return;
            this._isInteracting = true;
            this.canvas.style.cursor = 'grabbing';
            prev = { x: e.clientX, y: e.clientY };
        });

        this.canvas.addEventListener('mousemove', (e) => {
            if (!this._isInteracting) return;
            const dx = e.clientX - prev.x;
            const dy = e.clientY - prev.y;
            this._applyDrag(dx, dy);
            prev = { x: e.clientX, y: e.clientY };
        });

        const stop = () => {
            this._isInteracting = false;
            this.canvas.style.cursor = 'grab';
        };
        this.canvas.addEventListener('mouseup', stop);
        this.canvas.addEventListener('mouseleave', stop);
    }

    // ── Touch ──────────────────────────────────────────────
    _setupTouch() {
        let touchStart = null;
        let pinchDist = null;

        const dist = (a, b) => Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);

        this.canvas.addEventListener('touchstart', (e) => {
            if (!this.enabled) return;
            e.preventDefault();
            this._isInteracting = true;

            if (e.touches.length === 1) {
                touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
                pinchDist = null;
            } else if (e.touches.length === 2) {
                pinchDist = dist(e.touches[0], e.touches[1]);
                touchStart = null;
            }
        }, { passive: false });

        this.canvas.addEventListener('touchmove', (e) => {
            e.preventDefault();
            if (e.touches.length === 1 && touchStart) {
                const dx = e.touches[0].clientX - touchStart.x;
                const dy = e.touches[0].clientY - touchStart.y;
                this._applyDrag(dx, dy);
                touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
            } else if (e.touches.length === 2 && pinchDist !== null) {
                const cur = dist(e.touches[0], e.touches[1]);
                const delta = pinchDist - cur;
                this.onZoom(delta * 0.09);
                pinchDist = cur;
            }
        }, { passive: false });

        const touchEnd = (e) => {
            if (e.touches.length === 0) {
                this._isInteracting = false;
                touchStart = null;
                pinchDist = null;
            } else if (e.touches.length === 1) {
                touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
                pinchDist = null;
            }
        };
        this.canvas.addEventListener('touchend', touchEnd);
        this.canvas.addEventListener('touchcancel', touchEnd);
    }

    // ── Wheel ──────────────────────────────────────────────
    _setupWheel() {
        this.canvas.addEventListener('wheel', (e) => {
            if (!this.enabled) return;
            e.preventDefault();
            this.onZoom(e.deltaY > 0 ? 0.1 : -0.1);
        }, { passive: false });
    }

    // ── Shared drag → rotation ─────────────────────────────
    _applyDrag(dx, dy) {
        const speed = 0.005;
        const axis = new THREE.Vector3(dy, dx, 0).normalize();
        const angle = Math.hypot(dx, dy) * speed;
        const q = new THREE.Quaternion().setFromAxisAngle(axis, angle);

        this.onRotate(q);
        this.onVelocity(axis.clone().multiplyScalar(angle));
    }
}
