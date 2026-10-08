// Contexte d'exécution commun aux routines : mode, dossiers, rapport précédent.
//
// Trois modes :
// - test (défaut) : sorties dans out/<routine>/ (non versionné), mail au seul destinataire de
//   test, rien n'est commité ;
// - prod (--prod) : sorties dans historique/<routine>/, commitées et poussées par la routine,
//   mail aux destinataires de la routine ;
// - recette (--recette) : toute la chaîne de la prod (commit et push compris) mais mail au seul
//   destinataire de test, sorties dans historique/<routine>/recette/ — sous-dossier jamais lu
//   comme référence. Sert à vérifier l'accès en écriture au dépôt avant une vraie exécution.
// Les variations se calculent par rapport au dernier rapport HISTORISÉ antérieur au jour (un
// test ne devient jamais une référence) ; en recette, rapport du jour compris, pour que les
// variations s'affichent.

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
            recette: { type: 'boolean', default: false },
            cache: { type: 'boolean', default: false },
            date:  { type: 'string' }
        },
        allowPositionals: true
    });
    if (values.prod && values.recette) throw new Error('--prod et --recette sont exclusifs');
    const mode = values.prod ? 'prod' : values.recette ? 'recette' : 'test';
    const date = values.date || parisDay();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`--date attend AAAA-MM-JJ, reçu « ${date} »`);
    const histDir = path.join(ROOT, 'historique', routine);
    const outDir = mode === 'prod' ? histDir
        : mode === 'recette' ? path.join(histDir, 'recette')
        : path.join(ROOT, 'out', routine);
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

// Dernier fichier historisé <jour>.<suffixe> antérieur à `date` (ou du jour même, en recette).
export async function previousFile(ctx, suffix = 'json') {
    if (!existsSync(ctx.histDir)) return null;
    const ending = `.${suffix}`;
    const days = (await readdir(ctx.histDir))
        .filter(f => f.endsWith(ending))
        .map(f => f.slice(0, -ending.length))
        .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d))
        .filter(d => d < ctx.date || (ctx.mode === 'recette' && d === ctx.date))
        .sort();
    if (!days.length) return null;
    return readJson(path.join(ctx.histDir, `${days.at(-1)}${ending}`));
}

export const previousReport = ctx => previousFile(ctx, 'json');
