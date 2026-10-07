// Test de parité : exécute le VRAI script de outilsMarketing/apps/controleDonnees.html et
// apps/analyseImages.html (DOM simulé, filtres par défaut) sur les CSV du jour et compare,
// regroupement par regroupement, aux indicateurs de la routine. À lancer après toute
// modification d'un contrôle, d'un côté comme de l'autre.
//
//   NODE_OPTIONS=--use-system-ca npm run parite      (dépôt outilsMarketing à côté de celui-ci)
//
// Outil local : le dépôt du Front n'est pas cloné par la routine.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { ROOT } from '../lib/chemins.js';
import { loadCsvs } from '../lib/donnees.js';
import { computeIndicateurs } from '../routines/controle-donnees/indicateurs.js';

const base = path.resolve(ROOT, '..');
const data = await loadCsvs('controleDonnees',
    { programs: 'programsUrl', lots: 'lotsUrl', otherUnits: 'otherUnitsUrl' }, { cache: process.argv.includes('--cache') });

function makeDom(defaults) {
    const els = {};
    const el = id => els[id] ||= new Proxy({
        value: defaults[id] ?? '', checked: defaults[id] ?? false, style: {}, innerHTML: '', textContent: '',
        classList: { toggle() {}, add() {}, remove() {}, contains() { return false; } },
        addEventListener() {}, querySelectorAll() { return []; }, insertBefore() {}, dataset: {}, options: []
    }, { get: (t, k) => (k in t ? t[k] : () => {}) });
    return {
        getElementById: el,
        querySelector: sel => (sel.endsWith('button.on') ? { dataset: { val: '1' } } : null),
        querySelectorAll: () => [],
        addEventListener() {}
    };
}

function run(file, defaults, extra) {
    const html = readFileSync(path.join(base, 'outilsMarketing/apps', file), 'utf8');
    const script = html.slice(html.lastIndexOf('<script>') + 8, html.lastIndexOf('</script>'));
    const ctx = {
        document: makeDom(defaults), window: { addEventListener() {}, scrollY: 0 },
        location: { hash: '', protocol: 'https:' }, history: { replaceState() {}, pushState() {} },
        console, URLSearchParams, CONFIG: { apps: { controleDonnees: {}, analyseImages: {} } }, initAppLoader() {}
    };
    vm.runInNewContext(script + '\n' + extra, ctx);
    return ctx.__out;
}

const app5 = run('controleDonnees.html', { progPublishedFilter: 'published', lotPublishedFilter: 'published', remainingFilter: '0' }, `
    startAnalysis(__data);
    __out = {
        sansLoyer: getErrorLots(getFilteredLots()),
        sansCharges: getErrorProgsCharges(getFilteredPrograms(2)),
        sansHonoraires: getErrorProgsFees(getFilteredPrograms(4)),
        ecoules: getErrorProgsSoldOut(getFilteredPrograms(5)),
        nonDiffuses: getPublicationIssues().map(e => e.lot),
        sansPlan: getLotsWithoutPlan()
    };`.replace('__data', JSON.stringify(data)));

const app1 = run('analyseImages.html', {}, `
    lotsData = __lots; programsData = __progs;
    let __captured; displayProgramTable = (byRegion) => { __captured = byRegion; };
    generateProgramTable({ onlyMissing: true });
    __out = __captured;`.replace('__lots', JSON.stringify(data.lots)).replace('__progs', JSON.stringify(data.programs)));

const r = computeIndicateurs(data);
let ko = 0;
for (const ind of r.indicateurs) {
    let appCount;
    if (ind.cle === 'sansImages') {
        appCount = {};
        for (const [rg, progs] of Object.entries(app1)) appCount[rg === 'Sans région' ? 'Sans regroupement' : rg] = progs.reduce((s, p) => s + p.withoutImages, 0);
    } else {
        const key = ['sansCharges', 'sansHonoraires', 'ecoules'].includes(ind.cle) ? (p => p.agencyRegions) : (l => l.agencyRegions);
        appCount = {};
        for (const x of app5[ind.cle]) { const k = key(x) || 'Sans regroupement'; appCount[k] = (appCount[k] || 0) + 1; }
    }
    const a = JSON.stringify(Object.entries(appCount).sort());
    const b = JSON.stringify(Object.entries(ind.parRegroupement).sort());
    const ok = a === b;
    if (!ok) ko++;
    console.log(ok ? 'OK ' : 'KO ', ind.cle, ok ? ind.total : `\n  app     ${a}\n  routine ${b}`);
}
process.exit(ko ? 1 : 0);
