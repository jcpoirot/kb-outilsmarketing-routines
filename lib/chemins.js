import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Jour de Paris, en chaîne AAAA-MM-JJ : la routine tourne en UTC.
export function parisDay(date = new Date()) {
    return new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris' }).format(date);
}

export function frDate(day) {
    const [y, m, d] = day.split('-');
    return `${d}/${m}/${y}`;
}
