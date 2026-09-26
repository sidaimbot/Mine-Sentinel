import * as THREE from 'three';

const MAX_CHEVRONS = 60;
const SPACING = 1.3;
const START_OFFSET = 1.6;
const LOOKAHEAD = 1.6;
const BASE_COLOR = new THREE.Color(0xe9c44c);

function chevronGeometry() {
  const shape = new THREE.Shape();
  shape.moveTo(0.05, 0.3);
  shape.lineTo(0.4, 0);
  shape.lineTo(0.05, -0.3);
  shape.lineTo(-0.12, -0.3);
  shape.lineTo(0.22, 0);
  shape.lineTo(-0.12, 0.3);
  shape.closePath();
  const geo = new THREE.ShapeGeometry(shape);
  geo.rotateX(-Math.PI / 2);
  return geo;
}

// Resamples a polyline at fixed arc-length intervals.
function pointAt(route, lengths, s) {
  let i = 1;
  while (i < lengths.length - 1 && lengths[i] < s) i++;
  const a = route[i - 1], b = route[i];
  const seg = lengths[i] - lengths[i - 1] || 1;
  const t = Math.min(1, Math.max(0, (s - lengths[i - 1]) / seg));
  return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
}

export class RouteGuide {
  constructor(scene) {
    this.mesh = new THREE.InstancedMesh(
      chevronGeometry(),
      new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0.95,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
        side: THREE.DoubleSide,
      }),
      MAX_CHEVRONS
    );
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    for (let i = 0; i < MAX_CHEVRONS; i++) this.mesh.setColorAt(i, BASE_COLOR);
    scene.add(this.mesh);

    this.time = 0;
    this.routeRef = null;
    this.matrix = new THREE.Matrix4();
    this.quat = new THREE.Quaternion();
    this.color = new THREE.Color();
    this.up = new THREE.Vector3(0, 1, 0);
  }

  layout(route) {
    const lengths = [0];
    for (let i = 1; i < route.length; i++) {
      lengths.push(lengths[i - 1] + Math.hypot(route[i].x - route[i - 1].x, route[i].z - route[i - 1].z));
    }
    const total = lengths[lengths.length - 1];

    let count = 0;
    for (let s = START_OFFSET; s < total - 0.5 && count < MAX_CHEVRONS; s += SPACING) {
      const p = pointAt(route, lengths, s);
      const q = pointAt(route, lengths, Math.min(total, s + LOOKAHEAD));
      const angle = Math.atan2(-(q.z - p.z), q.x - p.x);
      this.quat.setFromAxisAngle(this.up, angle);
      this.matrix.compose(new THREE.Vector3(p.x, 0.2, p.z), this.quat, new THREE.Vector3(1, 1, 1));
      this.mesh.setMatrixAt(count++, this.matrix);
    }
    this.mesh.count = count;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  update(dt, route, active) {
    this.time += dt;
    this.mesh.visible = active && route.length > 1;
    if (!this.mesh.visible) return;

    if (route !== this.routeRef) {
      this.routeRef = route;
      this.layout(route);
    }

    // A bright band travels along the trail toward the safe zone.
    for (let i = 0; i < this.mesh.count; i++) {
      const wave = Math.pow(Math.max(0, Math.cos(i * 0.45 - this.time * 5)), 6);
      const fadeIn = Math.min(1, (i + 1) / 3);
      this.color.copy(BASE_COLOR).multiplyScalar((0.18 + 0.9 * wave) * fadeIn);
      this.mesh.setColorAt(i, this.color);
    }
    this.mesh.instanceColor.needsUpdate = true;
  }
}

export default RouteGuide;
