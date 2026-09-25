import {
    AdditiveBlending, BackSide, BufferAttribute, BufferGeometry, Color, DoubleSide, DynamicDrawUsage,
    EdgesGeometry, FrontSide, Group, InstancedMesh, Line, LineBasicMaterial, LineCurve3, LineSegments,
    Mesh, MeshBasicMaterial, PlaneGeometry, Points, RingGeometry, ShaderMaterial, SphereGeometry,
    TubeGeometry, Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as S from './shaders.js';
import { Trail } from './trail.js';
import { seededRandom, _v0, _v1, _v2, _v3, _v4, _q0, _m0 } from './math.js';

/**
 * Pure scene builders. Each returns { object3D, material(s), ... } and never
 * touches the DOM. Shared uniform objects (U) are owned by globe.js.
 */

export const R = 1.2;

export const COLORS = {
    bg: 0x0a0e27,
    deep: 0x04061a,
    core: 0x141c48,
    brand: 0xFFA234,
    hot: 0xFFD27A,
    brandCore: 0xFFE7C2,
    cyan: 0x5CE1E6,
    atmo: 0xFF8A1F,
    starBlue: 0xAFC3FF,
    white: 0xFFFFFF,
};

// Radii as multiples of R (B's --globe-fit values assume these)
export const ATMO_R = 1.16;
export const ORBIT_R = 1.42;
export const BEZEL_R = 1.55;

const glow = (opts) => new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    ...opts,
});

// ── Backdrop ───────────────────────────────────────────
export function buildBackdrop(U) {
    const material = new ShaderMaterial({
        uniforms: {
            uResolution: U.uResolution,
            uCenterPx: U.uCenterPx,
            uRadiusPx: U.uRadiusPx,
            uPixelRatio: U.uPixelRatio,
            uCore: { value: new Color(COLORS.core) },
            uBg: { value: new Color(COLORS.bg) },
            uDeep: { value: new Color(COLORS.deep) },
            uGrid: { value: new Color(COLORS.brand) },
            uGridAlpha: { value: 0.035 },
        },
        vertexShader: S.backdropVertex,
        fragmentShader: S.backdropFragment,
        depthTest: false,
        depthWrite: false,
    });
    const mesh = new Mesh(new PlaneGeometry(2, 2), material);
    mesh.frustumCulled = false;
    mesh.renderOrder = -10;
    return { object3D: mesh, material };
}

// ── Stars ──────────────────────────────────────────────
export function buildStars(count, U) {
    const rand = seededRandom(1977);
    const pos = new Float32Array(count * 3);
    const size = new Float32Array(count);
    const phase = new Float32Array(count);
    const speed = new Float32Array(count);
    const bright = new Float32Array(count);
    const color = new Float32Array(count * 3);
    const blue = new Color(COLORS.starBlue);
    const white = new Color(COLORS.white);
    const amber = new Color(COLORS.brand);

    for (let i = 0; i < count; i++) {
        pos[i * 3] = rand();
        pos[i * 3 + 1] = rand();
        pos[i * 3 + 2] = 30 + rand() * 30;
        size[i] = 0.6 + Math.pow(rand(), 2.2) * 1.4;
        phase[i] = rand() * Math.PI * 2;
        speed[i] = 0.5 + rand() * 1.3;
        bright[i] = rand();
        const k = rand();
        const c = k < 0.8 ? blue : k < 0.92 ? white : amber;
        c.toArray(color, i * 3);
    }

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(pos, 3));
    geometry.setAttribute('aSize', new BufferAttribute(size, 1));
    geometry.setAttribute('aPhase', new BufferAttribute(phase, 1));
    geometry.setAttribute('aSpeed', new BufferAttribute(speed, 1));
    geometry.setAttribute('aBright', new BufferAttribute(bright, 1));
    geometry.setAttribute('aColor', new BufferAttribute(color, 3));

    const uniforms = {
        uTime: U.uTime,
        uPixelRatio: U.uPixelRatio,
        uDrift: { value: 0 },
        uAzHalf: { value: 1 },
        uElHalf: { value: 0.8 },
        uOpacity: { value: 1 },
    };
    const material = glow({ uniforms, vertexShader: S.starsVertex, fragmentShader: S.starsFragment });
    const points = new Points(geometry, material);
    points.frustumCulled = false;
    points.renderOrder = -5;

    const group = new Group();
    group.add(points);

    return {
        object3D: group,
        points,
        material,
        uniforms,
        setCount(n) { geometry.setDrawRange(0, Math.min(n, count)); },
    };
}

// ── Geodesic helpers ───────────────────────────────────

/** Unique vertices of the icosahedron, in first-seen order (node ids 0..161) */
export function uniqueVertices(icoGeometry) {
    const p = icoGeometry.attributes.position;
    const seen = new Set();
    const out = [];
    for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        const key = `${x.toFixed(5)},${y.toFixed(5)},${z.toFixed(5)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(new Vector3(x, y, z));
    }
    return out;
}

// Lower seeds reveal first, so the draw-in runs north → south
const revealSeed = (unitY, rand) => (1 - (unitY + 1) / 2) * 0.85 + rand() * 0.15;

// ── Wire: 480 tubes merged into one draw ───────────────
export function buildWire(icoGeometry, U) {
    const rand = seededRandom(4242);
    const edges = new EdgesGeometry(icoGeometry);
    const ep = edges.attributes.position;
    const tubes = [];
    const a = new Vector3(), b = new Vector3(), ab = new Vector3(), mid = new Vector3(), v = new Vector3();

    for (let i = 0; i < ep.count; i += 2) {
        a.fromBufferAttribute(ep, i);
        b.fromBufferAttribute(ep, i + 1);
        const tube = new TubeGeometry(new LineCurve3(a.clone(), b.clone()), 1, 0.0075, 8, false);
        tube.deleteAttribute('normal');
        tube.deleteAttribute('uv');

        const tp = tube.attributes.position;
        const centers = new Float32Array(tp.count * 3);
        const seeds = new Float32Array(tp.count);
        ab.subVectors(b, a);
        const len2 = ab.lengthSq();
        const seed = revealSeed(mid.addVectors(a, b).normalize().y, rand);

        for (let j = 0; j < tp.count; j++) {
            v.fromBufferAttribute(tp, j);
            const t = Math.min(1, Math.max(0, v.sub(a).dot(ab) / len2));
            v.copy(a).addScaledVector(ab, t).toArray(centers, j * 3);
            seeds[j] = seed;
        }
        tube.setAttribute('aCenter', new BufferAttribute(centers, 3));
        tube.setAttribute('aSeed', new BufferAttribute(seeds, 1));
        tubes.push(tube);
    }

    const geometry = mergeGeometries(tubes);
    tubes.forEach((t) => t.dispose());
    edges.dispose();

    const material = glow({
        uniforms: {
            uColor: U.uColor, uHot: U.uHot, uReveal: U.uReveal, uScanY: U.uScanY, uScanAmt: U.uScanAmt,
            uPingDir: U.uPingDir, uPingT: U.uPingT, uRadiusScale: U.uRadiusScale,
            uIntensity: { value: 0.85 },
        },
        vertexShader: S.wireVertex,
        fragmentShader: S.wireFragment,
    });
    const mesh = new Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = 3;
    return { object3D: mesh, material, edgeCount: ep.count / 2 };
}

// ── Nodes: one Points of 162 ───────────────────────────
export function buildNodes(uniqueVerts, U) {
    const rand = seededRandom(9001);
    const n = uniqueVerts.length;
    const pos = new Float32Array(n * 3);
    const dirs = new Float32Array(n * 3);
    const phase = new Float32Array(n);
    const twinkle = new Float32Array(n);
    const seed = new Float32Array(n);

    uniqueVerts.forEach((p, i) => {
        p.toArray(pos, i * 3);
        _v0.copy(p).normalize().toArray(dirs, i * 3);
        phase[i] = rand();
        twinkle[i] = rand();
        seed[i] = revealSeed(_v0.y, rand);
    });

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(pos, 3));
    geometry.setAttribute('aPhase', new BufferAttribute(phase, 1));
    geometry.setAttribute('aTwinkle', new BufferAttribute(twinkle, 1));
    geometry.setAttribute('aSeed', new BufferAttribute(seed, 1));

    const material = glow({
        uniforms: {
            uColor: U.uColor, uHot: U.uHot, uReveal: U.uReveal, uScanY: U.uScanY, uScanAmt: U.uScanAmt,
            uPingDir: U.uPingDir, uPingT: U.uPingT, uTime: U.uTime, uPxScale: U.uPxScale,
            uPixelRatio: U.uPixelRatio, uIntensity: { value: 1 },
        },
        vertexShader: S.nodesVertex,
        fragmentShader: S.nodesFragment,
    });
    const points = new Points(geometry, material);
    points.frustumCulled = false;
    points.renderOrder = 4;
    return { object3D: points, material, nodeDirs: dirs, count: n };
}

// ── Atmosphere + inner glow ────────────────────────────
export function buildAtmosphere(U) {
    const material = glow({
        uniforms: {
            uColor: { value: new Color(COLORS.atmo) },
            uAtmo: U.uAtmo,
            uRadius: { value: R },
            uOuter: { value: ATMO_R },
            uStrength: { value: 0.65 },
        },
        vertexShader: S.atmosphereVertex,
        fragmentShader: S.atmosphereFragment,
        side: BackSide,
    });
    const mesh = new Mesh(new SphereGeometry(R * ATMO_R, 64, 48), material);
    mesh.renderOrder = 0;
    return { object3D: mesh, material };
}

export function buildInnerGlow(U) {
    const material = glow({
        uniforms: { uColor: { value: new Color(COLORS.brand) }, uAtmo: U.uAtmo },
        vertexShader: S.innerGlowVertex,
        fragmentShader: S.innerGlowFragment,
        side: FrontSide,
    });
    const mesh = new Mesh(new SphereGeometry(R * 0.99, 64, 48), material);
    mesh.renderOrder = 1;
    return { object3D: mesh, material };
}

// ── Orbit ring + satellites ────────────────────────────
export function buildOrbit(U) {
    const segs = 256;
    const radius = R * ORBIT_R;
    // Open Line with a duplicated closing vertex (angle 2π) so the dash
    // varying never interpolates across the 2π → 0 seam.
    const pos = new Float32Array((segs + 1) * 3);
    const angle = new Float32Array(segs + 1);
    for (let i = 0; i <= segs; i++) {
        const a = (i / segs) * Math.PI * 2;
        pos[i * 3] = Math.cos(a) * radius;
        pos[i * 3 + 1] = Math.sin(a) * radius;
        angle[i] = a;
    }
    const ringGeo = new BufferGeometry();
    ringGeo.setAttribute('position', new BufferAttribute(pos, 3));
    ringGeo.setAttribute('aAngle', new BufferAttribute(angle, 1));

    const uniforms = {
        uSatAngle: { value: 0 },
        uOpacity: { value: 1 },
    };
    const ringMat = glow({
        uniforms: {
            uColor: { value: new Color(COLORS.brand) },
            uWake: { value: new Color(COLORS.cyan) },
            uSatAngle: uniforms.uSatAngle,
            uOpacity: uniforms.uOpacity,
        },
        vertexShader: S.ringVertex,
        fragmentShader: S.ringFragment,
    });
    const ring = new Line(ringGeo, ringMat);
    ring.frustumCulled = false;
    ring.renderOrder = 2;

    const satGeo = new BufferGeometry();
    satGeo.setAttribute('position', new BufferAttribute(new Float32Array(6), 3));
    satGeo.setAttribute('aOffset', new BufferAttribute(new Float32Array([0, Math.PI]), 1));
    const satMat = glow({
        uniforms: {
            uColor: { value: new Color(COLORS.cyan).multiplyScalar(2.5) },
            uSatAngle: uniforms.uSatAngle,
            uOpacity: uniforms.uOpacity,
            uRingRadius: { value: radius },
            uPixelRatio: U.uPixelRatio,
        },
        vertexShader: S.satsVertex,
        fragmentShader: S.satsFragment,
    });
    const sats = new Points(satGeo, satMat);
    sats.frustumCulled = false;
    sats.renderOrder = 2;

    const tilt = new Group();
    tilt.rotation.set(1.15, 0, 0.41, 'ZXY');
    tilt.add(ring, sats);

    const pivot = new Group();       // precesses about world Y
    pivot.add(tilt);

    return { object3D: pivot, ring, sats, materials: [ringMat, satMat], uniforms };
}

// ── Bezel (faces the camera) ───────────────────────────
export function buildBezel() {
    const rOut = R * BEZEL_R;
    const ringSegs = 192;
    const ticks = 120;
    const pts = [];
    for (let i = 0; i < ringSegs; i++) {
        const a0 = (i / ringSegs) * Math.PI * 2;
        const a1 = ((i + 1) / ringSegs) * Math.PI * 2;
        pts.push(Math.cos(a0) * rOut, Math.sin(a0) * rOut, 0, Math.cos(a1) * rOut, Math.sin(a1) * rOut, 0);
    }
    for (let i = 0; i < ticks; i++) {
        const a = (i / ticks) * Math.PI * 2;
        const rIn = rOut - (i % 10 === 0 ? 0.07 : 0.03);
        pts.push(Math.cos(a) * rOut, Math.sin(a) * rOut, 0, Math.cos(a) * rIn, Math.sin(a) * rIn, 0);
    }
    const lineGeo = new BufferGeometry();
    lineGeo.setAttribute('position', new BufferAttribute(new Float32Array(pts), 3));
    const lineMat = new LineBasicMaterial({ color: COLORS.brand, transparent: true, opacity: 0.3, depthWrite: false });
    const lines = new LineSegments(lineGeo, lineMat);
    lines.frustumCulled = false;
    lines.renderOrder = 7;

    // 4 cardinal notches just outside the ring, pointing inward
    const tri = [];
    for (let k = 0; k < 4; k++) {
        const a = k * Math.PI / 2;
        const c = Math.cos(a), s = Math.sin(a);
        const apex = rOut + 0.012, base = rOut + 0.07, hw = 0.03;
        tri.push(
            c * apex, s * apex, 0,
            c * base - s * hw, s * base + c * hw, 0,
            c * base + s * hw, s * base - c * hw, 0,
        );
    }
    const notchGeo = new BufferGeometry();
    notchGeo.setAttribute('position', new BufferAttribute(new Float32Array(tri), 3));
    const notchMat = new MeshBasicMaterial({
        color: COLORS.brand, transparent: true, opacity: 0.5, depthWrite: false, side: DoubleSide,
    });
    const notches = new Mesh(notchGeo, notchMat);
    notches.frustumCulled = false;
    notches.renderOrder = 7;

    const spinner = new Group();     // slow roll about its own z
    spinner.add(lines, notches);
    const group = new Group();       // copies the camera quaternion each frame
    group.add(spinner);

    return {
        object3D: group,
        spinner,
        materials: [lineMat, notchMat],
        setOpacity(o) {
            lineMat.opacity = 0.3 * o;
            notchMat.opacity = 0.5 * o;
        },
    };
}

// ── Target marker ──────────────────────────────────────
export function buildMarker() {
    const hdr = (k) => new Color(COLORS.brandCore).multiplyScalar(k);
    const ringGeo = new RingGeometry(0.045, 0.055, 40);
    const mat = (color) => new MeshBasicMaterial({
        color, transparent: true, opacity: 0, depthWrite: false, side: DoubleSide, blending: AdditiveBlending,
    });
    // Spec asked ×3.0 / ×2.5, but bloom then fills the ring's hole and it
    // reads as a white blob. The core sits just under the bloom threshold so
    // it stays a crisp ring; the expanding ping and the beam carry the glow.
    const coreMat = mat(hdr(0.6));
    const pingMat = mat(hdr(1.3));
    const core = new Mesh(ringGeo, coreMat);
    const ping = new Mesh(ringGeo, pingMat);

    const beamGeo = new BufferGeometry();
    beamGeo.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0, 0, 0, R * 0.3]), 3));
    const beamMat = new LineBasicMaterial({
        color: hdr(1.2), transparent: true, opacity: 0, depthWrite: false, blending: AdditiveBlending,
    });
    const beam = new Line(beamGeo, beamMat);

    for (const o of [core, ping, beam]) {
        o.frustumCulled = false;
        o.renderOrder = 6;
    }
    const group = new Group();
    group.add(core, ping, beam);
    group.visible = false;

    return {
        object3D: group,
        core, ping, beam,
        materials: [coreMat, pingMat, beamMat],
        setOpacity(vis, pingAlpha, pingScale) {
            coreMat.opacity = vis;
            beamMat.opacity = 0.8 * vis;
            pingMat.opacity = pingAlpha * vis;
            ping.scale.setScalar(pingScale);
        },
    };
}

// ── Tracers: instanced heads + ring-buffer trails ──────
const TRAIL_HZ = 30;
const PRECESS = (4 * Math.PI) / 180;   // plane precession, rad/s

export function buildTracers(count, U) {
    const rand = seededRandom(31337);
    const size = 0.03;
    const triGeo = new BufferGeometry();
    triGeo.setAttribute('position', new BufferAttribute(new Float32Array([
        0, size, 0, -size * 0.5, 0, 0, size * 0.5, 0, 0,
    ]), 3));

    const headUniforms = {
        uColor: { value: new Color(COLORS.cyan).multiplyScalar(1.8) },
        uOpacity: { value: 0.9 },
    };
    const headMat = glow({
        uniforms: headUniforms,
        vertexShader: S.headsVertex,
        fragmentShader: S.headsFragment,
        side: DoubleSide,
    });
    const heads = new InstancedMesh(triGeo, headMat, count);
    heads.instanceMatrix.setUsage(DynamicDrawUsage);
    heads.frustumCulled = false;
    heads.renderOrder = 5.1;

    const trailUniforms = {
        uTime: U.uTime,
        uHead: { value: new Color(COLORS.cyan) },
        uTail: { value: new Color(COLORS.brand) },
        uTracersAlpha: { value: 1 },
    };
    const trailMat = glow({ uniforms: trailUniforms, vertexShader: S.trailVertex, fragmentShader: S.trailFragment });

    const trailGroup = new Group();
    const state = [];
    for (let i = 0; i < count; i++) {
        const u = new Vector3(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1).normalize();
        const v = new Vector3(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1);
        v.addScaledVector(u, -u.dot(v)).normalize();
        const axis = new Vector3(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1).normalize();
        const trail = new Trail(trailMat);
        trail.line.renderOrder = 5;
        trailGroup.add(trail.line);
        state.push({
            u, v, axis, trail,
            r: R + 0.05 + rand() * 0.07,
            w: 0.35 + rand() * 0.25,
            theta: rand() * Math.PI * 2,
        });
    }

    const group = new Group();
    group.add(trailGroup, heads);

    let active = count;

    return {
        object3D: group,
        heads,
        trailGroup,
        materials: [headMat, trailMat],
        headUniforms,
        trailUniforms,
        trails: state.map((s) => s.trail),
        get count() { return active; },
        setCount(n) {
            active = Math.min(n, count);
            heads.count = active;
            state.forEach((s, i) => { s.trail.line.visible = i < active && s.trail.filled > 1; });
        },
        resetTrails() { state.forEach((s) => s.trail.reset()); },

        /** Advance paths (when motion), rebuild head matrices, feed trails. No allocation. */
        update(dt, time, deff, motion, feedTrails) {
            const scale = Math.min(2.2, Math.max(0.8, (1.4 * 400) / deff));
            const step = 1 / TRAIL_HZ;
            for (let i = 0; i < active; i++) {
                const s = state[i];
                if (motion) {
                    s.theta += s.w * dt;
                    _q0.setFromAxisAngle(s.axis, PRECESS * dt);
                    s.u.applyQuaternion(_q0).normalize();
                    s.v.applyQuaternion(_q0);
                    s.v.addScaledVector(s.u, -s.u.dot(s.v)).normalize();
                }
                const c = Math.cos(s.theta), sn = Math.sin(s.theta);
                const up = _v0.copy(s.u).multiplyScalar(c).addScaledVector(s.v, sn);
                const pos = _v1.copy(up).multiplyScalar(s.r);
                const fwd = _v2.copy(s.v).multiplyScalar(c).addScaledVector(s.u, -sn);
                const right = _v3.crossVectors(fwd, up);
                _m0.makeBasis(right, fwd, up).scale(_v4.setScalar(scale)).setPosition(pos);
                heads.setMatrixAt(i, _m0);

                if (feedTrails) {
                    const tr = s.trail;
                    tr.acc += dt;
                    if (tr.acc >= step || tr.filled === 0) {
                        tr.acc %= step;
                        tr.push(pos, time);
                    } else {
                        tr.setHead(pos, time);
                    }
                }
            }
            heads.instanceMatrix.needsUpdate = true;
        },

        dispose() {
            heads.dispose();
            triGeo.dispose();
            state.forEach((s) => s.trail.dispose());
        },
    };
}
