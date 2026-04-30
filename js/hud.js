/* =============================================
   HUD.JS — Heads-Up Display management
   ============================================= */
'use strict';

const HUDSystem = (() => {

  const els = {};
  let killFeedEl = null;
  let radioPopupEl = null;
  let radioTimeout = null;
  let missionObjectivePopupEl = null;
  let missionObjectivePopupTextEl = null;
  let missionObjectivePopupIntroTimer = null;
  let missionObjectivePopupOutroTimer = null;
  let missionObjectivePopupHideTimer = null;
  let speakerPortraitEl = null;
  let speakerPortraitImageEl = null;
  let speakerPortraitGlitchTimer = null;
  let speakerPortraitHideTimer = null;
  let targetIdentificationEl = null;
  let targetIdentificationBoxEl = null;
  let targetIdentificationStatusEl = null;
  let targetIdentificationTypeEl = null;
  let crosshairLockEl = null;
  let crosshairLockTextEl = null;
  let fpsEl = null;
  let projectileGlareLayerEl = null;
  const projectileGlareEls = new Map();
  let explosionGlareLayerEl = null;
  let explosionScreenFlareLayerEl = null;
  let explosionGlares = [];
  const _projectileScreenPos = new THREE.Vector3();
  const _projectileScreenPosEdge = new THREE.Vector3();

  function init() {
    const ids = [
      'hud-coords', 'hud-alt', 'hud-time',
      'hud-score', 'hud-kills', 'hud-objective',
      'weapon-1', 'weapon-2', 'weapon-3',
      'ammo-1', 'ammo-2', 'ammo-3',
      'status-1', 'status-2', 'status-3',
      'friendly-count', 'hostile-count',
      'warning-text', 'fire-indicator',
      'thermal-indicator'
    ];
    ids.forEach(id => els[id] = document.getElementById(id));

    // Kill feed
    killFeedEl = document.getElementById('kill-feed');
    if (!killFeedEl) {
      killFeedEl = document.createElement('div');
      killFeedEl.id = 'kill-feed';
      document.body.appendChild(killFeedEl);
    }

    // Radio popup
    radioPopupEl = document.getElementById('radio-popup');
    if (!radioPopupEl) {
      radioPopupEl = document.createElement('div');
      radioPopupEl.id = 'radio-popup';
      document.body.appendChild(radioPopupEl);
    }

    missionObjectivePopupEl = document.getElementById('mission-objective-popup');
    if (!missionObjectivePopupEl) {
      missionObjectivePopupEl = document.createElement('div');
      missionObjectivePopupEl.id = 'mission-objective-popup';

      const missionObjectivePopupKickerEl = document.createElement('div');
      missionObjectivePopupKickerEl.className = 'mission-objective-popup-kicker';
      missionObjectivePopupKickerEl.textContent = 'MISSION OBJECTIVE';
      missionObjectivePopupEl.appendChild(missionObjectivePopupKickerEl);

      missionObjectivePopupTextEl = document.createElement('div');
      missionObjectivePopupTextEl.className = 'mission-objective-popup-text';
      missionObjectivePopupEl.appendChild(missionObjectivePopupTextEl);

      (document.getElementById('hud') || document.body).appendChild(missionObjectivePopupEl);
    } else {
      missionObjectivePopupTextEl = missionObjectivePopupEl.querySelector('.mission-objective-popup-text');
    }

    speakerPortraitEl = document.getElementById('speaker-portrait');
    if (!speakerPortraitEl) {
      speakerPortraitEl = document.createElement('div');
      speakerPortraitEl.id = 'speaker-portrait';
      speakerPortraitImageEl = document.createElement('div');
      speakerPortraitImageEl.id = 'speaker-portrait-image';
      speakerPortraitEl.appendChild(speakerPortraitImageEl);
      (document.getElementById('hud') || document.body).appendChild(speakerPortraitEl);
    } else {
      speakerPortraitImageEl = document.getElementById('speaker-portrait-image');
    }

    targetIdentificationEl = document.getElementById('target-identification');
    if (!targetIdentificationEl) {
      targetIdentificationEl = document.createElement('div');
      targetIdentificationEl.id = 'target-identification';

      targetIdentificationBoxEl = document.createElement('div');
      targetIdentificationBoxEl.id = 'target-identification-box';
      targetIdentificationEl.appendChild(targetIdentificationBoxEl);

      const labelEl = document.createElement('div');
      labelEl.id = 'target-identification-label';

      targetIdentificationStatusEl = document.createElement('div');
      targetIdentificationStatusEl.id = 'target-identification-status';
      labelEl.appendChild(targetIdentificationStatusEl);

      targetIdentificationTypeEl = document.createElement('div');
      targetIdentificationTypeEl.id = 'target-identification-type';
      labelEl.appendChild(targetIdentificationTypeEl);

      targetIdentificationEl.appendChild(labelEl);
      (document.getElementById('hud') || document.body).appendChild(targetIdentificationEl);
    } else {
      targetIdentificationBoxEl = document.getElementById('target-identification-box');
      targetIdentificationStatusEl = document.getElementById('target-identification-status');
      targetIdentificationTypeEl = document.getElementById('target-identification-type');
    }

    const crosshairEl = document.getElementById('crosshair');
    if (crosshairEl) {
      crosshairLockEl = document.getElementById('crosshair-lock-state');
      if (!crosshairLockEl) {
        crosshairLockEl = document.createElement('div');
        crosshairLockEl.id = 'crosshair-lock-state';
        crosshairEl.appendChild(crosshairLockEl);
      }
      crosshairLockTextEl = document.getElementById('crosshair-lock-text');
      if (!crosshairLockTextEl) {
        crosshairLockTextEl = document.createElement('div');
        crosshairLockTextEl.id = 'crosshair-lock-text';
        crosshairLockEl.appendChild(crosshairLockTextEl);
      }
    }

    projectileGlareLayerEl = document.getElementById('projectile-glare-layer');
    if (!projectileGlareLayerEl) {
      projectileGlareLayerEl = document.createElement('div');
      projectileGlareLayerEl.id = 'projectile-glare-layer';
      document.body.appendChild(projectileGlareLayerEl);
    }

    explosionGlareLayerEl = document.getElementById('explosion-glare-layer');
    if (!explosionGlareLayerEl) {
      explosionGlareLayerEl = document.createElement('div');
      explosionGlareLayerEl.id = 'explosion-glare-layer';
      document.body.appendChild(explosionGlareLayerEl);
    }

    explosionScreenFlareLayerEl = document.getElementById('explosion-screen-flare-layer');
    if (!explosionScreenFlareLayerEl) {
      explosionScreenFlareLayerEl = document.createElement('div');
      explosionScreenFlareLayerEl.id = 'explosion-screen-flare-layer';
      document.body.appendChild(explosionScreenFlareLayerEl);
    }

    clearTargetIdentification();
    clearCrosshairLock();
    clearProjectileGlares();
    clearExplosionGlares();

    fpsEl = document.getElementById('hud-fps');
    if (!fpsEl) {
      fpsEl = document.createElement('div');
      fpsEl.id = 'hud-fps';
      fpsEl.className = 'hud-label hud-metric';
      fpsEl.textContent = 'FPS: --';
      const hudLeft = document.getElementById('hud-left') || document.getElementById('hud') || document.body;
      hudLeft.insertBefore(fpsEl, hudLeft.firstChild);
    }
  }

  function updateFps(fps) {
    if (!fpsEl) return;
    fpsEl.textContent = `FPS: ${Math.round(fps)}`;
  }

  function updateCoords(x, z) {
    if (!els['hud-coords']) return;
    const lat = (x * 0.001).toFixed(4);
    const lon = (z * 0.001 + 35.0).toFixed(4);
    const latStr = lat >= 0 ? `${lat}°N` : `${Math.abs(lat)}°S`;
    const lonStr = lon >= 0 ? `${lon}°E` : `${Math.abs(lon)}°W`;
    els['hud-coords'].textContent = `LAT: ${latStr}  LON: ${lonStr}`;
  }

  function updateAlt(heading) {
    if (!els['hud-alt']) return;
    els['hud-alt'].textContent = `ALT: 7000 FT  HDG: ${Math.round(heading)}°`;
  }

  function updateTime(elapsed) {
    if (!els['hud-time']) return;
    const totalSec = Math.floor(elapsed);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    els['hud-time'].textContent = `TIME ON STATION: ${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  }

  function updateScore(score, kills) {
    if (els['hud-score']) els['hud-score'].textContent = `PRESTIGE: ${score.toLocaleString()}`;
    if (els['hud-kills']) els['hud-kills'].textContent = `NEUTRALIZED: ${kills}`;
  }

  function updateObjective(text) {
    if (els['hud-objective']) els['hud-objective'].textContent = `OBJECTIVE: ${text}`;
  }

  function updateWeapons(weapons, currentId) {
    [1, 2, 3].forEach(id => {
      const w = weapons[id];
      const slotEl = els[`weapon-${id}`];
      const ammoEl = els[`ammo-${id}`];
      const statusEl = els[`status-${id}`];
      if (!slotEl) return;

      const nameEl = slotEl.querySelector('.weapon-name');
      if (!w) {
        slotEl.style.display = 'none';
        return;
      }
      slotEl.style.display = '';

      // Active highlight
      slotEl.classList.toggle('active', id === currentId);

      if (nameEl) nameEl.textContent = w.name;

      // Ammo
      if (ammoEl) {
        ammoEl.textContent = w.ammo === Infinity ? '∞' : w.ammo;
      }

      // Remove existing reload bar and heat bar
      const existing = slotEl.querySelector('.reload-bar');
      if (existing) slotEl.removeChild(existing);
      const existingHeat = slotEl.querySelector('.heat-bar');
      if (existingHeat) slotEl.removeChild(existingHeat);

      if (w.overheated) {
        slotEl.classList.add('reloading');
        slotEl.classList.remove('empty');
        if (statusEl) statusEl.textContent = 'OVERHEAT';
        const bar = document.createElement('div');
        bar.className = 'reload-bar';
        const fill = document.createElement('div');
        fill.className = 'reload-bar-fill';
        fill.style.width = (w.reloadProgress * 100).toFixed(1) + '%';
        bar.appendChild(fill);
        slotEl.appendChild(bar);
      } else if (w.reloading) {
        slotEl.classList.add('reloading');
        slotEl.classList.remove('empty');
        if (statusEl) statusEl.textContent = 'RELOADING';
        // Add progress bar
        const bar = document.createElement('div');
        bar.className = 'reload-bar';
        const fill = document.createElement('div');
        fill.className = 'reload-bar-fill';
        fill.style.width = (w.reloadProgress * 100).toFixed(1) + '%';
        bar.appendChild(fill);
        slotEl.appendChild(bar);
      } else if (w.ammo === 0) {
        slotEl.classList.add('empty');
        slotEl.classList.remove('reloading');
        if (statusEl) statusEl.textContent = 'EMPTY';
      } else {
        slotEl.classList.remove('reloading', 'empty');
        if (statusEl) {
          statusEl.textContent = id === currentId ? 'SELECTED' : 'READY';
        }
        // Heat bar for 25mm
        if (w.heat !== undefined && w.heat > 0.01) {
          const heatPct = (w.heat * 100).toFixed(1);
          const hbar = document.createElement('div');
          hbar.className = 'heat-bar';
          const hfill = document.createElement('div');
          hfill.className = 'heat-bar-fill';
          hfill.style.width = heatPct + '%';
          // Warm colour shift: white → bright white at high heat
          const intensity = Math.floor(180 + w.heat * 75);
          hfill.style.background = `rgb(${intensity},${Math.floor(intensity * (1 - w.heat * 0.55))},${Math.floor(intensity * (1 - w.heat * 0.8))})`;
          hbar.appendChild(hfill);
          slotEl.appendChild(hbar);
          if (statusEl && w.heat > 0.75) statusEl.textContent = 'HOT';
        }
      }
    });

    if (typeof MenuSystem !== 'undefined' && MenuSystem.updateMobileWeaponButtons) {
      MenuSystem.updateMobileWeaponButtons(weapons, currentId);
    }
  }

  function updateCounts(friendlies, hostiles) {
    if (els['friendly-count']) els['friendly-count'].textContent = friendlies;
    if (els['hostile-count']) els['hostile-count'].textContent = hostiles;
  }

  function setWarning(text) {
    if (els['warning-text']) els['warning-text'].textContent = text;
  }

  function setFireIndicator(firing) {
    if (els['fire-indicator']) {
      els['fire-indicator'].textContent = firing ? '● FIRING' : '';
    }
  }

  function addKillFeed(text, friendly = false) {
    if (!killFeedEl) return;
    const entry = document.createElement('div');
    entry.className = `kill-entry${friendly ? ' friendly' : ''}`;
    entry.textContent = text;
    killFeedEl.appendChild(entry);
    setTimeout(() => {
      if (killFeedEl.contains(entry)) killFeedEl.removeChild(entry);
    }, 3200);
    // Keep max 5 entries
    while (killFeedEl.children.length > 5) {
      killFeedEl.removeChild(killFeedEl.firstChild);
    }
  }

  function showRadio(text, duration = 4000) {
    if (!radioPopupEl) return;
    radioPopupEl.textContent = text;
    radioPopupEl.classList.add('visible');
    if (radioTimeout) clearTimeout(radioTimeout);
    radioTimeout = setTimeout(() => {
      radioPopupEl.classList.remove('visible');
    }, duration);
  }

  function clearMissionObjectivePopupTimers() {
    if (missionObjectivePopupIntroTimer) {
      clearTimeout(missionObjectivePopupIntroTimer);
      missionObjectivePopupIntroTimer = null;
    }
    if (missionObjectivePopupOutroTimer) {
      clearTimeout(missionObjectivePopupOutroTimer);
      missionObjectivePopupOutroTimer = null;
    }
    if (missionObjectivePopupHideTimer) {
      clearTimeout(missionObjectivePopupHideTimer);
      missionObjectivePopupHideTimer = null;
    }
  }

  function showMissionObjective(text, duration = 2600) {
    if (!missionObjectivePopupEl || !missionObjectivePopupTextEl) return;
    const objectiveText = String(text || '').trim();
    if (!objectiveText) return;

    clearMissionObjectivePopupTimers();
    missionObjectivePopupTextEl.textContent = objectiveText;
    missionObjectivePopupEl.classList.remove('visible', 'glitch-pre', 'glitch-out');
    void missionObjectivePopupEl.offsetWidth;
    missionObjectivePopupEl.classList.add('visible', 'glitch-pre');

    missionObjectivePopupIntroTimer = setTimeout(() => {
      missionObjectivePopupEl.classList.remove('glitch-pre');
      missionObjectivePopupIntroTimer = null;
    }, 220);

    missionObjectivePopupOutroTimer = setTimeout(() => {
      missionObjectivePopupEl.classList.add('glitch-out');
      missionObjectivePopupOutroTimer = null;
    }, 220 + Math.max(0, duration));

    missionObjectivePopupHideTimer = setTimeout(() => {
      missionObjectivePopupEl.classList.remove('visible', 'glitch-out');
      missionObjectivePopupHideTimer = null;
    }, 440 + Math.max(0, duration));
  }

  function showSpeakerPortrait(imageSrc) {
    if (!speakerPortraitEl || !speakerPortraitImageEl || !imageSrc) return;
    if (speakerPortraitGlitchTimer) clearTimeout(speakerPortraitGlitchTimer);
    if (speakerPortraitHideTimer) clearTimeout(speakerPortraitHideTimer);
    speakerPortraitHideTimer = null;
    speakerPortraitEl.style.opacity = '1';
    speakerPortraitEl.style.transform = 'translate3d(0, -50%, 0)';
    speakerPortraitImageEl.style.visibility = 'hidden';
    speakerPortraitImageEl.style.backgroundImage = `url("${imageSrc}")`;
    speakerPortraitEl.classList.remove('glitch-out', 'has-image');
    speakerPortraitEl.classList.add('visible', 'glitch-pre');
    speakerPortraitGlitchTimer = setTimeout(() => {
      speakerPortraitEl.classList.remove('glitch-pre');
      speakerPortraitEl.classList.add('has-image');
      speakerPortraitImageEl.style.visibility = 'visible';
      speakerPortraitGlitchTimer = null;
    }, 220);
  }

  function hideSpeakerPortrait() {
    if (!speakerPortraitEl) return;
    if (speakerPortraitGlitchTimer) clearTimeout(speakerPortraitGlitchTimer);
    if (speakerPortraitHideTimer) clearTimeout(speakerPortraitHideTimer);
    if (!speakerPortraitEl.classList.contains('visible')) {
      speakerPortraitEl.classList.remove('glitch-pre', 'glitch-out', 'has-image');
      return;
    }
    speakerPortraitEl.classList.remove('glitch-pre', 'has-image');
    speakerPortraitEl.classList.add('glitch-out');
    speakerPortraitEl.style.opacity = '0';
    speakerPortraitEl.style.transform = 'translate3d(10px, -50%, 0)';
    speakerPortraitImageEl.style.visibility = 'hidden';
    speakerPortraitHideTimer = setTimeout(() => {
      speakerPortraitEl.classList.remove('visible', 'glitch-out');
      speakerPortraitImageEl.style.backgroundImage = '';
      speakerPortraitHideTimer = null;
    }, 220);
  }

  function spawnDamageFloat(screenX, screenY, amount, friendly = false) {
    const el = document.createElement('div');
    el.className = `damage-float${friendly ? ' friendly' : ''}`;
    el.textContent = `-${Math.round(amount)}`;
    el.style.left = `${screenX}px`;
    el.style.top  = `${screenY}px`;
    document.body.appendChild(el);
    setTimeout(() => {
      if (document.body.contains(el)) document.body.removeChild(el);
    }, 1300);
  }

  function updateTargetIdentification(data) {
    if (!targetIdentificationEl || !targetIdentificationBoxEl || !targetIdentificationStatusEl || !targetIdentificationTypeEl) return;

    targetIdentificationEl.classList.remove('friendly', 'hostile', 'pending', 'hidden');
    targetIdentificationEl.classList.add(data.state || 'pending');
    targetIdentificationEl.classList.remove('align-left', 'align-right');
    targetIdentificationEl.classList.add(data.align === 'left' ? 'align-left' : 'align-right');
    targetIdentificationEl.style.left = `${data.x}px`;
    targetIdentificationEl.style.top = `${data.y}px`;
    targetIdentificationEl.style.setProperty('--target-box-size', `${data.boxSize || 52}px`);

    targetIdentificationStatusEl.textContent = data.statusText || '';
    targetIdentificationTypeEl.textContent = data.typeText || '';
    targetIdentificationTypeEl.style.display = data.typeText ? 'block' : 'none';
  }

  function clearTargetIdentification() {
    if (!targetIdentificationEl) return;
    targetIdentificationEl.classList.remove('friendly', 'hostile', 'pending');
    targetIdentificationEl.classList.add('hidden');
    targetIdentificationStatusEl.textContent = '';
    targetIdentificationTypeEl.textContent = '';
  }

  function updateCrosshairLock(data) {
    if (!crosshairLockEl || !crosshairLockTextEl) return;
    crosshairLockEl.classList.remove('hidden', 'searching', 'locking', 'locked');
    crosshairLockEl.classList.add(data.state || 'searching');
    crosshairLockTextEl.textContent = data.text || '';
  }

  function clearCrosshairLock() {
    if (!crosshairLockEl || !crosshairLockTextEl) return;
    crosshairLockEl.classList.remove('searching', 'locking', 'locked');
    crosshairLockEl.classList.add('hidden');
    crosshairLockTextEl.textContent = '';
  }

  function _getOrCreateProjectileGlare(projectile) {
    let glareEl = projectileGlareEls.get(projectile);
    if (glareEl) return glareEl;

    glareEl = document.createElement('div');
    glareEl.className = 'projectile-glare';

    const streakEl = document.createElement('div');
    streakEl.className = 'projectile-glare-streak';
    glareEl.appendChild(streakEl);

    const haloEl = document.createElement('div');
    haloEl.className = 'projectile-glare-halo';
    glareEl.appendChild(haloEl);

    const coreEl = document.createElement('div');
    coreEl.className = 'projectile-glare-core';
    glareEl.appendChild(coreEl);

    const ghostNearEl = document.createElement('div');
    ghostNearEl.className = 'projectile-glare-ghost projectile-glare-ghost-near';
    glareEl.appendChild(ghostNearEl);

    const ghostFarEl = document.createElement('div');
    ghostFarEl.className = 'projectile-glare-ghost projectile-glare-ghost-far';
    glareEl.appendChild(ghostFarEl);

    projectileGlareLayerEl.appendChild(glareEl);
    projectileGlareEls.set(projectile, glareEl);
    return glareEl;
  }

  function clearProjectileGlares() {
    projectileGlareEls.forEach(glareEl => {
      if (glareEl.parentNode) glareEl.parentNode.removeChild(glareEl);
    });
    projectileGlareEls.clear();
  }

  function _getShockwaveOuterRadius(explosionSize) {
    const expectedScaleMult = explosionSize >= 2
      ? 0.75
      : (0.25 + (explosionSize * 0.3 + 0.2)) * 0.5;
    return 0.55 * (1 + expectedScaleMult);
  }

  function spawnExplosionGlare(x, y, z, weaponId, explosionSize, options = {}) {
    if (!explosionGlareLayerEl || !explosionScreenFlareLayerEl) return;

    const sizeScale = options.sizeScale !== undefined ? options.sizeScale : 1;
    const opacityScale = options.opacityScale !== undefined ? options.opacityScale : 1;

    const cssClass = weaponId === 4
      ? 'explosion-glare-105mm'
      : weaponId === 6
        ? 'explosion-glare-missile'
        : 'explosion-glare-40mm';
    const fixedScreenFlareSize = (weaponId === 4
      ? 210
      : weaponId === 6
        ? 290
        : 180) * sizeScale;

    const glareEl = document.createElement('div');
    glareEl.className = 'explosion-glare';

    const streakEl = document.createElement('div');
    streakEl.className = 'explosion-glare-streak';
    glareEl.appendChild(streakEl);

    const haloEl = document.createElement('div');
    haloEl.className = 'explosion-glare-halo';
    glareEl.appendChild(haloEl);

    const coreEl = document.createElement('div');
    coreEl.className = 'explosion-glare-core';
    glareEl.appendChild(coreEl);

    const ghostNearEl = document.createElement('div');
    ghostNearEl.className = 'explosion-glare-ghost explosion-glare-ghost-near';
    glareEl.appendChild(ghostNearEl);

    const ghostFarEl = document.createElement('div');
    ghostFarEl.className = 'explosion-glare-ghost explosion-glare-ghost-far';
    glareEl.appendChild(ghostFarEl);

    const screenFlareEl = document.createElement('div');
    screenFlareEl.className = 'explosion-screen-flare';

    const screenBloomEl = document.createElement('div');
    screenBloomEl.className = 'explosion-screen-flare-bloom';
    screenFlareEl.appendChild(screenBloomEl);

    const screenStreakEl = document.createElement('div');
    screenStreakEl.className = 'explosion-screen-flare-streak';
    screenFlareEl.appendChild(screenStreakEl);

    const screenGhostNearEl = document.createElement('div');
    screenGhostNearEl.className = 'explosion-screen-flare-ghost explosion-screen-flare-ghost-near';
    screenFlareEl.appendChild(screenGhostNearEl);

    const screenGhostFarEl = document.createElement('div');
    screenGhostFarEl.className = 'explosion-screen-flare-ghost explosion-screen-flare-ghost-far';
    screenFlareEl.appendChild(screenGhostFarEl);

    explosionGlareLayerEl.appendChild(glareEl);
    explosionScreenFlareLayerEl.appendChild(screenFlareEl);
    explosionGlares.push({
      x,
      y,
      z,
      age: 0,
      maxAge: 0.4,
      flickerOffset: Math.random() * Math.PI * 2,
      shockwaveRadius: _getShockwaveOuterRadius(explosionSize || 3) * sizeScale,
      baseOpacity: (weaponId === 4 ? 0.8 : weaponId === 6 ? 0.66 : 0.46) * opacityScale,
      cssClass,
      fixedScreenFlareSize,
      el: glareEl,
      screenEl: screenFlareEl
    });
  }

  function clearExplosionGlares() {
    explosionGlares.forEach(glare => {
      if (glare.el && glare.el.parentNode) glare.el.parentNode.removeChild(glare.el);
      if (glare.screenEl && glare.screenEl.parentNode) glare.screenEl.parentNode.removeChild(glare.screenEl);
    });
    explosionGlares = [];
  }

  function updateProjectileGlares(projectiles, camera, time) {
    if (!projectileGlareLayerEl || !camera) return;

    const activeProjectiles = new Set();
    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;
    const farFadeStart = 120;
    const farFadeEnd = 320;

    (projectiles || []).forEach(projectile => {
      if (!projectile || !projectile.alive) return;
      if (projectile.specialType !== 'missile' && projectile.specialType !== 'clusterCarrier') return;

      _projectileScreenPos.set(projectile.x, projectile.y, projectile.z).project(camera);
      if (_projectileScreenPos.z < -1 || _projectileScreenPos.z > 1) return;

      const screenX = (_projectileScreenPos.x * 0.5 + 0.5) * viewportW;
      const screenY = (-_projectileScreenPos.y * 0.5 + 0.5) * viewportH;
      if (screenX < -60 || screenX > viewportW + 60 || screenY < -60 || screenY > viewportH + 60) return;

      const glareEl = _getOrCreateProjectileGlare(projectile);
      activeProjectiles.add(projectile);

      const isMissile = projectile.specialType === 'missile';
      const cameraDist = camera.position.distanceTo(projectile.mesh.position);
      const distanceFade = 1 - Utils.clamp((cameraDist - farFadeStart) / (farFadeEnd - farFadeStart), 0, 1);
      if (distanceFade <= 0.01) {
        glareEl.classList.add('hidden');
        return;
      }

      const flicker = 0.82 + Math.sin(time * 42 + (projectile.glarePulseOffset || 0)) * 0.18;
      const opacity = distanceFade * flicker * (isMissile ? 0.95 : 0.8);
      const size = isMissile ? 54 : 42;

      glareEl.classList.remove('hidden', 'projectile-glare-missile', 'projectile-glare-cluster');
      glareEl.classList.add(isMissile ? 'projectile-glare-missile' : 'projectile-glare-cluster');
      glareEl.style.left = `${screenX}px`;
      glareEl.style.top = `${screenY}px`;
      glareEl.style.width = `${size}px`;
      glareEl.style.height = `${size}px`;
      glareEl.style.opacity = opacity.toFixed(3);
      glareEl.style.setProperty('--projectile-flare-angle', `${(time * 65 + (projectile.glarePulseOffset || 0) * 18) % 360}deg`);
      glareEl.style.setProperty('--projectile-flare-streak-opacity', (isMissile ? opacity * 0.72 : opacity * 0.55).toFixed(3));
      glareEl.style.setProperty('--projectile-flare-ghost-opacity', (isMissile ? opacity * 0.48 : opacity * 0.36).toFixed(3));
    });

    projectileGlareEls.forEach((glareEl, projectile) => {
      if (activeProjectiles.has(projectile)) return;
      if (glareEl.parentNode) glareEl.parentNode.removeChild(glareEl);
      projectileGlareEls.delete(projectile);
    });
  }

  function updateExplosionGlares(dt, camera, time) {
    if (!explosionGlareLayerEl || !camera) return;

    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;

    explosionGlares = explosionGlares.filter(glare => {
      glare.age += dt;
      if (glare.age >= glare.maxAge) {
        if (glare.el.parentNode) glare.el.parentNode.removeChild(glare.el);
        if (glare.screenEl && glare.screenEl.parentNode) glare.screenEl.parentNode.removeChild(glare.screenEl);
        return false;
      }

      _projectileScreenPos.set(glare.x, glare.y, glare.z).project(camera);
      if (_projectileScreenPos.z < -1 || _projectileScreenPos.z > 1) {
        glare.el.classList.add('hidden');
        if (glare.screenEl) glare.screenEl.classList.add('hidden');
        return true;
      }

      const screenX = (_projectileScreenPos.x * 0.5 + 0.5) * viewportW;
      const screenY = (-_projectileScreenPos.y * 0.5 + 0.5) * viewportH;
      if (screenX < -140 || screenX > viewportW + 140 || screenY < -140 || screenY > viewportH + 140) {
        glare.el.classList.add('hidden');
        if (glare.screenEl) glare.screenEl.classList.add('hidden');
        return true;
      }

      _projectileScreenPosEdge
        .set(glare.x + glare.shockwaveRadius, glare.y, glare.z)
        .project(camera);
      const edgeScreenX = (_projectileScreenPosEdge.x * 0.5 + 0.5) * viewportW;
      const projectedRadius = Math.max(2, Math.abs(edgeScreenX - screenX));
      const glareSize = projectedRadius * 2;
      const centerDx = (viewportW * 0.5) - screenX;
      const centerDy = (viewportH * 0.5) - screenY;
      const centerLen = Math.hypot(centerDx, centerDy) || 1;
      const axisX = centerDx / centerLen;
      const axisY = centerDy / centerLen;

      const t = glare.age / glare.maxAge;
      const envelope = Math.sin(Math.PI * t);
      const flicker = 0.3 + Math.sin(time * 96 + glare.flickerOffset) * 0.2;
      glare.el.classList.remove('hidden', 'explosion-glare-40mm', 'explosion-glare-105mm', 'explosion-glare-missile');
      glare.el.classList.add(glare.cssClass);
      glare.el.style.left = `${screenX}px`;
      glare.el.style.top = `${screenY}px`;
      glare.el.style.width = `${glareSize.toFixed(2)}px`;
      glare.el.style.height = `${glareSize.toFixed(2)}px`;
      glare.el.style.opacity = (glare.baseOpacity * envelope * flicker).toFixed(3);
      glare.el.style.setProperty('--explosion-flare-angle', `${Math.atan2(axisY, axisX)}rad`);
      glare.el.style.setProperty('--explosion-flare-streak-opacity', (glare.baseOpacity * envelope * flicker * 0.85).toFixed(3));
      glare.el.style.setProperty('--explosion-flare-ghost-opacity', (glare.baseOpacity * envelope * flicker * 0.48).toFixed(3));
      glare.el.style.setProperty('--explosion-ghost-near-x', `${(axisX * glareSize * 0.95).toFixed(2)}px`);
      glare.el.style.setProperty('--explosion-ghost-near-y', `${(axisY * glareSize * 0.95).toFixed(2)}px`);
      glare.el.style.setProperty('--explosion-ghost-far-x', `${(-axisX * glareSize * 1.35).toFixed(2)}px`);
      glare.el.style.setProperty('--explosion-ghost-far-y', `${(-axisY * glareSize * 1.35).toFixed(2)}px`);

      if (glare.screenEl) {
        const screenSize = glare.fixedScreenFlareSize || 72;
        const screenOpacity = glare.baseOpacity * envelope * flicker * 1.15;
        const nearOffset = screenSize * 1.9;
        const farOffset = screenSize * 2.7;
        glare.screenEl.classList.remove('hidden', 'explosion-glare-40mm', 'explosion-glare-105mm', 'explosion-glare-missile');
        glare.screenEl.classList.add(glare.cssClass);
        glare.screenEl.style.opacity = screenOpacity.toFixed(3);
        glare.screenEl.style.setProperty('--screen-flare-x', `${screenX.toFixed(2)}px`);
        glare.screenEl.style.setProperty('--screen-flare-y', `${screenY.toFixed(2)}px`);
        glare.screenEl.style.setProperty('--screen-flare-angle', `${Math.atan2(axisY, axisX)}rad`);
        glare.screenEl.style.setProperty('--screen-flare-size', `${screenSize.toFixed(2)}px`);
        glare.screenEl.style.setProperty('--screen-flare-streak-opacity', (screenOpacity * 0.88).toFixed(3));
        glare.screenEl.style.setProperty('--screen-flare-ghost-opacity', (screenOpacity * 0.45).toFixed(3));
        glare.screenEl.style.setProperty('--screen-flare-near-x', `${(axisX * nearOffset).toFixed(2)}px`);
        glare.screenEl.style.setProperty('--screen-flare-near-y', `${(axisY * nearOffset).toFixed(2)}px`);
        glare.screenEl.style.setProperty('--screen-flare-far-x', `${(-axisX * farOffset).toFixed(2)}px`);
        glare.screenEl.style.setProperty('--screen-flare-far-y', `${(-axisY * farOffset).toFixed(2)}px`);
      }
      return true;
    });
  }

  function showGameOver(score, kills, friendliesLost, time, failed = false, options = {}) {
    const screen  = document.getElementById('gameover-screen');
    const titleEl = document.getElementById('gameover-title');
    const scoreEl = document.getElementById('gameover-score');
    const statsEl = document.getElementById('gameover-stats');
    const primaryBtn = document.getElementById('restart-btn');
    if (screen)  screen.style.display  = 'flex';
    if (titleEl) titleEl.textContent   = failed ? 'MISSION FAILED' : 'MISSION COMPLETE';
    if (scoreEl) scoreEl.textContent   = `MISSION PRESTIGE: ${score.toLocaleString()}`;
    if (primaryBtn) primaryBtn.textContent = options.primaryButtonText || (failed ? 'RETRY MISSION' : 'NEXT MISSION');
    if (statsEl) {
      const timeLine = typeof time === 'number' && Number.isFinite(time)
        ? `TIME ON STATION: ${Math.floor(time / 60)}m ${Math.floor(time % 60)}s`
        : 'TIME ON STATION: --';
      statsEl.innerHTML =
        `HOSTILES NEUTRALIZED: ${kills}<br>` +
        `FRIENDLY CASUALTIES: ${friendliesLost}<br>` +
        timeLine;
    }
  }

  function hideGameOver() {
    const screen = document.getElementById('gameover-screen');
    if (screen) screen.style.display = 'none';
  }

  return {
    init, updateCoords, updateAlt, updateTime,
    updateFps,
    updateScore, updateObjective, updateWeapons, updateCounts,
    setWarning, setFireIndicator,
    addKillFeed, showRadio, showMissionObjective, showSpeakerPortrait, hideSpeakerPortrait, spawnDamageFloat,
    updateTargetIdentification, clearTargetIdentification,
    updateProjectileGlares, clearProjectileGlares,
    spawnExplosionGlare, updateExplosionGlares, clearExplosionGlares,
    updateCrosshairLock, clearCrosshairLock,
    showGameOver, hideGameOver
  };
})();
