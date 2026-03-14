import * as THREE from 'three';

/**
 * WireframeGlobe — Three.js scene with an icosahedron wireframe globe,
 * vertex spheres, glow points, and flying triangle tracers.
 *
 * Rendering only — no DOM/UI manipulation, no input handling.
 */
export class WireframeGlobe {
    constructor(canvas) {
        this.canvas = canvas;
        this._globeRadius = 1.2;

        // Scene
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x0a0e27);

        // Camera — use viewport dimensions (renderer.setSize overwrites canvas inline style)
        const w = window.innerWidth;
        const h = window.innerHeight;
        this._fovDeg = 45;
        this.camera = new THREE.PerspectiveCamera(this._fovDeg, w / h, 0.1, 1000);

        // Zoom bounds (will be recalculated by fitToContainer)
        this.minZoom = 3;
        this.maxZoom = 15;
        this._baseZoom = 5;
        this.camera.position.z = 5;

        // Renderer
        this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
        this.renderer.setSize(w, h);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

        // Build scene contents
        this._buildGlobe();
        this._addVertexSpheres();
        this._addGlowPoints();
        this._addFlyingTriangles();

        // Momentum / physics
        this.rotationVelocity = new THREE.Vector3(0, 0.002, 0);
        this.damping = 0.98;
        this.minRotationSpeed = 0.0016;
        this.rotationEnabled = true;

        // Zoom animation
        this.targetZoom = null;
        this.zoomSpeed = 0.15;

        // Timing
        this._lastTime = performance.now();

        // Start loop
        this._animate = this._animate.bind(this);
        requestAnimationFrame(this._animate);

        // Resize is driven externally by main.js (so HUD can be sized first)
    }

    // ── Public API ─────────────────────────────────────────

    /** Apply an incremental rotation quaternion to the globe */
    applyRotation(quaternion) {
        this.globe.quaternion.multiplyQuaternions(quaternion, this.globe.quaternion);
        this._syncLayers();
    }

    /** Set rotation velocity (axis * angle) for momentum */
    setVelocity(vel) {
        this.rotationVelocity.copy(vel);
    }

    /** Apply a signed zoom delta */
    applyZoomDelta(delta) {
        this.targetZoom = null;
        const z = this.camera.position.z + delta;
        this.camera.position.z = THREE.MathUtils.clamp(z, this.minZoom, this.maxZoom);
    }

    /** Animate zoom to a specific distance */
    zoomTo(target) {
        this.targetZoom = THREE.MathUtils.clamp(target, this.minZoom, this.maxZoom);
    }

    /** Current zoom as 0–1 fraction (min → max) */
    get zoomFraction() {
        return (this.camera.position.z - this.minZoom) / (this.maxZoom - this.minZoom);
    }

    /** Set zoom from a 0–1 fraction */
    set zoomFraction(f) {
        this.targetZoom = null;
        const clamped = THREE.MathUtils.clamp(f, 0, 1);
        this.camera.position.z = this.minZoom + clamped * (this.maxZoom - this.minZoom);
    }

    /** Current velocity magnitude, normalized to roughly 0–1 */
    get velocityFraction() {
        return Math.min(this.rotationVelocity.length() / 0.05, 1);
    }

    /** Show / hide flying triangles */
    setTrianglesVisible(visible) {
        this.flyingTriangles.forEach(t => { t.mesh.visible = visible; });
    }

    /**
     * Size the globe so it fits a target circle within a HUD container.
     * @param {HTMLElement} hudEl       — the HUD container element
     * @param {number}      circleFrac — circle diameter as fraction of HUD width (e.g. 0.56)
     */
    fitToContainer(hudEl, circleFrac = 0.56) {
        const hudRect = hudEl.getBoundingClientRect();
        const canvasH = window.innerHeight;

        // Circle's pixel diameter
        const circlePx = circleFrac * hudRect.width;

        // Camera distance to make globe project to that size
        // projected_diameter = 2 * R * canvasH / (2 * Z * tan(fov/2))
        this._tanHalf = Math.tan(THREE.MathUtils.degToRad(this._fovDeg / 2));
        const z = (this._globeRadius * canvasH) / (circlePx * this._tanHalf);

        this._baseZoom = z;
        // Globe can never be LARGER than the circle (minZoom = base distance).
        // User can only zoom out (further away).
        this.minZoom = z;
        this.maxZoom = z * 3;

        // Preserve current zoom ratio if user had zoomed out, otherwise reset to base
        const currentRatio = this.camera.position.z / (this._prevBaseZoom || z);
        this._prevBaseZoom = z;
        this.camera.position.z = THREE.MathUtils.clamp(z * currentRatio, this.minZoom, this.maxZoom);

        // Store pixel offsets for continuous camera correction
        const canvasRect = this.canvas.getBoundingClientRect();
        const hudCenterX = hudRect.left + hudRect.width / 2;
        const hudCenterY = hudRect.top + hudRect.height / 2;
        const canvasCenterX = canvasRect.left + canvasRect.width / 2;
        const canvasCenterY = canvasRect.top + canvasRect.height / 2;
        this._xOffsetPixels = hudCenterX - canvasCenterX;
        this._yOffsetPixels = hudCenterY - canvasCenterY;
        this._canvasH = canvasH;

        // Apply offset immediately
        this._updateCameraOffset();
    }

    /** Recalculate camera X/Y based on current Z so globe stays centered on HUD */
    _updateCameraOffset() {
        if (this._yOffsetPixels == null || !this._tanHalf) return;
        const visibleHeight = 2 * this.camera.position.z * this._tanHalf;
        const pxToWorld = visibleHeight / this._canvasH;
        this.camera.position.x = -(this._xOffsetPixels * pxToWorld);
        this.camera.position.y = this._yOffsetPixels * pxToWorld;
    }

    // ── Scene building ─────────────────────────────────────

    _buildGlobe() {
        const radius = 1.2;
        const geometry = new THREE.IcosahedronGeometry(radius, 3);
        const edges = new THREE.EdgesGeometry(geometry);
        const positions = edges.attributes.position;

        const group = new THREE.Group();

        const material = new THREE.ShaderMaterial({
            uniforms: {
                color: { value: new THREE.Color(0xFFA234) },
                cameraZ: { value: this.camera.position.z },
            },
            vertexShader: `
                varying vec3 vViewPosition;
                void main() {
                    vec4 mv = modelViewMatrix * vec4(position, 1.0);
                    vViewPosition = mv.xyz;
                    gl_Position = projectionMatrix * mv;
                }
            `,
            fragmentShader: `
                uniform vec3 color;
                uniform float cameraZ;
                varying vec3 vViewPosition;
                void main() {
                    float depth = -vViewPosition.z;
                    float r = 1.2;
                    float near = cameraZ - r * 1.5;
                    float far  = cameraZ + r * 1.5;
                    float t = smoothstep(near, far, depth);
                    float opacity = mix(1.0, 0.07, t);
                    gl_FragColor = vec4(color, opacity);
                    #include <colorspace_fragment>
                }
            `,
            transparent: true,
            depthWrite: false,
        });

        const tubeSegs = 8;
        const tubeRadius = 0.0075;

        for (let i = 0; i < positions.count; i += 2) {
            const a = new THREE.Vector3(positions.getX(i), positions.getY(i), positions.getZ(i));
            const b = new THREE.Vector3(positions.getX(i+1), positions.getY(i+1), positions.getZ(i+1));
            const tube = new THREE.TubeGeometry(new THREE.LineCurve3(a, b), 1, tubeRadius, tubeSegs, false);
            group.add(new THREE.Mesh(tube, material));
        }

        this.globe = group;
        this.scene.add(group);
        this._layers = [group];
        this._globeMaterial = material;
        this._baseGeometry = geometry;
    }

    _addVertexSpheres() {
        const verts = this._baseGeometry.attributes.position;
        const seen = new Set();
        const unique = [];

        for (let i = 0; i < verts.count; i++) {
            const key = `${verts.getX(i).toFixed(5)},${verts.getY(i).toFixed(5)},${verts.getZ(i).toFixed(5)}`;
            if (!seen.has(key)) {
                seen.add(key);
                unique.push(new THREE.Vector3(verts.getX(i), verts.getY(i), verts.getZ(i)));
            }
        }

        const sphereGeo = new THREE.SphereGeometry(0.02, 8, 8);
        const mat = new THREE.ShaderMaterial({
            uniforms: {
                color: { value: new THREE.Color(0xFFA234) },
                cameraZ: { value: this.camera.position.z },
            },
            vertexShader: `
                varying vec3 vViewPosition;
                void main() {
                    vec4 mv = modelViewMatrix * vec4(position, 1.0);
                    vViewPosition = mv.xyz;
                    gl_Position = projectionMatrix * mv;
                }
            `,
            fragmentShader: `
                uniform vec3 color;
                uniform float cameraZ;
                varying vec3 vViewPosition;
                void main() {
                    float depth = -vViewPosition.z;
                    float r = 1.2;
                    float near = cameraZ - r * 1.5;
                    float far  = cameraZ + r * 1.5;
                    float t = smoothstep(near, far, depth);
                    float opacity = mix(1.0, 0.07, t);
                    gl_FragColor = vec4(color, opacity);
                    #include <colorspace_fragment>
                }
            `,
            transparent: true,
            depthWrite: false,
        });

        this._vertexMat = mat;
        const grp = new THREE.Group();
        unique.forEach(v => {
            const m = new THREE.Mesh(sphereGeo, mat);
            m.position.copy(v);
            grp.add(m);
        });
        this.scene.add(grp);
        this._layers.push(grp);
    }

    _addGlowPoints() {
        const count = 200;
        const pos = new Float32Array(count * 3);
        const r = 1.21;

        for (let i = 0; i < count; i++) {
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(Math.random() * 2 - 1);
            pos[i*3]   = r * Math.sin(phi) * Math.cos(theta);
            pos[i*3+1] = r * Math.sin(phi) * Math.sin(theta);
            pos[i*3+2] = r * Math.cos(phi);
        }

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        const pts = new THREE.Points(geo, new THREE.PointsMaterial({
            color: 0xFFA234, size: 0.02, transparent: true, opacity: 0,
        }));
        this.scene.add(pts);
        this._layers.push(pts);
    }

    _addFlyingTriangles() {
        this.flyingTriangles = [];
        const baseR = 1.2;

        for (let i = 0; i < 5; i++) {
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(Math.random() * 2 - 1);
            const radius = baseR + 0.05 + Math.random() * 0.1;
            const speed = 0.3 + Math.random() * 0.3;

            const size = 0.03;
            const geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
                0, size, 0, -size*0.5, 0, 0, size*0.5, 0, 0
            ]), 3));

            const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
                color: 0xffffff, side: THREE.DoubleSide, transparent: true, opacity: 0.8,
            }));
            this.globe.add(mesh);

            const vTheta = (Math.random() - 0.5) * 2;
            const vPhi = (Math.random() - 0.5) * 2;
            const mag = Math.hypot(vTheta, vPhi);

            const tri = {
                mesh, theta, phi, radius, speed,
                velocityTheta: (vTheta / mag) * speed,
                velocityPhi: (vPhi / mag) * speed,
                tracerPoints: [],
                tracerLine: null,
            };
            this.flyingTriangles.push(tri);
            this._updateTriPos(tri);
        }
    }

    // ── Animation loop ─────────────────────────────────────

    _animate(now) {
        requestAnimationFrame(this._animate);
        const dt = (now - this._lastTime) / 1000;
        this._lastTime = now;

        // Update shader uniforms
        const z = this.camera.position.z;
        this._globeMaterial.uniforms.cameraZ.value = z;
        if (this._vertexMat) this._vertexMat.uniforms.cameraZ.value = z;

        // Smooth zoom
        if (this.targetZoom !== null) {
            const diff = this.targetZoom - z;
            if (Math.abs(diff) > 0.01) {
                this.camera.position.z += diff * this.zoomSpeed;
            } else {
                this.camera.position.z = this.targetZoom;
                this.targetZoom = null;
            }
        }

        // Momentum rotation
        if (this.rotationEnabled) {
            const mag = this.rotationVelocity.length();
            if (mag > 0.00001) {
                const axis = this.rotationVelocity.clone().normalize();
                const q = new THREE.Quaternion().setFromAxisAngle(axis, mag);
                this.globe.quaternion.multiplyQuaternions(q, this.globe.quaternion);
                this._syncLayers();
                this.rotationVelocity.multiplyScalar(this.damping);
                if (this.rotationVelocity.length() < this.minRotationSpeed) {
                    this.rotationVelocity.normalize().multiplyScalar(this.minRotationSpeed);
                }
            }
        }

        // Keep globe centered on HUD as zoom changes
        this._updateCameraOffset();

        // Flying triangles
        this._updateTriangles(dt);

        this.renderer.render(this.scene, this.camera);
    }

    _syncLayers() {
        const q = this.globe.quaternion;
        this._layers.forEach(l => l.quaternion.copy(q));
    }

    // ── Flying triangle logic ──────────────────────────────

    _updateTriPos(tri) {
        const { radius: r, phi, theta } = tri;
        const x = r * Math.sin(phi) * Math.cos(theta);
        const y = r * Math.sin(phi) * Math.sin(theta);
        const z = r * Math.cos(phi);
        tri.mesh.position.set(x, y, z);

        // Orient triangle flat on sphere surface
        const tanTheta = new THREE.Vector3(-Math.sin(theta), Math.cos(theta), 0).normalize();
        const tanPhi = new THREE.Vector3(
            Math.cos(phi)*Math.cos(theta), Math.cos(phi)*Math.sin(theta), -Math.sin(phi)
        ).normalize();
        const dir = tanTheta.multiplyScalar(tri.velocityTheta)
            .add(tanPhi.multiplyScalar(tri.velocityPhi)).normalize();
        const up = new THREE.Vector3(x, y, z).normalize();
        const right = new THREE.Vector3().crossVectors(dir, up).normalize();
        const mat = new THREE.Matrix4().makeBasis(right, dir, up);
        tri.mesh.rotation.setFromRotationMatrix(mat);

        // Scale by distance
        const d = tri.mesh.position.distanceTo(this.camera.position);
        const t = (d - this.minZoom) / (this.maxZoom - this.minZoom);
        const s = THREE.MathUtils.clamp(2.5 - t * 2, 0.5, 2.5);
        tri.mesh.scale.setScalar(s);
    }

    _updateTriangles(dt) {
        const now = Date.now();
        const tracerLife = 5000;

        this.flyingTriangles.forEach(tri => {
            tri.theta += tri.velocityTheta * dt;
            tri.phi += tri.velocityPhi * dt;

            if (tri.phi < 0) { tri.phi = -tri.phi; tri.velocityPhi *= -1; tri.theta += Math.PI; }
            if (tri.phi > Math.PI) { tri.phi = 2*Math.PI - tri.phi; tri.velocityPhi *= -1; tri.theta += Math.PI; }
            tri.theta = ((tri.theta % (Math.PI*2)) + Math.PI*2) % (Math.PI*2);

            this._updateTriPos(tri);

            // Tracers
            tri.tracerPoints.push({ position: tri.mesh.position.clone(), time: now });
            tri.tracerPoints = tri.tracerPoints.filter(p => now - p.time < tracerLife);

            if (tri.tracerLine) {
                this.globe.remove(tri.tracerLine);
                tri.tracerLine.geometry.dispose();
            }

            if (tri.tracerPoints.length > 1) {
                const positions = [];
                const colors = [];
                tri.tracerPoints.forEach(p => {
                    positions.push(p.position.x, p.position.y, p.position.z);
                    const alpha = 1 - (now - p.time) / tracerLife;
                    colors.push(1, 1, 1, alpha);
                });
                const geo = new THREE.BufferGeometry();
                geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
                geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(colors), 4));
                tri.tracerLine = new THREE.Line(geo, new THREE.LineBasicMaterial({
                    vertexColors: true, transparent: true, opacity: 0.6,
                }));
                this.globe.add(tri.tracerLine);
            }
        });
    }

    // ── Resize ─────────────────────────────────────────────

    /** Call after viewport or HUD size changes */
    handleResize() {
        // Always use viewport dimensions — renderer.setSize overwrites the
        // canvas inline style, which breaks CSS-based sizing on later reads.
        const w = window.innerWidth;
        const h = window.innerHeight;
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(w, h);
    }
}
