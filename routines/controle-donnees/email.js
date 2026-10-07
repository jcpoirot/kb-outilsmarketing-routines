// Étape 2 : met en forme le mail à partir de <date>.json et, s'il existe, de la synthèse
// rédigée par Claude <date>.synthese.md. N'envoie rien : l'envoi est fait par la routine avec
// le connecteur Gmail.
//
//   node routines/controle-donnees/email.js [--prod] [--date AAAA-MM-JJ]
//   node routines/controle-donnees/email.js [--prod] --echec "message"
//
// Sorties (à côté du rapport) : <date>.email.html et <date>.email.json { to, subject, htmlFile }.

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { routineContext, ensureDir, readJson, loadRoutineConfig } from '../../lib/routine.js';
import { frDate } from '../../lib/chemins.js';
import { SITE } from '../../lib/donnees.js';
import { COLORS, esc, fmt, variation, markdownToHtml, section, th, td, table, link, page } from '../../lib/email.js';
import { lienApp1, lienApp5, SANS_REGROUPEMENT } from './indicateurs.js';

const ROUTINE = 'controle-donnees';

const argv = process.argv.slice(2);
const echecIdx = argv.indexOf('--echec');
const echec = echecIdx > -1 ? (argv[echecIdx + 1] || 'Erreur inconnue') : null;
if (echecIdx > -1) argv.splice(echecIdx, 2);

const ctx = routineContext(ROUTINE, argv);
const config = await loadRoutineConfig(ROUTINE);

const longDate = day => new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${day}T12:00:00Z`));

// « Ile-de-France | Flore » → nom du regroupement en gras, responsable en dessous.
function rgLabel(rg) {
    const [nom, resp] = rg.split('|').map(s => s.trim());
    return `<strong>${esc(nom)}</strong>${resp ? `<br><span style="color:${COLORS.muted};font-size:12px">${esc(resp)}</span>` : ''}`;
}

function lienIndicateur(ind, rg) {
    return ind.app === 1 ? lienApp1(rg) : lienApp5(ind.slug, rg);
}

function cell(n, d, href) {
    const val = n ? link(href, `<strong>${fmt(n)}</strong>`) : `<span style="color:${COLORS.muted}">0</span>`;
    const v = variation(d, 'bad');
    return `${val}${v ? `<br><span style="font-size:12px">${v}</span>` : ''}`;
}

// Matrice regroupements × indicateurs, ligne Total en tête.
function matrice(report, indicateurs) {
    const head = th('Regroupement') + indicateurs.map(i => th(esc(i.libelle), 'center')).join('');
    const total = `<tr style="background:${COLORS.bg}">${td('<strong>Total</strong>')}`
        + indicateurs.map(i => td(cell(i.total, i.variation, i.lien), 'center')).join('') + '</tr>';
    const rows = report.regroupements
        .filter(rg => indicateurs.some(i => i.parRegroupement[rg] || i.variationParRegroupement?.[rg]))
        .map(rg => `<tr>${td(rgLabel(rg))}`
            + indicateurs.map(i => td(cell(i.parRegroupement[rg] || 0, i.variationParRegroupement?.[rg] ?? null,
                lienIndicateur(i, rg === SANS_REGROUPEMENT ? '' : rg)), 'center')).join('') + '</tr>');
    return `<div style="overflow-x:auto">${table(head, [total, ...rows])}</div>`;
}

function kpi(label, value, d) {
    const v = variation(d);
    return `<td style="padding:12px 14px;background:${COLORS.bg};border-left:4px solid ${COLORS.green};width:50%">`
        + `<div style="font-size:12px;color:${COLORS.muted}">${esc(label)}</div>`
        + `<div style="font-size:26px;font-weight:700;color:${COLORS.green}">${fmt(value)}`
        + `${v ? ` <span style="font-size:14px">${v}</span>` : ''}</div></td>`;
}

function diffusionHtml(report) {
    const d = report.diffusion;
    const tiles = `<table role="presentation" cellpadding="0" cellspacing="8" style="width:100%;border-collapse:separate"><tr>`
        + kpi('Programmes diffusés', d.programmes, d.variation.programmes)
        + kpi('Lots diffusés', d.lots, d.variation.lots) + '</tr></table>';

    const pv = (n, dv) => `${fmt(n)}${variation(dv) ? ` <span style="font-size:12px">${variation(dv)}</span>` : ''}`;
    const statuts = table(th('État d\'avancement') + th('Programmes', 'right') + th('Lots', 'right'),
        d.parStatut.map(s => `<tr>${td(esc(s.statut))}${td(pv(s.programmes, s.variation.programmes), 'right')}${td(pv(s.lots, s.variation.lots), 'right')}</tr>`));
    const regs = table(th('Regroupement') + th('Programmes', 'right') + th('Lots', 'right'),
        report.regroupements.filter(rg => d.parRegroupement[rg]).map(rg => {
            const r = d.parRegroupement[rg];
            return `<tr>${td(rgLabel(rg))}${td(pv(r.programmes, r.variation.programmes), 'right')}${td(pv(r.lots, r.variation.lots), 'right')}</tr>`;
        }));
    return tiles
        + `<h3 style="font-size:14px;margin:16px 0 4px">Répartition par état d'avancement</h3>${statuts}`
        + `<h3 style="font-size:14px;margin:16px 0 4px">Répartition par regroupement</h3>${regs}`;
}

function perimetres(report) {
    const items = [
        `<li><strong>Programmes et lots diffusés</strong> : ${esc(report.diffusion.perimetre)}.</li>`,
        ...report.indicateurs.map(i => `<li><strong>${esc(i.libelle)}</strong> : ${esc(i.perimetre)}.</li>`)
    ];
    return `<p style="margin:6px 0;font-size:12px;color:${COLORS.muted}">Chaque chiffre reprend les <strong>filtres par défaut</strong> de l'app ouverte par son lien, qui affiche donc la même liste.</p>`
        + `<ul style="margin:4px 0;padding-left:18px;font-size:12px;color:${COLORS.muted}">${items.join('')}</ul>`;
}

function buildHtml(report, synthese) {
    const parts = [];
    if (ctx.mode === 'test') {
        parts.push(`<div style="margin:0 0 14px;padding:8px 12px;background:#FFF7E6;border-left:4px solid ${COLORS.warn};font-size:13px">`
            + `<strong>Envoi de test</strong> : ce rapport n'est pas historisé et ne sert pas de référence aux prochaines variations.</div>`);
    }
    const ref = report.datePrecedente
        ? `Variations depuis le ${frDate(report.datePrecedente)}`
        : 'Premier rapport : pas encore de variation';
    parts.push(`<p style="margin:0;color:${COLORS.muted}">Outils marketing · Contrôle des données</p>`
        + `<h1 style="font-size:22px;margin:4px 0 2px;color:${COLORS.green}">Point du ${esc(longDate(report.date))}</h1>`
        + `<p style="margin:0;color:${COLORS.muted};font-size:13px">${esc(ref)}</p>`);

    if (synthese) parts.push(section('Synthèse', markdownToHtml(synthese)));

    parts.push(section('Offre diffusée', diffusionHtml(report), 'Programmes et lots diffusés en B2C'));

    const qualite = report.indicateurs.filter(i => !i.signal);
    const signaux = report.indicateurs.filter(i => i.signal);
    parts.push(section('Problèmes de données', matrice(report, qualite),
        'Chaque chiffre ouvre la liste dans outilsMarketing, filtrée sur le regroupement'));
    parts.push(section('Signaux commerciaux', matrice(report, signaux),
        'Stock ou programmes dont la diffusion est à revoir'));

    parts.push(section('Périmètres', perimetres(report)));
    parts.push(`<p style="margin:24px 0 0;font-size:11px;color:${COLORS.muted}">Mail généré automatiquement par la routine « ${esc(config.nom)} » `
        + `à partir des extractions du jour (${fmt(report.sources.programs)} programmes, ${fmt(report.sources.lots)} lots, ${fmt(report.sources.otherUnits)} autres lots). `
        + `${link(SITE, 'outilsmarketing.kaufmanbroad.fr')}</p>`);
    return page(parts.join('\n'));
}

function buildFailureHtml(message) {
    return page(`<p style="margin:0;color:${COLORS.muted}">Outils marketing · Contrôle des données</p>`
        + `<h1 style="font-size:20px;margin:4px 0 12px;color:${COLORS.bad}">Le rapport du ${esc(frDate(ctx.date))} n'a pas pu être produit</h1>`
        + `<p>La routine a échoué avant la fin de l'analyse. Aucun chiffre n'est envoyé et aucun historique n'est écrit.</p>`
        + `<pre style="white-space:pre-wrap;background:${COLORS.bg};padding:10px;font-size:12px">${esc(message)}</pre>`);
}

await ensureDir(ctx.outDir);
let html;
if (echec) {
    html = buildFailureHtml(echec);
} else {
    if (!existsSync(ctx.file('json'))) throw new Error(`Rapport absent : ${ctx.file('json')} — lancer d'abord l'analyse`);
    const report = await readJson(ctx.file('json'));
    const synthese = existsSync(ctx.file('synthese.md')) ? await readFile(ctx.file('synthese.md'), 'utf8') : '';
    html = buildHtml(report, synthese);
}

const prefix = ctx.mode === 'test' ? '[TEST] ' : '';
const subject = echec
    ? `${prefix}⚠ ${config.nom} — échec du ${frDate(ctx.date)}`
    : `${prefix}${config.nom} — point du ${frDate(ctx.date)}`;
// Un échec n'est envoyé qu'à l'adresse de test : les destinataires n'ont rien à en faire.
const to = ctx.mode === 'prod' && !echec ? config.destinataires : [config.destinataireTest];

const htmlFile = ctx.file('email.html');
await writeFile(htmlFile, html);
await writeFile(ctx.file('email.json'), JSON.stringify({ to, subject, htmlFile }, null, 2) + '\n');
console.log(`Mail prêt : ${subject}\nÀ : ${to.join(', ')}\nCorps : ${htmlFile}`);
