import * as THREE from 'three';
import { valueNoise3 } from '../utils/noise.js';

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const smooth = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// Tileable noise: lattice wraps at `f`, so u,v in [0,1) repeat seamlessly.
const tn = (u, v, f, seed) => valueNoise3(u * f, v * f, seed, f);
function tfbm(u, v, f, octaves, seed) {
  let sum = 0, amp = 0.5, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * tn(u, v, f, seed + o * 13.1);
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  return sum / norm;
}

// `fn(u, v)` returns [[r, g, b], height]. Produces an sRGB colour map and a matching tangent-space normal map.
function bake(size, fn, normalStrength, { tile = true } = {}) {
  const color = document.createElement('canvas');
  color.width = color.height = size;
  const cctx = color.getContext('2d');
  const cimg = cctx.createImageData(size, size);
  const height = new Float32Array(size * size);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [c, h] = fn(x / size, y / size);
      const i = (y * size + x) * 4;
      cimg.data[i] = Math.min(255, c[0]);
      cimg.data[i + 1] = Math.min(255, c[1]);
      cimg.data[i + 2] = Math.min(255, c[2]);
      cimg.data[i + 3] = 255;
      height[y * size + x] = h;
    }
  }
  cctx.putImageData(cimg, 0, 0);

  const normal = document.createElement('canvas');
  normal.width = normal.height = size;
  const nctx = normal.getContext('2d');
  const nimg = nctx.createImageData(size, size);
  const at = tile
    ? (x, y) => height[((y + size) % size) * size + ((x + size) % size)]
    : (x, y) => height[Math.min(size - 1, Math.max(0, y)) * size + Math.min(size - 1, Math.max(0, x))];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * normalStrength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * normalStrength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      nimg.data[i] = (-dx / len * 0.5 + 0.5) * 255;
      nimg.data[i + 1] = (dy / len * 0.5 + 0.5) * 255;
      nimg.data[i + 2] = (1 / len * 0.5 + 0.5) * 255;
      nimg.data[i + 3] = 255;
    }
  }
  nctx.putImageData(nimg, 0, 0);

  const map = new THREE.CanvasTexture(color);
  map.colorSpace = THREE.SRGBColorSpace;
  const normalMap = new THREE.CanvasTexture(normal);
  for (const t of [map, normalMap]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
  }
  return { map, normalMap };
}

function hash2(ix, iy, seed) {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(seed, 1440662683);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

// Tileable cellular noise with separate x/y periods: F1/F2 distances plus a per-cell id.
function worley(u, v, nx, ny, seed) {
  const x = u * nx, y = v * ny;
  const cx = Math.floor(x), cy = Math.floor(y);
  let f1 = 9, f2 = 9, id = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const gx = cx + dx, gy = cy + dy;
      const wx = ((gx % nx) + nx) % nx, wy = ((gy % ny) + ny) % ny;
      const d = Math.hypot(gx + hash2(wx, wy, seed) - x, gy + hash2(wx, wy, seed + 1) - y);
      if (d < f1) {
        f2 = f1;
        f1 = d;
        id = hash2(wx, wy, seed + 2);
      } else if (d < f2) {
        f2 = d;
      }
    }
  }
  return { f1, f2, id };
}

// Fractured sedimentary rock: wide bedding slabs whose joints only show in places, mottled
// grey/brown surface, fine grit and iron staining.
export function rockTextures(size = 512) {
  const DARK = [44, 41, 38], LIGHT = [134, 127, 116], BROWN = [112, 92, 72], GREY = [108, 108, 106], RUST = [120, 86, 58];
  return bake(size, (u, v) => {
    const wu = (tfbm(u, v, 4, 2, 11) - 0.5) * 0.1;
    const wv = (tfbm(u, v, 4, 2, 17) - 0.5) * 0.06;
    const slab = worley(u + wu, v + wv, 3, 9, 3);
    const joint = 1 - smooth(0, 0.16, slab.f2 - slab.f1);
    // Most joints are tight; only where this mask is high do they open into visible cracks.
    const fracture = joint * smooth(0.5, 0.72, tfbm(u, v, 4, 2, 44));
    const detail = tfbm(u, v, 12, 4, 20);
    const mottle = tfbm(u, v, 2, 3, 5);
    const grit = tfbm(u, v, 48, 2, 61);

    const h = 0.4 * detail + 0.22 * mottle + 0.14 * (1 - slab.f1) + 0.1 * grit - 0.4 * fracture;
    let c = mix3(DARK, LIGHT, clamp01(0.12 + 0.85 * (0.5 * detail + 0.35 * mottle + 0.15 * grit)));
    c = mix3(c, BROWN, slab.id * 0.32);
    c = mix3(c, GREY, (1 - slab.id) * 0.2);
    c = mix3(c, RUST, smooth(0.62, 0.78, tfbm(u, v, 3, 3, 80)) * 0.4);
    const shade = 1 - 0.42 * fracture;
    return [c.map((x) => x * shade), h];
  }, 5);
}

// Packed dirt with gravel, pebbles and damp patches.
export function floorTextures(size = 512) {
  const DIRT_DARK = [52, 42, 33], DIRT_LIGHT = [108, 92, 72], STONE = [142, 132, 116];
  return bake(size, (u, v) => {
    const base = tfbm(u, v, 6, 4, 3);
    const pebble = smooth(0.78, 0.86, tn(u, v, 40, 5));
    const gravel = smooth(0.66, 0.74, tn(u, v, 110, 6)) * 0.45;
    const damp = smooth(0.58, 0.75, tfbm(u, v, 3, 2, 9));
    let c = mix3(DIRT_DARK, DIRT_LIGHT, 0.25 + base * 0.6);
    c = mix3(c, STONE, Math.max(pebble, gravel) * 0.8);
    c = c.map((x) => x * (1 - damp * 0.18));
    return [c, base * 0.35 + pebble * 0.55 + gravel * 0.2];
  }, 3);
}

// Sawn timber for posts, caps and sleepers: long grain streaks and the odd knot.
export function woodTextures(size = 256) {
  const DARK = [66, 44, 28], LIGHT = [128, 92, 60];
  return bake(size, (u, v) => {
    const grain = valueNoise3(u * 4, v * 70, 1) * 0.6 + valueNoise3(u * 9, v * 140, 2) * 0.4;
    const knot = smooth(0.8, 0.95, valueNoise3(u * 3, v * 5, 3));
    const t = clamp01(grain * 0.9 + 0.1 - knot * 0.5);
    return [mix3(DARK, LIGHT, t), grain - knot];
  }, 2, { tile: false });
}

// Rough bark for the round-log wall lagging.
export function barkTextures(size = 256) {
  const DARK = [40, 29, 20], LIGHT = [104, 78, 54];
  return bake(size, (u, v) => {
    const grooves = 1 - Math.abs(tn(u, v * 0.25, 24, 4) * 2 - 1);
    const flakes = tfbm(u, v, 12, 3, 8);
    const h = grooves * 0.6 + flakes * 0.4;
    return [mix3(DARK, LIGHT, clamp01(h * 1.1 - 0.05)), h];
  }, 4);
}

export function haloTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,236,200,1)');
  g.addColorStop(0.15, 'rgba(255,200,130,0.55)');
  g.addColorStop(0.5, 'rgba(255,170,90,0.12)');
  g.addColorStop(1, 'rgba(255,170,90,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
