// Étape 3 : consolide les verdicts des descriptifs.
//
//   node routines/controle-donnees/consolider.js [--prod|--recette] [--date AAAA-MM-JJ]
//
// Entrées : <date>.descriptifs.dossier.json (script), <date>.descriptifs.relus-*.json (Claude :
// un fichier par lot relu), et le dernier <jour>.descriptifs.json historisé (verdicts repris
// quand le hash n'a pas changé).
// Sorties :
//   <date>.descriptifs.json   un verdict par programme (historisé : il porte les hash)
//   <date>.descriptifs.xlsx   le détail, joint au mail
//   <date>.<slug>.descriptifs.xlsx   le détail d'un regroupement, joint à son mail régional
//   <date>.json               reçoit le bloc `descriptifs` (agrégats et variations, champs vides
//                             compris : descriptifs.champsVides)

import { readdir, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { routineContext, readJson, previousFile, previousReport } from '../../lib/routine.js';
import { writeXlsx } from '../../lib/xlsx.js';
import { stockText, CHAMPS_VIDES } from './descriptifs.js';
import { SANS_REGROUPEMENT } from './indicateurs.js';
import { slugRegroupement } from './regroupements.js';

const SEVERITES = ['forte', 'moyenne', 'faible'];
const ctx = routineContext('controle-donnees');

for (const f of ['json', 'descriptifs.dossier.json']) {
    if (!existsSync(ctx.file(f))) throw new Error(`Fichier absent : ${ctx.file(f)} — lancer d'abord l'analyse`);
}
const report = await readJson(ctx.file('json'));
const dossier = await readJson(ctx.file('descriptifs.dossier.json'));
const previous = await previousFile(ctx, 'descriptifs.json');
const prevById = Object.fromEntries((previous?.programmes || []).map(e => [String(e.idProgram), e]));

// Verdicts relus par Claude, tous lots confondus.
const relus = {};
const prefix = `${ctx.date}.descriptifs.relus-`;
for (const f of (await readdir(ctx.outDir)).filter(f => f.startsWith(prefix) && f.endsWith('.json')).sort()) {
    const data = await readJson(path.join(ctx.outDir, f));
    for (const e of Array.isArray(data) ? data : data.programmes || []) relus[String(e.idProgram)] = e;
}

const erreurs = [];
function check(e, id) {
    if (!Array.isArray(e.anomalies)) { erreurs.push(`${id} : anomalies doit être un tableau`); return; }
    e.anomalies.forEach((a, i) => {
        if (!SEVERITES.includes(a.severite)) erreurs.push(`${id} anomalie ${i + 1} : sévérité « ${a.severite} » (forte, moyenne ou faible)`);
        for (const k of ['type', 'extrait', 'constat']) if (!a[k]) erreurs.push(`${id} anomalie ${i + 1} : ${k} manquant`);
    });
}

const programmes = [];
let repris = 0;
for (const p of dossier.programmes) {
    const id = String(p.idProgram);
    let e;
    if (p.rienAJuger) {
        // Descriptif repris du parent de la famille, sans événement : jugé sur le parent seul.
        e = { idProgram: id, sansStock: p.sansStock, parleDuStock: false, anomalies: [], verdictDu: ctx.date };
    } else if (p.aRelire) {
        e = relus[id];
        if (!e) { erreurs.push(`${id} : à relire, absent des fichiers ${prefix}*.json`); continue; }
        e = { ...e, verdictDu: ctx.date };
    } else {
        e = { ...prevById[id] };
        repris++;
    }
    check(e, id);
    // Le stock vient du script, pas du verdict. Sans stock et texte muet sur le stock : rien à signaler.
    const sansStock = p.sansStock;
    const parleDuStock = sansStock ? !!e.parleDuStock : false;
    programmes.push({
        idProgram: id, hash: p.hash, verdictDu: e.verdictDu || ctx.date, sansStock, parleDuStock,
        anomalies: sansStock && !parleDuStock ? [] : (e.anomalies || []).map(a => ({
            champ: a.champ || 'descriptif', type: a.type, severite: a.severite, extrait: a.extrait, constat: a.constat, commentaire: a.commentaire || ''
        }))
    });
}
if (erreurs.length) throw new Error(`Verdicts incomplets ou invalides :\n- ${erreurs.join('\n- ')}`);

await writeFile(ctx.file('descriptifs.json'), JSON.stringify({ date: ctx.date, programmes }, null, 2) + '\n');

// ── Agrégats ────────────────────────────────────────────────────────────────────────────

const dossierById = Object.fromEntries(dossier.programmes.map(p => [String(p.idProgram), p]));
const rgOf = id => dossierById[id].agencyRegions || SANS_REGROUPEMENT;
const pire = e => SEVERITES.find(s => e.anomalies.some(a => a.severite === s));

const agg = { analyses: programmes.length, relus: programmes.length - repris, repris,
    avecStock: { total: 0, forte: 0, moyenne: 0, faible: 0, parRegroupement: {} },
    sansStock: { total: 0, parRegroupement: {} } };
for (const e of programmes) {
    if (!e.anomalies.length) continue;
    const rg = rgOf(e.idProgram);
    if (e.sansStock) {
        agg.sansStock.total++;
        agg.sansStock.parRegroupement[rg] = (agg.sansStock.parRegroupement[rg] || 0) + 1;
    } else {
        const s = pire(e);
        const r = agg.avecStock.parRegroupement[rg] ||= { forte: 0, moyenne: 0, faible: 0, total: 0 };
        r[s]++; r.total++;
        agg.avecStock[s]++; agg.avecStock.total++;
    }
}
agg.total = agg.avecStock.total + agg.sansStock.total;
agg.regroupements = [...new Set([...Object.keys(agg.avecStock.parRegroupement), ...Object.keys(agg.sansStock.parRegroupement)])]
    .sort((a, b) => (a === SANS_REGROUPEMENT) - (b === SANS_REGROUPEMENT) || a.localeCompare(b, 'fr'));

// Variations depuis le dernier rapport historisé qui porte ce bloc.
const prevAgg = (await previousReport(ctx))?.descriptifs;
const d = (cur, prev) => (prevAgg ? cur - (prev || 0) : null);
agg.datePrecedente = prevAgg ? prevAgg.date : null;
agg.date = ctx.date;
agg.variation = {
    total: d(agg.total, prevAgg?.total),
    avecStock: Object.fromEntries(['total', ...SEVERITES].map(k => [k, d(agg.avecStock[k], prevAgg?.avecStock?.[k])])),
    sansStock: d(agg.sansStock.total, prevAgg?.sansStock?.total),
    // Regroupements du rapport précédent compris : un regroupement revenu à zéro garde sa baisse.
    parRegroupement: Object.fromEntries([...new Set([...agg.regroupements, ...(prevAgg?.regroupements || [])])].map(rg => [rg, {
        ...Object.fromEntries(['total', ...SEVERITES].map(k => [k,
            d(agg.avecStock.parRegroupement[rg]?.[k] || 0, prevAgg?.avecStock?.parRegroupement?.[rg]?.[k])])),
        sansStock: d(agg.sansStock.parRegroupement[rg] || 0, prevAgg?.sansStock?.parRegroupement?.[rg])
    }]))
};
// Champs vides : comptés par le script d'après le dossier (pas un verdict de Claude), à part des
// écarts avec le stock. Un programme compte une fois au total, et une fois par champ vide.
const vides = { total: 0, parChamp: {}, parRegroupement: {} };
for (const p of dossier.programmes) {
    if (!p.champsVides?.length) continue;
    const r = vides.parRegroupement[p.agencyRegions || SANS_REGROUPEMENT] ||= { total: 0 };
    vides.total++; r.total++;
    for (const c of p.champsVides) { vides.parChamp[c] = (vides.parChamp[c] || 0) + 1; r[c] = (r[c] || 0) + 1; }
}
const prevVides = prevAgg?.champsVides;
const dv = (cur, prev) => (prevVides ? cur - (prev || 0) : null);
vides.variation = {
    total: dv(vides.total, prevVides?.total),
    parChamp: Object.fromEntries(CHAMPS_VIDES.map(c => [c, dv(vides.parChamp[c] || 0, prevVides?.parChamp?.[c])])),
    parRegroupement: Object.fromEntries([...new Set([...Object.keys(vides.parRegroupement), ...Object.keys(prevVides?.parRegroupement || {})])]
        .map(rg => [rg, Object.fromEntries(['total', ...CHAMPS_VIDES].map(k =>
            [k, dv(vides.parRegroupement[rg]?.[k] || 0, prevVides?.parRegroupement?.[rg]?.[k])]))]))
};
agg.champsVides = vides;
report.descriptifs = agg;
await writeFile(ctx.file('json'), JSON.stringify(report, null, 2) + '\n');

// ── Excel ───────────────────────────────────────────────────────────────────────────────

const COLUMNS = [
    { header: 'Priorité', width: 13 }, { header: 'Regroupement agences', width: 24 },
    { header: 'Programme', width: 11 }, { header: 'Nom', width: 24 }, { header: 'Lien', width: 8 },
    { header: 'Ville', width: 18 }, { header: 'Parent', width: 9 }, { header: 'Statut programme', width: 17 },
    { header: 'Type', width: 13 }, { header: 'Extrait du descriptif', width: 45 },
    { header: 'Stock disponible', width: 40 }, { header: 'Constat', width: 45 }, { header: 'Commentaire', width: 60 }
];
const PRIORITE = { forte: 'Forte', moyenne: 'Moyenne', faible: 'Faible' };
const rank = r => (r.sansStock ? 10 : SEVERITES.indexOf(r.a.severite));
const lignes = programmes.flatMap(e => e.anomalies.map(a => ({ e, a, sansStock: e.sansStock, p: dossierById[e.idProgram] })))
    .sort((x, y) => rank(x) - rank(y)
        || (x.p.agencyRegions || '').localeCompare(y.p.agencyRegions || '', 'fr')
        || x.e.idProgram.localeCompare(y.e.idProgram, 'fr', { numeric: true }));
const asNumber = v => (v && /^\d+$/.test(v) ? Number(v) : v || null);
const lien = p => (p.webLink ? { formula: `=HYPERLINK("${p.webLink.replace(/"/g, '""')}","Voir")`, value: 'Voir' } : null);
const rows = lignes.map(({ e, a, p }) => [
    e.sansStock ? 'Sans stock (fin de liste)' : PRIORITE[a.severite],
    p.agencyRegions || SANS_REGROUPEMENT,
    asNumber(p.idProgram),
    p.nom,
    lien(p),
    p.ville,
    asNumber(p.parent),
    p.statutProgramme,
    a.type,
    // L'extrait est précédé de son texte d'origine quand il ne vient pas du descriptif.
    ['descriptif', 'stock'].includes(a.champ || 'descriptif') ? a.extrait : `${a.champ[0].toUpperCase()}${a.champ.slice(1)} : ${a.extrait}`,
    (p.famille.length ? 'Famille : ' : '') + stockText(p.stockFamille),
    a.constat,
    a.commentaire
]);
// Champs vides : une ligne par programme, après les écarts.
rows.push(...dossier.programmes.filter(p => p.champsVides?.length)
    .sort((x, y) => (x.agencyRegions || '').localeCompare(y.agencyRegions || '', 'fr')
        || String(x.idProgram).localeCompare(String(y.idProgram), 'fr', { numeric: true }))
    .map(p => ['Champs vides', p.agencyRegions || SANS_REGROUPEMENT, asNumber(p.idProgram), p.nom, lien(p), p.ville,
        asNumber(p.parent), p.statutProgramme, 'vide', `Vides : ${p.champsVides.join(', ')}`,
        (p.famille.length ? 'Famille : ' : '') + stockText(p.stockFamille), '', 'Renseigner ces champs dans le PIM.']));
await writeFile(ctx.file('descriptifs.xlsx'),
    writeXlsx({ sheetName: 'Descriptifs et stock', tableName: 'DescriptifsStock', columns: COLUMNS, rows }));

// Un Excel par regroupement, joint à son mail régional : ses seules lignes. Ceux d'une
// exécution précédente du jour sont effacés (un regroupement peut ne plus avoir d'écart).
const suffixeRg = '.descriptifs.xlsx';
for (const f of (await readdir(ctx.outDir)).filter(f => f.startsWith(`${ctx.date}.`) && f.endsWith(suffixeRg) && f !== `${ctx.date}${suffixeRg}`)) {
    await rm(path.join(ctx.outDir, f));
}
for (const rg of agg.regroupements.filter(rg => rg !== SANS_REGROUPEMENT)) {
    const rowsRg = rows.filter(r => r[1] === rg);
    if (!rowsRg.length) continue;
    await writeFile(ctx.file(`${slugRegroupement(rg)}${suffixeRg}`),
        writeXlsx({ sheetName: 'Descriptifs et stock', tableName: 'DescriptifsStock', columns: COLUMNS, rows: rowsRg }));
}

console.log(`Descriptifs : ${agg.analyses} programmes (${agg.relus} relus, ${agg.repris} repris), `
    + `${agg.total} en écart — avec stock ${agg.avecStock.total} (forte ${agg.avecStock.forte}, moyenne ${agg.avecStock.moyenne}, `
    + `faible ${agg.avecStock.faible}), sans stock ${agg.sansStock.total} ; ${vides.total} programme(s) aux champs vides `
    + `(${CHAMPS_VIDES.map(c => `${c} ${vides.parChamp[c] || 0}`).join(', ')}) ; ${rows.length} ligne(s) dans l'Excel`);
console.log(`Excel : ${ctx.file('descriptifs.xlsx')}`);
