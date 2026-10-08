// Étape 2 : met en forme le mail à partir de <date>.json et, s'il existe, de la synthèse
// rédigée par Claude <date>.synthese.md. N'envoie rien : l'envoi est fait par la routine avec
// le connecteur Gmail.
//
//   node routines/controle-donnees/email.js [--prod] [--date AAAA-MM-JJ]
//   node routines/controle-donnees/email.js [--prod] --echec "message"
//
// Sorties (à côté du rapport) : <date>.email.html et <date>.email.json
// { to, subject, htmlFile, text, attachments: [{ file, filename, mimeType }] } — l'Excel des
// descriptifs (<date>.descriptifs.xlsx) est joint s'il existe.

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { routineContext, ensureDir, readJson, loadRoutineConfig } from '../../lib/routine.js';
import { frDate } from '../../lib/chemins.js';
import { SITE_LIENS as SITE } from '../../lib/donnees.js';
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
        + indicateurs.map(i => td(cell(i.total, i.variation, lienIndicateur(i, '')), 'center')).join('') + '</tr>';
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

function diffusionTiles(report) {
    const d = report.diffusion;
    return `<table role="presentation" cellpadding="0" cellspacing="8" style="width:100%;border-collapse:separate"><tr>`
        + kpi('Programmes diffusés', d.programmes, d.variation.programmes)
        + kpi('Lots diffusés', d.lots, d.variation.lots) + '</tr></table>';
}

function repartitions(report) {
    const d = report.diffusion;
    const pv = (n, dv) => `${fmt(n)}${variation(dv) ? ` <span style="font-size:12px">${variation(dv)}</span>` : ''}`;
    const statuts = table(th('État d\'avancement') + th('Programmes', 'right') + th('Lots', 'right'),
        d.parStatut.map(s => `<tr>${td(esc(s.statut))}${td(pv(s.programmes, s.variation.programmes), 'right')}${td(pv(s.lots, s.variation.lots), 'right')}</tr>`));
    const regs = table(th('Regroupement') + th('Programmes', 'right') + th('Lots', 'right'),
        report.regroupements.filter(rg => d.parRegroupement[rg]).map(rg => {
            const r = d.parRegroupement[rg];
            return `<tr>${td(rgLabel(rg))}${td(pv(r.programmes, r.variation.programmes), 'right')}${td(pv(r.lots, r.variation.lots), 'right')}</tr>`;
        }));
    return `<h3 style="font-size:14px;margin:8px 0 4px">Par état d'avancement</h3>${statuts}`
        + `<h3 style="font-size:14px;margin:16px 0 4px">Par regroupement</h3>${regs}`;
}

// Bloc « Descriptifs et stock » : programmes dont le descriptif s'écarte du stock de leur
// famille, comptés à leur anomalie la plus grave ; les programmes sans stock en dernier.
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const SEVS = [['forte', 'Forte'], ['moyenne', 'Moyenne'], ['faible', 'Faible']];

function descriptifsHtml(report, xlsxName) {
    const a = report.descriptifs;
    if (!a) return `<p style="color:${COLORS.muted}">Contrôle non disponible pour ce rapport.</p>`;
    const v = a.variation;
    const nv = (n, d) => `${n ? `<strong>${fmt(n)}</strong>` : `<span style="color:${COLORS.muted}">0</span>`}`
        + `${variation(d, 'bad') ? `<br><span style="font-size:12px">${variation(d, 'bad')}</span>` : ''}`;
    const head = th('Regroupement') + SEVS.map(([, l]) => th(l, 'center')).join('') + th('Total', 'center');
    const total = `<tr style="background:${COLORS.bg}">${td('<strong>Avec stock</strong>')}`
        + SEVS.map(([k]) => td(nv(a.avecStock[k], v.avecStock[k]), 'center')).join('')
        + td(nv(a.avecStock.total, v.avecStock.total), 'center') + '</tr>';
    const rows = a.regroupements.filter(rg => a.avecStock.parRegroupement[rg] || v.parRegroupement?.[rg]?.total)
        .map(rg => {
            const r = a.avecStock.parRegroupement[rg] || {};
            const rv = v.parRegroupement?.[rg] || {};
            return `<tr>${td(`<strong>${esc(rg.split('|')[0].trim())}</strong>`)}`
                + SEVS.map(([k]) => td(nv(r[k] || 0, rv[k] ?? null), 'center')).join('')
                + td(nv(r.total || 0, rv.total ?? null), 'center') + '</tr>';
        });
    const detailSans = a.regroupements.filter(rg => a.sansStock.parRegroupement[rg])
        .map(rg => `${esc(rg.split('|')[0].trim())} ${a.sansStock.parRegroupement[rg]}`).join(' · ');
    const sans = `<tr>${td('<strong>Sans stock</strong><br><span style="font-size:12px;color:' + COLORS.muted + '">le texte parle encore de stock — en fin de liste</span>')}`
        + td(detailSans ? `<span style="font-size:12px;color:${COLORS.muted}">${detailSans}</span>` : '', 'left', 'border-top:2px solid ' + COLORS.line)
            .replace('<td ', '<td colspan="3" ')
        + td(nv(a.sansStock.total, v.sansStock), 'center') + '</tr>';
    const intro = `<p style="margin:6px 0 8px"><strong style="font-size:18px;color:${COLORS.green}">${fmt(a.total)}</strong> `
        + `programme${a.total > 1 ? 's' : ''} sur ${fmt(a.analyses)} ${a.total > 1 ? 'ont' : 'a'} un descriptif en écart avec le stock de ${a.total > 1 ? 'leur' : 'sa'} famille`
        + `${variation(v.total, 'bad') ? ` (${variation(v.total, 'bad')})` : ''}.</p>`;
    const pj = xlsxName
        ? `<p style="margin:8px 0 0;font-size:12px;color:${COLORS.muted}">Le détail (extrait du descriptif, stock disponible, constat et action, lien vers la page du programme) est dans l'Excel joint : <strong>${esc(xlsxName)}</strong>.</p>`
        : '';
    return intro + `<div style="overflow-x:auto">${table(head, [total, ...rows, sans])}</div>` + pj;
}

function perimetres(report) {
    const items = [
        `<li><strong>Programmes et lots diffusés</strong> : ${esc(report.diffusion.perimetre)}.</li>`,
        ...report.indicateurs.map(i => `<li><strong>${esc(i.libelle)}</strong> : ${esc(i.perimetre)}.</li>`),
        `<li><strong>Descriptifs et stock</strong> : programmes diffusés B2C ayant un descriptif, comparés au stock disponible et commercialisable de toute leur famille (parent et enfants, autres lots compris) ; un programme compte une fois, à son écart le plus grave. Contrôle propre à cette routine, sans équivalent dans les apps.</li>`
    ];
    return `<p style="margin:6px 0;font-size:12px;color:${COLORS.muted}">Chaque chiffre reprend les <strong>filtres par défaut</strong> de l'app ouverte par son lien, qui affiche donc la même liste.</p>`
        + `<ul style="margin:4px 0;padding-left:18px;font-size:12px;color:${COLORS.muted}">${items.join('')}</ul>`;
}

function buildHtml(report, synthese, xlsxName) {
    const parts = [];
    if (ctx.mode === 'recette') {
        parts.push(`<div style="margin:0 0 14px;padding:8px 12px;background:#FFF7E6;border-left:4px solid ${COLORS.warn};font-size:13px">`
            + `<strong>Recette</strong> : chaîne de production complète (historique commité dans recette/, hors référence), envoyée au seul destinataire de test.</div>`);
    }
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

    // Ordre voulu : les deux chiffres de l'offre, les problèmes de données, puis le détail de l'offre.
    parts.push(section('Offre diffusée', diffusionTiles(report), 'Programmes et lots diffusés en B2C'));
    parts.push(section('Problèmes de données', matrice(report, report.indicateurs),
        'Chaque chiffre ouvre la liste dans outilsMarketing, filtrée sur le regroupement'));
    parts.push(section('Descriptifs et stock', descriptifsHtml(report, xlsxName),
        'Descriptifs de programmes qui annoncent ce que le stock ne porte pas'));
    parts.push(section("Répartition de l'offre diffusée", repartitions(report)));

    parts.push(section('Périmètres', perimetres(report)));
    parts.push(`<p style="margin:24px 0 0;font-size:11px;color:${COLORS.muted}">Mail généré automatiquement par la routine « ${esc(config.nom)} » `
        + `à partir des extractions du jour (${fmt(report.sources.programs)} programmes et ${fmt(report.sources.lots)} lots). `
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
const xlsxFile = ctx.file('descriptifs.xlsx');
const xlsxName = !echec && existsSync(xlsxFile) ? `${ctx.date}.descriptifs.xlsx` : null;
let html, text;
if (echec) {
    html = buildFailureHtml(echec);
    text = `Le rapport du ${frDate(ctx.date)} n'a pas pu être produit.\n\n${echec}`;
} else {
    if (!existsSync(ctx.file('json'))) throw new Error(`Rapport absent : ${ctx.file('json')} — lancer d'abord l'analyse`);
    const report = await readJson(ctx.file('json'));
    const synthese = existsSync(ctx.file('synthese.md')) ? await readFile(ctx.file('synthese.md'), 'utf8') : '';
    html = buildHtml(report, synthese, xlsxName);
    // Version texte : la synthèse sans Markdown, puis le lien vers les outils.
    text = synthese.split(/\r?\n/)
        .map(l => l.replace(/^[-*]\s+/, '- ').replace(/\*\*/g, '').replace(/^#+\s*/, '').trim())
        .filter(Boolean).join('\n')
        + `\n\nDétail : ${SITE}/apps/controleDonnees.html`
        + (xlsxName ? `\nExcel joint : ${xlsxName}` : '');
}

const prefix = { test: '[TEST] ', recette: '[RECETTE] ' }[ctx.mode] || '';
const subject = echec
    ? `${prefix}⚠ ${config.nom} — échec du ${frDate(ctx.date)}`
    : `${prefix}${config.nom} — point du ${frDate(ctx.date)}`;
// Un échec n'est envoyé qu'à l'adresse de test : les destinataires n'ont rien à en faire.
const to = ctx.mode === 'prod' && !echec ? config.destinataires : [config.destinataireTest];

const htmlFile = ctx.file('email.html');
await writeFile(htmlFile, html);
const attachments = xlsxName ? [{ file: xlsxFile, filename: xlsxName, mimeType: XLSX_MIME }] : [];
await writeFile(ctx.file('email.json'), JSON.stringify({ to, subject, htmlFile, text, attachments }, null, 2) + '\n');
console.log(`Mail prêt : ${subject}\nÀ : ${to.join(', ')}\nCorps : ${htmlFile}`
    + (attachments.length ? `\nPièce jointe : ${xlsxFile}` : ''));
