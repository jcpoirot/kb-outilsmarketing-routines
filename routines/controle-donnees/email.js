// Met en forme les mails à partir de <date>.json et, s'il existe, de la synthèse rédigée par
// Claude <date>.synthese.md. N'envoie rien : l'envoi est fait par envoyer.js.
//
//   node routines/controle-donnees/email.js [--prod] [--date AAAA-MM-JJ]
//   node routines/controle-donnees/email.js [--prod] --echec "message"
//
// Sorties (à côté du rapport) : <date>.email.html et <date>.email.json
// { to, subject, htmlFile, text, attachments: [{ file, filename, mimeType }] } — l'Excel des
// descriptifs (<date>.descriptifs.xlsx) est joint s'il existe.
// Plus un mail par regroupement de destinatairesParRegroupement (config.json, voir
// regroupements.js) : <date>.<slug>.email.html et .email.json, limité aux chiffres du
// regroupement, avec sa synthèse <date>.<slug>.synthese.md et son Excel s'ils existent.
// Pas de mail régional pour un échec.

import { readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { routineContext, ensureDir, readJson, loadRoutineConfig } from '../../lib/routine.js';
import { frDate } from '../../lib/chemins.js';
import { SITE_LIENS as SITE } from '../../lib/donnees.js';
import { COLORS, esc, fmt, variation, markdownToHtml, section, th, td, table, link, page } from '../../lib/email.js';
import { lienApp1, lienApp5, SANS_REGROUPEMENT } from './indicateurs.js';
import { regroupementsAEnvoyer } from './regroupements.js';
import { CHAMPS_VIDES } from './descriptifs.js';

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
    return intro + `<div style="overflow-x:auto">${table(head, [total, ...rows, sans])}</div>` + videsHtml(a) + pj;
}

// Champs vides de programsDescriptions.csv : à part des écarts, comptés par le script.
const majuscule = s => s[0].toUpperCase() + s.slice(1);
const nbVar = (n, d) => `${n ? `<strong>${fmt(n)}</strong>` : `<span style="color:${COLORS.muted}">0</span>`}`
    + `${variation(d, 'bad') ? `<br><span style="font-size:12px">${variation(d, 'bad')}</span>` : ''}`;
const VIDES_TITRE = '<h3 style="font-size:14px;margin:16px 0 4px">Champs vides</h3>';

function videsHtml(a) {
    const cv = a.champsVides;
    if (!cv) return '';
    const v = cv.variation;
    const head = th('Regroupement') + CHAMPS_VIDES.map(c => th(esc(majuscule(c)), 'center')).join('') + th('Programmes', 'center');
    const total = `<tr style="background:${COLORS.bg}">${td('<strong>Total</strong>')}`
        + CHAMPS_VIDES.map(c => td(nbVar(cv.parChamp[c] || 0, v.parChamp[c]), 'center')).join('')
        + td(nbVar(cv.total, v.total), 'center') + '</tr>';
    const rgs = [...new Set([...Object.keys(cv.parRegroupement), ...Object.keys(v.parRegroupement || {})])]
        .filter(rg => cv.parRegroupement[rg]?.total || v.parRegroupement?.[rg]?.total)
        .sort((x, y) => (x === SANS_REGROUPEMENT) - (y === SANS_REGROUPEMENT) || x.localeCompare(y, 'fr'));
    const rows = rgs.map(rg => {
        const r = cv.parRegroupement[rg] || {}, rv = v.parRegroupement?.[rg] || {};
        return `<tr>${td(`<strong>${esc(rg.split('|')[0].trim())}</strong>`)}`
            + CHAMPS_VIDES.map(c => td(nbVar(r[c] || 0, rv[c] ?? null), 'center')).join('')
            + td(nbVar(r.total || 0, rv.total ?? null), 'center') + '</tr>';
    });
    return VIDES_TITRE
        + `<p style="margin:0 0 6px;font-size:12px;color:${COLORS.muted}">Programmes diffusés B2C dont un champ du PIM est vide, enfants compris (lignes « Champs vides » de l'Excel).</p>`
        + `<div style="overflow-x:auto">${table(head, [total, ...rows])}</div>`;
}

function perimetres(report) {
    const items = [
        `<li><strong>Programmes et lots diffusés</strong> : ${esc(report.diffusion.perimetre)}.</li>`,
        ...report.indicateurs.map(i => `<li><strong>${esc(i.libelle)}</strong> : ${esc(i.perimetre)}.</li>`),
        `<li><strong>Descriptifs et stock</strong> : textes des programmes diffusés B2C (descriptif, événement, texte annonces, détails programme, forces de programme) comparés au stock disponible et commercialisable de toute leur famille (parent et enfants, autres lots compris) ; un programme compte une fois, à son écart le plus grave. Champs vides comptés à part, enfants compris. Contrôle propre à cette routine, sans équivalent dans les apps.</li>`
    ];
    return `<p style="margin:6px 0;font-size:12px;color:${COLORS.muted}">Chaque chiffre reprend les <strong>filtres par défaut</strong> de l'app ouverte par son lien, qui affiche donc la même liste.</p>`
        + `<ul style="margin:4px 0;padding-left:18px;font-size:12px;color:${COLORS.muted}">${items.join('')}</ul>`;
}

// Bandeau des modes test et recette ; pour un mail régional, rappelle à qui il partirait en prod.
function bandeau(destinatairesProd = null) {
    const texte = {
        recette: '<strong>Recette</strong> : chaîne de production complète (historique commité dans recette/, hors référence), envoyée au seul destinataire de test.',
        test: '<strong>Envoi de test</strong> : ce rapport n\'est pas historisé et ne sert pas de référence aux prochaines variations.'
    }[ctx.mode];
    if (!texte) return '';
    const prod = !destinatairesProd ? ''
        : destinatairesProd.length ? `<br>En prod, ce mail partirait à : ${esc(destinatairesProd.join(', '))}.`
        : '<br>Aucun destinataire configuré pour ce regroupement : ce mail ne part pas en prod.';
    return `<div style="margin:0 0 14px;padding:8px 12px;background:#FFF7E6;border-left:4px solid ${COLORS.warn};font-size:13px">${texte}${prod}</div>`;
}

function entete(report, surtitre, titre) {
    const ref = report.datePrecedente
        ? `Variations depuis le ${frDate(report.datePrecedente)}`
        : 'Premier rapport : pas encore de variation';
    return `<p style="margin:0;color:${COLORS.muted}">${esc(surtitre)}</p>`
        + `<h1 style="font-size:22px;margin:4px 0 2px;color:${COLORS.green}">${esc(titre)}</h1>`
        + `<p style="margin:0;color:${COLORS.muted};font-size:13px">${esc(ref)}</p>`;
}

function piedDePage(report) {
    return `<p style="margin:24px 0 0;font-size:11px;color:${COLORS.muted}">Mail généré automatiquement par la routine « ${esc(config.nom)} » `
        + `à partir des extractions du jour (${fmt(report.sources.programs)} programmes et ${fmt(report.sources.lots)} lots). `
        + `${link(SITE, 'outilsmarketing.kaufmanbroad.fr')}</p>`;
}

function buildHtml(report, synthese, xlsxName) {
    const parts = [];
    if (bandeau()) parts.push(bandeau());
    parts.push(entete(report, 'Outils marketing · Contrôle des données', `Point du ${longDate(report.date)}`));

    if (synthese) parts.push(section('Synthèse', markdownToHtml(synthese)));

    // Ordre voulu : les deux chiffres de l'offre, les problèmes de données, puis le détail de l'offre.
    parts.push(section('Offre diffusée', diffusionTiles(report), 'Programmes et lots diffusés en B2C'));
    parts.push(section('Problèmes de données', matrice(report, report.indicateurs),
        'Chaque chiffre ouvre la liste dans outilsMarketing, filtrée sur le regroupement'));
    parts.push(section('Descriptifs et stock', descriptifsHtml(report, xlsxName),
        'Descriptifs de programmes qui annoncent ce que le stock ne porte pas'));
    parts.push(section("Répartition de l'offre diffusée", repartitions(report)));

    parts.push(section('Périmètres', perimetres(report)));
    parts.push(piedDePage(report));
    return page(parts.join('\n'));
}

// ── Mail d'un regroupement : mêmes blocs, limités à ses chiffres ─────────────────────────

function diffusionTilesRg(report, rg) {
    const r = report.diffusion.parRegroupement[rg] || { programmes: 0, lots: 0, variation: {} };
    return `<table role="presentation" cellpadding="0" cellspacing="8" style="width:100%;border-collapse:separate"><tr>`
        + kpi('Programmes diffusés', r.programmes, r.variation?.programmes ?? null)
        + kpi('Lots diffusés', r.lots, r.variation?.lots ?? null) + '</tr></table>';
}

// Une ligne par indicateur : le nombre du regroupement, lien vers la liste filtrée.
function indicateursRg(report, rg) {
    const rows = report.indicateurs.map(i => `<tr>${td(esc(i.libelle))}`
        + td(cell(i.parRegroupement[rg] || 0, i.variationParRegroupement?.[rg] ?? null, lienIndicateur(i, rg)), 'center') + '</tr>');
    return table(th('Indicateur') + th('Nombre', 'center'), rows);
}

function descriptifsRg(report, rg, xlsxName) {
    const a = report.descriptifs;
    if (!a) return `<p style="color:${COLORS.muted}">Contrôle non disponible pour ce rapport.</p>`;
    const r = a.avecStock.parRegroupement[rg] || {};
    const rv = a.variation.parRegroupement?.[rg] || {};
    const sans = a.sansStock.parRegroupement[rg] || 0;
    const nv = (n, d) => `${n ? `<strong>${fmt(n)}</strong>` : `<span style="color:${COLORS.muted}">0</span>`}`
        + `${variation(d, 'bad') ? `<br><span style="font-size:12px">${variation(d, 'bad')}</span>` : ''}`;
    const total = (r.total || 0) + sans;
    const vTotal = rv.total === undefined || rv.total === null ? null : rv.total + (rv.sansStock || 0);
    const intro = `<p style="margin:6px 0 8px"><strong style="font-size:18px;color:${COLORS.green}">${fmt(total)}</strong> `
        + `programme${total > 1 ? 's ont' : ' a'} un descriptif en écart avec le stock de ${total > 1 ? 'leur' : 'sa'} famille`
        + `${variation(vTotal, 'bad') ? ` (${variation(vTotal, 'bad')})` : ''}.</p>`;
    const head = th('') + SEVS.map(([, l]) => th(l, 'center')).join('') + th('Total', 'center');
    const avec = `<tr>${td('<strong>Avec stock</strong>')}`
        + SEVS.map(([k]) => td(nv(r[k] || 0, rv[k] ?? null), 'center')).join('')
        + td(nv(r.total || 0, rv.total ?? null), 'center') + '</tr>';
    const sansRow = `<tr>${td('<strong>Sans stock</strong><br><span style="font-size:12px;color:' + COLORS.muted + '">le texte parle encore de stock — en fin de liste</span>')}`
        + td('').replace('<td ', '<td colspan="3" ') + td(nv(sans, rv.sansStock ?? null), 'center') + '</tr>';
    const pj = xlsxName
        ? `<p style="margin:8px 0 0;font-size:12px;color:${COLORS.muted}">Le détail (extrait du descriptif, stock disponible, constat et action, lien vers la page du programme) est dans l'Excel joint : <strong>${esc(xlsxName)}</strong>.</p>`
        : '';
    return intro + `<div style="overflow-x:auto">${table(head, [avec, sansRow])}</div>` + programmesRg(rg) + videsRg(a, rg) + pj;
}

// Liste des programmes en écart du regroupement (mail régional seulement) : liens Web et PIM,
// et pour chaque anomalie l'extrait en cause et le constat, abrégés. Lit les verdicts
// (<date>.descriptifs.json) et le dossier du jour ; absents (rapport rejoué), pas de liste.
const PIM = uuid => `https://ketb.cloud.akeneo.com/#/enrich/product/${encodeURIComponent(uuid)}`;
const SEV_COULEUR = { forte: COLORS.bad, moyenne: COLORS.warn, faible: COLORS.muted };
const abrege = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

function celluleProgramme(p) {
    const liens = [p.webLink && link(p.webLink, 'Web'), p.uuid && link(PIM(p.uuid), 'PIM')].filter(Boolean).join(' · ');
    return `<strong>${esc(p.nom || `Programme ${p.idProgram}`)}</strong>`
        + `<br><span style="font-size:12px;color:${COLORS.muted}">${esc(p.idProgram)}${p.ville ? ` · ${esc(p.ville)}` : ''}</span>`
        + (liens ? `<br><span style="font-size:12px">${liens}</span>` : '');
}

// Champs vides du regroupement : décompte par champ, puis les programmes concernés (dossier du jour).
function videsRg(a, rg) {
    const cv = a.champsVides;
    if (!cv) return '';
    const r = cv.parRegroupement[rg] || {}, rv = cv.variation.parRegroupement?.[rg] || {};
    const intro = `<p style="margin:0 0 6px"><strong style="font-size:16px;color:${COLORS.green}">${fmt(r.total || 0)}</strong> `
        + `programme${(r.total || 0) > 1 ? 's ont' : ' a'} au moins un champ vide dans le PIM`
        + `${variation(rv.total ?? null, 'bad') ? ` (${variation(rv.total, 'bad')})` : ''}.</p>`;
    if (!r.total) return VIDES_TITRE + intro;
    const decompte = table(CHAMPS_VIDES.map(c => th(esc(majuscule(c)), 'center')).join(''),
        [`<tr>${CHAMPS_VIDES.map(c => td(nbVar(r[c] || 0, rv[c] ?? null), 'center')).join('')}</tr>`]);
    const liste = detailDescriptifs ? Object.values(detailDescriptifs.dossierById)
        .filter(p => p.agencyRegions === rg && p.champsVides?.length)
        .sort((x, y) => String(x.idProgram).localeCompare(String(y.idProgram), 'fr', { numeric: true }))
        .map(p => `<tr>${td(celluleProgramme(p), 'left', 'width:34%')}${td(esc(p.champsVides.map(majuscule).join(', ')))}</tr>`) : [];
    return VIDES_TITRE + intro + `<div style="overflow-x:auto">${decompte}</div>`
        + (liste.length ? `<div style="margin-top:8px">${table(th('Programme') + th('Champs vides'), liste)}</div>` : '');
}

function programmesRg(rg) {
    if (!detailDescriptifs) return '';
    const { verdicts, dossierById } = detailDescriptifs;
    const rang = e => (e.sansStock ? 3 : Math.min(...e.anomalies.map(a => SEVS.findIndex(([k]) => k === a.severite))));
    const liste = verdicts
        .filter(e => e.anomalies.length && dossierById[e.idProgram]?.agencyRegions === rg)
        .sort((x, y) => rang(x) - rang(y) || x.idProgram.localeCompare(y.idProgram, 'fr', { numeric: true }));
    if (!liste.length) return '';
    const rows = liste.map(e => {
        const p = dossierById[e.idProgram];
        const prog = celluleProgramme(p);
        const anomalies = [...e.anomalies]
            .sort((a, b) => SEVS.findIndex(([k]) => k === a.severite) - SEVS.findIndex(([k]) => k === b.severite))
            .map(a => `<div style="margin:0 0 6px">`
                + `<span style="font-size:11px;font-weight:600;color:${e.sansStock ? COLORS.muted : SEV_COULEUR[a.severite]}">`
                + `${esc(e.sansStock ? 'Sans stock' : majuscule(a.severite))} · ${esc(a.type)}`
                + `${a.champ && !['descriptif', 'stock'].includes(a.champ) ? ` · ${esc(a.champ)}` : ''}</span><br>`
                + `<span style="font-style:italic">« ${esc(abrege(a.extrait, 110))} »</span>`
                + (a.constat ? `<br><span style="font-size:12px;color:${COLORS.muted}">${esc(abrege(a.constat, 150))}</span>` : '')
                + '</div>').join('');
        return `<tr>${td(prog, 'left', 'width:34%')}${td(anomalies)}</tr>`;
    });
    return `<h3 style="font-size:14px;margin:16px 0 4px">Programmes concernés</h3>`
        + table(th('Programme') + th('Ce qui cloche'), rows);
}

function buildHtmlRg(report, m, synthese, xlsxName) {
    const parts = [];
    if (bandeau(m.destinataires)) parts.push(bandeau(m.destinataires));
    parts.push(entete(report, `Outils marketing · Contrôle des données · ${m.nom}`, `${m.nom} — point du ${longDate(report.date)}`));
    if (synthese) parts.push(section('Synthèse', markdownToHtml(synthese)));
    parts.push(section('Offre diffusée', diffusionTilesRg(report, m.rg), `Programmes et lots diffusés en B2C — ${m.nom}`));
    parts.push(section('Problèmes de données', indicateursRg(report, m.rg),
        'Chaque chiffre ouvre la liste dans outilsMarketing, filtrée sur le regroupement'));
    parts.push(section('Descriptifs et stock', descriptifsRg(report, m.rg, xlsxName),
        'Descriptifs de programmes qui annoncent ce que le stock ne porte pas'));
    parts.push(section('Périmètres', perimetres(report)));
    parts.push(piedDePage(report));
    return page(parts.join('\n'));
}

function buildFailureHtml(message) {
    return page(`<p style="margin:0;color:${COLORS.muted}">Outils marketing · Contrôle des données</p>`
        + `<h1 style="font-size:20px;margin:4px 0 12px;color:${COLORS.bad}">Le rapport du ${esc(frDate(ctx.date))} n'a pas pu être produit</h1>`
        + `<p>La routine a échoué avant la fin de l'analyse. Aucun chiffre n'est envoyé et aucun historique n'est écrit.</p>`
        + `<pre style="white-space:pre-wrap;background:${COLORS.bg};padding:10px;font-size:12px">${esc(message)}</pre>`);
}

// Version texte : la synthèse sans Markdown, puis le lien vers les outils.
const texteSynthese = synthese => synthese.split(/\r?\n/)
    .map(l => l.replace(/^[-*]\s+/, '- ').replace(/\*\*/g, '').replace(/^#+\s*/, '').trim())
    .filter(Boolean).join('\n');

await ensureDir(ctx.outDir);
// Mails régionaux d'une exécution précédente du jour : effacés, la config a pu changer.
for (const f of (await readdir(ctx.outDir)).filter(f => f.startsWith(`${ctx.date}.`) && f !== `${ctx.date}.email.json`
    && f !== `${ctx.date}.email.html` && /\.email\.(json|html)$/.test(f))) {
    await rm(path.join(ctx.outDir, f));
}
const xlsxFile = ctx.file('descriptifs.xlsx');
const xlsxName = !echec && existsSync(xlsxFile) ? `${ctx.date}.descriptifs.xlsx` : null;
let html, text, report;
if (echec) {
    html = buildFailureHtml(echec);
    text = `Le rapport du ${frDate(ctx.date)} n'a pas pu être produit.\n\n${echec}`;
} else {
    if (!existsSync(ctx.file('json'))) throw new Error(`Rapport absent : ${ctx.file('json')} — lancer d'abord l'analyse`);
    report = await readJson(ctx.file('json'));
    const synthese = existsSync(ctx.file('synthese.md')) ? await readFile(ctx.file('synthese.md'), 'utf8') : '';
    html = buildHtml(report, synthese, xlsxName);
    text = texteSynthese(synthese)
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

let detailDescriptifs = null;
if (!echec && existsSync(ctx.file('descriptifs.json')) && existsSync(ctx.file('descriptifs.dossier.json'))) {
    const dossier = await readJson(ctx.file('descriptifs.dossier.json'));
    detailDescriptifs = {
        verdicts: (await readJson(ctx.file('descriptifs.json'))).programmes,
        dossierById: Object.fromEntries(dossier.programmes.map(p => [String(p.idProgram), p]))
    };
}

if (!echec) {
    const { mails, alertes } = regroupementsAEnvoyer(config, report, ctx.mode);
    for (const m of mails) {
        const fSynthese = ctx.file(`${m.slug}.synthese.md`);
        const synthese = existsSync(fSynthese) ? await readFile(fSynthese, 'utf8') : '';
        const fXlsx = ctx.file(`${m.slug}.descriptifs.xlsx`);
        const xlsxRg = existsSync(fXlsx) ? `${ctx.date}.descriptifs.${m.slug}.xlsx` : null;
        const htmlRg = ctx.file(`${m.slug}.email.html`);
        await writeFile(htmlRg, buildHtmlRg(report, m, synthese, xlsxRg));
        const subjectRg = `${prefix}${config.nom} — ${m.nom} — point du ${frDate(ctx.date)}`;
        const textRg = texteSynthese(synthese)
            + `\n\nDétail : ${SITE}/apps/controleDonnees.html`
            + (xlsxRg ? `\nExcel joint : ${xlsxRg}` : '');
        const attRg = xlsxRg ? [{ file: fXlsx, filename: xlsxRg, mimeType: XLSX_MIME }] : [];
        await writeFile(ctx.file(`${m.slug}.email.json`),
            JSON.stringify({ to: m.to, subject: subjectRg, htmlFile: htmlRg, text: textRg, attachments: attRg }, null, 2) + '\n');
        console.log(`Mail régional prêt : ${subjectRg} — à ${m.to.join(', ')}`
            + (synthese ? '' : ` (SANS synthèse : ${fSynthese} absent)`) + (xlsxRg ? ` + ${xlsxRg}` : ''));
    }
    if (!mails.length) console.log('Aucun mail régional (aucun regroupement avec destinataires).');
    for (const a of alertes) console.log(`Alerte : ${a}`);
}
