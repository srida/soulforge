import { navigate } from '../../main.js';
import * as CardDatabase from '../../data/CardDatabase.js';
import { Unit } from '../../logic/Unit.js';
import { createUnitEl, updateUnitEl } from '../components/UnitCard.js';
import { HandUI } from '../components/HandUI.js';

// POC — board 3D vue du dessus (style Marvel Snap) : tuiles + cartes WebGL/CSS3D
// via Three.js chargé depuis CDN (import map "three" dans index.html), main réutilisant HandUI.
const CSS3D_URL = 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/renderers/CSS3DRenderer.js';

const COLS = 5;
const PLAYER_ROWS = 4;
const TOTAL_ROWS = 8;   // 0-3 joueur, 4-7 ennemi
const CELL = 1;         // 1 unité three.js par case
const CARD_PX = 90;     // taille du wrapper de carte en pixels CSS
const CSS_SCALE = CELL / CARD_PX;

export async function mount(container, params = {}) {
  container.innerHTML = `
    <div class="topbar">
      <button class="topbar-back" id="poc-back">←</button>
      <span class="topbar-title">POC 3D — Board (Three.js)</span>
      <div style="display:flex;gap:6px;margin-left:auto">
        <button class="btn btn-primary" id="poc-combat" style="min-height:36px;padding:0 12px;font-size:12px">⚔ Combat</button>
        <button class="btn btn-secondary" id="poc-reset" style="min-height:36px;padding:0 12px;font-size:12px">↺ Réinitialiser</button>
      </div>
    </div>
    <div class="poc3d-wrap">
      <div class="poc3d-3d"></div>
      <div class="poc3d-hint">Touchez une carte en main, puis une case de votre terrain</div>
    </div>
    <div class="hand-ui-wrap"><div class="hand-ui" id="poc-hand"></div></div>
  `;

  container.querySelector('#poc-back').addEventListener('click', () => navigate('main_menu'));

  const [THREE, { CSS3DRenderer, CSS3DObject }] = await Promise.all([
    import('three'),
    import(CSS3D_URL),
  ]);

  await CardDatabase.init();

  const wrap3d = container.querySelector('.poc3d-3d');

  // ── Scene / camera (vue du dessus) ──────────────────────────────────────

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0f1117);

  const cssScene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
  const centerZ = (TOTAL_ROWS - 1) * CELL / 2;
  camera.up.set(0, 0, -1); // rangée 0 (main du joueur) en bas de l'écran, rangées ennemies en haut
  camera.position.set(0, 11, centerZ);
  camera.lookAt(0, 0, centerZ);

  // ── Renderers (WebGL pour les tuiles/particules, CSS3D pour les cartes) ────

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.domElement.style.position = 'absolute';
  renderer.domElement.style.inset = '0';
  wrap3d.appendChild(renderer.domElement);

  const cssRenderer = new CSS3DRenderer();
  cssRenderer.domElement.style.position = 'absolute';
  cssRenderer.domElement.style.inset = '0';
  cssRenderer.domElement.style.pointerEvents = 'none';
  wrap3d.appendChild(cssRenderer.domElement);

  // ── Lighting ─────────────────────────────────────────────────────────────

  scene.add(new THREE.AmbientLight(0x8892b0, 0.8));
  const sun = new THREE.DirectionalLight(0xffffff, 0.9);
  sun.position.set(2, 10, 4);
  scene.add(sun);

  // ── Tiles ────────────────────────────────────────────────────────────────

  function zForRow(row) { return (TOTAL_ROWS - 1 - row) * CELL; }
  function xForCol(col) { return (col - (COLS - 1) / 2) * CELL; }

  const tileGeo = new THREE.BoxGeometry(CELL * 0.94, 0.1, CELL * 0.94);
  const tileMeshes = [];
  const occupied = new Set(); // "col,row" — cases joueur occupées

  function colorFor(row, col) {
    const alt = (col + row) % 2 === 0;
    if (row < PLAYER_ROWS) return alt ? 0x1c2440 : 0x222b4a; // côté joueur
    return alt ? 0x401c24 : 0x4a222b;                        // côté ennemi
  }

  for (let row = 0; row < TOTAL_ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const base = colorFor(row, col);
      const mat = new THREE.MeshStandardMaterial({ color: base, roughness: 0.85 });
      const tile = new THREE.Mesh(tileGeo, mat);
      tile.position.set(xForCol(col), 0, zForRow(row));
      tile.userData = { col, row, baseColor: base };
      scene.add(tile);
      tileMeshes.push(tile);
    }
  }

  function setHighlight(on) {
    for (const tile of tileMeshes) {
      const { col, row, baseColor } = tile.userData;
      const isFree = row < PLAYER_ROWS && !occupied.has(`${col},${row}`);
      tile.material.color.setHex(on && isFree ? 0x3a3a8c : baseColor);
      tile.material.emissive.setHex(on && isFree ? 0x6c63ff : 0x000000);
      tile.material.emissiveIntensity = on && isFree ? 0.35 : 0;
    }
  }

  // ── Particle bursts (effet "impact" à la pose/à l'attaque) ─────────────────

  const bursts = [];

  function spawnBurst(position, color, count = 70) {
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = position.x;
      positions[i * 3 + 1] = position.y;
      positions[i * 3 + 2] = position.z;
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
    scene.add(points);
    bursts.push({ points, velocities, life: 0, maxLife: 0.6 });
  }

  function spawnRing(center, color) {
    const geo = new THREE.RingGeometry(0.05, 0.18, 32);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(geo, mat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.copy(center);
    ring.position.y = 0.06;
    scene.add(ring);
    bursts.push({ ring, life: 0, maxLife: 0.5 });
  }

  // ── Hand ─────────────────────────────────────────────────────────────────

  let hand = CardDatabase.getCardsByTier(1).slice(0, 6);
  let selectedCard = null;

  const handUI = new HandUI(container.querySelector('#poc-hand'), {
    onSelect: (card) => {
      selectedCard = card;
      setHighlight(!!selectedCard);
    },
  });
  handUI.setHand(hand);

  // ── Unités sur le board ──────────────────────────────────────────────────

  const unitObjs = new Map(); // uid -> { unit, obj, el, col, row, side, baseZ }
  let anims = [];

  function punch(obj) {
    let pt = 0;
    anims.push({
      update(dt2) {
        pt += dt2;
        const pp = Math.min(pt / 0.18, 1);
        obj.scale.setScalar(CSS_SCALE * (1 + (1 - pp) * 0.18 * Math.sin(pp * Math.PI * 2)));
        if (pp >= 1) obj.scale.setScalar(CSS_SCALE);
        return pp < 1;
      },
    });
  }

  function spawnUnit(card, col, row, side) {
    const unit = new Unit(card, side);
    const cardWrap = document.createElement('div');
    cardWrap.style.width = CARD_PX + 'px';
    cardWrap.style.height = CARD_PX + 'px';
    cardWrap.style.borderRadius = '6px';
    cardWrap.style.overflow = 'hidden';
    cardWrap.style.pointerEvents = 'auto';
    const el = createUnitEl(unit);
    cardWrap.appendChild(el);

    const obj = new CSS3DObject(cardWrap);
    obj.rotation.x = -Math.PI / 2; // à plat, face vers le haut (vers la caméra)
    const x = xForCol(col);
    const z = zForRow(row);
    obj.position.set(x, 3, z);
    obj.scale.setScalar(CSS_SCALE);
    cssScene.add(obj);

    const entry = { unit, obj, el, col, row, side, baseZ: z };
    unitObjs.set(unit.uid, entry);

    let t = 0;
    const duration = 0.22;
    anims.push({
      update(dt) {
        t += dt;
        const p = Math.min(t / duration, 1);
        const eased = 1 - Math.pow(1 - p, 3);
        obj.position.y = THREE.MathUtils.lerp(3, 0.06, eased);
        if (p >= 1) {
          const color = side === 'player' ? 0x6c63ff : 0xff6584;
          spawnBurst(new THREE.Vector3(x, 0.1, z), color, 80);
          spawnRing(new THREE.Vector3(x, 0, z), color);
          punch(obj);
          return false;
        }
        return true;
      },
    });
    return entry;
  }

  function placeCard(card, col, row) {
    occupied.add(`${col},${row}`);
    setHighlight(false);
    spawnUnit(card, col, row, 'player');

    const idx = handUI.getSelectedIdx();
    handUI.removeSelected();
    if (idx !== null) hand.splice(idx, 1);
    selectedCard = null;
  }

  // ── Raycast tap → placement ──────────────────────────────────────────────

  const raycaster = new THREE.Raycaster();
  renderer.domElement.style.touchAction = 'none';
  renderer.domElement.addEventListener('pointerdown', (e) => {
    if (!selectedCard) return;
    const rect = renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects(tileMeshes);
    if (!hits.length) return;
    const { col, row } = hits[0].object.userData;
    if (row >= PLAYER_ROWS) return;
    if (occupied.has(`${col},${row}`)) return;
    placeCard(selectedCard, col, row);
  });

  // ── Phase combat (effet d'attaque "Marvel Snap") ─────────────────────────

  function killUnit(entry) {
    unitObjs.delete(entry.unit.uid);
    let t = 0;
    anims.push({
      update(dt) {
        t += dt;
        const s = Math.max(0, 1 - t / 0.3);
        entry.obj.scale.setScalar(CSS_SCALE * s);
        if (s <= 0) { cssScene.remove(entry.obj); return false; }
        return true;
      },
    });
  }

  function queueAttack(attacker, target, startDelay) {
    let waited = 0;
    let phase = 'wait';
    let t = 0;
    anims.push({
      update(dt) {
        if (phase === 'wait') {
          waited += dt;
          if (waited < startDelay) return true;
          phase = 'out'; t = 0;
        }
        if (phase === 'out') {
          t += dt;
          const p = Math.min(t / 0.12, 1);
          attacker.obj.position.z = attacker.baseZ - 0.3 * p;
          if (p >= 1) {
            const tx = xForCol(target.col);
            const tz = zForRow(target.row);
            spawnBurst(new THREE.Vector3(tx, 0.1, tz), 0xff6584, 70);
            spawnRing(new THREE.Vector3(tx, 0, tz), 0xff6584);
            target.unit.current_hp -= attacker.unit.atk;
            updateUnitEl(target.el, target.unit);
            if (target.unit.current_hp <= 0) killUnit(target);
            phase = 'back'; t = 0;
          }
          return true;
        }
        if (phase === 'back') {
          t += dt;
          const p = Math.min(t / 0.12, 1);
          attacker.obj.position.z = THREE.MathUtils.lerp(attacker.baseZ - 0.3, attacker.baseZ, p);
          return p < 1;
        }
        return true;
      },
    });
  }

  function findUnitInCol(side, col) {
    for (const u of unitObjs.values()) {
      if (u.side === side && u.col === col) return u;
    }
    return null;
  }

  function startCombat() {
    if (![...unitObjs.values()].some(u => u.side === 'enemy')) {
      const enemyCards = CardDatabase.getCardsByTier(1).slice(2, 4);
      spawnUnit(enemyCards[0], 1, 6, 'enemy');
      spawnUnit(enemyCards[1], 3, 6, 'enemy');
    }

    const players = [...unitObjs.values()].filter(u => u.side === 'player');
    let delay = 0.3; // laisse le temps aux ennemis de se poser
    for (const p of players) {
      const target = findUnitInCol('enemy', p.col);
      if (!target) continue;
      queueAttack(p, target, delay);
      delay += 0.4;
    }
  }

  container.querySelector('#poc-combat').addEventListener('click', startCombat);

  // ── Reset ────────────────────────────────────────────────────────────────

  container.querySelector('#poc-reset').addEventListener('click', () => {
    for (const obj of [...cssScene.children]) cssScene.remove(obj);
    unitObjs.clear();
    occupied.clear();
    anims = [];
    for (const b of bursts) {
      const obj = b.points || b.ring;
      scene.remove(obj);
      obj.geometry.dispose();
      obj.material.dispose();
    }
    bursts.length = 0;
    setHighlight(false);
    hand = CardDatabase.getCardsByTier(1).slice(0, 6);
    handUI.setHand(hand);
    selectedCard = null;
  });

  // ── Render loop ───────────────────────────────────────────────────────────

  let running = true;
  let lastTime = performance.now();

  function resize() {
    const w = wrap3d.clientWidth;
    const h = wrap3d.clientHeight;
    renderer.setSize(w, h);
    cssRenderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  resize();
  window.addEventListener('resize', resize);

  function animate() {
    if (!running) return;
    requestAnimationFrame(animate);
    const now = performance.now();
    const dt = Math.min((now - lastTime) / 1000, 0.05);
    lastTime = now;

    anims = anims.filter(a => a.update(dt));

    for (let i = bursts.length - 1; i >= 0; i--) {
      const b = bursts[i];
      b.life += dt;
      const p = Math.min(b.life / b.maxLife, 1);
      if (b.points) {
        const pos = b.points.geometry.attributes.position.array;
        for (let j = 0; j < pos.length; j += 3) {
          pos[j]     += b.velocities[j]     * dt;
          pos[j + 1] += (b.velocities[j + 1] - 6 * b.life) * dt; // gravité
          pos[j + 2] += b.velocities[j + 2] * dt;
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
        scene.remove(obj);
        obj.geometry.dispose();
        obj.material.dispose();
        bursts.splice(i, 1);
      }
    }

    renderer.render(scene, camera);
    cssRenderer.render(cssScene, camera);
  }
  animate();

  mount._cleanup = () => {
    running = false;
    window.removeEventListener('resize', resize);
    renderer.dispose();
  };
}

export function unmount() {
  mount._cleanup?.();
  mount._cleanup = null;
}
