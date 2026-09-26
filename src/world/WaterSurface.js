import * as THREE from 'three';
import { valueNoise3 } from '../utils/noise.js';

const REFRESH = 0.2;
const MIN_DEPTH = 0.04;

// Tileable ripple normal map derived from a noise height field.
function rippleNormalMap(size = 128) {
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      h[y * size + x] = valueNoise3(u * 8, v * 8, 0, 8) * 0.6 + valueNoise3(u * 16, v * 16, 5, 16) * 0.4;
    }
  }
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  const at = (x, y) => h[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * 2.5;
      const dy = (at(x, y + 1) - at(x, y - 1)) * 2.5;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      img.data[i] = ((-dx / len) * 0.5 + 0.5) * 255;
      img.data[i + 1] = ((-dy / len) * 0.5 + 0.5) * 255;
      img.data[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

export class WaterSurface {
  constructor(scene, layout, hazard) {
    this.layout = layout;
    this.hazard = hazard;
    this.timer = REFRESH;

    this.cells = [];
    for (let iz = 0; iz < layout.rows; iz++) {
      for (let ix = 0; ix < layout.cols; ix++) {
        if (layout.isWalkableCell(ix, iz)) this.cells.push(layout.cellCenter(ix, iz));
      }
    }

    const geo = new THREE.PlaneGeometry(1.02, 1.02);
    geo.rotateX(-Math.PI / 2);
    this.normalMap = rippleNormalMap();
    this.normalMap.repeat.set(1, 1);
    this.mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({
      color: 0x1b3940,
      roughness: 0.06,
      metalness: 0.3,
      transparent: true,
      opacity: 0.84,
      normalMap: this.normalMap,
      normalScale: new THREE.Vector2(0.35, 0.35),
    }), this.cells.length);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.matrix = new THREE.Matrix4();
  }

  update(dt) {
    this.normalMap.offset.x += dt * 0.03;
    this.normalMap.offset.y += dt * 0.017;

    this.timer += dt;
    if (this.timer < REFRESH) return;
    this.timer = 0;

    if (!this.hazard.incidents.some((i) => i.type === 'water')) {
      this.mesh.count = 0;
      return;
    }

    let count = 0;
    for (const c of this.cells) {
      const depth = this.hazard.waterDepthAt(c.x, c.z);
      if (depth < MIN_DEPTH) continue;
      this.matrix.makeTranslation(c.x, depth, c.z);
      this.mesh.setMatrixAt(count++, this.matrix);
    }
    this.mesh.count = count;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

export default WaterSurface;
