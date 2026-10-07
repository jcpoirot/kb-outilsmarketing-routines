// Contexte d'exécution commun aux routines : mode, dossiers, rapport précédent.
//
// Deux modes :
// - test (défaut) : sorties dans out/<routine>/ (non versionné), mail au seul destinataire de
//   test, rien n'est commité ;
// - prod (--prod) : sorties dans historique/<routine>/, commitées et poussées par la routine,
//   mail aux destinataires de la routine.
// Dans les deux modes, les variations se calculent par rapport au dernier rapport HISTORISÉ
// antérieur au jour : un test ne devient jamais une référence.

import { readFile, readdir, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { ROOT, parisDay } from './chemins.js';

export function routineContext(routine, argv = process.argv.slice(2)) {
    const { values } = parseArgs({
        args: argv,
        options: {
            prod:  { type: 'boolean', default: false },
            cache: { type: 'boolean', default: false },
            date:  { type: 'string' }
        },
        allowPositionals: true
    });
    const mode = values.prod ? 'prod' : 'test';
    const date = values.date || parisDay();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`--date attend AAAA-MM-JJ, reçu « ${date} »`);
    const histDir = path.join(ROOT, 'historique', routine);
    const outDir = mode === 'prod' ? histDir : path.join(ROOT, 'out', routine);
    return {
        routine, mode, date, cache: values.cache, histDir, outDir,
        file: ext => path.join(outDir, `${date}.${ext}`)
    };
}

export async function ensureDir(dir) { await mkdir(dir, { recursive: true }); }

export async function readJson(file) { return JSON.parse(await readFile(file, 'utf8')); }

export async function loadRoutineConfig(routine) {
    return readJson(path.join(ROOT, 'routines', routine, 'config.json'));
}

// Dernier rapport historisé strictement antérieur à `date`.
export async function previousReport(ctx) {
    if (!existsSync(ctx.histDir)) return null;
    const days = (await readdir(ctx.histDir))
        .map(f => f.match(/^(\d{4}-\d{2}-\d{2})\.json$/)?.[1])
        .filter(d => d && d < ctx.date)
        .sort();
    if (!days.length) return null;
    return readJson(path.join(ctx.histDir, `${days.at(-1)}.json`));
}
