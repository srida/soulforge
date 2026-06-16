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

  // Éléments — chaque carte se voit assigner un élément déterministe (couleur + comportement
  // de particules) pour l'effet de pose. Purement visuel, indépendant des données de jeu.
  const ELEMENT_STYLES = {
    feu:    { color: 0xff6a3c, ringColor: 0xff8a3c, size: 0.08, speed: [1.5, 3.5], lift: [2, 4],   gravity: 2,  spin: 0,    flash: false },
    eau:    { color: 0x4fc3f7, ringColor: 0x4fc3f7, size: 0.06, speed: [0.8, 2],   lift: [0.5, 1.5], gravity: 10, spin: 0,  flash: false },
    foudre: { color: 0xfff066, ringColor: 0xfff9a8, size: 0.09, speed: [2, 5],     lift: [1, 4],   gravity: 6,  spin: 0,    flash: true },
    vent:   { color: 0xb8ffd8, ringColor: 0xc8ffe0, size: 0.06, speed: [1, 2.5],   lift: [1, 2.5], gravity: 1,  spin: 4,    flash: false },
  };
  const ELEMENT_ORDER = ['feu', 'eau', 'foudre', 'vent'];

  function elementForCard(card) {
    const key = String(card?.id ?? card?.name ?? '');
    let hash = 0;
    for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
    return ELEMENT_ORDER[hash % ELEMENT_ORDER.length];
  }

  function spawnBurst(position, color, count = 70, opts = {}) {
    const { speed: [speedMin, speedMax] = [1, 3], lift: [liftMin, liftMax] = [1.5, 3.5], size = 0.07, gravity = 6, spin = 0, maxLife = 0.6 } = opts;
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = position.x;
      positions[i * 3 + 1] = position.y;
      positions[i * 3 + 2] = position.z;
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
    scene.add(points);
    bursts.push({ points, velocities, life: 0, maxLife, gravity, spin });
  }

  function spawnRing(center, color, maxLife = 0.5, maxScale = 6) {
    const geo = new THREE.RingGeometry(0.05, 0.18, 32);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(geo, mat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.copy(center);
    ring.position.y = 0.06;
    scene.add(ring);
    bursts.push({ ring, life: 0, maxLife, maxScale });
  }

  function spawnFlash(center, color, intensity = 4, range = 4, maxLife = 0.25) {
    const light = new THREE.PointLight(color, intensity, range, 2);
    light.position.set(center.x, 1.2, center.z);
    scene.add(light);
    bursts.push({ light, life: 0, maxLife, maxIntensity: intensity });
  }

  function spawnHalo(center, color) {
    spawnRing(new THREE.Vector3(center.x, 0, center.z), color, 0.7, 9);
    const geo2 = new THREE.RingGeometry(0.05, 0.22, 48);
    const mat2 = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.28, side: THREE.DoubleSide });
    const ring2 = new THREE.Mesh(geo2, mat2);
    ring2.rotation.x = -Math.PI / 2;
    ring2.position.set(center.x, 0.04, center.z);
    scene.add(ring2);
    bursts.push({ ring: ring2, life: 0, maxLife: 1.0, maxScale: 13 });
    spawnFlash(center, color, 5, 5, 0.55);
  }

  function spawnElementImpact(position, element, tier = 1) {
    const style = ELEMENT_STYLES[element] || ELEMENT_STYLES.feu;
    const t = Math.max(1, Math.min(5, tier));

    // Table explicite par tier — écarts visuels marqués à chaque palier
    //               count  speedM  sizeM  lifeM  ringS  ringL  flashI  flashR  flashL
    const CFG = [
      { count:  2, sM: 0.12, szM: 0.15, lM: 0.10, rS: 1.5, rL: 0.14, fi: 0,   fR: 0, fL: 0    },  // T1
      { count:  8, sM: 0.22, szM: 0.28, lM: 0.20, rS: 2.5, rL: 0.20, fi: 0,   fR: 0, fL: 0    },  // T2
      { count: 18, sM: 0.36, szM: 0.42, lM: 0.30, rS: 3.5, rL: 0.28, fi: 1.5, fR: 2, fL: 0.12 },  // T3
      { count: 32, sM: 0.52, szM: 0.58, lM: 0.42, rS: 5.0, rL: 0.36, fi: 3.0, fR: 3, fL: 0.16 },  // T4
      { count: 50, sM: 0.68, szM: 0.72, lM: 0.55, rS: 7.0, rL: 0.45, fi: 5.0, fR: 4, fL: 0.20 },  // T5
    ][t - 1];

    if (CFG.count > 0) {
      spawnBurst(position, style.color, CFG.count, {
        ...style,
        size:    style.size * CFG.szM,
        speed:   style.speed.map(v => v * CFG.sM),
        lift:    style.lift.map(v => v * CFG.sM),
        maxLife: CFG.lM,
      });
    }
    spawnRing(new THREE.Vector3(position.x, 0, position.z), style.ringColor, CFG.rL, CFG.rS);
    if (CFG.fi > 0) spawnFlash(position, style.color, CFG.fi, CFG.fR, CFG.fL);
    if (t === 5) spawnHalo(position, style.color);
  }

  // ── Hand ─────────────────────────────────────────────────────────────────

  function buildPocHand() {
    const pick = (tier, n) => CardDatabase.getCardsByTier(tier).slice(0, n);
    return [...pick(1, 2), ...pick(2, 1), ...pick(3, 1), ...pick(4, 1), ...pick(5, 1)];
  }
  let hand = buildPocHand();
  let selectedCard = null;

  const handUI = new HandUI(container.querySelector('#poc-hand'), {
    onSelect: (card) => {
      selectedCard = card;
      setHighlight(!!selectedCard);
    },
  });
  handUI.setHand(hand);

  // ── Unités pré-placées pour la démo (T1→T5, une par colonne) ────────────
  const TEST_IDS   = ['TEST_001','TEST_002','TEST_003','TEST_004','TEST_005'];
  const demoCards  = TEST_IDS.map(id => CardDatabase.getCard(id));

  // ── Unités sur le board ──────────────────────────────────────────────────

  const unitObjs = new Map(); // uid -> { unit, obj, el, col, row, side, baseZ }
  let anims = [];

  // Spawn démo immédiat (après unitObjs et anims disponibles)
  demoCards.forEach((card, col) => {
    occupied.add(`${col},1`);
    spawnUnit(card, col, 1, 'player');
  });
  const demoEnemyCards = TEST_IDS.map(id => CardDatabase.getCard(id));
  demoEnemyCards.forEach((card, col) => {
    spawnUnit(card, col, 6, 'enemy');
  });

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

  function _createTierFrame(tier) {
    const frame = document.createElement('div');
    frame.className = `poc3d-frame poc3d-frame-t${tier}`;
    return frame;
  }

  function spawnUnit(card, col, row, side) {
    const unit = new Unit(card, side);
    const cardWrap = document.createElement('div');
    cardWrap.style.width = CARD_PX + 'px';
    cardWrap.style.height = CARD_PX + 'px';
    cardWrap.style.borderRadius = '6px';
    cardWrap.style.overflow = 'visible';
    cardWrap.style.pointerEvents = 'auto';
    cardWrap.className = 'poc3d-card-wrap';
    const el = createUnitEl(unit);
    cardWrap.appendChild(el);
    cardWrap.appendChild(_createTierFrame(card.tier ?? 1));

    const obj = new CSS3DObject(cardWrap);
    obj.rotation.x = -Math.PI / 2; // à plat, face vers le haut (vers la caméra)
    const x = xForCol(col);
    const z = zForRow(row);
    obj.position.set(x, 3, z);
    obj.scale.setScalar(CSS_SCALE);
    cssScene.add(obj);

    const element = elementForCard(card);
    const entry = { unit, obj, el, col, row, side, baseZ: z, element };
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
          spawnElementImpact(new THREE.Vector3(x, 0.1, z), element, card.tier);
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

    const x = xForCol(entry.col);
    const z = zForRow(entry.row);
    const style = ELEMENT_STYLES[entry.element] || ELEMENT_STYLES.feu;

    // Masque la carte d'origine et stoppe toutes les animations CSS en cours
    entry.obj.visible = false;
    entry.obj.element.querySelectorAll('*').forEach(el => {
      el.style.animation = 'none';
      el.style.transition = 'none';
    });
    entry.obj.element.style.animation = 'none';
    entry.obj.element.style.transition = 'none';

    // ── Scaling par tier — table explicite pour des écarts visuels marqués ──
    const tier = Math.max(1, Math.min(5, entry.unit.tier ?? 1));
    //                  FCOLS  FROWS  speed   rot   flashI  flashR  flashL  pc   halo   spMax  ltMax  mLife  grav
    const KILL_CFG = [
      { fc: 2, fr: 2, speed: 0.80, vy: 0.50, rot:  8, fi:  1.5, fR: 1.5, fL: 0.14, pc:  14, fS: 0.68, halo: false, spMax: 0.6, ltMax: 0.5, mLife: 0.22, grav: 8.0 },  // T1
      { fc: 2, fr: 2, speed: 1.20, vy: 0.80, rot: 10, fi:  3.0, fR: 2.2, fL: 0.18, pc:  26, fS: 0.82, halo: false, spMax: 1.0, ltMax: 0.8, mLife: 0.27, grav: 7.0 },  // T2
      { fc: 3, fr: 3, speed: 1.60, vy: 1.00, rot: 13, fi:  5.0, fR: 3.0, fL: 0.22, pc:  42, fS: 0.92, halo: false, spMax: 1.5, ltMax: 1.1, mLife: 0.32, grav: 6.5 },  // T3
      { fc: 3, fr: 3, speed: 2.00, vy: 1.20, rot: 16, fi:  7.5, fR: 4.0, fL: 0.26, pc:  62, fS: 0.99, halo: false, spMax: 2.0, ltMax: 1.5, mLife: 0.37, grav: 6.0 },  // T4
      { fc: 6, fr: 5, speed: 4.00, vy: 2.20, rot: 22, fi: 18.0, fR: 9.5, fL: 0.35, pc: 140, fS: 1.00, halo: true,  spMax: 1.05,ltMax: 1.0, mLife: 0.50, grav: 6.0 },  // T5 — inchangé
    ][tier - 1];
    const FCOLS     = KILL_CFG.fc;
    const FROWS     = KILL_CFG.fr;
    const speedBase = KILL_CFG.speed;
    const rotBase   = KILL_CFG.rot;
    const flashInt  = KILL_CFG.fi;
    const flashRange = KILL_CFG.fR;
    const flashLife  = KILL_CFG.fL;
    const partCount  = KILL_CFG.pc;

    // ── Fragments CSS3D : grille de morceaux de la vraie carte qui explosent ──
    const fragW = CARD_PX / FCOLS;
    const fragH = CARD_PX / FROWS;
    const frags = [];

    for (let fc = 0; fc < FCOLS; fc++) {
      for (let fr = 0; fr < FROWS; fr++) {
        // Conteneur clip : montre uniquement la portion (fc, fr) de la carte
        const clip = document.createElement('div');
        clip.style.width  = fragW + 'px';
        clip.style.height = fragH + 'px';
        clip.style.overflow = 'hidden';
        clip.style.position = 'relative';
        clip.style.borderRadius = '2px';

        // Clone de la carte entière décalé pour ne montrer que ce fragment
        const inner = entry.obj.element.cloneNode(true);
        inner.style.position = 'absolute';
        inner.style.left    = (-fc * fragW) + 'px';
        inner.style.top     = (-fr * fragH) + 'px';
        inner.style.margin  = '0';
        inner.style.pointerEvents = 'none';
        clip.appendChild(inner);

        const fobj = new CSS3DObject(clip);
        fobj.rotation.x = -Math.PI / 2;
        fobj.position.set(x, 0.06, z);
        fobj.scale.setScalar(CSS_SCALE * KILL_CFG.fS);
        cssScene.add(fobj);

        // Vélocité : le fragment part depuis sa position dans la carte
        const dx = FCOLS > 1 ? fc / (FCOLS - 1) - 0.5 : 0;
        const dz = FROWS > 1 ? fr / (FROWS - 1) - 0.5 : 0;
        const angle = Math.atan2(dz, dx) + (Math.random() - 0.5) * 1.4;
        const speed = speedBase + Math.random() * speedBase;

        frags.push({
          obj: fobj,
          vx: Math.cos(angle) * speed,
          vy: 0.15 + Math.random() * KILL_CFG.vy,
          vz: Math.sin(angle) * speed,
          ry: (Math.random() - 0.5) * rotBase,
          rz: (Math.random() - 0.5) * rotBase * 0.7,
        });
      }
    }

    spawnFlash(new THREE.Vector3(x, 0.5, z), 0xffffff, flashInt, flashRange, flashLife);
    spawnBurst(new THREE.Vector3(x, 0.3, z), style.color, partCount, {
      size:    style.size * KILL_CFG.fS * 1.1,
      speed:   [0.1, KILL_CFG.spMax],
      lift:    [0.1, KILL_CFG.ltMax],
      gravity: KILL_CFG.grav,
      maxLife: KILL_CFG.mLife,
    });
    if (KILL_CFG.halo) spawnHalo(new THREE.Vector3(x, 0, z), style.color);

    const MAX_T = 0.9;
    let t = 0;
    anims.push({
      update(dt) {
        t += dt;
        const p = Math.min(t / MAX_T, 1);
        for (const f of frags) {
          f.obj.position.x += f.vx * dt;
          f.obj.position.y += (f.vy - 5 * t) * dt; // gravité
          f.obj.position.z += f.vz * dt;
          f.obj.rotation.y += f.ry * dt;            // culbute
          f.obj.rotation.z += f.rz * dt;
          f.obj.element.style.opacity = Math.max(0, 1 - p * 1.3);
        }
        if (p >= 1) {
          cssScene.remove(entry.obj);
          for (const f of frags) cssScene.remove(f.obj);
          return false;
        }
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
            target.unit.current_hp -= attacker.unit.atk;
            updateUnitEl(target.el, target.unit);
            if (target.unit.current_hp <= 0) {
              killUnit(target);
              attacker.obj.position.z = attacker.baseZ;
              return false; // pas de burst d'attaque ni de retour — l'explosion parle d'elle-même
            }
            const atier = Math.max(1, Math.min(5, attacker.unit.tier ?? 1));
            // count: T1:8 → T5:70 ; ringScale: T1:2 → T5:8 ; flash à partir de T3
            const ATK_CFG = [
              { pc:  8, rS: 2 },
              { pc: 20, rS: 3 },
              { pc: 38, rS: 5 },
              { pc: 55, rS: 6 },
              { pc: 70, rS: 8 },
            ][atier - 1];
            spawnBurst(new THREE.Vector3(tx, 0.1, tz), 0xff6584, ATK_CFG.pc, { size: 0.04 + atier * 0.012, speed: [0.4, 0.6 + atier * 0.3], lift: [0.3, 0.5 + atier * 0.2], gravity: 8, maxLife: 0.20 + atier * 0.04 });
            spawnRing(new THREE.Vector3(tx, 0, tz), 0xff6584, 0.20 + atier * 0.04, ATK_CFG.rS);
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
      if (b.light) { scene.remove(b.light); }
      else { const obj = b.points || b.ring; scene.remove(obj); obj.geometry.dispose(); obj.material.dispose(); }
    }
    bursts.length = 0;
    setHighlight(false);
    hand = buildPocHand();
    handUI.setHand(hand);
    selectedCard = null;
    // Remet les démo-unités
    demoCards.forEach((card, col) => {
      occupied.add(`${col},1`);
      spawnUnit(card, col, 1, 'player');
    });
    demoEnemyCards.forEach((card, col) => {
      spawnUnit(card, col, 6, 'enemy');
    });
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
        const gravity = b.gravity ?? 6;
        const spin = b.spin ?? 0;
        for (let j = 0; j < pos.length; j += 3) {
          if (spin) {
            const angle = spin * dt;
            const vx = b.velocities[j];
            const vz = b.velocities[j + 2];
            b.velocities[j]     = vx * Math.cos(angle) - vz * Math.sin(angle);
            b.velocities[j + 2] = vx * Math.sin(angle) + vz * Math.cos(angle);
          }
          pos[j]     += b.velocities[j]     * dt;
          pos[j + 1] += (b.velocities[j + 1] - gravity * b.life) * dt; // gravité
          pos[j + 2] += b.velocities[j + 2] * dt;
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
          scene.remove(b.light);
        } else {
          const obj = b.points || b.ring;
          scene.remove(obj);
          obj.geometry.dispose();
          obj.material.dispose();
        }
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
