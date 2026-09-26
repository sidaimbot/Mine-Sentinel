import { tweenNumber } from '../effects.js';

const $ = (id) => document.getElementById(id);
const titleCase = (s) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

export class EvacPanel {
  constructor() {
    this.lastKey = '';
  }

  render(objectives) {
    const { target, distance, evacuating, complete, steps, currentStep, evacZone } = objectives;
    const targetName = titleCase(target.label);
    const mode = complete ? 'complete' : evacuating ? 'active' : 'standby';

    tweenNumber($('evacDistance'), Number.isFinite(distance) ? distance : 0, (n) => Math.round(n), 250);

    const key = `${mode}|${targetName}|${currentStep}|${evacZone ?? ''}`;
    if (key === this.lastKey) return;
    this.lastKey = key;

    const badge = $('evacBadge');
    badge.textContent = { standby: 'Standby', active: 'Active', complete: 'Safe' }[mode];
    badge.className = `pill ${mode === 'active' ? 'warn blinking' : mode === 'complete' ? 'ok' : ''}`;

    $('evacTitle').textContent = {
      standby: 'Route on standby',
      active: `Evacuate ${titleCase(evacZone ?? 'zone')}`,
      complete: 'Personnel safe',
    }[mode];
    $('evacTarget').textContent = `${targetName}${mode === 'standby' ? ' · nearest safe zone' : ''}`;

    const labels = ['Leave the hazard area', 'Follow the marked route', `Confirm safe air at ${targetName}`];
    steps.forEach((step, i) => {
      const li = $(`step${i + 1}`);
      li.querySelector('.step-text').textContent = labels[i];
      li.className = step.done ? 'done' : mode === 'active' && i === currentStep ? 'current' : '';
    });
  }
}

export default EvacPanel;
