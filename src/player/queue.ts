export type Status = 'idle' | 'playing' | 'paused' | 'ended';

// Every change bumps the token, so an engine callback for an older sentence is ignored.
export class Queue<T> {
  items: T[] = [];
  index = 0;
  status: Status = 'idle';
  token = 0;

  get current(): T | undefined {
    return this.items[this.index];
  }

  load(items: T[], index = 0) {
    this.items = items;
    this.index = Math.min(Math.max(index, 0), items.length - 1);
    this.status = items.length ? 'playing' : 'idle';
    this.token++;
  }

  pause() {
    if (this.status === 'playing') this.status = 'paused';
    this.token++;
  }

  resume() {
    if (this.status === 'ended') this.index = 0;
    if (this.items.length) this.status = 'playing';
    this.token++;
  }

  next() {
    if (this.index < this.items.length - 1) this.index++;
    else this.status = 'ended';
    this.token++;
  }

  previous() {
    this.index = Math.max(0, this.index - 1);
    if (this.status === 'ended') this.status = 'paused';
    this.token++;
  }

  ended(token: number): boolean {
    if (token !== this.token || this.status !== 'playing') return false;
    this.next();
    return true;
  }

  stop() {
    this.items = [];
    this.index = 0;
    this.status = 'idle';
    this.token++;
  }
}
