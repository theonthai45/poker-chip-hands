import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { money, type Chips } from '../shared/chips';
import type { Denom } from '../shared/types';
import { sfx } from './sound';

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
  /** Small sideways offset so stacks are not perfectly straight. */
  jx: number;
  jz: number;
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

function shade(hex: string, amt: number) {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(amt >= 0 ? v + (255 - v) * amt : v * (1 + amt))));
  return `rgb(${ch(n >> 16)},${ch((n >> 8) & 255)},${ch(n & 255)})`;
}

interface Spot {
  /** Centre angle and half-width, in radians; c picks the first or second accent colour. */
  a: number;
  w: number;
  c: 0 | 1;
  /** How far in from the rim the spot reaches (fraction of radius). */
  depth: number;
}

const EDGE_STYLES = 6;

/** Edge-spot layouts. Each is symmetric so faces and edge line up from any side. */
function edgeSpots(style: number): Spot[] {
  const out: Spot[] = [];
  const ring = (n: number, w: number, c: 0 | 1, depth: number, offset = 0) => {
    for (let k = 0; k < n; k++) out.push({ a: offset + (k * Math.PI * 2) / n, w, c, depth });
  };
  switch (style % EDGE_STYLES) {
    case 0: // six blocks
      ring(6, 0.25, 0, 0.24);
      break;
    case 1: // eight twin stripes
      ring(8, 0.045, 0, 0.24, -0.085);
      ring(8, 0.045, 0, 0.24, 0.085);
      break;
    case 2: // four big blocks with a pip between
      ring(4, 0.36, 0, 0.24);
      ring(4, 0.1, 1, 0.14, Math.PI / 4);
      break;
    case 3: // twelve dashes
      ring(12, 0.11, 0, 0.16);
      break;
    case 4: // four triple bars
      ring(4, 0.06, 0, 0.24, -0.2);
      ring(4, 0.08, 1, 0.24, 0);
      ring(4, 0.06, 0, 0.24, 0.2);
      break;
    default: // eight blocks with thin bars between
      ring(8, 0.17, 0, 0.24);
      ring(8, 0.04, 1, 0.24, Math.PI / 8);
  }
  return out;
}

function accents(d: Denom): [string, string] {
  const dark = textOn(d.color) === '#1a1a1a';
  return dark ? ['#27376b', '#b3262d'] : ['#f6f3ea', '#e8c15a'];
}

function canvas(size: number, h = size) {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = h;
  return [c, c.getContext('2d')!] as const;
}

function speckle(g: CanvasRenderingContext2D, w: number, h: number, alpha: number, count: number) {
  for (let i = 0; i < count; i++) {
    g.fillStyle = Math.random() < 0.5 ? `rgba(255,255,255,${alpha})` : `rgba(0,0,0,${alpha})`;
    g.fillRect(Math.random() * w, Math.random() * h, 1.5, 1.5);
  }
}

/** Colour, bump and roughness maps for a chip face. */
function faceMaps(d: Denom, style: number) {
  const S = 512;
  const R = S / 2;
  const [acc1, acc2] = accents(d);
  const ink = textOn(d.color);
  const spots = edgeSpots(style);

  const [cc, g] = canvas(S);
  g.fillStyle = d.color;
  g.fillRect(0, 0, S, S);
  speckle(g, S, S, 0.05, 2600); // clay grain
  for (const s of spots) {
    g.fillStyle = s.c ? acc2 : acc1;
    g.beginPath();
    g.arc(R, R, R, s.a - s.w, s.a + s.w);
    g.arc(R, R, R * (1 - s.depth), s.a + s.w, s.a - s.w, true);
    g.fill();
  }
  // Moulded ring between rim and inlay
  g.lineWidth = 3;
  g.strokeStyle = ink === '#ffffff' ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.3)';
  g.beginPath();
  g.arc(R, R, R * 0.73, 0, Math.PI * 2);
  g.stroke();
  // Inlay (the printed centre label)
  const inlayR = R * 0.62;
  const grad = g.createRadialGradient(R - 30, R - 40, 10, R, R, inlayR);
  grad.addColorStop(0, shade(d.color, 0.08));
  grad.addColorStop(1, shade(d.color, -0.16));
  g.fillStyle = grad;
  g.beginPath();
  g.arc(R, R, inlayR, 0, Math.PI * 2);
  g.fill();
  g.lineWidth = 7;
  g.strokeStyle = '#d9b24c';
  g.stroke();
  g.lineWidth = 2;
  g.strokeStyle = 'rgba(0,0,0,0.35)';
  g.beginPath();
  g.arc(R, R, inlayR - 12, 0, Math.PI * 2);
  g.stroke();
  // Suits around the label
  g.font = '34px serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  ['♠', '♥', '♣', '♦'].forEach((suit, i) => {
    const a = (i * Math.PI) / 2 - Math.PI / 2;
    g.save();
    g.translate(R + Math.cos(a) * inlayR * 0.74, R + Math.sin(a) * inlayR * 0.74);
    g.rotate(a + Math.PI / 2);
    g.fillStyle = ink === '#ffffff' ? 'rgba(255,255,255,0.75)' : i % 2 ? '#b3262d' : '#1a1a1a';
    g.fillText(suit, 0, 0);
    g.restore();
  });
  const label = money(d.value).replace('$', '');
  g.font = `800 ${label.length > 3 ? 104 : label.length > 2 ? 124 : 150}px system-ui, sans-serif`;
  g.lineWidth = 6;
  g.strokeStyle = ink === '#ffffff' ? 'rgba(0,0,0,0.35)' : 'rgba(255,255,255,0.5)';
  g.strokeText(label, R, R + 6);
  g.fillStyle = ink;
  g.fillText(label, R, R + 6);
  const map = new THREE.CanvasTexture(cc);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;

  // Height: cross-hatched rim sits proud, the inlay is slightly recessed.
  const B = 256;
  const [bc, b] = canvas(B);
  b.fillStyle = '#9a9a9a';
  b.fillRect(0, 0, B, B);
  b.strokeStyle = '#c4c4c4';
  b.lineWidth = 1;
  for (let i = -B; i < B * 2; i += 5) {
    b.beginPath();
    b.moveTo(i, 0);
    b.lineTo(i + B, B);
    b.moveTo(i, 0);
    b.lineTo(i - B, B);
    b.stroke();
  }
  b.fillStyle = '#b8b8b8';
  for (const s of spots) {
    b.beginPath();
    b.arc(B / 2, B / 2, B / 2, s.a - s.w, s.a + s.w);
    b.arc(B / 2, B / 2, (B / 2) * (1 - s.depth), s.a + s.w, s.a - s.w, true);
    b.fill();
  }
  b.fillStyle = '#6e6e6e';
  b.beginPath();
  b.arc(B / 2, B / 2, (B / 2) * 0.62, 0, Math.PI * 2);
  b.fill();
  b.lineWidth = 4;
  b.strokeStyle = '#a8a8a8';
  b.stroke();
  const bumpMap = new THREE.CanvasTexture(bc);

  // Roughness (green channel): matte clay rim, glossier printed label.
  const [rc, r] = canvas(B);
  r.fillStyle = 'rgb(0,205,0)';
  r.fillRect(0, 0, B, B);
  r.fillStyle = 'rgb(0,90,0)';
  r.beginPath();
  r.arc(B / 2, B / 2, (B / 2) * 0.62, 0, Math.PI * 2);
  r.fill();
  const roughnessMap = new THREE.CanvasTexture(rc);
  return { map, bumpMap, roughnessMap };
}

function sideMap(d: Denom, style: number): THREE.CanvasTexture {
  const W = 1024;
  const H = 32;
  const [c, g] = canvas(W, H);
  const [acc1, acc2] = accents(d);
  g.fillStyle = d.color;
  g.fillRect(0, 0, W, H);
  speckle(g, W, H, 0.06, 500);
  for (const s of edgeSpots(style)) {
    g.fillStyle = s.c ? acc2 : acc1;
    const w = (s.w / Math.PI) * W;
    for (const shift of [-W, 0, W]) g.fillRect((s.a / (Math.PI * 2)) * W - w / 2 + shift, 0, w, H);
  }
  // Mould seam and darkened edges give the stack its ridged look.
  g.fillStyle = 'rgba(0,0,0,0.28)';
  g.fillRect(0, 0, W, 4);
  g.fillRect(0, H - 4, W, 4);
  g.fillStyle = 'rgba(255,255,255,0.14)';
  g.fillRect(0, H / 2 - 1, W, 2);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

/**
 * A unit-radius chip with rounded rims. Group 0 is the edge, group 1 the two faces.
 */
function chipGeometry(): THREE.BufferGeometry {
  const SEG = 56;
  const h = THICK / 2;
  const bev = 0.045;
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const idxSide: number[] = [];
  const idxFace: number[] = [];
  const P = (i: number) => new THREE.Vector3(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
  const N = (i: number) => new THREE.Vector3(nor[i * 3], nor[i * 3 + 1], nor[i * 3 + 2]);
  const vert = (x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, v: number) => {
    const l = Math.hypot(nx, ny, nz) || 1;
    pos.push(x, y, z);
    nor.push(nx / l, ny / l, nz / l);
    uv.push(u, v);
    return pos.length / 3 - 1;
  };
  /** Add a triangle, flipping it if needed so it faces the way its normals point. */
  const tri = (out: number[], a: number, b: number, c: number) => {
    const face = P(b).sub(P(a)).cross(P(c).sub(P(a)));
    if (face.dot(N(a).add(N(b)).add(N(c))) < 0) out.push(a, c, b);
    else out.push(a, b, c);
  };
  const ring = (radius: number, y: number, ny: number, nr: number, planar: number | null, v = 0) => {
    const ids: number[] = [];
    for (let i = 0; i <= SEG; i++) {
      const a = (i / SEG) * Math.PI * 2;
      const cx = Math.cos(a);
      const cz = Math.sin(a);
      // Faces use a flat top-down projection; the bottom is mirrored so its label reads correctly.
      const u = planar === null ? i / SEG : 0.5 + (cx * radius) / 2;
      const vv = planar === null ? v : 0.5 - (planar * cz * radius) / 2;
      ids.push(vert(cx * radius, y, cz * radius, cx * nr, ny, cz * nr, u, vv));
    }
    return ids;
  };
  const strip = (out: number[], a: number[], b: number[]) => {
    for (let i = 0; i < SEG; i++) {
      tri(out, a[i], b[i], a[i + 1]);
      tri(out, a[i + 1], b[i], b[i + 1]);
    }
  };
  for (const sgn of [1, -1]) {
    const centre = vert(0, sgn * h, 0, 0, sgn, 0, 0.5, 0.5);
    const inner = ring(1 - bev, sgn * h, sgn, 0, sgn);
    for (let i = 0; i < SEG; i++) tri(idxFace, centre, inner[i], inner[i + 1]);
    // Rounded shoulder: normals blend from straight up to straight out.
    const shoulderIn = ring(1 - bev, sgn * h, sgn, 0.25, sgn);
    const shoulderOut = ring(1, sgn * (h - bev), sgn * 0.25, 1, sgn);
    strip(idxFace, shoulderIn, shoulderOut);
  }
  strip(idxSide, ring(1, h - bev, 0, 1, null, 1), ring(1, -(h - bev), 0, 1, null, 0));

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex([...idxSide, ...idxFace]);
  geo.addGroup(0, idxSide.length, 0);
  geo.addGroup(idxSide.length, idxFace.length, 1);
  geo.computeBoundingSphere();
  return geo;
}

export class ChipScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(35, 1, 1, 200);
  private geo = chipGeometry();
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
  private drag = { x: 0, y: 0, active: false, lift: 0 };
  private slowFrames = 0;
  private quality = 2;
  private disposed = false;

  constructor(
    private canvas: HTMLCanvasElement,
    private root: HTMLElement,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    // Soft studio reflections so the chips pick up highlights as they tumble.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.3;
    pmrem.dispose();

    this.camera.position.set(0, CAM_DIST * Math.cos(TILT), CAM_DIST * Math.sin(TILT));
    this.camera.lookAt(0, 0, 0);

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x1c3a2a, 0.55));
    const sun = new THREE.DirectionalLight(0xfff2dd, 2.0);
    sun.position.set(-9, 26, 10);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = sc.bottom = -22;
    sc.right = sc.top = 22;
    sc.near = 1;
    sc.far = 80;
    sun.shadow.bias = -0.0015;
    sun.shadow.radius = 4;
    this.scene.add(sun);

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.ShadowMaterial({ opacity: 0.45 }));
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
    this.raf = requestAnimationFrame(this.frame);
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.disposeMaterials();
    this.scene.environment?.dispose();
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

  private elPoint(el: Element | null, fy: number, out = new THREE.Vector3(), dx = 0, dy = 0): THREE.Vector3 | null {
    if (!el) return null;
    const b = el.getBoundingClientRect();
    if (b.width === 0 && b.height === 0) return null;
    return this.toWorld(b.left + b.width / 2 + dx, b.top + b.height * fy + dy, out);
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

  private disposeMaterials() {
    for (const mats of this.mats.values()) {
      for (const m of mats as THREE.MeshStandardMaterial[]) {
        m.map?.dispose();
        m.bumpMap?.dispose();
        m.roughnessMap?.dispose();
        m.dispose();
      }
    }
    this.mats.clear();
  }

  private material(denom: number): THREE.Material[] {
    let m = this.mats.get(denom);
    if (!m) {
      const sorted = [...this.denoms].sort((a, b) => a.value - b.value);
      const style = Math.max(0, sorted.findIndex((x) => x.value === denom));
      const d = sorted[style] ?? { value: denom, color: '#888888' };
      const face = new THREE.MeshStandardMaterial({ ...faceMaps(d, style), bumpScale: 1.6, roughness: 1, metalness: 0 });
      const side = new THREE.MeshStandardMaterial({ map: sideMap(d, style), roughness: 0.78, metalness: 0 });
      m = [side, face];
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
    this.disposeMaterials();
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
        const c: OwnChip = { mesh: this.makeMesh(w.denom), denom: w.denom, place: 'stack', index: mine.length, hop: 0, jx: 0, jz: 0 };
        c.mesh.rotation.y = Math.random() * Math.PI * 2;
        c.jx = (Math.random() - 0.5) * 0.07;
        c.jz = (Math.random() - 0.5) * 0.07;
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

  /** Tray chips follow the finger by this many screen pixels while dragging. */
  setDrag(x: number, y: number, active: boolean) {
    this.drag.x = x;
    this.drag.y = y;
    this.drag.active = active;
    this.dirty = true;
  }

  /**
   * Turn the chips in the tray into thrown chips. `vx`/`vy` is the finger's
   * release velocity in px/ms (up is negative): faster flicks fly flatter and
   * quicker, and a sideways flick lands off-centre.
   */
  throwTray(vx = 0, vy = -1) {
    const speed = Math.min(3, Math.hypot(vx, vy));
    const power = Math.min(1, speed / 2);
    const side = Math.max(-1, Math.min(1, vx / Math.max(0.3, -vy)));
    const flying = this.own.filter((c) => c.place === 'tray');
    this.own = this.own.filter((c) => c.place !== 'tray');
    flying.sort((a, b) => b.index - a.index);
    flying.forEach((c, i) => this.launch(c.mesh, c.denom, c.mesh.position.clone(), i * 0.035, 0.72 - power * 0.32, 1 - power * 0.55, side));
    this.drag.active = false;
    this.drag.x = this.drag.y = 0;
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

  private slot(side = 0): THREE.Vector3 {
    const resting = this.pile.filter((c) => c.state !== 'out');
    const spread = Math.min(this.ringR - this.r * 1.1, this.r * (1.1 + 0.5 * Math.sqrt(resting.length)));
    const a = Math.random() * Math.PI * 2;
    const d = Math.sqrt(Math.random()) * spread;
    const off = new THREE.Vector3(Math.cos(a) * d, 0, Math.sin(a) * d);
    // A sideways flick carries the chips toward that side of the pot.
    off.x += side * this.r * 2.2;
    const max = this.ringR - this.r * 1.1;
    if (off.length() > max) off.setLength(max);
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

  private launch(mesh: THREE.Mesh, denom: number, from: THREE.Vector3, delay: number, dur: number, arc = 1, side = 0) {
    const off = this.slot(side);
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
      peak: this.r * (3.5 + Math.random() * 2.5) * arc,
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
    if (removed) {
      this.resettle();
      this.dirty = true;
    }
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

  private prevFrame = 0;
  private wasMoving = false;
  /** Step the detail down on phones that cannot keep animations smooth. */
  private tuneQuality(now: number) {
    const gap = now - this.prevFrame;
    this.prevFrame = now;
    if (!this.wasMoving || this.quality === 0) return;
    this.slowFrames = gap > 40 ? this.slowFrames + 1 : Math.max(0, this.slowFrames - 2);
    if (this.slowFrames < 12) return;
    this.slowFrames = 0;
    this.quality -= 1;
    if (this.quality === 1) this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.25));
    else {
      this.renderer.setPixelRatio(1);
      this.renderer.shadowMap.enabled = false;
      this.scene.traverse((o) => {
        const m = (o as THREE.Mesh).material;
        for (const x of Array.isArray(m) ? m : m ? [m] : []) x.needsUpdate = true;
      });
    }
    this.resize();
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
    this.tuneQuality(now);

    // Own chips ease toward their slot in the stack or tray.
    const ease = 1 - Math.exp(-dt * 20);
    const k = ease;
    this.drag.lift += ((this.drag.active ? 1 : 0) - this.drag.lift) * (1 - Math.exp(-dt * 25));
    if (this.drag.lift > 0.01 && this.drag.lift < 0.99) moving = true;
    const cache = new Map<string, THREE.Vector3 | null>();
    for (const c of this.own) {
      const key = `${c.place}:${c.denom}`;
      if (!cache.has(key)) {
        const tray = c.place === 'tray';
        cache.set(key, this.elPoint(this.el(key), tray ? 0.5 : 0.74, undefined, tray ? this.drag.x : 0, tray ? this.drag.y : 0));
      }
      const base = cache.get(key);
      if (!base) {
        c.mesh.visible = false;
        continue;
      }
      c.mesh.visible = true;
      if (c.hop > 0) c.hop = Math.max(0, c.hop - dt / 0.28);
      const held = c.place === 'tray' ? this.drag.lift : 0;
      const ty = this.r * THICK * (c.index + 0.5) + Math.sin(Math.PI * c.hop) * this.r * 1.6 + held * this.r * 0.9;
      // While held, chips stick to the finger instead of easing after it.
      const k = held > 0 && this.drag.active && c.hop === 0 ? 1 : ease;
      const p = c.mesh.position;
      const dx = base.x + c.jx * this.r - p.x;
      const dy = ty - p.y;
      const dz = base.z + c.jz * this.r - p.z;
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
            if (c.peak > 0) sfx.clack(c.off.y > this.r * THICK ? 1 : 0.7);
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
          sfx.clack(0.45);
          this.resettle();
        }
      }
    }

    this.wasMoving = moving;
    if (moving || this.dirty) {
      this.dirty = moving;
      this.renderer.render(this.scene, this.camera);
    }
  };
}
