import type { Team } from '../weapons/types';

export interface ScoreRow {
  name: string;
  aircraft: string;
  team: Team;
  kills: number;
  assists: number;
  deaths: number;
  /** 0..1 gun accuracy, or null with no shots. */
  accuracy: number | null;
  you: boolean;
  alive: boolean;
}

export interface ScoreData {
  title: string;
  score: Record<Team, number>;
  /** "FIRST TO 20" / "TIME 4:12" line, or ''. */
  info: string;
  rows: ScoreRow[];
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, parent?: HTMLElement, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e;
}

/** Fills a container with the two-team scoreboard table. Used for the hold-to-show overlay and the results screen. */
export function renderScoreboard(into: HTMLElement, d: ScoreData): void {
  into.innerHTML = '';
  const head = el('div', 'sb-head', into);
  el('span', 'sb-team blue', head, `BLUE  ${d.score.blue}`);
  el('span', 'sb-info', head, d.info || d.title);
  el('span', 'sb-team red', head, `${d.score.red}  RED`);
  for (const team of ['blue', 'red'] as Team[]) {
    const rows = d.rows.filter((r) => r.team === team).sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
    const tbl = el('table', 'sb-table ' + team, into);
    const tr = el('tr', '', el('thead', '', tbl));
    for (const h of ['Pilot', 'Aircraft', 'K', 'A', 'D', 'Acc']) el('th', h.length > 2 || h === 'K' ? '' : 'num', tr, h);
    tr.children[2].className = tr.children[3].className = tr.children[4].className = tr.children[5].className = 'num';
    const body = el('tbody', '', tbl);
    for (const r of rows) {
      const row = el('tr', (r.you ? 'you ' : '') + (r.alive ? '' : 'dead'), body);
      el('td', '', row, r.name);
      el('td', 'muted', row, r.aircraft);
      el('td', 'num', row, String(r.kills));
      el('td', 'num', row, String(r.assists));
      el('td', 'num', row, String(r.deaths));
      el('td', 'num', row, r.accuracy === null ? '–' : Math.round(r.accuracy * 100) + '%');
    }
  }
}

/** The hold-to-show scoreboard over the game view. */
export class ScoreboardOverlay {
  private root: HTMLElement;
  private body: HTMLElement;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'scoreboard', parent);
    this.root.style.display = 'none';
    this.body = el('div', 'sb-body', this.root);
  }

  show(d: ScoreData): void {
    this.root.style.display = 'flex';
    renderScoreboard(this.body, d);
  }

  hide(): void {
    this.root.style.display = 'none';
  }
}
