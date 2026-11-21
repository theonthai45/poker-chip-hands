import * as THREE from 'three';
import { money, type Chips } from '../shared/chips';
import type { Denom } from '../shared/types';

/** Chip thickness as a fraction of its radius (real chips: 39 mm × 3.3 mm). */
const THICK = 0.17;
const TILT = (40 * Math.PI) / 180; // camera angle away from straight down
const CAM_DIST = 30;
const CHIP_PX = 23; // on-screen chip radius at the player's own stacks
const MAX_STACK = 20;
const MAX_TRAY = 12;
const MAX_PILE_PER_DENOM = 40;
const UNCONFIRMED_MS = 2500;

type Place = 'stack' | 'tray';

interface OwnChip {
  mesh: THREE.Mesh;
  denom: number;
  place: Place;
  index: number;
  hop: number; // 1 → 0 while hopping between stack and tray
}

interface PileChip {
  mesh: THREE.Mesh;
  denom: number;
  state: 'in' | 'rest' | 'out';
  born: number;
  /** Resting spot relative to the pot centre. */
  off: THREE.Vector3;
  from: THREE.Vector3;
  to: THREE.Vector3;
  t: number;
  delay: number;
  dur: number;
  peak: number;
  flips: number;
  axis: THREE.Vector3;
  restQ: THREE.Quaternion;
  landed: boolean;
}

function textOn(bg: string) {
  const n = parseInt(bg.slice(1), 16);
  const lum = 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
  return lum > 150 ? '#1a1a1a' : '#ffffff';
}

function faceTexture(d: Denom): THREE.CanvasTexture {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const R = S / 2;
  const ink = textOn(d.color);
  const accent = ink === '#ffffff' ? '#ffffff' : '#2b3a67';
  g.fillStyle = d.color;
  g.fillRect(0, 0, S, S);
  // Edge inserts
  g.fillStyle = accent;
  for (let k = 0; k < 6; k++) {
    const a = (k * Math.PI) / 3;
    g.beginPath();
    g.arc(R, R, R, a - 0.26, a + 0.26);
    g.arc(R, R, R * 0.74, a + 0.26, a - 0.26, true);
    g.fill();
  }
  // Inlay
  g.beginPath();
  g.arc(R, R, R * 0.6, 0, Math.PI * 2);
  g.fillStyle = d.color;
  g.fill();
  g.lineWidth = 5;
  g.setLineDash([10, 9]);
  g.strokeStyle = accent;
  g.globalAlpha = 0.75;
  g.stroke();
  g.globalAlpha = 1;
  g.setLineDash([]);
  const shade = g.createRadialGradient(R, R, R * 0.2, R, R, R);
  shade.addColorStop(0, 'rgba(255,255,255,0.10)');
  shade.addColorStop(1, 'rgba(0,0,0,0.18)');
  g.fillStyle = shade;
  g.fillRect(0, 0, S, S);
  const label = money(d.value).replace('$', '');
  g.fillStyle = ink;
  g.font = `800 ${label.length > 3 ? 62 : label.length > 2 ? 74 : 92}px system-ui, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(label, R, R + 4);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function sideTexture(d: Denom): THREE.CanvasTexture {
  const W = 384;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = 16;
  const g = c.getContext('2d')!;
  g.fillStyle = d.color;
  g.fillRect(0, 0, W, 16);
  g.fillStyle = textOn(d.color) === '#ffffff' ? '#ffffff' : '#2b3a67';
  const w = (0.52 / (Math.PI * 2)) * W;
  for (let k = 0; k <= 6; k++) g.fillRect((k / 6) * W - w / 2, 0, w, 16);
  g.fillStyle = 'rgba(0,0,0,0.22)';
  g.fillRect(0, 0, W, 2);
  g.fillRect(0, 14, W, 2);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Short synthesized chip "clack". */
class Clack {
  private ctx: AudioContext | null = null;
  private buf: AudioBuffer | null = null;
  private last = 0;
  unlock() {
    if (this.ctx) return void this.ctx.resume?.();
    try {
      this.ctx = new AudioContext();
      const n = Math.floor(this.ctx.sampleRate * 0.05);
      this.buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
      const data = this.buf.getChannelData(0);
      for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (n * 0.12));
    } catch {
      this.ctx = null;
    }
  }
  play(volume = 0.25) {
    if (!this.ctx || !this.buf || this.ctx.state !== 'running') return;
    const now = performance.now();
    if (now - this.last < 35) return;
    this.last = now;
    const src = this.ctx.createBufferSource();
    src.buffer = this.buf;
    src.playbackRate.value = 0.9 + Math.random() * 0.5;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 3200 + Math.random() * 1500;
    filter.Q.value = 1.2;
    const gain = this.ctx.createGain();
    gain.gain.value = volume;
    src.connect(filter).connect(gain).connect(this.ctx.destination);
    src.start();
  }
}

export class ChipScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(35, 1, 1, 200);
  private geo = new THREE.CylinderGeometry(1, 1, THICK, 40, 1);
  private mats = new Map<number, THREE.Material[]>();
  private ring: THREE.Mesh;
  private raycaster = new THREE.Raycaster();
  private plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private own: OwnChip[] = [];
  private pile: PileChip[] = [];
  private potTarget: Chips = {};
  private denoms: Denom[] = [];
  private r = 0.6;
  private raf = 0;
  private lastT = 0;
  private lastReconcile = 0;
  private anchorSig = '';
  private dirty = true;
  private ro: ResizeObserver;
  private clack = new Clack();
  private unlock = () => this.clack.unlock();
  private disposed = false;

  constructor(
    private canvas: HTMLCanvasElement,
    private root: HTMLElement,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.camera.position.set(0, CAM_DIST * Math.cos(TILT), CAM_DIST * Math.sin(TILT));
    this.camera.lookAt(0, 0, 0);

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x1c3a2a, 1.5));
    const sun = new THREE.DirectionalLight(0xfff2dd, 2.2);
    sun.position.set(-9, 26, 10);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    const sc = sun.shadow.camera;
    sc.left = sc.bottom = -22;
    sc.right = sc.top = 22;
    sc.near = 1;
    sc.far = 80;
    sun.shadow.bias = -0.0015;
    sun.shadow.radius = 4;
    this.scene.add(sun);

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.ShadowMaterial({ opacity: 0.38 }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.97, 1, 96),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.16, side: THREE.DoubleSide }),
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.002;
    this.scene.add(this.ring);

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(root);
    this.resize();
    addEventListener('pointerdown', this.unlock, { passive: true });
    this.raf = requestAnimationFrame(this.frame);
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    removeEventListener('pointerdown', this.unlock);
    for (const m of this.mats.values()) for (const x of m) ((x as THREE.MeshStandardMaterial).map?.dispose(), x.dispose());
    this.geo.dispose();
    this.renderer.dispose();
  }

  /* ---------- geometry helpers ---------- */

  private resize() {
    const w = this.root.clientWidth || 1;
    const h = this.root.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.anchorSig = '';
    this.dirty = true;
  }

  /** Screen point (viewport px) → point on the table surface. */
  private toWorld(x: number, y: number, out = new THREE.Vector3()): THREE.Vector3 {
    const b = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((x - b.left) / b.width) * 2 - 1, -((y - b.top) / b.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    return this.raycaster.ray.intersectPlane(this.plane, out) ?? out.set(0, 0, 0);
  }

  private el(key: string): Element | null {
    return this.root.querySelector(`[data-anchor="${key}"]`);
  }

  private elPoint(el: Element | null, fy: number, out = new THREE.Vector3()): THREE.Vector3 | null {
    if (!el) return null;
    const b = el.getBoundingClientRect();
    if (b.width === 0 && b.height === 0) return null;
    return this.toWorld(b.left + b.width / 2, b.top + b.height * fy, out);
  }

  private potCentre = new THREE.Vector3();
  private ringR = 3;
  private updateAnchors() {
    const pot = this.el('pot')?.getBoundingClientRect();
    const first = this.root.querySelector('[data-anchor^="stack:"]')?.getBoundingClientRect();
    let sig = pot ? `${pot.left | 0},${pot.top | 0},${pot.width | 0}` : '-';
    for (const el of this.root.querySelectorAll('[data-anchor^="stack:"],[data-anchor^="tray:"]')) {
      const b = el.getBoundingClientRect();
      sig += `|${b.left | 0},${b.top | 0}`;
    }
    if (sig === this.anchorSig) return;
    this.anchorSig = sig;
    this.dirty = true;
    // Chip size: a fixed pixel radius where the player's own stacks sit.
    const ref = first ?? pot;
    if (ref) {
      const cx = ref.left + ref.width / 2;
      const cy = ref.top + ref.height * 0.74;
      const r = this.toWorld(cx, cy).distanceTo(this.toWorld(cx + CHIP_PX, cy));
      if (r > 0.05 && Math.abs(r - this.r) > 0.002) {
        this.r = r;
        for (const c of this.own) c.mesh.scale.setScalar(r);
        for (const c of this.pile) c.mesh.scale.setScalar(r);
      }
    }
    if (pot) {
      this.toWorld(pot.left + pot.width / 2, pot.top + pot.height * 0.5, this.potCentre);
      this.ring.position.set(this.potCentre.x, 0.002, this.potCentre.z);
      const cx = pot.left + pot.width / 2;
      const cy = pot.top + pot.height * 0.5;
      const fitH = this.toWorld(cx, cy + pot.height * 0.42).distanceTo(this.potCentre);
      const fitW = this.toWorld(cx + pot.width * 0.46, cy).distanceTo(this.potCentre);
      this.ringR = Math.max(this.r * 2.6, Math.min(fitH, fitW));
      this.ring.scale.setScalar(this.ringR);
      this.ring.visible = true;
    } else this.ring.visible = false;
  }

  private material(denom: number): THREE.Material[] {
    let m = this.mats.get(denom);
    if (!m) {
      const d = this.denoms.find((x) => x.value === denom) ?? { value: denom, color: '#888888' };
      const face = new THREE.MeshStandardMaterial({ map: faceTexture(d), roughness: 0.5, metalness: 0.05 });
      m = [new THREE.MeshStandardMaterial({ map: sideTexture(d), roughness: 0.6 }), face, face];
      this.mats.set(denom, m);
    }
    return m;
  }

  private makeMesh(denom: number): THREE.Mesh {
    const mesh = new THREE.Mesh(this.geo, this.material(denom));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.scale.setScalar(this.r);
    this.scene.add(mesh);
    return mesh;
  }

  /* ---------- public API ---------- */

  setDenoms(denoms: Denom[]) {
    const sig = (d: Denom[]) => d.map((x) => `${x.value}${x.color}`).join();
    if (sig(denoms) === sig(this.denoms)) return;
    this.denoms = denoms;
    this.mats.clear();
    for (const c of [...this.own, ...this.pile]) c.mesh.material = this.material(c.denom);
    this.dirty = true;
  }

  /** The player's own chips: how many of each sit in the stack and in the tray. */
  setOwn(want: { denom: number; stack: number; tray: number }[]) {
    this.updateAnchors();
    const keep: OwnChip[] = [];
    for (const w of want) {
      const stack = Math.min(w.stack, MAX_STACK);
      const tray = Math.min(w.tray, MAX_TRAY);
      const mine = this.own.filter((c) => c.denom === w.denom);
      // Stack chips first (bottom-up), so the top of the stack is what moves to the tray.
      mine.sort((a, b) => (a.place === b.place ? a.index - b.index : a.place === 'stack' ? -1 : 1));
      while (mine.length > stack + tray) this.scene.remove(mine.pop()!.mesh);
      while (mine.length < stack + tray) {
        const c: OwnChip = { mesh: this.makeMesh(w.denom), denom: w.denom, place: 'stack', index: mine.length, hop: 0 };
        c.mesh.rotation.y = Math.random() * Math.PI * 2;
        const idx = mine.length;
        const p = this.ownTarget(idx < stack ? 'stack' : 'tray', w.denom, idx < stack ? idx : idx - stack);
        if (p) c.mesh.position.copy(p);
        c.place = idx < stack ? 'stack' : 'tray';
        mine.push(c);
      }
      mine.forEach((c, i) => {
        const place: Place = i < stack ? 'stack' : 'tray';
        if (place !== c.place) c.hop = 1;
        c.place = place;
        c.index = i < stack ? i : i - stack;
      });
      keep.push(...mine);
    }
    for (const c of this.own) if (!keep.includes(c)) this.scene.remove(c.mesh);
    this.own = keep;
    this.dirty = true;
  }

  /** Turn the chips sitting in the tray into thrown chips heading for the pot. */
  throwTray(power = 0.5) {
    const flying = this.own.filter((c) => c.place === 'tray');
    this.own = this.own.filter((c) => c.place !== 'tray');
    flying.sort((a, b) => b.index - a.index);
    flying.forEach((c, i) => this.launch(c.mesh, c.denom, c.mesh.position.clone(), i * 0.045, 0.75 - power * 0.3));
  }

  /** Chips thrown in from somewhere else on screen (another player, or a button press). */
  throwFrom(el: Element | null, chips: Chips) {
    this.updateAnchors();
    const from = this.elPoint(el, 0.8);
    if (!from) return;
    let i = 0;
    for (const [d, n] of Object.entries(chips)) {
      for (let k = 0; k < Math.min(n, MAX_PILE_PER_DENOM); k++) {
        const start = from.clone().add(new THREE.Vector3((Math.random() - 0.5) * this.r * 2, this.r * 0.5, (Math.random() - 0.5) * this.r));
        this.launch(this.makeMesh(Number(d)), Number(d), start, i++ * 0.05, 0.7);
      }
    }
  }

  /** Pot chips slide off to a winner. */
  payout(chips: Chips, el: Element | null) {
    this.updateAnchors();
    const to = this.elPoint(el, 0.6) ?? this.potCentre.clone().add(new THREE.Vector3(0, 0, -20));
    let i = 0;
    for (const [d, n] of Object.entries(chips)) {
      const cands = this.pile.filter((c) => c.denom === Number(d) && c.state !== 'out').reverse();
      for (const c of cands.slice(0, n)) {
        c.state = 'out';
        c.from = c.mesh.position.clone();
        c.to = to.clone().add(new THREE.Vector3((Math.random() - 0.5) * this.r * 2, this.r * THICK, (Math.random() - 0.5) * this.r * 2));
        c.t = 0;
        c.delay = i++ * 0.03;
        c.dur = 0.55;
        c.peak = this.r * 3;
        c.flips = 0;
      }
    }
    this.dirty = true;
  }

  setPot(chips: Chips) {
    this.potTarget = chips;
    this.reconcile();
  }

  /* ---------- pile ---------- */

  private slot(): THREE.Vector3 {
    const resting = this.pile.filter((c) => c.state !== 'out');
    const spread = Math.min(this.ringR - this.r * 1.1, this.r * (1.1 + 0.5 * Math.sqrt(resting.length)));
    const a = Math.random() * Math.PI * 2;
    const d = Math.sqrt(Math.random()) * spread;
    const off = new THREE.Vector3(Math.cos(a) * d, 0, Math.sin(a) * d);
    off.y = this.restHeight(off, resting);
    return off;
  }

  private restHeight(off: THREE.Vector3, others: PileChip[]): number {
    const h = this.r * THICK;
    let y = h / 2;
    for (const o of others) {
      const dx = o.off.x - off.x;
      const dz = o.off.z - off.z;
      if (dx * dx + dz * dz < (this.r * 1.85) ** 2) y = Math.max(y, o.off.y + h);
    }
    return y;
  }

  private launch(mesh: THREE.Mesh, denom: number, from: THREE.Vector3, delay: number, dur: number) {
    const off = this.slot();
    const onTop = off.y > this.r * THICK;
    const restQ = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(onTop ? (Math.random() - 0.5) * 0.16 : 0, Math.random() * Math.PI * 2, onTop ? (Math.random() - 0.5) * 0.16 : 0),
    );
    const dir = this.potCentre.clone().sub(from).setY(0).normalize();
    this.pile.push({
      mesh,
      denom,
      state: 'in',
      born: performance.now(),
      off,
      from,
      to: new THREE.Vector3(),
      t: 0,
      delay,
      dur: dur * (0.9 + Math.random() * 0.25),
      peak: this.r * (3.5 + Math.random() * 2.5),
      flips: 1 + Math.floor(Math.random() * 2),
      // Tumble end over end along the direction of travel, with a little wobble.
      axis: new THREE.Vector3(dir.z + (Math.random() - 0.5) * 0.5, 0, -dir.x + (Math.random() - 0.5) * 0.5).normalize(),
      restQ,
      landed: false,
    });
    this.dirty = true;
  }

  /** Make the pile match the server's pot, leaving just-thrown chips alone until confirmed. */
  private reconcile() {
    const now = performance.now();
    const denoms = new Set([...Object.keys(this.potTarget).map(Number), ...this.pile.map((c) => c.denom)]);
    let removed = false;
    for (const d of denoms) {
      const target = Math.min(this.potTarget[d] ?? 0, MAX_PILE_PER_DENOM);
      const have = this.pile.filter((c) => c.denom === d && c.state !== 'out');
      if (have.length < target) {
        for (let i = have.length; i < target; i++) {
          const mesh = this.makeMesh(d);
          this.launch(mesh, d, new THREE.Vector3(), 0, 0.3);
          const c = this.pile[this.pile.length - 1];
          c.from = this.potCentre.clone().add(c.off).setY(c.off.y + this.r * 2.5);
          c.peak = 0;
          c.flips = 0;
          mesh.position.copy(c.from);
        }
      } else if (have.length > target) {
        const settled = have.filter((c) => now - c.born > UNCONFIRMED_MS).reverse();
        for (const c of settled.slice(0, have.length - target)) {
          this.scene.remove(c.mesh);
          this.pile.splice(this.pile.indexOf(c), 1);
          removed = true;
        }
      }
    }
    if (removed) this.resettle();
    this.dirty = true;
  }

  private resettle() {
    const placed: PileChip[] = [];
    for (const c of this.pile) {
      if (c.state === 'out') continue;
      c.off.y = this.restHeight(c.off, placed);
      placed.push(c);
    }
  }

  /* ---------- frame loop ---------- */

  private ownTarget(place: Place, denom: number, index: number): THREE.Vector3 | null {
    const p = this.elPoint(this.el(`${place}:${denom}`), place === 'stack' ? 0.74 : 0.5);
    if (!p) return null;
    p.y = this.r * THICK * (index + 0.5);
    return p;
  }

  private tmpQ = new THREE.Quaternion();
  private flat = new THREE.Quaternion();

  private frame = (now: number) => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min(0.05, (now - (this.lastT || now)) / 1000);
    this.lastT = now;
    this.updateAnchors();
    if (now - this.lastReconcile > 600) {
      this.lastReconcile = now;
      this.reconcile();
    }
    let moving = false;

    // Own chips ease toward their slot in the stack or tray.
    const k = 1 - Math.exp(-dt * 20);
    const cache = new Map<string, THREE.Vector3 | null>();
    for (const c of this.own) {
      const key = `${c.place}:${c.denom}`;
      if (!cache.has(key)) cache.set(key, this.elPoint(this.el(key), c.place === 'stack' ? 0.74 : 0.5));
      const base = cache.get(key);
      if (!base) {
        c.mesh.visible = false;
        continue;
      }
      c.mesh.visible = true;
      if (c.hop > 0) c.hop = Math.max(0, c.hop - dt / 0.28);
      const ty = this.r * THICK * (c.index + 0.5) + Math.sin(Math.PI * c.hop) * this.r * 1.6;
      const p = c.mesh.position;
      const dx = base.x - p.x;
      const dy = ty - p.y;
      const dz = base.z - p.z;
      if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) > 0.002 || c.hop > 0) {
        p.x += dx * k;
        p.y += dy * k;
        p.z += dz * k;
        moving = true;
      }
    }

    // Pile chips: flying in, resting, or flying out to a winner.
    for (let i = this.pile.length - 1; i >= 0; i--) {
      const c = this.pile[i];
      const m = c.mesh;
      if (c.state === 'rest') {
        const tx = this.potCentre.x + c.off.x;
        const tz = this.potCentre.z + c.off.z;
        if (Math.abs(m.position.x - tx) + Math.abs(m.position.y - c.off.y) + Math.abs(m.position.z - tz) > 0.002) {
          m.position.x += (tx - m.position.x) * k;
          m.position.y += (c.off.y - m.position.y) * k;
          m.position.z += (tz - m.position.z) * k;
          moving = true;
        }
        continue;
      }
      moving = true;
      c.t += dt;
      const u = Math.min(1, Math.max(0, (c.t - c.delay) / c.dur));
      if (c.state === 'in') {
        c.to.copy(this.potCentre).add(c.off);
        m.position.lerpVectors(c.from, c.to, u);
        m.position.y += c.peak * 4 * u * (1 - u);
        this.tmpQ.setFromAxisAngle(c.axis, c.flips * Math.PI * 2 * (1 - u));
        m.quaternion.copy(c.restQ).premultiply(this.tmpQ);
        if (u >= 1) {
          if (!c.landed) {
            c.landed = true;
            if (c.peak > 0) this.clack.play();
          }
          // A small bounce and wobble before settling.
          const v = (c.t - c.delay - c.dur) / 0.2;
          if (v >= 1 || c.peak === 0) {
            c.state = 'rest';
            m.quaternion.copy(c.restQ);
            m.position.copy(c.to);
          } else {
            m.position.y += this.r * 0.55 * 4 * v * (1 - v);
            this.tmpQ.setFromAxisAngle(c.axis, Math.sin(v * Math.PI) * 0.35);
            m.quaternion.copy(c.restQ).premultiply(this.tmpQ);
          }
        }
      } else {
        const e = u * u * (3 - 2 * u);
        m.position.lerpVectors(c.from, c.to, e);
        m.position.y += c.peak * 4 * u * (1 - u);
        m.quaternion.slerp(this.flat, 0.2);
        if (u >= 1) {
          this.scene.remove(m);
          this.pile.splice(i, 1);
          this.clack.play(0.12);
          this.resettle();
        }
      }
    }

    if (moving || this.dirty) {
      this.dirty = moving;
      this.renderer.render(this.scene, this.camera);
    }
  };
}
