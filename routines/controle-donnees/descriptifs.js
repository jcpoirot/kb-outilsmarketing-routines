// Cohérence descriptifs / stock — partie déterministe.
//
// Pour chaque programme de programsDescriptions.csv (programmes diffusés B2C), prépare le
// dossier que Claude relit : texte du descriptif sans HTML, famille parent / enfants, stock du
// programme et de sa famille, offre, statut, et un `hash` du tout. Le jugement sur le texte
// (anomalies, sévérité) est l'étape Claude du ROUTINE.md ; ce contrôle n'a pas d'équivalent
// dans les apps (pas de parité). Notions : outilsMarketing/.claude/rules/ontologie.md
// (« Famille de programmes », « Cohérence descriptif / stock »).

import { createHash } from 'node:crypto';

const norm = v => String(v || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[\s-]/g, '');
const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const isPlaceholderName = v => !v || /^\[\d+\]$/.test(String(v).trim());

// ── Dates et offres (même règle que outilsMarketing/shared/offers.js) ───────────────────

function offerEndDay(raw) {
    const s = String(raw || '').trim();
    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (m) return `${m[3]}-${m[2]}-${m[1]}`;
    return null;
}
// Jour de fin inclus, comparaison de chaînes ; `day` = date du rapport (pas l'horloge).
const offerValid = (raw, day) => { const end = offerEndDay(raw); return end !== null && end >= day; };

// ── Notions de l'ontologie ──────────────────────────────────────────────────────────────

// Disponible : Libre, Option ou vide. Commercialisable : ni virtuel, ni grille non validée.
const isAvailable = lot => ['libre', 'option', ''].includes(norm(lot.unitStatePPM));
const isVirtual = lot => lot.virtualUnit === '1';
const isGridKo = lot => lot.ppmGridValidation === '0';

// Typologie lisible : Studio, T{n} (appartements, pièces), Maison {n} ch. ; autres lots : leur
// typologie telle quelle (Parking, Local commercial…).
function typoLabel(lot, other) {
    const t = (lot.typologie || '').trim();
    if (other) return t || 'Autre lot';
    if (/^studio/i.test(t)) return 'Studio';
    if (/^maison/i.test(t)) {
        const n = parseInt(lot.numberOfBedrooms, 10) || parseInt((t.match(/(\d+)/) || [])[1], 10);
        return n ? `Maison ${n} ch.` : 'Maison';
    }
    if (/^appartement/i.test(t)) {
        const n = parseInt(lot.numberOfRooms, 10) || parseInt((t.match(/(\d+)/) || [])[1], 10);
        return n ? `T${n}` : 'Appartement';
    }
    return t || 'Sans typologie';
}

function typoRank(label) {
    if (label === 'Studio') return 1;
    let m = label.match(/^T(\d+)$/);
    if (m) return +m[1];
    m = label.match(/^Maison (\d+)/);
    if (m) return 100 + +m[1];
    return 1000;
}

// Prix de base (standardPrice, sinon reducedPrice), remise du lot déduite si son offre est valable.
function lotPrice(lot, day) {
    const std = num(lot.standardPrice), red = num(lot.reducedPrice);
    const base = std > 0 ? std : red > 0 ? red : 0;
    if (!base) return null;
    const remise = offerValid(lot.offerEndDate, day) ? Math.max(0, num(lot.discountB2C)) : 0;
    return Math.round(base - remise);
}

// ── HTML → texte ────────────────────────────────────────────────────────────────────────

const ENTITIES = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", rsquo: '’', lsquo: '‘',
    ldquo: '“', rdquo: '”', laquo: '«', raquo: '»', hellip: '…', euro: '€', eacute: 'é', egrave: 'è',
    ecirc: 'ê', agrave: 'à', acirc: 'â', ccedil: 'ç', ocirc: 'ô', ucirc: 'û', icirc: 'î', iuml: 'ï',
    ndash: '–', mdash: '—', deg: '°', sup2: '²', middot: '·', bull: '•' };

export function htmlToText(html) {
    return String(html || '')
        .replace(/<\s*(br|\/p|\/div|\/li|\/h\d|\/ul|\/ol|\/tr)\b[^>]*>/gi, '\n')
        .replace(/<\s*li\b[^>]*>/gi, '\n- ')
        .replace(/<[^>]+>/g, '')
        .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
        .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
        .replace(/&([a-z0-9]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m)
        .replace(/[\u200b-\u200d\ufeff]/g, '')
        .replace(/[ \t\u00a0]+/g, ' ')
        .split('\n').map(l => l.trim()).filter(Boolean).join('\n');
}

// ── Stock ───────────────────────────────────────────────────────────────────────────────

const range = (a, b) => (a === null ? null : [a, b]);

// Résumé du stock d'un ensemble de lots (logements et autres lots d'un programme ou d'une
// famille). Seuls comptent les lots DIFFUSÉS (`diffuse`), disponibles et commercialisables ; les
// virtuels diffusés sont à part. `etats` / `logementsTotal` décrivent toute la résidence (lots
// vendus compris) et ne servent qu'à juger un nombre total de logements annoncé.
export function stockSummary(housing, others, day, diffuse = () => true) {
    const dispo = housing.filter(l => diffuse(l) && isAvailable(l) && !isVirtual(l) && !isGridKo(l));
    const parTypologie = {};
    let sMin = null, sMax = null, pMin = null, pMax = null;
    let tvaReduite = 0, remisesLots = 0, remiseMax = 0, fnoLots = 0;
    const ratios = [];
    for (const l of dispo) {
        const t = typoLabel(l, false);
        const e = parTypologie[t] ||= { n: 0, surface: null, prix: null };
        e.n++;
        const s = num(l.surface), p = lotPrice(l, day);
        if (s > 0) {
            e.surface = e.surface ? [Math.min(e.surface[0], s), Math.max(e.surface[1], s)] : [s, s];
            sMin = sMin === null ? s : Math.min(sMin, s); sMax = sMax === null ? s : Math.max(sMax, s);
        }
        if (p) {
            e.prix = e.prix ? [Math.min(e.prix[0], p), Math.max(e.prix[1], p)] : [p, p];
            pMin = pMin === null ? p : Math.min(pMin, p); pMax = pMax === null ? p : Math.max(pMax, p);
            if (s > 0) ratios.push({ lot: l, ratio: p / s, prix: p, surface: s });
        }
        if (num(l.reducedPrice) > 0) tvaReduite++;
        if (offerValid(l.offerEndDate, day)) {
            if (num(l.discountB2C) > 0) { remisesLots++; remiseMax = Math.max(remiseMax, num(l.discountB2C)); }
            if (l.notaryFeesOfferedB2C === '1') fnoLots++;
        }
    }
    for (const e of Object.values(parTypologie)) {
        if (e.surface) e.surface = e.surface.map(v => Math.round(v * 100) / 100);
    }
    // Prix aberrant : prix au m² à plus du double ou à moins de la moitié de la médiane des lots du
    // même régime de TVA (un lot à TVA réduite, BRS ou accession aidée, vaut souvent moitié
    // moins : ce n'est pas une erreur de grille). Médiane sur 3 lots au moins.
    const regime = l => (num(l.reducedPrice) > 0 ? 'reduite' : 'normale');
    const prixAberrants = [];
    for (const reg of ['normale', 'reduite']) {
        const group = ratios.filter(r => regime(r.lot) === reg);
        if (group.length < 3) continue;
        const sorted = group.map(r => r.ratio).sort((a, b) => a - b);
        const median = sorted[Math.floor(sorted.length / 2)];
        for (const r of group.filter(r => r.ratio > 2 * median || r.ratio < median / 2)) {
            prixAberrants.push({
                lot: r.lot.idKb || r.lot.commercialCode, typologie: typoLabel(r.lot, false), surface: r.surface,
                prix: r.prix, prixM2: Math.round(r.ratio), medianeM2: Math.round(median),
                tva: reg === 'reduite' ? 'réduite' : 'normale'
            });
        }
    }

    const virtuels = {};
    housing.filter(l => diffuse(l) && isAvailable(l) && isVirtual(l)).forEach(l => {
        const t = typoLabel(l, false); virtuels[t] = (virtuels[t] || 0) + 1;
    });
    const autresLots = {};
    others.filter(l => diffuse(l) && isAvailable(l) && !isVirtual(l) && !isGridKo(l)).forEach(l => {
        const t = typoLabel(l, true); autresLots[t] = (autresLots[t] || 0) + 1;
    });
    const etats = {};
    housing.filter(l => !isVirtual(l)).forEach(l => {
        const s = (l.unitStatePPM || '').trim() || 'Non renseigné'; etats[s] = (etats[s] || 0) + 1;
    });
    const sortTypo = o => Object.fromEntries(Object.entries(o).sort(([a], [b]) => typoRank(a) - typoRank(b) || a.localeCompare(b, 'fr')));
    return {
        logementsDisponibles: dispo.length,
        parTypologie: sortTypo(parTypologie),
        surface: range(sMin, sMax),
        prix: range(pMin, pMax),
        tvaReduite,
        remisesLotsValables: remisesLots ? { lots: remisesLots, max: remiseMax } : null,
        fnoLotsValables: fnoLots,
        horsGrille: housing.filter(l => diffuse(l) && isAvailable(l) && !isVirtual(l) && isGridKo(l)).length,
        virtuels: sortTypo(virtuels),
        autresLots,
        logementsTotal: Object.values(etats).reduce((s, n) => s + n, 0),
        etats,
        prixAberrants
    };
}

const fmtN = n => Number(n).toLocaleString('fr-FR');
const fmtR = (r, unit) => (r ? (r[0] === r[1] ? `${fmtN(r[0])} ${unit}` : `${fmtN(r[0])}–${fmtN(r[1])} ${unit}`) : '');

// Une ligne lisible, reprise dans l'Excel (« Stock disponible »).
export function stockText(s) {
    const parts = [];
    if (s.logementsDisponibles) {
        parts.push(`${s.logementsDisponibles} logement${s.logementsDisponibles > 1 ? 's' : ''} : `
            + Object.entries(s.parTypologie).map(([t, e]) => `${t} ×${e.n}`).join(', ')
            + (s.surface ? ` ; ${fmtR(s.surface, 'm²')}` : '') + (s.prix ? ` ; ${fmtR(s.prix, '€')}` : '')
            + (s.tvaReduite ? ` ; ${s.tvaReduite} à TVA réduite` : ''));
    } else {
        parts.push('aucun logement diffusé disponible');
    }
    const v = Object.entries(s.virtuels);
    if (v.length) parts.push(`virtuels : ${v.map(([t, n]) => `${t} ×${n}`).join(', ')}`);
    const o = Object.entries(s.autresLots);
    if (o.length) parts.push(`autres lots : ${o.map(([t, n]) => `${t} ×${n}`).join(', ')}`);
    return parts.join(' — ');
}

// ── Dossier ─────────────────────────────────────────────────────────────────────────────

export function buildDossier({ programs, lots, otherUnits, programsDescriptions }, day, previous) {
    const programsMap = Object.fromEntries(programs.map(p => [p.idProgram, p]));
    const parentOf = {}, children = {};
    for (const p of programs) {
        const parent = (p.parentOperationCode || '').trim();
        if (!parent || parent === p.idProgram) continue;
        parentOf[p.idProgram] = parent;
        (children[parent] ||= []).push(p.idProgram);
    }
    const rootOf = id => {
        const seen = new Set([id]);
        while (parentOf[id] && !seen.has(parentOf[id])) { id = parentOf[id]; seen.add(id); }
        return id;
    };
    const familyOf = id => {
        const root = rootOf(id), out = [], todo = [root], seen = new Set();
        while (todo.length) {
            const c = todo.shift();
            if (seen.has(c)) continue;
            seen.add(c); out.push(c);
            todo.push(...(children[c] || []));
        }
        return { racine: root, membres: out };
    };

    const lotsByProg = {}, othersByProg = {}, names = {};
    for (const l of lots) {
        (lotsByProg[l.operationCode] ||= []).push(l);
        if (!names[l.operationCode] && !isPlaceholderName(l.operationName)) names[l.operationCode] = l.operationName;
    }
    for (const l of otherUnits) {
        (othersByProg[l.operationCode] ||= []).push(l);
        if (!names[l.operationCode] && !isPlaceholderName(l.operationName)) names[l.operationCode] = l.operationName;
    }

    // Lot diffusé (ontologie) : lot diffusé B2C ET programme diffusé B2C dans programs.csv.
    const diffuse = l => l.isUnitPublishedB2C === '1' && programsMap[l.operationCode]?.isProgramPublishedB2C === '1';

    const textes = {};
    for (const d of programsDescriptions) textes[d.idProgram] = htmlToText(d.description);
    const byText = {};
    for (const [id, t] of Object.entries(textes)) if (t) (byText[t] ||= []).push(id);

    const prevById = Object.fromEntries((previous?.programmes || []).map(e => [String(e.idProgram), e]));

    const programmes = programsDescriptions.map(d => {
        const id = d.idProgram;
        const p = programsMap[id] || {};
        const fam = familyOf(id);
        const famLots = fam.membres.flatMap(m => lotsByProg[m] || []);
        const famOthers = fam.membres.flatMap(m => othersByProg[m] || []);
        const stock = stockSummary(lotsByProg[id] || [], othersByProg[id] || [], day, diffuse);
        const stockFamille = fam.membres.length > 1 ? stockSummary(famLots, famOthers, day, diffuse) : stock;
        const autresDispo = Object.values(stockFamille.autresLots).reduce((s, n) => s + n, 0);
        const virtuelsDispo = Object.values(stockFamille.virtuels).reduce((s, n) => s + n, 0);
        const texte = textes[id];
        // Événement (merchandisingTitle / merchandisingDescription) : analysé comme le descriptif.
        const evenement = (d.merchandisingTitle || d.merchandisingDescription)
            ? { titre: htmlToText(d.merchandisingTitle) || null, description: htmlToText(d.merchandisingDescription) || null }
            : null;
        const parent = parentOf[id] || ((d.parentOperationCode || '').trim() !== id ? (d.parentOperationCode || '').trim() : '') || null;
        const copies = (byText[texte] || []).filter(o => o !== id);
        const offre = {
            ref: p.offerRef || null,
            debut: p.offerStartDate || null,
            fin: p.offerEndDate || null,
            valable: offerValid(p.offerEndDate, day),
            fraisNotaireOfferts: p.notaryFeesOfferedB2C === '1',
            remiseMax: num(p.maxDiscountProgramB2C) || null,
            offreLibre: p.customOfferB2C || null,
            mentions: htmlToText(p.legalNoticeB2C).slice(0, 400) || null
        };
        const dossier = {
            idProgram: id,
            nom: names[id] || null,
            ville: p.city || null,
            departement: p.departmentCode || null,
            agencyRegions: p.agencyRegions || null,
            webLink: p.webLink || `https://www.kaufmanbroad.fr/program/${id}`,
            statutProgramme: p.programStatus || null,
            parent,
            famille: fam.membres.length > 1 ? fam.membres : [],
            texte,
            texteVide: !texte,
            texteIdentiqueParent: !!(parent && texte && textes[parent] === texte),
            texteIdentiqueA: copies.map(o => ({ idProgram: o, memeFamille: fam.membres.includes(o) })),
            evenement,
            offre,
            // Sans stock : aucun lot diffusé disponible dans la famille, logements (virtuels compris)
            // ou autres lots.
            sansStock: !stockFamille.logementsDisponibles && !virtuelsDispo && !autresDispo,
            virtuelsSeuls: !stockFamille.logementsDisponibles && virtuelsDispo > 0,
            stock,
            stockFamille
        };
        dossier.hash = createHash('sha256').update(JSON.stringify({
            texte, evenement, ville: dossier.ville, statut: dossier.statutProgramme, parent, offre,
            texteIdentiqueA: dossier.texteIdentiqueA, stock, stockFamille
        })).digest('hex').slice(0, 16);
        const prev = prevById[id];
        dossier.aRelire = !(prev && prev.hash === dossier.hash);
        return dossier;
    });

    return { date: day, previousDate: previous?.date || null, programmes };
}
