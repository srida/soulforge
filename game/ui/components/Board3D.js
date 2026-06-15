import { createUnitEl, updateUnitEl } from './UnitCard.js';

// Board3D — rendu Three.js du board (5 colonnes x 11 rangées) en remplacement de BoardGrid.
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

  spawnBurst(pos, color, count = 70) {
    const THREE = this.THREE;
    const center = pos instanceof THREE.Vector3 ? pos : this.tilePosition(pos);
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = center.x;
      positions[i * 3 + 1] = center.y + 0.04;
      positions[i * 3 + 2] = center.z;
      const theta = Math.random() * Math.PI * 2;
      const speed = 1 + Math.random() * 2;
      velocities[i * 3] = Math.cos(theta) * speed;
      velocities[i * 3 + 1] = 1.5 + Math.random() * 2;
      velocities[i * 3 + 2] = Math.sin(theta) * speed;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color, size: 0.07, transparent: true, opacity: 1,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const points = new THREE.Points(geo, mat);
    this.scene.add(points);
    this.bursts.push({ points, velocities, life: 0, maxLife: 0.6 });
  }

  spawnRing(pos, color) {
    const THREE = this.THREE;
    const center = pos instanceof THREE.Vector3 ? pos : this.tilePosition(pos);
    const geo = new THREE.RingGeometry(0.05, 0.18, 32);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(geo, mat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.copy(center);
    ring.position.y = 0.06;
    this.scene.add(ring);
    this.bursts.push({ ring, life: 0, maxLife: 0.5 });
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
      wrap.style.overflow = 'visible';
      wrap.style.boxShadow = `inset 0 0 0 ${HIGHLIGHT_RING_PX}px var(--green)`;
    } else if (isMatCandidate) {
      wrap.style.overflow = 'visible';
      wrap.style.boxShadow = `inset 0 0 0 ${HIGHLIGHT_RING_PX}px var(--yellow)`;
    } else if (isSelected) {
      wrap.style.overflow = 'visible';
      wrap.style.boxShadow = `inset 0 0 0 ${HIGHLIGHT_RING_PX}px var(--accent)`;
    } else {
      wrap.style.overflow = 'hidden';
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
    return (this._combatMode || unit.side === 'player') ? 1 : 0;
  }

  _spawnUnitObj(unit) {
    const THREE = this.THREE;
    const pos = unit.position;
    const wrap = document.createElement('div');
    wrap.style.width = CARD_PX + 'px';
    wrap.style.height = CARD_PX + 'px';
    wrap.style.borderRadius = '6px';
    wrap.style.overflow = 'hidden';
    wrap.style.pointerEvents = 'none';
    wrap.style.opacity = String(this._visibilityFor(unit));
    const el = createUnitEl(unit);
    wrap.appendChild(el);

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

    const entry = { unit, obj, wrap, el, pos: { ...pos } };
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
          const color = unit.side === 'player' ? 0x6c63ff : 0xff6584;
          this.spawnBurst(new THREE.Vector3(x, 0.1, z), color, 60);
          this.spawnRing(new THREE.Vector3(x, 0, z), color);
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
        const arr = b.points.geometry.attributes.position.array;
        for (let j = 0; j < arr.length; j += 3) {
          arr[j] += b.velocities[j] * dt;
          arr[j + 1] += (b.velocities[j + 1] - 6 * b.life) * dt;
          arr[j + 2] += b.velocities[j + 2] * dt;
        }
        b.points.geometry.attributes.position.needsUpdate = true;
        b.points.material.opacity = 1 - p;
      }
      if (b.ring) {
        const scale = 1 + p * 6;
        b.ring.scale.set(scale, scale, scale);
        b.ring.material.opacity = 0.9 * (1 - p);
      }
      if (p >= 1) {
        const obj = b.points || b.ring;
        this.scene.remove(obj);
        obj.geometry.dispose();
        obj.material.dispose();
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
