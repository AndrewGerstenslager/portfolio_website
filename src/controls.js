import { Quaternion, Vector3 } from 'three';

/**
 * GlobeControls — Pointer Events input for the globe (mouse, touch, pen),
 * wheel zoom and keyboard on an optional focusable key target.
 *
 * Input only: emits rotation / velocity / zoom / reset / hover through
 * callbacks and never touches the globe itself. Scratch objects passed to
 * callbacks are reused — consume them synchronously.
 */

const ROT_SPEED = 0.006;          // rad per px
const DRAG_MOUSE = 3;             // px before a press becomes a drag
const DRAG_TOUCH = 8;
const MAX_OMEGA = 12.5;           // rad/s
const FLING_WINDOW = 100;         // ms of samples used for the release velocity
const FLING_STALE = 80;           // ms without movement → no fling
const SAMPLES = 6;
const TAP_MS = 300;
const TAP_PX = 24;
const ZOOM_DEBOUNCE = 400;
const KEY_IMPULSE = 0.6;          // rad/s (×3 with Shift)
const KEY_ZOOM = 1.1;

const noop = () => {};

export class GlobeControls {
    /**
     * @param {HTMLCanvasElement} canvas
     * @param {object} opts
     * @param {HTMLElement|null} [opts.keyTarget] — focusable element for arrow / zoom / reset keys
     * @param {function(Quaternion)} opts.onRotate   — incremental world-space rotation (reused object)
     * @param {function(Vector3)}    opts.onVelocity — angular velocity in rad/s (reused object)
     * @param {function(number)}     opts.onZoom     — multiplicative factor, >1 = larger globe
     * @param {function()}           opts.onReset
     * @param {function(?number, ?number)} opts.onPointer — hover position in CSS px, or (null, null)
     * @param {function(string)}     opts.onInteract — 'drag' | 'zoom' | 'key'
     */
    constructor(canvas, {
        keyTarget = null, onRotate = noop, onVelocity = noop, onZoom = noop,
        onReset = noop, onPointer = noop, onInteract = noop,
    } = {}) {
        this.canvas = canvas;
        this.keyTarget = keyTarget;
        this.onRotate = onRotate;
        this.onVelocity = onVelocity;
        this.onZoom = onZoom;
        this.onReset = onReset;
        this.onPointer = onPointer;
        this.onInteract = onInteract;
        this.enabled = true;

        // Scratch (reused for every event)
        this._q = new Quaternion();
        this._axis = new Vector3();
        this._vel = new Vector3();
        this._zero = new Vector3();

        // Active pointers: id → pooled {x, y}
        this._pointers = new Map();
        this._pool = [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }];

        // Gesture state
        this._startX = 0;
        this._startY = 0;
        this._prevX = 0;
        this._prevY = 0;
        this._prevT = 0;
        this._dragging = false;
        this._dragAnnounced = false;
        this._moved = false;
        this._pinchDist = 0;
        this._primaryType = 'mouse';
        this._lastType = 'mouse';

        // Fling ring buffer: t, dt, x, y, z per slot
        this._samples = new Float64Array(SAMPLES * 5);
        this._sampleIdx = 0;
        this._sampleCount = 0;

        // Double tap
        this._lastTapT = -Infinity;
        this._lastTapX = 0;
        this._lastTapY = 0;
        this._lastResetT = -Infinity;

        this._zoomTimer = 0;
        this._repackIdx = 0;

        this._repack = this._repack.bind(this);
        this._onDown = this._onDown.bind(this);
        this._onMove = this._onMove.bind(this);
        this._onUp = this._onUp.bind(this);
        this._onCancel = this._onCancel.bind(this);
        this._onLeave = this._onLeave.bind(this);
        this._onWheel = this._onWheel.bind(this);
        this._onDblClick = this._onDblClick.bind(this);
        this._onKey = this._onKey.bind(this);

        canvas.style.touchAction = 'none';
        canvas.style.cursor = 'grab';
        canvas.addEventListener('pointerdown', this._onDown);
        canvas.addEventListener('pointermove', this._onMove);
        canvas.addEventListener('pointerup', this._onUp);
        canvas.addEventListener('pointercancel', this._onCancel);
        canvas.addEventListener('lostpointercapture', this._onCancel);
        canvas.addEventListener('pointerleave', this._onLeave);
        canvas.addEventListener('wheel', this._onWheel, { passive: false });
        canvas.addEventListener('dblclick', this._onDblClick);
        if (keyTarget) keyTarget.addEventListener('keydown', this._onKey);
    }

    dispose() {
        const c = this.canvas;
        c.removeEventListener('pointerdown', this._onDown);
        c.removeEventListener('pointermove', this._onMove);
        c.removeEventListener('pointerup', this._onUp);
        c.removeEventListener('pointercancel', this._onCancel);
        c.removeEventListener('lostpointercapture', this._onCancel);
        c.removeEventListener('pointerleave', this._onLeave);
        c.removeEventListener('wheel', this._onWheel, { passive: false });
        c.removeEventListener('dblclick', this._onDblClick);
        if (this.keyTarget) this.keyTarget.removeEventListener('keydown', this._onKey);
        clearTimeout(this._zoomTimer);
        this._pointers.clear();
        c.style.cursor = '';
    }

    // ── Pointer ────────────────────────────────────────

    _onDown(e) {
        if (!this.enabled) return;
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        if (this._pointers.has(e.pointerId) || this._pointers.size >= this._pool.length) return;
        this._lastType = e.pointerType;
        try { this.canvas.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }

        const p = this._pool[this._pointers.size];
        p.x = e.clientX;
        p.y = e.clientY;
        this._pointers.set(e.pointerId, p);

        if (this._pointers.size === 1) {
            this.onVelocity(this._zero);            // catch the spin
            this._primaryType = e.pointerType;
            this._dragging = false;
            this._dragAnnounced = false;
            this._moved = false;
            this._beginDrag(e.clientX, e.clientY, e.timeStamp);
        } else if (this._pointers.size === 2) {
            this._endDrag();
            this._moved = true;                     // never a tap
            this._pinchDist = this._pinchDistance();
        }
    }

    _onMove(e) {
        if (!this.enabled) return;
        const p = this._pointers.get(e.pointerId);
        if (!p) {
            if (e.pointerType === 'mouse' && e.buttons === 0) this.onPointer(e.clientX, e.clientY);
            return;
        }
        p.x = e.clientX;
        p.y = e.clientY;

        if (this._pointers.size === 2) {
            const d = this._pinchDistance();
            if (this._pinchDist > 0 && d > 0) {
                this.onZoom(d / this._pinchDist);
                this._zoomed();
            }
            this._pinchDist = d;
            return;
        }
        if (this._pointers.size !== 1) return;

        if (!this._dragging) {
            const limit = this._primaryType === 'mouse' ? DRAG_MOUSE : DRAG_TOUCH;
            if (Math.hypot(e.clientX - this._startX, e.clientY - this._startY) < limit) return;
            this._dragging = true;
            this._moved = true;
            this.canvas.style.cursor = 'grabbing';
            if (!this._dragAnnounced) {
                this._dragAnnounced = true;
                this.onInteract('drag');
            }
        }
        this._rotate(e.clientX - this._prevX, e.clientY - this._prevY, e.timeStamp);
        this._prevX = e.clientX;
        this._prevY = e.clientY;
    }

    _onUp(e) {
        if (!this._pointers.has(e.pointerId)) return;
        const wasDrag = this._dragging;
        this._release(e.pointerId);

        if (this._pointers.size === 0) {
            if (wasDrag) {
                this.onVelocity(this._fling(e.timeStamp));
            } else if (!this._moved && e.pointerType !== 'mouse') {
                this._tap(e.clientX, e.clientY, e.timeStamp);
            }
        }
    }

    _onCancel(e) {
        if (!this._pointers.has(e.pointerId)) return;
        this._release(e.pointerId);
    }

    _onLeave(e) {
        if (e.pointerType === 'mouse') this.onPointer(null, null);
    }

    _release(id) {
        try { if (this.canvas.hasPointerCapture(id)) this.canvas.releasePointerCapture(id); } catch { /* ignore */ }
        this._pointers.delete(id);
        // Repack so the i-th live pointer (insertion order) owns pool slot i
        this._repackIdx = 0;
        this._pointers.forEach(this._repack);
        if (this._pointers.size === 1) {
            // Pinch → one finger: continue as a fresh drag from where it is
            const p = this._pool[0];
            this._beginDrag(p.x, p.y, performance.now());
            this._dragging = true;
        } else if (this._pointers.size === 0) {
            this._endDrag();
        }
    }

    _repack(p, pid) {
        const slot = this._pool[this._repackIdx++];
        if (slot === p) return;
        slot.x = p.x;
        slot.y = p.y;
        this._pointers.set(pid, slot);
    }

    _beginDrag(x, y, t) {
        this._startX = this._prevX = x;
        this._startY = this._prevY = y;
        this._prevT = t;
        this._sampleCount = 0;
    }

    _endDrag() {
        this._dragging = false;
        this.canvas.style.cursor = 'grab';
    }

    _pinchDistance() {
        const a = this._pool[0], b = this._pool[1];
        return Math.hypot(b.x - a.x, b.y - a.y);
    }

    // ── Rotation + fling ───────────────────────────────

    _rotate(dx, dy, t) {
        const len = Math.hypot(dx, dy);
        if (len === 0) return;
        const angle = len * ROT_SPEED;
        this._axis.set(dy / len, dx / len, 0);
        this._q.setFromAxisAngle(this._axis, angle);
        this.onRotate(this._q);

        const s = this._samples, i = this._sampleIdx * 5;
        s[i] = t;
        s[i + 1] = Math.max(0, t - this._prevT);
        s[i + 2] = this._axis.x * angle;
        s[i + 3] = this._axis.y * angle;
        s[i + 4] = 0;
        this._sampleIdx = (this._sampleIdx + 1) % SAMPLES;
        this._sampleCount = Math.min(this._sampleCount + 1, SAMPLES);
        this._prevT = t;
    }

    _fling(now) {
        const v = this._vel.set(0, 0, 0);
        if (this._sampleCount === 0) return v;
        const s = this._samples;
        const last = s[((this._sampleIdx + SAMPLES - 1) % SAMPLES) * 5];
        if (now - last > FLING_STALE) return v;

        let span = 0;
        for (let k = 0; k < this._sampleCount; k++) {
            const i = ((this._sampleIdx + SAMPLES - 1 - k) % SAMPLES) * 5;
            if (now - s[i] > FLING_WINDOW) break;
            v.x += s[i + 2];
            v.y += s[i + 3];
            v.z += s[i + 4];
            span += s[i + 1];
        }
        if (span <= 0) return v.set(0, 0, 0);
        v.divideScalar(Math.max(span, 8) / 1000);
        const w = v.length();
        if (w > MAX_OMEGA) v.multiplyScalar(MAX_OMEGA / w);
        return v;
    }

    // ── Taps / double click ────────────────────────────

    _tap(x, y, t) {
        if (t - this._lastTapT < TAP_MS && Math.hypot(x - this._lastTapX, y - this._lastTapY) < TAP_PX) {
            this._lastTapT = -Infinity;
            this._lastResetT = t;
            this.onReset();
            return;
        }
        this._lastTapT = t;
        this._lastTapX = x;
        this._lastTapY = y;
    }

    _onDblClick(e) {
        if (!this.enabled) return;
        // Touch double-taps are handled in _tap; ignore the synthesized dblclick
        if (this._lastType !== 'mouse' || e.timeStamp - this._lastResetT < 500) return;
        e.preventDefault();
        this.onReset();
    }

    // ── Wheel ──────────────────────────────────────────

    _onWheel(e) {
        if (!this.enabled) return;
        e.preventDefault();
        let dy = e.deltaY;
        if (e.deltaMode === 1) dy *= 16;
        else if (e.deltaMode === 2) dy *= this.canvas.clientHeight || 800;
        this.onZoom(Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0015)));
        this._zoomed();
    }

    _zoomed() {
        clearTimeout(this._zoomTimer);
        this._zoomTimer = setTimeout(() => this.onInteract('zoom'), ZOOM_DEBOUNCE);
    }

    // ── Keyboard (on keyTarget) ────────────────────────

    _onKey(e) {
        if (!this.enabled || e.altKey || e.ctrlKey || e.metaKey) return;
        const k = KEY_IMPULSE * (e.shiftKey ? 3 : 1);
        const v = this._vel;
        switch (e.key) {
            case 'ArrowLeft': v.set(0, -k, 0); break;
            case 'ArrowRight': v.set(0, k, 0); break;
            case 'ArrowUp': v.set(-k, 0, 0); break;
            case 'ArrowDown': v.set(k, 0, 0); break;
            case '+':
            case '=':
                this.onZoom(KEY_ZOOM);
                this._zoomed();
                this.onInteract('key');
                this._consume(e);
                return;
            case '-':
                this.onZoom(1 / KEY_ZOOM);
                this._zoomed();
                this.onInteract('key');
                this._consume(e);
                return;
            case 'r':
            case 'R':
            case '0':
                this.onReset();
                this._consume(e);
                return;
            default:
                return;                             // digits, Escape, etc. bubble
        }
        this.onVelocity(v);
        this.onInteract('key');
        this._consume(e);
    }

    _consume(e) {
        e.preventDefault();
        e.stopPropagation();
    }
}
