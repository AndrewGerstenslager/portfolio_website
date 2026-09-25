import { BufferGeometry, BufferAttribute, DynamicDrawUsage, Line } from 'three';

/** Samples kept per trail: 30 Hz × 3 s of history */
export const TRAIL_SAMPLES = 90;

/**
 * Trail — fixed-size ring buffer rendered as one Line.
 *
 * Samples are stored oldest → newest with the newest in the last slot, so
 * the drawn range is always the contiguous tail of the buffer. The last
 * slot is the live head: setHead() moves it every frame, push() commits it
 * and opens a new one. No allocation after construction.
 */
export class Trail {
    constructor(material) {
        const n = TRAIL_SAMPLES;
        this.positions = new Float32Array(n * 3);
        this.births = new Float32Array(n);
        this.filled = 0;
        this.acc = 0;

        this.geometry = new BufferGeometry();
        this._pos = new BufferAttribute(this.positions, 3).setUsage(DynamicDrawUsage);
        this._birth = new BufferAttribute(this.births, 1).setUsage(DynamicDrawUsage);
        this.geometry.setAttribute('position', this._pos);
        this.geometry.setAttribute('aBirth', this._birth);
        this.geometry.setDrawRange(n, 0);

        this.line = new Line(this.geometry, material);
        this.line.frustumCulled = false;
        this.line.visible = false;
    }

    /** Commit the current head and start a new one at p (time t, seconds) */
    push(p, t) {
        this._write(p, t);
        if (this.filled > 0) {
            this.positions.copyWithin(0, 3);
            this.births.copyWithin(0, 1);
            this._write(p, t);
        }
        this.filled = Math.min(this.filled + 1, TRAIL_SAMPLES);
        this._commit();
    }

    /** Move the live head without committing a sample */
    setHead(p, t) {
        if (this.filled === 0) {
            this.push(p, t);
            return;
        }
        this._write(p, t);
        this._commit();
    }

    reset() {
        this.filled = 0;
        this.acc = 0;
        this.geometry.setDrawRange(TRAIL_SAMPLES, 0);
        this.line.visible = false;
    }

    dispose() {
        this.geometry.dispose();
    }

    // Whole-buffer uploads: copyWithin shifts every sample anyway, and
    // skipping addUpdateRange keeps the steady state allocation-free.
    _write(p, t) {
        const i = (TRAIL_SAMPLES - 1) * 3;
        this.positions[i] = p.x;
        this.positions[i + 1] = p.y;
        this.positions[i + 2] = p.z;
        this.births[TRAIL_SAMPLES - 1] = t;
    }

    _commit() {
        this._pos.needsUpdate = true;
        this._birth.needsUpdate = true;
        this.geometry.setDrawRange(TRAIL_SAMPLES - this.filled, this.filled);
        this.line.visible = this.filled > 1;
    }
}
