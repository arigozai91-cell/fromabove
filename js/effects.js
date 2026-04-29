/* =============================================
   EFFECTS.JS — Explosions, tracers, smoke, glow
   ============================================= */
'use strict';

const EffectsSystem = (() => {
  const SURFACE_FLASH_Y_OFFSET = 0.42;
  const GROUND_GLOW_Y_OFFSET = 0.5;
  const SHOCKWAVE_Y_OFFSET = 0.65;
  const MINIGUN_RICOCHET_CHANCE = 0.2;
  const MINIGUN_RICOCHET_MAX_SURFACE_ANGLE_DEG = 80;
  const MINIGUN_RICOCHET_MIN_SPEED_MULT = 0.3;
  const MINIGUN_RICOCHET_MAX_SPEED_MULT = 0.6;

  let scene = null;
  let particles = [];
  let smokeTrails = [];
  let shakeIntensity = 0;
  let shakeDuration = 0;
  let _camera = null;
  // (distortionWaves removed — shockwaves are world-space ground rings)

  function finalizeCanvasTexture(texture) {
    texture.premultiplyAlpha = true;
    texture.needsUpdate = true;
    return texture;
  }

  // Radial gradient texture for ground light pool: opaque centre -> transparent edge
  let _lightPoolTexture = null;
  function getLightPoolTexture() {
    if (_lightPoolTexture) return _lightPoolTexture;
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 256;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
    grad.addColorStop(0,    'rgba(255,255,255,1)');
    grad.addColorStop(0.5,  'rgba(255,255,255,0.6)');
    grad.addColorStop(1,    'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 256, 256);
    _lightPoolTexture = finalizeCanvasTexture(new THREE.CanvasTexture(canvas));
    return _lightPoolTexture;
  }

  // Radial gradient texture: white opaque centre -> fully transparent edge
  let _glowTexture = null;
  function getGlowTexture() {
    if (_glowTexture) return _glowTexture;
    const canvas = document.createElement('canvas');
    canvas.width = 128; canvas.height = 128;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0,    'rgba(255,255,255,0.9)');
    grad.addColorStop(0.3,  'rgba(255,255,255,0.45)');
    grad.addColorStop(0.65, 'rgba(255,255,255,0.1)');
    grad.addColorStop(1,    'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);
    _glowTexture = finalizeCanvasTexture(new THREE.CanvasTexture(canvas));
    return _glowTexture;
  }

  let _shockwaveRingTexture = null;
  function getShockwaveRingTexture() {
    if (_shockwaveRingTexture) return _shockwaveRingTexture;
    const sz = 256;
    const canvas = document.createElement('canvas');
    canvas.width = sz;
    canvas.height = sz;
    const ctx = canvas.getContext('2d');
    const imageData = ctx.createImageData(sz, sz);
    const data = imageData.data;
    const center = (sz - 1) * 0.5;
    const radius = center;

    for (let py = 0; py < sz; py++) {
      for (let px = 0; px < sz; px++) {
        const dx = px - center;
        const dy = py - center;
        const dist = Math.sqrt(dx * dx + dy * dy) / radius;
        let alpha = 0;

        if (dist < 0.56) {
          alpha = 0;
        } else if (dist < 0.9) {
          const t = Utils.clamp((dist - 0.56) / 0.34, 0, 1);
          alpha = t * t * (3 - 2 * t);
        } else if (dist < 1.0) {
          const t = Utils.clamp((dist - 0.9) / 0.1, 0, 1);
          alpha = 1.0 - 0.5 * (t * t * (3 - 2 * t));
        } else if (dist < 1.08) {
          const t = Utils.clamp((dist - 1.0) / 0.08, 0, 1);
          alpha = 0.5 * (1 - (t * t * (3 - 2 * t)));
        }

        const idx = (py * sz + px) * 4;
        data[idx] = 255;
        data[idx + 1] = 255;
        data[idx + 2] = 255;
        data[idx + 3] = Math.round(Utils.clamp(alpha, 0, 1) * 255);
      }
    }

    ctx.putImageData(imageData, 0, 0);
    _shockwaveRingTexture = finalizeCanvasTexture(new THREE.CanvasTexture(canvas));
    return _shockwaveRingTexture;
  }

  // Radial gradient texture for smoke: fully opaque centre -> transparent edge
  let _smokeAlphaTex = null;
  function getSmokeAlphaTex() {
    if (_smokeAlphaTex) return _smokeAlphaTex;
    const sz = 128;
    const canvas = document.createElement('canvas');
    canvas.width = sz; canvas.height = sz;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createRadialGradient(sz/2, sz/2, 0, sz/2, sz/2, sz/2);
    grad.addColorStop(0,   'rgba(255,255,255,1)');
    grad.addColorStop(0.45,'rgba(255,255,255,0.85)');
    grad.addColorStop(0.8, 'rgba(255,255,255,0.25)');
    grad.addColorStop(1,   'rgba(255,255,255,0)');
    ctx.clearRect(0, 0, sz, sz);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, sz, sz);
    _smokeAlphaTex = finalizeCanvasTexture(new THREE.CanvasTexture(canvas));
    return _smokeAlphaTex;
  }

  // Noisy heat glow texture: radial gradient + black grain so it looks like scorched earth
  let _heatGlowTex = null;
  function getHeatGlowTex() {
    if (_heatGlowTex) return _heatGlowTex;
    const sz = 256;
    const canvas = document.createElement('canvas');
    canvas.width = sz; canvas.height = sz;
    const ctx = canvas.getContext('2d');

    // Radial gradient base
    const grad = ctx.createRadialGradient(sz/2, sz/2, 0, sz/2, sz/2, sz/2);
    grad.addColorStop(0,    'rgba(255,255,255,1)');
    grad.addColorStop(0.5,  'rgba(255,255,255,0.75)');
    grad.addColorStop(0.82, 'rgba(255,255,255,0.2)');
    grad.addColorStop(1,    'rgba(255,255,255,0)');
    ctx.clearRect(0, 0, sz, sz);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, sz, sz);

    // Overlay black noise grain to break up the smooth circle
    const imageData = ctx.getImageData(0, 0, sz, sz);
    const data = imageData.data;
    const cx = sz / 2, cy = sz / 2, r = sz / 2;
    for (let y = 0; y < sz; y++) {
      for (let x = 0; x < sz; x++) {
        const dx = x - cx, dy = y - cy;
        const dist = Math.sqrt(dx*dx + dy*dy) / r; // 0 = center, 1 = edge
        const i = (y * sz + x) * 4;
        if (data[i + 3] < 4) continue; // skip fully transparent pixels
        // More grain toward the edges where the glow fades
        const grainStrength = 0.3 + dist * 1.1;
        const noise = Math.random();
        if (noise < grainStrength * 0.65) {
          // Darken pixel: black spots of varying size
          const darkness = (0.5 + Math.random() * 0.5) * grainStrength;
          data[i]     = Math.max(0, data[i]     * (1 - darkness));
          data[i + 1] = Math.max(0, data[i + 1] * (1 - darkness));
          data[i + 2] = Math.max(0, data[i + 2] * (1 - darkness));
        }
      }
    }
    ctx.putImageData(imageData, 0, 0);

    _heatGlowTex = finalizeCanvasTexture(new THREE.CanvasTexture(canvas));
    return _heatGlowTex;
  }

  function init(sceneRef, cameraRef) {
    scene = sceneRef;
    if (cameraRef) _camera = cameraRef;
  }

  function setCamera(cam) { _camera = cam; }

  function estimateRadialSpreadDistance(initialSpeed, maxAge, drag, distDragMult) {
    const step = 1 / 60;
    let speed = initialSpeed;
    let distance = 0;
    let elapsed = 0;

    while (elapsed < maxAge) {
      const dt = Math.min(step, maxAge - elapsed);
      const totalDrag = drag + distance * distDragMult;
      speed *= Math.exp(-totalDrag * dt);
      distance += speed * dt;
      elapsed += dt;
    }

    return distance;
  }


function getRadialSpreadProgress(t) {
  if (t <= 0) return 0;
  if (t >= 1) return 1;

  const sharpness = 13.0;
  return (1 - Math.exp(-sharpness * t)) / (1 - Math.exp(-sharpness));
}

  const SMOKE_PROFILES = {
    default: {
      burst: {
        countBase: 4,
        countPerSize: 2,
        delayMin: 0,
        delayMax: 0.25,
        initSizeMin: 0.35,
        initSizeMax: 0.55,
        initHeatMin: 0.38,
        initHeatRange: 0.20,
        spawnYOffset: 0.5,
        outSpeedMin: 2,
        outSpeedMax: 4.5,
        maxAgeBase: 2,
        maxAgeRange: 3,
        vyMin: 1.0,
        vyMax: 2.5,
        dragMin: 0.7,
        dragMax: 1.2,
        maxGrowthMin: 1,
        maxGrowthMax: 1.5,
        tumbleMin: -0.4,
        tumbleMax: 0.4,
        endExpandStart: 0.22,
        endExpandAmount: 0.55
      },
      column: {
        countBase: 5,
        countPerSize: 3,
        delayMin: 0.2,
        delayMax: 1.4,
        initSizeMin: 0.3,
        initSizeMax: 0.55,
        initHeatMin: 0.15,
        initHeatRange: 0.12,
        spawnOffsetMin: -0.4,
        spawnOffsetMax: 0.4,
        spawnYMin: 0.3,
        spawnYMax: 1.2,
        driftSpeedMin: 0.15,
        driftSpeedMax: 0.6,
        maxAge: 2,
        vyMin: 2.5,
        vyMax: 6.0,
        dragMin: 0.3,
        dragMax: 0.6,
        maxGrowthMin: 3.5,
        maxGrowthMax: 6.0,
        tumbleMin: -0.25,
        tumbleMax: 0.25,
        endExpandStart: 0.32,
        endExpandAmount: 0.4,
        maxOpacity: 0.10
      },
      radial: {
        enabledMinSize: 2.5,
        countBase: 20,
        countPerSize: 4,
        countMultiplier: 0.7,
        initSizeMin: 0.595,
        initSizeMax: 1,
        initHeatMin: 0.33,
        initHeatRange: 0.12,
        spawnYOffset: 1.5,
        outSpeedMin: 10.0,
        outSpeedMax: 17.0,
        maxAgeBase: 3,
        maxAgeRange: 2,
        dragMin: 0.4,
        dragMax: 0.8,
        distDragMult: 0.45,
        spreadDistanceNearMultiplier: 0.65,
        spreadDistanceFarMultiplier: 1.3,
        maxGrowthMin: 0.9,
        maxGrowthMax: 1.2,
        tumbleMin: -0.3,
        tumbleMax: 0.3,
        endExpandStart: 0.25,
        endExpandAmount: 0.35,
        maxOpacity: 0.45
      }
    },
    vehicle: {
      burst: {
        countBase: 4,
        countPerSize: 2,
        delayMin: 0,
        delayMax: 0.25,
        initSizeMin: 0.35,
        initSizeMax: 0.55,
        initHeatMin: 0.38,
        initHeatRange: 0.20,
        spawnYOffset: 0.5,
        outSpeedMin: 2,
        outSpeedMax: 4.5,
        maxAgeBase: 2,
        maxAgeRange: 3,
        vyMin: 1.0,
        vyMax: 2.5,
        dragMin: 0.7,
        dragMax: 1.2,
        maxGrowthMin: 1,
        maxGrowthMax: 1.5,
        tumbleMin: -0.4,
        tumbleMax: 0.4,
        endExpandStart: 0.22,
        endExpandAmount: 0.55
      },
      column: {
        countBase: 5,
        countPerSize: 3,
        delayMin: 0.2,
        delayMax: 1.4,
        initSizeMin: 0.3,
        initSizeMax: 0.55,
        initHeatMin: 0.15,
        initHeatRange: 0.12,
        spawnOffsetMin: -0.4,
        spawnOffsetMax: 0.4,
        spawnYMin: 0.3,
        spawnYMax: 1.2,
        driftSpeedMin: 0.15,
        driftSpeedMax: 0.6,
        maxAge: 2,
        vyMin: 2.5,
        vyMax: 6.0,
        dragMin: 0.3,
        dragMax: 0.6,
        maxGrowthMin: 3.5,
        maxGrowthMax: 6.0,
        tumbleMin: -0.25,
        tumbleMax: 0.25,
        endExpandStart: 0.32,
        endExpandAmount: 0.4,
        maxOpacity: 0.10
      },
      radial: {
        enabledMinSize: 2.5,
        countBase: 20,
        countPerSize: 4,
        countMultiplier: 0.7,
        initSizeMin: 0.595,
        initSizeMax: 1,
        initHeatMin: 0.33,
        initHeatRange: 0.12,
        spawnYOffset: 1.5,
        outSpeedMin: 10.0,
        outSpeedMax: 17.0,
        maxAgeBase: 3,
        maxAgeRange: 2,
        dragMin: 0.4,
        dragMax: 0.8,
        distDragMult: 0.45,
        spreadDistanceNearMultiplier: 0.65,
        spreadDistanceFarMultiplier: 1.3,
        maxGrowthMin: 0.9,
        maxGrowthMax: 1.2,
        tumbleMin: -0.3,
        tumbleMax: 0.3,
        endExpandStart: 0.25,
        endExpandAmount: 1.15,
        maxOpacity: 0.45
      }
    },
    minigunImpact: {
      burst: {
        countBase: 4,
        countPerSize: 2,
        delayMin: 0,
        delayMax: 0.14,
        initSizeMin: 0.35,
        initSizeMax: 0.55,
        initHeatMin: 0.38,
        initHeatRange: 0.20,
        spawnYOffset: 0.5,
        outSpeedMin: 2.4,
        outSpeedMax: 5.2,
        maxAgeBase: 1.3,
        maxAgeRange: 1.95,
        vyMin: 1.1,
        vyMax: 2.8,
        dragMin: 0.7,
        dragMax: 1.2,
        maxGrowthMin: 1.25,
        maxGrowthMax: 1.85,
        tumbleMin: -0.4,
        tumbleMax: 0.4,
        endExpandStart: 0.16,
        endExpandAmount: 0.8,
        maxOpacity: 0.52
      },
      column: {
        countBase: 5,
        countPerSize: 3,
        delayMin: 0.08,
        delayMax: 0.9,
        initSizeMin: 0.3,
        initSizeMax: 0.55,
        initHeatMin: 0.15,
        initHeatRange: 0.12,
        spawnOffsetMin: -0.4,
        spawnOffsetMax: 0.4,
        spawnYMin: 0.3,
        spawnYMax: 1.2,
        driftSpeedMin: 0.18,
        driftSpeedMax: 0.7,
        maxAge: 1.3,
        vyMin: 2.8,
        vyMax: 6.4,
        dragMin: 0.3,
        dragMax: 0.6,
        maxGrowthMin: 4.4,
        maxGrowthMax: 7.5,
        tumbleMin: -0.25,
        tumbleMax: 0.25,
        endExpandStart: 0.22,
        endExpandAmount: 0.65,
        maxOpacity: 0.12
      }
    }
  };
  // ---------- Screen shake ----------

  function triggerShake(intensity, duration) {
    shakeIntensity = Math.max(shakeIntensity, intensity);
    shakeDuration = Math.max(shakeDuration, duration);
  }

  function getShake() {
    return {
      x: (Math.random() - 0.5) * shakeIntensity * 2,
      y: (Math.random() - 0.5) * shakeIntensity * 2
    };
  }

  // ---------- Flash ----------

  function triggerFlash(type = 'white') {
    const el = document.getElementById('screen-flash');
    if (!el) return;
    el.className = `flash-${type}`;
    setTimeout(() => el.className = '', 80);
  }

  function spawnSurfaceFlash(x, z, size, options = {}) {
    const flashGeo = new THREE.CircleGeometry(size * 8, options.segments || 32);
    flashGeo.rotateX(-Math.PI / 2);
    const peakOpacity = options.peakOpacity !== undefined ? options.peakOpacity : 0.55;
    const flashMat = new THREE.MeshBasicMaterial({
      map: getLightPoolTexture(),
      color: new THREE.Color(0.95, 0.95, 0.95),
      transparent: true,
      opacity: peakOpacity,
      side: THREE.DoubleSide,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      alphaTest: 0.01
    });
    const flash = new THREE.Mesh(flashGeo, flashMat);
    flash.position.set(x, TerrainSystem.getHeightAt(x, z) + SURFACE_FLASH_Y_OFFSET, z);
    flash.renderOrder = 30;
    scene.add(flash);
    particles.push({
      mesh: flash,
      type: 'explosion-light',
      age: 0,
      maxAge: options.maxAge !== undefined ? options.maxAge : 0.35,
      peakOpacity
    });

    const glowOpacity = options.glowOpacity !== undefined ? options.glowOpacity : 0.18;
    if (glowOpacity > 0) {
      const glowGeo = new THREE.CircleGeometry(size * (options.glowRadiusMultiplier !== undefined ? options.glowRadiusMultiplier : 9.5), options.segments || 32);
      glowGeo.rotateX(-Math.PI / 2);
      const glowMat = new THREE.MeshBasicMaterial({
        map: getLightPoolTexture(),
        color: new THREE.Color(0.9, 0.9, 0.9),
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
        alphaTest: 0.01
      });
      const glow = new THREE.Mesh(glowGeo, glowMat);
      glow.position.set(x, TerrainSystem.getHeightAt(x, z) + GROUND_GLOW_Y_OFFSET, z);
      glow.renderOrder = 29;
      scene.add(glow);
      particles.push({
        mesh: glow,
        type: 'ground-glow',
        age: 0,
        maxAge: options.glowMaxAge !== undefined ? options.glowMaxAge : 0.7,
        maxOpacity: glowOpacity
      });
    }
  }

  // ---------- Explosion ----------

  function spawnExplosion(x, y, z, size, options = {}) {
    // Quality multiplier from settings (1.0 / 0.75 / 0.5)
    const qMult = (typeof MenuSystem !== 'undefined') ? MenuSystem.getParticleMultiplier() : 1.0;
    const smokeScale = options.smokeScale !== undefined ? Math.max(0, options.smokeScale) : 1.0;
    const smokeProfile = SMOKE_PROFILES[options.smokeProfile] || SMOKE_PROFILES.default;

    // Central fireball — short flash, radial gradient (opaque centre → transparent edge)
    const fbMat = new THREE.SpriteMaterial({
      map: getSmokeAlphaTex(),
      color: new THREE.Color(0.95, 0.95, 0.95),
      transparent: true,
      opacity: 1.0,
      alphaTest: 0.02,
      depthWrite: false
    });
    const fireball = new THREE.Sprite(fbMat);
    fireball.scale.set(size * 2, size * 2, 1);
    fireball.position.set(x, y, z);
    scene.add(fireball);

    particles.push({
      mesh: fireball,
      type: 'fireball',
      isSprite: true,
      age: 0,
      maxAge: 0.15,
      vy: size * 2,
      size
    });

    // Blurry gradient glow - Sprite always faces camera, gradient centre->transparent edge
    const glowMat = new THREE.SpriteMaterial({
      map: getGlowTexture(),
      transparent: true,
      opacity: 0.9,
      alphaTest: 0.02,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    const glowSprite = new THREE.Sprite(glowMat);
    glowSprite.scale.setScalar(size * 14);
    glowSprite.position.set(x, y, z);
    scene.add(glowSprite);
    particles.push({
      mesh: glowSprite,
      type: 'explosion-glow',
      age: 0,
      maxAge: size > 0.5 ? 0.2 : 0.5 + size * 0.15,
      linkedMesh: fireball,
      flickerTimer: 0,
      flickerState: true
    });

    // Ejected sparks
    const sparkCount = Math.floor((Utils.randFloat(8, 20) + size * Utils.randFloat(7, 14)) * qMult);
    for (let i = 0; i < sparkCount; i++) {
      const sGeo = new THREE.SphereGeometry(0.10 + Math.random() * 0.16, 4, 4);
      const brightness = 0.75 + Math.random() * 0.25;
      const sMat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(brightness, brightness, brightness),
        transparent: true,
        opacity: 1.0
      });
      const spark = new THREE.Mesh(sGeo, sMat);
      spark.position.set(x, y, z);
      scene.add(spark);

      const angle = Math.random() * Math.PI * 2;
      const elev  = Math.random() * Math.PI / 2;
      const speed = size * Utils.randFloat(3, 12);

      particles.push({
        mesh: spark,
        type: 'spark',
        age: 0,
        maxAge: 3,
        grounded: false,
        vx: Math.cos(angle) * Math.cos(elev) * speed,
        vy: Math.sin(elev) * speed + size * Utils.randFloat(2, 5),
        vz: Math.sin(angle) * Math.cos(elev) * speed,
        gravity: -25
      });
    }

    // Ground splash ring
    const splashCount = Math.min(8, Math.max(1, Math.floor((4 + Math.floor(size)) * qMult)));
    for (let i = 0; i < splashCount; i++) {
      const angle = (i / splashCount) * Math.PI * 2;
      const sGeo = new THREE.SphereGeometry(0.14, 3, 3);
      const sMat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(0.55, 0.55, 0.55),
        transparent: true,
        opacity: 0.9
      });
      const s = new THREE.Mesh(sGeo, sMat);
      s.position.set(x, y + 0.1, z);
      scene.add(s);
      const splashSpeed = size * Utils.randFloat(1.5, 4);
      particles.push({
        mesh: s,
        type: 'spark',
        age: 0,
        maxAge: 3,
        grounded: false,
        vx: Math.cos(angle) * splashSpeed,
        vy: 0.5,
        vz: Math.sin(angle) * splashSpeed,
        gravity: -20
      });
    }

    // Flicker sparks
    const flickerCount = Math.floor((Utils.randFloat(4, 12) + size * Utils.randFloat(2, 7)) * qMult);
    for (let i = 0; i < flickerCount; i++) {
      const fGeo = new THREE.SphereGeometry(0.06 + Math.random() * 0.08, 3, 3);
      const fMat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(0.95, 0.95, 0.95),
        transparent: true,
        opacity: 1.0
      });
      const fspark = new THREE.Mesh(fGeo, fMat);
      fspark.position.set(x, y, z);
      scene.add(fspark);
      const fAngle = Math.random() * Math.PI * 2;
      const fElev  = 0.4 + Math.random() * (Math.PI * 0.45);
      const fSpeed = size * Utils.randFloat(4, 12);
      particles.push({
        mesh: fspark,
        type: 'flicker-spark',
        age: 0,
        maxAge: 3,
        grounded: false,
        vx: Math.cos(fAngle) * Math.cos(fElev) * fSpeed,
        vy: Math.sin(fElev) * fSpeed + size * Utils.randFloat(3, 7),
        vz: Math.sin(fAngle) * Math.cos(fElev) * fSpeed,
        gravity: -9
      });
    }

    if (options.surfaceFlash !== false) {
      spawnSurfaceFlash(x, z, size, { peakOpacity: 0.55, maxAge: 0.35, segments: 32 });
    }

    // Ground heat glow — flat circle with radial gradient (opaque centre → transparent edge)
    const glowGroundY = TerrainSystem.getHeightAt(x, z);
    const glowRadius = size * 1.8;
    const glowGeo = new THREE.CircleGeometry(glowRadius, 32);
    glowGeo.rotateX(-Math.PI / 2);
    const groundGlowMat = new THREE.MeshBasicMaterial({
      map: getHeatGlowTex(),
      color: new THREE.Color(0.85, 0.85, 0.85),
      transparent: true,
      opacity: 0.0,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    const glow = new THREE.Mesh(glowGeo, groundGlowMat);
    glow.position.set(x, glowGroundY + GROUND_GLOW_Y_OFFSET, z);
    scene.add(glow);
    particles.push({
      mesh: glow,
      type: 'ground-glow',
      age: 0,
      maxAge: 6,
      maxScale: 1,
      maxOpacity: 0.9
    });

    // Smoke puffs that linger (heat signature)
    // Scale smoke independently: 25mm 4x, 40mm 3x, 105mm unchanged
    const smokeSize = size <= 1.0 ? size * 3 : (size <= 2.5 ? size * 2 : size);
    if (smokeScale > 0) spawnSmoke(x, y, z, smokeSize * smokeScale, smokeProfile);

    // Shockwave ring
    spawnShockwave(x, y, z, size, { style: options.shockwaveStyle });

    AudioSystem.playExplosion(size);
    triggerShake(size * 0.30, size * 0.2);
    if (size > 1.5) triggerFlash('orange');
    if (size > 2.0) triggerFlash('white');
  }

  function spawnShockwave(x, y, z, size, options = {}) {
    const style = options.style || 'ground';
    const groundY = TerrainSystem.getHeightAt(x, z) + SHOCKWAVE_Y_OFFSET;
    const ringCount = 1;

    for (let r = 0; r < ringCount; r++) {
      const delay       = r * 0.07;
      const scaleMult = style === 'billboard'
        ? (size >= 2.0 ? Utils.randFloat(1.5, 2) : Utils.randFloat(0.75, size * 0.45 + 0.55))
        : (size >= 2.0 ? Utils.randFloat(0.6, 0.9) : Utils.randFloat(0.25, size * 0.3 + 0.2));
      const brightness  = Utils.randFloat(0.55, 0.95);
      const ringColor = new THREE.Color(brightness, brightness, brightness);
      let ring;

      if (style === 'billboard') {
        const mat = new THREE.SpriteMaterial({
          map: getShockwaveRingTexture(),
          color: ringColor,
          transparent: true,
          opacity: 0.1,
          alphaTest: 0.01,
          depthWrite: false,
          blending: THREE.AdditiveBlending
        });
        ring = new THREE.Sprite(mat);
        const baseScale = Math.max(1.8, size * 2.5);
        ring.scale.set(baseScale, baseScale, 1);
        ring.position.set(x, y + Math.max(0.36, size * 0.12), z);
        ring.renderOrder = 31;
        scene.add(ring);
        particles.push({
          mesh: ring,
          type: 'shockwave',
          isSprite: true,
          age: -delay,
          maxAge: 0.24,
          maxScale: scaleMult,
          baseScale,
          maxOpacity: 0.1
        });
        continue;
      }

      const geo = new THREE.RingGeometry(0.05, 0.55, 32);
      geo.rotateX(-Math.PI / 2);
      const mat = new THREE.MeshBasicMaterial({
        color: ringColor,
        transparent: true,
        opacity: 0.85,
        side: THREE.DoubleSide,
        depthWrite: false
      });
      ring = new THREE.Mesh(geo, mat);
      ring.position.set(x, groundY, z);
      scene.add(ring);
      particles.push({
        mesh: ring,
        type: 'shockwave',
        age: -delay,
        maxAge: 0.1 + r * 0,
        maxScale: scaleMult,
        baseScale: 1,
        maxOpacity: 0.85
      });
    }
  }

  function spawnSmoke(x, y, z, size, profile = SMOKE_PROFILES.default) {
    const groundY = TerrainSystem.getHeightAt(x, z);
    const qMult = (typeof MenuSystem !== 'undefined') ? MenuSystem.getParticleMultiplier() : 1.0;
    const burst = profile.burst || SMOKE_PROFILES.default.burst;
    const column = profile.column || SMOKE_PROFILES.default.column;
    const radial = profile.radial || SMOKE_PROFILES.default.radial;

    // --- Wave 1: Outward burst (hot, low, spread sidewards) ---
    const burstCount = Math.max(1, Math.floor((burst.countBase + size * burst.countPerSize) * qMult));
    for (let i = 0; i < burstCount; i++) {
      const delay = Utils.randFloat(burst.delayMin, burst.delayMax);
      const initSize = size * Utils.randFloat(burst.initSizeMin, burst.initSizeMax);
      const initHeat = burst.initHeatMin + Math.random() * burst.initHeatRange;   // hot — bright in FLIR
      const sMat = new THREE.SpriteMaterial({
        map: getSmokeAlphaTex(),
        color: new THREE.Color(initHeat, initHeat, initHeat),
        transparent: true, opacity: 0.0,
        alphaTest: 0.02,
        depthWrite: false
      });
      const smoke = new THREE.Sprite(sMat);
      smoke.scale.set(initSize * 2, initSize * 2, 1);
      smoke.position.set(x, groundY + burst.spawnYOffset, z);
      scene.add(smoke);
      const angle = Math.random() * Math.PI * 2;
      const outSpeed = size * Utils.randFloat(burst.outSpeedMin, burst.outSpeedMax);
      smokeTrails.push({
        mesh: smoke, age: 0, delay, isSprite: true,
        maxAge: burst.maxAgeBase + Math.random() * burst.maxAgeRange,
        vy: size * Utils.randFloat(burst.vyMin, burst.vyMax),
        vx: Math.cos(angle) * outSpeed,
        vz: Math.sin(angle) * outSpeed,
        drag: Utils.randFloat(burst.dragMin, burst.dragMax),
        ox: x, oz: z,
        initScale: initSize,
        maxGrowth: size * Utils.randFloat(burst.maxGrowthMin, burst.maxGrowthMax),
        tumble: Utils.randFloat(burst.tumbleMin, burst.tumbleMax),
        endExpandStart: burst.endExpandStart,
        endExpandAmount: burst.endExpandAmount
      });
    }

    // --- Wave 2: Rising column (cooler, spawns above, mostly upward) ---
    const colCount = Math.max(1, Math.floor((column.countBase + size * column.countPerSize) * qMult));
    for (let i = 0; i < colCount; i++) {
      const delay = Utils.randFloat(column.delayMin, column.delayMax);   // staggered: column builds over time
      const initSize = size * Utils.randFloat(column.initSizeMin, column.initSizeMax);
      const initHeat = column.initHeatMin + Math.random() * column.initHeatRange;   // cooler — darker in FLIR
      const sMat = new THREE.SpriteMaterial({
        map: getSmokeAlphaTex(),
        color: new THREE.Color(initHeat, initHeat, initHeat),
        transparent: true, opacity: 0.0,
        alphaTest: 0.02,
        depthWrite: false
      });
      const smoke = new THREE.Sprite(sMat);
      smoke.scale.set(initSize * 6, initSize * 6, 1);
      smoke.position.set(
        x + size * Utils.randFloat(column.spawnOffsetMin, column.spawnOffsetMax),
        groundY + size * Utils.randFloat(column.spawnYMin, column.spawnYMax),
        z + size * Utils.randFloat(column.spawnOffsetMin, column.spawnOffsetMax)
      );
      scene.add(smoke);
      const driftAngle = Math.random() * Math.PI * 2;
      const driftSpeed = size * Utils.randFloat(column.driftSpeedMin, column.driftSpeedMax);  // mostly up, slight drift
      smokeTrails.push({
        mesh: smoke, age: 0, delay, isSprite: true,
        maxAge: column.maxAge,
        vy: size * Utils.randFloat(column.vyMin, column.vyMax),
        vx: Math.cos(driftAngle) * driftSpeed,
        vz: Math.sin(driftAngle) * driftSpeed,
        drag: Utils.randFloat(column.dragMin, column.dragMax),
        ox: x, oz: z,
        initScale: initSize,
        maxGrowth: size * Utils.randFloat(column.maxGrowthMin, column.maxGrowthMax),
        tumble: Utils.randFloat(column.tumbleMin, column.tumbleMax),
        endExpandStart: column.endExpandStart,
        endExpandAmount: column.endExpandAmount,
        maxOpacity: column.maxOpacity
      });
    }

    // --- Wave 3: Ground-hugging radial spread (30mm, 40mm, 105mm) — strictly sideways, smaller than Wave 1 ---
    if (size >= radial.enabledMinSize) {
      const radCount = Math.max(1, Math.floor((radial.countBase + size * radial.countPerSize) * qMult * radial.countMultiplier));
      for (let i = 0; i < radCount; i++) {
        const delay = 0;
        const initSize = size * Utils.randFloat(radial.initSizeMin, radial.initSizeMax);
        const initHeat = radial.initHeatMin + Math.random() * radial.initHeatRange;
        const sMat = new THREE.SpriteMaterial({
          map: getSmokeAlphaTex(),
          color: new THREE.Color(initHeat, initHeat, initHeat),
          transparent: true, opacity: 0.0,
          alphaTest: 0.02,
          depthWrite: false
        });
        const smoke = new THREE.Sprite(sMat);
        smoke.scale.set(initSize * 2, initSize * 2, 1);
        smoke.position.set(x, groundY + radial.spawnYOffset, z);   // raised — prevents sprite clipping into terrain
        scene.add(smoke);
        const angle = Math.random() * Math.PI * 2;
        const outSpeed = size * Utils.randFloat(radial.outSpeedMin, radial.outSpeedMax);
        const maxAge = radial.maxAgeBase + Math.random() * radial.maxAgeRange;
        const drag = Utils.randFloat(radial.dragMin, radial.dragMax);
        const distDragMult = radial.distDragMult;
        const spreadDistanceMultiplier = size < 3 ? radial.spreadDistanceNearMultiplier : radial.spreadDistanceFarMultiplier;
        smokeTrails.push({
          mesh: smoke, age: 0, delay, isSprite: true,
          maxAge,
          vy: 0,                                   // strictly horizontal — no rise
          vx: Math.cos(angle) * outSpeed,
          vz: Math.sin(angle) * outSpeed,
          drag,
          distDragMult,                            // stronger slowdown the farther from center
          ox: x, oz: z,
          baseY: groundY + radial.spawnYOffset,
          spreadAngle: angle,
          spreadDistance: estimateRadialSpreadDistance(outSpeed, maxAge, drag, distDragMult) * spreadDistanceMultiplier,
          radialSpread: true,
          syncFadeToSpread: true,
          initScale: initSize,
          maxGrowth: size * Utils.randFloat(radial.maxGrowthMin, radial.maxGrowthMax),
          tumble: Utils.randFloat(radial.tumbleMin, radial.tumbleMax),
          endExpandStart: radial.endExpandStart,
          endExpandAmount: radial.endExpandAmount,
          maxOpacity: radial.maxOpacity
        });
      }
    }
  }

  function spawnTankMuzzleSmoke(x, y, z, size = 1.2) {
    const qMult = (typeof MenuSystem !== 'undefined') ? MenuSystem.getParticleMultiplier() : 1.0;
    const burstCount = Math.max(10, Math.floor((11 + size * 8) * qMult));
    for (let i = 0; i < burstCount; i++) {
      const delay = Math.random() * 0.04;
      const initSize = size * Utils.randFloat(0.28, 0.48);
      const initHeat = 0.26 + Math.random() * 0.14;
      const sMat = new THREE.SpriteMaterial({
        map: getSmokeAlphaTex(),
        color: new THREE.Color(initHeat, initHeat, initHeat),
        transparent: true,
        opacity: 0.0,
        alphaTest: 0.02,
        depthWrite: false
      });
      const smoke = new THREE.Sprite(sMat);
      smoke.scale.set(initSize * 2, initSize * 2, 1);
      smoke.position.set(x, y, z);
      scene.add(smoke);
      const angle = Math.random() * Math.PI * 2;
      const outSpeed = size * Utils.randFloat(10.5, 16.5);
      smokeTrails.push({
        mesh: smoke,
        age: 0,
        delay,
        isSprite: true,
        maxAge: 1.6 + Math.random() * 1.0,
        vy: Utils.randFloat(-0.04, 0.14),
        vx: Math.cos(angle) * outSpeed,
        vz: Math.sin(angle) * outSpeed,
        drag: Utils.randFloat(0.42, 0.72),
        distDragMult: 0.42,
        ox: x,
        oz: z,
        initScale: initSize,
        maxGrowth: size * Utils.randFloat(0.75, 1),
        endExpandStart: 0.5,
        tumble: Utils.randFloat(-0.25, 0.25),
        maxOpacity: 0.6
      });
    }
  }

  // Bullet impact (small)
  function spawnImpact(x, y, z, particleOptions = 1.0) {
    // Random intensity 10%–100% per hit
    const intensity = 0.1 + Math.random() * 0.9;
    const qMult = (typeof MenuSystem !== 'undefined') ? MenuSystem.getParticleMultiplier() : 1.0;
    const impactParticleScale = typeof particleOptions === 'number'
      ? Utils.clamp(particleOptions, 0.1, 1.0)
      : Utils.clamp(particleOptions.particleScale !== undefined ? particleOptions.particleScale : 1.0, 0.1, 1.0);
    const maxDustCount = typeof particleOptions === 'object' && particleOptions !== null && particleOptions.maxDustCount !== undefined
      ? Math.max(0, Math.floor(particleOptions.maxDustCount))
      : null;
    const maxSparkCount = typeof particleOptions === 'object' && particleOptions !== null && particleOptions.maxSparkCount !== undefined
      ? Math.max(0, Math.floor(particleOptions.maxSparkCount))
      : null;
    const dustVelocityScale = typeof particleOptions === 'object' && particleOptions !== null && particleOptions.dustVelocityScale !== undefined
      ? Math.max(0, particleOptions.dustVelocityScale)
      : 1.0;
    const sparkSpeedScale = typeof particleOptions === 'object' && particleOptions !== null && particleOptions.sparkSpeedScale !== undefined
      ? Math.max(0, particleOptions.sparkSpeedScale)
      : 1.0;

    const iGeo = new THREE.SphereGeometry(0.3 * intensity, 4, 4);
    const iMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(0.95, 0.95, 0.95),
      transparent: true,
      opacity: 1.0
    });
    const impact = new THREE.Mesh(iGeo, iMat);
    impact.position.set(x, y + 0.1, z);
    scene.add(impact);

    particles.push({
      mesh: impact,
      type: 'impact',
      age: 0,
      maxAge: 0.15 + Math.random() * 0.1
    });

    // Ground flash
    const impactGroundY = TerrainSystem.getHeightAt(x, z);
    const flashGeo = new THREE.CircleGeometry(0.8 * intensity, 12);
    flashGeo.rotateX(-Math.PI / 2);
    const flashMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(0.95, 0.95, 0.95),
      transparent: true,
      opacity: 0.9 * intensity,
      side: THREE.DoubleSide
    });
    const flash = new THREE.Mesh(flashGeo, flashMat);
    flash.position.set(x, impactGroundY + SURFACE_FLASH_Y_OFFSET, z);
    scene.add(flash);
    particles.push({
      mesh: flash,
      type: 'ground-glow',
      age: 0,
      maxAge: 0.35,
      maxScale: 3.5,
      maxOpacity: 0.85 * intensity
    });

    // Dust
    const computedDustCount = Math.max(1, Math.round((3 + Math.random() * 7) * intensity * qMult * impactParticleScale));
    const dustCount = maxDustCount === null ? computedDustCount : Math.min(computedDustCount, maxDustCount);
    for (let i = 0; i < dustCount; i++) {
      const dGeo = new THREE.SphereGeometry(0.15, 4, 4);
      const heat = 0.12 + Math.random() * 0.10;
      const dMat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(heat, heat, heat),
        transparent: true,
        opacity: 0.6
      });
      const dust = new THREE.Mesh(dGeo, dMat);
      dust.position.set(x + Utils.randFloat(-1, 1), y, z + Utils.randFloat(-1, 1));
      scene.add(dust);
      smokeTrails.push({
        mesh: dust,
        age: 0,
        maxAge: 1.5 + Math.random(),
        vy: 0.4 + 0.18 * dustVelocityScale,
        vx: Utils.randFloat(-0.2, 0.2) * dustVelocityScale,
        vz: Utils.randFloat(-0.2, 0.2) * dustVelocityScale
      });
    }

    // Flying sparks — count scales with intensity (10%–100%)
    const computedSparkCount = Math.floor(12 * intensity * intensity * qMult * impactParticleScale);
    const sparkCount = maxSparkCount === null ? computedSparkCount : Math.min(computedSparkCount, maxSparkCount);
    for (let i = 0; i < sparkCount; i++) {
      const sGeo = new THREE.SphereGeometry(0.08 + Math.random() * 0.1, 3, 3);
      const brightness = 0.8 + Math.random() * 0.2;
      const sMat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(brightness, brightness, brightness),
        transparent: true,
        opacity: 1.0
      });
      const spark = new THREE.Mesh(sGeo, sMat);
      spark.position.set(x, y + 0.1, z);
      scene.add(spark);
      const angle = Math.random() * Math.PI * 2;
      const elev  = Math.random() * Math.PI / 2;
      const speed = Utils.randFloat(1, 5) * sparkSpeedScale;
      particles.push({
        mesh: spark,
        type: 'spark',
        age: 0,
        maxAge: 3,
        grounded: false,
        vx: Math.cos(angle) * Math.cos(elev) * speed,
        vy: Math.sin(elev) * speed + Utils.randFloat(1, 3) * sparkSpeedScale,
        vz: Math.sin(angle) * Math.cos(elev) * speed,
        gravity: -15
      });
    }
  }

  // Tracer light streak
  function spawnTracer(fromX, fromY, fromZ, toX, toY, toZ, color, additive) {
    const points = [
      new THREE.Vector3(fromX, fromY, fromZ),
      new THREE.Vector3(toX, toY, toZ)
    ];
    const geo = new THREE.BufferGeometry().setFromPoints(points);
    const mat = new THREE.LineBasicMaterial({
      color: color || new THREE.Color(0.95, 0.95, 0.95),
      transparent: true,
      opacity: additive ? 1.0 : 0.7,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      depthWrite: false
    });
    const line = new THREE.Line(geo, mat);
    scene.add(line);

    particles.push({
      mesh: line,
      type: 'tracer',
      age: 0,
      maxAge: additive ? 0.06 : 0.1
    });
  }

  function spawnMissileTrail(x, y, z, dirX, dirY, dirZ) {
    const smokeMat = new THREE.SpriteMaterial({
      map: getSmokeAlphaTex(),
      color: new THREE.Color(0.72, 0.72, 0.72),
      transparent: true,
      opacity: 0.0,
      alphaTest: 0.02,
      depthWrite: false
    });
    const smoke = new THREE.Sprite(smokeMat);
    const startScale = Utils.randFloat(0.22, 0.34);
    smoke.scale.set(startScale * 3, startScale * 3, 1);
    smoke.position.set(
      x - dirX * 1.4 + Utils.randFloat(-0.2, 0.2),
      y - dirY * 1.4,
      z - dirZ * 1.4 + Utils.randFloat(-0.2, 0.2)
    );
    scene.add(smoke);
    smokeTrails.push({
      mesh: smoke,
      age: 0,
      delay: 0,
      isSprite: true,
      maxAge: 0.9,
      vy: Utils.randFloat(0.7, 1.3),
      vx: -dirX * Utils.randFloat(1.8, 3.0),
      vz: -dirZ * Utils.randFloat(1.8, 3.0),
      drag: 0.9,
      ox: smoke.position.x,
      oz: smoke.position.z,
      initScale: startScale,
      maxGrowth: 1.6,
      tumble: Utils.randFloat(-0.5, 0.5),
      maxOpacity: 0.42
    });

    const flameGeo = new THREE.BoxGeometry(0.12, 0.12, 0.9);
    const flameMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(1.0, 0.86, 0.36),
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const flame = new THREE.Mesh(flameGeo, flameMat);
    flame.position.set(x - dirX * 0.9, y - dirY * 0.9, z - dirZ * 0.9);
    scene.add(flame);
    const flameDir = new THREE.Vector3(-dirX, -dirY, -dirZ).normalize();
    flame.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), flameDir);
    particles.push({
      mesh: flame,
      type: 'tracer',
      age: 0,
      maxAge: 0.08
    });
  }

  function spawnRicochetRound(x, y, z, impactDirection = null) {
    const ricochetGeo = new THREE.BoxGeometry(0.08, 0.08, 1.2);
    const ricochetMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(1.0, 0.95, 0.72),
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const ricochet = new THREE.Mesh(ricochetGeo, ricochetMat);
    ricochet.position.set(x, y + 0.08, z);
    scene.add(ricochet);

    const incoming = impactDirection instanceof THREE.Vector3
      ? impactDirection.clone()
      : new THREE.Vector3(0, -1, 0);
    if (incoming.lengthSq() < 0.0001) incoming.set(0, -1, 0);
    const incomingSpeed = Math.max(18, incoming.length());
    const planar = new THREE.Vector3(incoming.x, 0, incoming.z);
    const planarSpeed = planar.length();
    incoming.normalize();

    if (planarSpeed < 0.0001) {
      planar.set(Math.random() < 0.5 ? 1 : -1, 0, 0);
    } else {
      planar.normalize();
    }

    const surfaceAngleDeg = Math.atan2(Math.abs(incoming.y), Math.max(planarSpeed / incomingSpeed, 0.0001)) * (180 / Math.PI);

    const lateral = new THREE.Vector3(-planar.z, 0, planar.x);
    const inaccuratePlanar = planar.addScaledVector(lateral, Utils.randFloat(-0.2, 0.2)).normalize();

    const speed = incomingSpeed * Utils.randFloat(MINIGUN_RICOCHET_MIN_SPEED_MULT, MINIGUN_RICOCHET_MAX_SPEED_MULT);
    const horizontalSpeed = speed * Utils.randFloat(0.92, 0.98);
    const vx = inaccuratePlanar.x * horizontalSpeed;
    const vz = inaccuratePlanar.z * horizontalSpeed;
    const angleRatio = Utils.clamp(surfaceAngleDeg / MINIGUN_RICOCHET_MAX_SURFACE_ANGLE_DEG, 0, 1);
    const liftFactor = Utils.lerp(0.16, 0.07, angleRatio);
    const vy = Math.max(2.8, speed * liftFactor);
    const initialVelocity = new THREE.Vector3(vx, vy, vz);
    ricochet.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), initialVelocity.clone().normalize());

    particles.push({
      mesh: ricochet,
      type: 'ricochet-round',
      age: 0,
      maxAge: 3,
      vx,
      vy,
      vz,
      gravity: -20,
      bounceDamping: 0.62,
      drag: 0.996,
      groundFriction: 0.987,
      bouncesRemaining: 3
    });
  }

  // Building damage effect
  function spawnDebris(x, y, z) {
    const qMult = (typeof MenuSystem !== 'undefined') ? MenuSystem.getParticleMultiplier() : 1.0;
    const debrisCount = Math.max(1, Math.round(6 * qMult));
    for (let i = 0; i < debrisCount; i++) {
      const size = Utils.randFloat(0.3, 1.0);
      const geo = new THREE.BoxGeometry(size, size, size);
      const heat = 0.15 + Math.random() * 0.1;
      const mat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(heat, heat, heat)
      });
      const debris = new THREE.Mesh(geo, mat);
      debris.position.set(x + Utils.randFloat(-3, 3), y + Utils.randFloat(0, 3), z + Utils.randFloat(-3, 3));
      scene.add(debris);

      const angle = Math.random() * Math.PI * 2;
      particles.push({
        mesh: debris,
        type: 'debris',
        age: 0,
        maxAge: 1.5 + Math.random(),
        vx: Math.cos(angle) * Utils.randFloat(2, 8),
        vy: Utils.randFloat(4, 10),
        vz: Math.sin(angle) * Utils.randFloat(2, 8),
        gravity: -20,
        rx: Utils.randFloat(-3, 3),
        ry: Utils.randFloat(-3, 3)
      });
    }
  }

  // Long-lasting sideways collapse smoke — building destruction
  function spawnCollapseSmoke(x, y, z, buildingH, buildingW = 3, buildingD = 3) {
    const qMult = (typeof MenuSystem !== 'undefined') ? MenuSystem.getParticleMultiplier() : 1.0;
    const count = Math.max(4, Math.round(14 * qMult));
    const halfW = Math.max(1.5, buildingW * 0.5);
    const halfD = Math.max(1.5, buildingD * 0.5);
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + Utils.randFloat(-0.3, 0.3);
      const speed  = Utils.randFloat(1.2, 3.5);
      const driftSpeed = Utils.randFloat(0.18, 0.42);
      const initSz = Utils.randFloat(1.8, 3.5);
      const spawnOffsetX = Math.cos(angle) * (halfW + Utils.randFloat(0.35, 1.25));
      const spawnOffsetZ = Math.sin(angle) * (halfD + Utils.randFloat(0.35, 1.25));
      const mat = new THREE.SpriteMaterial({
        map: getSmokeAlphaTex(),
        transparent: true,
        depthWrite: false,
        alphaTest: 0.02,
        color: new THREE.Color(0.18, 0.18, 0.18)
      });
      const sprite = new THREE.Sprite(mat);
      // Spawn at random height along the building
      const startY = y + Utils.randFloat(0, buildingH || 5);
      sprite.position.set(
        x + spawnOffsetX,
        startY,
        z + spawnOffsetZ
      );
      sprite.scale.set(initSz * 2, initSz * 2, 1);
      scene.add(sprite);
      smokeTrails.push({
        mesh: sprite,
        type: 'collapse-smoke',
        age: 0,
        delay: Utils.randFloat(0, 0.8),
        maxAge: Utils.randFloat(4, 8),
        ox: sprite.position.x,
        oz: sprite.position.z,
        vx: Math.cos(angle) * speed,
        vy: Utils.randFloat(0.4, 0.9),
        vz: Math.sin(angle) * speed,
        driftX: Math.cos(angle),
        driftZ: Math.sin(angle),
        horizontalSpreadSpeed: driftSpeed,
        drag: 0.6,
        distDragMult: 0.12,
        tumble: Utils.randFloat(-0.4, 0.4),
        isSprite: true,
        initScale: initSz,
        maxGrowth: 5,
        continuousExpand: 0.55,
        maxOpacity: Utils.randFloat(0.45, 0.65)
      });
    }
  }

  // ---------- Update ----------

  function update(dt) {
    // Decay shake
    if (shakeDuration > 0) {
      shakeDuration -= dt;
      if (shakeDuration <= 0) {
        shakeDuration = 0;
        shakeIntensity = 0;
      }
    }

    // Update particles
    particles = particles.filter(p => {
      p.age += dt;
      const t = p.age / p.maxAge;

      if (p.age >= p.maxAge) {
        scene.remove(p.mesh);
        if (p.mesh.geometry) p.mesh.geometry.dispose();
        if (p.mesh.material) p.mesh.material.dispose();
        return false;
      }

      switch (p.type) {
        case 'explosion-glow': {
          // Follow the fireball so glow stays centred on it
          if (p.linkedMesh) p.mesh.position.copy(p.linkedMesh.position);
          // Flicker: cycle between 100% and 50% opacity every 0.25s
          p.flickerTimer += dt;
          if (p.flickerTimer >= 0.05) {
            p.flickerTimer -= 0.05;
            p.flickerState = !p.flickerState;
          }
          const glowBase = (1 - t * t) * 0.9;
          p.mesh.material.opacity = p.flickerState ? glowBase : glowBase * 0.25;
          break;
        }

        case 'fireball':
          if (p.isSprite) {
            const sz = p.size * 2 * (1 + t * 3);
            p.mesh.scale.set(sz, sz, 1);
          } else {
            p.mesh.scale.setScalar(1 + t * 3);
          }
          p.mesh.material.opacity = 1 - t;
          p.mesh.position.y += p.vy * dt;
          break;

        case 'spark': {
          const groundY = TerrainSystem.getHeightAt(p.mesh.position.x, p.mesh.position.z);
          if (!p.grounded) {
            p.vy += p.gravity * dt;
            p.mesh.position.x += p.vx * dt;
            p.mesh.position.y += p.vy * dt;
            p.mesh.position.z += p.vz * dt;
            if (p.mesh.position.y <= groundY) {
              p.mesh.position.y = groundY;
              p.grounded = true;
              p.vx = 0; p.vy = 0; p.vz = 0;
            }
          }
          p.mesh.material.opacity = Math.max(0, 1 - t);
          break;
        }

        case 'explosion-light': {
          // Bright flash on ground, fades out with a quick easeOut curve
          p.mesh.material.opacity = (1 - t) * (1 - t) * p.peakOpacity;
          break;
        }

        case 'ground-glow': {
          // Quick fade in, then slow dissipation over 6 seconds
          const fadeIn = Math.min(1, p.age * 4);
          p.mesh.material.opacity = fadeIn * (1 - t * t) * p.maxOpacity;
          break;
        }

        case 'flicker-spark': {
          const fGroundY = TerrainSystem.getHeightAt(p.mesh.position.x, p.mesh.position.z);
          if (!p.grounded) {
            p.vy += p.gravity * dt;
            p.mesh.position.x += p.vx * dt;
            p.mesh.position.y += p.vy * dt;
            p.mesh.position.z += p.vz * dt;
            if (p.mesh.position.y <= fGroundY) {
              p.mesh.position.y = fGroundY;
              p.grounded = true;
              p.vx = 0; p.vy = 0; p.vz = 0;
            }
          }
          const fadeFactor = Math.max(0, 1 - t);
          p.mesh.material.opacity = Math.random() > 0.45 ? fadeFactor : fadeFactor * 0.05;
          break;
        }

        case 'shockwave': {
          if (p.age < 0) break;  // delay not elapsed yet
          const expandT = 1 - Math.pow(1 - t, 2.4);
          const fadeT = Math.pow(t, 1.15);
          const s = (p.baseScale || 1) * (1 + expandT * p.maxScale);
          if (p.isSprite) p.mesh.scale.set(s, s, 1);
          else p.mesh.scale.setScalar(s);
          p.mesh.material.opacity = (1 - fadeT) * (p.maxOpacity !== undefined ? p.maxOpacity : 0.85);
          break;
        }

        case 'impact':
          p.mesh.scale.setScalar(1 + t * 2);
          p.mesh.material.opacity = 1 - t;
          break;

        case 'tracer':
          p.mesh.material.opacity = 1 - t;
          break;

        case 'ricochet-round': {
          p.vy += p.gravity * dt;
          p.vx *= p.drag;
          p.vz *= p.drag;
          p.mesh.position.x += p.vx * dt;
          p.mesh.position.y += p.vy * dt;
          p.mesh.position.z += p.vz * dt;

          const groundY = TerrainSystem.getHeightAt(p.mesh.position.x, p.mesh.position.z) + 0.03;
          if (p.mesh.position.y <= groundY) {
            p.mesh.position.y = groundY;
            if (p.bouncesRemaining > 0 && Math.abs(p.vy) > 1.2) {
              p.vy = Math.abs(p.vy) * p.bounceDamping;
              p.vx *= 0.985;
              p.vz *= 0.985;
              p.bouncesRemaining -= 1;
            } else {
              p.vy = 0;
              p.vx *= p.groundFriction;
              p.vz *= p.groundFriction;
            }
          }

          const velocity = new THREE.Vector3(p.vx, p.vy, p.vz);
          if (velocity.lengthSq() > 0.0001) {
            p.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), velocity.normalize());
          }

          const fadeStart = 0.55;
          p.mesh.material.opacity = t < fadeStart ? 0.95 : 0.95 * (1 - (t - fadeStart) / (1 - fadeStart));
          break;
        }

        case 'debris':
          p.vy += p.gravity * dt;
          p.mesh.position.x += p.vx * dt;
          p.mesh.position.y += p.vy * dt;
          p.mesh.position.z += p.vz * dt;
          p.mesh.rotation.x += p.rx * dt;
          p.mesh.rotation.y += p.ry * dt;
          // Stop on ground
          const gy = TerrainSystem.getHeightAt(p.mesh.position.x, p.mesh.position.z);
          if (p.mesh.position.y < gy) {
            p.mesh.position.y = gy;
            p.vy = 0; p.vx *= 0.3; p.vz *= 0.3;
          }
          break;
      }

      return true;
    });

    // Update smoke
    smokeTrails = smokeTrails.filter(s => {
      s.age += dt;
      // Skip movement until delay elapsed
      if (s.age < (s.delay || 0)) return true;
      const activeAge = s.age - (s.delay || 0);
      const t = activeAge / s.maxAge;
      if (t >= 1) {
        scene.remove(s.mesh);
        if (s.mesh.geometry) s.mesh.geometry.dispose();
        if (s.mesh.material) s.mesh.material.dispose();
        return false;
      }

      if (s.radialSpread) {
        const spreadEase = getRadialSpreadProgress(t);
        const spreadDistance = s.spreadDistance * spreadEase;
        s.mesh.position.x = s.ox + Math.cos(s.spreadAngle) * spreadDistance;
        s.mesh.position.y = s.baseY + s.vy * activeAge;
        s.mesh.position.z = s.oz + Math.sin(s.spreadAngle) * spreadDistance;
      } else {
        // Drag: distance-based
        const dx = s.mesh.position.x - (s.ox || s.mesh.position.x);
        const dz = s.mesh.position.z - (s.oz || s.mesh.position.z);
        const distFromOrigin = Math.sqrt(dx * dx + dz * dz);
        const totalDrag = s.drag + distFromOrigin * (s.distDragMult !== undefined ? s.distDragMult : 0.18);
        const dragFactor = Math.exp(-totalDrag * dt);
        s.vx *= dragFactor;
        s.vz *= dragFactor;
        s.vy *= Math.exp(-0.9 * dt);

        // Slight random turbulence
        s.vx += Utils.randFloat(-0.15, 0.15) * dt * 8;
        s.vz += Utils.randFloat(-0.15, 0.15) * dt * 8;

        s.mesh.position.x += s.vx * dt;
        s.mesh.position.y += s.vy * dt;
        s.mesh.position.z += s.vz * dt;

        if (s.horizontalSpreadSpeed) {
          const lateralDrift = s.horizontalSpreadSpeed * (0.45 + 0.55 * t) * dt;
          s.mesh.position.x += (s.driftX || 0) * lateralDrift;
          s.mesh.position.z += (s.driftZ || 0) * lateralDrift;
        }
      }

      // Tumble rotation
      if (s.tumble) {
        if (s.isSprite) s.mesh.material.rotation += s.tumble * dt;
        else s.mesh.rotation.y += s.tumble * dt;
      }

      // Grow from small to full size (pressure expansion)
      const growEase = 1 - Math.exp(-2.5 * t);
      const targetScale = s.maxGrowth || 3;
      const continuousExpand = 1 + (s.continuousExpand || 0) * t;
      const endExpandStart = s.endExpandStart !== undefined ? s.endExpandStart : 0.7;
      const endExpandAmount = s.endExpandAmount !== undefined ? s.endExpandAmount : 0.3;
      const endExpandDuration = Math.max(0.01, 1 - endExpandStart);
      const endExpand = t > endExpandStart ? 1 + endExpandAmount * ((t - endExpandStart) / endExpandDuration) : 1;
      if (s.isSprite) {
        const sz = s.initScale * 2 * (1 + growEase * targetScale) * continuousExpand * endExpand;
        s.mesh.scale.set(sz, sz, 1);
      } else {
        s.mesh.scale.setScalar((1 + growEase * targetScale) * continuousExpand * endExpand);
      }

      // Opacity: fast fade-in, long hold, then fade out
      const fadeIn  = Math.min(1, activeAge * 6);
      const fadeOut = s.syncFadeToSpread
        ? (1 - t)
        : 1 - Math.pow(Math.max(0, (t - 0.15) / 0.85), 1.8);
      s.mesh.material.opacity = (s.maxOpacity !== undefined ? s.maxOpacity : 0.58) * fadeIn * Math.max(0, fadeOut);

      // Thermal: cool rapidly — hot puffs cool to near-black as they rise
      const currentHeat = s.mesh.material.color.r;
      const targetHeat  = Math.max(0.15, currentHeat - dt * 0.22);
      s.mesh.material.color.setRGB(targetHeat, targetHeat, targetHeat);
      return true;
    });

    // Update screen-space shockwave distortions (removed — rings are world-space now)
    ThermalSystem.setShockwaves([], 0);
  }

  // Remove every live particle / smoke trail from the scene — call on mission transition
  function reset() {
    particles.forEach(p => {
      scene.remove(p.mesh);
      if (p.mesh.geometry) p.mesh.geometry.dispose();
      if (p.mesh.material) p.mesh.material.dispose();
    });
    particles = [];
    smokeTrails.forEach(s => {
      scene.remove(s.mesh);
      if (s.mesh.geometry) s.mesh.geometry.dispose();
      if (s.mesh.material) s.mesh.material.dispose();
    });
    smokeTrails = [];
    shakeIntensity = 0;
    shakeDuration  = 0;
  }

  // Light-weight explosion: fireball flash + glow + light pool + shockwave only.
  // No sparks, no smoke — safe to call frequently from infantry/truck projectile hits.
  function spawnExplosionLight(x, y, z, size, options = {}) {
    // Fireball flash
    const fbMat = new THREE.SpriteMaterial({
      map: getSmokeAlphaTex(),
      color: new THREE.Color(0.95, 0.95, 0.95),
      transparent: true, opacity: 1.0,
      alphaTest: 0.02,
      depthWrite: false
    });
    const fireball = new THREE.Sprite(fbMat);
    fireball.scale.set(size * 2, size * 2, 1);
    fireball.position.set(x, y, z);
    scene.add(fireball);
    particles.push({ mesh: fireball, type: 'fireball', isSprite: true, age: 0, maxAge: 0.15, vy: size * 2, size });

    // Additive glow
    const glowMat = new THREE.SpriteMaterial({
      map: getGlowTexture(), transparent: true, opacity: 0.9,
      alphaTest: 0.02,
      depthWrite: false, blending: THREE.AdditiveBlending
    });
    const glowSprite = new THREE.Sprite(glowMat);
    glowSprite.scale.setScalar(size * 14);
    glowSprite.position.set(x, y, z);
    scene.add(glowSprite);
    particles.push({ mesh: glowSprite, type: 'explosion-glow', age: 0, maxAge: 0.3, linkedMesh: fireball, flickerTimer: 0, flickerState: true });

    if (options.surfaceFlash !== false) {
      spawnSurfaceFlash(x, z, size, { peakOpacity: 0.55, maxAge: 0.25, segments: 16 });
    }

    // Shockwave ring
    spawnShockwave(x, y, z, size, { style: options.shockwaveStyle });

    AudioSystem.playExplosion(size * 0.4);
    triggerShake(size * 0.05, size * 0.08);
  }

  function spawnMinigunImpactExplosion(x, y, z, impactDirection = null) {
    const visualSize = 0.28;
    const quality = (typeof MenuSystem !== 'undefined' && MenuSystem.getQuality) ? MenuSystem.getQuality() : 'high';
    const maxSparkCount = quality === 'low' ? 1 : quality === 'medium' ? 2 : 3;

    const fbMat = new THREE.SpriteMaterial({
      map: getSmokeAlphaTex(),
      color: new THREE.Color(0.95, 0.95, 0.95),
      transparent: true,
      opacity: 0.9,
      alphaTest: 0.02,
      depthWrite: false
    });
    const fireball = new THREE.Sprite(fbMat);
    fireball.scale.set(visualSize * 2.4, visualSize * 2.4, 1);
    fireball.position.set(x, y, z);
    scene.add(fireball);
    particles.push({
      mesh: fireball,
      type: 'fireball',
      isSprite: true,
      age: 0,
      maxAge: 0.08,
      vy: visualSize * 0.8,
      size: visualSize
    });

    const glowMat = new THREE.SpriteMaterial({
      map: getGlowTexture(),
      transparent: true,
      opacity: 0.42,
      alphaTest: 0.02,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    const glowSprite = new THREE.Sprite(glowMat);
    glowSprite.scale.setScalar(visualSize * 8);
    glowSprite.position.set(x, y, z);
    scene.add(glowSprite);
    particles.push({
      mesh: glowSprite,
      type: 'explosion-glow',
      age: 0,
      maxAge: 0.12,
      linkedMesh: fireball,
      flickerTimer: 0,
      flickerState: true
    });

    for (let i = 0; i < maxSparkCount; i++) {
      const sGeo = new THREE.SphereGeometry(0.07 + Math.random() * 0.05, 3, 3);
      const brightness = 0.82 + Math.random() * 0.16;
      const sMat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(brightness, brightness, brightness),
        transparent: true,
        opacity: 1.0
      });
      const spark = new THREE.Mesh(sGeo, sMat);
      spark.position.set(x, y + 0.04, z);
      scene.add(spark);

      const angle = Math.random() * Math.PI * 2;
      const elev = Math.random() * (Math.PI * 0.4);
      const speed = Utils.randFloat(2.2, 4.8);
      particles.push({
        mesh: spark,
        type: 'spark',
        age: 0,
        maxAge: 1.2,
        grounded: false,
        vx: Math.cos(angle) * Math.cos(elev) * speed,
        vy: Math.sin(elev) * speed + Utils.randFloat(1.1, 2.4),
        vz: Math.sin(angle) * Math.cos(elev) * speed,
        gravity: -12
      });
    }

    for (let i = 0; i < maxSparkCount; i++) {
      const fGeo = new THREE.SphereGeometry(0.05 + Math.random() * 0.03, 3, 3);
      const fMat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(0.95, 0.95, 0.95),
        transparent: true,
        opacity: 1.0
      });
      const fspark = new THREE.Mesh(fGeo, fMat);
      fspark.position.set(x, y + 0.02, z);
      scene.add(fspark);

      const fAngle = Math.random() * Math.PI * 2;
      const fElev = 0.35 + Math.random() * 0.5;
      const fSpeed = Utils.randFloat(2.4, 5.0);
      particles.push({
        mesh: fspark,
        type: 'flicker-spark',
        age: 0,
        maxAge: 1.0,
        grounded: false,
        vx: Math.cos(fAngle) * Math.cos(fElev) * fSpeed,
        vy: Math.sin(fElev) * fSpeed + Utils.randFloat(1.0, 2.1),
        vz: Math.sin(fAngle) * Math.cos(fElev) * fSpeed,
        gravity: -8
      });
    }

    const incoming = impactDirection instanceof THREE.Vector3 ? impactDirection : null;
    const planarSpeed = incoming ? Math.hypot(incoming.x, incoming.z) : 0;
    const totalSpeed = incoming ? incoming.length() : 0;
    const surfaceAngleDeg = incoming && totalSpeed > 0.0001
      ? Math.atan2(Math.abs(incoming.y), Math.max(planarSpeed, 0.0001)) * (180 / Math.PI)
      : 90;
    const ricochetAngleT = 1 - Utils.clamp(surfaceAngleDeg / MINIGUN_RICOCHET_MAX_SURFACE_ANGLE_DEG, 0, 1);
    const ricochetChance = MINIGUN_RICOCHET_CHANCE * ricochetAngleT * ricochetAngleT;

    if (ricochetChance > 0 && Math.random() < ricochetChance) {
      spawnRicochetRound(x, y, z, impactDirection);
    }

    const lightPoolGeo = new THREE.CircleGeometry(visualSize * 5, 12);
    lightPoolGeo.rotateX(-Math.PI / 2);
    const lightPoolMat = new THREE.MeshBasicMaterial({
      map: getLightPoolTexture(),
      color: new THREE.Color(0.9, 0.9, 0.9),
      transparent: true,
      opacity: 0.22,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    const lightPool = new THREE.Mesh(lightPoolGeo, lightPoolMat);
    lightPool.position.set(x, TerrainSystem.getHeightAt(x, z) + SURFACE_FLASH_Y_OFFSET, z);
    scene.add(lightPool);
    particles.push({
      mesh: lightPool,
      type: 'explosion-light',
      age: 0,
      maxAge: 0.12,
      peakOpacity: 0.22
    });

    const glowGroundY = TerrainSystem.getHeightAt(x, z);
    const glowGeo = new THREE.CircleGeometry(visualSize * 4.4, 20);
    glowGeo.rotateX(-Math.PI / 2);
    const groundGlowMat = new THREE.MeshBasicMaterial({
      map: getHeatGlowTex(),
      color: new THREE.Color(0.78, 0.78, 0.78),
      transparent: true,
      opacity: 0.0,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    const glow = new THREE.Mesh(glowGeo, groundGlowMat);
    glow.position.set(x, glowGroundY + GROUND_GLOW_Y_OFFSET, z);
    scene.add(glow);
    particles.push({
      mesh: glow,
      type: 'ground-glow',
      age: 0,
      maxAge: 4.8,
      maxScale: 1,
      maxOpacity: 0.62
    });

    spawnSmoke(x, y, z, 1.25, SMOKE_PROFILES.minigunImpact);
    spawnShockwave(x, y, z, 0.22);
    AudioSystem.playExplosion(visualSize * 0.4);

    triggerShake(visualSize * 0.08, 0.04);
  }

  return {
    init, reset, update, setCamera,
    spawnExplosion, spawnExplosionLight, spawnSurfaceFlash, spawnMinigunImpactExplosion, spawnImpact, spawnTracer, spawnMissileTrail, spawnDebris, spawnCollapseSmoke, spawnTankMuzzleSmoke,
    triggerShake, triggerFlash, getShake
  };
})();
