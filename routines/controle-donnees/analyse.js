// Étape 1 : calcule les indicateurs, les compare au dernier rapport historisé et écrit
// <date>.json (out/ en test, historique/ en prod). Affiche un résumé.
//
//   node routines/controle-donnees/analyse.js [--prod] [--cache] [--date AAAA-MM-JJ]

import { writeFile } from 'node:fs/promises';
import { loadCsvs } from '../../lib/donnees.js';
import { routineContext, ensureDir, previousReport } from '../../lib/routine.js';
import { computeIndicateurs } from './indicateurs.js';

const ROUTINE = 'controle-donnees';

const delta = (cur, prev) => (prev === undefined || prev === null ? null : cur - prev);

function withDiff(data, prev) {
    const d = data.diffusion;
    const pd = prev?.diffusion;
    d.variation = { programmes: delta(d.programmes, pd?.programmes), lots: delta(d.lots, pd?.lots) };
    for (const [rg, v] of Object.entries(d.parRegroupement)) {
        const p = pd?.parRegroupement?.[rg];
        v.variation = { programmes: delta(v.programmes, pd ? (p?.programmes ?? 0) : null), lots: delta(v.lots, pd ? (p?.lots ?? 0) : null) };
    }
    for (const s of d.parStatut) {
        const p = pd?.parStatut?.find(x => x.statut === s.statut);
        s.variation = { programmes: delta(s.programmes, pd ? (p?.programmes ?? 0) : null), lots: delta(s.lots, pd ? (p?.lots ?? 0) : null) };
    }
    for (const ind of data.indicateurs) {
        const p = prev?.indicateurs?.find(x => x.cle === ind.cle);
        ind.variation = delta(ind.total, p?.total);
        ind.variationParRegroupement = {};
        for (const rg of data.regroupements) {
            ind.variationParRegroupement[rg] = p ? delta(ind.parRegroupement[rg] || 0, p.parRegroupement?.[rg] || 0) : null;
        }
    }
    return data;
}

const ctx = routineContext(ROUTINE);
const csv = await loadCsvs('controleDonnees',
    { programs: 'programsUrl', lots: 'lotsUrl' }, { cache: ctx.cache });
const prev = await previousReport(ctx);
const data = withDiff(computeIndicateurs(csv), prev);

const report = {
    routine: ROUTINE,
    date: ctx.date,
    mode: ctx.mode,
    genereLe: new Date().toISOString(),
    datePrecedente: prev?.date || null,
    sources: { programs: csv.programs.length, lots: csv.lots.length },
    ...data
};

await ensureDir(ctx.outDir);
await writeFile(ctx.file('json'), JSON.stringify(report, null, 2) + '\n');

const sign = n => (n === null ? '' : ` (${n > 0 ? '+' : ''}${n})`);
console.log(`Contrôle des données — ${ctx.date} — mode ${ctx.mode}`);
console.log(`Référence : ${report.datePrecedente || 'aucune (premier rapport)'}`);
console.log(`Diffusés : ${data.diffusion.programmes} programmes${sign(data.diffusion.variation.programmes)}, ${data.diffusion.lots} lots${sign(data.diffusion.variation.lots)}`);
for (const ind of data.indicateurs) console.log(`- ${ind.libelle} : ${ind.total}${sign(ind.variation)}`);
console.log(`Rapport : ${ctx.file('json')}`);
