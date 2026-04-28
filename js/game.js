/* =============================================
   GAME.JS — Main game loop & orchestration
   ============================================= */
'use strict';

const Game = (() => {

  // ---- State ----
  let renderer, mainScene, mainCamera;
  let clock, time = 0, elapsed = 0;
  let fpsSmoothed = 60;
  let running = false;
  let paused  = false;
  let missionBootFxTimer = null;
  let missionBootGlitchTimer = null;
  let missionStartVoiceTimer = null;
  let missionBootOverlayEl = null;
  let missionBootSliceEls = [];
  let missionIndex = 0;
  let _customMissionDef = null; // set when starting a custom mission
  let _currentRunFromEditor = false;

  // Camera orbit
  const CAM_RADIUS   = 210;
  const CAM_HEIGHT   = 160;
  const CAM_ORBIT_SPEED = 0.06; // radians/s — full orbit ~105s
  let camAngle = 0;
  let camTargetX = 0;
  let camTargetZ = 0;
  let camCurrentX = 0;
  let camCurrentZ = 0;
  const DEFAULT_ZOOM_FACTOR = 1.0;
  const ZOOM_MIN = 1;
  const ZOOM_MAX = 1.6;
  let zoomFactor  = DEFAULT_ZOOM_FACTOR;

  let gameOverPrimaryAction = 'retry';
  let nextMissionIndex = null;
  let missionOutcomePending = false;

  // Mouse world aim
  let mouseX = 0, mouseY = 0;  // normalized device coords
  let aimWorldX = 0, aimWorldZ = 0;

  // Escort beacon — flashing green marker at last friendly waypoint
  let _escortBeaconMeshes = [];
  let aimWorldY = 0;

  // Ground plane for raycasting
  let groundPlane;

  // Game objects
  let buildings = [];
  let ambientStopFn = null;
  let randomVoiceDelayRemaining = 20;
  let randomVoicePlaying = false;
  let defaultMissionLayout = null;

  // Input
  let mouseDown = false;
  let fireHeld  = false;
  let keyboardFireHeld = false;
  let heading   = 270;
  let lastTouchInputAt = 0;

  // Targeting
  let lockedTarget = null;
  const TARGET_DIST = 12;
  const TARGET_IDENTIFY_DELAY = 0.2;
  const MISSILE_LOCK_DELAY = 1.0;
  let targetLockStartedAt = 0;
  let missileLockProgress = 0;
  let missileLockReady = false;

  // ---- Loading ----

  function setLoadStatus(text, pct) {
    const bar  = document.getElementById('loading-bar');
    const stat = document.getElementById('loading-status');
    if (bar)  bar.style.width  = pct + '%';
    if (stat) stat.textContent = text;
  }

  function hideLoading() {
    const el = document.getElementById('loading-screen');
    if (el) {
      el.style.opacity = '0';
      setTimeout(() => el.style.display = 'none', 500);
    }
  }

  // ---- Init ----

  async function init() {
    setLoadStatus('Initializing renderer...', 10);
    await tick();

    const canvas = document.getElementById('gameCanvas');
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = false;

    setLoadStatus('Building scene...', 25);
    await tick();

    mainScene = new THREE.Scene();
    mainScene.background = new THREE.Color(0x000000);
    mainScene.fog = new THREE.Fog(0x000000, 280, 460);

    mainCamera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.5, 600);

    clock = new THREE.Clock();

    setLoadStatus('Generating terrain...', 40);
    await tick();

    defaultMissionLayout = await loadDefaultMissionLayout();

    TerrainSystem.setupLighting(mainScene);
    TerrainSystem.buildTerrain(mainScene);

    setLoadStatus('Placing structures...', 55);
    await tick();

    TerrainSystem.resetForMission(mainScene);
    buildings = TerrainSystem.getBuildings();

    setLoadStatus('Initializing systems...', 70);
    await tick();

    ThermalSystem.init(renderer, window.innerWidth, window.innerHeight);
    EffectsSystem.init(mainScene, mainCamera);
    HUDSystem.init();
    AudioSystem.init();
    MissionEditor.init(mainScene, renderer);

    // Ground raycasting plane
    groundPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(600, 600),
      new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide })
    );
    groundPlane.rotation.x = -Math.PI / 2;
    groundPlane.position.y = 0;
    mainScene.add(groundPlane);

    setLoadStatus('Ready.', 100);
    await tick();

    bindEvents();
    hideLoading();

    // HUD menu button — pause and return to menu (game can be resumed)
    const hudMenuBtn = document.getElementById('hud-menu-btn');
    if (hudMenuBtn) {
      hudMenuBtn.addEventListener('click', () => {
        pauseToMainMenu();
      });
    }

    // Init menu — passing in mission start, resume, and editor callbacks
    MenuSystem.init(
      (missionIdxOrDef) => {
        if (typeof missionIdxOrDef === 'object' && missionIdxOrDef !== null) {
          startCustomMission(missionIdxOrDef);
        } else {
          startGame(missionIdxOrDef);
        }
      },
      () => { resumeGame(); },
      () => { openEditor(); },
      () => { endCurrentMission(); },
      () => { returnToMissionEditor(); }
    );

    // Game over restart and back-to-menu

    if (MenuSystem.onQualityChange) {
      MenuSystem.onQualityChange(() => {
        TerrainSystem.refreshBuildingVisuals();
        buildings = TerrainSystem.getBuildings();
      });
    }
    const restartBtn = document.getElementById('restart-btn');
    if (restartBtn) restartBtn.addEventListener('click', restartGame);

    MenuSystem.addBackToMenuButton(() => {
      // Clean up running game
      running = false;
      paused  = false;
      document.body.classList.remove('game-active');
      AudioSystem.setMissileLockTone('off');
      AudioSystem.stopMissionVoicePlayback();
      HUDSystem.clearCrosshairLock();
      HUDSystem.clearProjectileGlares();
      HUDSystem.clearExplosionGlares();
      _cleanupEscortBeacon();
      EntitySystem.despawnAll();
      WeaponsSystem.reset();
      MenuSystem.setResumable(false);
      MenuSystem.setEditorReturnable(false);
    });
  }

  function tick() {
    return new Promise(r => requestAnimationFrame(r));
  }

  function pauseToMainMenu() {
    if (!running) return;
    running = false;
    paused  = true;
    clearFireInputState();
    AudioSystem.setMissileLockTone('off');
    AudioSystem.pauseMissionVoicePlayback();
    HUDSystem.clearCrosshairLock();
    HUDSystem.clearProjectileGlares();
    HUDSystem.clearExplosionGlares();
    document.body.classList.remove('game-active');
    if (ambientStopFn) { ambientStopFn(); ambientStopFn = null; }
    document.getElementById('gameover-screen').style.display = 'none';
    MenuSystem.setResumable(true);
    MenuSystem.setEditorReturnable(_currentRunFromEditor);
    MenuSystem.showScreen('main-menu');
  }

  async function loadDefaultMissionLayout() {
    try {
      const res = await fetch('missions/Defaultmap.json');
      if (!res.ok) return null;
      const def = await res.json();
      return {
        customBuildings: Array.isArray(def.customBuildings) ? def.customBuildings : [],
        customRoads: Array.isArray(def.customRoads) ? def.customRoads : []
      };
    } catch (_) {
      return null;
    }
  }

  // ---- Start / Restart ----

  function startGame(idx) {
    paused = false;
    _customMissionDef = null;
    _currentRunFromEditor = false;
    AudioSystem.resume();
    document.body.classList.add('game-active');
    MenuSystem.hideAllMenus();
    MenuSystem.setResumable(false);
    MenuSystem.setEditorReturnable(false);
    MenuSystem.initMobileControls(
      () => { fireHeld = true; mouseDown = true; },
      () => { fireHeld = false; mouseDown = false; },
      (slotId) => { WeaponsSystem.selectWeapon(slotId); }
    );
    beginMission(typeof idx === 'number' ? idx : missionIndex);
  }

  function startCustomMission(def, options = {}) {
    paused = false;
    _customMissionDef = def;
    _currentRunFromEditor = !!options.fromEditor;
    AudioSystem.resume();
    document.body.classList.add('game-active');
    MenuSystem.hideAllMenus();
    MenuSystem.setResumable(false);
    MenuSystem.setEditorReturnable(false);
    MenuSystem.initMobileControls(
      () => { fireHeld = true; mouseDown = true; },
      () => { fireHeld = false; mouseDown = false; },
      (slotId) => { WeaponsSystem.selectWeapon(slotId); }
    );
    beginCustom(def);
  }

  function resumeGame() {
    if (!paused) return;
    paused = false;
    AudioSystem.resume();
    document.body.classList.add('game-active');
    MenuSystem.hideAllMenus();
    AudioSystem.resumeMissionVoicePlayback();
    // Restart ambient
    if (!ambientStopFn) ambientStopFn = AudioSystem.playAmbient();
    running = true;
    clock.start();
    loop();
  }

  // ---- Full session teardown — call before every mission start or editor open ----
  function _fullSessionReset() {
    running = false;
    missionOutcomePending = false;
    randomVoiceDelayRemaining = 20;
    randomVoicePlaying = false;
    if (missionStartVoiceTimer) {
      clearTimeout(missionStartVoiceTimer);
      missionStartVoiceTimer = null;
    }
    _cleanupEscortBeacon();
    EntitySystem.despawnAll();
    WeaponsSystem.reset();   // flushes projectile meshes + resets ammo
    EffectsSystem.reset();   // flushes all particles, smoke, shake
    lockedTarget = null;
    targetLockStartedAt = 0;
    missileLockProgress = 0;
    missileLockReady = false;
    AudioSystem.setMissileLockTone('off');
    AudioSystem.stopMissionVoicePlayback();
    HUDSystem.clearTargetIdentification();
    HUDSystem.clearCrosshairLock();
    HUDSystem.clearProjectileGlares();
    HUDSystem.clearExplosionGlares();
    if (typeof ThermalSystem !== 'undefined' && ThermalSystem.clearScriptedGlitch) {
      ThermalSystem.clearScriptedGlitch();
    }
    if (BaseDefenceSystem.isActive()) BaseDefenceSystem.stop();
  }

  function _resetMissionVoiceSchedule() {
    randomVoiceDelayRemaining = 20;
    randomVoicePlaying = false;
    if (missionStartVoiceTimer) {
      clearTimeout(missionStartVoiceTimer);
      missionStartVoiceTimer = null;
    }
    AudioSystem.stopMissionVoicePlayback();
  }

  function queueMissionStartVoice(missionDef) {
    if (missionStartVoiceTimer) clearTimeout(missionStartVoiceTimer);
    missionStartVoiceTimer = setTimeout(() => {
      missionStartVoiceTimer = null;
      AudioSystem.playMissionStartVoice(missionDef);
    }, 450);
  }

  function openEditor() {
    _fullSessionReset();
    _currentRunFromEditor = false;
    paused = false;
    MenuSystem.setEditorReturnable(false);
    MenuSystem.hideAllMenus();
    MissionEditor.open();
  }

  function returnToMissionEditor() {
    HUDSystem.hideGameOver();
    _fullSessionReset();
    _currentRunFromEditor = false;
    paused = false;
    document.body.classList.remove('game-active');
    if (ambientStopFn) { ambientStopFn(); ambientStopFn = null; }
    MenuSystem.setResumable(false);
    MenuSystem.setEditorReturnable(false);
    MenuSystem.hideAllMenus();
    MissionEditor.open();
  }

  function endCurrentMission() {
    HUDSystem.hideGameOver();
    _fullSessionReset();
    _currentRunFromEditor = false;
    paused = false;
    document.body.classList.remove('game-active');
    if (ambientStopFn) { ambientStopFn(); ambientStopFn = null; }
    MenuSystem.setResumable(false);
    MenuSystem.setEditorReturnable(false);
    MenuSystem.showScreen('main-menu');
  }

  function setZoomFactor(nextZoom, options = {}) {
    const prevZoom = zoomFactor;
    const clampedZoom = Utils.clamp(nextZoom, ZOOM_MIN, ZOOM_MAX);
    zoomFactor = clampedZoom;

    const zoomDelta = Math.abs(clampedZoom - prevZoom);
    if (!options.silent && zoomDelta > 0.0005 && typeof ThermalSystem !== 'undefined' && ThermalSystem.addGlitchImpulse) {
      const zoomRange = Math.max(ZOOM_MAX - ZOOM_MIN, 0.0001);
      const impulse = Math.min(0.16, (zoomDelta / zoomRange) * 1);
      if (impulse > 0.001) ThermalSystem.addGlitchImpulse(impulse);
    }

    return zoomFactor;
  }

  function setGameOverPrimaryAction(action, options = {}) {
    gameOverPrimaryAction = action;
    nextMissionIndex = options.nextMissionIndex ?? null;
  }

  function beginMissionResolution(failed, options = {}) {
    if (missionOutcomePending) return;

    missionOutcomePending = true;
    randomVoicePlaying = false;
    AudioSystem.setMissileLockTone('off');
    AudioSystem.stopMissionVoicePlayback();
    if (failed) AudioSystem.playMissionFailureVoice();
    else AudioSystem.playMissionSuccessVoice();

    const {
      primaryAction = 'retry',
      nextMissionIndex: nextIndex = null,
      primaryButtonText = failed ? 'RETRY MISSION' : 'NEXT MISSION',
      delayMs = failed ? 1000 : 2000
    } = options;

    if (failed && typeof ThermalSystem !== 'undefined' && ThermalSystem.playFailureGlitchOut) {
      ThermalSystem.playFailureGlitchOut(delayMs * 0.001, 1);
    }

    setTimeout(() => {
      HUDSystem.clearCrosshairLock();
      HUDSystem.clearProjectileGlares();
      HUDSystem.clearExplosionGlares();
      running = false;
      document.body.classList.remove('game-active');
      setGameOverPrimaryAction(primaryAction, { nextMissionIndex: nextIndex });
      HUDSystem.showGameOver(
        MissionSystem.getScore(),
        MissionSystem.getKills(),
        MissionSystem.getFriendlyKills(),
        elapsed,
        failed,
        { primaryButtonText }
      );
    }, delayMs);
  }

  function ensureMissionBootOverlay() {
    if (missionBootOverlayEl) return missionBootOverlayEl;
    missionBootOverlayEl = document.getElementById('mission-boot-overlay');
    if (!missionBootOverlayEl) return null;
    missionBootSliceEls = Array.from(missionBootOverlayEl.querySelectorAll('.mission-boot-slice'));
    return missionBootOverlayEl;
  }

  function resetMissionBootOverlay() {
    const overlay = ensureMissionBootOverlay();
    if (!overlay) return;
    overlay.style.setProperty('--boot-opacity', '0');
    overlay.style.setProperty('--boot-jitter-x', '0px');
    overlay.style.setProperty('--boot-jitter-y', '0px');
    overlay.style.setProperty('--boot-skew', '0deg');
    overlay.style.setProperty('--boot-brightness', '0');
    overlay.style.setProperty('--boot-contrast', '0');
    overlay.style.setProperty('--boot-blur', '0px');
    overlay.style.setProperty('--boot-noise-x', '0px');
    overlay.style.setProperty('--boot-noise-y', '0px');
    overlay.style.setProperty('--boot-roll-y', '-30%');
    overlay.style.setProperty('--boot-roll-opacity', '0');
    overlay.style.setProperty('--boot-vignette-opacity', '0');
    missionBootSliceEls.forEach(slice => {
      slice.style.top = '0%';
      slice.style.height = '0px';
      slice.style.opacity = '0';
      slice.style.transform = 'translate3d(0, 0, 0) scaleX(1)';
      slice.style.filter = 'blur(0px)';
    });
  }

  function clearMissionBootEffect() {
    if (missionBootFxTimer) {
      clearTimeout(missionBootFxTimer);
      missionBootFxTimer = null;
    }
    if (missionBootGlitchTimer) {
      clearInterval(missionBootGlitchTimer);
      missionBootGlitchTimer = null;
    }
    document.body.classList.remove('mission-booting');
    if (typeof ThermalSystem !== 'undefined' && ThermalSystem.clearScriptedGlitch) {
      ThermalSystem.clearScriptedGlitch();
    }
    resetMissionBootOverlay();
  }

  function updateMissionBootOverlay(progress) {
    const overlay = ensureMissionBootOverlay();
    if (!overlay) return;

    const intensity = Math.max(0, 1 - progress);
    const heavyIntensity = Math.max(0, 1 - progress * 1.8);
    const sliceChance = 0.04 + heavyIntensity * 0.22;

    overlay.style.setProperty('--boot-opacity', (0.05 + intensity * 0.22).toFixed(3));
    overlay.style.setProperty('--boot-jitter-x', `${(Math.random() - 0.5) * 18 * intensity}px`);
    overlay.style.setProperty('--boot-jitter-y', `${(Math.random() - 0.5) * 6 * intensity}px`);
    overlay.style.setProperty('--boot-skew', `${(Math.random() - 0.5) * 4 * heavyIntensity}deg`);
    overlay.style.setProperty('--boot-brightness', (0.02 + heavyIntensity * 0.05).toFixed(3));
    overlay.style.setProperty('--boot-contrast', (0.04 + intensity * 0.3).toFixed(3));
    overlay.style.setProperty('--boot-blur', `${(Math.random() * 0.8 + heavyIntensity * 0.7).toFixed(2)}px`);
    overlay.style.setProperty('--boot-noise-x', `${Math.round((Math.random() - 0.5) * 48)}px`);
    overlay.style.setProperty('--boot-noise-y', `${Math.round((Math.random() - 0.5) * 42)}px`);
    overlay.style.setProperty('--boot-roll-y', `${(-10 + progress * 120).toFixed(2)}%`);
    overlay.style.setProperty('--boot-roll-opacity', (0.02 + heavyIntensity * 0.14).toFixed(3));
    overlay.style.setProperty('--boot-vignette-opacity', (0.08 + intensity * 0.1).toFixed(3));

    missionBootSliceEls.forEach(slice => {
      if (Math.random() > sliceChance) {
        slice.style.opacity = '0';
        slice.style.height = '0px';
        return;
      }

      const top = Math.random() * 96;
      const height = 1 + Math.random() * (3 + heavyIntensity * 9);
      const shift = (Math.random() - 0.5) * (8 + heavyIntensity * 36);
      const scale = 1 + Math.random() * heavyIntensity * 0.06;
      const blur = Math.random() * 0.25 + heavyIntensity * 0.45;
      const opacity = 0.03 + Math.random() * 0.08 + heavyIntensity * 0.12;

      slice.style.top = `${top.toFixed(2)}%`;
      slice.style.height = `${height.toFixed(2)}px`;
      slice.style.opacity = opacity.toFixed(3);
      slice.style.transform = `translate3d(${shift.toFixed(2)}px, 0, 0) scaleX(${scale.toFixed(3)})`;
      slice.style.filter = `blur(${blur.toFixed(2)}px)`;
    });
  }

  function triggerMissionBootEffect() {
    clearMissionBootEffect();
    if (typeof ThermalSystem === 'undefined' || !ThermalSystem.playScriptedGlitch) return;
    ThermalSystem.playScriptedGlitch(1, 1);
  }

  function restartGame() {
    HUDSystem.hideGameOver();
    _cleanupEscortBeacon();
    EntitySystem.despawnAll();
    WeaponsSystem.reset();
    paused = false;
    MenuSystem.setResumable(false);
    if (gameOverPrimaryAction === 'next' && nextMissionIndex !== null) {
      beginMission(nextMissionIndex);
    } else if (_customMissionDef) {
      beginCustom(_customMissionDef);
    } else {
      beginMission(missionIndex);
    }
  }

  function beginMission(idx) {
    _fullSessionReset();
    document.body.classList.add('game-active');
    missionIndex = idx;
    setGameOverPrimaryAction('retry');
    time = 0;
    elapsed = 0;
    camAngle = 0;
    camTargetX = 0;
    camTargetZ = 0;
    setZoomFactor(DEFAULT_ZOOM_FACTOR, { silent: true });
    lockedTarget = null;
    targetLockStartedAt = 0;
    fireHeld = false;

    const mDef = MissionSystem.getMissionDef(idx);
    const useDefaultMapLayout = defaultMissionLayout && (mDef.id === 1 || mDef.id === 3);

    // Last Stand and Dead Wave reuse the Defaultmap road/building layout.
    if (useDefaultMapLayout) {
      TerrainSystem.resetForMission(
        mainScene,
        defaultMissionLayout.customBuildings,
        defaultMissionLayout.customRoads
      );
    } else {
      TerrainSystem.resetForMission(mainScene);
    }
    buildings = TerrainSystem.getBuildings();

    // Despawn previous entities (already done in _fullSessionReset, safety call)
    EntitySystem.despawnAll();

    // Register building-destroy callback so entity projectiles can collapse buildings
    EntitySystem.onBuildingDestroyed((b, ix, iz) => destroyBuilding(b, ix, iz));

    // Spawn entities
    EntitySystem.spawnAll(mainScene, mDef);

    // Reset ammo
    WeaponsSystem.init(mainScene);

    // Start mission tracking
    const missionDef = MissionSystem.startMission(idx, 0);

    // Ambient audio
    if (ambientStopFn) ambientStopFn();
    ambientStopFn = AudioSystem.playAmbient();

    _resetMissionVoiceSchedule();
    queueMissionStartVoice(missionDef);

    // Initial radio chatter
    setTimeout(() => {
      HUDSystem.showRadio('Spectre is on station. Cleared hot on all targets.');
    }, 2000);

    running = true;
    clock.start();

    // Centre crosshair on mission start (important for mobile touch)
    mouseX = 0; mouseY = 0;
    if (crosshairEl) {
      crosshairEl.style.left = (window.innerWidth  / 2) + 'px';
      crosshairEl.style.top  = (window.innerHeight / 2) + 'px';
    }

    triggerMissionBootEffect();

    loop();
  }

  function _cleanupEscortBeacon() {
    _escortBeaconMeshes.forEach(m => {
      mainScene.remove(m);
      if (m.geometry) m.geometry.dispose();
      if (m.material) m.material.dispose();
    });
    _escortBeaconMeshes = [];
  }

  function _createEscortBeacon(x, z) {
    _cleanupEscortBeacon();
    const y = 0.4;
    // Three concentric rings + a tall thin column
    const radii = [6, 10, 14];
    radii.forEach(r => {
      const geo = new THREE.RingGeometry(r - 0.6, r + 0.6, 48);
      const mat = new THREE.MeshBasicMaterial({ color: 0x00ff44, side: THREE.DoubleSide, transparent: true, opacity: 1 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(x, y, z);
      mainScene.add(mesh);
      _escortBeaconMeshes.push(mesh);
    });
    // Vertical column beacon
    const colGeo = new THREE.CylinderGeometry(0.5, 0.5, 30, 8);
    const colMat = new THREE.MeshBasicMaterial({ color: 0x00ff44, transparent: true, opacity: 0.6 });
    const col = new THREE.Mesh(colGeo, colMat);
    col.position.set(x, y + 15, z);
    mainScene.add(col);
    _escortBeaconMeshes.push(col);
  }

  function beginCustom(def) {
    _fullSessionReset();
    document.body.classList.add('game-active');
    missionIndex = -1;
    setGameOverPrimaryAction('retry');
    time = 0;
    elapsed = 0;
    camAngle = 0;
    camTargetX = 0;
    camTargetZ = 0;
    setZoomFactor(DEFAULT_ZOOM_FACTOR, { silent: true });
    lockedTarget = null;
    targetLockStartedAt = 0;
    fireHeld = false;

    // Always use the custom (editor) path — even if no buildings were placed.
    // Falling back to the default path would spawn the built-in building ring.
    TerrainSystem.resetForMission(
      mainScene,
      def.customBuildings || [],
      def.customRoads     || []
    );
    buildings = TerrainSystem.getBuildings();

    _cleanupEscortBeacon();
    EntitySystem.despawnAll();
    EntitySystem.onBuildingDestroyed((b, ix, iz) => destroyBuilding(b, ix, iz));
    EntitySystem.spawnAll(mainScene, def);

    // Legacy: old mission files may still have customStructures — spawn them as static entities
    if (Array.isArray(def.customStructures) && def.customStructures.length > 0) {
      def.customStructures.forEach(s => {
        EntitySystem.addEntity(EntitySystem.spawnStaticStructure(s.type, s.x, s.z, s.faction === 'hostile', mainScene));
      });
    }

    // Place flashing extraction beacon at last friendly waypoint for escort missions
    if (def.escortMode && def.friendlyWaypoints && def.friendlyWaypoints.length > 0) {
      const last = def.friendlyWaypoints[def.friendlyWaypoints.length - 1];
      _createEscortBeacon(last.x, last.z);
    }

    WeaponsSystem.init(mainScene);
    const missionDef = MissionSystem.startMission(-1, 0, def);

    if (ambientStopFn) ambientStopFn();
    ambientStopFn = AudioSystem.playAmbient();

    _resetMissionVoiceSchedule();
    queueMissionStartVoice(missionDef);

    // ---- Base Defence special mode ----
    if (def.baseDefenceMode) {
      BaseDefenceSystem.start(mainScene);
      BaseDefenceSystem.bindDeployButtons();
    }

    setTimeout(() => {
      HUDSystem.showRadio('Custom mission loaded. Spectre is on station.');
    }, 2000);

    running = true;
    clock.start();
    mouseX = 0; mouseY = 0;
    if (crosshairEl) {
      crosshairEl.style.left = (window.innerWidth  / 2) + 'px';
      crosshairEl.style.top  = (window.innerHeight / 2) + 'px';
    }

    triggerMissionBootEffect();

    loop();
  }

  // ---- Main Loop ----

  function loop() {
    if (!running) return;
    requestAnimationFrame(loop);

    const dt = Math.min(clock.getDelta(), 0.05);
    const fpsInstant = dt > 0 ? 1 / dt : fpsSmoothed;
    fpsSmoothed = Utils.lerp(fpsSmoothed, fpsInstant, 0.12);
    time += dt;
    elapsed += dt;

    update(dt);
    render();
  }

  function update(dt) {
    // Camera orbit
    camAngle += CAM_ORBIT_SPEED * dt;
    heading = ((camAngle * 180 / Math.PI) % 360 + 360) % 360;

    // Smooth camera follow aim point
    camCurrentX = Utils.lerp(camCurrentX, camTargetX, 0.05);
    camCurrentZ = Utils.lerp(camCurrentZ, camTargetZ, 0.05);

    // Camera position — circular orbit + shake
    const shake = EffectsSystem.getShake();
    const cx = Math.cos(camAngle) * CAM_RADIUS * (1 / zoomFactor) + camCurrentX;
    const cz = Math.sin(camAngle) * CAM_RADIUS * (1 / zoomFactor) + camCurrentZ;
    mainCamera.position.set(
      cx + shake.x,
      CAM_HEIGHT / zoomFactor + shake.y * 0.5,
      cz + shake.y
    );
    mainCamera.lookAt(camCurrentX, 0, camCurrentZ);
    mainCamera.fov = 55 / zoomFactor;
    mainCamera.updateProjectionMatrix();

    // Update aim from mouse / joystick
    updateAim();

    // Mobile joystick aim adjustment
    const joy = MenuSystem.getJoystick();
    if (joy.active) {
      mouseX = Utils.clamp(mouseX + joy.normX * 0.03, -1, 1);
      mouseY = Utils.clamp(mouseY - joy.normY * 0.03, -1, 1);
      updateAim();
      // Keep crosshair in sync with NDC aim position
      if (crosshairEl) {
        crosshairEl.style.left = ((mouseX + 1) / 2 * window.innerWidth)  + 'px';
        crosshairEl.style.top  = ((-mouseY + 1) / 2 * window.innerHeight) + 'px';
      }
    }

    // Building collapse animation
    for (let _bi = buildings.length - 1; _bi >= 0; _bi--) {
      const b = buildings[_bi];
      if (!b.collapsing) continue;
      b.collapseTimer += dt;
      const t = Math.min(b.collapseTimer / b.collapseDuration, 1);
      // Ease-in: slow start, fast finish
      const ease = t * t;
      b.mesh.scale.y = Math.max(0, 1 - ease);
      b.mesh.position.y = b.collapseStartY - (b.collapseStartY - b.collapseTargetY) * ease;
      if (b.collapseTiltEnabled) {
        const tiltAngle = b.collapseMaxTilt * ease;
        b.mesh.rotation.x = b.collapseTiltX * tiltAngle;
        b.mesh.rotation.z = b.collapseTiltZ * tiltAngle;
      }
      // Darken as it collapses
      const heat = Math.max(0.04, 0.2 - ease * 0.2);
      if (meshUsesVertexColors(b.mesh)) {
        const tint = Math.max(0.7, 1 - ease * 0.3);
        tintTaggedMeshes(b.mesh, 'shell', tint, tint * 0.92, tint * 0.84);
        updateDestroyWindowFlashes(b, heat);
      } else if (b.mesh.isMesh) {
        b.mesh.material.color.setRGB(heat, heat * 0.8, heat * 0.6);
      } else {
        b.mesh.traverse(c => { if (c.isMesh && c.material) c.material.color.setRGB(heat, heat * 0.8, heat * 0.6); });
      }
      if (t >= 1) {
        mainScene.remove(b.mesh);
        b.mesh.traverse(c => {
          if (c.geometry) c.geometry.dispose();
          if (c.material) c.material.dispose();
        });
        buildings.splice(_bi, 1);
      }
    }

    // Pulse escort beacon
    if (_escortBeaconMeshes.length > 0) {
      const pulse = 0.5 + 0.5 * Math.sin(time * 4.0);
      _escortBeaconMeshes.forEach((m, i) => {
        if (i < 3) {
          // rings: scale pulsing
          const s = 0.8 + 0.4 * Math.sin(time * 4.0 + i * 0.8);
          m.scale.setScalar(s);
          m.material.opacity = 0.3 + 0.7 * pulse;
        } else {
          // column: opacity pulse
          m.material.opacity = 0.2 + 0.5 * pulse;
        }
      });
    }

    // Update subsystems
    WeaponsSystem.update(dt, time, handleImpact, buildings, EntitySystem.getAll(), zoomFactor);
    EntitySystem.update(dt, time, buildings);
    EffectsSystem.update(dt);
    MissionSystem.update(dt, time, EntitySystem.getAll(), mainScene);
    HUDSystem.updateProjectileGlares(WeaponsSystem.getProjectiles(), mainCamera, time);
    HUDSystem.updateExplosionGlares(dt, mainCamera, time);

    if (!missionOutcomePending && !randomVoicePlaying && !(BaseDefenceSystem.isActive() && BaseDefenceSystem.isGameOver())) {
      randomVoiceDelayRemaining -= dt;
      if (randomVoiceDelayRemaining <= 0 && !AudioSystem.hasActiveMissionVoice()) {
        randomVoicePlaying = true;
        AudioSystem.playRandomMissionVoice(() => {
          randomVoicePlaying = false;
          randomVoiceDelayRemaining = 30;
        });
      }
    }

    // ---- Base Defence mode update ----
    if (BaseDefenceSystem.isActive()) {
      BaseDefenceSystem.update(dt, time, aimWorldX, aimWorldZ);
      // Skip normal mission win/fail checks; BD manages its own game-over
      if (BaseDefenceSystem.isGameOver()) return;
    }

    // Auto-fire (held mouse)
    if (fireHeld || keyboardFireHeld) {
      tryFire();
    }

    // Target locking
    updateTargetLock();

    // Building damage over time from heat (not needed, impact handled in handleImpact)

    // HUD update
    HUDSystem.updateFps(fpsSmoothed);
    HUDSystem.updateCoords(camCurrentX, camCurrentZ);
    HUDSystem.updateAlt(Math.round(heading));
    HUDSystem.updateTime(elapsed);
    HUDSystem.updateWeapons(WeaponsSystem.getEquippedWeapons(), WeaponsSystem.getCurrentSlot());
    HUDSystem.updateCounts(
      EntitySystem.getFriendlies().length,
      EntitySystem.getHostiles().length
    );

    // Check mission complete
    if (!missionOutcomePending && MissionSystem.checkComplete(EntitySystem.getAll())) {
      if (missionIndex === 1) MenuSystem.unlockMission(2); // unlock DEAD WAVE
      const friendliesRemaining = EntitySystem.getFriendlies().length;
      const bonus = friendliesRemaining * (MissionSystem.getCurrentMission()?.bonusPerFriendlySaved || 0);
      MissionSystem.addScore(bonus);
      const hasNextMission = !_customMissionDef && missionIndex + 1 < MissionSystem.getMissionCount();
      beginMissionResolution(false, {
        primaryAction: hasNextMission ? 'next' : 'retry',
        nextMissionIndex: hasNextMission ? missionIndex + 1 : null,
        primaryButtonText: hasNextMission ? 'NEXT MISSION' : 'RETRY MISSION'
      });
      HUDSystem.showRadio('Mission complete. Spectre departing station. Outstanding work.');
      HUDSystem.updateObjective('MISSION COMPLETE');
    }

    // Hold-mode: timer countdown and fail/win check
    const timeRemaining = MissionSystem.getTimeRemaining(time);
    if (timeRemaining !== null) {
      const mins = Math.floor(timeRemaining / 60);
      const secs = Math.floor(timeRemaining % 60);
      const timerStr = `HOLD — ${mins}:${secs.toString().padStart(2, '0')} REMAINING`;
      HUDSystem.updateObjective(timerStr);
    }

    if (!missionOutcomePending && MissionSystem.checkTimerWin(time, EntitySystem.getAll())) {
      const friendliesRemaining = EntitySystem.getFriendlies().length;
      if (missionIndex === 0) MenuSystem.unlockMission(1); // unlock Convoy Intercept
      const hasNextMission = !_customMissionDef && missionIndex + 1 < MissionSystem.getMissionCount();
      beginMissionResolution(false, {
        primaryAction: hasNextMission ? 'next' : 'retry',
        nextMissionIndex: hasNextMission ? missionIndex + 1 : null,
        primaryButtonText: hasNextMission ? 'NEXT MISSION' : 'RETRY MISSION'
      });
      HUDSystem.showRadio(`Compound held. ${friendliesRemaining} friendly unit${friendliesRemaining !== 1 ? 's' : ''} survived. Mission success.`);
      HUDSystem.updateObjective('MISSION COMPLETE — COMPOUND HELD');
    }

    if (!missionOutcomePending && MissionSystem.checkFail(EntitySystem.getAll())) {
      beginMissionResolution(true, {
        primaryAction: 'retry',
        primaryButtonText: 'RETRY MISSION'
      });
      HUDSystem.showRadio('All friendlies KIA. Mission failed.');
      HUDSystem.updateObjective('MISSION FAILED — ALL FRIENDLIES LOST');
    }

    // Fire indicator
    HUDSystem.setFireIndicator((mouseDown || keyboardFireHeld) && WeaponsSystem.canFire(time));
  }

  // ---- Aim / Raycasting ----

  function updateAim() {
    // Project mouse ray onto ground plane
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2(mouseX, mouseY);
    raycaster.setFromCamera(ndc, mainCamera);
    const hits = raycaster.intersectObject(groundPlane);
    if (hits.length > 0) {
      aimWorldX = hits[0].point.x;
      aimWorldZ = hits[0].point.z;
      aimWorldY = TerrainSystem.getHeightAt(aimWorldX, aimWorldZ);
      // Soft camera target follow
      camTargetX = Utils.lerp(camTargetX, aimWorldX * 0.40, 0.03);
      camTargetZ = Utils.lerp(camTargetZ, aimWorldZ * 0.40, 0.03);
    }
  }

  // ---- Firing ----

  function tryFire() {
    // Gun origin: fixed distance from target along camera direction, shifted right
    const GUN_DISTANCE    = 500;   // fixed distance from target (zoom-independent)
    const GUN_RIGHT       = 25;    // lateral offset to the right of camera direction

    // Unit vector from target toward camera (horizontal only, then normalized in 3D)
    const camDirX = mainCamera.position.x - aimWorldX;
    const camDirY = mainCamera.position.y - (aimWorldY || 0);
    const camDirZ = mainCamera.position.z - aimWorldZ;
    const camDirLen = Math.sqrt(camDirX * camDirX + camDirY * camDirY + camDirZ * camDirZ);
    const ndx = camDirX / camDirLen;
    const ndy = camDirY / camDirLen;
    const ndz = camDirZ / camDirLen;

    // Right vector = cross(up, camDir) then normalized
    const rx =  ndz;
    const rz = -ndx;
    const rLen = Math.sqrt(rx * rx + rz * rz) || 1;

    const gunOriginX = aimWorldX + ndx * GUN_DISTANCE + (rx / rLen) * GUN_RIGHT;
    const gunOriginY = aimWorldY + ndy * GUN_DISTANCE;
    const gunOriginZ = aimWorldZ + ndz * GUN_DISTANCE + (rz / rLen) * GUN_RIGHT;

    const result = WeaponsSystem.fire(time, aimWorldX, aimWorldZ, aimWorldY,
      gunOriginX, gunOriginY, gunOriginZ,
      {
        lockedTarget,
        lockProgress: missileLockProgress
      });
    if (!result) return;

    const { weapon, tracer } = result;
  }

  // ---- Impact handling ----

  function handleImpact(projectile) {
    const { x, z, weapon } = projectile;
    const groundY = TerrainSystem.getHeightAt(x, z);
    const impactDirection = new THREE.Vector3(projectile.dx || 0, projectile.dy || -1, projectile.dz || 0);
    const explosionOptions = (weapon.id === 3 || weapon.id === 4 || weapon.id === 6)
      ? { shockwaveStyle: 'billboard' }
      : {};

    // Explosion effect
    if (weapon.id === 1) EffectsSystem.spawnMinigunImpactExplosion(x, groundY, z, impactDirection);
    else EffectsSystem.spawnExplosion(x, groundY, z, weapon.explosionSize, explosionOptions);
    if (weapon.id === 3 || weapon.id === 4 || weapon.id === 6) {
      HUDSystem.spawnExplosionGlare(x, groundY, z, weapon.id, weapon.explosionSize);
    }
    if ((weapon.id === 4 || weapon.id === 6) && typeof ThermalSystem !== 'undefined' && ThermalSystem.addGlitchImpulse) {
      ThermalSystem.addGlitchImpulse(0.2);
    }
    if (weapon.id === 6) AudioSystem.play105mm();

    // Notify entity AI — triggers suppress/flee behaviour
    EntitySystem.notifyExplosion(x, z, weapon.explosionSize, time);

    // AOE damage to entities
    const aoe = weapon.aoeRadius || 0;
    const splashDamageMultiplier = weapon.splashDamageMultiplier !== undefined ? weapon.splashDamageMultiplier : 1;
    EntitySystem.getAll().forEach(ent => {
      if (!ent.alive) return;
      const dist = Utils.dist2D(x, z, ent.x, ent.z);
      const hitRange = aoe > 0 ? aoe : 2.0;
      if (dist < hitRange) {
        const falloff = aoe > 0 ? Math.max(0, 1 - dist / aoe) : 1;
        const directHit = projectile.directTarget && projectile.directTarget === ent;
        const dmg = weapon.damage * falloff * (directHit ? 1 : splashDamageMultiplier);
        EntitySystem.takeDamage(ent, dmg, {
          playEnemyHitVoice: ent.hostile && dmg > 0
        });

        if (!ent.hostile && dmg > 0) {
          AudioSystem.playFriendlyHitVoice();
        }

        if (!ent.alive) {
          if (ent.hostile && ent.type === 'vehicle' && ent.vehicleSubtype === 'tank') {
            AudioSystem.playTankHitVoice();
          }
          MissionSystem.recordKill(ent);
          // Award credits in Base Defence mode
          if (BaseDefenceSystem.isActive()) BaseDefenceSystem.onKill(ent);
        }
      }
    });

    // Building damage
    buildings.forEach(b => {
      if (b.destroyed || b.isTerrainProp) return;
      const dist = Utils.dist2D(x, z, b.x, b.z);
      const hitRange = Math.max(b.w, b.d) / 2 + (aoe > 0 ? aoe : 1.5);
      if (dist < hitRange) {
        // 105mm deals full damage to buildings; all other weapons deal 10% (90% reduction)
        const armorMult = weapon.id === 4 ? 1.0 : 0.1;
        const dmg = weapon.damage * (aoe > 0 ? 0.6 : 0.4) * armorMult;
        b.hp -= dmg;
        if (b.hp <= 0 && !b.destroyed) {
          destroyBuilding(b, x, z);
        } else {
          // Vertex-colored buildings already encode heat in geometry colors, so
          // flash only the main shell so windows and rooftop details keep their own heat.
          const usesVertexColors = meshUsesVertexColors(b.mesh);
          if (usesVertexColors) {
            tintTaggedMeshes(b.mesh, 'shell', 1.12, 0.96, 0.9);
            setTimeout(() => {
              if (!b.destroyed && b.mesh) tintTaggedMeshes(b.mesh, 'shell', 1, 1, 1);
            }, 250);
          } else if (b.mesh.isMesh) {
            b.mesh.material.color.setRGB(0.5, 0.2, 0.1);
            setTimeout(() => {
              if (!b.destroyed && b.mesh && b.mesh.isMesh) {
                const h = 0.12;
                b.mesh.material.color.setRGB(h, h * 0.8, h * 0.6);
              }
            }, 250);
          } else {
            b.mesh.traverse(c => { if (c.isMesh && c.material) c.material.color.setRGB(0.5, 0.2, 0.1); });
            setTimeout(() => {
              if (!b.destroyed && b.mesh) {
                b.mesh.traverse(c => {
                  if (c.isMesh && c.material) {
                    const h = 0.12;
                    c.material.color.setRGB(h, h * 0.8, h * 0.6);
                  }
                });
              }
            }, 250);
          }
        }
      }
    });

    // Impact splash for small hits
    if (aoe === 0) {
      if (weapon.id === 1) {
        const quality = MenuSystem.getQuality ? MenuSystem.getQuality() : 'high';
        const maxImpactParticles = quality === 'low' ? 1 : quality === 'medium' ? 2 : 3;
        EffectsSystem.spawnImpact(x, groundY, z, {
          particleScale: 1.0,
          maxDustCount: maxImpactParticles,
          maxSparkCount: maxImpactParticles,
          dustVelocityScale: 2.0,
          sparkSpeedScale: 2.4
        });
      } else {
        EffectsSystem.spawnImpact(x, groundY, z, 1.0);
      }
    }
  }

  function destroyBuilding(b, impX, impZ) {
    if (b.destroyed || b.isTerrainProp) return; // guard against double-call
    b.destroyed = true;
    // Set up collapse animation immediately so a failing effect call can't prevent it
    b.collapsing = true;
    b.collapseTimer = 0;
    b.collapseDuration = 2.8 + Math.random() * 0.8;
    b.collapseStartY = b.mesh.position.y;
    b.collapseTargetY = b.groundY - b.h * 0.08;
    b.collapseTiltEnabled = Math.random() < 0.85;
    b.collapseTiltX = 0;
    b.collapseTiltZ = 0;
    b.collapseMaxTilt = 0;
    if (b.collapseTiltEnabled) {
      const tiltDir = Math.random() * Math.PI * 2;
      b.collapseTiltX = Math.sin(tiltDir);
      b.collapseTiltZ = -Math.cos(tiltDir);
      b.collapseMaxTilt = Utils.randFloat(0.12, 0.6);
    }
    prepareDestroyWindowFlashes(b);
    EffectsSystem.spawnExplosion(b.x, b.groundY + b.h / 2, b.z, 1.5);
    EffectsSystem.spawnDebris(b.x, b.groundY + b.h, b.z);
    EffectsSystem.spawnCollapseSmoke(b.x, b.groundY, b.z, b.h, b.w, b.d);
    MissionSystem.addScore(25);
    HUDSystem.addKillFeed('■ STRUCTURE DESTROYED +25 PRESTIGE');
  }

  function tintMaterial(material, r, g, b) {
    if (!material) return;
    if (Array.isArray(material)) {
      material.forEach(m => tintMaterial(m, r, g, b));
      return;
    }
    if (material.color) material.color.setRGB(r, g, b);
  }

  function tintMesh(mesh, r, g, b) {
    if (!mesh) return;
    if (mesh.isMesh && mesh.material) tintMaterial(mesh.material, r, g, b);
    if (!mesh.traverse) return;
    mesh.traverse(c => {
      if (c.isMesh && c.material) tintMaterial(c.material, r, g, b);
    });
  }

  function tintTaggedMeshes(mesh, partName, r, g, b) {
    if (!mesh || !mesh.traverse) return;
    mesh.traverse(c => {
      if (!c.isMesh || !c.material) return;
      if (c.userData && c.userData.buildingPart === partName) {
        tintMaterial(c.material, r, g, b);
      }
    });
  }

  function setMeshHeat(mesh, heat) {
    if (!mesh || !mesh.material || !mesh.material.color) return;
    mesh.material.color.setRGB(heat, heat, heat);
  }

  function prepareDestroyWindowFlashes(building) {
    if (!building || !building.mesh || !building.mesh.traverse) return;
    const windows = [];
    building.mesh.traverse(c => {
      if (c.isMesh && c.userData && c.userData.buildingPart === 'window') {
        windows.push(c);
      }
    });
    if (!windows.length) return;

    windows.forEach(windowMesh => {
      windowMesh.userData.destroyFlash = null;
    });

    const assignFlash = (windowMesh, interval) => {
      const baseHeat = windowMesh.userData.baseHeat !== undefined ? windowMesh.userData.baseHeat : 0.08;
      windowMesh.userData.destroyFlash = {
        interval,
        phase: Math.random() * interval,
        flashHeat: Utils.clamp(baseHeat + Utils.randFloat(0.25, 0.3), 0.18, 0.3),
        offHeat: Utils.randFloat(0.005, 0.035)
      };
    };

    const shuffled = windows.slice().sort(() => Math.random() - 0.5);
    const targetFlashCount = Math.max(1, Math.round(shuffled.length * 0.075));
    for (let i = 0; i < targetFlashCount; i++) {
      const interval = i === 0 ? 0.2 : (i === 1 ? 0.5 : (Math.random() < 0.5 ? 0.2 : 0.5));
      assignFlash(shuffled[i], interval);
    }
  }

  function updateDestroyWindowFlashes(building, fallbackHeat) {
    if (!building || !building.mesh || !building.mesh.traverse) return;
    const elapsed = building.collapseTimer || 0;
    building.mesh.traverse(c => {
      if (!c.isMesh || !c.userData || c.userData.buildingPart !== 'window') return;
      const flash = c.userData.destroyFlash;
      if (!flash) {
        const baseHeat = c.userData.baseHeat !== undefined ? c.userData.baseHeat : fallbackHeat;
        setMeshHeat(c, baseHeat);
        return;
      }
      const cycleLength = flash.interval * 2;
      const cyclePos = (elapsed + flash.phase) % cycleLength;
      setMeshHeat(c, cyclePos < flash.interval ? flash.flashHeat : flash.offHeat);
    });
  }

  function meshUsesVertexColors(mesh) {
    let usesVertexColors = false;
    if (!mesh) return false;
    if (mesh.isMesh && mesh.material) {
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      usesVertexColors = materials.some(m => !!m && !!m.vertexColors);
    }
    if (usesVertexColors || !mesh.traverse) return usesVertexColors;
    mesh.traverse(c => {
      if (!c.isMesh || !c.material) return;
      const materials = Array.isArray(c.material) ? c.material : [c.material];
      if (materials.some(m => !!m && !!m.vertexColors)) usesVertexColors = true;
    });
    return usesVertexColors;
  }

  // ---- Target lock ----

  function updateTargetLock() {
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2(mouseX, mouseY);
    raycaster.setFromCamera(ndc, mainCamera);
    const currentWeapon = WeaponsSystem.getCurrentWeapon();
    const missileSelected = !!currentWeapon && currentWeapon.id === 6;

    let closest = null;
    let closestDist = Infinity;

    EntitySystem.getAll().forEach(ent => {
      if (!ent.alive) return;
      if (missileSelected && ent.type !== 'vehicle') return;
      const pos = new THREE.Vector3(ent.x, _getTargetAnchorHeight(ent), ent.z);
      const d = raycaster.ray.distanceToPoint(pos);
      const lockRadius = _getTargetLockRadius(ent);
      if (d <= lockRadius && d < closestDist) {
        closestDist = d;
        closest = ent;
      }
    });

    if (closest !== lockedTarget) {
      lockedTarget = closest;
      targetLockStartedAt = closest ? time : 0;
    }

    if (!lockedTarget || !lockedTarget.alive) {
      lockedTarget = null;
      missileLockProgress = 0;
      missileLockReady = false;
      HUDSystem.clearTargetIdentification();
      if (missileSelected) {
        HUDSystem.updateCrosshairLock({ state: 'searching', text: 'SEEK' });
      } else {
        HUDSystem.clearCrosshairLock();
      }
      AudioSystem.setMissileLockTone('off');
      return;
    }

    const screenPos = Utils.worldToScreen(
      new THREE.Vector3(lockedTarget.x, _getTargetAnchorHeight(lockedTarget), lockedTarget.z),
      mainCamera,
      renderer
    );
    if (!screenPos.visible) {
      HUDSystem.clearTargetIdentification();
      missileLockProgress = 0;
      missileLockReady = false;
      if (missileSelected) HUDSystem.updateCrosshairLock({ state: 'searching', text: 'SEEK' });
      else HUDSystem.clearCrosshairLock();
      AudioSystem.setMissileLockTone('off');
      return;
    }

    const identified = (time - targetLockStartedAt) >= TARGET_IDENTIFY_DELAY;
    const boxSize = _getTargetBoxSize(lockedTarget);
    const labelWidth = 180;
    const sidePadding = 18;
    const align = screenPos.x + (boxSize * 0.5) + labelWidth + sidePadding < window.innerWidth
      ? 'right'
      : 'left';
    HUDSystem.updateTargetIdentification({
      x: screenPos.x,
      y: screenPos.y,
      boxSize,
      align,
      state: identified ? (lockedTarget.hostile ? 'hostile' : 'friendly') : 'pending',
      statusText: identified ? (lockedTarget.hostile ? 'HOSTILE' : 'FRIENDLY') : 'IDENTIFYING...',
      typeText: identified ? _getTargetTypeLabel(lockedTarget) : ''
    });

    if (missileSelected && lockedTarget.type === 'vehicle') {
      missileLockProgress = Utils.clamp((time - targetLockStartedAt) / MISSILE_LOCK_DELAY, 0, 1);
      missileLockReady = missileLockProgress >= 1;
      HUDSystem.updateCrosshairLock({
        state: missileLockReady ? 'locked' : 'locking',
        text: missileLockReady ? 'LOCKED' : 'LOCKING'
      });
      AudioSystem.setMissileLockTone(missileLockReady ? 'locked' : 'acquiring');
    } else {
      missileLockProgress = 0;
      missileLockReady = false;
      if (missileSelected) HUDSystem.updateCrosshairLock({ state: 'searching', text: 'SEEK' });
      else HUDSystem.clearCrosshairLock();
      AudioSystem.setMissileLockTone('off');
    }
  }

  function _getTargetAnchorHeight(ent) {
    if (ent.type === 'vehicle') {
      return ent.vehicleSubtype === 'tank' ? 2.8 : ent.vehicleSubtype === 'apc' ? 2.5 : 2.1;
    }
    if (ent.type === 'staticStructure') {
      return ent.structureType === 'artillery' ? 3.2 : ent.structureType === 'bofors' ? 2.4 : 2.1;
    }
    return 1.4;
  }

  function _getTargetLockRadius(ent) {
    if (ent.type === 'vehicle') {
      return ent.vehicleSubtype === 'tank' ? 16 : ent.vehicleSubtype === 'apc' ? 14 : 13;
    }
    if (ent.type === 'staticStructure') {
      return ent.structureType === 'artillery' ? 18 : 15;
    }
    return TARGET_DIST;
  }

  function _getTargetBoxSize(ent) {
    if (ent.type === 'vehicle') {
      return ent.vehicleSubtype === 'tank' ? 64 : ent.vehicleSubtype === 'apc' ? 58 : 54;
    }
    if (ent.type === 'staticStructure') {
      return ent.structureType === 'artillery' ? 68 : ent.structureType === 'bofors' ? 60 : 56;
    }
    return 42;
  }

  function _getTargetTypeLabel(ent) {
    if (ent.type === 'infantry') {
      if (ent.infantryRole === 'machineGunner') return 'MACHINE GUNNER';
      if (ent.infantryRole === 'antiTank') return 'ANTI-TANK INFANTRY';
      return 'INFANTRY';
    }

    if (ent.type === 'vehicle') {
      if (ent.vehicleSubtype === 'tank') return 'TANK';
      if (ent.vehicleSubtype === 'apc') return 'APC';
      return 'TRUCK';
    }

    if (ent.type === 'staticStructure') {
      if (ent.structureType === 'bunker') return 'BUNKER';
      if (ent.structureType === 'bofors') return 'BOFORS';
      if (ent.structureType === 'artillery') return 'ARTILLERY';
    }

    return 'UNKNOWN';
  }

  // ---- Render ----

  function render() {
    const zoomT = Utils.clamp((zoomFactor - 0.9) / (ZOOM_MAX - 1.02), 0, 1);
    const tiltShiftStrength = zoomT * 1.35;
    ThermalSystem.render(renderer, mainScene, mainCamera, time, tiltShiftStrength);
  }

  // ---- Events ----

  // crosshair DOM element cached once
  let crosshairEl = null;

  function isGameplayPointerBlocked(target) {
    if (!(target instanceof Element)) return false;
    return !!target.closest(
      '#bd-panel, #hud-menu-btn, #editor-toolbar, #main-menu, #missions-screen, #settings-screen, #controls-screen, #unit-editor-screen, #gameover-screen'
      + ', #loadout-screen'
    );
  }

  function clearFireInputState() {
    mouseDown = false;
    fireHeld = false;
    keyboardFireHeld = false;
  }

  function isCoarsePointerDevice() {
    return typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(pointer: coarse)').matches;
  }

  function noteTouchInput() {
    lastTouchInputAt = Date.now();
  }

  function shouldIgnoreMouseInput() {
    return isCoarsePointerDevice() || (Date.now() - lastTouchInputAt) < 900;
  }

  function bindEvents() {
    crosshairEl = document.getElementById('crosshair');
    ['touchstart', 'touchmove', 'touchend', 'touchcancel'].forEach(type => {
      window.addEventListener(type, noteTouchInput, { passive: true, capture: true });
    });

    // Mouse move -> NDC + crosshair follow
    window.addEventListener('mousemove', e => {
      if (shouldIgnoreMouseInput()) return;
      mouseX = (e.clientX / window.innerWidth)  * 2 - 1;
      mouseY = -(e.clientY / window.innerHeight) * 2 + 1;
      if (crosshairEl) {
        crosshairEl.style.left = e.clientX + 'px';
        crosshairEl.style.top  = e.clientY + 'px';
      }
    });

    window.addEventListener('mousedown', e => {
      if (shouldIgnoreMouseInput()) return;
      if (e.button === 0) {
        if (isGameplayPointerBlocked(e.target)) return;
        // If base defence placement mode is active, route click to placement
        if (BaseDefenceSystem.isActive() && BaseDefenceSystem.isPlacing()) {
          BaseDefenceSystem.confirmPlacement(aimWorldX, aimWorldZ);
          return;
        }
        mouseDown = true;
        fireHeld  = true;
        AudioSystem.resume();
        if (running) tryFire();
      }
    });

    window.addEventListener('mouseup', e => {
      if (shouldIgnoreMouseInput()) return;
      if (e.button === 0) {
        clearFireInputState();
      }
    });

    window.addEventListener('blur', () => {
      clearFireInputState();
    });

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) clearFireInputState();
    });

    // Prevent context menu
    window.addEventListener('contextmenu', e => e.preventDefault());

    // Scroll to zoom only while the live game is active so overlay panels can scroll normally.
    window.addEventListener('wheel', e => {
      if (!running || paused || !document.body.classList.contains('game-active')) return;
      setZoomFactor(zoomFactor - e.deltaY * 0.001);
      e.preventDefault();
    }, { passive: false });

    // Keyboard
    window.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        if (running) {
          e.preventDefault();
          pauseToMainMenu();
        }
        return;
      }

      if (!running) return;
      if (e.code === 'Space') {
        e.preventDefault();
        keyboardFireHeld = true;
        AudioSystem.resume();
        if (!e.repeat) tryFire();
        return;
      }

      switch (e.key) {
        case '1': WeaponsSystem.selectWeapon(1); MenuSystem.syncMobileWeapon(1); break;
        case '2': WeaponsSystem.selectWeapon(2); MenuSystem.syncMobileWeapon(2); break;
        case '3': WeaponsSystem.selectWeapon(3); MenuSystem.syncMobileWeapon(3); break;
        case 'r': case 'R':
          WeaponsSystem.manualReload(); break;
      }
    });

    window.addEventListener('keyup', e => {
      if (e.code === 'Space') {
        keyboardFireHeld = false;
      }
    });

    // Resize
    window.addEventListener('resize', () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      renderer.setSize(w, h);
      ThermalSystem.resize(w, h);
      mainCamera.aspect = w / h;
      mainCamera.updateProjectionMatrix();
    });
  }

  // ---- Boot ----
  window.addEventListener('DOMContentLoaded', init);

  return { startGame, startCustomMission, resumeGame, restartGame };
})();
