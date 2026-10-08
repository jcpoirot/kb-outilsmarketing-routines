// Affiche, en texte compact, un lot de programmes à relire du dossier des descriptifs : c'est
// ce que Claude lit à l'étape « Descriptifs » du ROUTINE.md (le JSON complet est trop lourd).
//
//   node routines/controle-donnees/lire-dossier.js [--prod|--recette] [<n° de lot>]
//
// Sans numéro : affiche le nombre de lots. Lots de TAILLE programmes, numérotés à partir de 1.

import { existsSync } from 'node:fs';
import { routineContext, readJson } from '../../lib/routine.js';
import { stockText } from './descriptifs.js';

const TAILLE = 15;
const ctx = routineContext('controle-donnees');
const numero = parseInt(process.argv.slice(2).find(a => /^\d+$/.test(a)) || '0', 10);

if (!existsSync(ctx.file('descriptifs.dossier.json'))) {
    throw new Error(`Dossier absent : ${ctx.file('descriptifs.dossier.json')} — lancer d'abord l'analyse`);
}
const dossier = await readJson(ctx.file('descriptifs.dossier.json'));
const aRelire = dossier.programmes.filter(p => p.aRelire);
const lots = Math.ceil(aRelire.length / TAILLE);

if (!numero) {
    console.log(`${dossier.programmes.length} programmes, ${aRelire.length} à relire, en ${lots} lot(s) de ${TAILLE}.`);
    console.log(`Lire chaque lot : node routines/controle-donnees/lire-dossier.js ${ctx.mode === 'test' ? '' : `--${ctx.mode} `}<1..${lots}>`);
    process.exit(0);
}
if (numero > lots) throw new Error(`Lot ${numero} inexistant (${lots} lot(s))`);

const fmt = n => Number(n).toLocaleString('fr-FR');
const out = [`Lot ${numero}/${lots} — date du rapport ${dossier.date}`];
for (const p of aRelire.slice((numero - 1) * TAILLE, numero * TAILLE)) {
    const o = p.offre;
    const offre = o.ref
        ? `${o.ref}, du ${o.debut || '?'} au ${o.fin || '?'} — ${o.valable ? 'VALABLE' : 'EXPIRÉE ou sans date'}`
            + (o.remiseMax ? ` ; remise max ${fmt(o.remiseMax)} €` : '') + (o.fraisNotaireOfferts ? ' ; frais de notaire offerts' : '')
            + (o.offreLibre ? ` ; offre libre « ${o.offreLibre} »` : '')
        : 'aucune offre programme';
    const fam = p.stockFamille;
    const extra = [
        fam.remisesLotsValables ? `remises de lot valables : ${fam.remisesLotsValables.lots} lot(s), max ${fmt(fam.remisesLotsValables.max)} €` : '',
        fam.fnoLotsValables ? `frais de notaire offerts sur ${fam.fnoLotsValables} lot(s)` : '',
        fam.horsGrille ? `${fam.horsGrille} lot(s) disponible(s) hors grille validée (exclus)` : '',
        fam.prixAberrants.length ? `prix aberrants : ${fam.prixAberrants.map(a => `${a.lot} ${a.typologie} ${a.surface} m² ${fmt(a.prix)} € (${fmt(a.prixM2)} €/m², médiane ${fmt(a.medianeM2)} des lots à TVA ${a.tva})`).join(' ; ')}` : ''
    ].filter(Boolean);
    out.push('', `### ${p.idProgram} — ${p.nom || '(sans nom)'} — ${p.ville || '?'} (${p.departement || '?'}) — ${p.agencyRegions || '?'}`,
        `Statut programme : ${p.statutProgramme || '—'} | Parent : ${p.parent || '—'} | Famille : ${p.famille.length ? p.famille.join(', ') : 'aucune'}`,
        `Offre programme : ${offre}`,
        `${p.sansStock ? 'SANS STOCK' : p.virtuelsSeuls ? 'VIRTUELS SEULS' : 'AVEC STOCK'} — stock diffusé ${p.famille.length ? 'de la famille' : 'du programme'} : ${stockText(fam)}`,
        ...extra.map(e => `  · ${e}`),
        `  · logements de la résidence, tous états, pour juger un nombre total annoncé : ${fam.logementsTotal} (${Object.entries(fam.etats).map(([k, v]) => `${k} ${v}`).join(', ') || '—'})`);
    if (p.famille.length) out.push(`Stock du programme seul : ${stockText(p.stock)}`);
    if (p.texteIdentiqueA.length) {
        out.push(`Texte identique à : ${p.texteIdentiqueA.map(c => `${c.idProgram}${c.memeFamille ? ' (même famille)' : ' (AUTRE famille)'}`).join(', ')}`);
    }
    out.push(p.texteVide ? 'Descriptif : (vide)' : `Descriptif${p.texteIdentiqueParent ? ' (identique au parent)' : ''} :\n${p.texte}`);
    if (p.evenement) {
        out.push(`Titre événement : ${p.evenement.titre || '(vide)'}`,
            `Description événement :\n${p.evenement.description || '(vide)'}`);
    }
}
console.log(out.join('\n'));
