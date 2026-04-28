/* =============================================
   WEAPONS.JS — Weapons definitions & fire logic
   ============================================= */
'use strict';

const WeaponsSystem = (() => {

  const WEAPONS = {
    1: {
      id: 1,
      name: 'MINIGUN',
      shortName: 'MGN',
      description: 'High-volume suppression cannon with infinite ammunition but heat buildup.',
      prestigeCost: 0,
      key: '1',
      fireRate: 0.01,        // 6000 rpm = 100 rds/s
      damage: 8,             // 7.62mm — low damage per round, high volume
      aoeRadius: 3.5,
      maxAmmo: Infinity,
      ammo: Infinity,
      reloadTime: 0,
      reloading: false,
      reloadProgress: 0,
      lastFired: 0,
      // Heat system
      heat: 0,              // 0.0 – 1.0
      overheated: false,
      heatPerShot: 0.012,   // ~83 rounds (~0.83s) to overheat
      heatCoolRate: 0.20,   // per second when not firing; full cool in ~5s
      overheatTime: 5.0,    // forced cooldown — barrels need to cool
      zoom: 1.0,
      shake: 0.03,          // light shake per round — feels like vibration
      projectileSpeed: 320, // fast muzzle velocity
      color: new THREE.Color(1.0, 1.0, 0.6),
      explosionSize: 0.5,
      soundFn: () => AudioSystem.playMinigun()
    },
    2: {
      id: 2,
      name: '30MM CANNON',
      shortName: '30MM',
      description: 'Balanced autocannon for precision fire and mid-radius splash damage.',
      prestigeCost: 0,
      key: '2',
      fireRate: 0.3,         // 200 rpm = ~3.3 rds/s
      damage: 35,
      aoeRadius: 7,
      maxAmmo: 30,
      ammo: 30,
      reloadTime: 30,
      reloading: false,
      reloadProgress: 0,
      lastFired: 0,
      zoom: 1.1,
      shake: 0.13,
      projectileSpeed: 250,
      color: new THREE.Color(1.0, 0.85, 0.4),
      explosionSize: 1.3,
      soundFn: () => AudioSystem.play30mm()
    },
    3: {
      id: 3,
      name: '40MM CANNON',
      shortName: '40MM',
      description: 'Medium heavy cannon with broader blast coverage for clustered targets.',
      prestigeCost: 180,
      key: '3',
      fireRate: 0.5,         // 120 rpm = 2 rds/s
      damage: 60,
      aoeRadius: 10,
      maxAmmo: 15,
      ammo: 15,
      reloadTime: 20,
      reloading: false,
      reloadProgress: 0,
      lastFired: 0,
      zoom: 1.2,
      shake: 0.18,
      projectileSpeed: 220,
      color: new THREE.Color(1.0, 0.8, 0.3),
      explosionSize: 2.0,
      soundFn: () => AudioSystem.play40mm()
    },
    4: {
      id: 4,
      name: '105MM HOWITZER',
      shortName: '105MM',
      description: 'Heavy direct-fire support round with slow reload and massive impact.',
      prestigeCost: 0,
      key: '4',
      fireRate: 7.5,         // ~8 rpm (6-10 rpm manual load)
      damage: 250,
      aoeRadius: 35,
      maxAmmo: 1,
      ammo: 1,
      reloadTime: 20,
      reloading: false,
      reloadProgress: 0,
      lastFired: 0,
      zoom: 0.8,
      shake: 0.4,
      projectileSpeed: 160,
      color: new THREE.Color(1.0, 0.6, 0.1),
      explosionSize: 5.0,
      soundFn: () => AudioSystem.play105mm()
    },
    5: {
      id: 5,
      name: 'CLUSTER BOMB',
      shortName: 'CLSTR',
      description: 'Area saturation payload that releases multiple bomblets over the target zone.',
      prestigeCost: 260,
      key: '5',
      fireRate: 1.0,
      damage: 0,
      aoeRadius: 0,
      maxAmmo: 10,
      ammo: 10,
      reloadTime: 15,
      reloading: false,
      reloadProgress: 0,
      lastFired: 0,
      zoom: 0.95,
      shake: 0.22,
      projectileSpeed: 145,
      color: new THREE.Color(0.95, 0.92, 0.62),
      explosionSize: 0,
      bombletCount: 10,
      bombletRadius: 12,
      soundFn: () => AudioSystem.playClusterBombRelease()
    },
    6: {
      id: 6,
      name: 'AT MISSILE',
      shortName: 'MISSL',
      description: 'Guided anti-armor missile designed to delete priority vehicles.',
      prestigeCost: 320,
      key: '6',
      fireRate: 1.0,
      damage: 600,
      aoeRadius: 11,
      maxAmmo: 5,
      ammo: 5,
      reloadTime: 20,
      reloading: false,
      reloadProgress: 0,
      lastFired: 0,
      zoom: 1.0,
      shake: 0.24,
      projectileSpeed: 135,
      color: new THREE.Color(1.0, 0.92, 0.72),
      explosionSize: 4.2,
      splashDamageMultiplier: 0.1,
      soundFn: () => AudioSystem.playMissileLaunch()
    }
  };

  const STARTER_WEAPONS = [1, 2, 4];
  const LOADOUT_SLOTS = 3;
  const PROGRESSION_STORAGE_KEY = 'ac130_weapon_progression_v1';

  function _defaultProgression() {
    return {
      prestige: 0,
      owned: [...STARTER_WEAPONS],
      loadout: [...STARTER_WEAPONS]
    };
  }

  function _sanitizeProgression(state) {
    const fallback = _defaultProgression();
    const owned = Array.isArray(state?.owned)
      ? Array.from(new Set(state.owned.map(Number).filter(id => WEAPONS[id])))
      : [];

    STARTER_WEAPONS.forEach(id => {
      if (!owned.includes(id)) owned.push(id);
    });

    let loadout = Array.isArray(state?.loadout)
      ? state.loadout.map(Number).filter(id => owned.includes(id))
      : [];

    loadout = Array.from(new Set(loadout));

    STARTER_WEAPONS.forEach(id => {
      if (loadout.length < LOADOUT_SLOTS && owned.includes(id) && !loadout.includes(id)) {
        loadout.push(id);
      }
    });

    if (loadout.length < LOADOUT_SLOTS) {
      owned.forEach(id => {
        if (loadout.length < LOADOUT_SLOTS && !loadout.includes(id)) loadout.push(id);
      });
    }

    while (loadout.length < LOADOUT_SLOTS) {
      loadout.push(fallback.loadout[loadout.length]);
    }

    return {
      prestige: Math.max(0, Math.floor(Number(state?.prestige) || 0)),
      owned,
      loadout: loadout.slice(0, LOADOUT_SLOTS)
    };
  }

  function _loadProgression() {
    try {
      const raw = localStorage.getItem(PROGRESSION_STORAGE_KEY);
      if (!raw) return _defaultProgression();
      return _sanitizeProgression(JSON.parse(raw));
    } catch (_) {
      return _defaultProgression();
    }
  }

  let progression = _loadProgression();

  function _saveProgression() {
    try {
      localStorage.setItem(PROGRESSION_STORAGE_KEY, JSON.stringify(progression));
    } catch (_) {}
  }

  let currentSlot = 1;
  let currentWeapon = progression.loadout[0] || STARTER_WEAPONS[0];
  let projectiles = [];
  let delayedProjectiles = [];
  let scene = null;

  function _resetWeaponStates() {
    Object.values(WEAPONS).forEach(w => {
      w.ammo = w.maxAmmo;
      w.reloading = false;
      w.reloadProgress = 0;
      w.lastFired = 0;
      if (w.heat !== undefined) w.heat = 0;
      if (w.overheated !== undefined) w.overheated = false;
    });
  }

  function _syncCurrentWeapon() {
    const equippedId = progression.loadout[currentSlot - 1] || progression.loadout[0] || STARTER_WEAPONS[0];
    currentWeapon = equippedId;
    return WEAPONS[currentWeapon];
  }

  function getCurrentSlot() { return currentSlot; }
  function getPrestige() { return progression.prestige; }
  function getOwnedWeaponIds() { return [...progression.owned]; }
  function isOwned(id) { return progression.owned.includes(Number(id)); }
  function getLoadoutWeaponIds() { return [...progression.loadout]; }
  function getWeaponBySlot(slot) {
    const weaponId = progression.loadout[slot - 1];
    return WEAPONS[weaponId] || null;
  }

  function getEquippedWeapons() {
    const slots = {};
    for (let slot = 1; slot <= LOADOUT_SLOTS; slot++) {
      const weapon = getWeaponBySlot(slot);
      if (weapon) slots[slot] = weapon;
    }
    return slots;
  }

  function getCatalog() {
    return Object.values(WEAPONS).map(weapon => ({
      ...weapon,
      owned: isOwned(weapon.id),
      equippedSlot: progression.loadout.indexOf(weapon.id) + 1 || null
    }));
  }

  function awardPrestige(amount) {
    const payout = Math.max(0, Math.round(Number(amount) || 0));
    if (!payout) return progression.prestige;
    progression.prestige += payout;
    _saveProgression();
    return progression.prestige;
  }

  function buyWeapon(id) {
    const weapon = WEAPONS[id];
    if (!weapon) return { ok: false, reason: 'missing' };
    if (isOwned(id)) return { ok: false, reason: 'owned' };
    const cost = weapon.prestigeCost || 0;
    if (progression.prestige < cost) return { ok: false, reason: 'insufficient', cost };
    progression.prestige -= cost;
    progression.owned.push(id);
    progression.owned.sort((a, b) => a - b);
    _saveProgression();
    return { ok: true, cost, prestige: progression.prestige };
  }

  function equipWeapon(slot, weaponId) {
    const slotIndex = Number(slot) - 1;
    const id = Number(weaponId);
    if (slotIndex < 0 || slotIndex >= LOADOUT_SLOTS) return false;
    if (!isOwned(id) || !WEAPONS[id]) return false;

    const previousIndex = progression.loadout.indexOf(id);
    if (previousIndex >= 0) {
      const swapId = progression.loadout[slotIndex];
      progression.loadout[previousIndex] = swapId;
    }

    progression.loadout[slotIndex] = id;
    _saveProgression();

    if (currentSlot === slotIndex + 1) {
      currentWeapon = id;
    } else if (previousIndex >= 0 && currentSlot === previousIndex + 1) {
      _syncCurrentWeapon();
    }

    return true;
  }

  // Drag coefficients: fractional speed loss per second per weapon (higher = slows faster)
  // Player rounds travel at near-constant velocity (no meaningful drag over combat range)
  const PROJ_DRAG = { 1: 0.02, 2: 0.02, 3: 0.01, 4: 0.01, 5: 0.04, 6: 0.003 };
  const PROJ_GRAVITY = 18; // world-units/s² — used only by entity projectiles

  // Reusable THREE objects for orientation
  const _pForward = new THREE.Vector3(0, 0, 1);
  const _pVelDir  = new THREE.Vector3();
  const _pQuat    = new THREE.Quaternion();

  function init(sceneRef) {
    // Flush any in-flight projectile meshes from the previous session
    projectiles.forEach(_removeProjectile);
    projectiles = [];
    delayedProjectiles = [];
    scene = sceneRef;
    progression = _sanitizeProgression(progression);
    _resetWeaponStates();
    currentSlot = 1;
    _syncCurrentWeapon();
  }

  function selectWeapon(id) {
    const slot = Number(id);
    if (slot >= 1 && slot <= LOADOUT_SLOTS) {
      currentSlot = slot;
      return _syncCurrentWeapon();
    }
    if (WEAPONS[slot] && progression.loadout.includes(slot)) {
      currentSlot = progression.loadout.indexOf(slot) + 1;
      currentWeapon = slot;
      return WEAPONS[slot];
    }
    return _syncCurrentWeapon();
  }

  function getCurrentWeapon() { return WEAPONS[currentWeapon]; }
  function getWeapon(id) { return WEAPONS[id]; }
  function getAllWeapons() { return WEAPONS; }

  function _disposeObject3D(object) {
    if (!object) return;
    object.traverse(node => {
      if (node.geometry) node.geometry.dispose();
      if (node.material) {
        if (Array.isArray(node.material)) node.material.forEach(mat => mat && mat.dispose());
        else node.material.dispose();
      }
    });
  }

  function _removeProjectile(proj) {
    if (!proj) return;
    if (scene && proj.mesh) scene.remove(proj.mesh);
    _disposeObject3D(proj.mesh);
  }

  function _createProjectileMesh(weapon) {
    if (weapon.id === 5 || weapon.id === 6) {
      const root = new THREE.Group();
      const bodyLength = weapon.id === 6 ? 1.6 : 1.05;
      const bodyWidth = weapon.id === 6 ? 0.22 : 0.18;
      const projectileGeo = new THREE.BoxGeometry(bodyWidth, bodyWidth, bodyLength);
      const projectileMat = new THREE.MeshBasicMaterial({
        color: weapon.color,
        transparent: true,
        opacity: 0.95,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      });
      const body = new THREE.Mesh(projectileGeo, projectileMat);
      root.add(body);
      root.userData.stretchMesh = body;

      return root;
    }

    if (weapon.id === 1) {
      const tracerGeo = new THREE.BoxGeometry(0.08, 0.08, 0.45);
      const tracerMat = new THREE.MeshBasicMaterial({
        color: weapon.color,
        transparent: true,
        opacity: 0.92,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      });
      return new THREE.Mesh(tracerGeo, tracerMat);
    }

    const tracerGeo = new THREE.BoxGeometry(0.12, 0.12, 0.55);
    const tracerMat = new THREE.MeshBasicMaterial({ color: weapon.color });
    return new THREE.Mesh(tracerGeo, tracerMat);
  }

  function _spawnProjectile(weapon, targetX, targetZ, targetY, originX, originY, originZ, options = {}) {
    const tracer = _createProjectileMesh(weapon);

    const spread = options.noSpread
      ? 0
      : weapon.id === 1 ? 2.5 : (weapon.id === 2 ? 0.2 : 0.1);
    const tx = targetX + Utils.randFloat(-spread, spread);
    const tz = targetZ + Utils.randFloat(-spread, spread);
    const ty = targetY !== undefined ? targetY : TerrainSystem.getHeightAt(tx, tz);

    const startX = (originX !== undefined) ? originX : (tx + Utils.randFloat(-15, 15));
    const startY = (originY !== undefined) ? originY : (120 + Utils.randFloat(-5, 5));
    const startZ = (originZ !== undefined) ? originZ : (tz + Utils.randFloat(-15, 15));

    tracer.position.set(startX, startY, startZ);
    scene.add(tracer);

    const dir = new THREE.Vector3(
      tx - tracer.position.x,
      ty - tracer.position.y,
      tz - tracer.position.z
    ).normalize();

    const totalDist = Math.hypot(tx - tracer.position.x, ty - tracer.position.y, tz - tracer.position.z);
    const projectileWeapon = { ...weapon, ...(options.weaponOverrides || {}) };
    const proj = {
      mesh: tracer,
      bodyMesh: tracer.userData.stretchMesh || tracer,
      isSprite: false,
      x: tracer.position.x,
      y: tracer.position.y,
      z: tracer.position.z,
      startX: tracer.position.x,
      startY: tracer.position.y,
      startZ: tracer.position.z,
      totalDist,
      dx: dir.x * projectileWeapon.projectileSpeed,
      dy: dir.y * projectileWeapon.projectileSpeed,
      dz: dir.z * projectileWeapon.projectileSpeed,
      initialSpeed: projectileWeapon.projectileSpeed,
      targetX: tx,
      targetZ: tz,
      targetY: ty,
      weapon: projectileWeapon,
      alive: true,
      age: 0,
      specialType: options.specialType || null,
      directTarget: options.directTarget || null,
      currentTargetRef: options.currentTargetRef || null,
      trailTimer: 0,
      glarePulseOffset: Math.random() * Math.PI * 2,
      submunitionsReleased: false
    };
    projectiles.push(proj);
    return proj;
  }

  function _queueDelayedProjectile(delay, spawnFn) {
    delayedProjectiles.push({ delay, spawnFn });
  }

  function _releaseClusterBomb(proj) {
    if (proj.submunitionsReleased) return;
    proj.submunitionsReleased = true;

    const bombletWeapon = WEAPONS[2];
    const bombletCount = proj.weapon.bombletCount || 10;
    const radius = proj.weapon.bombletRadius || 12;
    const releaseY = Math.max(proj.y, TerrainSystem.getHeightAt(proj.x, proj.z) + 18);

    for (let i = 0; i < bombletCount; i++) {
      const angle = (i / bombletCount) * Math.PI * 2 + Utils.randFloat(-0.25, 0.25);
      const dist = Math.sqrt(Math.random()) * radius;
      const tx = proj.targetX + Math.cos(angle) * dist;
      const tz = proj.targetZ + Math.sin(angle) * dist;
      const ty = TerrainSystem.getHeightAt(tx, tz);
      const delay = i < bombletCount - 3
        ? Utils.randFloat(0, 0.05)
        : Utils.randFloat(0.10, 0.22);
      _queueDelayedProjectile(delay, () => {
        _spawnProjectile(
          bombletWeapon,
          tx,
          tz,
          ty,
          proj.x + Utils.randFloat(-1.2, 1.2),
          releaseY + Utils.randFloat(-0.5, 0.8),
          proj.z + Utils.randFloat(-1.2, 1.2),
          { noSpread: true, specialType: 'clusterBomblet' }
        );
      });
    }
  }

  function canFire(time) {
    const w = WEAPONS[currentWeapon];
    if (w.reloading) return false;
    if (w.overheated) return false;
    if (w.ammo <= 0) return false;
    if (time - w.lastFired < w.fireRate) return false;
    return true;
  }

  function fire(time, targetX, targetZ, targetY, originX, originY, originZ, options = {}) {
    if (!canFire(time)) return null;

    const w = WEAPONS[currentWeapon];
    if (w.id === 6) {
      const lockTarget = options.lockedTarget;
      if (!lockTarget || !lockTarget.alive || lockTarget.type !== 'vehicle' || (options.lockProgress || 0) < 1) {
        return null;
      }
      targetX = lockTarget.x;
      targetZ = lockTarget.z;
      targetY = TerrainSystem.getHeightAt(lockTarget.x, lockTarget.z) + 1.2;
    }

    w.lastFired = time;

    // 25mm heat build-up
    if (w.heat !== undefined) {
      w.heat = Math.min(1, w.heat + w.heatPerShot);
      if (w.heat >= 1) {
        w.overheated = true;
        w.reloading = true;
        w.reloadProgress = 0;
        w.reloadTime = w.overheatTime;
        AudioSystem.playRadioChatter('Minigun overheated');
      }
    }

    if (w.maxAmmo !== Infinity) {
      w.ammo = Math.max(0, w.ammo - 1);
      if (w.ammo <= 0) {
        startReload(w);
      }
    }

    w.soundFn();

    const proj = _spawnProjectile(
      w,
      targetX,
      targetZ,
      targetY,
      originX,
      originY,
      originZ,
      {
        noSpread: w.id === 5 || w.id === 6,
        specialType: w.id === 5 ? 'clusterCarrier' : (w.id === 6 ? 'missile' : null),
        directTarget: w.id === 6 ? options.lockedTarget : null,
        currentTargetRef: w.id === 6 ? options.lockedTarget : null
      }
    );

    return { weapon: w, tracer: proj.mesh, projectile: proj, targetX: proj.targetX, targetZ: proj.targetZ, targetY: proj.targetY };
  }

  function startReload(w) {
    if (w.ammo > 0 || w.maxAmmo === Infinity) return;
    w.reloading = true;
    w.reloadProgress = 0;
  }

  function manualReload(id) {
    const directId = Number(id);
    const weaponId = directId >= 1 && directId <= LOADOUT_SLOTS
      ? progression.loadout[directId - 1]
      : (WEAPONS[directId] ? directId : currentWeapon);
    const w = WEAPONS[weaponId];
    if (!w || w.maxAmmo === Infinity) return;
    if (w.reloading) return;
    if (w.ammo >= w.maxAmmo) return;
    w.reloading = true;
    w.reloadProgress = 0;
  }

  // Hitbox dimensions per entity type
  const HITBOX = {
    infantry: { r: 0.55, h: 1.8 },   // cylinder: radius, height above groundY
    vehicle:  { hw: 2.0, hh: 1.2, hd: 3.0 }  // AABB half-extents
  };

  function update(dt, time, onImpact, buildings, entities, zoomFactor) {
    delayedProjectiles = delayedProjectiles.filter(item => {
      item.delay -= dt;
      if (item.delay > 0) return true;
      item.spawnFn();
      return false;
    });

    // Update reloads
    Object.values(WEAPONS).forEach(w => {
      if (w.reloading) {
        w.reloadProgress += dt / w.reloadTime;
        if (w.reloadProgress >= 1) {
          w.reloadProgress = 1;
          w.reloading = false;
          w.ammo = w.maxAmmo;
          // Reset heat after overheat cooldown
          if (w.overheated) {
            w.overheated = false;
            w.heat = 0;
          }
        }
      }
      // Passive heat cooling for 25mm when not overheated
      if (w.heat !== undefined && !w.overheated && !w.reloading) {
        w.heat = Math.max(0, w.heat - w.heatCoolRate * dt);
      }
    });

    // Update projectiles
    projectiles = projectiles.filter(p => {
      if (!p.alive) {
        _removeProjectile(p);
        return false;
      }

      p.age += dt;
      const maxAge = p.specialType === 'missile' ? 14 : (p.specialType === 'clusterCarrier' ? 8 : 6);
      if (p.age > maxAge) {
        p.alive = false;
        _removeProjectile(p);
        return false;
      }

      if (p.specialType === 'missile') {
        if (p.currentTargetRef && p.currentTargetRef.alive) {
          p.targetX = p.currentTargetRef.x;
          p.targetZ = p.currentTargetRef.z;
          p.targetY = TerrainSystem.getHeightAt(p.currentTargetRef.x, p.currentTargetRef.z) + 1.2;
          p.directTarget = p.currentTargetRef;
        }
        const desiredDir = new THREE.Vector3(
          p.targetX - p.x,
          p.targetY - p.y,
          p.targetZ - p.z
        ).normalize();
        const desiredSpeed = p.weapon.projectileSpeed;
        const turnRate = dt * 1.35;
        p.dx = Utils.lerp(p.dx, desiredDir.x * desiredSpeed, turnRate);
        p.dy = Utils.lerp(p.dy, desiredDir.y * desiredSpeed, turnRate);
        p.dz = Utils.lerp(p.dz, desiredDir.z * desiredSpeed, turnRate);
        p.trailTimer -= dt;
        if (p.trailTimer <= 0) {
          EffectsSystem.spawnTracer(p.x, p.y, p.z, p.x - desiredDir.x * 2.2, p.y - desiredDir.y * 2.2, p.z - desiredDir.z * 2.2, p.weapon.color, true);
          EffectsSystem.spawnMissileTrail(p.x, p.y, p.z, desiredDir.x, desiredDir.y, desiredDir.z);
          p.trailTimer = 0.05;
        }
      }

      if (p.specialType === 'clusterCarrier') {
        const clusterDir = new THREE.Vector3(p.dx, p.dy, p.dz);
        if (clusterDir.lengthSq() > 0.001) {
          clusterDir.normalize();
          p.trailTimer -= dt;
          if (p.trailTimer <= 0) {
            EffectsSystem.spawnTracer(p.x, p.y, p.z, p.x - clusterDir.x * 1.9, p.y - clusterDir.y * 1.9, p.z - clusterDir.z * 1.9, p.weapon.color, true);
            EffectsSystem.spawnMissileTrail(p.x, p.y, p.z, clusterDir.x, clusterDir.y, clusterDir.z);
            p.trailTimer = 0.06;
          }
        }
      }

      if (p.specialType === 'clusterCarrier') {
        const clusterGroundY = TerrainSystem.getHeightAt(p.x, p.z);
        const clusterAltitude = p.y - clusterGroundY;
        if (!p.submunitionsReleased && clusterAltitude < 18) {
          _releaseClusterBomb(p);
          p.alive = false;
          _removeProjectile(p);
          return false;
        }
      }

      // Drag
      const dragMult = Math.max(0, 1 - (PROJ_DRAG[p.weapon.id] || 0.3) * dt);
      p.dx *= dragMult; p.dy *= dragMult; p.dz *= dragMult;

      // No gravity on player projectiles — AC-130 fires nearly straight down from altitude;
      // gravity would deflect rounds below the crosshair aim point.

      p.x += p.dx * dt;
      p.y += p.dy * dt;
      p.z += p.dz * dt;
      p.mesh.position.set(p.x, p.y, p.z);

      // Directional blur: near the camera the tracer is very blurry;
      // blur fades as it travels toward the target.
      // Max blur also scales with zoom: fully zoomed in = most blur, zoomed out = least blur.
      const curSpeed = Math.hypot(p.dx, p.dy, p.dz);
      if (curSpeed > 0.5) {
        _pVelDir.set(p.dx, p.dy, p.dz).normalize();
        _pQuat.setFromUnitVectors(_pForward, _pVelDir);
        p.mesh.quaternion.copy(_pQuat);
        // proximity = 1 at gun origin, 0 at target
        const travelledDist = Math.hypot(p.x - p.startX, p.y - p.startY, p.z - p.startZ);
        const proximity = p.totalDist > 0 ? Math.max(0, 1 - travelledDist / p.totalDist) : 0;
        // zoomT: 0 = fully zoomed out (farthest), 1 = fully zoomed in (nearest ground)
        const zf = zoomFactor !== undefined ? zoomFactor : 1.0;
        const zoomT = Utils.clamp((zf - 0.85) / (1.6 - 0.85), 0, 1); // normalised 0–1
        const maxStretch = 4 + zoomT * 24;        // 4× when out, 28× when in
        const stretch = 1 + proximity * maxStretch;
        p.bodyMesh.scale.set(1, 1, stretch);
      } else {
        p.bodyMesh.scale.set(1, 1, 1);
      }

      // Building collision — player projectiles cannot pass through standing buildings
      if (buildings) {
        for (const b of buildings) {
          if (b.destroyed) continue;
          const hw = b.w / 2, hd = b.d / 2;
          if (Math.abs(p.x - b.x) < hw && Math.abs(p.z - b.z) < hd &&
              p.y > b.groundY && p.y < b.groundY + b.h) {
            p.alive = false;
            _removeProjectile(p);
            if (onImpact) onImpact(p);
            return false;
          }
        }
      }

      // Entity hitbox collision
      if (entities) {
        let hitEnt = null;
        for (const ent of entities) {
          if (!ent.alive) continue;
          const ex = ent.x, ez = ent.z;
          const groundY = TerrainSystem.getHeightAt(ex, ez);
          if (ent.type === 'vehicle') {
            const hb = HITBOX.vehicle;
            if (Math.abs(p.x - ex) < hb.hw &&
                Math.abs(p.z - ez) < hb.hd &&
                p.y >= groundY && p.y <= groundY + hb.hh * 2) {
              hitEnt = ent;
              break;
            }
          } else {
            // Infantry — cylinder test (XZ radius + Y height)
            const hb = HITBOX.infantry;
            const dx2 = p.x - ex, dz2 = p.z - ez;
            if (dx2 * dx2 + dz2 * dz2 < hb.r * hb.r &&
                p.y >= groundY && p.y <= groundY + hb.h) {
              hitEnt = ent;
              break;
            }
          }
        }
        if (hitEnt) {
          p.alive = false;
          _removeProjectile(p);
          // Override impact position to entity centre so explosion spawns on the unit
          const impactY = TerrainSystem.getHeightAt(hitEnt.x, hitEnt.z);
          const fakeProjAtEnt = { ...p, x: hitEnt.x, z: hitEnt.z, y: impactY };
          if (onImpact) onImpact(fakeProjAtEnt);
          return false;
        }
      }

      // Check if reached target height / ground
      const groundY = TerrainSystem.getHeightAt(p.x, p.z);
      if (p.y <= groundY + 0.5 || p.y <= p.targetY + 0.5) {
        if (p.specialType === 'clusterCarrier' && !p.submunitionsReleased) {
          _releaseClusterBomb(p);
          p.alive = false;
          _removeProjectile(p);
          return false;
        }
        p.alive = false;
        _removeProjectile(p);
        if (onImpact) onImpact(p);
        return false;
      }

      return true;
    });
  }

  function getProjectiles() { return projectiles; }

  function reset() {
    projectiles.forEach(_removeProjectile);
    projectiles = [];
    delayedProjectiles = [];
    progression = _sanitizeProgression(progression);
    _resetWeaponStates();
    currentSlot = 1;
    _syncCurrentWeapon();
  }

  return {
    init, selectWeapon, getCurrentWeapon, getWeapon, getAllWeapons,
    getCurrentSlot, getPrestige, getOwnedWeaponIds, isOwned, getLoadoutWeaponIds, getWeaponBySlot, getEquippedWeapons, getCatalog,
    awardPrestige, buyWeapon, equipWeapon,
    canFire, fire, manualReload, update, getProjectiles, reset
  };
})();
