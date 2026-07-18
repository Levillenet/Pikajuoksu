/**
 * Yksinkertainen havainnoitava tila (Observable) MVVM-arkkitehtuuria varten.
 *
 * ViewModel-luokat perivät tästä ja julkaisevat tilamuutokset. Näkymät
 * (React-komponentit) tilaavat muutokset `useObservable`-hookin kautta.
 * Näin liiketoimintalogiikka pysyy erillään React-koodista ja on
 * yksikkötestattavissa ilman DOM:ia.
 */
export type Listener<T> = (state: T) => void;

export class Observable<T> {
  private listeners = new Set<Listener<T>>();
  protected state: T;

  constructor(initial: T) {
    this.state = initial;
  }

  /** Palauttaa nykyisen tilan (vain luku). */
  getState(): T {
    return this.state;
  }

  /**
   * Päivittää tilan osittain ja ilmoittaa tilaajille.
   * Yhdistää uuden osittaisen tilan aiempaan (matala kopio).
   */
  protected setState(patch: Partial<T>): void {
    this.state = { ...this.state, ...patch };
    this.emit();
  }

  /** Korvaa koko tilan. */
  protected replaceState(next: T): void {
    this.state = next;
    this.emit();
  }

  /** Tilaa muutokset. Palauttaa funktion tilauksen peruuttamiseksi. */
  subscribe(listener: Listener<T>): () => void {
    this.listeners.add(listener);
    // Toimitetaan nykytila heti, jotta näkymä on synkassa.
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const listener of this.listeners) listener(this.state);
  }
}

/**
 * Kevyt tapahtumalähetin (EventEmitter). Käytetään palveluissa, jotka
 * lähettävät diskreettejä tapahtumia (esim. "pilli havaittu") tilan sijaan.
 */
export class EventBus<EventMap extends Record<string, unknown>> {
  private handlers: {
    [K in keyof EventMap]?: Set<(payload: EventMap[K]) => void>;
  } = {};

  on<K extends keyof EventMap>(type: K, handler: (payload: EventMap[K]) => void): () => void {
    (this.handlers[type] ??= new Set()).add(handler);
    return () => this.handlers[type]?.delete(handler);
  }

  emit<K extends keyof EventMap>(type: K, payload: EventMap[K]): void {
    this.handlers[type]?.forEach((h) => h(payload));
  }

  clear(): void {
    this.handlers = {};
  }
}
