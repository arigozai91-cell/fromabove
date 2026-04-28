/* =============================================
   THERMAL.JS — FLIR post-processing shader
   Uses Three.js EffectComposer-style manual pass
   ============================================= */
'use strict';

const ThermalSystem = (() => {
  const LENS_DISTORTION_STORAGE_KEY = 'ac130_lens_distortion';
  const LENS_DISTORTION_VERSION_KEY = 'ac130_lens_distortion_v2';
  const LENS_DISTORTION_VERSION = '2';
  const DEFAULT_LENS_DISTORTION = 0.30;
  const MAX_LENS_DISTORTION = 0.50;

  function clampLensDistortion(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return DEFAULT_LENS_DISTORTION;
    return Math.min(Math.max(numeric, 0), MAX_LENS_DISTORTION);
  }

  function readStoredLensDistortion() {
    try {
      const raw = localStorage.getItem(LENS_DISTORTION_STORAGE_KEY);
      if (raw == null || raw === '') return DEFAULT_LENS_DISTORTION;
      const parsed = clampLensDistortion(parseFloat(raw));
      const version = localStorage.getItem(LENS_DISTORTION_VERSION_KEY);
      if (version !== LENS_DISTORTION_VERSION) {
        const migrated = Math.max(parsed, DEFAULT_LENS_DISTORTION);
        try { localStorage.setItem(LENS_DISTORTION_VERSION_KEY, LENS_DISTORTION_VERSION); } catch (_) {}
        try { localStorage.setItem(LENS_DISTORTION_STORAGE_KEY, String(migrated)); } catch (_) {}
        return migrated;
      }
      return parsed;
    } catch (_) {
      return DEFAULT_LENS_DISTORTION;
    }
  }

  function writeStoredLensDistortion(value) {
    try {
      localStorage.setItem(LENS_DISTORTION_STORAGE_KEY, String(clampLensDistortion(value)));
      localStorage.setItem(LENS_DISTORTION_VERSION_KEY, LENS_DISTORTION_VERSION);
    } catch (_) {}
  }

  function syncHudFoldVars() {
    if (typeof document === 'undefined' || !document.documentElement) return;
    const root = document.documentElement;
    const normalized = MAX_LENS_DISTORTION > 0 ? Math.min(Math.max(lensDistortion / MAX_LENS_DISTORTION, 0), 1) : 0;
    root.style.setProperty('--crt-fold-strength', normalized.toFixed(3));
    root.style.setProperty('--crt-fold-radius', `${(2.6 + normalized * 13.4).toFixed(2)}vmin`);
    root.style.setProperty('--crt-fold-softness', `${(0.8 + normalized * 3.8).toFixed(2)}vmin`);
    root.style.setProperty('--crt-fold-shadow-opacity', `${(0.08 + normalized * 0.24).toFixed(3)}`);
    root.style.setProperty('--crt-fold-highlight-opacity', `${(0.04 + normalized * 0.12).toFixed(3)}`);
  }

  let lensDistortion = readStoredLensDistortion();
  syncHudFoldVars();

  // Vertex shader — simple fullscreen quad
  const vertexShader = `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `;

  // Fragment shader — FLIR thermal effect
  const fragmentShader = `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uNoise;
    uniform float uBrightness;
    uniform float uLensDistortion;
    uniform float uGlitchStrength;
    uniform float uGlitchSeed;
    uniform float uBlackFade;
    uniform float uTiltShiftStrength;
    uniform vec2 uResolution;
    uniform vec4  uShockwaves[4];
    uniform float uShockwaveCount;
    varying vec2 vUv;

    float rand(vec2 co) {
      return fract(sin(dot(co.xy, vec2(12.9898, 78.233))) * 43758.5453);
    }

    float hash11(float n) {
      return fract(sin(n) * 43758.5453123);
    }

    // White-hot B&W: cold=black, hot=white, pure grayscale
    vec3 thermalColor(float heat) {
      float v = smoothstep(0.03, 0.55, heat);
      v = pow(v, 0.75); // gamma — better midtone separation
      return vec3(v);
    }

    vec2 applyGlitchWarp(vec2 uv, float strength) {
      if (strength <= 0.0001) return clamp(uv, 0.0, 1.0);

      float timeSlice = floor(uTime * mix(18.0, 30.0, hash11(uGlitchSeed + 0.37)));
      float bands = mix(18.0, 52.0, hash11(uGlitchSeed + 1.91));
      float bandId = floor(uv.y * bands);
      float bandNoise = rand(vec2(bandId + uGlitchSeed * 3.17, timeSlice));
      float bandMask = step(1.0 - clamp(strength * 1.35, 0.08, 0.92), bandNoise);
      uv.x += (bandNoise - 0.5) * 0.22 * strength * bandMask;

      float blockCols = mix(22.0, 84.0, hash11(uGlitchSeed + 5.13));
      float blockRows = mix(10.0, 34.0, hash11(uGlitchSeed + 8.47));
      vec2 blockCell = floor(vec2(uv.x * blockCols, uv.y * blockRows));
      float blockNoise = rand(blockCell + vec2(timeSlice, uGlitchSeed * 1.73));
      float blockMask = step(1.0 - clamp(strength * 0.9, 0.04, 0.72), blockNoise);
      uv.x += (rand(blockCell + vec2(13.2, uGlitchSeed * 0.53)) - 0.5) * 0.08 * strength * blockMask;

      return clamp(uv, 0.0, 1.0);
    }

    vec4 sampleTiltShift(sampler2D tex, vec2 uv, float strength) {
      float edge = smoothstep(0.12, 1.0, abs(vUv.y - 0.5) * 2.0);
      float blur = strength * edge * edge ;
      if (blur <= 0.0001) return texture2D(tex, clamp(uv, 0.0, 1.0));

      vec2 texel = vec2(1.0 / max(uResolution.x, 1.0), 1.0 / max(uResolution.y, 1.0));
      float radius = mix(0.8, 7.5, clamp(blur, 0.0, 1.0));
      vec2 offset = vec2(0.0, texel.y * radius);

      vec4 color = texture2D(tex, clamp(uv, 0.0, 1.0)) * 0.19648255;
      color += texture2D(tex, clamp(uv + offset * 1.0, 0.0, 1.0)) * 0.17493867;
      color += texture2D(tex, clamp(uv - offset * 1.0, 0.0, 1.0)) * 0.17493867;
      color += texture2D(tex, clamp(uv + offset * 2.0, 0.0, 1.0)) * 0.12052015;
      color += texture2D(tex, clamp(uv - offset * 2.0, 0.0, 1.0)) * 0.12052015;
      color += texture2D(tex, clamp(uv + offset * 3.0, 0.0, 1.0)) * 0.06475994;
      color += texture2D(tex, clamp(uv - offset * 3.0, 0.0, 1.0)) * 0.06475994;
      color += texture2D(tex, clamp(uv + offset * 4.0, 0.0, 1.0)) * 0.02799402;
      color += texture2D(tex, clamp(uv - offset * 4.0, 0.0, 1.0)) * 0.02799402;
      color += texture2D(tex, clamp(uv + offset * 5.0, 0.0, 1.0)) * 0.00930006;
      color += texture2D(tex, clamp(uv - offset * 5.0, 0.0, 1.0)) * 0.00930006;
      return color;
    }

    vec2 applyCornerFoldWarp(vec2 uv, float foldAmount, float cornerRadius, float foldSoftness) {
      if (foldAmount <= 0.0001) return uv;

      vec2 screenUv = uv * 2.0 - 1.0;
      vec2 screenAbs = abs(screenUv);
      vec2 cornerStart = vec2(1.0 - cornerRadius * 1.55);
      vec2 cornerDelta = max(screenAbs - cornerStart, 0.0);
      float cornerLen = length(cornerDelta);
      vec2 axisZone = smoothstep(cornerStart, vec2(1.0 - cornerRadius * 0.12), screenAbs);
      axisZone *= axisZone;
      float cornerGate = axisZone.x * axisZone.y;
      float cornerZone = smoothstep(cornerRadius * 0.08, cornerRadius * 1.18 + foldSoftness * 2.4, cornerLen) * cornerGate;
      cornerZone *= cornerZone * (3.0 - 2.0 * cornerZone);

      vec2 quadrant = sign(screenUv);
      vec2 cornerDir = cornerLen > 0.0001 ? cornerDelta / cornerLen : vec2(0.0);
      float warpStrength = foldAmount * foldAmount;

      screenUv -= quadrant * cornerDir * cornerZone * warpStrength * 0.16;
      screenUv -= quadrant * cornerDelta * cornerZone * warpStrength * 0.08;

      return clamp(screenUv * 0.5 + 0.5, 0.0, 1.0);
    }

    void main() {
      // CRT-style folded corners: bend only the outer corners and keep the transition soft.
      vec2 uv = vUv;
      float lensDistortion = clamp(uLensDistortion, 0.0, 0.50);
      float foldAmount = smoothstep(0.0, 0.50, lensDistortion);
      vec2 screenUv = uv * 2.0 - 1.0;
      vec2 screenAbs = abs(screenUv);
      float dist = length(screenUv);
      float cornerRadius = mix(0.010, 0.250, foldAmount);
      float foldSoftness = mix(0.008, 0.075, foldAmount);
      vec2 cornerOffset = max(screenAbs - (1.0 - cornerRadius), 0.0);
      float cornerArc = length(cornerOffset);
      float crtMask = 1.0 - smoothstep(cornerRadius - foldSoftness, cornerRadius + foldSoftness, cornerArc);
      float foldBand = smoothstep(cornerRadius - foldSoftness * 3.0, cornerRadius - foldSoftness * 0.55, cornerArc);
      foldBand *= 1.0 - smoothstep(cornerRadius - foldSoftness * 0.2, cornerRadius + foldSoftness * 1.8, cornerArc);

      uv = applyCornerFoldWarp(uv, foldAmount, cornerRadius, foldSoftness);

      // Subtle rolling scanline jitter
      float jitter = sin(uv.y * 800.0 + uTime * 5.0) * 0.0004;
      uv.x += jitter;

      // Shockwave ring distortions
      for (int i = 0; i < 4; i++) {
        if (float(i) >= uShockwaveCount) break;
        vec2  swCenter = uShockwaves[i].xy;
        float swRadius = uShockwaves[i].z;
        float swIntens = uShockwaves[i].w;
        vec2  d = uv - swCenter;
        float dd = length(d);
        if (dd > 0.001) {
          // Sharp ring: max displacement at swRadius, falls off on both sides
          float ring = exp(-pow((dd - swRadius) * 22.0, 2.0));
          uv += normalize(d) * ring * swIntens;
        }
      }

      float glitchStrength = clamp(uGlitchStrength, 0.0, 1.0);
      vec2 glitchUv = applyGlitchWarp(uv, glitchStrength);
      vec4 base = sampleTiltShift(tDiffuse, glitchUv, uTiltShiftStrength);

      if (glitchStrength > 0.0001) {
        vec2 texel = vec2(1.0 / max(uResolution.x, 1.0), 1.0 / max(uResolution.y, 1.0));
        float pixelStep = mix(1.0, 9.0, glitchStrength);
        vec2 pixelUv = floor(glitchUv / (texel * pixelStep)) * (texel * pixelStep);
        pixelUv = clamp(pixelUv, 0.0, 1.0);

        float smearNoise = rand(vec2(floor(vUv.y * 48.0), floor(uTime * 24.0) + uGlitchSeed * 4.0));
        vec2 smearOffset = vec2((smearNoise - 0.5) * 0.16 * glitchStrength, 0.0);

        vec4 pixelSample = sampleTiltShift(tDiffuse, pixelUv, uTiltShiftStrength);
        vec4 smearSample = sampleTiltShift(tDiffuse, clamp(glitchUv + smearOffset, 0.0, 1.0), uTiltShiftStrength);

        float smearLum = dot(smearSample.rgb, vec3(0.299, 0.587, 0.114));
        float baseLum = dot(base.rgb, vec3(0.299, 0.587, 0.114));
        float sortBias = smoothstep(0.0, 0.28, smearLum - baseLum + glitchStrength * 0.08);
        float blockMix = smoothstep(0.18, 0.95, glitchStrength)
          * (0.35 + 0.65 * rand(vec2(floor(vUv.y * 26.0), uGlitchSeed + floor(uTime * 11.0))));

        base = mix(base, max(smearSample, pixelSample), clamp(sortBias * 0.75 + blockMix * 0.45, 0.0, 0.88));
      }

      // Convert to heat value from base luminance
      float lum = dot(base.rgb, vec3(0.299, 0.587, 0.114));
      // The scene uses .r channel for heat encoding
      float heat = base.r * 0.6 + base.g * 0.3 + base.b * 0.1;
      heat = clamp(heat + uBrightness * 0.05, 0.0, 1.0);

      vec3 thermal = thermalColor(heat);

      // Film grain / noise
      float noise = rand(uv + vec2(uTime * 0.1, uTime * 0.07));
      thermal += (noise - 0.5) * uNoise * 0.06;

      // Scanlines
      float scan = sin(uv.y * 600.0) * 0.03;
      thermal -= scan;

      // Vignette
      float vig = 1.0 - smoothstep(0.4, 0.85, dist);
      thermal *= (0.85 + vig * 0.15);
      thermal *= 1.0 - foldBand * foldAmount * 0.26;
      thermal *= mix(1.0, crtMask, foldAmount);

      thermal = mix(thermal, vec3(0.0), clamp(uBlackFade, 0.0, 1.0));

      gl_FragColor = vec4(clamp(thermal, 0.0, 1.0), 1.0);
    }
  `;

  let material = null;
  let mesh = null;
  let scene2 = null;
  let camera2 = null;
  let renderTarget = null;
  let glitchStrength = 0;
  let glitchBoost = 0;
  let glitchSeed = Math.random() * 1000;
  let nextRandomGlitchAt = 0;
  let lastFrameAt = 0;
  let scriptedGlitchActive = false;
  let scriptedGlitchElapsed = 0;
  let scriptedGlitchDuration = 0;
  let scriptedGlitchMaxStrength = 0;
  let failureGlitchOutActive = false;
  let failureGlitchOutElapsed = 0;
  let failureGlitchOutDuration = 0;
  let failureGlitchOutMaxStrength = 0;

  function nowSeconds() {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
      return performance.now() * 0.001;
    }
    return Date.now() * 0.001;
  }

  function scheduleRandomGlitch(now = nowSeconds()) {
    nextRandomGlitchAt = now + 15 + Math.random() * 5;
  }

  function isGameplayViewActive() {
    return typeof document !== 'undefined'
      && !!document.body
      && document.body.classList.contains('game-active');
  }

  function resetGlitchState() {
    glitchStrength = 0;
    glitchBoost = 0;
    glitchSeed = Math.random() * 1000;
    lastFrameAt = 0;
    scriptedGlitchActive = false;
    scriptedGlitchElapsed = 0;
    scriptedGlitchDuration = 0;
    scriptedGlitchMaxStrength = 0;
    failureGlitchOutActive = false;
    failureGlitchOutElapsed = 0;
    failureGlitchOutDuration = 0;
    failureGlitchOutMaxStrength = 0;
    scheduleRandomGlitch();
  }

  function getFailureGlitchOutState(dt, gameplayViewActive) {
    if (!failureGlitchOutActive || !gameplayViewActive) {
      if (!gameplayViewActive) {
        failureGlitchOutActive = false;
        failureGlitchOutElapsed = 0;
        failureGlitchOutDuration = 0;
        failureGlitchOutMaxStrength = 0;
      }
      return { glitchStrength: 0, blackFade: 0 };
    }

    const duration = Math.max(failureGlitchOutDuration, 0.0001);
    const progress = Math.min(failureGlitchOutElapsed / duration, 1);
    const eased = progress * progress * (3 - 2 * progress);

    if (failureGlitchOutElapsed < duration) {
      failureGlitchOutElapsed = Math.min(failureGlitchOutElapsed + dt, duration);
    }

    return {
      glitchStrength: failureGlitchOutMaxStrength * eased,
      blackFade: eased
    };
  }

  function getScriptedGlitchStrength(dt, gameplayViewActive) {
    if (!scriptedGlitchActive || !gameplayViewActive) {
      if (!gameplayViewActive) {
        scriptedGlitchActive = false;
        scriptedGlitchElapsed = 0;
      }
      return 0;
    }

    const duration = Math.max(scriptedGlitchDuration, 0.0001);
    const progress = Math.min(scriptedGlitchElapsed / duration, 1);
    const easedStrength = scriptedGlitchMaxStrength * Math.pow(1 - progress, 3);

    scriptedGlitchElapsed = Math.min(scriptedGlitchElapsed + dt, duration);
    if (scriptedGlitchElapsed >= duration) {
      scriptedGlitchActive = false;
      scriptedGlitchElapsed = 0;
      scriptedGlitchDuration = 0;
      scriptedGlitchMaxStrength = 0;
    }

    return easedStrength;
  }

  function triggerRandomGlitch(now) {
    glitchStrength = Math.max(glitchStrength, 0.24 + Math.random() * 0.42);
    glitchBoost = Math.max(glitchBoost, 0.08 + Math.random() * 0.12);
    glitchSeed = Math.random() * 1000;
    scheduleRandomGlitch(now);
  }

  function init(renderer, width, height) {
    // Off-screen render target for the scene
    renderTarget = new THREE.WebGLRenderTarget(width, height, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBFormat
    });

    // Fullscreen quad for post-process
    scene2 = new THREE.Scene();
    camera2 = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    material = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse:        { value: renderTarget.texture },
        uTime:           { value: 0 },
        uNoise:          { value: 1.0 },
        uBrightness:     { value: 0.0 },
        uLensDistortion: { value: lensDistortion },
        uGlitchStrength: { value: 0.0 },
        uGlitchSeed:     { value: 0.0 },
        uBlackFade:      { value: 0.0 },
        uTiltShiftStrength: { value: 0.0 },
        uResolution:     { value: new THREE.Vector2(width, height) },
        uShockwaves:     { value: [
          new THREE.Vector4(0,0,0,0),
          new THREE.Vector4(0,0,0,0),
          new THREE.Vector4(0,0,0,0),
          new THREE.Vector4(0,0,0,0)
        ]},
        uShockwaveCount: { value: 0 }
      },
      vertexShader,
      fragmentShader,
      depthTest: false,
      depthWrite: false
    });

    const geo = new THREE.PlaneGeometry(2, 2);
    mesh = new THREE.Mesh(geo, material);
    scene2.add(mesh);
    syncHudFoldVars();
    resetGlitchState();
  }

  function resize(width, height) {
    if (renderTarget) renderTarget.setSize(width, height);
    if (material) material.uniforms.uResolution.value.set(width, height);
  }

  function getRenderTarget() {
    return renderTarget;
  }

  function render(renderer, mainScene, mainCamera, time, tiltShiftStrength = 0) {
    const now = nowSeconds();
    const dt = lastFrameAt > 0 ? Math.min(now - lastFrameAt, 0.1) : (1 / 60);
    lastFrameAt = now;

    const gameplayViewActive = isGameplayViewActive();
    const scriptedStrength = getScriptedGlitchStrength(dt, gameplayViewActive);
    const failureTransition = getFailureGlitchOutState(dt, gameplayViewActive);
    if (gameplayViewActive && !failureGlitchOutActive && now >= nextRandomGlitchAt) {
      triggerRandomGlitch(now);
    }

    if (!gameplayViewActive) {
      glitchStrength = 0;
      glitchBoost = 0;
      if (nextRandomGlitchAt < now + 0.25) scheduleRandomGlitch(now);
    } else {
      glitchStrength = Math.max(0, glitchStrength - dt * 1.9);
      glitchBoost = Math.max(0, glitchBoost - dt * 2.8);
    }

    const transientGlitchStrength = failureGlitchOutActive ? 0 : (glitchStrength + glitchBoost);

    const activeGlitchStrength = gameplayViewActive
      ? Math.min(1, Math.max(scriptedStrength, transientGlitchStrength, failureTransition.glitchStrength))
      : 0;
    const activeBlackFade = gameplayViewActive ? failureTransition.blackFade : 0;

    // 1) Render scene into off-screen target
    renderer.setRenderTarget(renderTarget);
    renderer.render(mainScene, mainCamera);

    // 2) Apply thermal shader to canvas
    renderer.setRenderTarget(null);
    material.uniforms.uTime.value = time;
    material.uniforms.uGlitchStrength.value = activeGlitchStrength;
    material.uniforms.uGlitchSeed.value = glitchSeed;
    material.uniforms.uBlackFade.value = activeBlackFade;
    material.uniforms.uTiltShiftStrength.value = tiltShiftStrength;
    renderer.render(scene2, camera2);
  }

  function setNoise(v) {
    if (material) material.uniforms.uNoise.value = v;
  }

  function setBrightness(v) {
    if (material) material.uniforms.uBrightness.value = v;
  }

  function setLensDistortion(v) {
    lensDistortion = clampLensDistortion(v);
    if (material) material.uniforms.uLensDistortion.value = lensDistortion;
    syncHudFoldVars();
    writeStoredLensDistortion(lensDistortion);
  }

  function getLensDistortion() {
    return lensDistortion;
  }

  function setShockwaves(swArray, count) {
    if (!material) return;
    const arr = material.uniforms.uShockwaves.value;
    for (let i = 0; i < 4; i++) {
      if (i < count && swArray[i]) {
        arr[i].set(swArray[i].x, swArray[i].y, swArray[i].z, swArray[i].w);
      } else {
        arr[i].set(0, 0, 0, 0);
      }
    }
    material.uniforms.uShockwaveCount.value = Math.min(count, 4);
  }

  function addGlitchImpulse(amount = 0.1) {
    const clampedAmount = Math.min(Math.max(amount, 0), 0.35);
    if (clampedAmount <= 0) return;
    glitchBoost = Math.min(0.45, glitchBoost + clampedAmount);
    glitchStrength = Math.min(0.65, Math.max(glitchStrength, clampedAmount * 1.4));
    glitchSeed = Math.random() * 1000;
  }

  function playScriptedGlitch(duration = 1, strength = 1) {
    scriptedGlitchActive = true;
    scriptedGlitchElapsed = 0;
    scriptedGlitchDuration = Math.max(duration, 0.0001);
    scriptedGlitchMaxStrength = Math.min(Math.max(strength, 0), 1);
    glitchSeed = Math.random() * 1000;
  }

  function playFailureGlitchOut(duration = 1, strength = 1) {
    failureGlitchOutActive = true;
    failureGlitchOutElapsed = 0;
    failureGlitchOutDuration = Math.max(duration, 0.0001);
    failureGlitchOutMaxStrength = Math.min(Math.max(strength, 0), 1);
    glitchStrength = 0;
    glitchBoost = 0;
    glitchSeed = Math.random() * 1000;
  }

  function clearScriptedGlitch() {
    scriptedGlitchActive = false;
    scriptedGlitchElapsed = 0;
    scriptedGlitchDuration = 0;
    scriptedGlitchMaxStrength = 0;
    failureGlitchOutActive = false;
    failureGlitchOutElapsed = 0;
    failureGlitchOutDuration = 0;
    failureGlitchOutMaxStrength = 0;
  }

  return {
    init,
    resize,
    render,
    getRenderTarget,
    setNoise,
    setBrightness,
    getLensDistortion,
    setLensDistortion,
    setShockwaves,
    addGlitchImpulse,
    playScriptedGlitch,
    playFailureGlitchOut,
    clearScriptedGlitch
  };
})();
