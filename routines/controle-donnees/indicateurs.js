// Indicateurs de la routine « Contrôle des données ».
//
// Chaque contrôle REPREND le code de l'app (outilsMarketing/apps/controleDonnees.html pour
// l'App 5, apps/analyseImages.html pour l'App 1), filtres par défaut compris, y compris ses
// particularités : le chiffre du mail doit être celui qu'affiche le lien. Toute évolution
// d'un contrôle dans l'app est à reporter ici (et inversement).

import { SITE } from '../../lib/donnees.js';

export const SANS_REGROUPEMENT = 'Sans regroupement';

// Ordre de cycle de vie, pour la répartition par état d'avancement. Un statut inconnu
// passe à la suite, dans l'ordre alphabétique ; « Sans statut » ferme la liste.
const STATUS_ORDER = ['avantpremiere', 'lancementcommercial', 'nouveaute', 'adecouvrir',
    'entravaux', 'livraisonrapide', 'dernieresopportunites'];

// ── Helpers de l'App 5 (mêmes noms) ──────────────────────────────────────────

const isEmpty = v => !v || String(v).trim() === '';
const isRentMissing = v => isEmpty(v) || parseFloat(v) === 0;
const norm = v => String(v || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[\s-]/g, '');
const isArchived = prog => norm(prog?.statutBackbone) === 'archive';
const isLmnpGere = prog => {
    const t = (prog?.taxIncentives || '').trim();
    return t === 'LMNP géré' || /\[lmnpgere\]/i.test(t);
};
const hasInvestmentScheme = prog => {
    const t = (prog?.taxIncentives || '').toLowerCase();
    return /\[patrimonial\]/.test(t) || /\[lmnp\]/.test(t);
};
const SOLD_STATES = new Set(['vendu', 'livre']);
const isLotSold = lot => SOLD_STATES.has(norm(lot.unitStatePPM));
const isVirtualUnit = lot => lot.virtualUnit === '1';
const isGridUnvalidated = lot => lot.ppmGridValidation === '0';

function parseFeesByTypology(raw) {
    if (!raw) return [];
    try { return JSON.parse(raw); } catch {}
    const entries = [];
    const objRe = /\{([^}]+)\}/g;
    let m;
    while ((m = objRe.exec(raw)) !== null) {
        const obj = {};
        const kvRe = /(\w+):([^,\s}]+)/g;
        let kv;
        while ((kv = kvRe.exec(m[1])) !== null) obj[kv[1]] = kv[2];
        if (obj.simplifiedUnitTypology !== undefined) entries.push(obj);
    }
    return entries;
}

function hasAllZeroFees(prog) {
    const arr = parseFeesByTypology((prog.feesByTypology || '').trim());
    if (!arr.length) return true;
    return arr.every(e => !e.fees || parseFloat(e.fees) === 0);
}

// ── Liens ────────────────────────────────────────────────────────────────────

// Le hash porte l'onglet et le regroupement d'agences (filtre « Regroupement agences »).
export function lienApp5(slug, regroupement) {
    const q = regroupement && regroupement !== SANS_REGROUPEMENT ? `?regroupement=${encodeURIComponent(regroupement)}` : '';
    return `${SITE}/apps/controleDonnees.html#/${slug}${q}`;
}

export function lienApp1(regroupement) {
    const q = regroupement && regroupement !== SANS_REGROUPEMENT ? `?regroupement=${encodeURIComponent(regroupement)}` : '';
    return `${SITE}/apps/analyseImages.html#/${q}`;
}

// ── Calcul ───────────────────────────────────────────────────────────────────

function countBy(items, keyFn) {
    const out = {};
    for (const it of items) {
        const k = keyFn(it) || SANS_REGROUPEMENT;
        out[k] = (out[k] || 0) + 1;
    }
    return out;
}

export function computeIndicateurs({ programs, lots, otherUnits }) {
    const programsMap = {};
    programs.forEach(p => { programsMap[p.idProgram] = p; });

    const childrenByParent = {};
    programs.forEach(p => {
        const parent = (p.parentOperationCode || '').trim();
        if (!parent || parent === p.idProgram) return;
        (childrenByParent[parent] ||= []).push(p.idProgram);
    });

    const lotCountsByProg = {};
    const lotsByProg = {};
    lots.forEach(lot => {
        const code = lot.operationCode;
        if (!code) return;
        const c = lotCountsByProg[code] ||= { b2c: 0, b2b: 0, total: 0, remaining: 0 };
        (lotsByProg[code] ||= []).push(lot);
        c.total++;
        if (lot.isUnitPublishedB2C === '1') c.b2c++;
        if (lot.isUnitPublishedB2B === '1') c.b2b++;
        if (!isLotSold(lot)) c.remaining++;
    });
    const otherCountsByProg = {};
    const otherLotsByProg = {};
    otherUnits.forEach(unit => {
        const code = unit.operationCode;
        if (!code) return;
        const c = otherCountsByProg[code] ||= { total: 0, remaining: 0 };
        (otherLotsByProg[code] ||= []).push(unit);
        c.total++;
        if (!isLotSold(unit)) c.remaining++;
    });

    const progStock = id => {
        const l = lotCountsByProg[id] || { total: 0, remaining: 0 };
        const o = otherCountsByProg[id] || { total: 0, remaining: 0 };
        return { total: l.total + o.total, remaining: l.remaining + o.remaining };
    };
    const childrenWithStock = id => (childrenByParent[id] || [])
        .filter(code => !isArchived(programsMap[code]))
        .filter(code => [...(lotsByProg[code] || []), ...(otherLotsByProg[code] || [])].some(l => !isLotSold(l)));

    // Statut programme par défaut (onglets 1 à 6) : tout sauf Avant-première, « sans
    // statut » compris s'il existe dans les données.
    const statusOk = prog => norm(prog?.programStatus) !== 'avantpremiere';

    // Onglet 1 — getFilteredLots + getErrorLots, filtres par défaut (programme diffusé,
    // lot diffusé). Un lot dont le programme est absent de programs.csv passe le filtre
    // de diffusion programme : c'est le comportement de l'app.
    const sansLoyer = lots.filter(lot => {
        const prog = programsMap[lot.operationCode];
        if (isArchived(prog)) return false;
        if (!statusOk(prog)) return false;
        if (prog && prog.isProgramPublishedB2C !== '1') return false;
        if (lot.isUnitPublishedB2C !== '1') return false;
        if (isLmnpGere(prog || {})) return false;
        return isRentMissing(lot.marketMonthlyRent) || isRentMissing(lot.lmnpMonthlyRent);
    });

    // Onglets 2, 4, 5 — getFilteredPrograms (programme diffusé B2C par défaut).
    const progsFiltres = programs.filter(p => !isArchived(p) && p.isProgramPublishedB2C === '1' && statusOk(p));

    const sansCharges = progsFiltres.filter(p => {
        if (isLmnpGere(p) || !isEmpty(p.estimatedMonthlyChargesPerSqM)) return false;
        if (!hasInvestmentScheme(p)) return false;
        const c = lotCountsByProg[p.idProgram] || { b2c: 0, b2b: 0 };
        return c.b2c > 0 || c.b2b > 0;
    });

    const sansHonoraires = progsFiltres.filter(p => {
        if (!hasAllZeroFees(p)) return false;
        if (p.isProgramPublishedB2B !== '1') return false;
        return (lotCountsByProg[p.idProgram] || { b2b: 0 }).b2b > 0;
    });

    // Onglet 5, seuil par défaut « Aucun lot restant ».
    const ecoules = progsFiltres.filter(p => {
        const c = progStock(p.idProgram);
        if (c.total === 0) return childrenWithStock(p.idProgram).length > 0;
        return c.remaining === 0;
    });

    // Onglet 6 — disponibilité « Libre » seule, toutes familles, toutes causes. Ignore le
    // filtre « Diffusion Programme ».
    const nonDiffuses = [...lots, ...otherUnits].filter(lot => {
        if (norm(lot.unitStatePPM) !== 'libre') return false;
        if (isVirtualUnit(lot) || isGridUnvalidated(lot)) return false;
        const prog = programsMap[lot.operationCode] || {};
        if (isArchived(prog) || !statusOk(prog)) return false;
        return prog.isProgramPublishedB2C !== '1' || lot.isUnitPublishedB2C !== '1';
    });

    // Onglet 7 — lots virtuels inclus, Avant-première incluse (défauts de l'onglet).
    const sansPlan = lots.filter(lot => {
        if (!isEmpty(lot.floorPlan) || lot.isUnitPublishedB2C !== '1') return false;
        const prog = programsMap[lot.operationCode];
        return prog && prog.isProgramPublishedB2C === '1' && !isArchived(prog);
    });

    // App 1 — lots diffusés B2C des programmes diffusés B2C, sans unitImageLink. L'app ne
    // teste ni l'archivage ni le statut. Le regroupement d'un programme est celui de son
    // premier lot (sinon celui du programme), comme dans generateProgramTable.
    const progRegroupementApp1 = {};
    lots.forEach(lot => {
        if (progRegroupementApp1[lot.operationCode] !== undefined) return;
        progRegroupementApp1[lot.operationCode] = lot.agencyRegions || programsMap[lot.operationCode]?.agencyRegions || '';
    });
    const sansImages = lots.filter(lot => programsMap[lot.operationCode]?.isProgramPublishedB2C === '1'
        && lot.isUnitPublishedB2C === '1' && !lot.unitImageLink);

    const indicateurs = [
        {
            cle: 'sansPlan', libelle: 'Lots sans plan de vente', unite: 'lot', slug: 'plan-de-vente',
            perimetre: 'Lots diffusés B2C (programme et lot), lots virtuels et Avant-première inclus',
            parRegroupement: countBy(sansPlan, l => l.agencyRegions)
        },
        {
            cle: 'sansLoyer', libelle: 'Lots sans loyer', unite: 'lot', slug: 'loyers',
            perimetre: 'Loyer patrimonial ou LMNP manquant, lots diffusés B2C, hors LMNP géré et Avant-première',
            parRegroupement: countBy(sansLoyer, l => l.agencyRegions)
        },
        {
            cle: 'sansImages', libelle: 'Lots sans image', unite: 'lot', app: 1,
            perimetre: 'Lots diffusés B2C des programmes diffusés B2C, Avant-première incluse',
            parRegroupement: countBy(sansImages, l => progRegroupementApp1[l.operationCode])
        },
        {
            cle: 'sansCharges', libelle: 'Programmes sans charges estimées', unite: 'programme', slug: 'charges',
            perimetre: 'Programmes diffusés B2C en investissement locatif (patrimonial ou LMNP), hors LMNP géré et Avant-première',
            parRegroupement: countBy(sansCharges, p => p.agencyRegions)
        },
        {
            cle: 'sansHonoraires', libelle: 'Programmes sans honoraires prescripteurs', unite: 'programme', slug: 'honoraires',
            perimetre: 'Programmes diffusés B2C et B2B ayant des lots B2B, hors Avant-première',
            parRegroupement: countBy(sansHonoraires, p => p.agencyRegions)
        },
        {
            cle: 'ecoules', libelle: 'Programmes écoulés encore diffusés', unite: 'programme', slug: 'ecoules', signal: true,
            perimetre: 'Programmes diffusés B2C sans aucun lot restant (parkings et commerces compris), hors Avant-première',
            parRegroupement: countBy(ecoules, p => p.agencyRegions)
        },
        {
            cle: 'nonDiffuses', libelle: 'Lots libres non diffusés', unite: 'lot', slug: 'non-diffuses', signal: true,
            perimetre: 'Lots « Libre » dont le lot ou le programme n\'est pas diffusé B2C, hors lots virtuels, grille non validée et Avant-première',
            parRegroupement: countBy(nonDiffuses, l => l.agencyRegions)
        }
    ];
    for (const ind of indicateurs) {
        ind.total = Object.values(ind.parRegroupement).reduce((s, n) => s + n, 0);
        ind.lien = ind.app === 1 ? lienApp1() : lienApp5(ind.slug);
    }

    // ── Diffusion : programmes et lots diffusés B2C, hors programmes archivés ──
    const progsDiffuses = programs.filter(p => p.isProgramPublishedB2C === '1' && !isArchived(p));
    const diffuses = new Set(progsDiffuses.map(p => p.idProgram));
    const lotsDiffuses = lots.filter(l => l.isUnitPublishedB2C === '1' && diffuses.has(l.operationCode));

    const statuts = {};
    progsDiffuses.forEach(p => {
        const s = statuts[p.programStatus || ''] ||= { statut: p.programStatus || 'Sans statut', programmes: 0, lots: 0 };
        s.programmes++;
    });
    lotsDiffuses.forEach(l => { statuts[programsMap[l.operationCode].programStatus || ''].lots++; });
    const rank = s => {
        if (s === 'Sans statut') return 1000;
        const i = STATUS_ORDER.indexOf(norm(s));
        return i === -1 ? 500 : i;
    };
    const parStatut = Object.values(statuts).sort((a, b) => rank(a.statut) - rank(b.statut) || a.statut.localeCompare(b.statut, 'fr'));

    const progsByRg = countBy(progsDiffuses, p => p.agencyRegions);
    const lotsByRg = countBy(lotsDiffuses, l => programsMap[l.operationCode].agencyRegions);
    const parRegroupement = {};
    for (const rg of new Set([...Object.keys(progsByRg), ...Object.keys(lotsByRg)])) {
        parRegroupement[rg] = { programmes: progsByRg[rg] || 0, lots: lotsByRg[rg] || 0 };
    }

    const regroupements = [...new Set([
        ...Object.keys(parRegroupement),
        ...indicateurs.flatMap(i => Object.keys(i.parRegroupement))
    ])].sort((a, b) => (a === SANS_REGROUPEMENT) - (b === SANS_REGROUPEMENT) || a.localeCompare(b, 'fr'));

    return {
        diffusion: {
            perimetre: 'Programmes diffusés B2C non archivés ; lots diffusés B2C de ces programmes',
            programmes: progsDiffuses.length,
            lots: lotsDiffuses.length,
            parRegroupement,
            parStatut
        },
        indicateurs,
        regroupements
    };
}
