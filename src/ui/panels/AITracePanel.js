import { typeText } from '../effects.js';

export class AITracePanel {
  constructor(list) {
    this.list = list;
    this.items = [];
  }

  render(lines) {
    while (this.items.length < lines.length) {
      const li = document.createElement('li');
      this.list.appendChild(li);
      this.items.push(li);
    }
    while (this.items.length > lines.length) this.items.pop().remove();

    // Stagger so lines appear to be written in sequence by the AI.
    lines.forEach((line, i) => typeText(this.items[i], line, { cps: 90, delay: i * 250 }));
  }
}

export default AITracePanel;
