/** Tiny typed event emitter. */
export class Emitter<T> {
  private listeners = new Set<(v: T) => void>();

  on(cb: (v: T) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  emit(v: T): void {
    for (const l of this.listeners) l(v);
  }
}
