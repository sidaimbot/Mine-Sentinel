// Canvas palette for the light dashboard theme; keep in sync with the variables in styles/dashboard.css.
export const THEME = {
  text: '#1c2321',
  soft: '#3f4a46',
  muted: '#6b7672',
  dim: '#97a19d',
  canvasBg: '#f5f7f5',
  grid: 'rgba(20, 30, 28, 0.05)',
  tunnel: 'rgba(47, 125, 116, 0.13)',
  wall: 'rgba(47, 125, 116, 0.6)',
  zoneLabel: 'rgba(63, 74, 70, 0.55)',
  otherLine: 'rgba(63, 74, 70, 0.16)',
  hoverLine: 'rgba(28, 35, 33, 0.35)',
  nowLine: 'rgba(28, 35, 33, 0.45)',
  level: { normal: '#1f9d55', elevated: '#c98a00', critical: '#d93a2b' },
  trend: { normal: '#2f7d74', elevated: '#c98a00', critical: '#d93a2b' },
  type: { methane: '#c98a00', water: '#1f8fc4', fire: '#e25a12' },
  hazard: {
    gasWarn: [201, 138, 0],
    gasAlarm: [217, 58, 43],
    fire: [226, 90, 18],
    water: [31, 143, 196],
  },
  submerged: '#1f8fc4',
  safe: '#1f9d55',
  route: '#c98a00',
  player: '#b8860b',
  playerDanger: '#d93a2b',
  alertLine: 'rgba(201, 138, 0, 0.65)',
  critLine: 'rgba(217, 58, 43, 0.6)',
};

export default THEME;
