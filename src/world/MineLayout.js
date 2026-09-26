// World axes: +x = east, -z = north. One grid cell = 1 m.

export const TUNNEL_HEIGHT = 4.2;

const BOUNDS = { minX: -10, maxX: 30, minZ: -95, maxZ: 10 };

const RECTS = [
  { id: 'entry', x0: -6, x1: 6, z0: -6, z1: 6 },
  { id: 'main-shaft', x0: -2, x1: 2, z0: -90, z1: -6 },
  { id: 'junction-a', x0: -5, x1: 5, z0: -65, z1: -55 },
  // Overlaps the main shaft; exists only so zone naming can tell the drift apart.
  { id: 'north-drift', x0: -2, x1: 2, z0: -90, z1: -65 },
  { id: 'cross-drift', x0: 5, x1: 22, z0: -62, z1: -58 },
  { id: 'tunnel-b', x0: 18, x1: 22, z0: -62, z1: -14 },
  { id: 'chamber', x0: 14, x1: 26, z0: -14, z1: -2 },
  // Ventilation bypass closes the loop Entry A ↔ Chamber, giving every scenario two ways out.
  { id: 'bypass', x0: 6, x1: 14, z0: -6, z1: -2 },
];

export const LOCATIONS = {
  ENTRY_A: { x: 0, z: 0, label: 'ENTRY A' },
  JUNCTION_A: { x: 0, z: -60, label: 'JUNCTION A' },
  TUNNEL_B: { x: 20, z: -38, label: 'TUNNEL B' },
  CHAMBER: { x: 20, z: -8, label: 'CHAMBER' },
  NORTH_DRIFT: { x: 0, z: -86, label: 'NORTH DRIFT' },
  BYPASS: { x: 10, z: -4, label: 'BYPASS' },
};

// Preset spots the operator can drop incidents on (sim console location picker).
export const INCIDENT_LOCATIONS = [
  { id: 'tunnel-b', label: 'TUNNEL B', x: 20, z: -30 },
  { id: 'chamber', label: 'CHAMBER', x: 20, z: -8 },
  { id: 'cross-drift', label: 'CROSS DRIFT', x: 12, z: -60 },
  { id: 'junction-a', label: 'JUNCTION A', x: 0, z: -60 },
  { id: 'north-drift', label: 'NORTH DRIFT', x: 0, z: -86 },
  { id: 'main-shaft', label: 'MAIN SHAFT', x: 0, z: -32 },
  { id: 'bypass', label: 'BYPASS', x: 10, z: -4 },
  { id: 'entry-a', label: 'ENTRY A', x: 0, z: 1 },
];

const NEIGHBOURS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

class MinHeap {
  constructor() { this.items = []; }
  get size() { return this.items.length; }
  push(idx, cost) {
    const a = this.items;
    a.push([idx, cost]);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p][1] <= a[i][1]) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.items;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l][1] < a[m][1]) m = l;
        if (r < a.length && a[r][1] < a[m][1]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

// Mounting: "air" units are bolted to the front face of a timber arch's cap beam at its midpoint (methane collects high),
// or from a roof rod in open chambers with no arch; "floor" units sit on the wall just above the floor
// with a water probe. Floor units alternate walls, giving the zig-zag between roof and floor.
export const MOUNT_HEIGHT = { air: 3.5, floor: 0.34 };

// `nx`/`nz`: the direction the unit faces (floor units: the wall normal into the tunnel;
// hanging air units: along the tunnel axis). `hang`: 'arch' under a cap beam, 'roof' on a ceiling rod.
export const SENSOR_NODES = [
  { id: 'G-01', x: -3, z: 1.5, nx: 0, nz: 1, mount: 'air', hang: 'roof', zone: 'ENTRY A' },
  { id: 'G-02', x: 1.58, z: -12.5, nx: -1, nz: 0, mount: 'floor', zone: 'MAIN SHAFT' },
  { id: 'G-03', x: 0, z: -29.74, nx: 0, nz: 1, mount: 'air', hang: 'arch', zone: 'MAIN SHAFT' },
  { id: 'G-04', x: 1.58, z: -37.5, nx: -1, nz: 0, mount: 'floor', zone: 'MAIN SHAFT' },
  { id: 'G-05', x: 0, z: -44.74, nx: 0, nz: 1, mount: 'air', hang: 'arch', zone: 'MAIN SHAFT' },
  { id: 'G-06', x: 4.6, z: -63.5, nx: -1, nz: 0, mount: 'floor', zone: 'JUNCTION A' },
  { id: 'G-07', x: 0, z: -79.74, nx: 0, nz: 1, mount: 'air', hang: 'arch', zone: 'NORTH DRIFT' },
  { id: 'G-08', x: 1.6, z: -82.5, nx: -1, nz: 0, mount: 'floor', zone: 'NORTH DRIFT' },
  { id: 'G-09', x: 6.74, z: -60, nx: -1, nz: 0, mount: 'air', hang: 'arch', zone: 'CROSS DRIFT' },
  { id: 'G-10', x: 14.5, z: -58.4, nx: 0, nz: -1, mount: 'floor', zone: 'CROSS DRIFT' },
  { id: 'G-11', x: 20, z: -47.74, nx: 0, nz: 1, mount: 'air', hang: 'arch', zone: 'TUNNEL B' },
  { id: 'G-12', x: 18.42, z: -40.5, nx: 1, nz: 0, mount: 'floor', zone: 'TUNNEL B' },
  { id: 'G-13', x: 20, z: -27.74, nx: 0, nz: 1, mount: 'air', hang: 'arch', zone: 'TUNNEL B' },
  { id: 'G-14', x: 18.42, z: -20.5, nx: 1, nz: 0, mount: 'floor', zone: 'TUNNEL B' },
  { id: 'G-15', x: 23, z: -10, nx: 0, nz: 1, mount: 'air', hang: 'roof', zone: 'CHAMBER' },
  { id: 'G-16', x: 10, z: -5.58, nx: 0, nz: 1, mount: 'floor', zone: 'BYPASS' },
];

// Signal cable runs, in the direction data flows toward the G-01 gateway at Entry A.
export const SENSOR_CHAINS = [
  ['G-08', 'G-07', 'G-06', 'G-05', 'G-04', 'G-03', 'G-02', 'G-01'],
  ['G-09', 'G-10', 'G-11', 'G-12', 'G-13', 'G-14', 'G-15', 'G-16', 'G-01'],
];

export class MineLayout {
  constructor() {
    this.bounds = BOUNDS;
    this.rects = RECTS;
    this.cols = BOUNDS.maxX - BOUNDS.minX;
    this.rows = BOUNDS.maxZ - BOUNDS.minZ;
    this.walkable = new Uint8Array(this.cols * this.rows);
    this.fieldCache = new Map();

    for (let iz = 0; iz < this.rows; iz++) {
      for (let ix = 0; ix < this.cols; ix++) {
        const { x, z } = this.cellCenter(ix, iz);
        const inside = RECTS.some((r) => x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1);
        this.walkable[iz * this.cols + ix] = inside ? 1 : 0;
      }
    }
    this.clearance = this.computeClearance();
  }

  // Cells-to-nearest-wall for every walkable cell (multi-source BFS seeded from wall-adjacent cells).
  computeClearance() {
    const clearance = new Int32Array(this.cols * this.rows).fill(-1);
    const queue = [];
    for (let iz = 0; iz < this.rows; iz++) {
      for (let ix = 0; ix < this.cols; ix++) {
        if (!this.isWalkableCell(ix, iz)) continue;
        const nearWall = NEIGHBOURS.some(([dx, dz]) => !this.isWalkableCell(ix + dx, iz + dz));
        if (nearWall) {
          clearance[iz * this.cols + ix] = 1;
          queue.push(iz * this.cols + ix);
        }
      }
    }
    for (let head = 0; head < queue.length; head++) {
      const idx = queue[head];
      const ix = idx % this.cols, iz = (idx - ix) / this.cols;
      for (const [dx, dz] of NEIGHBOURS) {
        const nx = ix + dx, nz = iz + dz;
        if (!this.isWalkableCell(nx, nz) || clearance[nz * this.cols + nx] !== -1) continue;
        clearance[nz * this.cols + nx] = clearance[idx] + 1;
        queue.push(nz * this.cols + nx);
      }
    }
    return clearance;
  }

  cellCenter(ix, iz) {
    return { x: this.bounds.minX + ix + 0.5, z: this.bounds.minZ + iz + 0.5 };
  }

  worldToCell(x, z) {
    return { ix: Math.floor(x - this.bounds.minX), iz: Math.floor(z - this.bounds.minZ) };
  }

  isWalkableCell(ix, iz) {
    if (ix < 0 || iz < 0 || ix >= this.cols || iz >= this.rows) return false;
    return this.walkable[iz * this.cols + ix] === 1;
  }

  isWalkable(x, z) {
    const { ix, iz } = this.worldToCell(x, z);
    return this.isWalkableCell(ix, iz);
  }

  canOccupy(x, z, radius) {
    return (
      this.isWalkable(x - radius, z - radius) &&
      this.isWalkable(x + radius, z - radius) &&
      this.isWalkable(x - radius, z + radius) &&
      this.isWalkable(x + radius, z + radius)
    );
  }

  // BFS distance (in cells) from a target through walkable cells only. Cached per target.
  distanceField(target) {
    const key = `${target.x},${target.z}`;
    if (this.fieldCache.has(key)) return this.fieldCache.get(key);

    const field = new Int32Array(this.cols * this.rows).fill(-1);
    const start = this.worldToCell(target.x, target.z);
    const queue = [start.iz * this.cols + start.ix];
    field[queue[0]] = 0;

    for (let head = 0; head < queue.length; head++) {
      const idx = queue[head];
      const ix = idx % this.cols;
      const iz = (idx - ix) / this.cols;
      for (const [dx, dz] of NEIGHBOURS) {
        const nx = ix + dx, nz = iz + dz;
        if (!this.isWalkableCell(nx, nz)) continue;
        const nIdx = nz * this.cols + nx;
        if (field[nIdx] !== -1) continue;
        field[nIdx] = field[idx] + 1;
        queue.push(nIdx);
      }
    }

    this.fieldCache.set(key, field);
    return field;
  }

  pathDistance(from, target) {
    const field = this.distanceField(target);
    const { ix, iz } = this.worldToCell(from.x, from.z);
    if (!this.isWalkableCell(ix, iz)) return Infinity;
    const d = field[iz * this.cols + ix];
    return d < 0 ? Infinity : d;
  }

  // Dijkstra cost-to-go from `target`. `extraCost(x, z)` lets callers penalise gas, instability, etc.
  costField(target, extraCost = () => 0) {
    const field = new Float64Array(this.cols * this.rows).fill(Infinity);
    const start = this.worldToCell(target.x, target.z);
    if (!this.isWalkableCell(start.ix, start.iz)) return field;

    const heap = new MinHeap();
    const startIdx = start.iz * this.cols + start.ix;
    field[startIdx] = 0;
    heap.push(startIdx, 0);

    while (heap.size) {
      const [idx, cost] = heap.pop();
      if (cost > field[idx]) continue;
      const ix = idx % this.cols, iz = (idx - ix) / this.cols;
      for (const [dx, dz] of NEIGHBOURS) {
        const nx = ix + dx, nz = iz + dz;
        if (!this.isWalkableCell(nx, nz)) continue;
        const nIdx = nz * this.cols + nx;
        const c = this.cellCenter(nx, nz);
        const step = 1 + (this.clearance[nIdx] === 1 ? 0.35 : 0) + extraCost(c.x, c.z);
        if (cost + step < field[nIdx]) {
          field[nIdx] = cost + step;
          heap.push(nIdx, cost + step);
        }
      }
    }
    return field;
  }

  // Descends a cost field from `from`; returns smoothed waypoints, metres and total cost, or null if unreachable.
  planRoute(from, field) {
    let { ix, iz } = this.worldToCell(from.x, from.z);
    if (!this.isWalkableCell(ix, iz)) return null;
    const cost = field[iz * this.cols + ix];
    if (!Number.isFinite(cost)) return null;

    const points = [{ x: from.x, z: from.z }];
    let c = cost;
    while (c > 0) {
      let best = null;
      for (const [dx, dz] of NEIGHBOURS) {
        const nx = ix + dx, nz = iz + dz;
        if (!this.isWalkableCell(nx, nz)) continue;
        const nc = field[nz * this.cols + nx];
        if (nc < c && (!best || nc < best[2])) best = [nx, nz, nc];
      }
      if (!best) break;
      [ix, iz, c] = best;
      points.push(this.cellCenter(ix, iz));
    }

    const smoothed = this.smoothRoute(points);
    let length = 0;
    for (let i = 1; i < smoothed.length; i++) {
      length += Math.hypot(smoothed[i].x - smoothed[i - 1].x, smoothed[i].z - smoothed[i - 1].z);
    }
    return { points: smoothed, length, cost };
  }

  hasClearLine(a, b, clearance) {
    const steps = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.25);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (!this.canOccupy(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t, clearance)) return false;
    }
    return true;
  }

  // Grid BFS paths staircase along walls; string-pulling keeps only the waypoints needed to round corners.
  smoothRoute(points, clearance = 0.8) {
    if (points.length < 3) return points;
    const out = [points[0]];
    let i = 0;
    while (i < points.length - 1) {
      let j = points.length - 1;
      while (j > i + 1 && !this.hasClearLine(points[i], points[j], clearance)) j--;
      out.push(points[j]);
      i = j;
    }
    return out;
  }
}
