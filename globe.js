// 3D Wireframe Globe with Triangle Mesh
class WireframeGlobe {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        this.canvas = document.getElementById('globe-canvas');
        
        // Scene setup
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x0a0e27);
        
        // Camera setup
        const width = this.container.clientWidth;
        const height = this.container.clientHeight;
        this.camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);

        // Responsive camera distance - scale based on viewport width
        // Desktop (>768px): base distance, Mobile: further away
        this.baseCameraDistance = 9;
        this.updateCameraForViewport();
        this.camera.position.z = this.baseCameraDistance;
        
        // Renderer setup
        this.renderer = new THREE.WebGLRenderer({
            canvas: this.canvas,
            antialias: true,
            alpha: true
        });
        this.renderer.setSize(width, height);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        
        // Create wireframe globe
        this.createGlobe();
        
        // Interaction state
        this.isInteracting = false;

        // Momentum/physics state
        this.rotationVelocity = new THREE.Vector3(0, 0.002, 0); // Start with gentle Y rotation
        this.damping = 0.98; // How quickly momentum decays (0.98 = slower deceleration)
        this.minRotationSpeed = 0.0016; // Minimum rotation speed to maintain

        // Store base quaternion for rotation
        this.baseQuaternion = new THREE.Quaternion();

        // Time tracking
        this.lastTime = Date.now();

        // Zoom bounds (will be scaled by viewport)
        this.minZoom = 6.0;
        this.maxZoom = 12;
        
        // Controls
        this.setupControls();
        
        // Animation
        this.animate();
        
        // Handle window resize
        window.addEventListener('resize', () => this.handleResize());
    }
    
    createGlobe() {
        const radius = 1.2;
        const segments = 3; // Lower = larger triangles, more geometric look
        
        // Create base geometry
        const geometry = new THREE.IcosahedronGeometry(radius, segments);
        
        // Get edges and convert to tube geometry for variable thickness
        const edges = new THREE.EdgesGeometry(geometry);
        const positions = edges.attributes.position;
        
        // Create a group to hold all the line tubes
        const globeGroup = new THREE.Group();
        
        // Custom shader material with depth-based opacity
        const material = new THREE.ShaderMaterial({
            uniforms: {
                color: { value: new THREE.Color(0xFFA234) },
                cameraZ: { value: this.camera.position.z }
            },
            vertexShader: `
                varying vec3 vViewPosition;

                void main() {
                    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                    vViewPosition = mvPosition.xyz;
                    gl_Position = projectionMatrix * mvPosition;
                }
            `,
            fragmentShader: `
                uniform vec3 color;
                uniform float cameraZ;
                varying vec3 vViewPosition;

                void main() {
                    float depth = -vViewPosition.z;

                    // Scale depth range based on camera distance
                    float sphereRadius = 1.2;
                    float nearDepth = cameraZ - sphereRadius * 1.5;
                    float farDepth = cameraZ + sphereRadius * 1.5;

                    // Map depth to opacity
                    float minOpacity = 0.07;
                    float maxOpacity = 1.0;
                    float normalizedDepth = smoothstep(nearDepth, farDepth, depth);
                    float opacity = mix(maxOpacity, minOpacity, normalizedDepth);

                    gl_FragColor = vec4(color, opacity);
                }
            `,
            transparent: true,
            depthWrite: false
        });
        
        // Convert each edge to a tube with variable thickness
        const tubeSegments = 8; // Number of segments around the tube circumference
        const baseRadius = 0.0075; // Base radius for all tubes (half thickness)
        
        // Process edges in pairs (each edge has 2 vertices)
        for (let i = 0; i < positions.count; i += 2) {
            const start = new THREE.Vector3(
                positions.getX(i),
                positions.getY(i),
                positions.getZ(i)
            );
            const end = new THREE.Vector3(
                positions.getX(i + 1),
                positions.getY(i + 1),
                positions.getZ(i + 1)
            );
            
            // Create a curve for this edge
            const curve = new THREE.LineCurve3(start, end);
            
            // Create tube geometry with base radius
            // The shader will scale each vertex based on its distance from camera
            const tubeGeometry = new THREE.TubeGeometry(curve, 1, baseRadius, tubeSegments, false);
            
            // Create mesh with shader material
            const tubeMesh = new THREE.Mesh(tubeGeometry, material);
            globeGroup.add(tubeMesh);
        }
        
        // Add the group to scene
        this.globe = globeGroup;
        this.scene.add(this.globe);

        // Store for rotation
        this.globeLayers = [this.globe];

        // Store material reference to update uniforms if needed
        this.globeMaterial = material;

        // Add vertex spheres
        this.addVertexSpheres(geometry);

        // Add subtle glow effect with points
        this.addGlowEffect();

        // Add flying triangles with tracers
        this.addFlyingTriangles();
    }

    addVertexSpheres(geometry) {
        // Get unique vertices from the geometry
        const vertices = geometry.attributes.position;
        const vertexSet = new Set();
        const uniqueVertices = [];

        // Collect unique vertices (avoid duplicates)
        for (let i = 0; i < vertices.count; i++) {
            const x = vertices.getX(i);
            const y = vertices.getY(i);
            const z = vertices.getZ(i);
            const key = `${x.toFixed(5)},${y.toFixed(5)},${z.toFixed(5)}`;

            if (!vertexSet.has(key)) {
                vertexSet.add(key);
                uniqueVertices.push(new THREE.Vector3(x, y, z));
            }
        }

        // Create small spheres at each vertex with depth-based opacity
        const sphereGeometry = new THREE.SphereGeometry(0.02, 8, 8);
        const sphereMaterial = new THREE.ShaderMaterial({
            uniforms: {
                color: { value: new THREE.Color(0xFFA234) },
                cameraZ: { value: this.camera.position.z }
            },
            vertexShader: `
                varying vec3 vViewPosition;

                void main() {
                    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                    vViewPosition = mvPosition.xyz;
                    gl_Position = projectionMatrix * mvPosition;
                }
            `,
            fragmentShader: `
                uniform vec3 color;
                uniform float cameraZ;
                varying vec3 vViewPosition;

                void main() {
                    float depth = -vViewPosition.z;

                    // Scale depth range based on camera distance
                    float sphereRadius = 1.2;
                    float nearDepth = cameraZ - sphereRadius * 1.5;
                    float farDepth = cameraZ + sphereRadius * 1.5;

                    // Map depth to opacity
                    float minOpacity = 0.07;
                    float maxOpacity = 1.0;
                    float normalizedDepth = smoothstep(nearDepth, farDepth, depth);
                    float opacity = mix(maxOpacity, minOpacity, normalizedDepth);

                    gl_FragColor = vec4(color, opacity);
                }
            `,
            transparent: true,
            depthWrite: false
        });

        this.vertexSphereMaterial = sphereMaterial;

        const vertexGroup = new THREE.Group();

        uniqueVertices.forEach(vertex => {
            const sphere = new THREE.Mesh(sphereGeometry, sphereMaterial);
            sphere.position.copy(vertex);
            vertexGroup.add(sphere);
        });

        this.scene.add(vertexGroup);
        this.globeLayers.push(vertexGroup);
    }
    
    addGlowEffect() {
        // Add some glowing points on the surface
        const pointGeometry = new THREE.BufferGeometry();
        const pointCount = 200;
        const positions = new Float32Array(pointCount * 3);
        const radius = 1.21;
        
        for (let i = 0; i < pointCount; i++) {
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(Math.random() * 2 - 1);
            
            positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
            positions[i * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
            positions[i * 3 + 2] = radius * Math.cos(phi);
        }
        
        pointGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        
        const pointMaterial = new THREE.PointsMaterial({
            color: 0xFFA234,
            size: 0.02,
            transparent: true,
            opacity: 0.0
        });
        
        const points = new THREE.Points(pointGeometry, pointMaterial);
        this.scene.add(points);
        this.globeLayers.push(points);
    }

    addFlyingTriangles() {
        this.flyingTriangles = [];
        const numTriangles = 5;
        const baseRadius = 1.2;

        for (let i = 0; i < numTriangles; i++) {
            // Random position on sphere (spherical coordinates)
            const theta = Math.random() * Math.PI * 2; // Azimuthal angle
            const phi = Math.acos(Math.random() * 2 - 1); // Polar angle
            const heightOffset = 0.05 + Math.random() * 0.1; // Random height 0.05-0.15 above surface
            const radius = baseRadius + heightOffset;

            // Random velocity (tangent to sphere)
            const speed = 0.3 + Math.random() * 0.3; // Speed: 0.3-0.6

            // Create triangle geometry
            const triangleSize = 0.03;
            const triangleGeometry = new THREE.BufferGeometry();
            const vertices = new Float32Array([
                0, triangleSize, 0,           // Top
                -triangleSize * 0.5, 0, 0,    // Bottom left
                triangleSize * 0.5, 0, 0      // Bottom right
            ]);
            triangleGeometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));

            const triangleMaterial = new THREE.MeshBasicMaterial({
                color: 0xffffff,
                side: THREE.DoubleSide,
                transparent: true,
                opacity: 0.8
            });

            const triangleMesh = new THREE.Mesh(triangleGeometry, triangleMaterial);

            // Add to globe so it rotates with it
            this.globe.add(triangleMesh);

            // Store triangle data
            const triangle = {
                mesh: triangleMesh,
                theta: theta,
                phi: phi,
                radius: radius,
                speed: speed,
                velocityTheta: (Math.random() - 0.5) * 2, // Random direction
                velocityPhi: (Math.random() - 0.5) * 2,
                tracerPoints: [], // Array of {position, time}
                tracerLine: null
            };

            // Normalize velocity
            const velMag = Math.sqrt(triangle.velocityTheta ** 2 + triangle.velocityPhi ** 2);
            triangle.velocityTheta = (triangle.velocityTheta / velMag) * speed;
            triangle.velocityPhi = (triangle.velocityPhi / velMag) * speed;

            this.flyingTriangles.push(triangle);

            // Update initial position
            this.updateTrianglePosition(triangle);
        }
    }

    updateTrianglePosition(triangle) {
        // Convert spherical to cartesian
        const x = triangle.radius * Math.sin(triangle.phi) * Math.cos(triangle.theta);
        const y = triangle.radius * Math.sin(triangle.phi) * Math.sin(triangle.theta);
        const z = triangle.radius * Math.cos(triangle.phi);

        triangle.mesh.position.set(x, y, z);

        // Orient triangle to lay flat on surface and point in direction of movement
        // Calculate tangent directions on sphere
        const tangentTheta = new THREE.Vector3(
            -Math.sin(triangle.theta),
            Math.cos(triangle.theta),
            0
        ).normalize();

        const tangentPhi = new THREE.Vector3(
            Math.cos(triangle.phi) * Math.cos(triangle.theta),
            Math.cos(triangle.phi) * Math.sin(triangle.theta),
            -Math.sin(triangle.phi)
        ).normalize();

        // Direction of movement (in tangent plane)
        const direction = tangentTheta.clone().multiplyScalar(triangle.velocityTheta)
            .add(tangentPhi.clone().multiplyScalar(triangle.velocityPhi))
            .normalize();

        // Normal pointing away from sphere center (this is "up" for the triangle)
        const normal = new THREE.Vector3(x, y, z).normalize();

        // Orient triangle to lay flat:
        // - normal = up (z-axis of triangle)
        // - direction = forward (y-axis, pointing direction of travel)
        // - right = perpendicular to both
        const forward = direction;
        const up = normal;
        const right = new THREE.Vector3().crossVectors(forward, up).normalize();

        // Create rotation matrix: right=x, forward=y, up=z
        const matrix = new THREE.Matrix4();
        matrix.makeBasis(right, forward, up);
        triangle.mesh.rotation.setFromRotationMatrix(matrix);

        // Scale based on distance from camera
        const distanceToCamera = triangle.mesh.position.distanceTo(this.camera.position);
        const minScale = 0.5;
        const maxScale = 2.5; // Increased for larger triangles when near
        const minDist = this.minZoom;
        const maxDist = this.maxZoom;

        // Closer = larger, further = smaller
        const normalizedDist = (distanceToCamera - minDist) / (maxDist - minDist);
        const scale = maxScale - (normalizedDist * (maxScale - minScale));
        triangle.mesh.scale.setScalar(Math.max(minScale, Math.min(maxScale, scale)));
    }

    updateFlyingTriangles(deltaTime) {
        const currentTime = Date.now();
        const tracerDuration = 5000; // 5 seconds in milliseconds

        this.flyingTriangles.forEach(triangle => {
            // Update position
            triangle.theta += triangle.velocityTheta * deltaTime;
            triangle.phi += triangle.velocityPhi * deltaTime;

            // Keep phi in valid range [0, PI]
            if (triangle.phi < 0) {
                triangle.phi = -triangle.phi;
                triangle.velocityPhi = -triangle.velocityPhi;
                triangle.theta += Math.PI;
            }
            if (triangle.phi > Math.PI) {
                triangle.phi = 2 * Math.PI - triangle.phi;
                triangle.velocityPhi = -triangle.velocityPhi;
                triangle.theta += Math.PI;
            }

            // Normalize theta to [0, 2PI]
            triangle.theta = triangle.theta % (Math.PI * 2);
            if (triangle.theta < 0) triangle.theta += Math.PI * 2;

            // Update mesh position
            this.updateTrianglePosition(triangle);

            // Add current position to tracer
            const currentPos = triangle.mesh.position.clone();
            triangle.tracerPoints.push({
                position: currentPos,
                time: currentTime
            });

            // Remove old tracer points
            triangle.tracerPoints = triangle.tracerPoints.filter(
                point => currentTime - point.time < tracerDuration
            );

            // Update tracer line
            if (triangle.tracerLine) {
                this.globe.remove(triangle.tracerLine);
                triangle.tracerLine.geometry.dispose();
            }

            if (triangle.tracerPoints.length > 1) {
                const tracerGeometry = new THREE.BufferGeometry();
                const positions = [];
                const colors = [];

                triangle.tracerPoints.forEach((point, index) => {
                    positions.push(point.position.x, point.position.y, point.position.z);

                    // Fade out older points
                    const age = currentTime - point.time;
                    const alpha = 1 - (age / tracerDuration);
                    colors.push(1, 1, 1, alpha); // White with varying alpha
                });

                tracerGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
                tracerGeometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(colors), 4));

                const tracerMaterial = new THREE.LineBasicMaterial({
                    vertexColors: true,
                    transparent: true,
                    opacity: 0.6,
                    linewidth: 2
                });

                triangle.tracerLine = new THREE.Line(tracerGeometry, tracerMaterial);
                this.globe.add(triangle.tracerLine);
            }
        });
    }

    setupControls() {
        // Mouse controls for dragging
        let previousMousePosition = { x: 0, y: 0 };
        
        // Listen on both canvas and container to catch all interactions
        const handleMouseDown = (e) => {
            this.isInteracting = true;
            this.canvas.style.cursor = 'grabbing';
            previousMousePosition = {
                x: e.clientX,
                y: e.clientY
            };
        };
        
        this.canvas.addEventListener('mousedown', handleMouseDown);
        this.container.addEventListener('mousedown', handleMouseDown);
        
        this.canvas.addEventListener('mousemove', (e) => {
            if (!this.isInteracting) {
                this.canvas.style.cursor = 'grab';
                return;
            }

            const deltaX = e.clientX - previousMousePosition.x;
            const deltaY = e.clientY - previousMousePosition.y;

            // Trackball rotation: rotate around axis perpendicular to drag direction
            const rotationSpeed = 0.005;

            // Create rotation axis perpendicular to drag direction (in screen space)
            // Drag right -> rotate around Y axis (up)
            // Drag up -> rotate around X axis (right)
            const axis = new THREE.Vector3(deltaY, deltaX, 0).normalize();
            const angle = Math.sqrt(deltaX * deltaX + deltaY * deltaY) * rotationSpeed;

            // Create quaternion for this rotation in camera space
            const quaternion = new THREE.Quaternion().setFromAxisAngle(axis, angle);

            // Apply rotation
            this.globe.quaternion.multiplyQuaternions(quaternion, this.globe.quaternion);

            // Store velocity as axis-angle for momentum
            this.rotationVelocity.copy(axis).multiplyScalar(angle);

            // Apply rotation to all layers
            this.globeLayers.forEach(layer => {
                layer.quaternion.copy(this.globe.quaternion);
            });

            previousMousePosition = {
                x: e.clientX,
                y: e.clientY
            };
        });
        
        const handleMouseUp = () => {
            this.isInteracting = false;
            this.canvas.style.cursor = 'grab';
        };
        
        this.canvas.addEventListener('mouseup', handleMouseUp);
        this.container.addEventListener('mouseup', handleMouseUp);
        
        const handleMouseLeave = () => {
            this.isInteracting = false;
            this.canvas.style.cursor = 'default';
        };
        
        this.canvas.addEventListener('mouseleave', handleMouseLeave);
        this.container.addEventListener('mouseleave', handleMouseLeave);
        
        // Set initial cursor
        this.canvas.style.cursor = 'grab';
        
        // Touch controls for mobile with pinch-to-zoom
        let touchStart = null;
        let initialPinchDistance = null;
        
        // Calculate distance between two touches
        const getTouchDistance = (touch1, touch2) => {
            const dx = touch2.clientX - touch1.clientX;
            const dy = touch2.clientY - touch1.clientY;
            return Math.sqrt(dx * dx + dy * dy);
        };
        
        const handleTouchStart = (e) => {
            e.preventDefault();
            this.isInteracting = true;
            
            if (e.touches.length === 1) {
                // Single touch - rotation
                touchStart = {
                    x: e.touches[0].clientX,
                    y: e.touches[0].clientY
                };
                initialPinchDistance = null;
            } else if (e.touches.length === 2) {
                // Two touches - pinch to zoom
                initialPinchDistance = getTouchDistance(e.touches[0], e.touches[1]);
                touchStart = null;
            }
        };
        
        this.canvas.addEventListener('touchstart', handleTouchStart);
        this.container.addEventListener('touchstart', handleTouchStart);
        
        this.canvas.addEventListener('touchmove', (e) => {
            e.preventDefault();

            if (e.touches.length === 1 && touchStart) {
                // Single touch - rotate with trackball
                const deltaX = e.touches[0].clientX - touchStart.x;
                const deltaY = e.touches[0].clientY - touchStart.y;

                const rotationSpeed = 0.005;

                // Create rotation axis perpendicular to drag direction
                const axis = new THREE.Vector3(deltaY, deltaX, 0).normalize();
                const angle = Math.sqrt(deltaX * deltaX + deltaY * deltaY) * rotationSpeed;

                // Create quaternion for this rotation
                const quaternion = new THREE.Quaternion().setFromAxisAngle(axis, angle);

                // Apply rotation
                this.globe.quaternion.multiplyQuaternions(quaternion, this.globe.quaternion);

                // Store velocity as axis-angle for momentum
                this.rotationVelocity.copy(axis).multiplyScalar(angle);

                this.globeLayers.forEach(layer => {
                    layer.quaternion.copy(this.globe.quaternion);
                });

                touchStart = {
                    x: e.touches[0].clientX,
                    y: e.touches[0].clientY
                };
            } else if (e.touches.length === 2 && initialPinchDistance !== null) {
                // Two touches - pinch to zoom
                const currentDistance = getTouchDistance(e.touches[0], e.touches[1]);
                const distanceDelta = initialPinchDistance - currentDistance;

                // Zoom speed factor (positive delta = pinch in = zoom in)
                const zoomSpeed = 0.01;
                const newZ = this.camera.position.z + (distanceDelta * zoomSpeed);
                this.camera.position.z = Math.max(this.minZoom, Math.min(this.maxZoom, newZ));

                // Update initial distance for smooth continuous zooming
                initialPinchDistance = currentDistance;
            }
        });
        
        const handleTouchEnd = (e) => {
            if (e.touches.length === 0) {
                // All touches ended
                this.isInteracting = false;
                touchStart = null;
                initialPinchDistance = null;
            } else if (e.touches.length === 1) {
                // One touch remains - switch to rotation mode
                touchStart = {
                    x: e.touches[0].clientX,
                    y: e.touches[0].clientY
                };
                initialPinchDistance = null;
            }
        };
        
        this.canvas.addEventListener('touchend', handleTouchEnd);
        this.container.addEventListener('touchend', handleTouchEnd);
        
        const handleTouchCancel = (e) => {
            if (e.touches.length === 0) {
                this.isInteracting = false;
                touchStart = null;
                initialPinchDistance = null;
            }
        };
        
        this.canvas.addEventListener('touchcancel', handleTouchCancel);
        this.container.addEventListener('touchcancel', handleTouchCancel);
        
        // Zoom with scroll
        this.canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            const zoomSpeed = 0.1;
            const newZ = this.camera.position.z + (e.deltaY > 0 ? zoomSpeed : -zoomSpeed);
            this.camera.position.z = Math.max(this.minZoom, Math.min(this.maxZoom, newZ));
        });
        
        // Auto-rotation when not dragging
        this.autoRotate = true;
        this.rotationSpeed = 0.0008; // Slower rotation
    }
    
    animate() {
        requestAnimationFrame(() => this.animate());

        // Calculate delta time
        const currentTime = Date.now();
        const deltaTime = (currentTime - this.lastTime) / 1000; // Convert to seconds
        this.lastTime = currentTime;

        // Update camera Z in shaders for relative opacity
        if (this.globeMaterial) {
            this.globeMaterial.uniforms.cameraZ.value = this.camera.position.z;
        }
        if (this.vertexSphereMaterial) {
            this.vertexSphereMaterial.uniforms.cameraZ.value = this.camera.position.z;
        }

        // Update UI zoom indicators
        this.updateUIZoom();

        // Update UI velocity indicator
        this.updateUIVelocity();

        // Update flying triangles
        if (this.flyingTriangles) {
            this.updateFlyingTriangles(deltaTime);
        }

        // Apply momentum when not interacting
        if (!this.isInteracting) {
            const velocityMagnitude = this.rotationVelocity.length();

            if (velocityMagnitude > 0.00001) {
                // Apply velocity to rotation using quaternion
                const axis = this.rotationVelocity.clone().normalize();
                const angle = velocityMagnitude;
                const quaternion = new THREE.Quaternion().setFromAxisAngle(axis, angle);

                this.globe.quaternion.multiplyQuaternions(quaternion, this.globe.quaternion);

                // Apply rotation to all layers
                this.globeLayers.forEach(layer => {
                    layer.quaternion.copy(this.globe.quaternion);
                });

                // Apply damping (friction) to slow down
                this.rotationVelocity.multiplyScalar(this.damping);

                // Enforce minimum rotation speed - clamp to minimum while keeping direction
                const newMagnitude = this.rotationVelocity.length();
                if (newMagnitude < this.minRotationSpeed && newMagnitude > 0.00001) {
                    this.rotationVelocity.normalize().multiplyScalar(this.minRotationSpeed);
                }
            }
        }

        this.renderer.render(this.scene, this.camera);
    }
    
    updateUIZoom() {
        const zoomValue = document.getElementById('zoom-value');

        if (zoomValue) {
            zoomValue.textContent = this.camera.position.z.toFixed(1);
        }
    }

    updateUIVelocity() {
        const velocityBar = document.getElementById('velocity-bar-fill');
        const velocityValue = document.getElementById('velocity-value');

        if (velocityBar && velocityValue) {
            // Calculate velocity magnitude
            const velocityMagnitude = this.rotationVelocity.length();

            // Scale to 0-100 range (adjust multiplier for sensitivity)
            // Max velocity around 0.05 = 100%
            const velocityPercent = Math.min((velocityMagnitude / 0.05) * 100, 100);

            // Update bar width (max 110px)
            const barWidth = (velocityPercent / 100) * 110;
            velocityBar.setAttribute('width', barWidth.toFixed(1));

            // Update text value
            velocityValue.textContent = velocityPercent.toFixed(2);
        }
    }

    updateCameraForViewport() {
        // Get the actual rendered size of the UI square
        const svg = document.getElementById('ui-overlay');
        if (!svg) return;

        // Get SVG dimensions
        const svgRect = svg.getBoundingClientRect();

        // The square is 450/1000 = 45% of the SVG viewBox
        // Calculate actual pixel size of the square
        const squareSize = Math.min(svgRect.width, svgRect.height) * 0.45;

        // Reference size: 540px square (desktop baseline)
        const referenceSize = 540;

        // Scale factor: larger square = closer camera (smaller scale), smaller square = further camera (larger scale)
        const scaleFactor = referenceSize / squareSize;

        // Store current zoom offset from base
        const currentOffset = this.camera ? this.camera.position.z - this.baseCameraDistance : 0;

        // Update base distance with scale factor
        this.baseCameraDistance = 9 * scaleFactor;

        // Reapply offset
        if (this.camera) {
            this.camera.position.z = this.baseCameraDistance + currentOffset;
        }

        // Update zoom bounds based on scale
        this.minZoom = 6.0 * scaleFactor;
        this.maxZoom = 12 * scaleFactor;

        // Clamp camera to new bounds
        if (this.camera) {
            this.camera.position.z = Math.max(this.minZoom, Math.min(this.maxZoom, this.camera.position.z));
        }
    }

    handleResize() {
        const width = this.container.clientWidth;
        const height = this.container.clientHeight;

        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();

        this.renderer.setSize(width, height);

        // Update camera distance for new viewport size
        this.updateCameraForViewport();
    }
}

// Initialize globe when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    new WireframeGlobe('globe-container');
});

