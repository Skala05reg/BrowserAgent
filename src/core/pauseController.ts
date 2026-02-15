export class PauseController {
  private paused = false;
  private stopped = false;
  private waiters: Array<() => void> = [];

  public pause(): void {
    this.paused = true;
  }

  public resume(): void {
    this.paused = false;
    this.flushWaiters();
  }

  public stop(): void {
    this.stopped = true;
    this.paused = false;
    this.flushWaiters();
  }

  public reset(): void {
    this.paused = false;
    this.stopped = false;
    this.flushWaiters();
  }

  public isPaused(): boolean {
    return this.paused;
  }

  public isStopped(): boolean {
    return this.stopped;
  }

  public async waitIfPaused(): Promise<void> {
    if (!this.paused) {
      return;
    }

    await new Promise<void>((resolve) => {
      this.waiters.push(resolve);
    });
  }

  private flushWaiters(): void {
    while (this.waiters.length > 0) {
      const waiter = this.waiters.shift();
      waiter?.();
    }
  }
}
