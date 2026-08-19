import type { Clock } from '../../application/ports/Clock.js';

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

/** Tests inject this instead of mocking global time. */
export class FixedClock implements Clock {
  constructor(private current: Date) {}
  now(): Date { return this.current; }
  advanceBy(ms: number): void { this.current = new Date(this.current.getTime() + ms); }
  set(at: Date): void { this.current = at; }
}
