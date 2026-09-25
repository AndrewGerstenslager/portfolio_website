/**
 * All GLSL for the globe scene. Every fragment shader ends with
 * <colorspace_fragment> so output is correct both into the linear
 * composer target and straight to the sRGB canvas (low tier).
 */

// ── Shared snippets ────────────────────────────────────

// Fade for surfaces seen through the globe (back side dims, never vanishes)
const FACING = /* glsl */`
    float facingFade(vec3 worldPos) {
        vec3 n = normalize(worldPos);
        vec3 v = normalize(cameraPosition - worldPos);
        return mix(0.09, 1.0, smoothstep(-0.25, 0.55, dot(n, v)));
    }
`;

// Hot highlights shared by wire + nodes: reveal edge, scan band, sonar ping
const SURFACE_UNIFORMS = /* glsl */`
    uniform vec3 uColor;
    uniform vec3 uHot;
    uniform float uReveal;
    uniform float uScanY;
    uniform float uScanAmt;
    uniform vec3 uPingDir;
    uniform float uPingT;
`;

const SURFACE_FX = /* glsl */`
    vec3 surfaceFx(vec3 worldN, vec3 localDir) {
        vec3 fx = uHot * 1.4 * uScanAmt * smoothstep(0.07, 0.0, abs(worldN.y - uScanY));
        float ang = acos(clamp(dot(normalize(localDir), uPingDir), -1.0, 1.0));
        fx += uHot * 1.6 * exp(-pow((ang - uPingT * 2.6) / 0.09, 2.0)) * (1.0 - uPingT) * step(0.001, uPingT);
        return fx;
    }
`;

// ── Backdrop: radial gradient + plotting grid ──────────
export const backdropVertex = /* glsl */`
    void main() {
        gl_Position = vec4(position.xy, 0.9999, 1.0);
    }
`;

export const backdropFragment = /* glsl */`
    uniform vec2 uResolution;
    uniform vec2 uCenterPx;
    uniform float uRadiusPx;
    uniform float uPixelRatio;
    uniform vec3 uCore;
    uniform vec3 uBg;
    uniform vec3 uDeep;
    uniform vec3 uGrid;
    uniform float uGridAlpha;

    float hash(vec2 p) {
        p = fract(p * vec2(123.34, 456.21));
        p += dot(p, p + 45.32);
        return fract(p.x * p.y);
    }
    vec3 toSRGB(vec3 c) {
        return mix(c * 12.92, pow(max(c, 0.0), vec3(1.0 / 2.4)) * 1.055 - 0.055, step(0.0031308, c));
    }
    vec3 toLinear(vec3 c) {
        return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
    }

    void main() {
        vec2 fc = gl_FragCoord.xy;
        float distPx = distance(fc, uCenterPx);
        float d = distPx / uResolution.y;

        // Gradient + grid are composed in display (sRGB) space, like CSS would
        vec3 col = mix(toSRGB(uCore), toSRGB(uBg), smoothstep(0.0, 0.45, d));
        col = mix(col, toSRGB(uDeep), smoothstep(0.45, 1.1, d));

        // 1-device-px grid lines anchored on the globe centre
        vec2 g = mod(fc - uCenterPx, 48.0 * uPixelRatio);
        float line = max(1.0 - step(1.0, g.x), 1.0 - step(1.0, g.y));
        line *= smoothstep(uRadiusPx * 1.05, uRadiusPx * 1.25, distPx);
        line *= 1.0 - smoothstep(0.6, 1.2, d);
        col = mix(col, toSRGB(uGrid), line * uGridAlpha);

        // ±0.5/255 dither, then back to linear for either output path
        col = toLinear(max(col + (hash(fc) - 0.5) / 255.0, 0.0));

        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
    }
`;

// ── Stars ──────────────────────────────────────────────
// position = (azimuth fraction, elevation fraction, radius). The field is
// mapped onto an angular window that always covers the view, so density
// is independent of aspect ratio; uDrift slides it about Y and wraps
// off-screen.
export const starsVertex = /* glsl */`
    attribute float aSize;
    attribute float aPhase;
    attribute float aSpeed;
    attribute float aBright;
    attribute vec3 aColor;
    uniform float uTime;
    uniform float uDrift;
    uniform float uAzHalf;
    uniform float uElHalf;
    uniform float uPixelRatio;
    uniform float uOpacity;
    varying vec3 vColor;
    varying float vAlpha;

    void main() {
        float span = 2.0 * uAzHalf;
        float az = (fract(position.x + uDrift / span) - 0.5) * span;
        float el = asin((position.y * 2.0 - 1.0) * sin(uElHalf));
        vec3 p = vec3(sin(az) * cos(el), sin(el), -cos(az) * cos(el)) * position.z;

        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = aSize * uPixelRatio;

        vColor = aColor;
        float lum = dot(aColor, vec3(0.2126, 0.7152, 0.0722));
        float a = mix(0.25, 0.55, aBright) * (0.7 + 0.3 * sin(uTime * aSpeed + aPhase));
        // keep every star under the bloom threshold
        vAlpha = min(a, 0.27 / max(lum, 0.001)) * uOpacity;
    }
`;

export const starsFragment = /* glsl */`
    varying vec3 vColor;
    varying float vAlpha;

    void main() {
        float d = length(gl_PointCoord - 0.5);
        float disc = smoothstep(0.5, 0.2, d);
        gl_FragColor = vec4(vColor, vAlpha * disc);
        #include <colorspace_fragment>
    }
`;

// ── Atmosphere (back faces, rim profile from the view-ray impact parameter) ──
export const atmosphereVertex = /* glsl */`
    varying vec3 vWorld;
    void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
    }
`;

export const atmosphereFragment = /* glsl */`
    uniform vec3 uColor;
    uniform float uAtmo;
    uniform float uRadius;
    uniform float uOuter;
    uniform float uStrength;
    varying vec3 vWorld;

    void main() {
        vec3 d = normalize(vWorld - cameraPosition);
        vec3 c = -cameraPosition;
        float tca = dot(c, d);
        float b = sqrt(max(dot(c, c) - tca * tca, 0.0));
        float x = b / uRadius;                               // 1.0 at the globe silhouette
        float t = clamp((x - 1.0) / (uOuter - 1.0), 0.0, 1.0);
        float halo = exp(-t * 4.5) * (1.0 - t * t);
        float limb = pow(clamp(x, 0.0, 1.0), 14.0);
        float i = (x >= 1.0 ? halo : limb) * uStrength;
        gl_FragColor = vec4(uColor * i * uAtmo, 1.0);
        #include <colorspace_fragment>
    }
`;

// ── Inner glow (front faces, fresnel) ──────────────────
export const innerGlowVertex = /* glsl */`
    varying vec3 vWorld;
    varying vec3 vNormalW;
    void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        vNormalW = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * w;
    }
`;

export const innerGlowFragment = /* glsl */`
    uniform vec3 uColor;
    uniform float uAtmo;
    varying vec3 vWorld;
    varying vec3 vNormalW;

    void main() {
        vec3 v = normalize(cameraPosition - vWorld);
        float f = pow(1.0 - abs(dot(normalize(vNormalW), v)), 2.2) * 0.16;
        gl_FragColor = vec4(uColor * f * uAtmo, 1.0);
        #include <colorspace_fragment>
    }
`;

// ── Wire: merged tubes, thickness rescaled around aCenter ──
export const wireVertex = /* glsl */`
    attribute vec3 aCenter;
    attribute float aSeed;
    uniform float uRadiusScale;
    varying vec3 vWorld;
    varying vec3 vLocal;
    varying float vSeed;

    void main() {
        vec3 p = aCenter + (position - aCenter) * uRadiusScale;
        vec4 w = modelMatrix * vec4(p, 1.0);
        vWorld = w.xyz;
        vLocal = aCenter;
        vSeed = aSeed;
        gl_Position = projectionMatrix * viewMatrix * w;
    }
`;

export const wireFragment = /* glsl */`
    ${SURFACE_UNIFORMS}
    uniform float uIntensity;
    varying vec3 vWorld;
    varying vec3 vLocal;
    varying float vSeed;
    ${SURFACE_FX}

    void main() {
        vec3 n = normalize(vWorld);
        vec3 v = normalize(cameraPosition - vWorld);
        float facing = dot(n, v);
        float a = mix(0.09, 1.0, smoothstep(-0.25, 0.55, facing));
        vec3 col = uColor * (1.0 + 0.6 * pow(1.0 - abs(facing), 3.0));

        float r = smoothstep(vSeed - 0.04, vSeed, uReveal);
        a *= r;
        col += uHot * 2.0 * (r * (1.0 - smoothstep(0.0, 0.05, uReveal - vSeed)));
        col += surfaceFx(n, vLocal);

        gl_FragColor = vec4(col * uIntensity, a);
        #include <colorspace_fragment>
    }
`;

// ── Nodes: one Points of 162 ───────────────────────────
export const nodesVertex = /* glsl */`
    ${SURFACE_UNIFORMS}
    attribute float aPhase;
    attribute float aTwinkle;
    attribute float aSeed;
    uniform float uTime;
    uniform float uPxScale;
    uniform float uPixelRatio;
    uniform float uIntensity;
    varying vec3 vCol;
    varying float vAlpha;
    ${FACING}
    ${SURFACE_FX}

    void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        float a = facingFade(w.xyz);

        float inten = 1.6;
        if (aTwinkle > 0.88) inten += 2.0 * pow(max(0.0, sin(uTime * 1.3 + aPhase * 6.2832)), 8.0);
        vec3 col = uColor * inten;

        float r = step(aSeed, uReveal);
        float hot = r * (1.0 - smoothstep(0.0, 0.05, uReveal - aSeed));
        a *= r;
        col += uHot * 2.0 * hot;
        col += surfaceFx(normalize(w.xyz), position);

        vCol = col * uIntensity;
        vAlpha = a;
        gl_Position = projectionMatrix * viewMatrix * w;
        gl_PointSize = clamp(3.0 * uPxScale, 2.0, 4.5) * uPixelRatio * (1.0 + 0.8 * hot);
    }
`;

export const nodesFragment = /* glsl */`
    varying vec3 vCol;
    varying float vAlpha;

    void main() {
        float disc = smoothstep(0.5, 0.35, length(gl_PointCoord - 0.5));
        gl_FragColor = vec4(vCol, vAlpha * disc);
        #include <colorspace_fragment>
    }
`;

// ── Orbit ring (dashed, far half dimmed, comet wake behind each satellite) ──
export const ringVertex = /* glsl */`
    attribute float aAngle;
    varying float vAngle;
    varying float vNear;

    void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vAngle = aAngle;
        vNear = dot(normalize(w.xyz), normalize(cameraPosition));
        gl_Position = projectionMatrix * viewMatrix * w;
    }
`;

export const ringFragment = /* glsl */`
    uniform vec3 uColor;
    uniform vec3 uWake;
    uniform float uSatAngle;
    uniform float uOpacity;
    varying float vAngle;
    varying float vNear;

    float wake(float satAngle) {
        float d = mod(satAngle - vAngle, 6.2831853);
        return exp(-pow(d / 0.35, 2.0));
    }

    void main() {
        float near = smoothstep(-0.06, 0.06, vNear);
        float dash = step(0.45, fract(vAngle * 64.0 / 6.2831853));
        float base = mix(0.12, 0.35, near) * dash;
        float comet = 1.5 * max(wake(uSatAngle), wake(uSatAngle + 3.14159265)) * mix(0.35, 1.0, near);
        vec3 col = uColor * base + uWake * comet;
        gl_FragColor = vec4(col, uOpacity);
        #include <colorspace_fragment>
    }
`;

export const satsVertex = /* glsl */`
    attribute float aOffset;
    uniform float uSatAngle;
    uniform float uRingRadius;
    uniform float uPixelRatio;
    varying float vNear;

    void main() {
        float a = uSatAngle + aOffset;
        vec4 w = modelMatrix * vec4(cos(a) * uRingRadius, sin(a) * uRingRadius, 0.0, 1.0);
        vNear = dot(normalize(w.xyz), normalize(cameraPosition));
        gl_Position = projectionMatrix * viewMatrix * w;
        gl_PointSize = 5.0 * uPixelRatio;
    }
`;

export const satsFragment = /* glsl */`
    uniform vec3 uColor;
    uniform float uOpacity;
    varying float vNear;

    void main() {
        float disc = smoothstep(0.5, 0.3, length(gl_PointCoord - 0.5));
        float vis = mix(0.3, 1.0, smoothstep(-0.06, 0.06, vNear));
        gl_FragColor = vec4(uColor * vis, disc * uOpacity);
        #include <colorspace_fragment>
    }
`;

// ── Tracer heads (instanced) ───────────────────────────
export const headsVertex = /* glsl */`
    varying float vFade;

    void main() {
        vec4 local = vec4(position, 1.0);
        #ifdef USE_INSTANCING
        local = instanceMatrix * local;
        #endif
        vec4 w = modelMatrix * local;
        vFade = mix(0.15, 1.0, smoothstep(-0.25, 0.4, dot(normalize(w.xyz), normalize(cameraPosition - w.xyz))));
        gl_Position = projectionMatrix * viewMatrix * w;
    }
`;

export const headsFragment = /* glsl */`
    uniform vec3 uColor;
    uniform float uOpacity;
    varying float vFade;

    void main() {
        gl_FragColor = vec4(uColor, uOpacity * vFade);
        #include <colorspace_fragment>
    }
`;

// ── Tracer trails ──────────────────────────────────────
export const trailVertex = /* glsl */`
    attribute float aBirth;
    uniform float uTime;
    varying float vAge;
    varying float vFade;

    void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vAge = clamp((uTime - aBirth) / 3.0, 0.0, 1.0);
        vFade = mix(0.15, 1.0, smoothstep(-0.25, 0.4, dot(normalize(w.xyz), normalize(cameraPosition - w.xyz))));
        gl_Position = projectionMatrix * viewMatrix * w;
    }
`;

export const trailFragment = /* glsl */`
    uniform vec3 uHead;
    uniform vec3 uTail;
    uniform float uTracersAlpha;
    varying float vAge;
    varying float vFade;

    void main() {
        float a = pow(1.0 - vAge, 1.6) * 0.7 * uTracersAlpha * vFade;
        gl_FragColor = vec4(mix(uHead, uTail, vAge), a);
        #include <colorspace_fragment>
    }
`;
