/* =============================================
   UTILS.JS — Shared helpers
   ============================================= */
'use strict';

const Utils = (() => {
  function randFloat(min, max) {
    return Math.random() * (max - min) + min;
  }

  function randInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  function clamp(val, min, max) {
    return Math.max(min, Math.min(max, val));
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function lerpV3(out, a, b, t) {
    out.x = a.x + (b.x - a.x) * t;
    out.y = a.y + (b.y - a.y) * t;
    out.z = a.z + (b.z - a.z) * t;
    return out;
  }

  function _hash2D(x, z) {
    const value = Math.sin(x * 127.1 + z * 311.7) * 43758.5453123;
    return value - Math.floor(value);
  }

  function voronoiNoise2D(x, z, cellSize = 12, jitter = 2) {
    const safeCellSize = Math.max(0.001, cellSize);
    const px = x / safeCellSize;
    const pz = z / safeCellSize;
    const cellX = Math.floor(px);
    const cellZ = Math.floor(pz);

    let nearest = Infinity;
    let secondNearest = Infinity;

    for (let offsetZ = -1; offsetZ <= 1; offsetZ++) {
      for (let offsetX = -1; offsetX <= 1; offsetX++) {
        const sampleCellX = cellX + offsetX;
        const sampleCellZ = cellZ + offsetZ;
        const jitterX = (_hash2D(sampleCellX, sampleCellZ) - 0.5) * jitter;
        const jitterZ = (_hash2D(sampleCellX + 19.19, sampleCellZ + 73.73) - 0.5) * jitter;
        const featureX = sampleCellX + 0.5 + jitterX;
        const featureZ = sampleCellZ + 0.5 + jitterZ;
        const dx = featureX - px;
        const dz = featureZ - pz;
        const dist = Math.sqrt(dx * dx + dz * dz);

        if (dist < nearest) {
          secondNearest = nearest;
          nearest = dist;
        } else if (dist < secondNearest) {
          secondNearest = dist;
        }
      }
    }

    const edgeDistance = Utils.clamp(secondNearest - nearest, 0, 1);
    const cellInterior = Utils.clamp(1 - nearest / 1.1, 0, 1);
    return Utils.clamp(cellInterior * 0.75 + edgeDistance * 0.65, 0, 1);
  }

  function dist2D(ax, az, bx, bz) {
    const dx = ax - bx;
    const dz = az - bz;
    return Math.sqrt(dx * dx + dz * dz);
  }

  function vecAdd(a, b) {
    return { x: a.x + b.x, z: a.z + b.z };
  }

  function vecScale(v, s) {
    return { x: v.x * s, z: v.z * s };
  }

  function vecNorm2D(v) {
    const len = Math.sqrt(v.x * v.x + v.z * v.z) || 1;
    return { x: v.x / len, z: v.z / len };
  }

  // Spawn position within the battlefield avoiding the center
  function randomSpawnPos(radius, minDist) {
    let x, z;
    do {
      x = randFloat(-radius, radius);
      z = randFloat(-radius, radius);
    } while (Math.sqrt(x * x + z * z) < minDist);
    return { x, z };
  }

  // World-to-screen projection
  function worldToScreen(worldPos, camera, renderer) {
    const vec = worldPos.clone().project(camera);
    const hw = renderer.domElement.clientWidth / 2;
    const hh = renderer.domElement.clientHeight / 2;
    return {
      x: vec.x * hw + hw,
      y: -vec.y * hh + hh,
      visible: vec.z < 1
    };
  }

  return {
    randFloat, randInt, clamp, lerp, lerpV3,
    voronoiNoise2D,
    dist2D, vecAdd, vecScale, vecNorm2D,
    randomSpawnPos, worldToScreen
  };
})();
