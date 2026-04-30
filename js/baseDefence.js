/* =============================================
   BASE DEFENCE SYSTEM
   Tower-defence style game mode:
   - Protect HQ building at center (0,0)
   - Deploy friendly units/buildings near center
   - Earn credits from kills
   - Hostile waves per-round composition
   - 15-second build phase between rounds
   ============================================= */
'use strict';

const BaseDefenceSystem = (() => {

  // ---- Constants ----
  const BASE_DEPLOY_RADIUS = 50; // max placement radius from center
  const BASE_HQ_MAX_HP     = 1500;
  const BUILD_DURATION   = 15;   // seconds between rounds
  const STARTING_CREDITS = 1000;
  const HQ_MELEE_RADIUS  = 7;    // hostiles within this range damage HQ passively
  const HQ_INF_DPS       = 6;    // HP/s per infantry in melee range
  const HQ_VEH_DPS       = 18;   // HP/s per vehicle in melee range
  const UPGRADE_MAX_LEVEL = 5;
  const HQ_HP_PER_LEVEL = 500;
  const DEPLOY_RADIUS_PER_LEVEL = 5;
  const UPGRADE_COSTS = {
    hqHp:        [500, 1000, 1500, 2000, 2500],
    deployRadius:[500, 1000, 1500, 2000, 2500]
  };

  const COSTS = {
    infantry:   50,
    machine_gunner: 75,
    anti_tank:  100,
    truck:     150,
    apc:       300,
    tank:      500,
    bunker:    1000,
    bofors:    1500,
    artillery: 3000
  };

  const CREDIT_PER_INFANTRY = 50;
  const CREDIT_PER_VEHICLE  = 120;

  // ---- State ----
  let _active   = false;
  let _scene    = null;

  let _round     = 0;
  let _phase     = 'build'; // 'build' | 'combat' | 'gameover'
  let _buildTimer = BUILD_DURATION;
  let _credits   = STARTING_CREDITS;
  let _gameOver  = false;
  let _totalKills = 0;
  let _hqHpUpgradeLevel = 0;
  let _deployRadiusUpgradeLevel = 0;

  // HQ building object (same shape as TerrainSystem buildings)
  let _hqBuilding = null;
  let _hqBeaconMeshes = [];

  // Deploy zone ring + label
  let _deployZoneMesh = null;

  // Placement state
  let _placing      = false;
  let _placeType    = null;  // key from COSTS
  let _placeCursor  = null;  // THREE.Group preview mesh
  let _placeValid   = false;

  // ---- Helpers ----

  function _clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function _dist2D(ax, az, bx, bz) { return Math.hypot(ax - bx, az - bz); }
  function _getDeployRadius() { return BASE_DEPLOY_RADIUS + _deployRadiusUpgradeLevel * DEPLOY_RADIUS_PER_LEVEL; }
  function _getHQMaxHp() { return BASE_HQ_MAX_HP + _hqHpUpgradeLevel * HQ_HP_PER_LEVEL; }
  function _getUpgradeCost(kind) {
    const level = kind === 'hqHp' ? _hqHpUpgradeLevel : _deployRadiusUpgradeLevel;
    const costs = UPGRADE_COSTS[kind] || [];
    return costs[level] || 0;
  }

  // ---- HQ Creation (mesh builders removed — structures now use EntitySystem.spawnStaticStructure) ----

  function _createHQ(scene) {
    const w = 12, d = 12, h = 10;
    const groundY = TerrainSystem.getHeightAt(0, 0);

    // Hot bright signature so HQ is clearly visible in thermal
    const heat = 0.55;
    const geo  = new THREE.BoxGeometry(w, h, d);
    const mat  = new THREE.MeshBasicMaterial({ color: new THREE.Color(heat, heat * 0.9, heat * 0.5) });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(0, groundY + h / 2, 0);
    scene.add(mesh);

    // Star marker on top
    const topGeo = new THREE.CylinderGeometry(0.5, 2, 3, 6);
    const topMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 1.0, 0.3) });
    const topMesh = new THREE.Mesh(topGeo, topMat);
    topMesh.position.set(0, groundY + h + 1.5, 0);
    scene.add(topMesh);

    _hqBuilding = {
      mesh, markerMesh: topMesh,
      x: 0, z: 0,
      w, d, h,
      maxHp: _getHQMaxHp(),
      hp: _getHQMaxHp(),
      destroyed: false,
      groundY,
      isHQ: true
    };

    // Add to terrain buildings array so handleImpact can damage it
    const bArr = TerrainSystem.getBuildings();
    bArr.push(_hqBuilding);

    // Beacon rings
    _createHQBeacon(scene, 0, 0, groundY);
  }

  function _createHQBeacon(scene, x, z, groundY) {
    _cleanupHQBeacon(scene);
    const y = groundY + 0.5;
    [8, 12, 16].forEach(r => {
      const geo = new THREE.RingGeometry(r - 0.5, r + 0.5, 48);
      const mat = new THREE.MeshBasicMaterial({ color: 0xffdd00, side: THREE.DoubleSide, transparent: true, opacity: 0.9 });
      const m = new THREE.Mesh(geo, mat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(x, y, z);
      scene.add(m);
      _hqBeaconMeshes.push(m);
    });
    // Vertical glow column
    const colGeo = new THREE.CylinderGeometry(0.4, 0.4, 25, 8);
    const colMat = new THREE.MeshBasicMaterial({ color: 0xffee44, transparent: true, opacity: 0.5 });
    const col = new THREE.Mesh(colGeo, colMat);
    col.position.set(x, y + 12.5, z);
    scene.add(col);
    _hqBeaconMeshes.push(col);
  }

  function _cleanupHQBeacon(scene) {
    _hqBeaconMeshes.forEach(m => {
      if (scene) scene.remove(m);
      if (m.geometry) m.geometry.dispose();
      if (m.material) m.material.dispose();
    });
    _hqBeaconMeshes = [];
  }

  // ---- Deploy Zone Visual ----

  function _createDeployZone(scene) {
    _removeDeployZone(scene);
    const deployRadius = _getDeployRadius();
    const segments = 64;
    const geo = new THREE.RingGeometry(deployRadius - 0.8, deployRadius + 0.8, segments);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x00ff88,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.35
    });
    _deployZoneMesh = new THREE.Mesh(geo, mat);
    _deployZoneMesh.rotation.x = -Math.PI / 2;
    _deployZoneMesh.position.set(0, 0.3, 0);
    scene.add(_deployZoneMesh);
  }

  function _removeDeployZone(scene) {
    if (_deployZoneMesh) {
      if (scene) scene.remove(_deployZoneMesh);
      if (_deployZoneMesh.geometry) _deployZoneMesh.geometry.dispose();
      if (_deployZoneMesh.material) _deployZoneMesh.material.dispose();
      _deployZoneMesh = null;
    }
  }

  // ---- Placement Cursor ----

  function _buildCursorMesh(type) {
    const g = new THREE.Group();
    let preview;

    if (type === 'bunker' || type === 'bofors' || type === 'artillery') {
      const dims = type === 'bunker' ? [5, 4, 5] : type === 'bofors' ? [5, 5.5, 5] : [4, 4.5, 9];
      const geo = new THREE.BoxGeometry(dims[0], dims[1], dims[2]);
      const mat = new THREE.MeshBasicMaterial({ color: 0x44ff88, transparent: true, opacity: 0.55, wireframe: true });
      preview = new THREE.Mesh(geo, mat);
      preview.position.y = dims[1] / 2;
    } else if (type === 'infantry') {
      const geo = new THREE.CylinderGeometry(0.4, 0.4, 1.4, 8);
      const mat = new THREE.MeshBasicMaterial({ color: 0x44ff88, transparent: true, opacity: 0.75, wireframe: true });
      preview = new THREE.Mesh(geo, mat);
      preview.position.y = 0.7;
    } else {
      // truck / apc / tank / artillery
      const geo = new THREE.BoxGeometry(2.5, 1.5, 4.5);
      const mat = new THREE.MeshBasicMaterial({ color: 0x44ff88, transparent: true, opacity: 0.75, wireframe: true });
      preview = new THREE.Mesh(geo, mat);
      preview.position.y = 0.75;
    }

    g.add(preview);

    // Ground indicator ring
    const ringGeo = new THREE.RingGeometry(2.5, 3.5, 32);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x44ff88, side: THREE.DoubleSide, transparent: true, opacity: 0.6 });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.2;
    g.add(ring);

    return g;
  }

  function _setCursorColor(hex) {
    if (!_placeCursor) return;
    _placeCursor.traverse(c => {
      if (c.material) c.material.color.setHex(hex);
    });
  }

  function _removeCursor(scene) {
    if (_placeCursor) {
      if (scene) scene.remove(_placeCursor);
      _placeCursor.traverse(c => {
        if (c.geometry) c.geometry.dispose();
        if (c.material) c.material.dispose();
      });
      _placeCursor = null;
    }
  }

  // ---- UI helpers ----

  function _getEl(id) { return document.getElementById(id); }

  function _updateUI() {
    const panel = _getEl('bd-panel');
    if (!panel) return;
    panel.style.display = _active ? 'flex' : 'none';

    const creditsEl = _getEl('bd-credits');
    if (creditsEl) creditsEl.textContent = _credits;

    const roundEl = _getEl('bd-round');
    if (roundEl) roundEl.textContent = _round || 1;

    const phaseEl = _getEl('bd-phase');
    if (phaseEl) {
      if (_phase === 'build') {
        phaseEl.textContent = `BUILD PHASE — ${Math.ceil(_buildTimer)}s`;
        phaseEl.className = 'bd-phase build';
      } else if (_phase === 'combat') {
        const hostileCount = EntitySystem.getHostiles().length;
        phaseEl.textContent = `COMBAT — ${hostileCount} HOSTILES`;
        phaseEl.className = 'bd-phase combat';
      } else {
        phaseEl.textContent = 'GAME OVER';
        phaseEl.className = 'bd-phase gameover';
      }
    }

    // HQ health bar
    const hqBar = _getEl('bd-hq-bar-fill');
    const hqHpEl = _getEl('bd-hq-hp');
    if (_hqBuilding) {
      const pct = Math.max(0, (_hqBuilding.hp / _hqBuilding.maxHp) * 100);
      if (hqBar) {
        hqBar.style.width = pct + '%';
        hqBar.style.background = pct > 60 ? '#00ff88' : pct > 30 ? '#ffcc00' : '#ff3333';
      }
      if (hqHpEl) hqHpEl.textContent = `${Math.max(0, Math.ceil(_hqBuilding.hp))} / ${_hqBuilding.maxHp}`;
    }

    const deployRadiusEl = _getEl('bd-deploy-radius-val');
    if (deployRadiusEl) deployRadiusEl.textContent = _getDeployRadius();

    const hqUpgradeBtn = _getEl('bd-upgrade-hq-btn');
    const hqUpgradeName = _getEl('bd-upgrade-hq-name');
    const hqUpgradeCost = _getEl('bd-upgrade-hq-cost');
    const hqUpgradeMaxed = _hqHpUpgradeLevel >= UPGRADE_MAX_LEVEL;
    if (hqUpgradeName) hqUpgradeName.textContent = `HQ HP LV ${_hqHpUpgradeLevel}/${UPGRADE_MAX_LEVEL}`;
    if (hqUpgradeCost) hqUpgradeCost.textContent = hqUpgradeMaxed ? 'MAX' : `₵${_getUpgradeCost('hqHp')}`;
    if (hqUpgradeBtn) hqUpgradeBtn.disabled = _gameOver || hqUpgradeMaxed || _credits < _getUpgradeCost('hqHp');

    const radiusUpgradeBtn = _getEl('bd-upgrade-radius-btn');
    const radiusUpgradeName = _getEl('bd-upgrade-radius-name');
    const radiusUpgradeCost = _getEl('bd-upgrade-radius-cost');
    const radiusUpgradeMaxed = _deployRadiusUpgradeLevel >= UPGRADE_MAX_LEVEL;
    if (radiusUpgradeName) radiusUpgradeName.textContent = `DEPLOY LV ${_deployRadiusUpgradeLevel}/${UPGRADE_MAX_LEVEL}`;
    if (radiusUpgradeCost) radiusUpgradeCost.textContent = radiusUpgradeMaxed ? 'MAX' : `₵${_getUpgradeCost('deployRadius')}`;
    if (radiusUpgradeBtn) radiusUpgradeBtn.disabled = _gameOver || radiusUpgradeMaxed || _credits < _getUpgradeCost('deployRadius');

    // Disable buttons if not enough credits or not in a placeable state
    document.querySelectorAll('.bd-unit-btn[data-type]').forEach(btn => {
      const cost = parseInt(btn.dataset.cost, 10);
      btn.disabled = _credits < cost || _gameOver;
      btn.classList.toggle('bd-btn-active', _placing && _placeType === btn.dataset.type);
    });

    // Build timer bar
    const timerBar = _getEl('bd-timer-fill');
    if (timerBar) {
      const pct = (_phase === 'build')
        ? (_buildTimer / BUILD_DURATION) * 100
        : 0;
      timerBar.style.width = pct + '%';
    }

    const timerRow = _getEl('bd-timer-row');
    if (timerRow) timerRow.style.display = _phase === 'build' ? 'flex' : 'none';

    const cancelBtn = _getEl('bd-cancel-btn');
    if (cancelBtn) cancelBtn.style.display = _placing ? 'block' : 'none';
  }

  function _showNotification(text, color) {
    const el = _getEl('bd-notify');
    if (!el) return;
    el.textContent = text;
    el.style.color = color || '#00ff88';
    el.style.opacity = '1';
    clearTimeout(el._timeout);
    el._timeout = setTimeout(() => { el.style.opacity = '0'; }, 2000);
  }

  // ---- Public: start / stop ----

  function start(scene) {
    _active   = true;
    _scene    = scene;
    _round    = 0;
    _phase    = 'build';
    _buildTimer = BUILD_DURATION;
    _credits  = STARTING_CREDITS;
    _gameOver = false;
    _totalKills = 0;
    _hqHpUpgradeLevel = 0;
    _deployRadiusUpgradeLevel = 0;
    _placing  = false;
    _placeType = null;
    _createDeployZone(scene);
    _createHQ(scene);

    // Register kill callback so credits come from ALL sources (player + friendly units)
    EntitySystem.onHostileKilled(ent => {
      if (!_active) return;
      const earned = ent.type === 'vehicle' ? CREDIT_PER_VEHICLE : CREDIT_PER_INFANTRY;
      _credits += earned;
      _totalKills++;
      const el = _getEl('bd-credit-flash');
      if (el) {
        el.textContent = `+${earned}`;
        el.style.opacity = '1';
        clearTimeout(el._t);
        el._t = setTimeout(() => { el.style.opacity = '0'; }, 900);
      }
      _updateUI();
    });

    _updateUI();

    HUDSystem.showRadio('BASE DEFENCE MISSION LOADED — FORTIFY THE PERIMETER.');
    HUDSystem.updateObjective('PROTECT HQ — BUILD YOUR DEFENCES');
    if (HUDSystem.showMissionObjective) HUDSystem.showMissionObjective('PROTECT HQ — BUILD YOUR DEFENCES');
    setTimeout(() => HUDSystem.showRadio(`ROUND 1 BEGINS IN ${BUILD_DURATION} SECONDS. DEPLOY UNITS NOW.`), 3000);
  }

  function stop() {
    if (!_active) return;
    _active = false;
    EntitySystem.onHostileKilled(null); // clear callback
    _removePlacement();
    _removeDeployZone(_scene);
    _cleanupHQBeacon(_scene);

    if (_hqBuilding) {
      if (_scene && _hqBuilding.mesh) _scene.remove(_hqBuilding.mesh);
      if (_scene && _hqBuilding.markerMesh) _scene.remove(_hqBuilding.markerMesh);
      // Remove from terrain buildings array
      const bArr = TerrainSystem.getBuildings();
      const idx = bArr.indexOf(_hqBuilding);
      if (idx !== -1) bArr.splice(idx, 1);
      _hqBuilding = null;
    }

    // Static structures are entities — EntitySystem.despawnAll() handles cleanup

    const panel = _getEl('bd-panel');
    if (panel) panel.style.display = 'none';

    _scene = null;
  }

  // ---- Round / Phase management ----

  function _startCombat() {
    _phase = 'combat';
    _round++;
    EntitySystem.spawnBaseDefenceWave(_round, _scene);
    const hostile = EntitySystem.getHostiles();
    HUDSystem.showRadio(`ROUND ${_round} — ${hostile.length} HOSTILES INCOMING. DEFEND THE HQ!`);
    HUDSystem.updateObjective(`ROUND ${_round} — NEUTRALIZE ALL HOSTILES`);
    _updateUI();
  }

  function _startBuildPhase() {
    _phase = 'build';
    _buildTimer = BUILD_DURATION;
    _updateUI();
    HUDSystem.showRadio(`ROUND ${_round} CLEARED! BUILD PHASE — ${BUILD_DURATION} SECONDS.`);
    HUDSystem.updateObjective(`ROUND ${_round} COMPLETE — DEPLOY DEFENCES`);
  }

  // ---- Placement ----

  function startPlacement(type) {
    if (_gameOver) return;
    if (COSTS[type] === undefined) return;
    if (_credits < COSTS[type]) {
      _showNotification('INSUFFICIENT CREDITS', '#ff4444');
      return;
    }
    _placing   = true;
    _placeType = type;

    if (_placeCursor) _removeCursor(_scene);
    _placeCursor = _buildCursorMesh(type);
    _scene.add(_placeCursor);

    _showNotification('CLICK TO DEPLOY — RIGHT-CLICK TO CANCEL', '#ffffaa');
    _updateUI();
    document.body.style.cursor = 'crosshair';
  }

  function _removePlacement() {
    _placing   = false;
    _placeType = null;
    _removeCursor(_scene);
    document.body.style.cursor = '';
    _updateUI();
  }

  function cancelPlacement() {
    _removePlacement();
    _showNotification('PLACEMENT CANCELLED', '#888888');
  }

  function upgradeHQHp() {
    if (!_active || _gameOver || !_hqBuilding) return false;
    if (_hqHpUpgradeLevel >= UPGRADE_MAX_LEVEL) {
      _showNotification('HQ HP ALREADY MAXED', '#ffffaa');
      return false;
    }

    const cost = _getUpgradeCost('hqHp');
    if (_credits < cost) {
      _showNotification('INSUFFICIENT CREDITS', '#ff4444');
      return false;
    }

    _credits -= cost;
    _hqHpUpgradeLevel++;
    _hqBuilding.maxHp = _getHQMaxHp();
    _hqBuilding.hp = Math.min(_hqBuilding.maxHp, _hqBuilding.hp + HQ_HP_PER_LEVEL);
    _showNotification(`HQ HP UPGRADED TO LV ${_hqHpUpgradeLevel} — ₵${_credits} REMAINING`, '#00ff88');
    _updateUI();
    return true;
  }

  function upgradeDeployRadius() {
    if (!_active || _gameOver) return false;
    if (_deployRadiusUpgradeLevel >= UPGRADE_MAX_LEVEL) {
      _showNotification('DEPLOY RADIUS ALREADY MAXED', '#ffffaa');
      return false;
    }

    const cost = _getUpgradeCost('deployRadius');
    if (_credits < cost) {
      _showNotification('INSUFFICIENT CREDITS', '#ff4444');
      return false;
    }

    _credits -= cost;
    _deployRadiusUpgradeLevel++;
    if (_scene) _createDeployZone(_scene);
    _showNotification(`DEPLOY RADIUS UPGRADED TO LV ${_deployRadiusUpgradeLevel} — ₵${_credits} REMAINING`, '#00ff88');
    _updateUI();
    return true;
  }

  function confirmPlacement(worldX, worldZ) {
    if (!_placing || !_placeType) return false;

    // Check deploy zone
    const deployRadius = _getDeployRadius();
    const dist = _dist2D(worldX, worldZ, 0, 0);
    if (dist > deployRadius) {
      _showNotification('OUT OF DEPLOY ZONE', '#ff4444');
      return false;
    }

    const cost = COSTS[_placeType];
    if (_credits < cost) {
      _showNotification('INSUFFICIENT CREDITS', '#ff4444');
      return false;
    }

    _credits -= cost;

    const type = _placeType;

    if (type === 'bunker' || type === 'bofors' || type === 'artillery') {
      EntitySystem.addEntity(EntitySystem.spawnStaticStructure(type, worldX, worldZ, false, _scene));
    } else {
      // mobile unit types: infantry, machine_gunner, anti_tank, truck, apc, tank
      EntitySystem.spawnFriendlyUnit(type, worldX, worldZ, _scene, _getDeployRadius());
    }

    if (_credits < cost) {
      _removePlacement();
      _showNotification(`DEPLOYED — ₵${_credits} REMAINING. INSUFFICIENT CREDITS TO DEPLOY MORE ${type.toUpperCase().replace(/_/g, ' ')}`, '#00ff88');
    } else {
      _showNotification(`DEPLOYED ${type.toUpperCase().replace(/_/g, ' ')} — CLICK TO DEPLOY AGAIN. RIGHT-CLICK TO CANCEL. ₵${_credits} REMAINING`, '#00ff88');
    }
    _updateUI();
    return true;
  }

  // ---- Update ----

  function update(dt, time, aimX, aimZ) {
    if (!_active || _gameOver) return;

    // Pulse deploy zone
    if (_deployZoneMesh) {
      const pulse = 0.2 + 0.15 * Math.sin(time * 2.5);
      _deployZoneMesh.material.opacity = pulse;
    }

    // Pulse HQ beacon rings
    if (_hqBeaconMeshes.length > 0) {
      const p = 0.5 + 0.5 * Math.sin(time * 3.5);
      _hqBeaconMeshes.forEach((m, i) => {
        if (i < 3) {
          const s = 0.85 + 0.3 * Math.sin(time * 3.5 + i * 0.9);
          m.scale.setScalar(s);
          m.material.opacity = 0.25 + 0.7 * p;
        } else {
          m.material.opacity = 0.15 + 0.4 * p;
        }
      });
    }

    // Move placement cursor
    if (_placing && _placeCursor) {
      const deployRadius = _getDeployRadius();
      const dist = _dist2D(aimX, aimZ, 0, 0);
      _placeValid = dist <= deployRadius;
      // Clamp aiming to deploy zone if outside
      const finalX = _placeValid ? aimX : (aimX / (dist || 1)) * deployRadius;
      const finalZ = _placeValid ? aimZ : (aimZ / (dist || 1)) * deployRadius;
      const gy = TerrainSystem.getHeightAt(finalX, finalZ);
      _placeCursor.position.set(finalX, gy, finalZ);
      _setCursorColor(_placeValid ? 0x44ff88 : 0xff4444);
    }

    // Hostiles damaging HQ at melee range
    if (_hqBuilding && !_hqBuilding.destroyed) {
      const hostiles = EntitySystem.getHostiles();
      let attackers = 0;
      hostiles.forEach(ent => {
        const d = _dist2D(ent.x, ent.z, 0, 0);
        if (d < HQ_MELEE_RADIUS) {
          attackers++;
          const dps = ent.type === 'vehicle' ? HQ_VEH_DPS : HQ_INF_DPS;
          _hqBuilding.hp -= dps * dt;
        }
      });
      if (attackers > 0) {
        HUDSystem.setWarning('\u26A0 HQ UNDER ATTACK!');
        // Tint HQ mesh red
        if (_hqBuilding.mesh) {
          _hqBuilding.mesh.material.color.setRGB(0.8, 0.2, 0.1);
          if (!_hqBuilding._resetColorTimeout) {
            _hqBuilding._resetColorTimeout = setTimeout(() => {
              if (_hqBuilding && _hqBuilding.mesh) {
                const heat = 0.55;
                _hqBuilding.mesh.material.color.setRGB(heat, heat * 0.9, heat * 0.5);
              }
              if (_hqBuilding) _hqBuilding._resetColorTimeout = null;
            }, 300);
          }
        }
      } else {
        HUDSystem.setWarning('');
      }

      if (_hqBuilding.hp <= 0) {
        _triggerGameOver();
        return;
      }
    }

    // Also catch HQ destroyed by entity projectile damage (via _destroyBuildingCb)
    if (_hqBuilding && _hqBuilding.destroyed && !_gameOver) {
      _triggerGameOver();
      return;
    }

    // Phase logic
    if (_phase === 'build') {
      _buildTimer -= dt;
      if (_buildTimer <= 0) {
        _startCombat();
      }
    } else if (_phase === 'combat') {
      const hostiles = EntitySystem.getHostiles();
      if (hostiles.length === 0) {
        _startBuildPhase();
      }
    }

    _updateUI();
  }

  function _triggerGameOver() {
    if (_gameOver) return;
    _gameOver = true;
    _phase = 'gameover';
    _removePlacement();
    AudioSystem.stopMissionVoicePlayback();
    AudioSystem.playMissionFailureVoice();

    if (_hqBuilding && _hqBuilding.mesh) {
      EffectsSystem.spawnExplosion(0, 0, 0, 3.5);
      _hqBuilding.destroyed = true;
      _hqBuilding.hp = 0;
    }

    HUDSystem.showRadio('HQ DESTROYED — MISSION FAILED.', 6000);
    HUDSystem.updateObjective(`MISSION FAILED — SURVIVED ${_round} ROUNDS`);
    HUDSystem.setWarning('HQ DESTROYED');
    _updateUI();

    // Delay game over screen to let explosion show
    setTimeout(() => {
      HUDSystem.showGameOver(
        MissionSystem.getScore(),
        MissionSystem.getKills(),
        MissionSystem.getFriendlyKills(),
        null,
        true
      );
    }, 3000);
  }

  // ---- Called when a hostile is killed by player weapons (extra hook from game.js) ----
  // Credits are already awarded via EntitySystem.onHostileKilled — this is a no-op kept
  // for potential future per-source logic.
  function onKill(entity) { /* handled by EntitySystem.onHostileKilled callback */ }

  // ---- Getters ----

  function isActive()   { return _active; }
  function isGameOver() { return _gameOver; }
  function isPlacing()  { return _placing; }
  function getRound()   { return _round; }

  // ---- Event wiring (called once by game.js on BD mission start) ----

  let _buttonsBound = false;
  function bindDeployButtons() {
    if (_buttonsBound) return; // prevent double-binding across restarts
    _buttonsBound = true;

    document.querySelectorAll('.bd-unit-btn[data-type]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        if (_active) startPlacement(btn.dataset.type);
      });
    });

    const hqUpgradeBtn = _getEl('bd-upgrade-hq-btn');
    if (hqUpgradeBtn) {
      hqUpgradeBtn.addEventListener('click', e => {
        e.stopPropagation();
        if (_active) upgradeHQHp();
      });
    }

    const radiusUpgradeBtn = _getEl('bd-upgrade-radius-btn');
    if (radiusUpgradeBtn) {
      radiusUpgradeBtn.addEventListener('click', e => {
        e.stopPropagation();
        if (_active) upgradeDeployRadius();
      });
    }

    const cancelBtn = _getEl('bd-cancel-btn');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', e => {
        e.stopPropagation();
        cancelPlacement();
      });
    }

    // Right-click on canvas cancels placement
    window.addEventListener('contextmenu', e => {
      if (_active && _placing) {
        e.preventDefault();
        cancelPlacement();
      }
    });

    // ESC key cancels placement
    window.addEventListener('keydown', e => {
      if (_active && _placing && e.key === 'Escape') {
        cancelPlacement();
      }
    });
  }

  function placeStructureDirect(type, x, z, sceneRef, faction) {
    if (sceneRef && !_scene) _scene = sceneRef;
    const s = sceneRef || _scene;
    const isHostile = faction === 'hostile';
    EntitySystem.addEntity(EntitySystem.spawnStaticStructure(type, x, z, isHostile, s));
  }

  return {
    start, stop, update,
    isActive, isGameOver, isPlacing, getRound,
    startPlacement, confirmPlacement, cancelPlacement,
    upgradeHQHp, upgradeDeployRadius,
    onKill,
    bindDeployButtons,
    placeStructureDirect
  };

})();
