/* =============================================
   TERRAIN.JS — Procedural terrain & scene setup
   ============================================= */
'use strict';

const TerrainSystem = (() => {
  const FIELD_SIZE = 400;
  const GRID = 125;
  const OUTER_TERRAIN_SIZE = 1000;
  const OUTER_TERRAIN_DROP = 18;
  const OUTER_TERRAIN_RAMP = 180;

  let terrainMesh = null;
  let heightData = [];
  let scene = null;
  let _dynamicMeshes = [];
  let _terrainSkirtMeshes = [];

  // --- Materials (thermal palette) ---
  // We encode heat data in vertex colors:
  //   R channel = heat intensity read by shader
  //   Cold ground = low R, buildings = mid R

  function buildHeightmap() {
    heightData = [];
    for (let z = 0; z <= GRID; z++) {
      heightData[z] = [];
      for (let x = 0; x <= GRID; x++) {
        heightData[z][x] = 0;
      }
    }
  }

  function getHeightAt(worldX, worldZ) {
    // Map world coords to grid
    const hx = (worldX / FIELD_SIZE + 0.5) * GRID;
    const hz = (worldZ / FIELD_SIZE + 0.5) * GRID;
    const ix = Math.floor(hx);
    const iz = Math.floor(hz);
    const fx = hx - ix;
    const fz = hz - iz;
    const cx = Math.min(ix, GRID - 1);
    const cz = Math.min(iz, GRID - 1);
    const nx = Math.min(cx + 1, GRID);
    const nz = Math.min(cz + 1, GRID);
    const h00 = (heightData[cz] && heightData[cz][cx]) ? heightData[cz][cx] : 0;
    const h10 = (heightData[cz] && heightData[cz][nx]) ? heightData[cz][nx] : 0;
    const h01 = (heightData[nz] && heightData[nz][cx]) ? heightData[nz][cx] : 0;
    const h11 = (heightData[nz] && heightData[nz][nx]) ? heightData[nz][nx] : 0;
    return Utils.lerp(Utils.lerp(h00, h10, fx), Utils.lerp(h01, h11, fx), fz);
  }

  function getOuterTerrainDistance(worldX, worldZ) {
    return Math.max(Math.abs(worldX) - FIELD_SIZE * 0.5, Math.abs(worldZ) - FIELD_SIZE * 0.5, 0);
  }

  function getOuterTerrainHeight(worldX, worldZ) {
    const outerDist = getOuterTerrainDistance(worldX, worldZ);
    const falloff = Utils.clamp(outerDist / OUTER_TERRAIN_RAMP, 0, 1);
    const broadNoise = Math.sin(worldX * 0.0105) * 1.2 + Math.cos(worldZ * 0.0095) * 1.0;
    const ridgeNoise = (Utils.voronoiNoise2D(worldX, worldZ, 46, 0.85) - 0.5) * 5.5;
    return -Math.pow(falloff, 1.35) * OUTER_TERRAIN_DROP + (broadNoise + ridgeNoise) * 0.28 * falloff;
  }

  function getGroundHeatAt(worldX, worldZ, height = 0) {
    const fineWave = Math.sin(worldX * 0.075) * 0.0018 + Math.cos(worldZ * 0.068) * 0.0018;
    const crossWave = Math.sin((worldX + worldZ) * 0.052) * 0.0016;
    const finePatchNoise = (Utils.voronoiNoise2D(worldX, worldZ, 11.5, 1.1) - 0.5) * 0.009;
    const breakupNoise = (Utils.voronoiNoise2D(worldX + 31.7, worldZ - 17.3, 6.5, 0.8) - 0.5) * 0.005;
    const ridgeBoost = height > 3 ? 0.015 : 0;
    return Utils.clamp(0.074 + fineWave + crossWave + finePatchNoise + breakupNoise + ridgeBoost, 0.062, 0.092);
  }

  function buildOuterTerrainPatch(width, length, segW, segL, centerX, centerZ) {
    const geo = new THREE.PlaneGeometry(width, length, segW, segL);
    geo.rotateX(-Math.PI / 2);

    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const worldX = pos.getX(i) + centerX;
      const worldZ = pos.getZ(i) + centerZ;
      const y = getOuterTerrainHeight(worldX, worldZ);
      const heat = getGroundHeatAt(worldX, worldZ, y);
      pos.setY(i, y);
      colors[i * 3] = heat;
      colors[i * 3 + 1] = heat;
      colors[i * 3 + 2] = heat;
    }

    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      vertexColors: true,
      color: 0xffffff
    }));
    mesh.position.set(centerX, 0, centerZ);
    return mesh;
  }

  function addOuterTerrainSkirt() {
    _terrainSkirtMeshes.forEach(mesh => {
      scene.remove(mesh);
      disposeMeshTree(mesh);
    });
    _terrainSkirtMeshes = [];

    const outerHalf = OUTER_TERRAIN_SIZE * 0.5;
    const innerHalf = FIELD_SIZE * 0.5;
    const band = outerHalf - innerHalf;
    const patches = [
      buildOuterTerrainPatch(OUTER_TERRAIN_SIZE, band, 40, 14, 0, innerHalf + band * 0.5),
      buildOuterTerrainPatch(OUTER_TERRAIN_SIZE, band, 40, 14, 0, -innerHalf - band * 0.5),
      buildOuterTerrainPatch(band, FIELD_SIZE, 14, 24, innerHalf + band * 0.5, 0),
      buildOuterTerrainPatch(band, FIELD_SIZE, 14, 24, -innerHalf - band * 0.5, 0)
    ];

    patches.forEach(mesh => {
      scene.add(mesh);
      _terrainSkirtMeshes.push(mesh);
    });
  }

  function buildTerrain(sceneRef) {
    scene = sceneRef;
    buildHeightmap();

    const geo = new THREE.PlaneGeometry(FIELD_SIZE, FIELD_SIZE, GRID, GRID);
    geo.rotateX(-Math.PI / 2);

    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const hx = Math.round((x / FIELD_SIZE + 0.5) * GRID);
      const hz = Math.round((z / FIELD_SIZE + 0.5) * GRID);
      const cx = Utils.clamp(hx, 0, GRID);
      const cz = Utils.clamp(hz, 0, GRID);
      const h  = (heightData[cz] && heightData[cz][cx]) ? heightData[cz][cx] : 0;
      pos.setY(i, h);

      const heat = getGroundHeatAt(x, z, h);
      colors[i * 3] = heat;
      colors[i * 3 + 1] = heat;
      colors[i * 3 + 2] = heat;
    }

    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    const mat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      color: 0xffffff
    });

    terrainMesh = new THREE.Mesh(geo, mat);
    terrainMesh.receiveShadow = false;
    scene.add(terrainMesh);

    addOuterTerrainSkirt();
  }

  function createRoadMesh(width, length, baseHeat = 0.08) {
    const segW = Math.max(1, Math.ceil(width / 2));
    const segL = Math.max(1, Math.ceil(length / 6));
    const geo = new THREE.PlaneGeometry(width, length, segW, segL);
    geo.rotateX(-Math.PI / 2);

    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
const noise = Math.sin(x * 0.75) * 0.004 + Math.cos(z * 0.48) * 0.003 + (Math.random() - 0.5) * 0.0025;
const heat = Utils.clamp(baseHeat + noise, 0.07, 0.105);
      colors[i * 3] = heat;
      colors[i * 3 + 1] = heat;
      colors[i * 3 + 2] = heat;
    }

    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, color: 0xffffff }));
  }

  function addRoads() {
    // Two crossing roads
    const roadW = 6;
    const positions = [
      // N-S road
      { w: roadW, h: FIELD_SIZE, xr: 0, zr: 0, rotY: 0 },
      // E-W road
      { w: FIELD_SIZE, h: roadW, xr: 0, zr: -10, rotY: 0 }
    ];
    positions.forEach(r => {
      const m = createRoadMesh(r.w, r.h);
      m.position.set(r.xr, 0.1, r.zr);
      scene.add(m);
      _dynamicMeshes.push(m);
    });
  }

  function createHeatMaterial(heat) {
    return new THREE.MeshBasicMaterial({
      color: new THREE.Color(heat, heat, heat)
    });
  }

  function createTreeMaterial() {
    return new THREE.MeshBasicMaterial({
      vertexColors: true,
      color: 0xffffff
    });
  }

  function createTreeMesh(height) {
    const radius = 3.0;
    const geo = new THREE.ConeGeometry(radius, height, 5, 6);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const crownBaseHeat = Utils.randFloat(0.092, 0.118);
    const trunkShadowStrength = Utils.randFloat(0.01, 0.018);

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const verticalT = Utils.clamp((y + height * 0.5) / height, 0, 1);
      const lowerBandT = Utils.clamp((verticalT - 0.03) / 0.42, 0, 1);
      const baseShadow = 1 - Math.pow(lowerBandT, 1.55);
      const coldPatchNoise = Math.max(0, Math.sin(x * 1.4) * 0.5 + Math.cos(z * 1.1) * 0.5 + (Math.random() - 0.5) * 0.45);
      const coldPatchAmount = coldPatchNoise * 0.03;
      const baseHeat = crownBaseHeat - baseShadow * trunkShadowStrength;
      const heat = Utils.clamp(baseHeat - coldPatchAmount, 0.075, 0.19);
      colors[i * 3] = heat;
      colors[i * 3 + 1] = heat;
      colors[i * 3 + 2] = heat;
    }

    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return new THREE.Mesh(geo, createTreeMaterial());
  }

  function createRockMaterial() {
    return new THREE.MeshBasicMaterial({
      vertexColors: true,
      color: 0xffffff
    });
  }

  function createRockMesh(radius) {
    const geo = new THREE.IcosahedronGeometry(radius, 0);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const baseHeat = Utils.randFloat(0.072, 0.096);
    const topCapY = radius * 0.34;

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const normalizedY = y / Math.max(radius, 0.001);
      const shoulderNoise = (Utils.voronoiNoise2D(x * 1.45 + 11.7, z * 1.45 - 4.9, 1.15, 0.75) - 0.5) * 0.18;
      const broadNoise = Math.sin(x * 1.1) * 0.04 + Math.cos(z * 1.0) * 0.04;
      const lateralScale = 1.02 + shoulderNoise + broadNoise;
      const heightScale = normalizedY > 0.28
        ? 0.46 + shoulderNoise * 0.08
        : normalizedY < -0.5
          ? 0.66
          : 0.76 + shoulderNoise * 0.1;
      const leanX = z * 0.028;
      const leanZ = -x * 0.024;
      let newY = y * heightScale;
      if (newY > topCapY) newY = topCapY + (newY - topCapY) * 0.08;
      pos.setXYZ(
        i,
        x * lateralScale + leanX,
        newY,
        z * lateralScale + leanZ
      );

      const verticalT = Utils.clamp((y / Math.max(radius, 0.001) + 1) * 0.5, 0, 1);
      const coldPatchNoise = Math.max(0, Math.sin(x * 1.7) * 0.5 + Math.cos(z * 1.35) * 0.5 + (Math.random() - 0.5) * 0.35);
      const heat = Utils.clamp(baseHeat + verticalT * 0.004 - coldPatchNoise * 0.018, 0.05, 0.11);
      colors[i * 3] = heat;
      colors[i * 3 + 1] = heat;
      colors[i * 3 + 2] = heat;
    }

    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    return new THREE.Mesh(geo, createRockMaterial());
  }

  function getRockCount() {
    if (typeof MenuSystem === 'undefined' || !MenuSystem.getQuality) return 16;
    const quality = MenuSystem.getQuality();
    if (quality === 'low') return 8;
    if (quality === 'medium') return 12;
    return 18;
  }

  function canPlaceRock(x, z, radius, placedRocks) {
    if (Math.abs(x) < 18 || Math.abs(z + 10) < 18) return false;
    if (Math.hypot(x, z) < 60) return false;

    for (let i = 0; i < _currentBuildings.length; i++) {
      const b = _currentBuildings[i];
      const clearance = Math.hypot((b.w || 4) * 0.5, (b.d || 4) * 0.5) + radius + 8;
      if (Math.hypot(x - b.x, z - b.z) < clearance) return false;
    }

    for (let i = 0; i < placedRocks.length; i++) {
      const rock = placedRocks[i];
      if (Math.hypot(x - rock.x, z - rock.z) < rock.radius + radius + 8) return false;
    }

    return true;
  }

  function addDefaultRocks() {
    const placedRocks = [];
    const rockCount = getRockCount();
    let attempts = 0;

    while (placedRocks.length < rockCount && attempts < rockCount * 14) {
      attempts += 1;
      const angle = Math.random() * Math.PI * 2;
      const dist = Utils.randFloat(95, FIELD_SIZE * 0.5 - 22);
      const x = Math.cos(angle) * dist + Utils.randFloat(-16, 16);
      const z = Math.sin(angle) * dist + Utils.randFloat(-16, 16);
      const radius = Utils.randFloat(1.3, 2.9);
      if (!canPlaceRock(x, z, radius, placedRocks)) continue;

      const mesh = createRockMesh(radius);
      const scaleX = Utils.randFloat(0.9, 1.3);
      const scaleY = Utils.randFloat(0.52, 0.82);
      const scaleZ = Utils.randFloat(0.9, 1.35);
      const groundY = getHeightAt(x, z);
      mesh.scale.set(scaleX, scaleY, scaleZ);
      mesh.rotation.set(Utils.randFloat(-0.2, 0.2), Math.random() * Math.PI * 2, Utils.randFloat(-0.2, 0.2));
      mesh.position.set(x, groundY + radius * scaleY * 0.72, z);
      scene.add(mesh);
      _dynamicMeshes.push(mesh);

      const rockW = radius * scaleX * 1.8;
      const rockD = radius * scaleZ * 1.8;
      const rockH = radius * scaleY * 1.9;
      _currentBuildings.push({
        mesh,
        x,
        z,
        w: rockW,
        d: rockD,
        h: rockH,
        bottomHeat: 0.072,
        topHeat: 0.09,
        groundY,
        hp: Infinity,
        maxHp: Infinity,
        destroyed: false,
        isTerrainProp: true,
        indestructible: true
      });

      placedRocks.push({ x, z, radius: Math.max(rockW, rockD) * 0.5 });
    }
  }

  function getWindowQualityMultiplier() {
    if (typeof MenuSystem === 'undefined' || !MenuSystem.getQuality) return 1.0;
    const quality = MenuSystem.getQuality();
    if (quality === 'low') return 0.45;
    if (quality === 'medium') return 0.7;
    return 1.0;
  }

  function createBuildingBoxGeometry(w, h, d) {
    const segW = Math.max(2, Math.ceil(w / 3));
    const segH = Math.max(2, Math.ceil(h / 3));
    const segD = Math.max(2, Math.ceil(d / 3));
    return new THREE.BoxGeometry(w, h, d, segW, segH, segD);
  }

  function createGradientBoxMesh(w, h, d, bottomHeat, topHeat) {
    const geo = createBuildingBoxGeometry(w, h, d);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const t = Utils.clamp((y + h / 2) / h, 0, 1);
      const gradientT = Math.pow(t, 1.35);
      const baseHeat = Utils.lerp(bottomHeat, topHeat, gradientT);
      const voronoi = Utils.voronoiNoise2D(x, z, 8.5, 0.95);
      const grain = (Math.random() - 0.5) * 0.0045;
      const noise = (voronoi - 0.5) * 0.03 + grain;
      const heat = Utils.clamp(baseHeat + noise, 0, 1);
      colors[i * 3] = heat;
      colors[i * 3 + 1] = heat;
      colors[i * 3 + 2] = heat;
    }

    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.translate(0, h / 2, 0);

    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      vertexColors: true,
      color: 0xffffff
    }));

    return mesh;
  }

  function addWindowBand(parent, span, fixedOffset, baseY, rowCount, rowStep, windowWidth, windowHeight, isDepthFace, topHeat) {
    const qualityMult = getWindowQualityMultiplier();
    const edgePad = Math.min(1.4, span * 0.16);
    const usableSpan = Math.max(span - edgePad * 2, span * 0.35);
    const targetSpacing = Math.max(windowWidth * 1.75, span < 9 ? 2.8 : 2.15);
    const baseColumns = Math.max(1, Math.floor((usableSpan + targetSpacing * 0.35) / targetSpacing));
    const columns = Math.max(1, Math.round(baseColumns * qualityMult));
    const columnStep = columns > 1 ? usableSpan / (columns - 1) : 0;

    for (let row = 0; row < rowCount; row++) {
      const localY = baseY + row * rowStep;
      for (let col = 0; col < columns; col++) {
        const localSpan = columns === 1 ? 0 : -usableSpan / 2 + col * columnStep;
        const isDarkWindow = Math.random() < 0.34;
        const heat = isDarkWindow
          ? Utils.randFloat(0.01, 0.045)
          : Utils.clamp(topHeat + Utils.randFloat(0.02, 0.05), 0.12, 0.75);
        const geometry = isDepthFace
          ? new THREE.BoxGeometry(0.16, windowHeight, windowWidth)
          : new THREE.BoxGeometry(windowWidth, windowHeight, 0.16);
        const mesh = new THREE.Mesh(geometry, createHeatMaterial(heat));
        mesh.userData.buildingPart = 'window';
        mesh.userData.baseHeat = heat;

        if (isDepthFace) {
          mesh.position.set(fixedOffset, localY, localSpan);
        } else {
          mesh.position.set(localSpan, localY, fixedOffset);
        }

        parent.add(mesh);
      }
    }
  }

  function addBuildingWindows(parent, w, h, d, topHeat) {
    const qualityMult = getWindowQualityMultiplier();
    const shortSide = Math.min(w, d);
    const footprint = w * d;
    const isHouseScale = h < 8 && shortSide < 9 && footprint < 80;
    const windowWidthW = Utils.clamp(w * (isHouseScale ? 0.16 : 0.11), 0.52, isHouseScale ? 1.05 : 1.2);
    const windowWidthD = Utils.clamp(d * (isHouseScale ? 0.16 : 0.11), 0.52, isHouseScale ? 1.05 : 1.2);
    const windowHeight = Utils.clamp(h * 0.08, 0.55, 1.15);
    const topMargin = Math.max(1.6, h * 0.16);
    const bottomMargin = Math.max(1.2, h * 0.12);
    const usableHeight = Math.max(h - topMargin - bottomMargin, windowHeight);
    const targetRowSpacing = isHouseScale ? 3.3 : 2.35;
    const baseRows = Math.max(1, Math.floor((usableHeight + targetRowSpacing * 0.3) / targetRowSpacing));
    const rows = Math.max(1, Math.round(baseRows * qualityMult));
    const rowSpan = rows > 1 ? usableHeight - windowHeight : 0;
    const baseY = bottomMargin + windowHeight / 2;
    const rowStep = rows > 1 ? rowSpan / (rows - 1) : 0;

    addWindowBand(parent, w, d / 2 + 0.1, baseY, rows, rowStep, windowWidthW, windowHeight, false, topHeat);
    addWindowBand(parent, w, -d / 2 - 0.1, baseY, rows, rowStep, windowWidthW, windowHeight, false, topHeat);
    addWindowBand(parent, d, w / 2 + 0.1, baseY, rows, rowStep, windowWidthD, windowHeight, true, topHeat);
    addWindowBand(parent, d, -w / 2 - 0.1, baseY, rows, rowStep, windowWidthD, windowHeight, true, topHeat);
  }

  function addRooftopAccessBox(parent, w, h, d, bottomHeat, topHeat) {
    const boxW = Utils.clamp(w * Utils.randFloat(0.24, 0.36), 1.8, Math.max(2.2, w * 0.52));
    const boxD = Utils.clamp(d * Utils.randFloat(0.24, 0.36), 1.8, Math.max(2.2, d * 0.52));
    const boxH = Utils.clamp(h * Utils.randFloat(0.16, 0.24), 1.4, 4.2);

    const offsetRangeX = Math.max(0, w / 2 - boxW / 2 - 0.9);
    const offsetRangeZ = Math.max(0, d / 2 - boxD / 2 - 0.9);
    const boxBottomHeat = Utils.lerp(bottomHeat, topHeat, 0.7);
    const mesh = createGradientBoxMesh(boxW, boxH, boxD, boxBottomHeat, topHeat);
    mesh.userData.buildingPart = 'roof-box';
    mesh.position.set(
      Utils.randFloat(-offsetRangeX, offsetRangeX),
      h,
      Utils.randFloat(-offsetRangeZ, offsetRangeZ)
    );
    parent.add(mesh);
  }

  function createBuildingMesh(w, h, d, bottomHeat, topHeat) {
    const building = new THREE.Group();
    const shell = createGradientBoxMesh(w, h, d, bottomHeat, topHeat);
    shell.userData.buildingPart = 'shell';

    building.add(shell);
    addBuildingWindows(building, w, h, d, topHeat);
    addRooftopAccessBox(building, w, h, d, bottomHeat, topHeat);

    return building;
  }

  function disposeMeshTree(mesh) {
    if (!mesh || !mesh.traverse) return;
    mesh.traverse(node => {
      if (node.geometry) node.geometry.dispose();
      if (!node.material) return;
      if (Array.isArray(node.material)) node.material.forEach(mat => mat && mat.dispose && mat.dispose());
      else if (node.material.dispose) node.material.dispose();
    });
  }

  function replaceTrackedMesh(oldMesh, newMesh) {
    const idx = _dynamicMeshes.indexOf(oldMesh);
    if (idx >= 0) _dynamicMeshes[idx] = newMesh;
  }

  function refreshBuildingVisuals() {
    if (!scene || !_currentBuildings.length) return;
    _currentBuildings.forEach(building => {
      if (!building || !building.mesh) return;
      if (building.bottomHeat === undefined || building.topHeat === undefined) return;

      const newMesh = createBuildingMesh(building.w, building.h, building.d, building.bottomHeat, building.topHeat);
      newMesh.position.copy(building.mesh.position);
      newMesh.rotation.copy(building.mesh.rotation);
      newMesh.scale.copy(building.mesh.scale);

      scene.add(newMesh);
      scene.remove(building.mesh);
      replaceTrackedMesh(building.mesh, newMesh);
      disposeMeshTree(building.mesh);
      building.mesh = newMesh;
    });
  }

  function buildBuildings(sceneRef) {
    scene = scene || sceneRef;
    const buildings = [];
    const positions = [
      // Outer ring (~100 units from center)
      { x: -100, z: -80 }, { x:  -50, z: -105 }, { x:    0, z: -100 }, { x:   50, z: -105 }, { x:  100, z:  -80 },
      { x: -110, z: -30 }, { x:  110, z:  -30 },
      { x: -110, z:  30 }, { x:  110, z:   30 },
      { x: -100, z:  80 }, { x:  -50, z:  105 }, { x:    0, z:  100 }, { x:   50, z:  105 }, { x:  100, z:   80 },
      // Mid ring (~60-70 units from center)
      { x:  -70, z:  -60 }, { x:  -20, z:  -72 }, { x:   20, z:  -72 }, { x:   70, z:  -60 },
      { x:  -75, z:    0 }, { x:   75, z:    0 },
      { x:  -70, z:   60 }, { x:  -20, z:   72 }, { x:   20, z:   72 }, { x:   70, z:   60 },
      // Inner ring (~35-45 units from center)
      { x:  -45, z:  -38 }, { x:    0, z:  -48 }, { x:   45, z:  -38 },
      { x:  -48, z:    0 }, { x:   48, z:    0 },
      { x:  -45, z:   38 }, { x:    0, z:   48 }, { x:   45, z:   38 },
    ];

    positions.forEach((pos) => {
      const w = Utils.randFloat(6, 12);
      const d = Utils.randFloat(6, 12);
      const h = Utils.randFloat(4, 20);
      const groundY = getHeightAt(pos.x, pos.z);

      // Concrete buildings stay cooler at the base and warm toward the roof.
      const bottomHeat = 0.035 + Math.random() * 0.018;
      const topHeat = 0.08 + Math.random() * 0.05;
      const mesh = createBuildingMesh(w, h, d, bottomHeat, topHeat);
      mesh.position.set(pos.x, groundY, pos.z);
      scene.add(mesh);
      _dynamicMeshes.push(mesh);

      buildings.push({
        mesh,
        x: pos.x,
        z: pos.z,
        w, d, h,
        bottomHeat,
        topHeat,
        maxHp: 100,
        hp: 100,
        destroyed: false,
        groundY
      });
    });
    return buildings;
  }

  function buildEnvironmentDetails(sceneRef) {
    // Trees / shrubs as heat cold objects
    scene = scene || sceneRef;
    for (let i = 0; i < 80; i++) {
      const pos = Utils.randomSpawnPos(180, 10);
      const groundY = getHeightAt(pos.x, pos.z);
      const h = Utils.randFloat(4, 10);
      const mesh = createTreeMesh(h);
      mesh.position.set(pos.x, groundY + h / 2 + Math.min(0.28, h * 0.04), pos.z);
      scene.add(mesh);
      _dynamicMeshes.push(mesh);
    }
  }

  // ---- Reset / Custom Missions ----

  let _currentBuildings = [];

  function resetForMission(sceneRef, customBuildingDefs, customRoadDefs) {
    scene = scene || sceneRef;
    // Remove all previously tracked dynamic meshes (roads, buildings, trees, rocks)
    _dynamicMeshes.forEach(m => scene.remove(m));
    _dynamicMeshes = [];
    _currentBuildings = [];

    if (customBuildingDefs || customRoadDefs) {
      // Custom layout from editor
      _addCustomRoads(customRoadDefs || []);
      _addCustomBuildings(customBuildingDefs || []);
      _addDefaultTrees(); // keep trees for atmosphere
    } else {
      // Default layout
      addRoads();
      _currentBuildings = buildBuildings(scene);
      buildEnvironmentDetails(scene);
      addDefaultRocks();
    }
  }

  function _addCustomBuildings(defs) {
    defs.forEach(b => {
      const bh   = b.h || 10;
      const gy   = b.groundY !== undefined ? b.groundY : getHeightAt(b.x, b.z);
      const bottomHeat = 0.065 + Math.random() * 0.018;
      const topHeat = 0.14 + Math.random() * 0.05;
      const mesh = createBuildingMesh(b.w, bh, b.d, bottomHeat, topHeat);
      mesh.position.set(b.x, gy, b.z);
      scene.add(mesh);
      _dynamicMeshes.push(mesh);
      _currentBuildings.push({
        mesh, x: b.x, z: b.z, w: b.w, d: b.d, h: bh,
        bottomHeat, topHeat,
        maxHp: 100, hp: 100, destroyed: false, groundY: gy
      });
    });
  }

  function _addCustomRoads(defs) {
    defs.forEach(r => {
      const dx  = r.x2 - r.x1, dz = r.z2 - r.z1;
      const len = Math.hypot(dx, dz) || 1;
      const ang = Math.atan2(dx, dz);
      const w   = r.width || 6;
      const mesh = createRoadMesh(w, len);
      mesh.rotation.y = ang;
      mesh.position.set((r.x1 + r.x2) / 2, 0.12, (r.z1 + r.z2) / 2);
      scene.add(mesh);
      _dynamicMeshes.push(mesh);
    });
  }

  function _addDefaultTrees() {
    for (let i = 0; i < 80; i++) {
      const pos = Utils.randomSpawnPos(180, 10);
      const gy  = getHeightAt(pos.x, pos.z);
      const h   = Utils.randFloat(4, 10);
      const mesh = createTreeMesh(h);
      mesh.position.set(pos.x, gy + h / 2 + Math.min(0.28, h * 0.04), pos.z);
      scene.add(mesh);
      _dynamicMeshes.push(mesh);
    }
  }

  function getBuildings() { return _currentBuildings; }

  function setupLighting(sceneRef) {
    // Soft ambient only — BasicMaterial ignores it but MeshLambertMaterial
    // on any remaining objects benefits from it
    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    sceneRef.add(ambient);
  }

  return {
    FIELD_SIZE,
    buildTerrain,
    buildBuildings,
    buildEnvironmentDetails,
    resetForMission,
    refreshBuildingVisuals,
    getBuildings,
    setupLighting,
    getHeightAt
  };
})();
