import { useSyncExternalStore } from 'react';
import type { Observable } from '@/utils/Observable';

/**
 * React-silta MVVM-arkkitehtuuriin. Yhdistää Observable-pohjaisen ViewModelin
 * Reactin renderöintiin `useSyncExternalStore`-hookilla, joka on turvallinen
 * myös samanaikaisessa renderöinnissä (React 18 concurrent).
 *
 * Näin näkymät (View) tilaavat ViewModelin tilan ilman, että liiketoiminta-
 * logiikka on sidottu Reactiin.
 */
export function useViewModel<T>(vm: Observable<T>): T {
  return useSyncExternalStore(
    (onChange) => vm.subscribe(onChange),
    () => vm.getState()
  );
}
