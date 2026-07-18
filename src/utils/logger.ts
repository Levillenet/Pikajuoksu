/**
 * Kevyt lokitusapuri. Keskitetty lokitus helpottaa virheenetsintää
 * kentällä (esim. kun ääntä ei havaita) ja mahdollistaa myöhemmin
 * lokien tallentamisen tiedostoon tai lähettämisen diagnostiikkaan.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

// Kehityksessä näytetään kaikki, tuotannossa vain info ja siitä ylöspäin.
const MIN_LEVEL: LogLevel = import.meta.env.DEV ? 'debug' : 'info';

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[MIN_LEVEL];
}

export function createLogger(scope: string) {
  const prefix = `[${scope}]`;
  return {
    debug: (...args: unknown[]) => shouldLog('debug') && console.debug(prefix, ...args),
    info: (...args: unknown[]) => shouldLog('info') && console.info(prefix, ...args),
    warn: (...args: unknown[]) => shouldLog('warn') && console.warn(prefix, ...args),
    error: (...args: unknown[]) => shouldLog('error') && console.error(prefix, ...args),
  };
}

export type Logger = ReturnType<typeof createLogger>;
