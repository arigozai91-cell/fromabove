/* =============================================
   EDITOR.JS — Mission Editor
   Top-down FLIR view  ·  place buildings / units / roads
   ============================================= */
'use strict';

const MissionEditor = (() => {

  // ---- State ----
  let _active   = false;
  let _scene    = null;
  let _renderer = null;
  let _editorCam = null;

  let _camX = 0, _camZ = 0, _camZoom = 270;
  const _keys = {};

  let _tool          = 'building';
  let _objects       = [];   // { type, mesh, data }
  let _buildDrag     = null; // { startX, startZ }
  let _roadStart     = null; // { x, z, dotMesh }
  let _panState      = null; // middle-mouse pan
  let _previewMesh   = null;
  let _groundPlane   = null;
  let _raycaster     = null;
  let _gridSize      = 5;    // snap grid (5 / 10 / 20)
  let _gridHelper    = null;
  let _undoStack     = [];   // undo history (placed objects)

  // Waypoint letter counters per group
  const WP_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const _wpCount   = { hostile: 0, friendly: 0 }; // how many placed so far

  // ---- Thermal-ish colors (match what FLIR shows) ----
  const C_BUILDING   = new THREE.Color(0.13, 0.13, 0.13);
  const C_H_BLD      = new THREE.Color(0.22, 0.22, 0.22);   // hostile building (slightly warmer)
  const C_F_BLD      = new THREE.Color(0.34, 0.34, 0.34);   // friendly building (warmer still)
  const C_H_INF      = new THREE.Color(0.82, 0.82, 0.82);
  const C_H_VEH      = new THREE.Color(0.92, 0.92, 0.92);
  const C_H_TNK      = new THREE.Color(0.98, 0.98, 0.98);   // tanks brighter (more heat)
  const C_F_INF      = new THREE.Color(0.50, 0.50, 0.50);
  const C_F_VEH      = new THREE.Color(0.55, 0.55, 0.55);
  const C_F_TNK      = new THREE.Color(0.62, 0.62, 0.62);   // friendly tank
  const C_H_APC      = new THREE.Color(0.88, 0.88, 0.88);   // hostile APC
  const C_F_APC      = new THREE.Color(0.58, 0.58, 0.58);   // friendly APC
  const C_ROAD       = new THREE.Color(0.05, 0.05, 0.05);
  const C_PREVIEW    = new THREE.Color(0.35, 0.35, 0.35);
  const C_WP_HOSTILE = new THREE.Color(0.95, 0.25, 0.25);   // red
  const C_WP_FRIEND  = new THREE.Color(0.25, 0.80, 0.35);   // green
  const C_STRUCTURE  = new THREE.Color(0.45, 0.55, 0.45);   // deployed structure (warm green)
  const C_STRUCTURE_H = new THREE.Color(0.70, 0.25, 0.20);  // hostile structure (red)

  const HINTS = {
    building:           'Drag to size a building, or click once for a default block.',
    hostile_building:   'Drag to size a hostile building, or click once for a default block.',
    friendly_building:  'Drag to size a friendly building, or click once for a default block.',
    road:               'Click once to place a road start point, then click again to finish it.',
    hostile_infantry:   'Click to place hostile infantry.',
    hostile_machine_gunner: 'Click to place a hostile machine gunner.',
    hostile_anti_tank:  'Click to place hostile anti-tank infantry.',
    hostile_vehicle:    'Click to place a hostile truck.',
    hostile_tank:       'Click to place a hostile tank.',
    hostile_apc:        'Click to place a hostile APC.',
    friendly_infantry:  'Click to place friendly infantry.',
    friendly_machine_gunner: 'Click to place a friendly machine gunner.',
    friendly_anti_tank: 'Click to place friendly anti-tank infantry.',
    friendly_vehicle:   'Click to place a friendly vehicle.',
    friendly_tank:      'Click to place a friendly tank.',
    friendly_apc:       'Click to place a friendly APC.',
    waypoint_hostile:   'Click to place hostile patrol waypoints in order.',
    waypoint_friendly:  'Click to place friendly patrol waypoints in order.',
    struct_bunker:      'Click to place a friendly bunker.',
    struct_bofors:      'Click to place a friendly Bofors gun.',
    struct_artillery:   'Click to place friendly artillery.',
    struct_h_bunker:    'Click to place a hostile bunker.',
    struct_h_bofors:    'Click to place a hostile Bofors gun.',
    struct_h_artillery: 'Click to place hostile artillery.',
    delete:             'Click the nearest placed object to remove it.',
  };

  // ---- Init ----

  function init(sceneRef, rendererRef) {
    _scene    = sceneRef;
    _renderer = rendererRef;
    _raycaster = new THREE.Raycaster();

    _groundPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(800, 800),
      new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide })
    );
    _groundPlane.rotation.x = -Math.PI / 2;
    _groundPlane.position.y = 0.05;
    _scene.add(_groundPlane);

    const aspect = window.innerWidth / window.innerHeight;
    _editorCam = new THREE.PerspectiveCamera(55, aspect, 1, 1400);
    _syncCam();

    _bindCanvasEvents();
    _bindToolbarEvents();

    window.addEventListener('resize', () => {
      if (!_editorCam) return;
      _editorCam.aspect = window.innerWidth / window.innerHeight;
      _editorCam.updateProjectionMatrix();
    });
  }

  // ---- Camera ----

  function _syncCam() {
    _editorCam.position.set(_camX, _camZoom, _camZ + 0.01);
    _editorCam.lookAt(_camX, 0, _camZ);
    _editorCam.updateProjectionMatrix();
  }

  function _handlePanKeys() {
    const spd = (_camZoom / 270) * 2.5;
    if (_keys['w'] || _keys['arrowup'])    _camZ -= spd;
    if (_keys['s'] || _keys['arrowdown'])  _camZ += spd;
    if (_keys['a'] || _keys['arrowleft'])  _camX -= spd;
    if (_keys['d'] || _keys['arrowright']) _camX += spd;
    const F = 210;
    _camX = Utils.clamp(_camX, -F, F);
    _camZ = Utils.clamp(_camZ, -F, F);
  }

  // ---- Open / Close ----

  function open() {
    _active   = true;
    _buildDrag = null;
    _panState  = null;

    // Cancel any in-progress road / preview (UI transient state only)
    _cancelRoadStart();
    _clearPreview();

    document.getElementById('editor-screen').style.display = 'flex';
    document.body.classList.add('editor-active');

    // Set blank terrain (no default buildings/roads)
    TerrainSystem.resetForMission(_scene, [], []);

    // Re-add any previously placed object meshes back into the scene
    // (they were removed on close() but their data was preserved)
    _objects.forEach(o => { if (o.mesh) _scene.add(o.mesh); });

    _updateGrid();
    _setTool('building');
    _updateCounters();
    _loop();
  }

  function close() {
    _active   = false;
    _buildDrag = null;
    _panState  = null;
    document.getElementById('editor-screen').style.display = 'none';
    document.body.classList.remove('editor-active');
    _clearPreview();
    _cancelRoadStart();
    if (_gridHelper) { _scene.remove(_gridHelper); _gridHelper = null; }
    // Remove meshes from the scene but KEEP _objects so state is restored on next open()
    _objects.forEach(o => { if (o.mesh) _scene.remove(o.mesh); });
    // Restore the default map so the main menu background looks normal
    TerrainSystem.resetForMission(_scene);
  }

  // ---- Render Loop ----

  function _loop() {
    if (!_active) return;
    requestAnimationFrame(_loop);
    _handlePanKeys();
    _syncCam();
    ThermalSystem.render(_renderer, _scene, _editorCam, 0);
  }

  // ---- Raycasting ----

  function _getWorldPos(e) {
    const canvas = _renderer.domElement;
    const rect   = canvas.getBoundingClientRect();
    const nx = ((e.clientX - rect.left) / rect.width)  *  2 - 1;
    const ny = ((e.clientY - rect.top)  / rect.height) * -2 + 1;
    _raycaster.setFromCamera({ x: nx, y: ny }, _editorCam);
    const hits = _raycaster.intersectObject(_groundPlane);
    if (!hits.length) return null;
    return { x: hits[0].point.x, z: hits[0].point.z };
  }

  function _snap(v, g) { const gs = g !== undefined ? g : _gridSize; return Math.round(v / gs) * gs; }

  // Rebuild THREE.GridHelper whenever grid size changes
  function _updateGrid() {
    if (_gridHelper) { _scene.remove(_gridHelper); _gridHelper = null; }
    const divs = Math.round(800 / _gridSize);
    _gridHelper = new THREE.GridHelper(800, divs, 0x222222, 0x1a1a1a);
    _gridHelper.position.y = 0.09;
    _scene.add(_gridHelper);
    // Update active state on grid buttons
    document.querySelectorAll('.editor-grid-btn').forEach(b =>
      b.classList.toggle('active', parseInt(b.dataset.grid) === _gridSize)
    );
  }

  // Undo last placement
  function _undo() {
    if (!_undoStack.length) return;
    const last = _undoStack.pop();
    _scene.remove(last.mesh);
    _objects = _objects.filter(o => o !== last);
    // If it was a waypoint, decrement that group's counter
    if (last.type === 'waypoint_hostile') _wpCount.hostile = Math.max(0, _wpCount.hostile - 1);
    if (last.type === 'waypoint_friendly') _wpCount.friendly = Math.max(0, _wpCount.friendly - 1);
    _updateCounters();
  }

  // ---- Tool ----

  function _setTool(tool) {
    _tool = tool;
    _clearPreview();
    _cancelRoadStart();
    _buildDrag = null;
    document.querySelectorAll('.editor-tool').forEach(b =>
      b.classList.toggle('active', b.dataset.tool === tool)
    );
    const h = document.getElementById('editor-hint');
    if (h) h.textContent = HINTS[tool] || '';
  }

  // ---- Preview ----

  function _clearPreview() {
    if (_previewMesh) { _scene.remove(_previewMesh); _previewMesh = null; }
  }

  function _updatePreview(wx, wz) {
    // Update cursor coords display
    const cEl = document.getElementById('editor-coords');
    if (cEl) cEl.textContent = `X:${Math.round(wx)}  Z:${Math.round(wz)}`;

    if (_tool === 'building' || _tool === 'hostile_building' || _tool === 'friendly_building') {
      const bh = parseFloat(document.getElementById('editor-bheight').value) || 10;
      if (_buildDrag) {
        const bx1 = Math.min(_buildDrag.startX, _snap(wx));
        const bz1 = Math.min(_buildDrag.startZ, _snap(wz));
        const bx2 = Math.max(_buildDrag.startX, _snap(wx));
        const bz2 = Math.max(_buildDrag.startZ, _snap(wz));
        const bw  = Math.max(_gridSize, bx2 - bx1);
        const bd  = Math.max(_gridSize, bz2 - bz1);
        const cx  = (bx1 + bx2) / 2;
        const cz  = (bz1 + bz2) / 2;
        _clearPreview();
        _previewMesh = _makeBuildingMesh(bw, bh, bd, C_PREVIEW);
        _previewMesh.position.set(cx, TerrainSystem.getHeightAt(cx, cz) + bh / 2, cz);
        _scene.add(_previewMesh);
      } else {
        const sx = _snap(wx), sz = _snap(wz);
        if (!_previewMesh) {
          _previewMesh = _makeBuildingMesh(12, bh, 10, C_PREVIEW);
          _scene.add(_previewMesh);
        }
        _previewMesh.position.set(sx, TerrainSystem.getHeightAt(sx, sz) + bh / 2, sz);
      }
    } else if (_tool === 'road') {
      _clearPreview();
      if (_roadStart) {
        const ex = _snap(wx), ez = _snap(wz);
        _previewMesh = _makeRoadMesh(_roadStart.x, _roadStart.z, ex, ez, 6, C_PREVIEW);
        _scene.add(_previewMesh);
      }
    } else if (_tool === 'struct_bunker' || _tool === 'struct_bofors' || _tool === 'struct_artillery' ||
               _tool === 'struct_h_bunker' || _tool === 'struct_h_bofors' || _tool === 'struct_h_artillery') {
      const ux = _snap(wx), uz = _snap(wz);
      const isHostile = _tool.includes('struct_h_');
      const dims = _structDims(_tool);
      if (!_previewMesh) {
        _previewMesh = _makeBuildingMesh(dims.w, dims.h, dims.d, isHostile ? C_STRUCTURE_H : C_STRUCTURE);
        _scene.add(_previewMesh);
      }
      const gy = TerrainSystem.getHeightAt(ux, uz);
      _previewMesh.position.set(ux, gy + dims.h / 2, uz);
    } else if (_tool !== 'delete') {
      const ux = _snap(wx), uz = _snap(wz);
      if (!_previewMesh) {
        _previewMesh = _makeUnitMesh(_tool, C_PREVIEW);
        _scene.add(_previewMesh);
      }
      const gy = TerrainSystem.getHeightAt(ux, uz);
      _previewMesh.position.set(ux, gy, uz);
    } else {
      _clearPreview();
    }
  }

  // ---- Mesh Builders ----

  function _paintBuildingNoise(geo, baseColor) {
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const baseR = baseColor.r;
    const baseG = baseColor.g;
    const baseB = baseColor.b;

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const voronoi = Utils.voronoiNoise2D(x, z, 8.5, 0.95);
      const grain = (Math.random() - 0.5) * 0.035;
      const noise = (voronoi - 0.5) * 0.24 + grain;
      colors[i * 3] = Utils.clamp(baseR + noise, 0, 1);
      colors[i * 3 + 1] = Utils.clamp(baseG + noise, 0, 1);
      colors[i * 3 + 2] = Utils.clamp(baseB + noise, 0, 1);
    }

    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  }

  function _createBuildingBoxGeometry(w, h, d) {
    const segW = Math.max(2, Math.ceil(w / 3));
    const segH = Math.max(2, Math.ceil(h / 3));
    const segD = Math.max(2, Math.ceil(d / 3));
    return new THREE.BoxGeometry(w, h, d, segW, segH, segD);
  }

  function _makeBuildingMesh(w, h, d, col) {
    const geo = _createBuildingBoxGeometry(w, h, d);
    _paintBuildingNoise(geo, col || C_BUILDING);
    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({ vertexColors: true, color: 0xffffff })
    );
    return mesh;
  }

  function _makeUnitMesh(type, col) {
    return UnitModelSystem.createMesh(type, col ? { color: col } : {});
  }

  function _makeRoadMaterial(baseColor) {
    const heat = baseColor || C_ROAD;
    return new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(1, 1, 1) });
  }

  function _paintRoadNoise(geo, baseColor) {
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const baseR = baseColor.r;
    const baseG = baseColor.g;
    const baseB = baseColor.b;

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const noise = Math.sin(x * 0.75) * 0.035 + Math.cos(z * 0.28) * 0.03 + (Math.random() - 0.5) * 0.02;
      colors[i * 3] = Utils.clamp(baseR + noise, 0, 1);
      colors[i * 3 + 1] = Utils.clamp(baseG + noise, 0, 1);
      colors[i * 3 + 2] = Utils.clamp(baseB + noise, 0, 1);
    }

    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  }

  function _makeRoadMesh(x1, z1, x2, z2, w, col) {
    const dx  = x2 - x1, dz = z2 - z1;
    const len = Math.hypot(dx, dz) || 1;
    const ang = Math.atan2(dx, dz);
    const width = w || 6;
    const geo = new THREE.PlaneGeometry(width, len, Math.max(1, Math.ceil(width / 2)), Math.max(1, Math.ceil(len / 6)));
    geo.rotateX(-Math.PI / 2);
    _paintRoadNoise(geo, col || C_ROAD);
    const mesh = new THREE.Mesh(geo, _makeRoadMaterial(col || C_ROAD));
    mesh.rotation.y = ang;
    mesh.position.set((x1 + x2) / 2, 0.12, (z1 + z2) / 2);
    return mesh;
  }

  function _unitColor(type) {
    if (type === 'hostile_infantry')  return C_H_INF;
    if (type === 'hostile_machine_gunner') return C_H_INF;
    if (type === 'hostile_anti_tank') return C_H_INF;
    if (type === 'hostile_vehicle')   return C_H_VEH;
    if (type === 'hostile_tank')      return C_H_TNK;
    if (type === 'hostile_apc')       return C_H_APC;
    if (type === 'friendly_apc')      return C_F_APC;
    if (type === 'friendly_infantry') return C_F_INF;
    if (type === 'friendly_machine_gunner') return C_F_INF;
    if (type === 'friendly_anti_tank') return C_F_INF;
    if (type === 'friendly_vehicle')  return C_F_VEH;
    if (type === 'friendly_tank')     return C_F_TNK;
    return C_PREVIEW;
  }

  // Build a waypoint marker: coloured sphere + canvas label
  function _makeWaypointMesh(letter, isHostile) {
    const col = isHostile ? C_WP_HOSTILE : C_WP_FRIEND;
    const group = new THREE.Group();

    // Pole
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.15, 0.15, 4, 6),
      new THREE.MeshBasicMaterial({ color: col })
    );
    pole.position.y = 2;
    group.add(pole);

    // Sphere top
    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(1.2, 8, 8),
      new THREE.MeshBasicMaterial({ color: col })
    );
    sphere.position.y = 4.8;
    group.add(sphere);

    // Canvas label sprite
    const canvas = document.createElement('canvas');
    canvas.width = 64; canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 64, 64);
    ctx.fillStyle = isHostile ? '#ff4444' : '#44cc55';
    ctx.font = 'bold 40px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(letter, 32, 34);
    const tex = new THREE.CanvasTexture(canvas);
    const spriteMat = new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.scale.set(3, 3, 1);
    sprite.position.y = 7.0;
    group.add(sprite);

    return group;
  }

  // ---- Placement / Deletion ----

  function _placeBuilding(x1, z1, x2, z2, buildType) {
    buildType = buildType || 'building';
    const bx1 = Math.min(x1, x2), bx2 = Math.max(x1, x2);
    const bz1 = Math.min(z1, z2), bz2 = Math.max(z1, z2);
    const bw  = Math.max(_gridSize, bx2 - bx1);
    const bd  = Math.max(_gridSize, bz2 - bz1);
    const cx  = (bx1 + bx2) / 2;
    const cz  = (bz1 + bz2) / 2;
    const bh  = parseFloat(document.getElementById('editor-bheight').value) || 10;
    const gy  = TerrainSystem.getHeightAt(cx, cz);
    let heat;
    if (buildType === 'hostile_building')      heat = 0.20 + Math.random() * 0.05;
    else if (buildType === 'friendly_building') heat = 0.32 + Math.random() * 0.06;
    else                                        heat = 0.09 + Math.random() * 0.04;
    const mesh = _makeBuildingMesh(bw, bh, bd, new THREE.Color(heat, heat, heat));
    mesh.position.set(cx, gy + bh / 2, cz);
    _scene.add(mesh);
    const obj = { type: buildType, mesh, data: { x: cx, z: cz, w: bw, d: bd, h: bh, groundY: gy } };
    _objects.push(obj);
    _undoStack.push(obj);
    _updateCounters();
  }

  function _placeUnit(type, wx, wz) {
    const ux = _snap(wx), uz = _snap(wz);
    const gy = TerrainSystem.getHeightAt(ux, uz);
    const mesh = _makeUnitMesh(type);
    mesh.position.set(ux, gy, uz);
    _scene.add(mesh);
    const obj = { type, mesh, data: { x: ux, z: uz } };
    _objects.push(obj);
    _undoStack.push(obj);
    _updateCounters();
  }

  function _placeRoad(x1, z1, x2, z2) {
    if (Math.hypot(x2 - x1, z2 - z1) < 5) return;
    const mesh = _makeRoadMesh(x1, z1, x2, z2, 6);
    _scene.add(mesh);
    const obj = { type: 'road', mesh, data: { x1, z1, x2, z2, width: 6 } };
    _objects.push(obj);
    _undoStack.push(obj);
    _updateCounters();
  }

  // ---- Structure Helpers ----

  function _structDims(type) {
    // strip 'struct_h_' or 'struct_' prefix to normalise
    const t = type.replace('struct_h_', '').replace('struct_', '');
    if (t === 'bunker')    return { w: 5,  d: 5, h: 4.0 };
    if (t === 'bofors')   return { w: 5,  d: 5, h: 5.5 };
    if (t === 'artillery') return { w: 4, d: 9, h: 4.5 };
    return { w: 5, d: 5, h: 4 };
  }

  function _placeStructure(type, wx, wz) {
    const ux = _snap(wx), uz = _snap(wz);
    const gy = TerrainSystem.getHeightAt(ux, uz);
    const dims = _structDims(type);
    const isHostile = type.includes('struct_h_');
    const mesh = _makeBuildingMesh(dims.w, dims.h, dims.d, isHostile ? C_STRUCTURE_H : C_STRUCTURE);
    mesh.position.set(ux, gy + dims.h / 2, uz);
    _scene.add(mesh);
    const obj = { type, mesh, data: { x: ux, z: uz } };
    _objects.push(obj);
    _undoStack.push(obj);
    _updateCounters();
  }

  function _placeWaypoint(group, wx, wz) {
    const isHostile = group === 'hostile';
    const idx    = _wpCount[group];
    const letter = WP_LETTERS[idx % WP_LETTERS.length];
    _wpCount[group]++;
    const px = _snap(wx), pz = _snap(wz);
    const gy = TerrainSystem.getHeightAt(px, pz);
    const mesh = _makeWaypointMesh(letter, isHostile);
    mesh.position.set(px, gy, pz);
    _scene.add(mesh);
    const obj = {
      type: isHostile ? 'waypoint_hostile' : 'waypoint_friendly',
      mesh,
      data: { x: px, z: pz, order: idx, letter, group }
    };
    _objects.push(obj);
    _undoStack.push(obj);
    _updateCounters();
  }

  function _deleteAt(wx, wz) {
    let closest = null, closestDist = 20;
    _objects.forEach(obj => {
      const d  = obj.data;
      const cx = (d.x !== undefined) ? d.x : (d.x1 + d.x2) / 2;
      const cz = (d.z !== undefined) ? d.z : (d.z1 + d.z2) / 2;
      const dist = Math.hypot(cx - wx, cz - wz);
      if (dist < closestDist) { closestDist = dist; closest = obj; }
    });
    if (closest) {
      _scene.remove(closest.mesh);
      _objects = _objects.filter(o => o !== closest);
    }
  }

  function _cancelRoadStart() {
    if (_roadStart && _roadStart.dotMesh) _scene.remove(_roadStart.dotMesh);
    _roadStart = null;
    _clearPreview();
  }

  // ---- Canvas Event Binding ----

  function _bindCanvasEvents() {
    const canvas = _renderer.domElement;

    canvas.addEventListener('mousedown', e => {
      if (!_active) return;
      if (e.button === 1) {
        e.preventDefault();
        _panState = { lastX: e.clientX, lastY: e.clientY };
        return;
      }
      if (e.button !== 0) return;
      // Ignore if clicking inside the toolbar overlay
      const tb = document.getElementById('editor-toolbar');
      if (tb && tb.contains(e.target)) return;

      const pos = _getWorldPos(e);
      if (!pos) return;

      if (_tool === 'building' || _tool === 'hostile_building' || _tool === 'friendly_building') {
        _buildDrag = { startX: _snap(pos.x), startZ: _snap(pos.z) };

      } else if (_tool === 'road') {
        if (!_roadStart) {
          const rx = _snap(pos.x), rz = _snap(pos.z);
          _roadStart = { x: rx, z: rz };
          const dot = new THREE.Mesh(
            new THREE.SphereGeometry(2.5, 6, 6),
            new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 0.5, 0.5) })
          );
          dot.position.set(rx, 1.5, rz);
          _scene.add(dot);
          _roadStart.dotMesh = dot;
        } else {
          const ex = _snap(pos.x), ez = _snap(pos.z);
          _clearPreview();
          _scene.remove(_roadStart.dotMesh);
          _placeRoad(_roadStart.x, _roadStart.z, ex, ez);
          _roadStart = null;
        }

      } else if (_tool === 'delete') {
        _deleteAt(pos.x, pos.z);

      } else if (_tool === 'waypoint_hostile') {
        _placeWaypoint('hostile', pos.x, pos.z);

      } else if (_tool === 'waypoint_friendly') {
        _placeWaypoint('friendly', pos.x, pos.z);

      } else if (_tool === 'struct_bunker' || _tool === 'struct_bofors' || _tool === 'struct_artillery' ||
                 _tool === 'struct_h_bunker' || _tool === 'struct_h_bofors' || _tool === 'struct_h_artillery') {
        _placeStructure(_tool, pos.x, pos.z);

      } else {
        _placeUnit(_tool, pos.x, pos.z);
      }
    });

    canvas.addEventListener('mousemove', e => {
      if (!_active) return;
      if (_panState) {
        const scale = _camZoom / 600;
        _camX -= (e.clientX - _panState.lastX) * scale;
        _camZ -= (e.clientY - _panState.lastY) * scale;
        const F = 210;
        _camX = Utils.clamp(_camX, -F, F);
        _camZ = Utils.clamp(_camZ, -F, F);
        _panState = { lastX: e.clientX, lastY: e.clientY };
        return;
      }
      const tb = document.getElementById('editor-toolbar');
      if (tb && tb.contains(e.target)) return;
      const pos = _getWorldPos(e);
      if (pos) _updatePreview(pos.x, pos.z);
    });

    canvas.addEventListener('mouseup', e => {
      if (!_active) return;
      if (e.button === 1) { _panState = null; return; }
      if (e.button !== 0) return;
      if ((_tool === 'building' || _tool === 'hostile_building' || _tool === 'friendly_building') && _buildDrag) {
        const pos = _getWorldPos(e);
        _clearPreview();
        if (pos) {
          const dx = Math.abs(_snap(pos.x) - _buildDrag.startX);
          const dz = Math.abs(_snap(pos.z) - _buildDrag.startZ);
          if (dx < _gridSize && dz < _gridSize) {
            // Tap = default size snapped to grid
            const half = _gridSize * 1.5;
            _placeBuilding(
              _buildDrag.startX - half, _buildDrag.startZ - half,
              _buildDrag.startX + half, _buildDrag.startZ + half,
              _tool
            );
          } else {
            _placeBuilding(_buildDrag.startX, _buildDrag.startZ, _snap(pos.x), _snap(pos.z), _tool);
          }
        }
        _buildDrag = null;
      }
    });

    canvas.addEventListener('wheel', e => {
      if (!_active) return;
      e.stopPropagation();
      e.preventDefault();
      _camZoom = Utils.clamp(_camZoom + e.deltaY * 0.4, 50, 580);
    }, { passive: false });

    window.addEventListener('keydown', e => {
      if (!_active) return;
      _keys[e.key.toLowerCase()] = true;
      if (e.key === 'Escape') { _cancelRoadStart(); return; }

      // Ctrl+Z = undo
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        _undo();
        return;
      }

      // Tool shortcuts (skip when typing in an input)
      if (e.target.tagName === 'INPUT') return;
      const toolKeys = { b: 'building', j: 'hostile_building', k: 'friendly_building',
                         r: 'road', h: 'hostile_infantry',
                         q: 'hostile_machine_gunner', c: 'hostile_anti_tank',
                         v: 'hostile_vehicle', t: 'hostile_tank', a: 'hostile_apc',
                         f: 'friendly_infantry',
                         e: 'friendly_machine_gunner', m: 'friendly_anti_tank',
                         g: 'friendly_vehicle', y: 'friendly_tank', z: 'friendly_apc',
                         x: 'delete',
                         '1': 'waypoint_hostile', '2': 'waypoint_friendly',
                         '3': 'struct_bunker', '4': 'struct_bofors', '5': 'struct_artillery',
                         '6': 'struct_h_bunker', '7': 'struct_h_bofors', '8': 'struct_h_artillery' };
      if (toolKeys[e.key.toLowerCase()]) _setTool(toolKeys[e.key.toLowerCase()]);
    });

    window.addEventListener('keyup', e => {
      _keys[e.key.toLowerCase()] = false;
    });
  }

  // ---- Toolbar Event Binding ----

  function _bindToolbarEvents() {
    const wire = () => {
      const savePanel = document.getElementById('editor-save-panel');
      const saveToggle = document.getElementById('editor-save-toggle');
      document.querySelectorAll('.editor-tool').forEach(btn =>
        btn.addEventListener('click', () => _setTool(btn.dataset.tool))
      );

      if (savePanel && saveToggle) {
        saveToggle.addEventListener('click', () => {
          const collapsed = savePanel.classList.toggle('collapsed');
          saveToggle.textContent = collapsed ? '+' : '−';
          saveToggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
        });
      }

      // Grid size buttons
      document.querySelectorAll('.editor-grid-btn').forEach(btn =>
        btn.addEventListener('click', () => {
          _gridSize = parseInt(btn.dataset.grid);
          _updateGrid();
        })
      );

      const saveBtn = document.getElementById('editor-save');
      const loadIn  = document.getElementById('editor-load-input');
      const loadBtn = document.getElementById('editor-load-btn');
      const playBtn = document.getElementById('editor-play');
      const clrBtn  = document.getElementById('editor-clear');
      const exitBtn = document.getElementById('editor-exit');

      if (saveBtn) saveBtn.addEventListener('click', saveToFile);

      if (loadBtn && loadIn) {
        loadBtn.addEventListener('click', () => loadIn.click());
        loadIn.addEventListener('change', e => {
          const file = e.target.files[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = ev => loadFromJSON(ev.target.result);
          reader.readAsText(file);
          e.target.value = '';
        });
      }

      if (playBtn) playBtn.addEventListener('click', () => {
        const nameEl = document.getElementById('editor-mission-name');
        const name   = (nameEl ? nameEl.value.trim() : '') || 'Custom Mission';
        const def    = _buildMissionDef(name);
        close();
        if (typeof Game !== 'undefined') Game.startCustomMission(def, { fromEditor: true });
      });

      if (clrBtn) clrBtn.addEventListener('click', clearAll);
      if (exitBtn) exitBtn.addEventListener('click', () => {
        close();
        if (typeof MenuSystem !== 'undefined') MenuSystem.showScreen('main-menu');
      });

      // Object count readout
      _updateCounters();
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', wire);
    } else {
      wire();
    }
  }

  function _updateCounters() {
    const el = document.getElementById('editor-counters');
    if (!el) return;
    const b   = _objects.filter(o => o.type === 'building').length;
    const hb  = _objects.filter(o => o.type === 'hostile_building').length;
    const fb  = _objects.filter(o => o.type === 'friendly_building').length;
    const hi  = _objects.filter(o => o.type === 'hostile_infantry').length;
    const hmg = _objects.filter(o => o.type === 'hostile_machine_gunner').length;
    const hat = _objects.filter(o => o.type === 'hostile_anti_tank').length;
    const hv  = _objects.filter(o => o.type === 'hostile_vehicle').length;
    const ht  = _objects.filter(o => o.type === 'hostile_tank').length;
    const ha  = _objects.filter(o => o.type === 'hostile_apc').length;
    const fi  = _objects.filter(o => o.type === 'friendly_infantry').length;
    const fmg = _objects.filter(o => o.type === 'friendly_machine_gunner').length;
    const fat = _objects.filter(o => o.type === 'friendly_anti_tank').length;
    const fv  = _objects.filter(o => o.type === 'friendly_vehicle').length;
    const ft  = _objects.filter(o => o.type === 'friendly_tank').length;
    const fa  = _objects.filter(o => o.type === 'friendly_apc').length;
    const r   = _objects.filter(o => o.type === 'road').length;
    const hwp = _wpCount.hostile;
    const fwp = _wpCount.friendly;
    const bnk = _objects.filter(o => o.type === 'struct_bunker').length;
    const bfr = _objects.filter(o => o.type === 'struct_bofors').length;
    const art = _objects.filter(o => o.type === 'struct_artillery').length;
    const hbnk = _objects.filter(o => o.type === 'struct_h_bunker').length;
    const hbfr = _objects.filter(o => o.type === 'struct_h_bofors').length;
    const hart = _objects.filter(o => o.type === 'struct_h_artillery').length;
    el.textContent = `BLD:${b}  H-BLD:${hb}  F-BLD:${fb}  H-INF:${hi}  H-MG:${hmg}  H-AT:${hat}  H-VEH:${hv}  H-TNK:${ht}  H-APC:${ha}  F-INF:${fi}  F-MG:${fmg}  F-AT:${fat}  F-VEH:${fv}  F-TNK:${ft}  F-APC:${fa}  RD:${r}  H-WP:${hwp}  F-WP:${fwp}` +
      ((bnk || bfr || art || hbnk || hbfr || hart) ? `  STR:${bnk}/${bfr}/${art}  H.STR:${hbnk}/${hbfr}/${hart}` : '');
  }

  // ---- Save / Load ----

  function saveToFile() {
    const nameEl     = document.getElementById('editor-mission-name');
    const fileNameEl = document.getElementById('editor-save-name');
    const name       = (nameEl ? nameEl.value.trim() : '') || 'Custom Mission';
    const rawFile    = fileNameEl ? fileNameEl.value.trim() : '';
    const fileName   = (rawFile || name).replace(/\.json$/i, '').replace(/\s+/g, '_');
    const data   = _buildMissionDef(name);
    const json   = JSON.stringify(data, null, 2);
    const blob   = new Blob([json], { type: 'application/json' });
    const url    = URL.createObjectURL(blob);
    const a      = document.createElement('a');
    a.href      = url;
    a.download  = fileName + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function loadFromJSON(jsonStr) {
    let data;
    try { data = JSON.parse(jsonStr); } catch (e) { alert('Invalid mission JSON'); return; }

    const nameEl = document.getElementById('editor-mission-name');
    if (nameEl && data.name) nameEl.value = data.name;

    clearAll();

    (data.customBuildings || data.buildings || []).forEach(b => {
      const buildType = b.faction || 'building';
      const bh   = b.h || 10;
      const gy   = TerrainSystem.getHeightAt(b.x, b.z);
      let heat;
      if (buildType === 'hostile_building')      heat = 0.20 + Math.random() * 0.05;
      else if (buildType === 'friendly_building') heat = 0.32 + Math.random() * 0.06;
      else                                        heat = 0.09 + Math.random() * 0.04;
      const mesh = _makeBuildingMesh(b.w, bh, b.d, new THREE.Color(heat, heat, heat));
      mesh.position.set(b.x, gy + bh / 2, b.z);
      _scene.add(mesh);
      _objects.push({ type: buildType, mesh, data: { ...b, groundY: gy } });
    });

    (data.customUnits || data.units || []).forEach(u => {
      const gy   = TerrainSystem.getHeightAt(u.x, u.z);
      // Structure entries saved as hostile_bunker / friendly_bofors etc.
      const structMatch = u.type.match(/^(hostile_|friendly_)?(bunker|bofors|artillery)$/);
      if (structMatch) {
        const isHostile = u.type.startsWith('hostile_');
        const base  = structMatch[2];
        const stype = isHostile ? 'struct_h_' + base : 'struct_' + base;
        const dims  = _structDims(stype);
        const mesh  = _makeBuildingMesh(dims.w, dims.h, dims.d, isHostile ? C_STRUCTURE_H : C_STRUCTURE);
        mesh.position.set(u.x, gy + dims.h / 2, u.z);
        _scene.add(mesh);
        _objects.push({ type: stype, mesh, data: { x: u.x, z: u.z } });
        return;
      }
      const mesh = _makeUnitMesh(u.type);
      mesh.position.set(u.x, gy, u.z);
      _scene.add(mesh);
      _objects.push({ type: u.type, mesh, data: { x: u.x, z: u.z } });
    });

    // Legacy: restore structures from old customStructures format
    (data.customStructures || []).forEach(s => {
      const isHostile = s.faction === 'hostile';
      const stype = isHostile ? 'struct_h_' + s.type : 'struct_' + s.type;
      const gy    = TerrainSystem.getHeightAt(s.x, s.z);
      const dims  = _structDims(stype);
      const mesh  = _makeBuildingMesh(dims.w, dims.h, dims.d, isHostile ? C_STRUCTURE_H : C_STRUCTURE);
      mesh.position.set(s.x, gy + dims.h / 2, s.z);
      _scene.add(mesh);
      _objects.push({ type: stype, mesh, data: { x: s.x, z: s.z } });
    });

    // Restore waypoints
    _wpCount.hostile = 0;
    _wpCount.friendly = 0;
    (data.hostileWaypoints || []).forEach((wp, i) => {
      const gy = TerrainSystem.getHeightAt(wp.x, wp.z);
      const mesh = _makeWaypointMesh(wp.letter || WP_LETTERS[i], true);
      mesh.position.set(wp.x, gy, wp.z);
      _scene.add(mesh);
      _objects.push({ type: 'waypoint_hostile', mesh, data: { x: wp.x, z: wp.z, order: i, letter: wp.letter || WP_LETTERS[i], group: 'hostile' } });
      _wpCount.hostile++;
    });
    (data.friendlyWaypoints || []).forEach((wp, i) => {
      const gy = TerrainSystem.getHeightAt(wp.x, wp.z);
      const mesh = _makeWaypointMesh(wp.letter || WP_LETTERS[i], false);
      mesh.position.set(wp.x, gy, wp.z);
      _scene.add(mesh);
      _objects.push({ type: 'waypoint_friendly', mesh, data: { x: wp.x, z: wp.z, order: i, letter: wp.letter || WP_LETTERS[i], group: 'friendly' } });
      _wpCount.friendly++;
    });

    _updateCounters();
  }

  // ---- Clear ----

  function clearAll() {
    _clearPreview();
    _cancelRoadStart();
    _buildDrag = null;
    _objects.forEach(o => _scene.remove(o.mesh));
    _objects = [];
    _wpCount.hostile = 0;
    _wpCount.friendly = 0;
    _updateCounters();
  }

  // ---- Export Mission Def ----

  function _buildMissionDef(name) {
    const buildings = _objects
      .filter(o => o.type === 'building' || o.type === 'hostile_building' || o.type === 'friendly_building')
      .map(o => ({
        x: o.data.x, z: o.data.z,
        w: o.data.w, d: o.data.d, h: o.data.h,
        groundY: o.data.groundY,
        faction: o.type
      }));

    const units = _objects
      .filter(o => o.type !== 'building' && o.type !== 'hostile_building' && o.type !== 'friendly_building' &&
                   o.type !== 'road' &&
                   o.type !== 'waypoint_hostile' && o.type !== 'waypoint_friendly' &&
                   o.type !== 'struct_bunker' && o.type !== 'struct_bofors' && o.type !== 'struct_artillery' &&
                   o.type !== 'struct_h_bunker' && o.type !== 'struct_h_bofors' && o.type !== 'struct_h_artillery')
      .map(o => ({ type: o.type, x: o.data.x, z: o.data.z }))
      // Append structures as unit entries with the correct faction prefix
      .concat(
        _objects
          .filter(o => o.type === 'struct_bunker' || o.type === 'struct_bofors' || o.type === 'struct_artillery' ||
                       o.type === 'struct_h_bunker' || o.type === 'struct_h_bofors' || o.type === 'struct_h_artillery')
          .map(o => {
            const isHostile = o.type.includes('struct_h_');
            const base = o.type.replace('struct_h_', '').replace('struct_', '');
            return { type: (isHostile ? 'hostile_' : 'friendly_') + base, x: o.data.x, z: o.data.z };
          })
      );

    const customStructures = _objects
      .filter(o => o.type === 'struct_bunker' || o.type === 'struct_bofors' || o.type === 'struct_artillery' ||
                   o.type === 'struct_h_bunker' || o.type === 'struct_h_bofors' || o.type === 'struct_h_artillery')
      .map(o => ({
        type:    o.type.replace('struct_h_', '').replace('struct_', ''),
        faction: o.type.includes('struct_h_') ? 'hostile' : 'friendly',
        x: o.data.x, z: o.data.z
      }));

    const roads = _objects
      .filter(o => o.type === 'road')
      .map(o => ({ x1: o.data.x1, z1: o.data.z1, x2: o.data.x2, z2: o.data.z2, width: o.data.width || 6 }));

    // Sort waypoints by placement order so A→B→C is respected
    const hostileWaypoints = _objects
      .filter(o => o.type === 'waypoint_hostile')
      .sort((a, b) => a.data.order - b.data.order)
      .map(o => ({ x: o.data.x, z: o.data.z, letter: o.data.letter }));

    const friendlyWaypoints = _objects
      .filter(o => o.type === 'waypoint_friendly')
      .sort((a, b) => a.data.order - b.data.order)
      .map(o => ({ x: o.data.x, z: o.data.z, letter: o.data.letter }));

    const hasEscort = friendlyWaypoints.length > 0;
    const hostileCount = units.filter(u =>
      u.type === 'hostile_infantry' || u.type === 'hostile_machine_gunner' || u.type === 'hostile_anti_tank' ||
      u.type === 'hostile_vehicle' || u.type === 'hostile_tank' || u.type === 'hostile_apc'
    ).length;

    return {
      id:                   'custom',
      name:                 name || 'Custom Mission',
      description:          'Custom mission created in the editor.',
      objective:            hasEscort
                              ? `ESCORT FRIENDLIES TO WAYPOINT ${friendlyWaypoints[friendlyWaypoints.length - 1].letter || 'EXTRACTION'}`
                              : hostileCount > 0 ? 'ELIMINATE ALL HOSTILE TARGETS' : 'HOLD POSITION',
      tag:                  hasEscort ? 'ESCORT · REACH EXTRACTION POINT' : (hostileCount > 0 ? 'ASSAULT' : 'DEFEND'),
      targetKills:          hasEscort ? null : (hostileCount > 0 ? hostileCount : null),
      timeLimitSec:         null,
      holdMode:             false,
      zombieWaveMode:       false,
      convoyMode:           false,
      escortMode:           hasEscort,
      bonusPerFriendlySaved: 500,
      infantryCount:        0,
      vehicleCount:         0,
      friendlyInfantry:     0,
      friendlyVehicles:     0,
      customUnits:          units,
      customBuildings:      buildings,
      customRoads:          roads,
      hostileWaypoints,
      friendlyWaypoints,
    };
  }

  return { init, open, close };
})();
