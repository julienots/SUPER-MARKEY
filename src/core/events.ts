/** Bus d'événements typé, minimaliste. Les systèmes communiquent par ce biais sans dépendances croisées. */
export type Handler<T> = (payload: T) => void;

export class EventBus<M extends Record<string, any>> {
  private handlers = new Map<keyof M, Set<Handler<any>>>();

  on<K extends keyof M>(type: K, fn: Handler<M[K]>): () => void {
    let set = this.handlers.get(type);
    if (!set) this.handlers.set(type, (set = new Set()));
    set.add(fn);
    return () => set!.delete(fn);
  }

  emit<K extends keyof M>(type: K, payload: M[K]): void {
    const set = this.handlers.get(type);
    if (!set) return;
    for (const fn of [...set]) {
      try {
        fn(payload);
      } catch (err) {
        console.error(`[bus] handler error on ${String(type)}`, err);
      }
    }
  }

  clear(): void {
    this.handlers.clear();
  }
}
