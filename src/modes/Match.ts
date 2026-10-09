import type { Team } from '../weapons/types';

export interface MatchConfig {
  /** Kills a team needs to win. */
  scoreLimit: number;
  /** Seconds, 0 = no limit. */
  timeLimit: number;
  teamSize: number;
}

export type Winner = Team | 'draw';

/**
 * Team deathmatch bookkeeping: team scores (kills against the other team), the clock, and the end conditions.
 * Game feeds it kill events and fixed-step time; it never touches the world itself.
 */
export class Match {
  readonly score: Record<Team, number> = { blue: 0, red: 0 };
  time = 0;
  over = false;
  winner: Winner | null = null;
  /** Why the match ended, for the results screen. */
  reason = '';

  constructor(readonly cfg: MatchConfig) {}

  /** A fighter was destroyed. Only kills against the other team score; crashes and friendly losses do not. */
  onKill(killer: Team | null, victim: Team): void {
    if (this.over || !killer || killer === victim) return;
    this.score[killer]++;
    if (this.score[killer] >= this.cfg.scoreLimit) this.finish(killer, `${killer === 'blue' ? 'Blue' : 'Red'} reached ${this.cfg.scoreLimit} kills`);
  }

  update(dt: number): void {
    if (this.over) return;
    this.time += dt;
    if (this.cfg.timeLimit > 0 && this.time >= this.cfg.timeLimit) {
      const { blue, red } = this.score;
      this.finish(blue === red ? 'draw' : blue > red ? 'blue' : 'red', 'Time limit reached');
    }
  }

  /** Seconds left, or null with no time limit. */
  get remaining(): number | null {
    return this.cfg.timeLimit > 0 ? Math.max(0, this.cfg.timeLimit - this.time) : null;
  }

  private finish(w: Winner, why: string): void {
    this.over = true;
    this.winner = w;
    this.reason = why;
  }
}

export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
