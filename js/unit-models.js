/* =============================================
   UNIT-MODELS.JS — Shared procedural unit model presets
   ============================================= */
'use strict';

const UnitModelSystem = (() => {
  const STORAGE_KEY = 'ac130_unit_models_v2';
  const RUNNING_GEAR_COLOR = new THREE.Color(0.58, 0.58, 0.58);

  const UNIT_META = {
    hostile_infantry: { label: 'Hostile Infantry', category: 'infantry', side: 'hostile' },
    friendly_infantry: { label: 'Friendly Infantry', category: 'infantry', side: 'friendly' },
    hostile_machine_gunner: { label: 'Hostile Machine Gunner', category: 'infantry', side: 'hostile' },
    friendly_machine_gunner: { label: 'Friendly Machine Gunner', category: 'infantry', side: 'friendly' },
    hostile_anti_tank: { label: 'Hostile Anti-Tank Infantry', category: 'infantry', side: 'hostile' },
    friendly_anti_tank: { label: 'Friendly Anti-Tank Infantry', category: 'infantry', side: 'friendly' },
    hostile_vehicle: { label: 'Hostile Truck', category: 'truck', side: 'hostile' },
    friendly_vehicle: { label: 'Friendly Truck', category: 'truck', side: 'friendly' },
    hostile_tank: { label: 'Hostile Tank', category: 'tank', side: 'hostile' },
    friendly_tank: { label: 'Friendly Tank', category: 'tank', side: 'friendly' },
    hostile_apc: { label: 'Hostile APC', category: 'apc', side: 'hostile' },
    friendly_apc: { label: 'Friendly APC', category: 'apc', side: 'friendly' }
  };

  const DEFAULT_MODELS = {
    hostile_infantry: {
      color: '#d1d1d1',
      bodyRadius: 0.38,
      bodyHeight: 0.8,
      headRadius: 0.22,
      headGap: 0.28,
      gearWidth: 0.53,
      gearHeight: 0.6,
      gearDepth: 0.26
    },
    friendly_infantry: {
      color: '#808080',
      bodyRadius: 0.38,
      bodyHeight: 0.8,
      headRadius: 0.22,
      headGap: 0.28,
      gearWidth: 0.53,
      gearHeight: 0.6,
      gearDepth: 0.26
    },
    hostile_machine_gunner: {
      color: '#d1d1d1',
      bodyRadius: 0.38,
      bodyHeight: 0.8,
      headRadius: 0.22,
      headGap: 0.28,
      gearWidth: 0.53,
      gearHeight: 0.6,
      gearDepth: 0.26
    },
    friendly_machine_gunner: {
      color: '#808080',
      bodyRadius: 0.38,
      bodyHeight: 0.8,
      headRadius: 0.22,
      headGap: 0.28,
      gearWidth: 0.53,
      gearHeight: 0.6,
      gearDepth: 0.26
    },
    hostile_anti_tank: {
      color: '#d1d1d1',
      bodyRadius: 0.38,
      bodyHeight: 0.8,
      headRadius: 0.22,
      headGap: 0.28,
      gearWidth: 0.53,
      gearHeight: 0.6,
      gearDepth: 0.26
    },
    friendly_anti_tank: {
      color: '#808080',
      bodyRadius: 0.38,
      bodyHeight: 0.8,
      headRadius: 0.22,
      headGap: 0.28,
      gearWidth: 0.53,
      gearHeight: 0.6,
      gearDepth: 0.26
    },
    hostile_vehicle: {
      color: '#faf9f9',
      hullWidth: 2.1,
      hullHeight: 0.95,
      hullLength: 4.6,
      cabWidth: 1.95,
      cabHeight: 1.35,
      cabLength: 2.15,
      cabOffsetZ: 1.2,
      wheelRadius: 0.59,
      wheelWidth: 0.4
    },
    friendly_vehicle: {
      color: '#faf9f9',
      hullWidth: 2.1,
      hullHeight: 0.95,
      hullLength: 4.6,
      cabWidth: 1.95,
      cabHeight: 1.35,
      cabLength: 2.15,
      cabOffsetZ: 1.2,
      wheelRadius: 0.59,
      wheelWidth: 0.4
    },
    hostile_tank: {
      color: '#fafafa',
      hullWidth: 2.65,
      hullHeight: 0.9,
      hullLength: 5.6,
      turretWidth: 1.7,
      turretHeight: 1.1,
      turretLength: 2.75,
      turretOffsetZ: 1.65,
      barrelRadius: 0.21,
      barrelLength: 4.1,
      trackWidth: 0.8,
      trackHeight: 0.72
    },
    friendly_tank: {
      color: '#9e9e9e',
      hullWidth: 2.65,
      hullHeight: 0.9,
      hullLength: 5.6,
      turretWidth: 1.7,
      turretHeight: 1.1,
      turretLength: 2.75,
      turretOffsetZ: 1.65,
      barrelRadius: 0.21,
      barrelLength: 4.1,
      trackWidth: 0.8,
      trackHeight: 0.72
    },
    hostile_apc: {
      color: '#e0e0e0',
      hullWidth: 2.1,
      hullHeight: 0.9,
      hullLength: 4.8,
      turretWidth: 1.2,
      turretHeight: 0.8,
      turretLength: 1.45,
      turretOffsetZ: 0.95,
      barrelRadius: 0.07,
      barrelLength: 1.8,
      wheelRadius: 0.59,
      wheelWidth: 0.49
    },
    friendly_apc: {
      color: '#949494',
      hullWidth: 2.1,
      hullHeight: 0.9,
      hullLength: 4.8,
      turretWidth: 1.2,
      turretHeight: 0.8,
      turretLength: 1.45,
      turretOffsetZ: 0.95,
      barrelRadius: 0.07,
      barrelLength: 1.8,
      wheelRadius: 0.59,
      wheelWidth: 0.49
    }
  };

  let models = _clone(DEFAULT_MODELS);

  function _clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function _hexToColor(value) {
    if (value instanceof THREE.Color) return value;
    return new THREE.Color(value || '#ffffff');
  }

  function _dispatchChange(type) {
    window.dispatchEvent(new CustomEvent('ac130-unit-models-changed', {
      detail: { type: type || null }
    }));
  }

  function _sanitizeNumber(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function _load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      Object.keys(DEFAULT_MODELS).forEach(type => {
        if (!parsed[type]) return;
        models[type] = { ...models[type], ...parsed[type] };
      });
    } catch (_) {
      models = _clone(DEFAULT_MODELS);
    }
  }

  function _save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(models));
    } catch (_) {}
  }

  function _buildInfantry(type, cfg, colorOverride) {
    const color = colorOverride || _hexToColor(cfg.color);
    const mat = new THREE.MeshBasicMaterial({ color });
    const group = new THREE.Group();
    const bodyGeo = THREE.CapsuleGeometry
      ? new THREE.CapsuleGeometry(cfg.bodyRadius, cfg.bodyHeight, 4, 6)
      : new THREE.CylinderGeometry(cfg.bodyRadius * 0.7, cfg.bodyRadius * 0.85, cfg.bodyHeight + cfg.bodyRadius, 6);
    const body = new THREE.Mesh(bodyGeo, mat);
    body.position.y = cfg.bodyRadius + cfg.bodyHeight * 0.5;
    group.add(body);

    const head = new THREE.Mesh(new THREE.SphereGeometry(cfg.headRadius, 8, 8), mat);
    head.position.y = cfg.bodyRadius + cfg.bodyHeight + cfg.headGap + cfg.headRadius;
    group.add(head);

    const gear = new THREE.Mesh(
      new THREE.BoxGeometry(cfg.gearWidth, cfg.gearHeight, cfg.gearDepth),
      mat
    );
    gear.position.set(0, cfg.bodyRadius + cfg.bodyHeight * 0.62, cfg.bodyRadius * 0.75);
    group.add(gear);

    group.userData.unitType = type;
    return group;
  }

  function _addWheel(group, wheelRadius, wheelWidth, x, z) {
    const wheelGeo = new THREE.CylinderGeometry(wheelRadius, wheelRadius, wheelWidth, 10);
    wheelGeo.rotateZ(Math.PI / 2);
    const wheelMat = new THREE.MeshBasicMaterial({ color: RUNNING_GEAR_COLOR });
    const wheel = new THREE.Mesh(wheelGeo, wheelMat);
    wheel.position.set(x, wheelRadius * 0.8, z);
    group.add(wheel);
  }

  function _buildTruck(type, cfg, colorOverride) {
    const color = colorOverride || _hexToColor(cfg.color);
    const mat = new THREE.MeshBasicMaterial({ color });
    const group = new THREE.Group();

    const hull = new THREE.Mesh(new THREE.BoxGeometry(cfg.hullWidth, cfg.hullHeight, cfg.hullLength), mat);
    hull.position.y = cfg.hullHeight * 0.5 + 0.15;
    group.add(hull);

    const cab = new THREE.Mesh(new THREE.BoxGeometry(cfg.cabWidth, cfg.cabHeight, cfg.cabLength), mat);
    cab.position.set(0, cfg.hullHeight + cfg.cabHeight * 0.5, cfg.cabOffsetZ);
    group.add(cab);

    const wheelX = Math.max(0.7, cfg.hullWidth * 0.48);
    const wheelZ = Math.max(1.0, cfg.hullLength * 0.33);
    [[-wheelX, wheelZ], [wheelX, wheelZ], [-wheelX, -wheelZ], [wheelX, -wheelZ]].forEach(([x, z]) => {
      _addWheel(group, cfg.wheelRadius, cfg.wheelWidth, x, z);
    });

    group.userData.unitType = type;
    return group;
  }

  function _buildTank(type, cfg, colorOverride) {
    const color = colorOverride || _hexToColor(cfg.color);
    const mat = new THREE.MeshBasicMaterial({ color });
    const group = new THREE.Group();

    const hull = new THREE.Mesh(new THREE.BoxGeometry(cfg.hullWidth, cfg.hullHeight, cfg.hullLength), mat);
    hull.position.y = cfg.hullHeight * 0.5 + 0.2;
    group.add(hull);

    const leftTrack = new THREE.Mesh(
      new THREE.BoxGeometry(cfg.trackWidth, cfg.trackHeight, cfg.hullLength * 0.95),
      new THREE.MeshBasicMaterial({ color: RUNNING_GEAR_COLOR })
    );
    leftTrack.position.set(-cfg.hullWidth * 0.44, cfg.trackHeight * 0.5, 0);
    group.add(leftTrack);

    const rightTrack = leftTrack.clone();
    rightTrack.position.x = cfg.hullWidth * 0.44;
    group.add(rightTrack);

    // Turret pivot — rotates independently of hull so it can track targets
    const turretPivot = new THREE.Group();
    turretPivot.position.set(0, cfg.hullHeight + cfg.turretHeight * 0.5 + 0.25, 0);
    turretPivot.userData.isTurret = true;
    group.add(turretPivot);

    const turret = new THREE.Mesh(new THREE.BoxGeometry(cfg.turretWidth, cfg.turretHeight, cfg.turretLength), mat);
    turret.position.set(0, 0, cfg.turretOffsetZ);
    turretPivot.add(turret);

    const barrelGeo = new THREE.CylinderGeometry(cfg.barrelRadius, cfg.barrelRadius, cfg.barrelLength, 8);
    barrelGeo.rotateX(Math.PI / 2);
    const barrel = new THREE.Mesh(barrelGeo, mat);
    barrel.position.set(0, 0.05, cfg.turretOffsetZ - cfg.turretLength * 0.5 - cfg.barrelLength * 0.32);
    turretPivot.add(barrel);

    group.userData.unitType = type;
    return group;
  }

  function _buildAPC(type, cfg, colorOverride) {
    const color = colorOverride || _hexToColor(cfg.color);
    const mat = new THREE.MeshBasicMaterial({ color });
    const group = new THREE.Group();

    const hull = new THREE.Mesh(new THREE.BoxGeometry(cfg.hullWidth, cfg.hullHeight, cfg.hullLength), mat);
    hull.position.y = cfg.hullHeight * 0.5 + 0.15;
    group.add(hull);

    // Turret pivot — rotates independently of hull so it can track targets
    const turretPivot = new THREE.Group();
    turretPivot.position.set(0, cfg.hullHeight + cfg.turretHeight * 0.5 + 0.2, 0);
    turretPivot.userData.isTurret = true;
    group.add(turretPivot);

    const turret = new THREE.Mesh(new THREE.BoxGeometry(cfg.turretWidth, cfg.turretHeight, cfg.turretLength), mat);
    turret.position.set(0, 0, cfg.turretOffsetZ);
    turretPivot.add(turret);

    const barrelGeo = new THREE.CylinderGeometry(cfg.barrelRadius, cfg.barrelRadius, cfg.barrelLength, 8);
    barrelGeo.rotateX(Math.PI / 2);
    const barrel = new THREE.Mesh(barrelGeo, mat);
    barrel.position.set(0, 0.02, cfg.turretOffsetZ - cfg.turretLength * 0.35 - cfg.barrelLength * 0.4);
    turretPivot.add(barrel);

    const wheelX = Math.max(0.8, cfg.hullWidth * 0.45);
    const wheelZ = Math.max(1.2, cfg.hullLength * 0.34);
    [[-wheelX, wheelZ], [wheelX, wheelZ], [-wheelX, -wheelZ], [wheelX, -wheelZ]].forEach(([x, z]) => {
      _addWheel(group, cfg.wheelRadius, cfg.wheelWidth, x, z);
    });

    group.userData.unitType = type;
    return group;
  }

  function listUnits() {
    return Object.keys(UNIT_META).map(type => ({ type, ...UNIT_META[type] }));
  }

  function getUnitMeta(type) {
    return UNIT_META[type] || null;
  }

  function getUnitConfig(type) {
    return _clone(models[type] || DEFAULT_MODELS[type] || DEFAULT_MODELS.hostile_infantry);
  }

  function getDefaultUnitConfig(type) {
    return _clone(DEFAULT_MODELS[type] || DEFAULT_MODELS.hostile_infantry);
  }

  function updateUnitConfig(type, patch) {
    if (!models[type] || !patch) return;
    const next = { ...models[type] };
    Object.keys(patch).forEach(key => {
      if (key === 'color') {
        next.color = patch.color;
        return;
      }
      next[key] = _sanitizeNumber(patch[key], next[key]);
    });
    models[type] = next;
    _save();
    _dispatchChange(type);
  }

  function resetUnitConfig(type) {
    if (!DEFAULT_MODELS[type]) return;
    models[type] = _clone(DEFAULT_MODELS[type]);
    _save();
    _dispatchChange(type);
  }

  function resetAll() {
    models = _clone(DEFAULT_MODELS);
    _save();
    _dispatchChange(null);
  }

  function exportPreset() {
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      units: _clone(models)
    };
  }

  function createMesh(type, options = {}) {
    const meta = UNIT_META[type] || UNIT_META.hostile_infantry;
    const cfg = models[type] || DEFAULT_MODELS[type] || DEFAULT_MODELS.hostile_infantry;
    const colorOverride = options.color ? _hexToColor(options.color) : null;

    if (meta.category === 'infantry') return _buildInfantry(type, cfg, colorOverride);
    if (meta.category === 'truck') return _buildTruck(type, cfg, colorOverride);
    if (meta.category === 'tank') return _buildTank(type, cfg, colorOverride);
    if (meta.category === 'apc') return _buildAPC(type, cfg, colorOverride);
    return _buildInfantry(type, DEFAULT_MODELS.hostile_infantry, colorOverride);
  }

  _load();

  return {
    createMesh,
    exportPreset,
    getDefaultUnitConfig,
    getUnitConfig,
    getUnitMeta,
    listUnits,
    resetAll,
    resetUnitConfig,
    updateUnitConfig
  };
})();