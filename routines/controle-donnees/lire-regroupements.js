// Affiche, en texte compact, les chiffres de chaque regroupement qui reçoit un mail régional,
// et le fichier de synthèse à écrire : c'est ce que Claude lit pour rédiger les synthèses
// régionales (étape 4 du ROUTINE.md).
//
//   node routines/controle-donnees/lire-regroupements.js [--prod|--recette] [--date AAAA-MM-JJ]

import { existsSync } from 'node:fs';
import path from 'node:path';
import { routineContext, readJson, loadRoutineConfig } from '../../lib/routine.js';
import { regroupementsAEnvoyer } from './regroupements.js';
import { CHAMPS_VIDES } from './descriptifs.js';

const ctx = routineContext('controle-donnees');
if (!existsSync(ctx.file('json'))) throw new Error(`Rapport absent : ${ctx.file('json')} — lancer d'abord l'analyse`);
const report = await readJson(ctx.file('json'));
const { mails, alertes } = regroupementsAEnvoyer(await loadRoutineConfig('controle-donnees'), report, ctx.mode);

const fmt = n => Number(n).toLocaleString('fr-FR');
const v = d => (d === null || d === undefined ? '' : ` (${d > 0 ? '+' : ''}${fmt(d)})`);

const out = [`Rapport du ${report.date} — variations depuis : ${report.datePrecedente || 'aucun rapport (premier rapport)'}`];
if (!mails.length) out.push('Aucun mail régional à envoyer : pas de synthèse régionale à écrire.');
for (const { rg, nom, slug } of mails) {
    const dif = report.diffusion.parRegroupement[rg] || { programmes: 0, lots: 0, variation: {} };
    const desc = report.descriptifs;
    const ds = desc?.avecStock.parRegroupement[rg] || {};
    const dv = desc?.variation.parRegroupement?.[rg] || {};
    out.push('', `## ${nom} — synthèse à écrire dans ${path.relative(process.cwd(), ctx.file(`${slug}.synthese.md`))}`,
        `Offre diffusée : ${fmt(dif.programmes)} programmes${v(dif.variation?.programmes)}, ${fmt(dif.lots)} lots${v(dif.variation?.lots)}`,
        'Problèmes de données :',
        ...report.indicateurs.map(i => `- ${i.libelle} : ${fmt(i.parRegroupement[rg] || 0)}${v(i.variationParRegroupement?.[rg])}`),
        desc
            ? `Descriptifs en écart, avec stock : ${fmt(ds.total || 0)}${v(dv.total)} — forte ${fmt(ds.forte || 0)}${v(dv.forte)}, `
                + `moyenne ${fmt(ds.moyenne || 0)}${v(dv.moyenne)}, faible ${fmt(ds.faible || 0)}${v(dv.faible)} ; `
                + `sans stock : ${fmt(desc.sansStock.parRegroupement[rg] || 0)}${v(dv.sansStock)}`
            : 'Descriptifs : contrôle non disponible');
    const cv = desc?.champsVides;
    if (cv) {
        const r = cv.parRegroupement[rg] || {}, rv = cv.variation.parRegroupement?.[rg] || {};
        out.push(`Programmes aux champs vides : ${fmt(r.total || 0)}${v(rv.total)} — `
            + CHAMPS_VIDES.map(c => `${c} ${fmt(r[c] || 0)}${v(rv[c])}`).join(', '));
    }
}
if (alertes.length) out.push('', 'Alertes de configuration :', ...alertes.map(a => `- ${a}`));
console.log(out.join('\n'));
