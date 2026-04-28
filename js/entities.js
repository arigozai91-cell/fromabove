/* =============================================
   ENTITIES.JS — Enemy/friendly AI entities
   ============================================= */
'use strict';

const EntitySystem = (() => {

  let entities = [];
  let scene = null;
  let entityProjectiles = [];
  let _cachedBuildings = null;  // updated each frame via update()
  let _destroyBuildingCb = null; // set by game.js so entity projectiles can collapse buildings
  const ENTITY_PROJ_GRAVITY = 50; // world-units/s² for grenade/shell arc

  // Reusable THREE objects for entity projectile orientation
  const _epForward = new THREE.Vector3(0, 0, 1);
  const _epVelDir  = new THREE.Vector3();
  const _epQuat    = new THREE.Quaternion();

  // Radial gradient texture: greenish-white centre (opacity 0.25) -> transparent edge
  let _friendlyGlowTex = null;
  function getFriendlyGlowTex() {
    if (_friendlyGlowTex) return _friendlyGlowTex;
    const sz = 64;
    const canvas = document.createElement('canvas');
    canvas.width = sz; canvas.height = sz;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createRadialGradient(sz/2, sz/2, 0, sz/2, sz/2, sz/2);
    grad.addColorStop(0,   'rgba(200, 255, 210, 0.25)');
    grad.addColorStop(0.4, 'rgba(160, 255, 180, 0.12)');
    grad.addColorStop(1,   'rgba(120, 255, 150, 0)');
    ctx.clearRect(0, 0, sz, sz);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, sz, sz);
    _friendlyGlowTex = new THREE.CanvasTexture(canvas);
    return _friendlyGlowTex;
  }

  // Solid circle texture for the flash dot
  let _friendlyDotTex = null;
  function getFriendlyDotTex() {
    if (_friendlyDotTex) return _friendlyDotTex;
    const sz = 64;
    const canvas = document.createElement('canvas');
    canvas.width = sz; canvas.height = sz;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, sz, sz);
    ctx.beginPath();
    ctx.arc(sz/2, sz/2, sz/2 - 2, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(210, 255, 215, 1.0)';
    ctx.fill();
    _friendlyDotTex = new THREE.CanvasTexture(canvas);
    return _friendlyDotTex;
  }

  // ---------- Mesh builders ----------

  function makeInfantryMesh(color) {
    return UnitModelSystem.createMesh('hostile_infantry', { color });
  }

  function makeVehicleMesh(color, friendly = false, isTruck = false) {
    const type = isTruck ? (friendly ? 'friendly_vehicle' : 'hostile_vehicle') : (friendly ? 'friendly_tank' : 'hostile_tank');
    return UnitModelSystem.createMesh(type, { color });
  }

  function makeAPCMesh(color) {
    return UnitModelSystem.createMesh('hostile_apc', { color });
  }

  function _getInfantryModelType(hostile, infantryRole) {
    if (infantryRole === 'machineGunner') return hostile ? 'hostile_machine_gunner' : 'friendly_machine_gunner';
    if (infantryRole === 'antiTank') return hostile ? 'hostile_anti_tank' : 'friendly_anti_tank';
    return hostile ? 'hostile_infantry' : 'friendly_infantry';
  }

  function _getInfantryRoleFromType(type) {
    if (/machine_gunner$/.test(type)) return 'machineGunner';
    if (/anti_tank$/.test(type)) return 'antiTank';
    return 'rifleman';
  }

  function _getBazookaPriority(target) {
    if (!target || !target.alive) return 0;
    if (target.type === 'vehicle') {
      if (target.vehicleSubtype === 'tank') return 5;
      if (target.vehicleSubtype === 'apc') return 4;
      return 3;
    }
    if (target.type === 'staticStructure') {
      if (target.structureType === 'artillery') return 2.3;
      if (target.structureType === 'bunker') return 2.2;
      if (target.structureType === 'bofors') return 2.1;
    }
    if (target.type === 'infantry') return 1;
    return 0;
  }

    function _selectPriorityTarget(source, targets, maxRange) {
      let bestTarget = null;
      let bestDist = Infinity;
      let bestScore = -Infinity;
      targets.forEach(target => {
        const priority = _getBazookaPriority(target);
        if (priority <= 0) return;
        const d = Math.hypot(target.x - source.x, target.z - source.z);
        if (maxRange !== undefined && d > maxRange) return;
        const score = priority * 1000 - d;
        if (score > bestScore) {
          bestScore = score;
          bestDist = d;
          bestTarget = target;
        }
      });
      return { target: bestTarget, distance: bestDist, score: bestScore };
    }

  // ---------- Entity factory ----------

  function spawnInfantry(x, z, hostile, sceneRef, infantryRole = 'rifleman') {
    scene = sceneRef;
    const mesh = UnitModelSystem.createMesh(_getInfantryModelType(hostile, infantryRole));
    const groundY = TerrainSystem.getHeightAt(x, z);
    mesh.position.set(x, groundY, z);
    scene.add(mesh);

    let flashMesh = null;
    if (!hostile) {
      const flashGroup = new THREE.Group();
      // Solid circle dot
      const dotMat = new THREE.SpriteMaterial({
        map: getFriendlyDotTex(),
        color: new THREE.Color(0.7, 1.0, 0.72),
        transparent: true,
        opacity: 1.0,
        depthWrite: false
      });
      const dot = new THREE.Sprite(dotMat);
      dot.scale.set(0.5, 0.5, 1);
      flashGroup.add(dot);
      // Outer soft glow halo (10x)
      const glowMat = new THREE.SpriteMaterial({
        map: getFriendlyGlowTex(),
        color: new THREE.Color(0.5, 1.0, 0.55),
        blending: THREE.AdditiveBlending,
        transparent: true,
        opacity: 1.0,
        depthWrite: false
      });
      const glow = new THREE.Sprite(glowMat);
      glow.scale.set(18, 18, 1);
      flashGroup.add(glow);
      flashGroup.position.y = 1.75;
      flashGroup.visible = true;
      mesh.add(flashGroup);
      flashMesh = flashGroup;
    }

    const angle = Math.random() * Math.PI * 2;
    return {
      type: 'infantry',
      infantryRole,
      hostile,
      mesh,
      flashMesh,
      flashTimer: Math.random() * 1.0,  // stagger flickers between units
      flashOn: true,
      x, z,
      hp: 30,
      maxHp: 30,
      speed: hostile ? Utils.randFloat(2.5, 5) : Utils.randFloat(1.5, 3),
      angle,
      bodyAngle: angle,
      targetX: x, targetZ: z,
      nextTargetTime: 0,
      alive: true,
      dead: false,
      deadTimer: 0,
      heatDecay: 1.0,      // 1=normal, fades post-death
      scoreValue: 100,
      shootCooldown: infantryRole === 'machineGunner' ? Utils.randFloat(0.5, 1.1) : Utils.randFloat(1.5, 3.0),
      shootRange: infantryRole === 'machineGunner' ? 55 : 40,
      grenadeCooldown: infantryRole === 'rifleman' ? Utils.randFloat(40, 60) : undefined,
      mgAmmo: infantryRole === 'machineGunner' ? 50 : undefined,
      mgReloading: infantryRole === 'machineGunner' ? false : undefined,
      mgReloadTimer: infantryRole === 'machineGunner' ? 0 : undefined,
      bazookaCooldown: infantryRole === 'antiTank' ? Utils.randFloat(5, 10) : undefined,
      bazookaRange: infantryRole === 'antiTank' ? 180 : undefined,
      holdPositionTimer: 0,
      bazookaPrepTimer: infantryRole === 'antiTank' ? 0 : undefined,
      bazookaPrimed: infantryRole === 'antiTank' ? false : undefined,
      // Suppression / flee state (set by notifyExplosion)
      suppressedUntil: 0,
      fleeFromX: 0,
      fleeFromZ: 0,
      _wasSuppressed: false,
      _suppressPendingAt: Infinity,
      _pendingSuppressEnd: undefined,
      // Vehicle suppression phases: 'none' | 'flee' | 'freeze'
      _vSupPhase: 'none',
      _vSupPhaseEnd: 0,
      convoyMode: false,
      zombieMode: false,
      _stallAt: 0, _stallX: x, _stallZ: z,
      _navGoalX: x, _navGoalZ: z
    };
  }

  function spawnVehicle(x, z, hostile, sceneRef, subtype = null) {
    scene = sceneRef;
    // Determine subtype: friendly vehicles are always trucks; hostile default 50/50
    if (subtype === null) {
      subtype = !hostile ? 'truck' : (Math.random() < 0.5 ? 'tank' : 'truck');
    }
    const meshType = subtype === 'apc'
      ? (hostile ? 'hostile_apc' : 'friendly_apc')
      : subtype === 'tank'
        ? (hostile ? 'hostile_tank' : 'friendly_tank')
        : (hostile ? 'hostile_vehicle' : 'friendly_vehicle');
    const mesh = UnitModelSystem.createMesh(meshType);
    const groundY = TerrainSystem.getHeightAt(x, z);
    mesh.position.set(x, groundY, z);
    scene.add(mesh);

    let flashMesh = null;
    if (!hostile) {
      const flashGroup = new THREE.Group();
      // Solid circle dot
      const dotMat = new THREE.SpriteMaterial({
        map: getFriendlyDotTex(),
        color: new THREE.Color(0.7, 1.0, 0.72),
        transparent: true,
        opacity: 1.0,
        depthWrite: false
      });
      const dot = new THREE.Sprite(dotMat);
      dot.scale.set(0.6, 0.6, 1);
      flashGroup.add(dot);
      // Outer soft glow halo (10x)
      const glowMat = new THREE.SpriteMaterial({
        map: getFriendlyGlowTex(),
        color: new THREE.Color(0.5, 1.0, 0.55),
        blending: THREE.AdditiveBlending,
        transparent: true,
        opacity: 1.0,
        depthWrite: false
      });
      const glow = new THREE.Sprite(glowMat);
      glow.scale.set(24, 24, 1);
      flashGroup.add(glow);
      flashGroup.position.y = 2.2;
      flashGroup.visible = true;
      mesh.add(flashGroup);
      flashMesh = flashGroup;
    }

    const angle = Math.random() * Math.PI * 2;
    // Find turret pivot mesh for tank/APC so it can be rotated independently
    let turretMesh = null;
    if (subtype === 'tank' || subtype === 'apc') {
      mesh.traverse(child => {
        if (!turretMesh && child.userData && child.userData.isTurret) turretMesh = child;
      });
    }
    return {
      type: 'vehicle',
      vehicleSubtype: subtype,
      hostile,
      mesh,
      flashMesh,
      flashTimer: Math.random() * 1.0,
      flashOn: true,
      x, z,
      hp: subtype === 'tank' ? 600 : subtype === 'apc' ? 450 : 150,
      maxHp: subtype === 'tank' ? 600 : subtype === 'apc' ? 450 : 150,
      speed: (hostile ? Utils.randFloat(4, 8) : Utils.randFloat(3, 5)) * (subtype === 'tank' ? 0.5 : 1),
      angle,
      bodyAngle: angle,
      turretMesh,
      turretAngle: angle,
      targetX: x, targetZ: z,
      nextTargetTime: 0,
      alive: true,
      dead: false,
      deadTimer: 0,
      heatDecay: 1.0,
      scoreValue: 500,
      shootCooldown: Utils.randFloat(2.0, 4.0),
      shootRange: subtype === 'tank' ? 180 : subtype === 'apc' ? 110 : 80,
      shellCooldown: subtype === 'tank' ? Utils.randFloat(5, 10) : undefined,
      tankFirePhase: subtype === 'tank' ? 'idle' : undefined,
      tankFireTimer: subtype === 'tank' ? 0 : undefined,
      apcBurstRemaining: subtype === 'apc' ? 3 : undefined,
      apcReloading: subtype === 'apc' ? false : undefined,
      apcReloadTimer: subtype === 'apc' ? 0 : undefined,
      // Suppression / flee state (set by notifyExplosion)
      suppressedUntil: 0,
      fleeFromX: 0,
      fleeFromZ: 0,
      _wasSuppressed: false,
      _suppressPendingAt: Infinity,
      // Vehicle suppression phases: 'none' | 'flee' | 'freeze'
      _vSupPhase: 'none',
      _vSupPhaseEnd: 0,
      convoyMode: false,
      _stallAt: 0, _stallX: x, _stallZ: z,
      _navGoalX: x, _navGoalZ: z
    };
  }

  // ---------- Static Structure Entity (bunker / bofors / artillery) ----------
  // These are treated as units for all collision, damage, and targeting purposes.
  // speed = 0, they never move. Faction determined by `hostile` flag.

  function _makeStructureMesh(structureType, hostile) {
    const heat   = hostile ? 0.75 : 0.35;
    const tint   = hostile
      ? new THREE.Color(heat, heat * 0.25, heat * 0.18)
      : new THREE.Color(heat * 0.65, heat, heat * 0.55);
    const g = new THREE.Group();

    if (structureType === 'bunker') {
      // Cylinder body
      const body = new THREE.Mesh(
        new THREE.CylinderGeometry(2.5, 2.8, 4.0, 12),
        new THREE.MeshBasicMaterial({ color: tint })
      );
      body.position.y = 2.0; g.add(body);
      const top = new THREE.Mesh(
        new THREE.CylinderGeometry(2.7, 2.7, 0.5, 12),
        new THREE.MeshBasicMaterial({ color: tint.clone().multiplyScalar(0.7) })
      );
      top.position.y = 4.25; g.add(top);
      const barrelMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.15, 0.15, 0.15) });
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 1.8, 6), barrelMat);
      barrel.rotation.x = Math.PI / 2;
      barrel.position.set(0, 4.6, 1.0); g.add(barrel);

    } else if (structureType === 'bofors') {
      const base = new THREE.Mesh(new THREE.BoxGeometry(5.0, 0.8, 5.0), new THREE.MeshBasicMaterial({ color: tint }));
      base.position.y = 0.4; g.add(base);
      const turretPivot = new THREE.Group();
      turretPivot.position.set(0, 1.7, 0);
      g.add(turretPivot);
      const mount = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.9, 1.8, 8), new THREE.MeshBasicMaterial({ color: tint.clone().multiplyScalar(0.7) }));
      turretPivot.add(mount);
      const cradle = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.9, 2.5), new THREE.MeshBasicMaterial({ color: tint }));
      cradle.position.set(0, 1.1, 0.3); turretPivot.add(cradle);
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 5.5, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.15, 0.15, 0.12) }));
      barrel.rotation.x = Math.PI / 2 - 0.26;
      barrel.position.set(0, 1.5, 1.8); turretPivot.add(barrel);
      g.userData.turretPivot = turretPivot;

    } else { // artillery / howitzer
      const carMat  = new THREE.MeshBasicMaterial({ color: tint });
      const darkMat = new THREE.MeshBasicMaterial({ color: tint.clone().multiplyScalar(0.6) });
      const barrelMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.12, 0.12, 0.10) });
      const carriage = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.7, 1.8), carMat);
      carriage.position.set(0, 0.35, 0.3); g.add(carriage);
      const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 3.2, 6), darkMat);
      axle.rotation.z = Math.PI / 2; axle.position.set(0, 0.65, 0.3); g.add(axle);
      [-1.6, 1.6].forEach(wx => {
        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.65, 0.65, 0.25, 10), darkMat);
        wheel.rotation.z = Math.PI / 2; wheel.position.set(wx, 0.65, 0.3); g.add(wheel);
      });
      const breech = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.8, 0.9), darkMat);
      breech.position.set(0, 1.15, 0.2); g.add(breech);
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.20, 7.0, 6), barrelMat);
      barrel.rotation.x = Math.PI / 2 - 0.44;
      barrel.position.set(0, 2.69, 3.37); g.add(barrel);
    }

    return g;
  }

  function spawnStaticStructure(structureType, x, z, hostile, sceneRef) {
    const s = sceneRef || scene;
    scene = s;
    const groundY = TerrainSystem.getHeightAt(x, z);
    const mesh = _makeStructureMesh(structureType, hostile);
    mesh.position.set(x, groundY, z);
    s.add(mesh);

    const hp      = structureType === 'bunker' ? 1000 : structureType === 'bofors' ? 500 : 300;
    const range   = structureType === 'bunker' ? 50  : structureType === 'bofors' ? 120 : 200;
    const score   = structureType === 'artillery' ? 800 : structureType === 'bofors' ? 600 : 400;

    return {
      type:            'staticStructure',
      structureType,
      hostile,
      mesh,
      turretMesh:       mesh.userData.turretPivot || null,
      flashMesh:       null,
      x, z,
      hp,  maxHp: hp,
      speed:           0,
      angle:           0,
      bodyAngle:       0,
      turretAngle:     0,
      targetX: x, targetZ: z,
      nextTargetTime:  Infinity,
      alive:           true,
      dead:            false,
      deadTimer:       0,
      heatDecay:       1.0,
      scoreValue:      score,
      // Shooting state
      shootCooldown:   structureType === 'bunker' ? 0.15 : structureType === 'bofors' ? 0.33 : 3.0,
      shootRange:      range,
      // Bofors clip
      ammo:            structureType === 'bofors' ? 15 : undefined,
      reloading:       structureType === 'bofors' ? false : undefined,
      reloadTimer:     structureType === 'bofors' ? 0 : undefined,
      // Suppression stubs (required by main loop references)
      suppressedUntil: 0,
      fleeFromX:       0, fleeFromZ: 0,
      _wasSuppressed:  false,
      _suppressPendingAt: Infinity,
      _vSupPhase:      'none',
      _vSupPhaseEnd:   0,
      convoyMode:      false,
      _stallAt:        0, _stallX: x, _stallZ: z,
      _navGoalX:       x, _navGoalZ: z,
    };
  }

  function _getStaticStructureDims(structureType) {
    return structureType === 'bunker'  ? { w: 5, d: 5, h: 4.0 }
         : structureType === 'bofors'  ? { w: 5, d: 5, h: 5.5 }
         :                               { w: 4, d: 9, h: 4.5 };
  }

  function addEntity(entity) {
    if (!entity) return null;
    entities.push(entity);
    return entity;
  }

  function spawnAll(sceneRef, mission) {
    scene = sceneRef;
    entities = [];
    const { infantryCount, vehicleCount, friendlyInfantry, friendlyVehicles, holdMode } = mission;

    // ---- Custom editor mission — even with zero units placed, never fall through to random spawning ----
    if (Array.isArray(mission.customUnits)) {
      const hWPs = (mission.hostileWaypoints  || []);
      const fWPs = (mission.friendlyWaypoints || []);
      mission.customUnits.forEach(u => {
        const hostile    = /^hostile_/.test(u.type);
        const isVehicle  = u.type === 'hostile_vehicle' || u.type === 'friendly_vehicle'
                        || u.type === 'hostile_tank' || u.type === 'friendly_tank'
                        || u.type === 'hostile_apc' || u.type === 'friendly_apc';
        const subtype    = (u.type === 'hostile_tank' || u.type === 'friendly_tank') ? 'tank'
                         : (u.type === 'hostile_apc' || u.type === 'friendly_apc') ? 'apc'
                         : (u.type === 'hostile_vehicle' || u.type === 'friendly_vehicle') ? 'truck' : null;
        const infantryRole = _getInfantryRoleFromType(u.type);

        // Static structures: bunker, bofors, artillery (friendly or hostile)
        const structMatch = u.type.match(/^(hostile_|friendly_)?(bunker|bofors|artillery)$/);
        if (structMatch) {
          const isHostileStruct = u.type.startsWith('hostile_');
          const sType = structMatch[2];
          addEntity(spawnStaticStructure(sType, u.x, u.z, isHostileStruct, sceneRef));
          return;
        }

        let ent;
        if (isVehicle) {
          ent = spawnVehicle(u.x, u.z, hostile, sceneRef, subtype);
        } else {
          ent = spawnInfantry(u.x, u.z, hostile, sceneRef, infantryRole);
        }
        // Assign waypoints if any exist for this faction
        const wps = hostile ? hWPs : fWPs;
        if (wps.length > 0) {
          ent.waypoints    = wps;      // [{x,z,letter}, …] in A→B→C order
          ent.waypointIdx  = 0;        // next waypoint to head to
          ent.targetX      = wps[0].x;
          ent.targetZ      = wps[0].z;
          ent.nextTargetTime = Infinity; // block random AI targeting
        }
        entities.push(ent);
      });
      return entities;
    }

    if (holdMode) {
      // Mission 1: friendlies cluster near center (within 18 units), hostiles spawn at map edge
      for (let i = 0; i < friendlyInfantry; i++) {
        const angle = Math.random() * Math.PI * 2;
        const r = Utils.randFloat(4, 18);
        const ent = spawnInfantry(Math.cos(angle) * r, Math.sin(angle) * r, false, sceneRef);
        ent.holdMode = true;  // flag: stay near center
        entities.push(ent);
      }
      for (let i = 0; i < friendlyVehicles; i++) {
        const angle = Math.random() * Math.PI * 2;
        const r = Utils.randFloat(5, 15);
        const ent = spawnVehicle(Math.cos(angle) * r, Math.sin(angle) * r, false, sceneRef);
        ent.holdMode = true;
        entities.push(ent);
      }
      const friendlyApcs = mission.friendlyApcs || 0;
      for (let i = 0; i < friendlyApcs; i++) {
        const angle = Math.random() * Math.PI * 2;
        const r = Utils.randFloat(5, 15);
        const ent = spawnVehicle(Math.cos(angle) * r, Math.sin(angle) * r, false, sceneRef, 'apc');
        ent.holdMode = true;
        entities.push(ent);
      }
      // Hostile spawn in groups of 5 infantry + ~2 vehicles from same edge point
      const INFANTRY_PER_GROUP = 5;
      const groupCount = Math.ceil(infantryCount / INFANTRY_PER_GROUP);
      let vSpawned = 0;
      for (let g = 0; g < groupCount; g++) {
        const origin = spawnAtEdge(175);
        const inGroup = Math.min(INFANTRY_PER_GROUP, infantryCount - g * INFANTRY_PER_GROUP);
        for (let i = 0; i < inGroup; i++) {
          const px = origin.x + Utils.randFloat(-8, 8);
          const pz = origin.z + Utils.randFloat(-8, 8);
          entities.push(spawnInfantry(px, pz, true, sceneRef));
        }
        const vInGroup = Math.min(2, vehicleCount - vSpawned);
        for (let v = 0; v < vInGroup; v++) {
          const px = origin.x + Utils.randFloat(-6, 6);
          const pz = origin.z + Utils.randFloat(-6, 6);
          entities.push(spawnVehicle(px, pz, true, sceneRef));
          vSpawned++;
        }
      }
      // Spawn any remaining vehicles that didn't fit into groups
      while (vSpawned < vehicleCount) {
        const origin = spawnAtEdge(170);
        entities.push(spawnVehicle(origin.x, origin.z, true, sceneRef));
        vSpawned++;
      }
    } else if (mission.convoyMode) {
      // Mission 2: convoy line approaching from a random map edge toward center
      const convoyAngle = Math.random() * Math.PI * 2;
      const perpAngle   = convoyAngle + Math.PI / 2;
      const startDist   = 150;
      const spacing     = 9; // meters between convoy slots

      let vSpawned = 0, iSpawned = 0;
      const totalSlots = vehicleCount + infantryCount;
      for (let i = 0; i < totalSlots; i++) {
        const d      = startDist - i * spacing;
        const jitter = Utils.randFloat(-4, 4);
        const cx = Math.cos(convoyAngle) * d + Math.cos(perpAngle) * jitter;
        const cz = Math.sin(convoyAngle) * d + Math.sin(perpAngle) * jitter;

        // Place a vehicle every 3rd slot; fill rest with infantry
        const useVehicle = (i % 3 === 1) && vSpawned < vehicleCount;
        if (useVehicle) {
          const ent = spawnVehicle(cx, cz, true, sceneRef);
          ent.convoyMode = true;
          entities.push(ent);
          vSpawned++;
        } else if (iSpawned < infantryCount) {
          const ent = spawnInfantry(cx, cz, true, sceneRef);
          ent.convoyMode = true;
          entities.push(ent);
          iSpawned++;
        } else {
          const ent = spawnVehicle(cx, cz, true, sceneRef);
          ent.convoyMode = true;
          entities.push(ent);
          vSpawned++;
        }
      }

      // Friendly squads: one on each perpendicular side of the convoy, far away
      const SQUAD_DIST = 130;
      [-1, 1].forEach(side => {
        const sx = Math.cos(perpAngle) * SQUAD_DIST * side;
        const sz = Math.sin(perpAngle) * SQUAD_DIST * side;
        // 2 soldiers
        for (let i = 0; i < 2; i++) {
          const sol = spawnInfantry(
            sx + Utils.randFloat(-6, 6),
            sz + Utils.randFloat(-6, 6),
            false, sceneRef
          );
          entities.push(sol);
        }
        // 1 tank
        const sqTank = spawnVehicle(
          sx + Utils.randFloat(-4, 4),
          sz + Utils.randFloat(-4, 4),
          false, sceneRef, 'tank'
        );
        entities.push(sqTank);
      });
    } else if (mission.zombieWaveMode) {
      // DEAD WAVE: friendlies hold center stationary, no initial hostiles — waves spawn via MissionSystem
      for (let i = 0; i < friendlyInfantry; i++) {
        const angle = Math.random() * Math.PI * 2;
        const r = Utils.randFloat(3, 15);
        const ent = spawnInfantry(Math.cos(angle) * r, Math.sin(angle) * r, false, sceneRef);
        ent.holdMode = true;
        entities.push(ent);
      }
      // Patrol: 2 friendly trucks + 1 friendly tank roaming near center
      for (let i = 0; i < 2; i++) {
        const a = Math.random() * Math.PI * 2;
        const r = Utils.randFloat(50, 80);
        const ent = spawnVehicle(Math.cos(a) * r, Math.sin(a) * r, false, sceneRef);
        ent.patrolMode = true;
        ent.patrolRadius = 60;
        entities.push(ent);
      }
      const ta = Math.random() * Math.PI * 2;
      const tr = Utils.randFloat(50, 80);
      const tank = spawnVehicle(Math.cos(ta) * tr, Math.sin(ta) * tr, false, sceneRef, 'tank');
      tank.patrolMode = true;
      tank.patrolRadius = 60;
      entities.push(tank);
    } else {
      // Default spawning
      for (let i = 0; i < infantryCount; i++) {
        const p = Utils.randomSpawnPos(160, 30);
        entities.push(spawnInfantry(p.x, p.z, true, sceneRef));
      }
      for (let i = 0; i < vehicleCount; i++) {
        const p = Utils.randomSpawnPos(150, 40);
        entities.push(spawnVehicle(p.x, p.z, true, sceneRef));
      }
      for (let i = 0; i < friendlyInfantry; i++) {
        const p = Utils.randomSpawnPos(60, 5);
        entities.push(spawnInfantry(p.x, p.z, false, sceneRef));
      }
      for (let i = 0; i < friendlyVehicles; i++) {
        const p = Utils.randomSpawnPos(50, 5);
        entities.push(spawnVehicle(p.x, p.z, false, sceneRef));
      }
    }

    return entities;
  }

  // 2-D segment vs AABB test — returns false if the segment (x1,z1)→(x2,z2)
  // is blocked by any standing building.  Uses slab / parametric intersection.
  function hasLineOfSight(x1, z1, x2, z2, buildings) {
    if (!buildings) return true;
    const dx = x2 - x1;
    const dz = z2 - z1;
    const len = Math.hypot(dx, dz) || 1;
    const invDX = dx === 0 ? Infinity : len / dx;  // 1 / (dx/len)
    const invDZ = dz === 0 ? Infinity : len / dz;
    for (let i = 0; i < buildings.length; i++) {
      const b = buildings[i];
      if (b.destroyed) continue;
      const halfW = b.w / 2 + 0.3;
      const halfD = b.d / 2 + 0.3;
      const ox = x1 - b.x;
      const oz = z1 - b.z;
      const t1x = (-halfW - ox) * invDX;
      const t2x = ( halfW - ox) * invDX;
      const t1z = (-halfD - oz) * invDZ;
      const t2z = ( halfD - oz) * invDZ;
      const tmin = Math.max(Math.min(t1x, t2x), Math.min(t1z, t2z));
      const tmax = Math.min(Math.max(t1x, t2x), Math.max(t1z, t2z));
      if (tmax > 0 && tmin < tmax && tmin < len) return false;
    }
    return true;
  }

  // Spawn position on a random map edge
  function spawnAtEdge(radius) {
    const angle = Math.random() * Math.PI * 2;
    return { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius };
  }

  // ---------- Update loop ----------

  // Spawn a lofted arc projectile from an entity (grenade / tank shell)
  function spawnEntityProjectile(sx, sy, sz, tx, ty, tz, stats, ownerHostile) {
    const ddx = tx - sx;
    const ddy = ty - sy;
    const ddz = tz - sz;
    const hDist = Math.hypot(ddx, ddz) || 1;
    const geo = new THREE.SphereGeometry(stats.radius, 5, 5);
    const mat = new THREE.MeshBasicMaterial({ color: stats.color });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(sx, sy, sz);
    scene.add(mesh);
    let trailMesh = null;
    if (stats.trail) {
      const trailGeo = new THREE.CylinderGeometry(stats.radius * 1.8, stats.radius * 0.7, 1, 6, 1, true);
      trailGeo.rotateX(Math.PI / 2);
      const trailMat = new THREE.MeshBasicMaterial({
        color: stats.trailColor || stats.color,
        transparent: true,
        opacity: 0.45,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      });
      trailMesh = new THREE.Mesh(trailGeo, trailMat);
      trailMesh.position.set(sx, sy, sz);
      scene.add(trailMesh);
    }
    let vx, vy, vz, useGravity;
    if (stats.useGravity === false) {
      // Straight-line shot toward target
      const dist3 = Math.hypot(ddx, ddy, ddz) || 1;
      vx = (ddx / dist3) * stats.speed;
      vy = (ddy / dist3) * stats.speed;
      vz = (ddz / dist3) * stats.speed;
      useGravity = false;
    } else {
      // Lob arc with gravity — derive T from desired horizontal speed, then back-calculate
      // all three velocity components so the projectile lands exactly on (tx, ty, tz).
      // Using vx = ddx/T (not dir*speed) guarantees correctness even when T is clamped.
      const T = Math.max(1.0, hDist / stats.speed);
      vx = ddx / T;
      vz = ddz / T;
      vy = (ddy + 0.5 * ENTITY_PROJ_GRAVITY * T * T) / T;
      useGravity = true;
    }
    const initialSpeed = Math.hypot(vx, vy, vz);
    entityProjectiles.push({
      mesh, x: sx, y: sy, z: sz,
      dx: vx, dy: vy, dz: vz,
      initialSpeed, useGravity, ownerHostile, stats, trailMesh, alive: true, age: 0
    });
  }

  function _cleanupEntityProjectile(ep) {
    [ep.mesh, ep.trailMesh].forEach(mesh => {
      if (!mesh) return;
      if (scene) scene.remove(mesh);
      if (mesh.geometry) mesh.geometry.dispose();
      if (mesh.material) mesh.material.dispose();
    });
  }

  // Deal AOE damage and spawn explosion at entity projectile impact point
  function entityProjectileImpact(ep, ix, iy, iz) {
    const { stats, ownerHostile } = ep;
    const showImpactGlare = stats.isApc || stats.isTankShell || stats.isMissile;
    const explosionOptions = {
      surfaceFlash: !showImpactGlare,
      ...(stats.isTankShell || stats.isMissile ? { shockwaveStyle: 'billboard' } : {}),
      ...(stats.isTankShell ? { smokeScale: 0.75 } : {})
    };
    if (stats.isApc) AudioSystem.play20mmImpact();
    if (stats.noEffect) {
      // No-particle hit — light flash + shockwave only, no sparks or smoke
      EffectsSystem.spawnExplosionLight(ix, iy, iz, stats.explosionSize, explosionOptions);
    } else {
      EffectsSystem.spawnExplosion(ix, iy, iz, stats.explosionSize, explosionOptions);
    }
    if (showImpactGlare) {
      EffectsSystem.spawnSurfaceFlash(ix, iz, stats.explosionSize);
    }
    if (typeof HUDSystem !== 'undefined' && showImpactGlare) {
      HUDSystem.spawnExplosionGlare(ix, iy, iz, stats.isMissile ? 6 : 3, stats.explosionSize, {
        sizeScale: 0.45,
        opacityScale: 0.5
      });
    }
    const aoe = stats.aoeRadius;
    entities.forEach(ent => {
      if (!ent.alive || ent.hostile === ownerHostile) return;
      const dist = Math.hypot(ent.x - ix, ent.z - iz);
      if (dist < aoe) {
        const falloff = Math.max(0, 1 - dist / aoe);
        takeDamage(ent, stats.damage * falloff);
      }
    });
    // Apply damage to buildings (hostile projectiles only, friendly structures + HQ)
    if (ownerHostile && _cachedBuildings) {
      _cachedBuildings.forEach(b => {
        if (b.destroyed || (!b.isDeployed && !b.isHQ)) return;
        const dist = Math.hypot(b.x - ix, b.z - iz);
        const hitRange = Math.max(b.w || 4, b.d || 4) / 2 + (aoe > 1 ? aoe * 0.3 : 1.5);
        if (dist < hitRange) {
          const falloff = aoe > 1 ? Math.max(0.2, 1 - dist / (aoe + hitRange)) : 1;
          b.hp -= stats.damage * falloff;
          if (b.hp <= 0 && !b.destroyed) {
            if (_destroyBuildingCb) _destroyBuildingCb(b, ix, iz);
          }
        }
      });
    }
    // Apply damage from friendly projectiles to hostile deployed structures
    if (!ownerHostile && _cachedBuildings) {
      _cachedBuildings.forEach(b => {
        if (b.destroyed || !b.isHostileDeployed) return;
        const dist = Math.hypot(b.x - ix, b.z - iz);
        const hitRange = Math.max(b.w || 4, b.d || 4) / 2 + (aoe > 1 ? aoe * 0.3 : 1.5);
        if (dist < hitRange) {
          const falloff = aoe > 1 ? Math.max(0.2, 1 - dist / (aoe + hitRange)) : 1;
          b.hp -= stats.damage * falloff;
          if (b.hp <= 0 && !b.destroyed) {
            if (_destroyBuildingCb) _destroyBuildingCb(b, ix, iz);
          }
        }
      });
    }
  }

  // Shortest-path angle interpolation
  function _lerpAngle(from, to, t) {
    let d = to - from;
    while (d >  Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return from + d * Math.min(1, t);
  }

  function update(dt, time, buildings) {
    _cachedBuildings = buildings || _cachedBuildings;
    const FIELD = TerrainSystem.FIELD_SIZE / 2 - 5;
    const livingFriendlies = [];
    const livingHostiles = [];
    const livingFriendlyMobiles = [];
    const livingHostileMobiles = [];
    const livingFriendlyStructures = [];
    const livingHostileStructures = [];

    entities.forEach(entity => {
      if (!entity.alive) return;
      if (entity.hostile) {
        livingHostiles.push(entity);
        if (entity.type === 'staticStructure') livingHostileStructures.push(entity);
        else livingHostileMobiles.push(entity);
      } else {
        livingFriendlies.push(entity);
        if (entity.type === 'staticStructure') livingFriendlyStructures.push(entity);
        else livingFriendlyMobiles.push(entity);
      }
    });

    entities.forEach(ent => {
      // ---- Static structures: skip ALL movement/AI, handle only shooting + death ----
      if (ent.type === 'staticStructure') {
        if (!ent.alive) return; // mesh handled by game.js collapse animation

        const opponents = ent.hostile ? livingFriendlyMobiles : livingHostileMobiles;
        const enemyStructures = ent.hostile ? livingFriendlyStructures : livingHostileStructures;
        const allTargets = opponents.concat(enemyStructures);

        ent.shootCooldown -= dt;

        if (ent.structureType === 'bunker') {
          if (ent.shootCooldown <= 0) {
            let nearest = null, nearestDist = Infinity;
            allTargets.forEach(t => {
              const d = Math.hypot(t.x - ent.x, t.z - ent.z);
              if (d < nearestDist) { nearestDist = d; nearest = t; }
            });
            if (nearest && nearestDist < ent.shootRange) {
              ent.shootCooldown = 0.1 + Math.random() * 0.1;
              const fromY = TerrainSystem.getHeightAt(ent.x, ent.z) + 4.6;
              const tgY   = TerrainSystem.getHeightAt(nearest.x, nearest.z) + 0.9;
              const acc   = 1 - (nearestDist / ent.shootRange) * 0.5;
              const sp    = Math.random() < acc ? 0 : Math.random() * nearestDist * 0.25;
              const a     = Math.random() * Math.PI * 2;
              spawnEntityProjectile(ent.x, fromY, ent.z,
                nearest.x + Math.cos(a) * sp, tgY, nearest.z + Math.sin(a) * sp,
                { speed: 95, radius: 0.10,
                  color: ent.hostile ? new THREE.Color(0.9, 0.4, 0.3) : new THREE.Color(0.5, 0.9, 0.55),
                  aoeRadius: 0.8, damage: 5 + Math.random() * 7,
                  explosionSize: 0.0625, useGravity: false, noEffect: true },
                ent.hostile);
              AudioSystem.playRifle();
            } else {
              ent.shootCooldown = 0.1;
            }
          }

        } else if (ent.structureType === 'bofors') {
          if (ent.reloading) {
            ent.reloadTimer -= dt;
            if (ent.reloadTimer <= 0) { ent.reloading = false; ent.ammo = 15; }
          } else if (ent.shootCooldown <= 0 && ent.ammo > 0) {
            const subPriority = { tank: 4, apc: 3, truck: 2, infantry: 1 };
            let target = null, bestScore = -Infinity;
            allTargets.forEach(t => {
              const d = Math.hypot(t.x - ent.x, t.z - ent.z);
              if (d >= ent.shootRange) return;
              const sub = t.vehicleSubtype || (t.type === 'vehicle' ? 'truck' : 'infantry');
              const score = (subPriority[sub] || 1) * 1000 - d;
              if (score > bestScore) { bestScore = score; target = t; }
            });
            if (target) {
              const targetAngle = Math.atan2(target.x - ent.x, target.z - ent.z);
              ent.turretAngle = targetAngle;
              if (ent.turretMesh) ent.turretMesh.rotation.y = ent.turretAngle;
              ent.shootCooldown = 1 / 3;
              ent.ammo--;
              const fromY = TerrainSystem.getHeightAt(ent.x, ent.z) + 3.2;
              const tgY   = TerrainSystem.getHeightAt(target.x, target.z) + 1.0;
              const dist  = Math.hypot(target.x - ent.x, target.z - ent.z);
              const acc   = 1 - (dist / ent.shootRange) * 0.20;
              const miss  = Math.random() > acc;
              const a     = Math.random() * Math.PI * 2;
              spawnEntityProjectile(ent.x, fromY, ent.z,
                target.x + (miss ? Math.cos(a) * dist * 0.12 : 0),
                tgY,
                target.z + (miss ? Math.sin(a) * dist * 0.12 : 0),
                { speed: 130, radius: 0.35,
                  color: ent.hostile ? new THREE.Color(1.0, 0.4, 0.2) : new THREE.Color(1.0, 0.85, 0.3),
                  aoeRadius: 8, damage: 80, explosionSize: 1.2, useGravity: false },
                ent.hostile);
              AudioSystem.play20mmImpact();
              if (ent.ammo <= 0) { ent.reloading = true; ent.reloadTimer = 10; }
            } else {
              ent.shootCooldown = 0.1;
            }
          }

        } else if (ent.structureType === 'artillery') {
          if (ent.shootCooldown <= 0) {
            let target = null, nearestDist = Infinity;
            allTargets.forEach(t => {
              const d = Math.hypot(t.x - ent.x, t.z - ent.z);
              if (d < nearestDist) { nearestDist = d; target = t; }
            });
            if (target && nearestDist < ent.shootRange) {
              const targetAngle = Math.atan2(target.x - ent.x, target.z - ent.z);
              ent.bodyAngle = targetAngle;
              ent.mesh.rotation.y = ent.bodyAngle;
              ent.shootCooldown = 10;
              const fromY = TerrainSystem.getHeightAt(ent.x, ent.z) + 4.2;
              const tgY   = TerrainSystem.getHeightAt(target.x, target.z);
              const acc   = 1 - (nearestDist / ent.shootRange) * 0.40;
              const miss  = Math.random() > acc;
              const a     = Math.random() * Math.PI * 2;
              spawnEntityProjectile(ent.x, fromY, ent.z,
                target.x + (miss ? Math.cos(a) * nearestDist * 0.20 : 0),
                tgY,
                target.z + (miss ? Math.sin(a) * nearestDist * 0.20 : 0),
                { speed: 60, radius: 0.40,
                  color: ent.hostile ? new THREE.Color(1.0, 0.4, 0.15) : new THREE.Color(1.0, 0.7, 0.2),
                  aoeRadius: 22, damage: 280, explosionSize: 2.5, useGravity: true },
                ent.hostile);
            } else {
              ent.shootCooldown = 2;
            }
          }
        }
        return; // skip normal movement/AI update for static structures
      }

      if (!ent.alive) {
        // Animate dying / smoke
        ent.deadTimer += dt;
        if (ent.deadTimer > 0.05 && !ent.dead) {
          ent.dead = true;
          // Flatten mesh
          ent.mesh.scale.y = 0.1;
          ent.mesh.rotation.z = Math.PI / 2;
        }
        // Cool down heat signature
        ent.heatDecay = Math.max(0, ent.heatDecay - dt * 0.08);
        const c = ent.mesh.children[0];
        if (c && c.material) {
          const h = ent.heatDecay * 0.3;
          c.material.color.setRGB(h, h * 0.8, h * 0.5);
        }
        return;
      }

      // ---- Suppression / Flee (hostile units react to nearby explosions) ----
      if (ent.hostile && !ent.zombieMode) {
        if (ent.type === 'vehicle') {
          // --- Vehicle: flee (3s) → freeze (3s) → resume ---
          if (ent._vSupPhase === 'none' && time < ent.suppressedUntil) {
            // New suppression event — start random flee
            const fleeAngle = Math.random() * Math.PI * 2;
            ent._vSupPhase    = 'flee';
            ent._vSupPhaseEnd = time + 3;
            ent.targetX = Utils.clamp(ent.x + Math.cos(fleeAngle) * 80, -FIELD, FIELD);
            ent.targetZ = Utils.clamp(ent.z + Math.sin(fleeAngle) * 80, -FIELD, FIELD);
            ent.nextTargetTime = time + 10; // block normal waypoint picking
          } else if (ent._vSupPhase === 'flee') {
            if (time >= ent._vSupPhaseEnd) {
              // Flee done — enter freeze
              ent._vSupPhase    = 'freeze';
              ent._vSupPhaseEnd = time + 3;
              ent.targetX       = ent.x;
              ent.targetZ       = ent.z;
              ent.nextTargetTime = time + 10;
            }
            // If another explosion hits during flee, keep fleeing (extend window)
            if (time < ent.suppressedUntil) {
              ent._vSupPhaseEnd = Math.max(ent._vSupPhaseEnd, time + 1.5);
            }
          } else if (ent._vSupPhase === 'freeze') {
            ent.targetX = ent.x;
            ent.targetZ = ent.z;
            ent.nextTargetTime = time + 10;
            if (time >= ent._vSupPhaseEnd) {
              // Done — resume objective
              ent._vSupPhase    = 'none';
              ent.nextTargetTime = 0;
            }
          }
        } else {
          // --- Infantry: 1s delay, then freeze while being shelled, then sprint away ---
          if (ent._suppressPendingAt !== Infinity && time >= ent._suppressPendingAt) {
            // Delay elapsed — activate suppression now
            ent.suppressedUntil    = ent._pendingSuppressEnd || (time + suppress);
            ent._suppressPendingAt = Infinity;
            ent._pendingSuppressEnd = undefined;
          }
          if (time < ent.suppressedUntil) {
            if (!ent._wasSuppressed) {
              // First frame of suppression — set crawl-away target once so building
              // avoidance can still redirect us on subsequent frames
              const _cfx = ent.x - ent.fleeFromX;
              const _cfz = ent.z - ent.fleeFromZ;
              const _cfl = Math.hypot(_cfx, _cfz) || 1;
              ent.targetX = Utils.clamp(ent.x + (_cfx / _cfl) * 60, -FIELD, FIELD);
              ent.targetZ = Utils.clamp(ent.z + (_cfz / _cfl) * 60, -FIELD, FIELD);
              ent.nextTargetTime = time + 10;
            }
            ent._wasSuppressed = true;
          } else if (ent._wasSuppressed) {
            ent._wasSuppressed = false;
            const fx = ent.x - ent.fleeFromX;
            const fz = ent.z - ent.fleeFromZ;
            const flen = Math.hypot(fx, fz) || 1;
            ent.targetX = Utils.clamp(ent.x + (fx / flen) * 60, -FIELD, FIELD);
            ent.targetZ = Utils.clamp(ent.z + (fz / flen) * 60, -FIELD, FIELD);
            ent.nextTargetTime = time + 4;
          }
        }
      }

      // ---- Waypoint patrol (editor-assigned) ----
      if (ent.waypoints && ent.waypoints.length > 0 &&
          ent._vSupPhase === 'none' && !(ent.type === 'infantry' && ent.hostile && time < ent.suppressedUntil)) {
        const wp = ent.waypoints[ent.waypointIdx];
        const dWP = Math.hypot(ent.x - wp.x, ent.z - wp.z);
        if (dWP < 5) {
          const isLastWP = ent.waypointIdx === ent.waypoints.length - 1;
          if (!ent.hostile && isLastWP) {
            // Friendly reached the extraction/last waypoint — stop here
            ent.waypointReachedLast = true;
            ent.waypoints = null;
            ent.nextTargetTime = Infinity;
          } else {
            // Advance to next waypoint (loop for hostile, continue for friendly)
            ent.waypointIdx = (ent.waypointIdx + 1) % ent.waypoints.length;
            const nextWP = ent.waypoints[ent.waypointIdx];
            ent.targetX = nextWP.x;
            ent.targetZ = nextWP.z;
          }
        } else {
          ent.targetX = wp.x;
          ent.targetZ = wp.z;
        }
        ent.nextTargetTime = Infinity; // keep blocking random AI
      }

      // Base defence hostile: override target every frame based on proximity
      // Closest of: friendly unit, deployed structure, HQ, or center (0,0) as fallback
      if (ent.baseDefenceHostile && ent.alive) {
        let _bdTarget = null;
        let _bdBestDist = Infinity;

        // P1+P2 combined: pick whichever is closer — friendly unit OR deployed structure
        const _bFriends = livingFriendlies;
        _bFriends.forEach(f => {
          const _d = Math.hypot(f.x - ent.x, f.z - ent.z);
          if (_d < _bdBestDist) { _bdBestDist = _d; _bdTarget = { x: f.x, z: f.z }; }
        });
        if (buildings) {
          const _structs = buildings.filter(b => !b.destroyed && b.isDeployed && !b.isHQ);
          _structs.forEach(b => {
            const _d = Math.hypot(b.x - ent.x, b.z - ent.z);
            if (_d < _bdBestDist) { _bdBestDist = _d; _bdTarget = { x: b.x, z: b.z }; }
          });
        }
        if (!_bdTarget && buildings) {
          // P3: HQ
          const _hq = buildings.find(b => !b.destroyed && b.isHQ);
          if (_hq) _bdTarget = { x: _hq.x, z: _hq.z };
        }
        if (!_bdTarget) {
          // P4: march to center
          _bdTarget = { x: 0, z: 0 };
        }
        ent.targetX    = _bdTarget.x;
        ent.targetZ    = _bdTarget.z;
        ent._navGoalX  = _bdTarget.x;
        ent._navGoalZ  = _bdTarget.z;
        ent.nextTargetTime = Infinity;
      }

      // Pick new waypoint
      if (time > ent.nextTargetTime) {
        const GROUP_RADIUS  = 45;              // ally cohesion range
        const ENGAGE_DIST   = ent.shootRange * 0.95;  // stand-off: don't close past this
        const DANGER_RADIUS = 50;              // outnumber check radius
        const FALLBACK_DIST = 80;              // retreat step size when outnumbered

        const allies  = ent.hostile ? livingHostiles.filter(e => e !== ent) : livingFriendlies.filter(e => e !== ent);
        const enemies = ent.hostile ? livingFriendlies : livingHostiles;

        // Nearest enemy
        let nearestEnemy = null, nearestEnemyDist = Infinity;
        enemies.forEach(e => {
          const d = Math.hypot(e.x - ent.x, e.z - ent.z);
          if (d < nearestEnemyDist) { nearestEnemyDist = d; nearestEnemy = e; }
        });

        // Patrol units (Dead Wave trucks/tank): roam near center, don't chase enemies
        if (ent.patrolMode) {
          const pr = ent.patrolRadius || 60;
          const pa = Math.random() * Math.PI * 2;
          const pr2 = Utils.randFloat(pr * 0.2, pr);
          ent.targetX = Math.cos(pa) * pr2;
          ent.targetZ = Math.sin(pa) * pr2;
          ent._navGoalX = ent.targetX;
          ent._navGoalZ = ent.targetZ;
          ent.nextTargetTime = time + Utils.randFloat(5, 10);
        // Zombies always charge straight at nearest enemy — no retreat, no standoff
        } else if (ent.zombieMode) {
          if (nearestEnemy) {
            ent._navGoalX = nearestEnemy.x;
            ent._navGoalZ = nearestEnemy.z;
            ent.targetX = nearestEnemy.x + Utils.randFloat(-3, 3);
            ent.targetZ = nearestEnemy.z + Utils.randFloat(-3, 3);
          } else {
            ent._navGoalX = 0; ent._navGoalZ = 0;
            ent.targetX = Utils.randFloat(-5, 5);
            ent.targetZ = Utils.randFloat(-5, 5);
          }
          ent.nextTargetTime = time + Utils.randFloat(1, 3);
        } else {
        // Rule 3: outnumbered within DANGER_RADIUS — retreat toward ally cluster
        const nearbyEnemies = enemies.filter(e => Math.hypot(e.x - ent.x, e.z - ent.z) < DANGER_RADIUS).length;
        const nearbyAllies  = allies.filter(a  => Math.hypot(a.x - ent.x, a.z - ent.z) < DANGER_RADIUS).length;

        if (nearbyEnemies > nearbyAllies + 1) {
          const sumX = allies.reduce((s, a) => s + a.x, 0);
          const sumZ = allies.reduce((s, a) => s + a.z, 0);
          const clusterX = allies.length ? sumX / allies.length : 0;
          const clusterZ = allies.length ? sumZ / allies.length : 0;
          // Direction away from nearest enemy
          const awayX = nearestEnemy ? ent.x - (nearestEnemy.x - ent.x) : clusterX;
          const awayZ = nearestEnemy ? ent.z - (nearestEnemy.z - ent.z) : clusterZ;
          ent.targetX = Utils.clamp((awayX + clusterX) * 0.5, -FIELD, FIELD);
          ent.targetZ = Utils.clamp((awayZ + clusterZ) * 0.5, -FIELD, FIELD);
          ent.nextTargetTime = time + Utils.randFloat(2, 4);

        // Rule 1: already within stand-off range — strafe, don't advance
        } else if (nearestEnemy && nearestEnemyDist < ENGAGE_DIST) {
          const perpX = -(nearestEnemy.z - ent.z);
          const perpZ =  (nearestEnemy.x - ent.x);
          const perpLen = Math.hypot(perpX, perpZ) || 1;
          const side = Math.random() < 0.5 ? 1 : -1;
          ent.targetX = Utils.clamp(ent.x + (perpX / perpLen) * side * Utils.randFloat(6, 14), -FIELD, FIELD);
          ent.targetZ = Utils.clamp(ent.z + (perpZ / perpLen) * side * Utils.randFloat(6, 14), -FIELD, FIELD);
          ent.nextTargetTime = time + Utils.randFloat(2, 4);

        // Rule 2: advance — with group if nearby allies exist, otherwise solo
        } else {
          // Determine advance destination
          let advX, advZ;
          if (nearestEnemy) {
            advX = nearestEnemy.x + Utils.randFloat(-8, 8);
            advZ = nearestEnemy.z + Utils.randFloat(-8, 8);
          } else if (ent.hostile) {
          if (ent.convoyMode) {
            // Convoy: march toward center; spread out once close
            const distToCenter = Math.hypot(ent.x, ent.z);
            if (distToCenter > 20) {
              advX = Utils.randFloat(-12, 12);
              advZ = Utils.randFloat(-12, 12);
            } else {
              const a = Math.random() * Math.PI * 2;
              advX = Math.cos(a) * Utils.randFloat(8, 25);
              advZ = Math.sin(a) * Utils.randFloat(8, 25);
            }
          } else {
            advX = Utils.randFloat(-20, 20);
            advZ = Utils.randFloat(-20, 20);
          }
          } else if (ent.holdMode) {
            // Friendly in hold/zombie mission: flee from nearest zombie, else drift near center
            const nearestZombie = enemies.find(e => e.zombieMode) ||
                                  (nearestEnemy && !ent.hostile ? nearestEnemy : null);
            const roamRadius = ent.deployRadius || 25;
            if (nearestZombie && Math.hypot(nearestZombie.x - ent.x, nearestZombie.z - ent.z) < 60) {
              // Run directly away from the closest zombie
              const awayX = ent.x - nearestZombie.x;
              const awayZ = ent.z - nearestZombie.z;
              const awayLen = Math.hypot(awayX, awayZ) || 1;
              advX = ent.x + (awayX / awayLen) * 40;
              advZ = ent.z + (awayZ / awayLen) * 40;
            } else {
              // No immediate threat — roam within assigned hold/deploy radius
              const a = Math.random() * Math.PI * 2;
              const r = Utils.randFloat(Math.min(4, roamRadius), roamRadius);
              advX = Math.cos(a) * r;
              advZ = Math.sin(a) * r;
            }
            const advLen = Math.hypot(advX, advZ);
            if (advLen > roamRadius) {
              advX = (advX / advLen) * roamRadius;
              advZ = (advZ / advLen) * roamRadius;
            }
            advX = Utils.clamp(advX, -FIELD, FIELD);
            advZ = Utils.clamp(advZ, -FIELD, FIELD);
          } else {
            advX = Utils.clamp(ent.x + Utils.randFloat(-20, 20), -FIELD, FIELD);
            advZ = Utils.clamp(ent.z + Utils.randFloat(-20, 20), -FIELD, FIELD);
          }

          const groupAllies = allies.filter(a => Math.hypot(a.x - ent.x, a.z - ent.z) < GROUP_RADIUS);
          if (groupAllies.length > 0) {
            // Blend: 50% toward group centroid, 50% toward advance target
            const cx = groupAllies.reduce((s, a) => s + a.x, 0) / groupAllies.length;
            const cz = groupAllies.reduce((s, a) => s + a.z, 0) / groupAllies.length;
            ent.targetX = Utils.clamp((cx + advX) * 0.5, -FIELD, FIELD);
            ent.targetZ = Utils.clamp((cz + advZ) * 0.5, -FIELD, FIELD);
          } else {
            // Solo — go straight for advance target
            ent.targetX = Utils.clamp(advX, -FIELD, FIELD);
            ent.targetZ = Utils.clamp(advZ, -FIELD, FIELD);
          }
          ent.nextTargetTime = time + Utils.randFloat(3, 8);
        }
        } // end non-zombie waypoint logic
      }

      // Move towards target
      const dx = ent.targetX - ent.x;
      const dz = ent.targetZ - ent.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      const _holdingPosition = (ent.type === 'infantry' && ent.holdPositionTimer > 0)
        || (ent.type === 'vehicle' && ent.vehicleSubtype === 'tank' && ent.tankFireTimer > 0);
      if (!_holdingPosition && dist > 1) {
        const _crawling = ent.type === 'infantry' && ent.hostile && time < ent.suppressedUntil;
        const speed = ent.speed * dt * (_crawling ? 0.25 : 1);
        ent.x += (dx / dist) * speed;
        ent.z += (dz / dist) * speed;
        ent.angle = Math.atan2(dx, dz);
      }

      // Clamp to field
      ent.x = Utils.clamp(ent.x, -FIELD, FIELD);
      ent.z = Utils.clamp(ent.z, -FIELD, FIELD);

      // Stall detection: check every 0.8s; steer perpendicular to current heading
      if (time - ent._stallAt >= 0.8) {
        if (Math.hypot(ent.x - ent._stallX, ent.z - ent._stallZ) < 0.6 &&
            Math.hypot(ent.targetX - ent.x, ent.targetZ - ent.z) > 5) {
          // Steer 90° left or right of current facing to slide around the obstacle
          const perpAngle = ent.angle + (Math.random() < 0.5 ? Math.PI / 2 : -Math.PI / 2);
          const esc = Utils.randFloat(12, 25);
          ent.targetX = Utils.clamp(ent.x + Math.sin(perpAngle) * esc, -FIELD, FIELD);
          ent.targetZ = Utils.clamp(ent.z + Math.cos(perpAngle) * esc, -FIELD, FIELD);
          ent.nextTargetTime = time + 2;
        }
        ent._stallAt = time;
        ent._stallX = ent.x;
        ent._stallZ = ent.z;
      }

      // Update mesh position
      const groundY = TerrainSystem.getHeightAt(ent.x, ent.z);
      ent.mesh.position.set(ent.x, groundY, ent.z);

      // Smooth body turn — tanks slowest, infantry fastest
      const _turnRate = ent.type === 'vehicle'
        ? (ent.vehicleSubtype === 'tank' ? 1.8 : ent.vehicleSubtype === 'apc' ? 2.2 : 2.5)
        : 5.0;
      if (dist > 1) ent.bodyAngle = _lerpAngle(ent.bodyAngle, ent.angle, _turnRate * dt);

      // Infantry, tank and APC models face local -Z; truck faces local +Z — offset by π to correct
      const _facingOffset = (ent.vehicleSubtype === 'truck') ? 0 : Math.PI;
      ent.mesh.rotation.y = ent.bodyAngle + _facingOffset;

      // Prone pose when suppressed (infantry only)
      if (ent.type === 'infantry') {
        const shouldBeProne = ent.hostile && time < ent.suppressedUntil;
        if (shouldBeProne && !ent._prone) {
          ent._prone = true;
          ent.mesh.rotation.x = Math.PI / 2;   // tip forward flat
          ent.mesh.position.y = groundY + 0.3;  // keep close to ground
        } else if (!shouldBeProne && ent._prone) {
          ent._prone = false;
          ent.mesh.rotation.x = 0;
          ent.mesh.position.y = groundY;
        }
      }

      // Turret tracking — APCs and tanks prefer high-value targets; others aim at the nearest opponent
      if (ent.turretMesh) {
        const _turretOpps = ent.hostile ? livingFriendlies : livingHostiles;
        let _turretTgt = null;
        if (ent.type === 'vehicle' && (ent.vehicleSubtype === 'apc' || ent.vehicleSubtype === 'tank')) {
          _turretTgt = _selectPriorityTarget(ent, _turretOpps).target;
        } else {
          let _turretTgtDist = Infinity;
          _turretOpps.forEach(e => {
            const _d = Math.hypot(e.x - ent.x, e.z - ent.z);
            if (_d < _turretTgtDist) { _turretTgtDist = _d; _turretTgt = e; }
          });
        }
        if (_turretTgt) {
          const _worldAim = Math.atan2(_turretTgt.x - ent.x, _turretTgt.z - ent.z);
          ent.turretAngle = _lerpAngle(ent.turretAngle, _worldAim, 1.5 * dt);
        }
        // barrel points local -Z; world barrel angle = bodyAngle + turretMesh.rotation.y
        ent.turretMesh.rotation.y = ent.turretAngle - ent.bodyAngle;
      }

      // Flash light for friendly units
      if (!ent.hostile && ent.flashMesh) {
        ent.flashTimer += dt;
        if (ent.flashTimer >= (ent.flashOn ? 0.15 : 0.85)) {
          ent.flashTimer = 0;
          ent.flashOn = !ent.flashOn;
          ent.flashMesh.visible = ent.flashOn;
        }
      }

      // Shooting at enemies — disabled while suppressed or fleeing
      const isSuppressedOrFleeing = ent.hostile && (
        (ent.type === 'vehicle'
          ? ent._vSupPhase === 'flee' || ent._vSupPhase === 'freeze'
          : time < ent.suppressedUntil || ent._wasSuppressed)
      );
      ent.shootCooldown -= dt;
      if (ent.grenadeCooldown !== undefined) ent.grenadeCooldown -= dt;
      if (ent.bazookaCooldown !== undefined) ent.bazookaCooldown -= dt;
      if (ent.bazookaPrepTimer !== undefined && ent.bazookaPrepTimer > 0) ent.bazookaPrepTimer -= dt;
      if (ent.holdPositionTimer !== undefined && ent.holdPositionTimer > 0) ent.holdPositionTimer -= dt;
      if (ent.shellCooldown   !== undefined) ent.shellCooldown   -= dt;
      if (ent.tankFireTimer   !== undefined && ent.tankFireTimer > 0) ent.tankFireTimer -= dt;
      if (ent.mgReloading) {
        ent.mgReloadTimer -= dt;
        if (ent.mgReloadTimer <= 0) {
          ent.mgReloading = false;
          ent.mgAmmo = 50;
        }
      }
      if (ent.apcReloading) {
        ent.apcReloadTimer -= dt;
        if (ent.apcReloadTimer <= 0) {
          ent.apcReloading = false;
          ent.apcBurstRemaining = 3;
        }
      }
      if (ent.shootCooldown <= 0 && !isSuppressedOrFleeing) {
        const opponents = ent.hostile ? livingFriendlies : livingHostiles;
        let nearest = null;
        let nearestDist = Infinity;
        if (ent.type === 'vehicle' && (ent.vehicleSubtype === 'apc' || ent.vehicleSubtype === 'tank')) {
          const selectedTarget = _selectPriorityTarget(ent, opponents, ent.shootRange);
          nearest = selectedTarget.target;
          nearestDist = selectedTarget.distance;
        } else {
          opponents.forEach(op => {
            const d = Math.sqrt((op.x - ent.x) ** 2 + (op.z - ent.z) ** 2);
            if (d < nearestDist) { nearestDist = d; nearest = op; }
          });
        }
        // For base defence hostiles, also find nearest building.
        // If the building is closer than the nearest entity (or entity is out of range),
        // redirect fire to the building so hostiles don't ignore structures next to them.
        let _shootAtBldg = null;
        if (ent.baseDefenceHostile && buildings) {
          let _nbD = Infinity;
          buildings.forEach(b => {
            if (b.destroyed || (!b.isDeployed && !b.isHQ)) return;
            const d = Math.hypot(b.x - ent.x, b.z - ent.z);
            if (d < _nbD) { _nbD = d; _shootAtBldg = b; }
          });
          // Only override entity target if building is actually closer or entity is out of range
          if (_shootAtBldg && _nbD < ent.shootRange) {
            if (!nearest || nearestDist >= ent.shootRange || _nbD < nearestDist) {
              // Shoot building — handled in dedicated block below, skip entity shoot block
              nearest = null;
            } else {
              _shootAtBldg = null; // entity is closer, shoot entity normally
            }
          } else {
            _shootAtBldg = null;
          }
        }
        if (nearest && nearestDist < ent.shootRange &&
            (ent.zombieMode || hasLineOfSight(ent.x, ent.z, nearest.x, nearest.z, buildings))) {
          if (ent.zombieMode) {
            // Melee only — no tracer, direct damage on contact
            ent.shootCooldown = Utils.randFloat(0.8, 1.5);
            takeDamage(nearest, Utils.randFloat(15, 25));
          } else if (ent.type === 'infantry') {
            if (ent.infantryRole === 'machineGunner') {
              if (ent.mgReloading) {
                ent.shootCooldown = 0.25;
              } else {
                ent.shootCooldown = Utils.randFloat(0.1, 0.2);
                ent.holdPositionTimer = Math.max(ent.holdPositionTimer || 0, 0.2);
                ent.mgAmmo--;
                AudioSystem.playRifle();
                const fromY  = TerrainSystem.getHeightAt(ent.x, ent.z) + 1.2;
                const nearGroundY = TerrainSystem.getHeightAt(nearest.x, nearest.z);
                const aimCentreY  = nearGroundY + (nearest.type === 'vehicle' ? 1.2 : 0.9);
                const accurate = Math.random() < 0.64;
                const iSpread  = accurate ? 0 : Utils.randFloat(2, nearestDist * 0.45);
                const iAngle   = Math.random() * Math.PI * 2;
                spawnEntityProjectile(
                  ent.x, fromY, ent.z,
                  nearest.x + Math.cos(iAngle) * iSpread,
                  aimCentreY,
                  nearest.z + Math.sin(iAngle) * iSpread,
                  { speed: 95, radius: 0.10,
                    color: ent.hostile ? new THREE.Color(0.9, 0.9, 0.5) : new THREE.Color(0.5, 0.9, 0.55),
                    aoeRadius: 0.8, damage: Utils.randFloat(5, 10),
                    explosionSize: 0.0625, useGravity: false, noEffect: true },
                  ent.hostile
                );
                if (ent.mgAmmo <= 0) {
                  ent.mgReloading = true;
                  ent.mgReloadTimer = 10;
                  ent.shootCooldown = 10;
                }
              }
            } else {
              // Infantry rifle — physical projectile, 80% accuracy
              ent.shootCooldown = Utils.randFloat(1.2, 2.2);
              AudioSystem.playRifle();
              const fromY  = TerrainSystem.getHeightAt(ent.x, ent.z) + 1.2;
              const nearGroundY = TerrainSystem.getHeightAt(nearest.x, nearest.z);
              const aimCentreY  = nearGroundY + (nearest.type === 'vehicle' ? 1.2 : 0.9);
              const accurate = Math.random() < 0.80;
              const iSpread  = accurate ? 0 : Utils.randFloat(2, nearestDist * 0.35);
              const iAngle   = Math.random() * Math.PI * 2;
              spawnEntityProjectile(
                ent.x, fromY, ent.z,
                nearest.x + Math.cos(iAngle) * iSpread,
                aimCentreY,
                nearest.z + Math.sin(iAngle) * iSpread,
                { speed: 95, radius: 0.10,
                  color: ent.hostile ? new THREE.Color(0.9, 0.9, 0.5) : new THREE.Color(0.5, 0.9, 0.55),
                  aoeRadius: 0.8, damage: Utils.randFloat(5, 12),
                  explosionSize: 0.0625, useGravity: false, noEffect: true },
                ent.hostile
              );
            }
          } else {
            if (ent.vehicleSubtype === 'truck') {
              // Truck MG — physical projectile, 70% accuracy, 50% more fire rate than infantry
              ent.shootCooldown = Utils.randFloat(0.1, 0.2);
              AudioSystem.playRifle();
              const fromY  = TerrainSystem.getHeightAt(ent.x, ent.z) + 1.4;
              const nearGroundY = TerrainSystem.getHeightAt(nearest.x, nearest.z);
              const aimCentreY  = nearGroundY + (nearest.type === 'vehicle' ? 1.2 : 0.9);
              const accurate = Math.random() < 0.50;
              const tSpread  = accurate ? 0 : Utils.randFloat(2, nearestDist * 0.6);
              const tAngle   = Math.random() * Math.PI * 2;
              spawnEntityProjectile(
                ent.x, fromY, ent.z,
                nearest.x + Math.cos(tAngle) * tSpread,
                aimCentreY,
                nearest.z + Math.sin(tAngle) * tSpread,
                { speed: 95, radius: 0.10,
                  color: ent.hostile ? new THREE.Color(0.9, 0.9, 0.5) : new THREE.Color(0.5, 0.9, 0.55),
                  aoeRadius: 0.8, damage: Utils.randFloat(5, 12),
                  explosionSize: 0.0625, useGravity: false, noEffect: true },
                ent.hostile
              );
            } else if (ent.vehicleSubtype === 'apc') {
              // APC 30mm cannon — 3-round burst then 15s reload, 70% accuracy
              if (ent.apcReloading) {
                ent.shootCooldown = 0.5;
              } else {
                ent.shootCooldown = 0.25;
                AudioSystem.play20mmImpact();
                const fromY       = TerrainSystem.getHeightAt(ent.x, ent.z) + 1.4;
                const nearGroundY = TerrainSystem.getHeightAt(nearest.x, nearest.z);
                const aimCentreY  = nearGroundY + (nearest.type === 'vehicle' ? 1.2 : 0.9);
                const accurate    = Math.random() < 0.60;
                const aSpread     = accurate ? 0 : Utils.randFloat(1.5, nearestDist * 0.6);
                const aAngle      = Math.random() * Math.PI * 2;
                spawnEntityProjectile(
                  ent.x, fromY, ent.z,
                  nearest.x + Math.cos(aAngle) * aSpread,
                  aimCentreY,
                  nearest.z + Math.sin(aAngle) * aSpread,
                  { speed: 300, radius: 0.12,
                    color: ent.hostile ? new THREE.Color(1.0, 0.75, 0.2) : new THREE.Color(0.3, 0.85, 0.5),
                    aoeRadius: 4.2, damage: Utils.randFloat(15, 22),
                    explosionSize: 0.78, useGravity: false, isApc: true },
                  ent.hostile
                );
                ent.apcBurstRemaining--;
                if (ent.apcBurstRemaining <= 0) {
                  ent.apcReloading = true;
                  ent.apcReloadTimer = 3;
                }
              }
            } else {
              // Tank — no default gun; shell handled via shellCooldown block below
              ent.shootCooldown = Utils.randFloat(2.0, 3.5);
            }
          }
        } else if (_shootAtBldg) {
          // Shoot nearest friendly building (it was closer than any entity target)
          const _nearBldg = _shootAtBldg;
          const _nearBldgD = Math.hypot(_nearBldg.x - ent.x, _nearBldg.z - ent.z);
          const _bFromY = TerrainSystem.getHeightAt(ent.x, ent.z) + (ent.type === 'vehicle' ? 1.4 : 1.2);
          const _bTgtY  = (_nearBldg.groundY || 0) + (_nearBldg.h || 2) * 0.5;
            if (ent.type === 'infantry') {
              ent.shootCooldown = Utils.randFloat(1.2, 2.2);
              AudioSystem.playRifle();
              spawnEntityProjectile(ent.x, _bFromY, ent.z, _nearBldg.x, _bTgtY, _nearBldg.z,
                { speed: 95, radius: 0.10, color: new THREE.Color(0.9, 0.9, 0.5),
                  aoeRadius: 0.8, damage: Utils.randFloat(5, 12), explosionSize: 0.0625, useGravity: false, noEffect: true }, true);
            } else if (ent.vehicleSubtype === 'truck') {
              ent.shootCooldown = Utils.randFloat(0.1, 0.2);
              AudioSystem.playRifle();
              spawnEntityProjectile(ent.x, _bFromY, ent.z, _nearBldg.x, _bTgtY, _nearBldg.z,
                { speed: 95, radius: 0.10, color: new THREE.Color(0.9, 0.9, 0.5),
                  aoeRadius: 0.8, damage: Utils.randFloat(5, 12), explosionSize: 0.0625, useGravity: false, noEffect: true }, true);
            } else if (ent.vehicleSubtype === 'apc') {
              if (ent.apcReloading) { ent.shootCooldown = 0.5; }
              else {
                ent.shootCooldown = 0.25;
                AudioSystem.play20mmImpact();
                spawnEntityProjectile(ent.x, _bFromY, ent.z, _nearBldg.x, _bTgtY, _nearBldg.z,
                  { speed: 300, radius: 0.12, color: new THREE.Color(1.0, 0.75, 0.2),
                    aoeRadius: 4.2, damage: Utils.randFloat(15, 22), explosionSize: 0.78, useGravity: false, isApc: true }, true);
                ent.apcBurstRemaining--;
                if (ent.apcBurstRemaining <= 0) { ent.apcReloading = true; ent.apcReloadTimer = 3; }
              }
            } else {
              ent.shootCooldown = Utils.randFloat(0.5, 1.2); // tank uses shellCooldown
            }
        } else {
          // No target in range — reset cooldown short so it checks again soon
          ent.shootCooldown = Utils.randFloat(0.5, 1.2);
        }
      }

      if (ent.type === 'infantry' && ent.infantryRole === 'antiTank' &&
          ent.bazookaCooldown !== undefined && ent.bazookaCooldown <= 0 &&
          !isSuppressedOrFleeing) {
        const bazookaTargets = (ent.hostile ? livingFriendlies : livingHostiles)
          .concat(ent.hostile ? livingFriendlyStructures : livingHostileStructures);
        let bazookaTarget = null;
        let bazookaBestScore = -Infinity;
        let bazookaBestDist = Infinity;
        bazookaTargets.forEach(target => {
          const priority = _getBazookaPriority(target);
          if (priority <= 0) return;
          const d = Math.hypot(target.x - ent.x, target.z - ent.z);
          if (d > ent.bazookaRange) return;
          const score = priority * 1000 - d;
          if (score > bazookaBestScore) {
            bazookaBestScore = score;
            bazookaBestDist = d;
            bazookaTarget = target;
          }
        });
        if (bazookaTarget && hasLineOfSight(ent.x, ent.z, bazookaTarget.x, bazookaTarget.z, buildings)) {
          if (!ent.bazookaPrimed) {
            ent.bazookaPrimed = true;
            ent.bazookaPrepTimer = 5;
            ent.holdPositionTimer = Math.max(ent.holdPositionTimer || 0, 5);
          } else if (ent.bazookaPrepTimer > 0) {
            ent.holdPositionTimer = Math.max(ent.holdPositionTimer || 0, ent.bazookaPrepTimer);
          } else {
          const bzFromY = TerrainSystem.getHeightAt(ent.x, ent.z) + 1.3;
          const bzGroundY = TerrainSystem.getHeightAt(bazookaTarget.x, bazookaTarget.z);
          const bzAimY = bazookaTarget.type === 'vehicle'
            ? bzGroundY + 1.2
            : bazookaTarget.type === 'staticStructure'
              ? bzGroundY + _getStaticStructureDims(bazookaTarget.structureType).h * 0.55
              : bzGroundY + 0.1;
          const bzSpread = Utils.randFloat(0.8, 2.0 + bazookaBestDist * 0.02);
          const bzMissAngle = Math.random() * Math.PI * 2;
          spawnEntityProjectile(
            ent.x, bzFromY, ent.z,
            bazookaTarget.x + Math.cos(bzMissAngle) * bzSpread,
            bzAimY,
            bazookaTarget.z + Math.sin(bzMissAngle) * bzSpread,
            { speed: 240, radius: 0.22,
              color: ent.hostile ? new THREE.Color(1.0, 0.72, 0.25) : new THREE.Color(0.95, 0.95, 0.75),
              trail: true, trailLength: 8, trailColor: new THREE.Color(1.0, 0.8, 0.35),
              aoeRadius: 10, damage: 320, explosionSize: 1.8, useGravity: false, isMissile: true },
            ent.hostile
          );
          ent.bazookaPrimed = false;
          ent.bazookaPrepTimer = 0;
          ent.bazookaCooldown = 20;
          }
        } else {
          ent.bazookaPrimed = false;
          ent.bazookaPrepTimer = 0;
          ent.bazookaCooldown = 3;
        }
      }

      // --- Grenade throw (infantry, 30s cooldown, requires LOS) ---
      if (ent.type === 'infantry' && !ent.zombieMode &&
          ent.grenadeCooldown !== undefined && ent.grenadeCooldown <= 0 &&
          !isSuppressedOrFleeing) {
        const gOpps = ent.hostile ? livingFriendlies : livingHostiles;
        let gNearest = null, gDist = Infinity;
        gOpps.forEach(op => {
          const d = Math.hypot(op.x - ent.x, op.z - ent.z);
          if (d < gDist) { gDist = d; gNearest = op; }
        });
        if (gNearest && gDist < ent.shootRange &&
            hasLineOfSight(ent.x, ent.z, gNearest.x, gNearest.z, buildings)) {
          const gFromY = TerrainSystem.getHeightAt(ent.x, ent.z) + 1.5;
          // Compute target X/Z first so gToY uses the correct terrain height at the landing spot
          const gHit = Math.random() < 0.70;
          const gSpread = gHit ? 0 : Utils.randFloat(2, Math.min(gDist * 0.2, 8));
          const gMissAngle = Math.random() * Math.PI * 2;
          const gTX = gNearest.x + Math.cos(gMissAngle) * gSpread;
          const gTZ = gNearest.z + Math.sin(gMissAngle) * gSpread;
          const gToY   = TerrainSystem.getHeightAt(gTX, gTZ) + 0.5;
          spawnEntityProjectile(
            ent.x, gFromY, ent.z, gTX, gToY, gTZ,
            { speed: 18, radius: 0.22, color: new THREE.Color(1.0, 0.85, 0.4),
              aoeRadius: 7, damage: 35, explosionSize: 1.3, useGravity: true },
            ent.hostile
          );
          ent.grenadeCooldown = 30;
        } else {
          ent.grenadeCooldown = 5; // retry sooner if no valid target in sight
        }
      }

      if (ent.type === 'vehicle' && ent.vehicleSubtype === 'tank' && ent.tankFirePhase === 'post' && ent.tankFireTimer <= 0) {
        ent.tankFirePhase = 'idle';
        ent.tankFireTimer = 0;
      }

      // --- 40mm shell (tank only): stop 3s before firing, fire, then stop 3s after ---
      if (ent.type === 'vehicle' && ent.vehicleSubtype === 'tank' &&
          ent.shellCooldown !== undefined &&
          !isSuppressedOrFleeing) {
        if (ent.tankFirePhase === 'idle' && ent.shellCooldown <= 0) {
          const sOpps = ent.hostile ? livingFriendlies : livingHostiles;
          const selectedShellTarget = _selectPriorityTarget(ent, sOpps, ent.shootRange);
          const sNearest = selectedShellTarget.target;
          const sDist = selectedShellTarget.distance;

          let canStartShellHold = !!(sNearest && sDist < ent.shootRange &&
            hasLineOfSight(ent.x, ent.z, sNearest.x, sNearest.z, buildings));

          if (!canStartShellHold && ent.baseDefenceHostile && buildings) {
            let _sTgtBldg = null;
            let _sTgtBldgD = Infinity;
            buildings.forEach(b => {
              if (b.destroyed || (!b.isDeployed && !b.isHQ)) return;
              const d = Math.hypot(b.x - ent.x, b.z - ent.z);
              if (d < _sTgtBldgD) { _sTgtBldgD = d; _sTgtBldg = b; }
            });
            canStartShellHold = !!(_sTgtBldg && _sTgtBldgD < ent.shootRange);
          }

          if (canStartShellHold) {
            ent.tankFirePhase = 'pre';
            ent.tankFireTimer = 3;
            ent.targetX = ent.x;
            ent.targetZ = ent.z;
          } else {
            ent.shellCooldown = 5;
          }
        } else if (ent.tankFirePhase === 'pre' && ent.tankFireTimer <= 0) {
          const sOpps = ent.hostile ? livingFriendlies : livingHostiles;
          const selectedShellTarget = _selectPriorityTarget(ent, sOpps, ent.shootRange);
          const sNearest = selectedShellTarget.target;
          const sDist = selectedShellTarget.distance;
          let firedShell = false;

          if (sNearest && sDist < ent.shootRange &&
              hasLineOfSight(ent.x, ent.z, sNearest.x, sNearest.z, buildings)) {
            const sFromY = TerrainSystem.getHeightAt(ent.x, ent.z) + 1.5;
            EffectsSystem.spawnTankMuzzleSmoke(
              ent.x,
              TerrainSystem.getHeightAt(ent.x, ent.z) + 1.15,
              ent.z,
              3
            );
            AudioSystem.playTankFire();
            const sTargetGroundY = TerrainSystem.getHeightAt(sNearest.x, sNearest.z);
            const sToY = sTargetGroundY + (sNearest.type === 'vehicle' ? 1.2 : 0.9);
            const sSpread = Utils.randFloat(1.5, 3.5 + sDist * 0.04);
            const sMissAngle = Math.random() * Math.PI * 2;
            const sTX = sNearest.x + Math.cos(sMissAngle) * sSpread;
            const sTZ = sNearest.z + Math.sin(sMissAngle) * sSpread;
            spawnEntityProjectile(
              ent.x, sFromY, ent.z, sTX, sToY, sTZ,
              { speed: 320, radius: 0.28, color: new THREE.Color(1.0, 0.8, 0.3),
                aoeRadius: 10, damage: 450, explosionSize: 2.0, useGravity: false, isTankShell: true },
              ent.hostile
            );
            firedShell = true;
          } else if (ent.baseDefenceHostile && buildings) {
            let _sTgtBldg = null;
            let _sTgtBldgD = Infinity;
            buildings.forEach(b => {
              if (b.destroyed || (!b.isDeployed && !b.isHQ)) return;
              const d = Math.hypot(b.x - ent.x, b.z - ent.z);
              if (d < _sTgtBldgD) { _sTgtBldgD = d; _sTgtBldg = b; }
            });
            if (_sTgtBldg && _sTgtBldgD < ent.shootRange) {
              const sFromY = TerrainSystem.getHeightAt(ent.x, ent.z) + 1.5;
              EffectsSystem.spawnTankMuzzleSmoke(
                ent.x,
                TerrainSystem.getHeightAt(ent.x, ent.z) + 1.15,
                ent.z,
                1.65
              );
              AudioSystem.playTankFire();
              const sTgtY  = (_sTgtBldg.groundY || 0) + (_sTgtBldg.h || 2) * 0.5;
              spawnEntityProjectile(ent.x, sFromY, ent.z, _sTgtBldg.x, sTgtY, _sTgtBldg.z,
                { speed: 320, radius: 0.28, color: new THREE.Color(1.0, 0.8, 0.3),
                  aoeRadius: 10, damage: 450, explosionSize: 2.0, useGravity: false, isTankShell: true }, true);
              firedShell = true;
            }
          }

          if (firedShell) {
            ent.shellCooldown = 25;
            ent.tankFirePhase = 'post';
            ent.tankFireTimer = 3;
            ent.targetX = ent.x;
            ent.targetZ = ent.z;
          } else {
            ent.tankFirePhase = 'idle';
            ent.tankFireTimer = 0;
            ent.shellCooldown = 5;
          }
        }
      }

      // Building avoidance — cylindrical hitbox: push-out is radial so units slide naturally
      if (buildings) {
        const MARGIN = ent.type === 'vehicle' ? 3.5 : 2.5;
        const LOOK   = 20 + (ent.type === 'vehicle' ? 5 : 0);
        const goalX  = ent._navGoalX !== undefined ? ent._navGoalX : ent.targetX;
        const goalZ  = ent._navGoalZ !== undefined ? ent._navGoalZ : ent.targetZ;

        // Sort nearest-first so the most pressing obstacle is resolved first
        const nearby = buildings
          .filter(b => !b.destroyed)
          .sort((a, b2) => (
            (ent.x - a.x) * (ent.x - a.x) + (ent.z - a.z) * (ent.z - a.z) -
            (ent.x - b2.x) * (ent.x - b2.x) - (ent.z - b2.z) * (ent.z - b2.z)
          ));

        for (const b of nearby) {
          // Cylinder radius encompassing the full rectangular footprint
          const cylR = Math.hypot(b.w / 2, b.d / 2) + MARGIN;
          const ox   = ent.x - b.x;
          const oz   = ent.z - b.z;
          const dist = Math.hypot(ox, oz);

          // ---- 1. Push-out: move entity to cylinder surface, sliding follows naturally ----
          if (dist < cylR) {
            if (dist < 0.01) {
              // Exactly at centre (very rare) — eject in random direction
              const a = Math.random() * Math.PI * 2;
              ent.x = b.x + Math.cos(a) * cylR;
              ent.z = b.z + Math.sin(a) * cylR;
            } else {
              // Radial push-out — the entity's unchanged targetX/Z then produces
              // a naturally tangential movement vector next frame (smooth slide)
              ent.x = b.x + (ox / dist) * cylR;
              ent.z = b.z + (oz / dist) * cylR;
            }
            continue; // check remaining buildings but skip lookahead for this one
          }

          // ---- 2. Lookahead: steer to optimal tangent side before hitting the cylinder ----
          if (dist > cylR + LOOK) continue; // too far to matter

          const tdx  = ent.targetX - ent.x;
          const tdz  = ent.targetZ - ent.z;
          const tlen = Math.hypot(tdx, tdz);
          if (tlen < 1) continue;

          // Project building centre onto the path ray
          const dirX  = tdx / tlen;
          const dirZ  = tdz / tlen;
          const tProj = (b.x - ent.x) * dirX + (b.z - ent.z) * dirZ;
          if (tProj < 0 || tProj > Math.min(tlen, LOOK)) continue;

          const cpX      = ent.x + dirX * tProj;
          const cpZ      = ent.z + dirZ * tProj;
          const perpDist = Math.hypot(cpX - b.x, cpZ - b.z);
          if (perpDist >= cylR) continue; // path clears the cylinder

          // Avoidance normal: perpendicular to path, pointing away from building centre.
          // When path goes straight through the centre use the path's left-perpendicular.
          const avNX = perpDist < 0.01 ?  dirZ : (cpX - b.x) / perpDist;
          const avNZ = perpDist < 0.01 ? -dirX : (cpZ - b.z) / perpDist;

          // Two candidate tangent points (left and right side of the cylinder)
          const s1x = b.x + avNX * (cylR + 1.5),  s1z = b.z + avNZ * (cylR + 1.5);
          const s2x = b.x - avNX * (cylR + 1.5),  s2z = b.z - avNZ * (cylR + 1.5);

          // Pick the side that minimises entity→tangent + tangent→nav-goal
          const score1 = Math.hypot(s1x - ent.x, s1z - ent.z) + Math.hypot(s1x - goalX, s1z - goalZ);
          const score2 = Math.hypot(s2x - ent.x, s2z - ent.z) + Math.hypot(s2x - goalX, s2z - goalZ);
          const tx = score1 < score2 ? s1x : s2x;
          const tz = score1 < score2 ? s1z : s2z;

          ent.targetX = Utils.clamp(tx, -FIELD, FIELD);
          ent.targetZ = Utils.clamp(tz, -FIELD, FIELD);
          ent.nextTargetTime = time + 3.0;
          break; // one lookahead correction per frame
        }
      }
    });

    // ---- Entity projectiles (grenades / tank shells) ----
    entityProjectiles = entityProjectiles.filter(ep => {
      if (!ep.alive) { _cleanupEntityProjectile(ep); return false; }
      ep.age += dt;
      if (ep.age > 8) { ep.alive = false; _cleanupEntityProjectile(ep); return false; }
      // Drag — shell/grenade slows with air resistance
      const epDrag = ep.useGravity ? 0.04 : 0.30; // shells: strong wind resistance; grenades: lob naturally
      const epDragMult = Math.max(0, 1 - epDrag * dt);
      ep.dx *= epDragMult; ep.dz *= epDragMult;
      // dy is intentionally NOT dragged for straight-line projectiles — the initial downward
      // slope toward the target is preserved so missed shots continue arcing to the ground.
      if (ep.useGravity) ep.dy -= ENTITY_PROJ_GRAVITY * dt;
      ep.x += ep.dx * dt;
      ep.y += ep.dy * dt;
      ep.z += ep.dz * dt;
      ep.mesh.position.set(ep.x, ep.y, ep.z);

      // Speed-based blur: orient mesh along velocity and stretch proportional to speed
      const epCurSpeed = Math.hypot(ep.dx, ep.dy, ep.dz);
      if (ep.initialSpeed > 0 && epCurSpeed > 0.5) {
        _epVelDir.set(ep.dx, ep.dy, ep.dz).normalize();
        _epQuat.setFromUnitVectors(_epForward, _epVelDir);
        ep.mesh.quaternion.copy(_epQuat);
        const epStretch = 1 + (epCurSpeed / ep.initialSpeed) * 10;
        ep.mesh.scale.set(1, 1, epStretch);
        if (ep.trailMesh) {
          const trailLen = ep.stats.trailLength || 7;
          ep.trailMesh.quaternion.copy(_epQuat);
          ep.trailMesh.position.set(
            ep.x - _epVelDir.x * trailLen * 0.5,
            ep.y - _epVelDir.y * trailLen * 0.5,
            ep.z - _epVelDir.z * trailLen * 0.5
          );
          ep.trailMesh.scale.set(1, 1, trailLen);
          ep.trailMesh.material.opacity = 0.2 + 0.3 * (epCurSpeed / ep.initialSpeed);
        }
      }

      // ---- Unit hitbox collision ----
      for (const ent of entities) {
        if (!ent.alive || ent.hostile === ep.ownerHostile) continue;
        const entGroundY = TerrainSystem.getHeightAt(ent.x, ent.z);
        let hit = false;
        if (ent.type === 'vehicle') {
          hit = Math.abs(ep.x - ent.x) < 2.0 &&
                Math.abs(ep.z - ent.z) < 3.0 &&
                ep.y >= entGroundY && ep.y <= entGroundY + 2.4;
        } else if (ent.type === 'staticStructure') {
          const dims = _getStaticStructureDims(ent.structureType);
          hit = Math.abs(ep.x - ent.x) < dims.w / 2 &&
                Math.abs(ep.z - ent.z) < dims.d / 2 &&
                ep.y >= entGroundY && ep.y <= entGroundY + dims.h;
        } else {
          const dx2 = ep.x - ent.x, dz2 = ep.z - ent.z;
          hit = (dx2 * dx2 + dz2 * dz2) < 0.55 * 0.55 &&
                ep.y >= entGroundY && ep.y <= entGroundY + 1.8;
        }
        if (hit) {
          ep.alive = false; _cleanupEntityProjectile(ep);
          entityProjectileImpact(ep, ent.x, entGroundY, ent.z);
          return false;
        }
      }

      const gY = TerrainSystem.getHeightAt(ep.x, ep.z);
      if (ep.y <= gY + 0.3) {
        ep.alive = false; _cleanupEntityProjectile(ep);
        entityProjectileImpact(ep, ep.x, gY, ep.z);
        return false;
      }
      if (buildings) {
        for (const b of buildings) {
          if (b.destroyed) continue;
          // Friendly-owned projectiles (from bunker/bofors/artillery) must not collide
          // with their own deployed structures — they originate inside the AABB.
          if (!ep.ownerHostile && (b.isDeployed || b.isHQ)) continue;
          // Hostile-owned projectiles must not collide with hostile deployed structures.
          if (ep.ownerHostile && b.isHostileDeployed) continue;
          const hw = b.w / 2, hd = b.d / 2;
          if (Math.abs(ep.x - b.x) < hw && Math.abs(ep.z - b.z) < hd &&
              ep.y > b.groundY && ep.y < b.groundY + b.h) {
            ep.alive = false; _cleanupEntityProjectile(ep);
            entityProjectileImpact(ep, ep.x, ep.y, ep.z);
            return false;
          }
        }
      }
      return true;
    });
  }

  function takeDamage(entity, dmg, options = {}) {
    if (!entity.alive) return;
    entity.hp -= dmg;
    if (options.playEnemyHitVoice && entity.hostile && dmg > 0) AudioSystem.playEnemyHitVoice();
    if (entity.hp <= 0) {
      entity.hp = 0;
      entity.alive = false;

      // Static structures use the building collapse animation
      if (entity.type === 'staticStructure') {
        const groundY = TerrainSystem.getHeightAt(entity.x, entity.z);
        const dims = _getStaticStructureDims(entity.structureType);
        // Build a minimal building-shaped object for destroyBuilding()
        const bldgProxy = {
          mesh: entity.mesh, x: entity.x, z: entity.z,
          w: dims.w, d: dims.d, h: dims.h,
          groundY, destroyed: false
        };
        // Must be in TerrainSystem buildings so the game.js collapse loop animates it
        TerrainSystem.getBuildings().push(bldgProxy);
        if (_destroyBuildingCb) _destroyBuildingCb(bldgProxy, entity.x, entity.z);
        if (entity.hostile && _onHostileKilledCb) _onHostileKilledCb(entity);
        return;
      }

      // Vehicles have a 70% chance to cook off with a 40mm-scale explosion on death
      if (entity.type === 'vehicle' && Math.random() < 0.70) {
        const groundY = TerrainSystem.getHeightAt(entity.x, entity.z);
        const reducedVehicleSmoke = entity.vehicleSubtype === 'truck' || entity.vehicleSubtype === 'tank';
        const explosionOptions = reducedVehicleSmoke
          ? { smokeScale: 0.525, smokeProfile: 'vehicle' }
          : {};
        EffectsSystem.spawnExplosion(entity.x, groundY, entity.z, 2.5, explosionOptions);
        // 40% chance of a delayed secondary explosion
        if (Math.random() < 0.40) {
          setTimeout(() => {
            EffectsSystem.spawnExplosion(
              entity.x + Utils.randFloat(-2, 2),
              groundY,
              entity.z + Utils.randFloat(-2, 2),
              1.8,
              explosionOptions
            );
          }, Utils.randFloat(400, 1200));
        }
      }
      // Fire entity-level death callbacks (e.g., base defence credits)
      if (entity.hostile && _onHostileKilledCb) _onHostileKilledCb(entity);

      // Remove corpse mesh after a short linger (vehicles 5s, infantry 3s)
      const _deadMesh  = entity.mesh;
      const _deadScene = scene;
      const _lingerMs  = entity.type === 'vehicle' ? 5000 : 3000;
      setTimeout(() => {
        if (_deadMesh && _deadScene) {
          _deadScene.remove(_deadMesh);
          if (_deadMesh.traverse) _deadMesh.traverse(c => {
            if (c.geometry) c.geometry.dispose();
            if (c.material && !c._shared) c.material.dispose();
          });
        }
      }, _lingerMs);
    }
  }

  // Register a callback fired whenever a hostile entity is killed (from any source).
  let _onHostileKilledCb = null;
  function onHostileKilled(cb) { _onHostileKilledCb = cb; }

  function onBuildingDestroyed(cb) { _destroyBuildingCb = cb; }

  // Allow any system (e.g. baseDefence) to trigger the full building collapse
  function triggerBuildingDestroyed(b, x, z) {
    if (_destroyBuildingCb) _destroyBuildingCb(b, x, z);
  }

  // Called from game.js on every impact — hostile entities within radius freeze then flee.
  // Optimised: squared-distance only, skips dead and friendly units.
  function notifyExplosion(x, z, size, gameTime) {
    const baseRadius = 12 + size * 14;  // 12 → 40+ units depending on weapon
    const suppress   = 5.0;             // seconds to stay pinned
    entities.forEach(ent => {
      if (!ent.alive || !ent.hostile || ent.zombieMode) return;
      // Vehicles are large targets — give them 2.5x the trigger radius of infantry
      const radius   = ent.type === 'vehicle' ? baseRadius * 2.5 : baseRadius * 0.7;
      const radiusSq = radius * radius;
      const dx = ent.x - x;
      const dz = ent.z - z;
      if (dx * dx + dz * dz < radiusSq) {
        if (ent.type === 'vehicle') {
          // Only trigger a new flee cycle if not already in one;
          // mid-flee hits just extend the flee window slightly (handled in update)
          if (ent._vSupPhase === 'none') {
            ent.suppressedUntil = gameTime + suppress;
          } else {
            // Extend current phase slightly so it doesn't cut short on rapid fire
            ent.suppressedUntil = Math.max(ent.suppressedUntil, gameTime + 1.0);
          }
        } else {
          // Infantry: arm a 1s pending timer; each new blast resets/extends it.
          // suppressedUntil is only set by the update loop once the delay elapses.
          ent._suppressPendingAt = gameTime + 1.0;
          ent._pendingSuppressEnd = gameTime + 1.0 + suppress; // store intended end time
          ent.fleeFromX = x;
          ent.fleeFromZ = z;
        }
      }
    });
  }

  function getAll() { return entities; }
  function getLiving() { return entities.filter(e => e.alive); }
  function getHostiles() { return entities.filter(e => e.hostile && e.alive); }
  function getFriendlies() { return entities.filter(e => !e.hostile && e.alive); }

  function addZombieWave(count) {
    // Each zombie spawns at its own random edge point — fully spread out
    for (let i = 0; i < count; i++) {
      const origin = spawnAtEdge(Utils.randFloat(165, 180));
      const ent = spawnInfantry(origin.x, origin.z, true, scene);
      ent.zombieMode = true;
      ent.speed = Utils.randFloat(5, 8);
      ent.hp = 50;
      ent.maxHp = 50;
      ent.shootRange = 3;
      ent.scoreValue = 150;
      entities.push(ent);
    }
  }

  function addReinforceGroup(infantryCount) {
    // Spawn a vehicle + soldiers from the same edge point so they arrive as a group
    const origin = spawnAtEdge(175);
    const vehicle = spawnVehicle(
      origin.x + Utils.randFloat(-5, 5),
      origin.z + Utils.randFloat(-5, 5),
      true, scene
    );
    entities.push(vehicle);
    for (let i = 0; i < infantryCount; i++) {
      const ent = spawnInfantry(
        origin.x + Utils.randFloat(-10, 10),
        origin.z + Utils.randFloat(-10, 10),
        true, scene
      );
      entities.push(ent);
    }
  }

  function addWaveReinforcements() {
    // 1 friendly patrol truck + 1 friendly tank + 6 friendly soldiers arriving as reinforcements
    const origin = spawnAtEdge(Utils.randFloat(160, 180));
    const truck = spawnVehicle(origin.x, origin.z, false, scene);
    truck.patrolMode = true;
    truck.patrolRadius = 65;
    truck.targetX = 0; truck.targetZ = 0;
    truck.nextTargetTime = 0;
    entities.push(truck);
    const tank = spawnVehicle(origin.x + Utils.randFloat(-6, 6), origin.z + Utils.randFloat(-6, 6), false, scene, 'tank');
    tank.patrolMode = true;
    tank.patrolRadius = 65;
    tank.targetX = 0; tank.targetZ = 0;
    tank.nextTargetTime = 0;
    entities.push(tank);
    for (let i = 0; i < 6; i++) {
      const ent = spawnInfantry(
        origin.x + Utils.randFloat(-10, 10),
        origin.z + Utils.randFloat(-10, 10),
        false, scene
      );
      // March to center, then hold
      ent.holdMode = true;
      ent.targetX = Utils.randFloat(-15, 15);
      ent.targetZ = Utils.randFloat(-15, 15);
      ent.nextTargetTime = Infinity;
      entities.push(ent);
    }
  }

  function addHostileInfantry(sceneRef) {
    const s = sceneRef || scene;
    const p = Utils.randomSpawnPos(180, 100);
    const ent = spawnInfantry(p.x, p.z, true, s);
    entities.push(ent);
    return ent;
  }

  function addHostileVehicle(sceneRef) {
    const s = sceneRef || scene;
    const p = Utils.randomSpawnPos(180, 100);
    const ent = spawnVehicle(p.x, p.z, true, s);
    entities.push(ent);
    return ent;
  }

  // ---- Base Defence helpers ----

  // Per-round composition table: [trucks, apcs, tanks]
  // R1=[0,0,0], R2=[0,0,0], R3=[1,0,0], R4=[2,1,0], R5=[3,2,1], R6+: +1 each per round beyond 5
  function _bdVehicleCounts(r) {
    if (r <= 2) return { trucks: 0, apcs: 0, tanks: 0 };
    if (r === 3) return { trucks: 1, apcs: 0, tanks: 0 };
    if (r === 4) return { trucks: 2, apcs: 1, tanks: 0 };
    const extra = r - 5;
    return { trucks: 3 + extra, apcs: 2 + extra, tanks: Math.max(0, 1 + extra) };
  }

  // Spawn a full wave of hostiles targeting the center (base defence mode).
  // Units come in groups spread around all edges of the map.
  function spawnBaseDefenceWave(roundNum, sceneRef) {
    const s = sceneRef || scene;
    // Infantry count scales per round
    const infCount = Math.min(100, 20 + roundNum * 5);
    const veh = _bdVehicleCounts(roundNum);
    const numGroups = Math.min(8, 4 + Math.floor(roundNum / 2));

    // Build a flat spawn list
    const spawnList = [];
    for (let i = 0; i < infCount; i++)          spawnList.push('infantry');
    for (let i = 0; i < veh.trucks; i++)         spawnList.push('truck');
    for (let i = 0; i < veh.apcs; i++)           spawnList.push('apc');
    for (let i = 0; i < veh.tanks; i++)          spawnList.push('tank');

    // Shuffle
    for (let i = spawnList.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [spawnList[i], spawnList[j]] = [spawnList[j], spawnList[i]];
    }

    const perGroup = Math.ceil(spawnList.length / numGroups);

    for (let g = 0; g < numGroups; g++) {
      const angle  = (g / numGroups) * Math.PI * 2;
      const radius = Utils.randFloat(170, 185);
      const ox     = Math.cos(angle) * radius;
      const oz     = Math.sin(angle) * radius;

      // Each group aims at a point very close to center (0,0) — HQ position
      const wpX = Utils.randFloat(-1.5, 1.5);
      const wpZ = Utils.randFloat(-1.5, 1.5);
      const waypoints = [{ x: wpX, z: wpZ }];

      const start = g * perGroup;
      const end   = Math.min(start + perGroup, spawnList.length);
      for (let i = start; i < end; i++) {
        const sub  = spawnList[i];
        const spawnX = ox + Utils.randFloat(-12, 12);
        const spawnZ = oz + Utils.randFloat(-12, 12);

        let ent;
        if (sub === 'infantry') {
          ent = spawnInfantry(spawnX, spawnZ, true, s);
        } else {
          ent = spawnVehicle(spawnX, spawnZ, true, s, sub);
        }

        ent.waypoints      = waypoints;
        ent.waypointIdx    = 0;
        ent.targetX        = waypoints[0].x;
        ent.targetZ        = waypoints[0].z;
        ent.nextTargetTime = Infinity;
        ent.baseDefenceHostile = true;

        entities.push(ent);
      }
    }
  }

  // Spawn a single friendly unit at (x, z) by type string:
  // 'infantry' | 'machine_gunner' | 'anti_tank' | 'truck' | 'apc' | 'tank' | 'artillery'
  function spawnFriendlyUnit(type, x, z, sceneRef, deployRadius = 50) {
    const s = sceneRef || scene;
    if (type === 'artillery') {
      return addEntity(spawnStaticStructure('artillery', x, z, false, s));
    }

    let ent;
    if (type === 'infantry' || type === 'machine_gunner' || type === 'anti_tank') {
      ent = spawnInfantry(x, z, false, s, _getInfantryRoleFromType(type));
    } else {
      const sub = type === 'truck' ? 'truck'
                : (type === 'apc')  ? 'apc' : 'tank';
      ent = spawnVehicle(x, z, false, s, sub);
    }
    // Hold near deploy zone — reuse holdMode AI
    ent.holdMode     = true;
    ent.deployRadius = deployRadius;
    entities.push(ent);
    return ent;
  }

  // Fire a projectile from a stationary friendly structure (bunker/bofors).
  // Treated as a friendly shot (ownerHostile = false).
  function spawnStructureProjectile(sx, sy, sz, tx, ty, tz, stats) {
    spawnEntityProjectile(sx, sy, sz, tx, ty, tz, stats, false);
  }

  // Spawn a projectile that belongs to a hostile (ownerHostile=true).
  // It will physically collide with building AABBs and stop there.
  function spawnHostileProjectile(sx, sy, sz, tx, ty, tz, stats) {
    spawnEntityProjectile(sx, sy, sz, tx, ty, tz, stats, true);
  }

  function despawnAll() {
    entities.forEach(e => {
      if (scene && e.mesh) scene.remove(e.mesh);
    });
    entities = [];
    entityProjectiles.forEach(ep => { if (scene && ep.mesh) scene.remove(ep.mesh); });
    entityProjectiles = [];
  }

  return {
    spawnAll, update, takeDamage, notifyExplosion,
    getAll, getLiving, getHostiles, getFriendlies,
    addHostileInfantry, addHostileVehicle, addZombieWave, addReinforceGroup, addWaveReinforcements,
    spawnBaseDefenceWave, spawnFriendlyUnit, spawnStaticStructure, addEntity, spawnStructureProjectile, spawnHostileProjectile,
    onHostileKilled,
    onBuildingDestroyed,
    triggerBuildingDestroyed,
    despawnAll
  };
})();
