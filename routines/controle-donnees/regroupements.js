// Mails par regroupement d'agences : en plus du mail général, chaque regroupement listé dans
// `destinatairesParRegroupement` de config.json reçoit un mail limité à ses chiffres.
//
// Clé de config = nom du regroupement avant le « | » (« Ile-de-France », « Ouest »…), sans
// tenir compte des accents ni de la casse : un changement de responsable ne casse rien.
// Fichiers d'un regroupement : <date>.<slug>.synthese.md, .email.html, .email.json,
// .descriptifs.xlsx (slug : « ile-de-france », « centre-est-nord-est-1 »…).

import { SANS_REGROUPEMENT } from './indicateurs.js';

export const nomRegroupement = rg => rg.split('|')[0].trim();

const normaliser = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

export const slugRegroupement = rg => normaliser(nomRegroupement(rg)).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// Regroupements du rapport qui ont un mail : { rg, nom, slug, destinataires, to }.
// Prod : seuls ceux qui ont au moins un destinataire. Test et recette : tous ceux de la config,
// envoyés au destinataire de test (le mail rappelle à qui il partirait en prod).
// `alertes` : clés de config sans regroupement dans le rapport, regroupements sans clé.
export function regroupementsAEnvoyer(config, report, mode) {
    const parNom = config.destinatairesParRegroupement || {};
    const cles = Object.keys(parNom);
    const presents = report.regroupements.filter(rg => rg !== SANS_REGROUPEMENT);
    const alertes = [];
    const mails = [];
    for (const rg of presents) {
        const cle = cles.find(k => normaliser(k) === normaliser(nomRegroupement(rg)));
        if (cle === undefined) { alertes.push(`« ${nomRegroupement(rg)} » : absent de destinatairesParRegroupement, pas de mail régional`); continue; }
        const destinataires = parNom[cle] || [];
        if (mode === 'prod' && !destinataires.length) continue;
        mails.push({ rg, nom: nomRegroupement(rg), slug: slugRegroupement(rg), destinataires,
            to: mode === 'prod' ? destinataires : [config.destinataireTest] });
    }
    for (const cle of cles) {
        if (!presents.some(rg => normaliser(nomRegroupement(rg)) === normaliser(cle))) {
            alertes.push(`« ${cle} » (config) : aucun regroupement de ce nom dans le rapport`);
        }
    }
    return { mails, alertes };
}
