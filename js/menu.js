/* =============================================
   MENU.JS — Main menu, missions, settings, controls, mobile controls
   ============================================= */
'use strict';

const MenuSystem = (() => {
  const MENU_SCREEN_IDS = ['main-menu', 'missions-screen', 'loadout-screen', 'settings-screen', 'controls-screen', 'unit-editor-screen'];
  const VIBEJAM_WIDGET_SRC = 'https://vibej.am/2026/widget.js';

  // ---- Quality setting ----
  let quality = 'high';
  let qualityLoaded = false;
  const qualityListeners = [];
  const QUALITY_PROFILES = {
    low: {
      particleMultiplier: 0.25,
      renderScale: 0.55,
      maxPixelRatio: 1.0,
      thermalScale: 0.50,
      tiltShiftMultiplier: 0.0,
      windowMultiplier: 0.45,
      rockCount: 8,
      vegetationCount: 56
    },
    medium: {
      particleMultiplier: 0.5,
      renderScale: 0.75,
      maxPixelRatio: 1.25,
      thermalScale: 0.75,
      tiltShiftMultiplier: 0.4,
      windowMultiplier: 0.7,
      rockCount: 12,
      vegetationCount: 70
    },
    high: {
      particleMultiplier: 1.0,
      renderScale: 1.0,
      maxPixelRatio: 1.5,
      thermalScale: 1.0,
      tiltShiftMultiplier: 1.0,
      windowMultiplier: 1.0,
      rockCount: 18,
      vegetationCount: 80
    }
  };
  const MOBILE_QUALITY_OVERRIDES = {
    low: {
      particleMultiplier: 0.16,
      renderScale: 0.38,
      maxPixelRatio: 0.85,
      thermalScale: 0.28,
      tiltShiftMultiplier: 0.0,
      windowMultiplier: 0.22,
      rockCount: 4,
      vegetationCount: 26
    },
    medium: {
      particleMultiplier: 0.3,
      renderScale: 0.52,
      maxPixelRatio: 1.0,
      thermalScale: 0.4,
      tiltShiftMultiplier: 0.12,
      windowMultiplier: 0.38,
      rockCount: 7,
      vegetationCount: 38
    },
    high: {
      particleMultiplier: 0.65,
      renderScale: 0.68,
      maxPixelRatio: 1.15,
      thermalScale: 0.56,
      tiltShiftMultiplier: 0.4,
      windowMultiplier: 0.62,
      rockCount: 10,
      vegetationCount: 50
    }
  };
  let _canResume = false;
  let _canReturnToEditor = false;
  let _onEndMission = null;
  let _onReturnToEditor = null;
  let _loadoutSelectedSlot = 1;
  let _loadoutStatusTimer = null;
  let _mobileControlsBound = false;
  let _mobileOnFireStart = null;
  let _mobileOnFireEnd = null;
  let _mobileOnWeaponSelect = null;
  let _widgetLoadHandle = null;
  let _widgetLoadMode = null;
  let _widgetScriptLoaded = false;
  let _widgetObserver = null;
  const _widgetNodes = new Set();

  function isCoarsePointerDevice() {
    return typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(pointer: coarse)').matches;
  }

  function isMenuVisible() {
    return typeof document !== 'undefined' && document.body.classList.contains('menu-open');
  }

  function updateWidgetVisibility(visible) {
    _widgetNodes.forEach(node => {
      if (!(node instanceof HTMLElement) || !node.isConnected) return;
      node.hidden = !visible;
    });
  }

  function ensureWidgetObserver() {
    if (_widgetObserver || typeof MutationObserver === 'undefined' || typeof document === 'undefined') return;

    _widgetObserver = new MutationObserver(mutations => {
      mutations.forEach(mutation => {
        mutation.addedNodes.forEach(node => {
          if (!(node instanceof HTMLElement)) return;
          if (node.parentElement !== document.body) return;
          if (node.id === 'vibejam-widget-script') return;
          _widgetNodes.add(node);
          node.dataset.vibejamOwned = 'true';
          node.hidden = !isMenuVisible();
        });
      });
    });

    _widgetObserver.observe(document.body, { childList: true });
  }

  function clearWidgetLoadHandle() {
    if (_widgetLoadHandle === null) return;
    if (_widgetLoadMode === 'idle' && typeof window.cancelIdleCallback === 'function') {
      window.cancelIdleCallback(_widgetLoadHandle);
    } else {
      clearTimeout(_widgetLoadHandle);
    }
    _widgetLoadHandle = null;
    _widgetLoadMode = null;
  }

  function loadWidget() {
    clearWidgetLoadHandle();
    if (_widgetScriptLoaded || !isMenuVisible() || typeof document === 'undefined') return;
    if (document.getElementById('vibejam-widget-script')) return;

    ensureWidgetObserver();

    const script = document.createElement('script');
    script.id = 'vibejam-widget-script';
    script.async = true;
    script.src = VIBEJAM_WIDGET_SRC;
    script.onload = () => {
      _widgetScriptLoaded = true;
      updateWidgetVisibility(true);
    };
    script.onerror = () => {
      const existing = document.getElementById('vibejam-widget-script');
      if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
    };
    document.body.appendChild(script);
  }

  function scheduleWidgetLoad() {
    if (_widgetScriptLoaded || _widgetLoadHandle !== null || !isMenuVisible()) return;

    const runLoad = () => loadWidget();
    if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
      _widgetLoadMode = 'idle';
      _widgetLoadHandle = window.requestIdleCallback(runLoad, { timeout: 4000 });
      return;
    }

    _widgetLoadMode = 'timeout';
    _widgetLoadHandle = window.setTimeout(runLoad, 2500);
  }

  function getRecommendedInitialQuality() {
    const width = typeof window !== 'undefined' ? window.innerWidth || 0 : 0;
    const height = typeof window !== 'undefined' ? window.innerHeight || 0 : 0;
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;

    if (isCoarsePointerDevice()) {
      return dpr > 1 || (width * height) > 700000 ? 'low' : 'medium';
    }

    return dpr > 1 || (width * height) > 1200000 ? 'medium' : 'high';
  }

  function ensureQualityLoaded() {
    if (qualityLoaded) return;
    qualityLoaded = true;

    try {
      const saved = localStorage.getItem('ac130_quality');
      if (saved && QUALITY_PROFILES[saved] !== undefined) {
        quality = saved;
        return;
      }
    } catch (_) {}

    quality = getRecommendedInitialQuality();
    try { localStorage.setItem('ac130_quality', quality); } catch (_) {}
  }

  function getQualityProfile() {
    ensureQualityLoaded();
    const baseProfile = QUALITY_PROFILES[quality] || QUALITY_PROFILES.high;
    if (!isCoarsePointerDevice()) return baseProfile;
    const mobileOverride = MOBILE_QUALITY_OVERRIDES[quality];
    return mobileOverride ? { ...baseProfile, ...mobileOverride } : baseProfile;
  }

  function getParticleMultiplier() {
    return getQualityProfile().particleMultiplier;
  }

  function getQuality() {
    ensureQualityLoaded();
    return quality;
  }

  function onQualityChange(cb) {
    if (typeof cb !== 'function') return () => {};
    qualityListeners.push(cb);
    return () => {
      const idx = qualityListeners.indexOf(cb);
      if (idx >= 0) qualityListeners.splice(idx, 1);
    };
  }

  function setQuality(q) {
    if (QUALITY_PROFILES[q] === undefined || q === quality) return;
    qualityLoaded = true;
    quality = q;
    try { localStorage.setItem('ac130_quality', q); } catch(_) {}
    document.querySelectorAll('.quality-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.quality === q);
    });
    qualityListeners.forEach(listener => {
      try { listener(q); } catch (_) {}
    });
  }

  // ---- Screen management ----

  function setLoadoutStatus(text, isError = false) {
    const el = document.getElementById('loadout-status');
    if (!el) return;
    el.textContent = text || '';
    el.classList.toggle('error', !!isError);
    if (_loadoutStatusTimer) clearTimeout(_loadoutStatusTimer);
    if (text) {
      _loadoutStatusTimer = setTimeout(() => {
        el.textContent = '';
        el.classList.remove('error');
      }, 2200);
    }
  }

  function refreshMobileWeaponBar() {
    document.querySelectorAll('.mob-weapon-btn').forEach((btn, index) => {
      const slot = index + 1;
      const weapon = typeof WeaponsSystem !== 'undefined' && WeaponsSystem.getWeaponBySlot
        ? WeaponsSystem.getWeaponBySlot(slot)
        : null;
      btn.dataset.weapon = String(slot);
      const numEl = btn.querySelector('.mob-wep-num');
      const nameEl = btn.querySelector('.mob-wep-name');
      if (numEl) numEl.textContent = String(slot);
      if (nameEl) nameEl.textContent = weapon ? (weapon.shortName || weapon.name) : '---';
    });
  }

  function updateMobileWeaponButtons(weapons, currentId) {
    document.querySelectorAll('.mob-weapon-btn').forEach((btn, index) => {
      const slot = index + 1;
      const weapon = weapons ? weapons[slot] : null;
      const progress = weapon && (weapon.reloading || weapon.overheated)
        ? `${(Utils.clamp(weapon.reloadProgress || 0, 0, 1) * 100).toFixed(1)}%`
        : '0%';

      btn.classList.toggle('active', slot === currentId);
      btn.classList.toggle('reloading', !!weapon && !!weapon.reloading);
      btn.classList.toggle('overheated', !!weapon && !!weapon.overheated);
      btn.classList.toggle('empty', !!weapon && weapon.ammo === 0 && !weapon.reloading && !weapon.overheated);
      btn.classList.toggle('disabled', !weapon);
      btn.style.setProperty('--mob-progress', progress);

      if (!weapon) return;

      const nameEl = btn.querySelector('.mob-wep-name');
      if (nameEl) nameEl.textContent = weapon.shortName || weapon.name;
    });
  }

  function renderLoadoutScreen() {
    if (_canResume || typeof WeaponsSystem === 'undefined') return;

    const prestigeEl = document.getElementById('loadout-prestige');
    const listEl = document.getElementById('loadout-weapon-list');
    const summaryEl = document.getElementById('loadout-slot-summary');

    if (prestigeEl && WeaponsSystem.getPrestige) {
      prestigeEl.textContent = `TOTAL PRESTIGE: ${WeaponsSystem.getPrestige().toLocaleString()}`;
    }

    if (summaryEl) {
      summaryEl.innerHTML = '';
      for (let slot = 1; slot <= 3; slot++) {
        const weapon = WeaponsSystem.getWeaponBySlot(slot);
        const entry = document.createElement('div');
        entry.className = `loadout-slot-summary-card${slot === _loadoutSelectedSlot ? ' active' : ''}`;
        entry.innerHTML = `
          <div class="loadout-slot-summary-label">ACTIVE SLOT ${slot}</div>
          <div class="loadout-slot-summary-name">${weapon ? weapon.name : 'UNASSIGNED'}</div>
        `;
        entry.addEventListener('click', () => {
          _loadoutSelectedSlot = slot;
          renderLoadoutScreen();
        });
        summaryEl.appendChild(entry);
      }
    }

    if (listEl) {
      listEl.innerHTML = '';
      WeaponsSystem.getCatalog().sort((a, b) => a.id - b.id).forEach(weapon => {
        const card = document.createElement('div');
        card.className = `loadout-weapon-card${weapon.equippedSlot ? ' equipped' : ''}${weapon.owned ? ' owned' : ' locked'}`;

        const action = document.createElement('button');
        action.className = 'loadout-action-btn';

        if (!weapon.owned) {
          action.textContent = `BUY · ${weapon.prestigeCost}`;
          action.addEventListener('click', () => {
            const result = WeaponsSystem.buyWeapon(weapon.id);
            if (!result.ok) {
              setLoadoutStatus('Not enough prestige for that weapon.', true);
              return;
            }
            WeaponsSystem.equipWeapon(_loadoutSelectedSlot, weapon.id);
            setLoadoutStatus(`${weapon.name} purchased and equipped.`);
            refreshMobileWeaponBar();
            renderLoadoutScreen();
          });
        } else if (weapon.equippedSlot === _loadoutSelectedSlot) {
          action.textContent = 'EQUIPPED';
          action.disabled = true;
        } else {
          action.textContent = weapon.equippedSlot
            ? `MOVE TO SLOT ${_loadoutSelectedSlot}`
            : `EQUIP TO SLOT ${_loadoutSelectedSlot}`;
          action.addEventListener('click', () => {
            WeaponsSystem.equipWeapon(_loadoutSelectedSlot, weapon.id);
            setLoadoutStatus(`${weapon.name} assigned to slot ${_loadoutSelectedSlot}.`);
            refreshMobileWeaponBar();
            renderLoadoutScreen();
          });
        }

        card.innerHTML = `
          <div class="loadout-weapon-top">
            <div>
              <div class="loadout-weapon-name">${weapon.name}</div>
              <div class="loadout-weapon-copy">${weapon.description || ''}</div>
            </div>
            <div class="loadout-weapon-meta">${weapon.owned ? (weapon.equippedSlot ? `SLOT ${weapon.equippedSlot}` : 'OWNED') : `${weapon.prestigeCost} PRESTIGE`}</div>
          </div>
        `;
        card.appendChild(action);
        listEl.appendChild(card);
      });
    }
  }

  function showScreen(id) {
    if (id === 'loadout-screen' && _canResume) id = 'main-menu';
    MENU_SCREEN_IDS.forEach(sid => {
      const el = document.getElementById(sid);
      if (el) el.style.display = sid === id ? 'flex' : 'none';
    });
    document.body.classList.add('menu-open');
    updateWidgetVisibility(true);
    scheduleWidgetLoad();
    if (typeof AudioSystem !== 'undefined' && AudioSystem.enableMenuMusic) {
      AudioSystem.enableMenuMusic();
    }
    if (id === 'loadout-screen') {
      refreshMobileWeaponBar();
      renderLoadoutScreen();
    }
  }

  function hideAllMenus() {
    MENU_SCREEN_IDS.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
    document.body.classList.remove('menu-open');
    clearWidgetLoadHandle();
    updateWidgetVisibility(false);
    if (typeof AudioSystem !== 'undefined' && AudioSystem.disableMenuMusic) {
      AudioSystem.disableMenuMusic();
    }
  }

  // ---- Mobile controls ----

  // Joystick state exposed for game.js to read
  const joystick = { active: false, dx: 0, dy: 0, normX: 0, normY: 0 };

  function initMobileControls(onFireStart, onFireEnd, onWeaponSelect) {
    const mobileEl = document.getElementById('mobile-controls');
    if (!mobileEl) return;

    _mobileOnFireStart = onFireStart;
    _mobileOnFireEnd = onFireEnd;
    _mobileOnWeaponSelect = onWeaponSelect;
    refreshMobileWeaponBar();

    if (_mobileControlsBound) return;
    _mobileControlsBound = true;

    // Joystick
    const jZone  = document.getElementById('joystick-zone');
    const jThumb = document.getElementById('joystick-thumb');
    const RADIUS = 55; // max pixels from center
    let jBaseX = 0, jBaseY = 0;
    let jTouchId = null;

    function getJCenter() {
      const r = jZone.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }

    function moveThumb(cx, cy, tx, ty) {
      let dx = tx - cx;
      let dy = ty - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > RADIUS) {
        dx = dx / dist * RADIUS;
        dy = dy / dist * RADIUS;
      }
      jThumb.style.left = (50 + (dx / RADIUS) * 50) + '%';
      jThumb.style.top  = (50 + (dy / RADIUS) * 50) + '%';
      joystick.dx    = dx / RADIUS;
      joystick.dy    = dy / RADIUS;
      joystick.normX = dx / RADIUS;
      joystick.normY = dy / RADIUS;
      joystick.active = true;
    }

    function resetThumb() {
      jThumb.style.left = '50%';
      jThumb.style.top  = '50%';
      joystick.dx = 0; joystick.dy = 0;
      joystick.normX = 0; joystick.normY = 0;
      joystick.active = false;
    }

    jZone.addEventListener('touchstart', e => {
      e.preventDefault();
      e.stopPropagation();
      const t = e.changedTouches[0];
      jTouchId = t.identifier;
      const c = getJCenter();
      moveThumb(c.x, c.y, t.clientX, t.clientY);
    }, { passive: false });

    jZone.addEventListener('touchmove', e => {
      e.preventDefault();
      e.stopPropagation();
      for (const t of e.changedTouches) {
        if (t.identifier === jTouchId) {
          const c = getJCenter();
          moveThumb(c.x, c.y, t.clientX, t.clientY);
        }
      }
    }, { passive: false });

    jZone.addEventListener('touchend', e => {
      e.preventDefault();
      e.stopPropagation();
      for (const t of e.changedTouches) {
        if (t.identifier === jTouchId) {
          jTouchId = null;
          resetThumb();
        }
      }
    }, { passive: false });

    jZone.addEventListener('touchcancel', e => {
      e.preventDefault();
      e.stopPropagation();
      jTouchId = null;
      resetThumb();
    }, { passive: false });

    // Fire button
    const fireBtn = document.getElementById('mobile-fire-btn');
    if (fireBtn) {
      fireBtn.addEventListener('touchstart', e => {
        e.preventDefault();
        e.stopPropagation();
        fireBtn.classList.add('firing');
        if (_mobileOnFireStart) _mobileOnFireStart();
      }, { passive: false });

      fireBtn.addEventListener('touchend', e => {
        e.preventDefault();
        e.stopPropagation();
        fireBtn.classList.remove('firing');
        if (_mobileOnFireEnd) _mobileOnFireEnd();
      }, { passive: false });

      fireBtn.addEventListener('touchcancel', e => {
        e.preventDefault();
        e.stopPropagation();
        fireBtn.classList.remove('firing');
        if (_mobileOnFireEnd) _mobileOnFireEnd();
      }, { passive: false });
    }

    // Weapon selector
    document.querySelectorAll('.mob-weapon-btn').forEach(btn => {
      btn.addEventListener('touchstart', e => {
        e.preventDefault();
        e.stopPropagation();
        const wep = parseInt(btn.dataset.weapon, 10);
        document.querySelectorAll('.mob-weapon-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        if (_mobileOnWeaponSelect) _mobileOnWeaponSelect(wep);
      }, { passive: false });
    });
  }

  function getJoystick() { return joystick; }

  // Sync mobile weapon highlight when game changes weapon via keyboard
  function syncMobileWeapon(id) {
    refreshMobileWeaponBar();
    document.querySelectorAll('.mob-weapon-btn').forEach(b => {
      b.classList.toggle('active', parseInt(b.dataset.weapon, 10) === id);
    });
  }

  function setResumable(canResume) {
    _canResume = !!canResume;
    const btn = document.getElementById('btn-resume');
    const returnEditorBtn = document.getElementById('btn-return-editor');
    const editorBtn = document.getElementById('btn-editor');
    const unitEditorBtn = document.getElementById('btn-unit-editor');
    const loadoutBtn = document.getElementById('btn-loadout');
    const endMissionBtn = document.getElementById('btn-end-mission');
    if (btn) btn.style.display = canResume ? '' : 'none';
    if (returnEditorBtn) returnEditorBtn.style.display = (canResume && _canReturnToEditor) ? '' : 'none';
    if (editorBtn) editorBtn.style.display = canResume ? 'none' : '';
    if (unitEditorBtn) unitEditorBtn.style.display = canResume ? 'none' : '';
    if (loadoutBtn) loadoutBtn.style.display = canResume ? 'none' : '';
    if (endMissionBtn) endMissionBtn.style.display = canResume ? '' : 'none';
    if (canResume && document.getElementById('loadout-screen')?.style.display !== 'none') {
      showScreen('main-menu');
    }
  }

  function setEditorReturnable(canReturn) {
    _canReturnToEditor = !!canReturn;
    if (!_canResume) return;
    const returnEditorBtn = document.getElementById('btn-return-editor');
    if (returnEditorBtn) returnEditorBtn.style.display = _canReturnToEditor ? '' : 'none';
  }

  // ---- Mission unlock ----

  let _onMissionSelect = null;
  let _loadedDefs = [];      // mission defs loaded from missions/ folder
  let _builtInCount = 0;     // how many of the loaded defs are "built-in" (use idx-based unlock)

  function getUnlockedSet() {
    try { return new Set(JSON.parse(localStorage.getItem('ac130_unlocked') || '[0]')); }
    catch(_) { return new Set([0]); }
  }

  function unlockMission(idx) {
    const s = getUnlockedSet();
    s.add(idx);
    try { localStorage.setItem('ac130_unlocked', JSON.stringify([...s])); } catch(_) {}
    _buildMissionCards();
  }

  // Determine if a def is a "custom editor" mission (always unlocked)
  function _isCustomDef(def) {
    return def.id === 'custom'
      || (def.customUnits && def.customUnits.length > 0)
      || !!def.baseDefenceMode;
  }

  // Rebuild the entire #missions-list from _loadedDefs
  function _buildMissionCards() {
    const list = document.getElementById('missions-list');
    if (!list) return;
    list.innerHTML = '';

    _loadedDefs.forEach((def, idx) => {
      const isCustom  = _isCustomDef(def);
      const isUnlocked = true; // all missions are always unlocked
      const num = String(idx + 1).padStart(2, '0');

      const card = document.createElement('div');
      card.className = 'mission-card';
      card.dataset.mission = idx;
      card.innerHTML = `
        <div class="mc-stripe"></div>
        <div class="mc-thumb" aria-hidden="true">
          ${def.thumbnailPath ? `<img class="mc-thumb-image" src="${def.thumbnailPath}" alt="" loading="lazy" decoding="async">` : ''}
          <span class="mc-thumb-index">${num}</span>
        </div>
        <div class="mc-info">
          <div class="mc-name">${def.name || 'UNKNOWN'}</div>
          <div class="mc-desc">${def.description || ''}</div>
          <div class="mc-tag">${def.tag || (isCustom ? 'CUSTOM MISSION' : '')}</div>
        </div>
        <div class="mc-action">
          <div class="mc-status unlocked">READY</div>
          <div class="mc-launch">DEPLOY</div>
        </div>
      `;

      const thumbImage = card.querySelector('.mc-thumb-image');
      if (thumbImage) {
        thumbImage.addEventListener('error', () => {
          thumbImage.remove();
        }, { once: true });
      }

      card.addEventListener('click', () => {
        hideAllMenus();
        if (_onMissionSelect) {
          if (isCustom) {
            // Custom editor mission — pass full def object
            _onMissionSelect(def);
          } else {
            // Built-in mission — pass index so game uses startGame(idx) path
            _onMissionSelect(idx);
          }
        }
      });

      list.appendChild(card);
    });
  }

  // Fetch missions/manifest.json then fetch each listed JSON, build cards
  async function _loadMissions() {
    try {
      const manifestRes = await fetch('missions/manifest.json');
      if (!manifestRes.ok) throw new Error('manifest not found');
      const manifest = await manifestRes.json();
      const files = manifest.missions || [];

      const defs = await Promise.all(
        files.map(async (filename) => {
          try {
            const res = await fetch('missions/' + filename);
            if (!res.ok) return null;
            const def = await res.json();
            return {
              ...def,
              thumbnailPath: 'image/' + filename.replace(/\.json$/i, '.png')
            };
          } catch (_) {
            return null;
          }
        })
      );

      _loadedDefs = defs.filter(Boolean);
      _builtInCount = _loadedDefs.filter(d => !_isCustomDef(d)).length;
    } catch (_) {
      // Fallback: empty list (built-in cards from HTML if any remain)
      _loadedDefs = [];
    }
    _buildMissionCards();
  }

  // ---- Init ----

  function init(onMissionSelect, onResume, onEditor, onEndMission, onReturnToEditor) {
    _onMissionSelect = onMissionSelect;
    _onEndMission = onEndMission;
    _onReturnToEditor = onReturnToEditor;

    ensureQualityLoaded();

    // Apply saved quality to buttons
    document.querySelectorAll('.quality-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.quality === quality);
    });

    // Main menu buttons
    const btnPlay     = document.getElementById('btn-play');
    const btnLoadout  = document.getElementById('btn-loadout');
    const btnSettings = document.getElementById('btn-settings');
    const btnControls = document.getElementById('btn-controls');
    const btnUnitEditor = document.getElementById('btn-unit-editor');
    const btnEndMission = document.getElementById('btn-end-mission');
    const btnReturnEditor = document.getElementById('btn-return-editor');

    if (btnPlay)     btnPlay.addEventListener('click',     () => showScreen('missions-screen'));
    if (btnLoadout)  btnLoadout.addEventListener('click',  () => {
      if (_canResume) return;
      _loadoutSelectedSlot = 1;
      showScreen('loadout-screen');
    });
    if (btnSettings) btnSettings.addEventListener('click', () => showScreen('settings-screen'));
    if (btnControls) btnControls.addEventListener('click', () => showScreen('controls-screen'));
    if (btnUnitEditor) btnUnitEditor.addEventListener('click', () => {
      if (_canResume) return;
      showScreen('unit-editor-screen');
      if (typeof UnitEditorSystem !== 'undefined') UnitEditorSystem.open();
    });
    if (btnEndMission) btnEndMission.addEventListener('click', () => {
      hideAllMenus();
      if (_onEndMission) _onEndMission();
    });
    if (btnReturnEditor) btnReturnEditor.addEventListener('click', () => {
      hideAllMenus();
      if (_onReturnToEditor) _onReturnToEditor();
    });

    const btnResume = document.getElementById('btn-resume');
    const btnEditor = document.getElementById('btn-editor');
    if (btnResume) btnResume.addEventListener('click', () => { hideAllMenus(); if (onResume) onResume(); });
    if (btnEditor) btnEditor.addEventListener('click', () => {
      if (_canResume) return;
      hideAllMenus();
      if (onEditor) onEditor();
    });

    // Back buttons
    const backBtns = ['missions-back', 'loadout-back', 'settings-back', 'controls-back', 'unit-editor-back'];
    backBtns.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('click', () => showScreen('main-menu'));
    });

    // Load missions from the missions/ folder and build cards
    _loadMissions();

    // Quality buttons
    document.querySelectorAll('.quality-btn').forEach(btn => {
      btn.addEventListener('click', () => setQuality(btn.dataset.quality));
    });

    // Volume slider
    const volSlider = document.getElementById('volume-slider');
    const volValue  = document.getElementById('volume-value');
    const explosionSlider = document.getElementById('explosion-volume-slider');
    const explosionValue  = document.getElementById('explosion-volume-value');
    const musicSlider = document.getElementById('menu-music-slider');
    const musicValue  = document.getElementById('menu-music-value');
    const lensSlider = document.getElementById('lens-distortion-slider');
    const lensValue  = document.getElementById('lens-distortion-value');
    if (volSlider && volValue && AudioSystem.getVolume) {
      const pct = Math.round(AudioSystem.getVolume() * 100);
      volSlider.value = String(pct);
      volValue.textContent = pct + '%';
    }
    if (volSlider) {
      volSlider.addEventListener('input', () => {
        const pct = parseInt(volSlider.value, 10);
        volValue.textContent = pct + '%';
        AudioSystem.setVolume(pct / 100);
      });
    }
    if (explosionSlider && explosionValue && AudioSystem.getExplosionVolume) {
      const pct = Math.round(AudioSystem.getExplosionVolume() * 100);
      explosionSlider.value = String(pct);
      explosionValue.textContent = pct + '%';
    }
    if (explosionSlider) {
      explosionSlider.addEventListener('input', () => {
        const pct = parseInt(explosionSlider.value, 10);
        explosionValue.textContent = pct + '%';
        AudioSystem.setExplosionVolume(pct / 100);
      });
    }
    if (musicSlider && musicValue && AudioSystem.getMenuMusicVolume) {
      const pct = Math.round(AudioSystem.getMenuMusicVolume() * 100);
      musicSlider.value = String(pct);
      musicValue.textContent = pct + '%';
    }
    if (musicSlider) {
      musicSlider.addEventListener('input', () => {
        const pct = parseInt(musicSlider.value, 10);
        musicValue.textContent = pct + '%';
        AudioSystem.setMenuMusicVolume(pct / 100);
      });
    }
    if (lensSlider && lensValue && typeof ThermalSystem !== 'undefined' && ThermalSystem.getLensDistortion) {
      const pct = Math.round(ThermalSystem.getLensDistortion() * 100);
      lensSlider.value = String(pct);
      lensValue.textContent = pct + '%';
    }
    if (lensSlider) {
      lensSlider.addEventListener('input', () => {
        const pct = parseInt(lensSlider.value, 10);
        lensValue.textContent = pct + '%';
        if (typeof ThermalSystem !== 'undefined' && ThermalSystem.setLensDistortion) {
          ThermalSystem.setLensDistortion(pct / 100);
        }
      });
    }

    // Show main menu at start
    refreshMobileWeaponBar();
    showScreen('main-menu');
  }

  // Add "BACK TO MENU" button to game over screen
  function addBackToMenuButton(onBack) {
    const content = document.getElementById('gameover-content');
    if (!content || document.getElementById('back-to-menu-btn')) return;
    const btn = document.createElement('button');
    btn.id = 'back-to-menu-btn';
    btn.textContent = 'MAIN MENU';
    btn.addEventListener('click', () => {
      document.getElementById('gameover-screen').style.display = 'none';
      showScreen('main-menu');
      if (onBack) onBack();
    });
    content.appendChild(btn);
  }

  return {
    init,
    hideAllMenus,
    showScreen,
    setResumable,
    setEditorReturnable,
    getQuality,
    getQualityProfile,
    onQualityChange,
    getParticleMultiplier,
    initMobileControls,
    getJoystick,
    syncMobileWeapon,
    updateMobileWeaponButtons,
    addBackToMenuButton,
    unlockMission,
  };
})();
