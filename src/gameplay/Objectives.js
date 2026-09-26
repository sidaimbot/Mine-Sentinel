const ARRIVAL_RADIUS = 3;
const SAFE_AIR_SECONDS = 3;

export class Objectives {
  constructor(layout, hazard, state, ai) {
    this.layout = layout;
    this.hazard = hazard;
    this.state = state;
    this.ai = ai;

    this.decision = null;
    this.target = ai.recommended.target;
    this.route = [];
    this.distance = Infinity;
    this.routeKey = '';
    this.recommendationRef = null;
    this.lastPos = null;
    this.inHazard = false;
    this.resetEvacuation();

    state.subscribe('ai:decision', (d) => {
      this.decision = d;
      if (this.complete && d.target && d.target.label !== this.target.label) this.resetEvacuation();
      if (d.response === 'EVACUATE' && !this.evacuating && !this.complete) {
        this.evacuating = true;
        this.evacZone = (this.lastPos && ai.zoneAt(this.lastPos.x, this.lastPos.z)) ?? d.zone;
        state.emit('objective:started', { target: d.target });
      }
    });
    state.subscribe('ai:cleared', () => {
      this.decision = null;
      if (this.evacuating || this.complete) state.emit('objective:stood-down');
      this.resetEvacuation();
    });
  }

  resetEvacuation() {
    this.evacuating = false;
    this.complete = false;
    this.evacZone = null;
    this.safeAirTimer = 0;
    this.steps = [{ id: 'leave', done: false }, { id: 'reach', done: false }, { id: 'confirm', done: false }];
  }

  get currentStep() {
    return this.steps.findIndex((s) => !s.done);
  }

  replan(playerPos) {
    const rec = this.ai.recommended;
    const plan = rec.field ? this.layout.planRoute(playerPos, rec.field) : null;
    this.route = plan?.points ?? [];
    this.distance = plan ? Math.round(plan.length) : Infinity;

    if (rec.target.label !== this.target.label) {
      const previous = this.target;
      this.target = rec.target;
      if (this.evacuating) {
        this.steps[1].done = false;
        this.steps[2].done = false;
        this.safeAirTimer = 0;
        this.state.emit('objective:updated', { from: previous, to: rec.target, via: rec.via });
      }
    }
  }

  update(dt, playerPos) {
    this.lastPos = playerPos;
    const cell = this.layout.worldToCell(playerPos.x, playerPos.z);
    const key = `${cell.ix},${cell.iz}`;
    if (key !== this.routeKey || this.ai.recommended !== this.recommendationRef) {
      this.routeKey = key;
      this.recommendationRef = this.ai.recommended;
      this.replan(playerPos);
    }

    const inHazard = this.hazard.dangerAt(playerPos.x, playerPos.z) >= 1;
    if (inHazard !== this.inHazard) {
      this.inHazard = inHazard;
      this.state.emit('player:hazardZone', { inHazard });
    }

    if (!this.evacuating || this.complete) return;

    const complete = (index) => {
      this.steps[index].done = true;
      this.state.emit('objective:step', { index, target: this.target });
    };

    const step = this.currentStep;
    if (step === 0 && !inHazard) complete(0);
    else if (step === 1 && this.distance <= ARRIVAL_RADIUS) complete(1);
    else if (step === 2) {
      const safe = this.distance <= ARRIVAL_RADIUS * 2 && this.hazard.dangerAt(playerPos.x, playerPos.z) < 0.5;
      this.safeAirTimer = safe ? this.safeAirTimer + dt : 0;
      if (this.safeAirTimer >= SAFE_AIR_SECONDS) {
        complete(2);
        this.complete = true;
        this.evacuating = false;
        this.state.emit('objective:complete', { target: this.target });
      }
    }
  }
}

export default Objectives;
