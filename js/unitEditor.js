/* =============================================
   UNITEDITOR.JS — Unit appearance editor
   ============================================= */
'use strict';

const UnitEditorSystem = (() => {
  const CONTROL_DEFS = {
    infantry: [
      { key: 'bodyRadius', label: 'Body Radius', min: 0.18, max: 0.7, step: 0.01 },
      { key: 'bodyHeight', label: 'Body Height', min: 0.35, max: 1.8, step: 0.01 },
      { key: 'headRadius', label: 'Head Radius', min: 0.12, max: 0.5, step: 0.01 },
      { key: 'headGap', label: 'Head Gap', min: 0.02, max: 0.35, step: 0.01 },
      { key: 'gearWidth', label: 'Gear Width', min: 0.15, max: 0.9, step: 0.01 },
      { key: 'gearHeight', label: 'Gear Height', min: 0.1, max: 0.9, step: 0.01 },
      { key: 'gearDepth', label: 'Gear Depth', min: 0.08, max: 0.5, step: 0.01 }
    ],
    truck: [
      { key: 'hullWidth', label: 'Hull Width', min: 1.8, max: 4.8, step: 0.05 },
      { key: 'hullHeight', label: 'Hull Height', min: 0.4, max: 2.0, step: 0.05 },
      { key: 'hullLength', label: 'Hull Length', min: 2.5, max: 8.0, step: 0.05 },
      { key: 'cabWidth', label: 'Cab Width', min: 1.2, max: 4.5, step: 0.05 },
      { key: 'cabHeight', label: 'Cab Height', min: 0.5, max: 2.8, step: 0.05 },
      { key: 'cabLength', label: 'Cab Length', min: 0.8, max: 3.2, step: 0.05 },
      { key: 'cabOffsetZ', label: 'Cab Offset', min: -1.5, max: 2.5, step: 0.05 },
      { key: 'wheelRadius', label: 'Wheel Radius', min: 0.15, max: 0.9, step: 0.01 },
      { key: 'wheelWidth', label: 'Wheel Width', min: 0.1, max: 0.6, step: 0.01 }
    ],
    tank: [
      { key: 'hullWidth', label: 'Hull Width', min: 2.0, max: 5.0, step: 0.05 },
      { key: 'hullHeight', label: 'Hull Height', min: 0.4, max: 2.4, step: 0.05 },
      { key: 'hullLength', label: 'Hull Length', min: 3.0, max: 8.5, step: 0.05 },
      { key: 'turretWidth', label: 'Turret Width', min: 0.8, max: 3.6, step: 0.05 },
      { key: 'turretHeight', label: 'Turret Height', min: 0.25, max: 1.8, step: 0.05 },
      { key: 'turretLength', label: 'Turret Length', min: 0.8, max: 4.2, step: 0.05 },
      { key: 'turretOffsetZ', label: 'Turret Offset', min: -2.0, max: 2.0, step: 0.05 },
      { key: 'barrelRadius', label: 'Barrel Radius', min: 0.04, max: 0.35, step: 0.01 },
      { key: 'barrelLength', label: 'Barrel Length', min: 0.8, max: 4.5, step: 0.05 },
      { key: 'trackWidth', label: 'Track Width', min: 0.18, max: 0.8, step: 0.01 },
      { key: 'trackHeight', label: 'Track Height', min: 0.2, max: 1.0, step: 0.01 }
    ],
    apc: [
      { key: 'hullWidth', label: 'Hull Width', min: 2.0, max: 5.2, step: 0.05 },
      { key: 'hullHeight', label: 'Hull Height', min: 0.4, max: 2.2, step: 0.05 },
      { key: 'hullLength', label: 'Hull Length', min: 2.5, max: 7.5, step: 0.05 },
      { key: 'turretWidth', label: 'Turret Width', min: 0.5, max: 2.4, step: 0.05 },
      { key: 'turretHeight', label: 'Turret Height', min: 0.2, max: 1.4, step: 0.05 },
      { key: 'turretLength', label: 'Turret Length', min: 0.5, max: 2.8, step: 0.05 },
      { key: 'turretOffsetZ', label: 'Turret Offset', min: -1.6, max: 1.6, step: 0.05 },
      { key: 'barrelRadius', label: 'Barrel Radius', min: 0.03, max: 0.2, step: 0.01 },
      { key: 'barrelLength', label: 'Barrel Length', min: 0.6, max: 3.2, step: 0.05 },
      { key: 'wheelRadius', label: 'Wheel Radius', min: 0.15, max: 0.8, step: 0.01 },
      { key: 'wheelWidth', label: 'Wheel Width', min: 0.1, max: 0.6, step: 0.01 }
    ]
  };

  // Category → [hostile type, friendly type]
  const CATEGORY_TYPES = {
    infantry: ['hostile_infantry', 'friendly_infantry', 'hostile_machine_gunner', 'friendly_machine_gunner', 'hostile_anti_tank', 'friendly_anti_tank'],
    truck:    ['hostile_vehicle',  'friendly_vehicle'],
    tank:     ['hostile_tank',     'friendly_tank'],
    apc:      ['hostile_apc',      'friendly_apc']
  };
  const CATEGORY_LABELS = {
    infantry: 'Infantry',
    truck:    'Truck',
    tank:     'Tank',
    apc:      'APC'
  };

  let selectedCategory = 'infantry';
  let scene = null;
  let camera = null;
  let renderer = null;
  let previewMesh = null;
  let previewPivot = null;
  let stageEl = null;

  function init() {
    stageEl = document.getElementById('unit-editor-preview');
    if (!stageEl || renderer) return;

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    stageEl.appendChild(renderer.domElement);

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    camera.position.set(0, 2.6, 8.5);

    previewPivot = new THREE.Group();
    scene.add(previewPivot);

    const base = new THREE.Mesh(
      new THREE.CircleGeometry(2.6, 48),
      new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: true, opacity: 0.06 })
    );
    base.rotation.x = -Math.PI / 2;
    scene.add(base);

    const baseRing = new THREE.Mesh(
      new THREE.RingGeometry(2.75, 2.98, 64),
      new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: true, opacity: 0.24 })
    );
    baseRing.rotation.x = -Math.PI / 2;
    baseRing.position.y = 0.01;
    scene.add(baseRing);

    const crossX = new THREE.Mesh(
      new THREE.PlaneGeometry(6.6, 0.03),
      new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: true, opacity: 0.11 })
    );
    crossX.rotation.x = -Math.PI / 2;
    crossX.position.y = 0.015;
    scene.add(crossX);

    const crossZ = new THREE.Mesh(
      new THREE.PlaneGeometry(0.03, 6.6),
      new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: true, opacity: 0.11 })
    );
    crossZ.rotation.x = -Math.PI / 2;
    crossZ.position.y = 0.015;
    scene.add(crossZ);

    const axis = new THREE.Mesh(
      new THREE.CylinderGeometry(0.04, 0.04, 2.6, 10),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.16 })
    );
    axis.position.y = 1.3;
    scene.add(axis);

    _bindEvents();
    _renderTypeButtons();
    _renderControls();
    _resize();
    _rebuildPreview();
    window.addEventListener('resize', () => { _resize(); _rebuildPreview(); });
    window.addEventListener('ac130-unit-models-changed', () => {
      _renderControls();
      _rebuildPreview();
    });
    _loop();
  }

  function open() {
    init();
    _renderTypeButtons();
    _renderControls();
    _resize();
    // defer rebuild one frame so the DOM has laid out and getBoundingClientRect is accurate
    setTimeout(() => { _resize(); _rebuildPreview(); }, 50);
  }

  function _bindEvents() {
    const typeList = document.getElementById('unit-editor-types');
    const controls = document.getElementById('unit-editor-controls');
    const exportBtn = document.getElementById('unit-editor-export');
    const resetSelectedBtn = document.getElementById('unit-editor-reset-selected');
    const resetAllBtn = document.getElementById('unit-editor-reset-all');

    if (typeList) {
      typeList.addEventListener('click', e => {
        const btn = e.target.closest('[data-unit-category]');
        if (!btn) return;
        selectedCategory = btn.dataset.unitCategory;
        _renderTypeButtons();
        _renderControls();
        _rebuildPreview();
      });
    }

    if (controls) {
      controls.addEventListener('input', e => {
        const target = e.target;
        if (!target.dataset.key) return;
        const key = target.dataset.key;
        const patch = {};
        patch[key] = target.type === 'color' ? target.value : parseFloat(target.value);
        // Apply to both hostile and friendly
        CATEGORY_TYPES[selectedCategory].forEach(t => UnitModelSystem.updateUnitConfig(t, patch));
        _updateValueLabel(key, target.value);
      });
    }

    if (resetSelectedBtn) {
      resetSelectedBtn.addEventListener('click', () => {
        CATEGORY_TYPES[selectedCategory].forEach(t => UnitModelSystem.resetUnitConfig(t));
        _setStatus('Selected unit reset to default.');
      });
    }

    if (resetAllBtn) {
      resetAllBtn.addEventListener('click', () => {
        UnitModelSystem.resetAll();
        _setStatus('All unit presets reset to defaults.');
      });
    }

    if (exportBtn) {
      exportBtn.addEventListener('click', _exportPresetFile);
    }
  }

  function _renderTypeButtons() {
    const host = document.getElementById('unit-editor-types');
    if (!host) return;
    host.innerHTML = Object.keys(CATEGORY_TYPES).map(cat => `
      <button class="unit-type-btn${cat === selectedCategory ? ' active' : ''}" data-unit-category="${cat}">
        <span class="unit-type-name">${CATEGORY_LABELS[cat]}</span>
        <span class="unit-type-meta">HOSTILE + FRIENDLY</span>
      </button>
    `).join('');

    const label = document.getElementById('unit-editor-selection-label');
    if (label) label.textContent = `${CATEGORY_LABELS[selectedCategory].toUpperCase()} PREVIEW`;
  }

  function _renderControls() {
    const host = document.getElementById('unit-editor-controls');
    if (!host) return;
    const hostileType = CATEGORY_TYPES[selectedCategory][0];
    const cfg = UnitModelSystem.getUnitConfig(hostileType);
    const defs = CONTROL_DEFS[selectedCategory] || [];

    const colorRow = `
      <div class="unit-control-row unit-control-row-color">
        <label class="unit-control-label" for="unit-color-input">Thermal Color</label>
        <input type="color" id="unit-color-input" data-key="color" value="${cfg.color}">
      </div>
    `;

    const sliders = defs.map(def => `
      <div class="unit-control-row">
        <label class="unit-control-label" for="unit-control-${def.key}">${def.label}</label>
        <input class="unit-control-slider" id="unit-control-${def.key}" type="range" min="${def.min}" max="${def.max}" step="${def.step}" value="${cfg[def.key]}" data-key="${def.key}">
        <input class="unit-control-number" data-key="${def.key}" type="number" min="${def.min}" max="${def.max}" step="${def.step}" value="${Number(cfg[def.key]).toFixed(2)}">
      </div>
    `).join('');

    host.innerHTML = `
      <div class="unit-editor-panel-title unit-editor-controls-title">Appearance</div>
      ${colorRow}
      ${sliders}
    `;

    host.querySelectorAll('.unit-control-slider').forEach(slider => {
      slider.dataset.key = slider.id.replace('unit-control-', '');
      slider.addEventListener('input', () => {
        const number = host.querySelector(`.unit-control-number[data-key="${slider.dataset.key}"]`);
        if (number) number.value = slider.value;
      });
    });

    host.querySelectorAll('.unit-control-number').forEach(number => {
      number.addEventListener('input', () => {
        const slider = document.getElementById(`unit-control-${number.dataset.key}`);
        if (slider) slider.value = number.value;
      });
    });
  }

  function _updateValueLabel(key, value) {
    const valueEl = document.getElementById(`unit-value-${key}`);
    if (!valueEl) return;
    valueEl.textContent = key === 'color' ? String(value).toUpperCase() : Number(value).toFixed(2);
    _rebuildPreview();
    _setStatus('Preset updated and saved in-browser.');
  }

  function _setStatus(text) {
    const status = document.getElementById('unit-editor-status');
    if (status) status.textContent = text;
  }

  function _exportPresetFile() {
    const preset = UnitModelSystem.exportPreset();
    const json = JSON.stringify(preset, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 10);
    link.href = url;
    link.download = `ac130-unit-presets-${stamp}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    _setStatus(`Preset exported as ${link.download}. Send that JSON back and I can make it the default set.`);
  }

  function _rebuildPreview() {
    if (!scene) return;
    if (previewMesh && previewPivot) previewPivot.remove(previewMesh);
    // Preview uses the hostile variant as representative
    previewMesh = UnitModelSystem.createMesh(CATEGORY_TYPES[selectedCategory][0]);

    // Reset rotation BEFORE measuring so bounds aren't skewed by auto-spin
    previewPivot.rotation.set(0, 0, 0);
    previewPivot.add(previewMesh);

    const bounds = new THREE.Box3().setFromObject(previewMesh);
    const center = bounds.getCenter(new THREE.Vector3());
    previewMesh.position.set(-center.x, -bounds.min.y + 0.08, -center.z);

    const fitted = new THREE.Box3().setFromObject(previewPivot);
    const fittedSize = fitted.getSize(new THREE.Vector3());
    const maxDim = Math.max(fittedSize.x, fittedSize.y, fittedSize.z);

    const fov = camera.fov * Math.PI / 180;
    const dist = (maxDim * 0.5) / Math.tan(fov * 0.5) * 3.2;
    const focusHeight = fittedSize.y * 0.42;

    camera.position.set(dist * 0.55, focusHeight + dist * 0.3, dist);
    camera.lookAt(0, focusHeight, 0);
  }

  function _resize() {
    if (!renderer || !stageEl) return;
    const rect = stageEl.getBoundingClientRect();
    const width = Math.max(220, Math.floor(rect.width || 340));
    const height = Math.max(220, Math.floor(rect.height || 340));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  function _loop() {
    requestAnimationFrame(_loop);
    if (!renderer || !scene || !camera) return;
    const screen = document.getElementById('unit-editor-screen');
    if (!screen || screen.style.display === 'none') return;
    if (previewPivot) previewPivot.rotation.y += 0.01;
    renderer.render(scene, camera);
  }

  return { init, open };
})();