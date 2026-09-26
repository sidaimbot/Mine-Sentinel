import * as THREE from 'three';
import { TUNNEL_HEIGHT, SENSOR_NODES } from './MineLayout.js';
import { fbm3, mulberry32 } from '../utils/noise.js';
import { rockTextures, floorTextures, woodTextures, barkTextures, haloTexture } from './Textures.js';

const H = TUNNEL_HEIGHT;
const WALL_SEGMENTS = 8;
const SUB = 2; // quads per metre along floors, ceilings and walls
const UV_SCALE = 1 / 3; // one texture tile every 3 m

export const LAMP_POSITIONS = [
  { x: 0, z: -1 }, { x: 0, z: -12 }, { x: 0, z: -24 }, { x: 0, z: -36 }, { x: 0, z: -48 },
  { x: 0, z: -60 }, { x: 0, z: -72 }, { x: 0, z: -84 },
  { x: 11, z: -60 },
  { x: 20, z: -54 }, { x: 20, z: -44 }, { x: 20, z: -34 }, { x: 20, z: -24 }, { x: 20, z: -15 },
  { x: 20, z: -7 }, { x: 10, z: -4 },
];

// Walls lined with vertical round logs (timber lagging), like older hand-dug drifts.
const LAGGING = [
  { axis: 'z', walls: [-2, 2], from: -52, to: -8 },
  { axis: 'z', walls: [18, 22], from: -57, to: -15 },
  { axis: 'x', walls: [-6, -2], from: 7, to: 13 },
];
const LOG_INSET = 0.24;

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// 1 on a lagged wall line, fading to 0 away from it and at the ends of each lagged section.
function laggingMask(x, z) {
  let mask = 0;
  for (const s of LAGGING) {
    const along = s.axis === 'z' ? z : x;
    const across = s.axis === 'z' ? x : z;
    const span = smoothstep(s.from - 1, s.from, along) * (1 - smoothstep(s.to, s.to + 1, along));
    for (const w of s.walls) mask = Math.max(mask, span * (1 - smoothstep(0.3, 1, Math.abs(across - w))));
  }
  return mask;
}

// Depends only on position, so vertices shared between floor, wall and ceiling quads stay welded.
function displace(x, y, z) {
  const behindLogs = 1 - 0.8 * laggingMask(x, z) * (1 - smoothstep(H - 1.2, H - 0.4, y));
  const rise = smoothstep(0, 1.2, y);
  const ah = (0.15 + 0.7 * rise) * behindLogs;
  const ay = 0.06 + 0.7 * smoothstep(H - 1.5, H, y);
  const bulge = fbm3(x * 0.13 + 5, y * 0.13, z * 0.13, 2) * 0.8 * rise * behindLogs;
  // A high-frequency term chips the surface so faces read as broken rock rather than smooth plaster.
  const chip = 0.14 * rise * behindLogs;
  return [
    x + fbm3(x * 0.45, y * 0.45, z * 0.45) * ah + bulge + fbm3(x * 1.7, y * 1.7, z * 1.7, 2) * chip,
    y + fbm3(x * 0.45 + 17, y * 0.45, z * 0.45) * ay,
    z + fbm3(x * 0.45 + 31, y * 0.45, z * 0.45) * ah + bulge + fbm3(x * 1.7 + 9, y * 1.7, z * 1.7, 2) * chip,
  ];
}

function makeSignTexture(lines, accent) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 160;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#16140d';
  ctx.fillRect(0, 0, 512, 160);
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, 512, 10);
  ctx.fillRect(0, 150, 512, 10);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#e8e2a0';
  ctx.font = 'bold 54px "Courier New", monospace';
  ctx.fillText(lines[0], 256, 82);
  ctx.fillStyle = accent;
  ctx.font = 'bold 26px "Courier New", monospace';
  ctx.fillText(lines[1] ?? '', 256, 128);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

class QuadBuilder {
  constructor() {
    this.positions = [];
    this.uvs = [];
  }

  quad(p, uv) {
    for (const i of [0, 1, 2, 0, 2, 3]) {
      this.positions.push(...displace(...p[i]));
      this.uvs.push(...uv[i]);
    }
  }

  build() {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
    geometry.computeVertexNormals();
    return geometry;
  }
}

export class MineGenerator {
  constructor(layout) {
    this.layout = layout;
    this.group = new THREE.Group();
    this.group.name = 'mine';
    this.lamps = [];
    this.rock = rockTextures();
    this.wood = woodTextures();
  }

  generate() {
    this.buildRock();
    this.buildSupports();
    this.buildLagging();
    this.buildRubble();
    this.buildRails();
    this.buildLampFixtures();
    this.buildSigns();
    this.buildProps();
    return this.group;
  }

  buildRock() {
    const { layout } = this;
    const walls = new QuadBuilder();
    const floor = new QuadBuilder();
    const T = UV_SCALE;
    const d = 1 / SUB;

    for (let iz = 0; iz < layout.rows; iz++) {
      for (let ix = 0; ix < layout.cols; ix++) {
        if (!layout.isWalkableCell(ix, iz)) continue;
        const cx = layout.bounds.minX + ix;
        const cz = layout.bounds.minZ + iz;

        // Floors and ceilings are subdivided to match wall edge vertices, otherwise displaced seams crack open.
        for (let a = 0; a < SUB; a++) {
          for (let b = 0; b < SUB; b++) {
            const x0 = cx + a * d, x1 = x0 + d, z0 = cz + b * d, z1 = z0 + d;
            floor.quad(
              [[x0, 0, z1], [x1, 0, z1], [x1, 0, z0], [x0, 0, z0]],
              [[x0 * T, z1 * T], [x1 * T, z1 * T], [x1 * T, z0 * T], [x0 * T, z0 * T]]
            );
            walls.quad(
              [[x0, H, z0], [x1, H, z0], [x1, H, z1], [x0, H, z1]],
              [[x0 * T, z0 * T], [x1 * T, z0 * T], [x1 * T, z1 * T], [x0 * T, z1 * T]]
            );
          }
        }

        const east = !layout.isWalkableCell(ix + 1, iz);
        const west = !layout.isWalkableCell(ix - 1, iz);
        const south = !layout.isWalkableCell(ix, iz + 1);
        const north = !layout.isWalkableCell(ix, iz - 1);

        for (let s = 0; s < WALL_SEGMENTS; s++) {
          const y0 = (H / WALL_SEGMENTS) * s, y1 = (H / WALL_SEGMENTS) * (s + 1);
          const vy0 = y0 * T, vy1 = y1 * T;
          for (let k = 0; k < SUB; k++) {
            const a0 = k * d, a1 = a0 + d;
            if (east) {
              const x = cx + 1, z0 = cz + a0, z1 = cz + a1;
              walls.quad([[x, y0, z0], [x, y0, z1], [x, y1, z1], [x, y1, z0]],
                [[z0 * T, vy0], [z1 * T, vy0], [z1 * T, vy1], [z0 * T, vy1]]);
            }
            if (west) {
              const x = cx, z0 = cz + a0, z1 = cz + a1;
              walls.quad([[x, y0, z1], [x, y0, z0], [x, y1, z0], [x, y1, z1]],
                [[z1 * T, vy0], [z0 * T, vy0], [z0 * T, vy1], [z1 * T, vy1]]);
            }
            if (south) {
              const z = cz + 1, x0 = cx + a0, x1 = cx + a1;
              walls.quad([[x1, y0, z], [x0, y0, z], [x0, y1, z], [x1, y1, z]],
                [[x1 * T, vy0], [x0 * T, vy0], [x0 * T, vy1], [x1 * T, vy1]]);
            }
            if (north) {
              const z = cz, x0 = cx + a0, x1 = cx + a1;
              walls.quad([[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]],
                [[x0 * T, vy0], [x1 * T, vy0], [x1 * T, vy1], [x0 * T, vy1]]);
            }
          }
        }
      }
    }

    const floorTex = floorTextures();
    this.group.add(new THREE.Mesh(walls.build(), new THREE.MeshStandardMaterial({
      map: this.rock.map, normalMap: this.rock.normalMap, normalScale: new THREE.Vector2(1.3, 1.3),
      roughness: 0.9, metalness: 0.02,
    })));
    this.group.add(new THREE.Mesh(floor.build(), new THREE.MeshStandardMaterial({
      map: floorTex.map, normalMap: floorTex.normalMap, normalScale: new THREE.Vector2(1.1, 1.1), roughness: 0.97,
    })));
  }

  woodMaterial() {
    return new THREE.MeshStandardMaterial({
      map: this.wood.map, normalMap: this.wood.normalMap, color: 0xb9ab9a, roughness: 0.85,
    });
  }

  buildSupports() {
    const sets = [];
    for (let z = -10; z >= -86; z -= 5) {
      if (z < -53 && z > -67) continue;
      sets.push({ x: 0, z, halfWidth: 1.58, alongZ: true });
    }
    for (let z = -18; z >= -56; z -= 5) sets.push({ x: 20, z, halfWidth: 1.58, alongZ: true });
    for (let x = 7; x <= 16; x += 5) sets.push({ x, z: -60, halfWidth: 1.58, alongZ: false });
    for (const x of [8, 12]) sets.push({ x, z: -4, halfWidth: 1.58, alongZ: false });

    const wood = this.woodMaterial();
    const postGeo = new THREE.BoxGeometry(0.28, H - 0.25, 0.28);
    const capGeo = new THREE.BoxGeometry(3.7, 0.3, 0.34);
    const posts = new THREE.InstancedMesh(postGeo, wood, sets.length * 2);
    const caps = new THREE.InstancedMesh(capGeo, wood, sets.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const rand = mulberry32(7);

    sets.forEach((s, i) => {
      const tilt = (rand() - 0.5) * 0.05;
      for (const side of [-1, 1]) {
        const px = s.alongZ ? s.x + side * s.halfWidth : s.x;
        const pz = s.alongZ ? s.z : s.z + side * s.halfWidth;
        q.setFromEuler(new THREE.Euler(s.alongZ ? 0 : tilt, 0, s.alongZ ? tilt : 0));
        m.compose(new THREE.Vector3(px, (H - 0.25) / 2, pz), q, new THREE.Vector3(1, 1, 1));
        posts.setMatrixAt(i * 2 + (side > 0 ? 1 : 0), m);
      }
      q.setFromEuler(new THREE.Euler(0, s.alongZ ? 0 : Math.PI / 2, 0));
      m.compose(new THREE.Vector3(s.x, H - 0.4, s.z), q, new THREE.Vector3(1, 1, 1));
      caps.setMatrixAt(i, m);
    });

    this.group.add(posts, caps);
  }

  buildLagging() {
    const bark = barkTextures();
    const mat = new THREE.MeshStandardMaterial({ map: bark.map, normalMap: bark.normalMap, roughness: 0.95 });
    const spacing = 0.27;
    const rand = mulberry32(11);
    const logs = [];

    for (const s of LAGGING) {
      for (const w of s.walls) {
        const inward = Math.sign((s.walls[0] + s.walls[1]) / 2 - w);
        for (let a = s.from; a <= s.to; a += spacing) {
          const offset = w + inward * (LOG_INSET + (rand() - 0.5) * 0.05);
          logs.push({
            x: s.axis === 'z' ? offset : a,
            z: s.axis === 'z' ? a : offset,
            h: H - 0.75 - rand() * 0.35,
            r: 0.11 + rand() * 0.04,
            tilt: (rand() - 0.5) * 0.04,
            spin: rand() * Math.PI * 2,
          });
        }
      }
    }

    const mesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 8), mat, logs.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    logs.forEach((l, i) => {
      q.setFromEuler(new THREE.Euler(l.tilt, l.spin, l.tilt * 0.5));
      m.compose(new THREE.Vector3(l.x, l.h / 2, l.z), q, new THREE.Vector3(l.r, l.h, l.r));
      mesh.setMatrixAt(i, m);
    });
    this.group.add(mesh);
  }

  // Loose stones collect along the foot of the walls.
  buildRubble() {
    const { layout } = this;
    const rand = mulberry32(5);
    const spots = [];
    for (let iz = 0; iz < layout.rows; iz++) {
      for (let ix = 0; ix < layout.cols; ix++) {
        if (layout.clearance[iz * layout.cols + ix] !== 1) continue;
        const c = layout.cellCenter(ix, iz);
        for (let k = 0; k < 2; k++) {
          if (rand() >= 0.55) continue;
          const p = { x: c.x + (rand() - 0.5) * 0.9, z: c.z + (rand() - 0.5) * 0.9 };
          // Keep the floor clear around sensor units so probes and brackets stay visible.
          if (SENSOR_NODES.some((n) => Math.hypot(n.x - p.x, n.z - p.z) < 1)) continue;
          spots.push(p);
        }
      }
    }

    const mat = new THREE.MeshStandardMaterial({
      map: this.rock.map, normalMap: this.rock.normalMap, roughness: 0.95, flatShading: true, color: 0xbfb5a8,
    });
    const mesh = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), mat, spots.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    spots.forEach((p, i) => {
      const s = 0.05 + Math.pow(rand(), 2.5) * 0.28;
      q.setFromEuler(new THREE.Euler(rand() * 6, rand() * 6, rand() * 6));
      m.compose(new THREE.Vector3(p.x, s * 0.5, p.z), q, new THREE.Vector3(s, s * (0.6 + rand() * 0.4), s));
      mesh.setMatrixAt(i, m);
    });
    this.group.add(mesh);
  }

  buildRails() {
    const steel = new THREE.MeshStandardMaterial({ color: 0x8a847a, metalness: 0.85, roughness: 0.35 });
    const wood = this.woodMaterial();
    const runs = [
      { x: 0, zStart: 4, zEnd: -88 },
      { x: 20, zStart: -4, zEnd: -58 },
    ];

    for (const run of runs) {
      const length = run.zStart - run.zEnd;
      const midZ = (run.zStart + run.zEnd) / 2;
      for (const side of [-0.55, 0.55]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.1, length), steel);
        rail.position.set(run.x + side, 0.13, midZ);
        this.group.add(rail);
      }
      const count = Math.floor(length / 0.9);
      const sleepers = new THREE.InstancedMesh(new THREE.BoxGeometry(1.5, 0.08, 0.22), wood, count);
      const m = new THREE.Matrix4();
      for (let i = 0; i < count; i++) {
        m.makeTranslation(run.x, 0.06, run.zStart - i * 0.9);
        sleepers.setMatrixAt(i, m);
      }
      this.group.add(sleepers);
    }
  }

  buildLampFixtures() {
    const cableMat = new THREE.MeshBasicMaterial({ color: 0x111111 });
    const cageMat = new THREE.MeshStandardMaterial({ color: 0x2a2a26, metalness: 0.6, roughness: 0.5, wireframe: true });
    const halo = haloTexture();

    for (const pos of LAMP_POSITIONS) {
      const y = H - 0.75;
      const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.7), cableMat);
      cable.position.set(pos.x, H - 0.35, pos.z);

      const bulbMat = new THREE.MeshStandardMaterial({ color: 0xffd9a0, emissive: 0xffb866, emissiveIntensity: 2.2 });
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 8), bulbMat);
      bulb.position.set(pos.x, y, pos.z);

      const cage = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.28, 8, 1, true), cageMat);
      cage.position.copy(bulb.position);

      // A soft additive glow sells the lamp as a light source at a distance.
      const haloMat = new THREE.SpriteMaterial({ map: halo, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.6 });
      const glow = new THREE.Sprite(haloMat);
      glow.scale.setScalar(1.6);
      glow.position.copy(bulb.position);

      this.group.add(cable, bulb, cage, glow);
      this.lamps.push({ x: pos.x, y, z: pos.z, bulbMat, haloMat });
    }
  }

  buildSigns() {
    const signs = [
      { lines: ['JUNCTION A', 'SAFE ZONE · REFUGE'], accent: '#77d46d', x: 0, z: -64.5, rotY: 0 },
      { lines: ['TUNNEL B', 'SENSORS G-11 → G-14'], accent: '#d8d36c', x: 20, z: -61.5, rotY: 0 },
      { lines: ['ENTRY A', 'SURFACE ACCESS'], accent: '#77d46d', x: 5.5, z: 0, rotY: -Math.PI / 2 },
      { lines: ['CHAMBER', 'EXIT VIA BYPASS ←'], accent: '#d8d36c', x: 25.5, z: -10, rotY: -Math.PI / 2 },
      { lines: ['BYPASS', 'TO ENTRY A'], accent: '#77d46d', x: 14.5, z: -9, rotY: Math.PI / 2 },
    ];

    for (const s of signs) {
      const mat = new THREE.MeshStandardMaterial({
        map: makeSignTexture(s.lines, s.accent), emissive: 0xffffff, emissiveIntensity: 0.18, roughness: 0.6,
      });
      mat.emissiveMap = mat.map;
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.56), mat);
      sign.position.set(s.x, 2.6, s.z);
      sign.rotation.y = s.rotY;
      this.group.add(sign);
    }
  }

  buildProps() {
    const metal = new THREE.MeshStandardMaterial({ color: 0x5a4a33, metalness: 0.5, roughness: 0.6 });
    const crateMat = new THREE.MeshStandardMaterial({ map: this.wood.map, normalMap: this.wood.normalMap, color: 0xcdb391, roughness: 0.9 });
    const barrelMat = new THREE.MeshStandardMaterial({ color: 0x8a2e1e, metalness: 0.3, roughness: 0.55 });

    const cart = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.7, 1.6), metal);
    body.position.y = 0.65;
    cart.add(body);
    for (const [wx, wz] of [[-0.5, -0.55], [0.5, -0.55], [-0.5, 0.55], [0.5, 0.55]]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.08, 12), metal);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(wx, 0.24, wz);
      cart.add(wheel);
    }
    cart.position.set(0, 0, -12);
    this.group.add(cart);

    const rand = mulberry32(21);
    const crates = [[23.5, -4.5], [24.3, -5.6], [15.8, -12], [-4.5, 4.2], [3.8, -63.5]];
    for (const [x, z] of crates) {
      const size = 0.6 + rand() * 0.3;
      const crate = new THREE.Mesh(new THREE.BoxGeometry(size, size, size), crateMat);
      crate.position.set(x, size / 2, z);
      crate.rotation.y = rand() * Math.PI;
      this.group.add(crate);
    }
    for (const [x, z] of [[15.2, -3.2], [15.9, -3.0], [-4.9, -4.8]]) {
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.9, 14), barrelMat);
      barrel.position.set(x, 0.45, z);
      this.group.add(barrel);
    }
  }
}
