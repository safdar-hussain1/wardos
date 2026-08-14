export interface Clock {
  now(): Date
}

export const ANCHOR_ISO = '2026-08-01T03:30:00.000Z'

export class FixedClock implements Clock {
  private currentTime: Date

  constructor(startIso: string) {
    this.currentTime = new Date(startIso)
  }

  now(): Date {
    // Return an independent copy to prevent external mutation
    return new Date(this.currentTime)
  }

  advanceMinutes(m: number): void {
    this.currentTime.setUTCMinutes(this.currentTime.getUTCMinutes() + m)
  }

  set(iso: string): void {
    this.currentTime = new Date(iso)
  }
}
