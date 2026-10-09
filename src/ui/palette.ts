/**
 * Team and signal colours. The default is blue against red; the colourblind-safe set is blue against orange (blue/orange stay
 * apart for red-green colour blindness) and swaps the amber pipper for white. HUD code reads these live, and the CSS variables
 * keep the scoreboard and score line in step.
 */
export const palette = {
  blue: '#4aa8ff',
  red: '#ff5a4a',
  foe: '#ff7a59',
  foeLock: '#ff3b3b',
  amber: '#ffcf4d',
  ok: '#7dffb0',
  blueHex: 0x3aa0ff,
  redHex: 0xff5a4a,
};

export function setColorblind(on: boolean): void {
  if (on) {
    Object.assign(palette, { blue: '#4aa8ff', red: '#ffa31a', foe: '#ffb347', foeLock: '#ff8a00', amber: '#ffffff', ok: '#7dffb0', blueHex: 0x3aa0ff, redHex: 0xffa31a });
  } else {
    Object.assign(palette, { blue: '#4aa8ff', red: '#ff5a4a', foe: '#ff7a59', foeLock: '#ff3b3b', amber: '#ffcf4d', ok: '#7dffb0', blueHex: 0x3aa0ff, redHex: 0xff5a4a });
  }
  const s = document.documentElement.style;
  s.setProperty('--team-blue', palette.blue);
  s.setProperty('--team-red', on ? '#ffa31a' : '#ff6a5a');
  s.setProperty('--danger', on ? '#ff9a3c' : '#ff5d5d');
}
