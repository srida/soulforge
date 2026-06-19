import { createUnitEl, updateUnitEl } from './UnitCard.js';

// Board3D — rendu Three.js du board (5 colonnes x 11 rangées) en remplacement de BoardGrid.

const ELEMENT_STYLES = {
  feu:    { color: 0xff6a3c, ringColor: 0xff8a3c, size: 0.08, speed: [1.5, 3.5], lift: [2, 4],     gravity: 2,  spin: 0, flash: false },
  eau:    { color: 0x4fc3f7, ringColor: 0x4fc3f7, size: 0.06, speed: [0.8, 2],   lift: [0.5, 1.5], gravity: 10, spin: 0, flash: false },
  foudre: { color: 0xfff066, ringColor: 0xfff9a8, size: 0.09, speed: [2, 5],     lift: [1, 4],     gravity: 6,  spin: 0, flash: true  },
  vent:   { color: 0xb8ffd8, ringColor: 0xc8ffe0, size: 0.06, speed: [1, 2.5],   lift: [1, 2.5],   gravity: 1,  spin: 4, flash: false },
};
const ELEMENT_ORDER = ['feu', 'eau', 'foudre', 'vent'];

function elementForCard(unit) {
  const k = String(unit?.card_id ?? unit?.id ?? unit?.name ?? '');
  let hash = 0;
  for (let i = 0; i < k.length; i++) hash = (hash * 31 + k.charCodeAt(i)) >>> 0;
  return ELEMENT_ORDER[hash % ELEMENT_ORDER.length];
}
// Tuiles WebGL + unités CSS3D (réutilise UnitCard.js sans modification).
// API publique miroir de BoardGrid (setBoard, setHighlight, refresh, enterCombatMode, ...)
// + accesseurs additionnels consommés par CombatAnimator3D.

const CSS3D_URL = 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/renderers/CSS3DRenderer.js';

export const COLS = 5;
export const TOTAL_ROWS = 11;
const PLAYER_ROWS = 4;   // rangées 0-3
const ENEMY_START = 7;   // rangées 7-10
const CELL = 1;
const CARD_PX = 90;
const CSS_SCALE = CELL / CARD_PX;
const FOV = 40;
// CSS3DObject scales the unit-card DOM by CSS_SCALE, so a screen-visible Npx ring
// must be specified as N / CSS_SCALE in the element's own (pre-scale) box-shadow.
const HIGHLIGHT_RING_PX = 4 / CSS_SCALE;

export async function createBoard3D(container, opts = {}) {
  const [THREE, { CSS3DRenderer, CSS3DObject }] = await Promise.all([
    import('three'),
    import(CSS3D_URL),
  ]);
  return new Board3D(THREE, CSS3DRenderer, CSS3DObject, container, opts);
}

function zForRow(row) { return (TOTAL_ROWS - 1 - row) * CELL; }
function xForCol(col) { return (col - (COLS - 1) / 2) * CELL; }
function key(pos) { return `${pos.col},${pos.row}`; }

function baseColorFor(row, col) {
  const alt = (col + row) % 2 === 0;
  if (row < PLAYER_ROWS) return alt ? 0x1c2440 : 0x222b4a;   // joueur
  if (row < ENEMY_START) return alt ? 0x14161f : 0x181b27;   // zone neutre
  return alt ? 0x401c24 : 0x4a222b;                          // ennemi
}

export class Board3D {
  constructor(THREE, CSS3DRenderer, CSS3DObject, container, opts) {
    this.THREE = THREE;
    this.CSS3DRenderer = CSS3DRenderer;
    this.CSS3DObject = CSS3DObject;
    this.container = container;
    this.onCellTap = opts.onCellTap || (() => {});
    this.onUnitTap = opts.onUnitTap || (() => {});
    this.onUnitDrag = opts.onUnitDrag || (() => {});
    this.onUnitLongPress = opts.onUnitLongPress || null;
    this.powerDb = opts.powerDb || null;
    this.attributeDb = opts.attributeDb || null;
    this.showEnemySide = opts.showEnemySide || false;

    this.board = null;
    this.unitObjs = new Map(); // uid -> { unit, obj, wrap, el, pos }
    this._highlighted = new Set();
    this._materialCandidates = new Set();
    this._materialSelected = new Set();
    this._blockedCells = new Set();
    this._selectedPos = null;
    this._combatMode = false;

    this.anims = [];
    this.bursts = [];
    this._running = true;

    this._buildScene();
    this._buildTiles();
    this._buildSeparators();
    this._bindPointerEvents();
    this._bindResize();

    this._setCameraImmediate(false);
    this._resize();
    this._animate();
  }

  // ── Scene / caméra ─────────────────────────────────────────────────────

  _buildScene() {
    const THREE = this.THREE;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0f1117);
    this.cssScene = new THREE.Scene();

    this.camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 100);
    this.camera.up.set(0, 0, -1);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.domElement.style.position = 'absolute';
    this.renderer.domElement.style.inset = '0';
    this.renderer.domElement.style.touchAction = 'none';
    this.container.appendChild(this.renderer.domElement);

    this.cssRenderer = new this.CSS3DRenderer();
    this.cssRenderer.domElement.style.position = 'absolute';
    this.cssRenderer.domElement.style.inset = '0';
    this.cssRenderer.domElement.style.pointerEvents = 'none';
    this.container.appendChild(this.cssRenderer.domElement);

    this.scene.add(new THREE.AmbientLight(0x8892b0, 0.8));
    const sun = new THREE.DirectionalLight(0xffffff, 0.9);
    sun.position.set(2, 10, 4);
    this.scene.add(sun);
  }

  _buildTiles() {
    const THREE = this.THREE;
    const tileGeo = new THREE.BoxGeometry(CELL * 0.94, 0.1, CELL * 0.94);
    this.tileMeshes = [];
    this.tilesByKey = new Map();
    for (let row = 0; row < TOTAL_ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const baseColor = baseColorFor(row, col);
        const mat = new THREE.MeshStandardMaterial({ color: baseColor, roughness: 0.85 });
        const tile = new THREE.Mesh(tileGeo, mat);
        tile.position.set(xForCol(col), 0, zForRow(row));
        tile.userData = { col, row, baseColor };
        this.scene.add(tile);
        this.tileMeshes.push(tile);
        this.tilesByKey.set(`${col},${row}`, tile);
      }
    }
  }

  _buildSeparators() {
    const THREE = this.THREE;
    const geo = new THREE.PlaneGeometry(COLS * CELL, 0.08);
    const makeSep = (zPos) => {
      const mat = new THREE.MeshBasicMaterial({ color: 0x6c63ff, transparent: true, opacity: 0.5, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(0, 0.07, zPos);
      mesh.visible = false;
      this.scene.add(mesh);
      return mesh;
    };
    this._separators = [
      makeSep((zForRow(3) + zForRow(4)) / 2),
      makeSep((zForRow(6) + zForRow(ENEMY_START)) / 2),
    ];
  }

  _aspect() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    return w / h;
  }

  _cameraFraming(combatMode) {
    const THREE = this.THREE;
    const minRow = 0;
    const maxRow = combatMode ? TOTAL_ROWS - 1 : PLAYER_ROWS - 1;
    const rowsVisible = (combatMode ? TOTAL_ROWS : PLAYER_ROWS) + 1.5;
    const centerZ = (zForRow(minRow) + zForRow(maxRow)) / 2;
    const vFov = THREE.MathUtils.degToRad(FOV);
    const aspect = this._aspect();
    const heightForRows = (rowsVisible * CELL) / (2 * Math.tan(vFov / 2));
    const heightForCols = (COLS * 1.25 * CELL) / (2 * Math.tan(vFov / 2) * aspect);
    const H = Math.max(heightForRows, heightForCols);
    return { centerZ, H };
  }

  _setCameraImmediate(combatMode) {
    const { centerZ, H } = this._cameraFraming(combatMode);
    this._camCenterZ = centerZ;
    this._camH = H;
    this.camera.position.set(0, H, centerZ);
    this.camera.lookAt(0, 0, centerZ);
  }

  _animateCameraTo(combatMode) {
    const from = { centerZ: this._camCenterZ, H: this._camH };
    const to = this._cameraFraming(combatMode);
    let t = 0;
    const duration = 0.5;
    const THREE = this.THREE;
    this.anims.push({
      update: (dt) => {
        t += dt;
        const p = Math.min(t / duration, 1);
        const eased = 1 - Math.pow(1 - p, 3);
        this._camCenterZ = THREE.MathUtils.lerp(from.centerZ, to.centerZ, eased);
        this._camH = THREE.MathUtils.lerp(from.H, to.H, eased);
        this.camera.position.set(0, this._camH, this._camCenterZ);
        this.camera.lookAt(0, 0, this._camCenterZ);
        return p < 1;
      },
    });
  }

  // ── API publique (miroir BoardGrid) ──────────────────────────────────────

  setBoard(board) {
    this.board = board;
  }

  setBlockedCells(cells) {
    this._blockedCells = new Set((cells || []).map(key));
    this._refreshTileColors();
  }

  setHighlight(cells) {
    this._highlighted = new Set((cells || []).map(key));
    this._refreshTileColors();
  }

  clearHighlight() {
    this._highlighted.clear();
    this._selectedPos = null;
    this._refreshTileColors();
  }

  setMaterialCandidates(cells) {
    this._materialCandidates = new Set((cells || []).map(key));
    this._refreshTileColors();
  }

  setMaterialSelected(cells) {
    this._materialSelected = new Set((cells || []).map(key));
    this._refreshTileColors();
  }

  clearMaterialHighlight() {
    this._materialCandidates.clear();
    this._materialSelected.clear();
    this._refreshTileColors();
  }

  setSelectedPos(pos) {
    this._selectedPos = pos ? { ...pos } : null;
    this._refreshTileColors();
  }

  expand() {
    // No-op : le cadrage caméra gère déjà prépa (4 rangées) vs combat (11 rangées).
  }

  enterCombatMode() {
    this._resize();
    this._combatMode = true;
    this._animateCameraTo(true);
    for (const sep of this._separators) sep.visible = true;
    for (const entry of this.unitObjs.values()) {
      if (entry.unit.side === 'enemy') this._fadeEntry(entry, true);
    }
  }

  exitCombatMode() {
    this._resize();
    this._combatMode = false;
    this._animateCameraTo(false);
    for (const sep of this._separators) sep.visible = false;
    for (const entry of this.unitObjs.values()) {
      if (entry.unit.side === 'enemy') this._fadeEntry(entry, false);
    }
    this.refresh();
  }

  gridEl() {
    return this;
  }

  refresh() {
    if (!this.board || this._combatMode) return;
    this._resize();
    const units = this.board.getAllUnits();
    const seen = new Set();
    for (const unit of units) {
      seen.add(unit.uid);
      let entry = this.unitObjs.get(unit.uid);
      if (!entry) {
        entry = this._spawnUnitObj(unit);
        this.unitObjs.set(unit.uid, entry);
      } else {
        updateUnitEl(entry.el, unit);
        const pos = unit.position;
        if (pos && (entry.pos.col !== pos.col || entry.pos.row !== pos.row)) {
          this._animateMove(entry, pos);
          entry.pos = { ...pos };
        }
      }
    }
    for (const [uid, entry] of [...this.unitObjs.entries()]) {
      if (!seen.has(uid)) {
        this._removeUnitObj(entry);
        this.unitObjs.delete(uid);
      }
    }
  }

  // ── Accesseurs additionnels (CombatAnimator3D) ───────────────────────────

  getUnitEntry(uid) {
    const entry = this.unitObjs.get(uid);
    if (!entry) return null;
    return { obj: entry.obj, el: entry.el, position: entry.unit.position };
  }

  tilePosition(pos) {
    return new this.THREE.Vector3(xForCol(pos.col), 0.06, zForRow(pos.row));
  }

  worldToScreen(vec3) {
    const v = vec3.clone().project(this.camera);
    const rect = this.renderer.domElement.getBoundingClientRect();
    return {
      x: rect.left + (v.x * 0.5 + 0.5) * rect.width,
      y: rect.top + (-v.y * 0.5 + 0.5) * rect.height,
    };
  }

  spawnBurst(pos, color, count = 70, opts = {}) {
    const THREE = this.THREE;
    const center = pos instanceof THREE.Vector3 ? pos : this.tilePosition(pos);
    const { speed: [speedMin, speedMax] = [1, 3], lift: [liftMin, liftMax] = [1.5, 3.5], size = 0.07, gravity = 6, spin = 0, maxLife = 0.6 } = opts;
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = center.x;
      positions[i * 3 + 1] = center.y + 0.04;
      positions[i * 3 + 2] = center.z;
      const theta = Math.random() * Math.PI * 2;
      const speed = speedMin + Math.random() * (speedMax - speedMin);
      velocities[i * 3] = Math.cos(theta) * speed;
      velocities[i * 3 + 1] = liftMin + Math.random() * (liftMax - liftMin);
      velocities[i * 3 + 2] = Math.sin(theta) * speed;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color, size, transparent: true, opacity: 1,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const points = new THREE.Points(geo, mat);
    this.scene.add(points);
    this.bursts.push({ points, velocities, life: 0, maxLife, gravity, spin });
  }

  spawnRing(pos, color, maxLife = 0.5, maxScale = 6) {
    const THREE = this.THREE;
    const center = pos instanceof THREE.Vector3 ? pos : this.tilePosition(pos);
    const geo = new THREE.RingGeometry(0.05, 0.18, 32);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(geo, mat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.copy(center);
    ring.position.y = 0.06;
    this.scene.add(ring);
    this.bursts.push({ ring, life: 0, maxLife, maxScale });
  }

  spawnFlash(center, color, intensity = 4, range = 4, maxLife = 0.25) {
    const THREE = this.THREE;
    const light = new THREE.PointLight(color, intensity, range, 2);
    light.position.set(center.x, 1.2, center.z);
    this.scene.add(light);
    this.bursts.push({ light, life: 0, maxLife, maxIntensity: intensity });
  }

  spawnHalo(center, color) {
    const THREE = this.THREE;
    this.spawnRing(new THREE.Vector3(center.x, 0, center.z), color, 0.7, 9);
    const geo2 = new THREE.RingGeometry(0.05, 0.22, 48);
    const mat2 = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.28, side: THREE.DoubleSide });
    const ring2 = new THREE.Mesh(geo2, mat2);
    ring2.rotation.x = -Math.PI / 2;
    ring2.position.set(center.x, 0.04, center.z);
    this.scene.add(ring2);
    this.bursts.push({ ring: ring2, life: 0, maxLife: 1.0, maxScale: 13 });
    this.spawnFlash(center, color, 5, 5, 0.55);
  }

  spawnElementImpact(position, element, tier = 1) {
    const THREE = this.THREE;
    const style = ELEMENT_STYLES[element] || ELEMENT_STYLES.feu;
    const t = Math.max(1, Math.min(5, tier));
    const CFG = [
      { count:  2, sM: 0.12, szM: 0.15, lM: 0.10, rS: 1.5, rL: 0.14, fi: 0,   fR: 0, fL: 0    },
      { count:  8, sM: 0.22, szM: 0.28, lM: 0.20, rS: 2.5, rL: 0.20, fi: 0,   fR: 0, fL: 0    },
      { count: 18, sM: 0.36, szM: 0.42, lM: 0.30, rS: 3.5, rL: 0.28, fi: 1.5, fR: 2, fL: 0.12 },
      { count: 32, sM: 0.52, szM: 0.58, lM: 0.42, rS: 5.0, rL: 0.36, fi: 3.0, fR: 3, fL: 0.16 },
      { count: 50, sM: 0.68, szM: 0.72, lM: 0.55, rS: 7.0, rL: 0.45, fi: 5.0, fR: 4, fL: 0.20 },
    ][t - 1];
    if (CFG.count > 0) {
      this.spawnBurst(position, style.color, CFG.count, {
        ...style,
        size:    style.size * CFG.szM,
        speed:   style.speed.map(v => v * CFG.sM),
        lift:    style.lift.map(v => v * CFG.sM),
        maxLife: CFG.lM,
      });
    }
    this.spawnRing(new THREE.Vector3(position.x, 0, position.z), style.ringColor, CFG.rL, CFG.rS);
    if (CFG.fi > 0) this.spawnFlash(position, style.color, CFG.fi, CFG.fR, CFG.fL);
    if (t === 5) this.spawnHalo(position, style.color);
  }

  playProjectile(fromPos, toPos, color = 0xffffff) {
    const THREE = this.THREE;
    return new Promise((resolve) => {
      const from = this.tilePosition(fromPos);
      const to = this.tilePosition(toPos);
      const geo = new THREE.SphereGeometry(0.08, 12, 12);
      const mat = new THREE.MeshBasicMaterial({ color });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(from);
      this.scene.add(mesh);
      let t = 0;
      const duration = 0.25;
      this.anims.push({
        update: (dt) => {
          t += dt;
          const p = Math.min(t / duration, 1);
          mesh.position.x = THREE.MathUtils.lerp(from.x, to.x, p);
          mesh.position.z = THREE.MathUtils.lerp(from.z, to.z, p);
          mesh.position.y = THREE.MathUtils.lerp(from.y, to.y, p) + Math.sin(p * Math.PI) * 0.6;
          if (p >= 1) {
            this.scene.remove(mesh);
            geo.dispose();
            mat.dispose();
            resolve();
            return false;
          }
          return true;
        },
      });
    });
  }

  // ── Tuiles : couleurs/teintes ────────────────────────────────────────────

  _refreshTileColors() {
    for (const tile of this.tileMeshes) this._updateTileColor(tile);
    for (const entry of this.unitObjs.values()) this._applyUnitHighlightClasses(entry);
  }

  _applyUnitHighlightClasses(entry) {
    const pos = entry.unit.position;
    const k = pos ? key(pos) : null;
    const el = entry.el;
    const wrap = entry.wrap;
    const isSelected = !!(pos && this._selectedPos && this._selectedPos.col === pos.col && this._selectedPos.row === pos.row);
    const isMatSelected = !!(k && this._materialSelected.has(k));
    const isMatCandidate = !!(k && this._materialCandidates.has(k));
    el.classList.toggle('selected', isSelected);
    el.classList.toggle('material-selected', isMatSelected);
    el.classList.toggle('material-candidate', isMatCandidate);

    // An inset box-shadow on the unit-card itself would be hidden behind its own
    // opaque artwork/gradient layers, so highlight via the CSS3D wrapper instead.
    // Its box-shadow/outline are scaled down to near-invisibility by CSS3DObject's
    // CSS_SCALE transform — compensate by sizing the ring in pre-scale px, and
    // allow it to render outside the wrapper's bounds.
    if (isMatSelected) {
      wrap.style.boxShadow = `inset 0 0 0 ${HIGHLIGHT_RING_PX}px var(--green)`;
    } else if (isMatCandidate) {
      wrap.style.boxShadow = `inset 0 0 0 ${HIGHLIGHT_RING_PX}px var(--yellow)`;
    } else if (isSelected) {
      wrap.style.boxShadow = `inset 0 0 0 ${HIGHLIGHT_RING_PX}px var(--accent)`;
    } else {
      wrap.style.boxShadow = '';
    }
  }

  _updateTileColor(tile) {
    const { col, row, baseColor } = tile.userData;
    const k = `${col},${row}`;
    let color = baseColor;
    let emissive = 0x000000;
    let intensity = 0;

    if (this._highlighted.has(k)) {
      color = 0x2a2a5c; emissive = 0x6c63ff; intensity = 0.35;
    }
    if (this._materialCandidates.has(k)) {
      emissive = 0xf0c040; intensity = 0.3;
    }
    if (this._materialSelected.has(k)) {
      color = 0x1c3a2e; emissive = 0x4caf80; intensity = 0.5;
    }
    if (this._selectedPos && this._selectedPos.col === col && this._selectedPos.row === row) {
      color = 0x2a2a5c; emissive = 0x6c63ff; intensity = 0.6;
    }
    if (this._blockedCells.has(k)) {
      color = 0x5a1a1a; emissive = 0xf04050; intensity = 0.25;
    }

    tile.material.color.setHex(color);
    tile.material.emissive.setHex(emissive);
    tile.material.emissiveIntensity = intensity;
  }

  // ── Unités CSS3D ──────────────────────────────────────────────────────────

  _visibilityFor(unit) {
    return (this._combatMode || this.showEnemySide || unit.side === 'player') ? 1 : 0;
  }

  _createTierFrame(tier) {
    const frame = document.createElement('div');
    frame.className = `poc3d-frame poc3d-frame-t${Math.max(1, Math.min(5, tier))}`;
    return frame;
  }

  _spawnUnitObj(unit) {
    const THREE = this.THREE;
    const pos = unit.position;
    const wrap = document.createElement('div');
    wrap.style.width = CARD_PX + 'px';
    wrap.style.height = CARD_PX + 'px';
    wrap.style.borderRadius = '6px';
    wrap.style.overflow = 'visible';
    wrap.style.pointerEvents = 'none';
    wrap.style.opacity = String(this._visibilityFor(unit));
    wrap.className = 'poc3d-card-wrap';
    const el = createUnitEl(unit);
    wrap.appendChild(el);
    wrap.appendChild(this._createTierFrame(unit.tier ?? 1));

    const obj = new this.CSS3DObject(wrap);
    // CSS3DObject force pointer-events: auto sur l'élément — on l'annule pour
    // que tous les pointer events passent par le canvas WebGL (raycasting).
    wrap.style.pointerEvents = 'none';
    obj.rotation.x = -Math.PI / 2;
    const x = xForCol(pos.col);
    const z = zForRow(pos.row);
    obj.position.set(x, 3, z);
    obj.scale.setScalar(CSS_SCALE);
    this.cssScene.add(obj);

    const element = elementForCard(unit);
    const entry = { unit, obj, wrap, el, pos: { ...pos }, element };
    this._applyUnitHighlightClasses(entry);

    let t = 0;
    const duration = 0.22;
    this.anims.push({
      update: (dt) => {
        t += dt;
        const p = Math.min(t / duration, 1);
        const eased = 1 - Math.pow(1 - p, 3);
        obj.position.y = THREE.MathUtils.lerp(3, 0.06, eased);
        if (p >= 1) {
          this.spawnElementImpact(new THREE.Vector3(x, 0.1, z), element, unit.tier ?? 1);
          return false;
        }
        return true;
      },
    });

    return entry;
  }

  animateUnitMove(uid, toPos, duration = 0.28) {
    const entry = this.unitObjs.get(uid);
    if (!entry) return;
    entry.pos = { ...toPos };
    this._animateMove(entry, toPos, duration);
  }

  removeUnitObj(uid) {
    const entry = this.unitObjs.get(uid);
    if (!entry) return;
    this._removeUnitObj(entry);
    this.unitObjs.delete(uid);
  }

  killUnitObj(uid) {
    const entry = this.unitObjs.get(uid);
    if (!entry) return;
    this.unitObjs.delete(uid);

    const THREE = this.THREE;
    const x = entry.obj.position.x;
    const z = entry.obj.position.z;
    if (x === undefined) { this.cssScene.remove(entry.obj); return; }
    const style = ELEMENT_STYLES[entry.element] || ELEMENT_STYLES.feu;
    const tier = Math.max(1, Math.min(5, entry.unit.tier ?? 1));

    const KILL_CFG = [
      { fc: 3, fr: 3, speed: 1.60, vy: 0.90, rot: 12, fi:  3.0, fR: 2.5, fL: 0.18, pc:  40, fS: 0.80, halo: false, spMax: 1.2, ltMax: 1.0, mLife: 0.38, grav: 7.0 },
      { fc: 3, fr: 3, speed: 2.20, vy: 1.20, rot: 14, fi:  5.0, fR: 3.5, fL: 0.22, pc:  65, fS: 0.90, halo: false, spMax: 1.8, ltMax: 1.4, mLife: 0.44, grav: 6.5 },
      { fc: 4, fr: 4, speed: 3.00, vy: 1.50, rot: 17, fi:  8.0, fR: 5.0, fL: 0.26, pc:  95, fS: 0.96, halo: false, spMax: 2.5, ltMax: 1.8, mLife: 0.50, grav: 6.0 },
      { fc: 4, fr: 4, speed: 3.80, vy: 2.00, rot: 22, fi: 12.0, fR: 7.0, fL: 0.30, pc: 140, fS: 1.00, halo: false, spMax: 3.2, ltMax: 2.2, mLife: 0.56, grav: 5.5 },
      { fc: 6, fr: 5, speed: 6.00, vy: 3.00, rot: 30, fi: 28.0, fR:14.0, fL: 0.45, pc: 220, fS: 1.00, halo: true,  spMax: 2.5, ltMax: 2.0, mLife: 0.65, grav: 5.0 },
    ][tier - 1];

    // Gèle toutes les animations CSS de la carte avant de la masquer
    entry.obj.visible = false;
    entry.wrap.querySelectorAll('*').forEach(el => {
      el.style.animation = 'none';
      el.style.transition = 'none';
    });
    entry.wrap.style.animation = 'none';
    entry.wrap.style.transition = 'none';

    const FCOLS = KILL_CFG.fc;
    const FROWS = KILL_CFG.fr;
    const fragW = CARD_PX / FCOLS;
    const fragH = CARD_PX / FROWS;
    const frags = [];

    for (let fc = 0; fc < FCOLS; fc++) {
      for (let fr = 0; fr < FROWS; fr++) {
        const clip = document.createElement('div');
        clip.style.width = fragW + 'px';
        clip.style.height = fragH + 'px';
        clip.style.overflow = 'hidden';
        clip.style.position = 'relative';
        clip.style.borderRadius = '2px';

        const inner = entry.wrap.cloneNode(true);
        inner.style.position = 'absolute';
        inner.style.left = (-fc * fragW) + 'px';
        inner.style.top  = (-fr * fragH) + 'px';
        inner.style.margin = '0';
        inner.style.pointerEvents = 'none';
        clip.appendChild(inner);

        const fobj = new this.CSS3DObject(clip);
        fobj.rotation.x = -Math.PI / 2;
        fobj.position.set(x, 0.06, z);
        fobj.scale.setScalar(CSS_SCALE * KILL_CFG.fS);
        this.cssScene.add(fobj);

        const dx = FCOLS > 1 ? fc / (FCOLS - 1) - 0.5 : 0;
        const dz = FROWS > 1 ? fr / (FROWS - 1) - 0.5 : 0;
        const angle = Math.atan2(dz, dx) + (Math.random() - 0.5) * 1.4;
        const speed = KILL_CFG.speed + Math.random() * KILL_CFG.speed;

        frags.push({
          obj: fobj,
          vx: Math.cos(angle) * speed,
          vy: 0.15 + Math.random() * KILL_CFG.vy,
          vz: Math.sin(angle) * speed,
          ry: (Math.random() - 0.5) * KILL_CFG.rot,
          rz: (Math.random() - 0.5) * KILL_CFG.rot * 0.7,
        });
      }
    }

    this.spawnFlash(new THREE.Vector3(x, 0.5, z), 0xffffff, KILL_CFG.fi, KILL_CFG.fR, KILL_CFG.fL);
    this.spawnBurst(new THREE.Vector3(x, 0.3, z), style.color, KILL_CFG.pc, {
      size:    style.size * KILL_CFG.fS * 1.1,
      speed:   [0.1, KILL_CFG.spMax],
      lift:    [0.1, KILL_CFG.ltMax],
      gravity: KILL_CFG.grav,
      maxLife: KILL_CFG.mLife,
    });
    if (KILL_CFG.halo) this.spawnHalo(new THREE.Vector3(x, 0, z), style.color);

    const MAX_T = 1.2;
    let t = 0;
    this.anims.push({
      update: (dt) => {
        t += dt;
        const p = Math.min(t / MAX_T, 1);
        for (const f of frags) {
          f.obj.position.x += f.vx * dt;
          f.obj.position.y += (f.vy - 7 * t) * dt;
          f.obj.position.z += f.vz * dt;
          f.obj.rotation.y += f.ry * dt;
          f.obj.rotation.z += f.rz * dt;
          f.obj.element.style.opacity = Math.max(0, 1 - p * 1.3);
        }
        if (p >= 1) {
          this.cssScene.remove(entry.obj);
          for (const f of frags) this.cssScene.remove(f.obj);
          return false;
        }
        return true;
      },
    });
  }

  playLunge(uid, towardPos) {
    const entry = this.unitObjs.get(uid);
    if (!entry) return;
    const THREE = this.THREE;
    const home = this.tilePosition(entry.unit.position);
    const target = this.tilePosition(towardPos);
    const lungeX = THREE.MathUtils.lerp(home.x, target.x, 0.3);
    const lungeZ = THREE.MathUtils.lerp(home.z, target.z, 0.3);
    let t = 0;
    const duration = 0.25;
    this.anims.push({
      update: (dt) => {
        t += dt;
        const p = Math.min(t / duration, 1);
        const f = p < 0.5 ? p * 2 : (1 - p) * 2;
        entry.obj.position.x = THREE.MathUtils.lerp(home.x, lungeX, f);
        entry.obj.position.z = THREE.MathUtils.lerp(home.z, lungeZ, f);
        return p < 1;
      },
    });
  }

  _animateMove(entry, toPos, duration = 0.28) {
    const THREE = this.THREE;
    const from = entry.obj.position.clone();
    const to = this.tilePosition(toPos);
    let t = 0;
    this.anims.push({
      update: (dt) => {
        t += dt;
        const p = Math.min(t / duration, 1);
        entry.obj.position.x = THREE.MathUtils.lerp(from.x, to.x, p);
        entry.obj.position.z = THREE.MathUtils.lerp(from.z, to.z, p);
        entry.obj.position.y = THREE.MathUtils.lerp(from.y, to.y, p);
        return p < 1;
      },
    });
  }

  _removeUnitObj(entry) {
    let t = 0;
    this.anims.push({
      update: (dt) => {
        t += dt;
        const s = Math.max(0, 1 - t / 0.2);
        entry.obj.scale.setScalar(CSS_SCALE * s);
        if (s <= 0) {
          this.cssScene.remove(entry.obj);
          return false;
        }
        return true;
      },
    });
  }

  _fadeEntry(entry, show) {
    const THREE = this.THREE;
    const from = show ? 0 : 1;
    const to = show ? 1 : 0;
    if (parseFloat(entry.wrap.style.opacity || '1') === to) return;
    let t = 0;
    this.anims.push({
      update: (dt) => {
        t += dt;
        const p = Math.min(t / 0.3, 1);
        entry.wrap.style.opacity = String(THREE.MathUtils.lerp(from, to, p));
        return p < 1;
      },
    });
  }

  // ── Interaction (raycasting) ─────────────────────────────────────────────

  _cellFromEvent(e) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new this.THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    if (!this._raycaster) this._raycaster = new this.THREE.Raycaster();
    this._raycaster.setFromCamera(ndc, this.camera);
    const hits = this._raycaster.intersectObjects(this.tileMeshes);
    if (!hits.length) return null;
    const { col, row } = hits[0].object.userData;
    return { col, row };
  }

  _entryAt(pos) {
    if (!pos) return null;
    for (const entry of this.unitObjs.values()) {
      const p = entry.unit.position;
      if (p && p.col === pos.col && p.row === pos.row) return entry;
    }
    return null;
  }

  // Fallback hit-test: pick the unit whose CSS3D card center is closest to the
  // tap point on screen, within roughly half a cell. Tile-based raycasting
  // (_entryAt via _cellFromEvent) can miss near frustum edges where the CSS3D
  // projection of a unit's card drifts slightly from its tile's raycast cell.
  _unitNear(clientX, clientY) {
    let best = null;
    let bestDist = Infinity;
    for (const entry of this.unitObjs.values()) {
      const pos = entry.unit.position;
      if (!pos) continue;
      const screen = this.worldToScreen(this.tilePosition(pos));
      const dist = Math.hypot(screen.x - clientX, screen.y - clientY);
      if (dist < bestDist) { bestDist = dist; best = entry; }
    }
    if (!best) return null;
    const cellPx = this.worldToScreen(this.tilePosition({ col: 1, row: 0 })).x
      - this.worldToScreen(this.tilePosition({ col: 0, row: 0 })).x;
    return bestDist <= Math.abs(cellPx) * 0.6 ? best : null;
  }

  _bindPointerEvents() {
    const el = this.renderer.domElement;
    this._pointerState = null;

    el.addEventListener('pointerdown', (e) => {
      let cell = this._cellFromEvent(e);
      const entry = (cell && this._entryAt(cell)) || this._unitNear(e.clientX, e.clientY);
      if (entry) cell = { ...entry.unit.position };
      if (!cell) return;
      const state = {
        cell, entry,
        startX: e.clientX, startY: e.clientY,
        dragging: false,
        longPressTimer: null,
      };
      if (entry && this.onUnitLongPress) {
        state.longPressTimer = setTimeout(() => {
          state.longPressTimer = null;
          if (!state.dragging) {
            const screen = this.worldToScreen(entry.obj.position.clone());
            const top = screen.y - CARD_PX / 2;
            const rect = { left: screen.x - CARD_PX / 2, top, bottom: top + CARD_PX, width: CARD_PX, height: CARD_PX };
            this.onUnitLongPress(entry.unit, cell, rect);
            this._pointerState = null;
          }
        }, 500);
      }
      this._pointerState = state;
    });

    window.addEventListener('pointermove', (e) => {
      const state = this._pointerState;
      if (!state) return;
      const dx = e.clientX - state.startX;
      const dy = e.clientY - state.startY;
      if (!state.dragging && state.entry && Math.hypot(dx, dy) > 10) {
        state.dragging = true;
        if (state.longPressTimer) { clearTimeout(state.longPressTimer); state.longPressTimer = null; }
      }
      if (state.dragging) {
        const cell = this._cellFromEvent(e);
        if (cell) {
          state.hoverCell = cell;
          const t = this.tilePosition(cell);
          state.entry.obj.position.set(t.x, 0.3, t.z);
        }
      }
    });

    window.addEventListener('pointerup', (e) => {
      const state = this._pointerState;
      if (!state) return;
      this._pointerState = null;
      if (state.longPressTimer) clearTimeout(state.longPressTimer);

      if (state.dragging && state.entry) {
        const dropCell = state.hoverCell || state.cell;
        this.onUnitDrag(state.entry.unit, state.cell, dropCell);
        return;
      }
      if (state.entry) {
        this.onUnitTap(state.entry.unit, state.cell);
        return;
      }
      this.onCellTap(state.cell);
    });
  }

  // ── Boucle de rendu / resize ─────────────────────────────────────────────

  _bindResize() {
    this._resizeHandler = () => this._resize();
    window.addEventListener('resize', this._resizeHandler);
    if (window.ResizeObserver) {
      this._resizeObserver = new ResizeObserver(this._resizeHandler);
      this._resizeObserver.observe(this.container);
    }
  }

  _resize() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h);
    this.cssRenderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this._setCameraImmediate(this._combatMode);
  }

  _animate() {
    if (!this._running) return;
    requestAnimationFrame(() => this._animate());

    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    if (w !== this._lastW || h !== this._lastH) {
      this._lastW = w;
      this._lastH = h;
      this._resize();
    }

    const now = performance.now();
    if (!this._lastTime) this._lastTime = now;
    const dt = Math.min((now - this._lastTime) / 1000, 0.05);
    this._lastTime = now;

    this.anims = this.anims.filter((a) => a.update(dt));

    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i];
      b.life += dt;
      const p = Math.min(b.life / b.maxLife, 1);
      if (b.points) {
        const gravity = b.gravity ?? 6;
        const spin = b.spin ?? 0;
        const arr = b.points.geometry.attributes.position.array;
        for (let j = 0; j < arr.length; j += 3) {
          if (spin) {
            const angle = spin * dt;
            const vx = b.velocities[j];
            const vz = b.velocities[j + 2];
            b.velocities[j]     = vx * Math.cos(angle) - vz * Math.sin(angle);
            b.velocities[j + 2] = vx * Math.sin(angle) + vz * Math.cos(angle);
          }
          arr[j]     += b.velocities[j] * dt;
          arr[j + 1] += (b.velocities[j + 1] - gravity * b.life) * dt;
          arr[j + 2] += b.velocities[j + 2] * dt;
        }
        b.points.geometry.attributes.position.needsUpdate = true;
        b.points.material.opacity = 1 - p;
      }
      if (b.ring) {
        const scale = 1 + p * (b.maxScale ?? 6);
        b.ring.scale.set(scale, scale, scale);
        b.ring.material.opacity = 0.9 * (1 - p);
      }
      if (b.light) {
        b.light.intensity = (b.maxIntensity ?? 4) * (1 - p);
      }
      if (p >= 1) {
        if (b.light) {
          this.scene.remove(b.light);
        } else {
          const obj = b.points || b.ring;
          this.scene.remove(obj);
          obj.geometry.dispose();
          obj.material.dispose();
        }
        this.bursts.splice(i, 1);
      }
    }

    this.renderer.render(this.scene, this.camera);
    this.cssRenderer.render(this.cssScene, this.camera);
  }

  destroy() {
    this._running = false;
    window.removeEventListener('resize', this._resizeHandler);
    if (this._resizeObserver) this._resizeObserver.disconnect();
    this.renderer.dispose();
  }
}
