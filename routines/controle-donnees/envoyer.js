// Étape d'envoi : envoie les mails préparés par email.js par l'API Gmail, corps HTML et pièces
// jointes lus sur disque — le mail général (<date>.email.json) puis chaque mail régional
// (<date>.<slug>.email.json). Un échec n'empêche pas l'envoi des suivants.
//
//   node routines/controle-donnees/envoyer.js [--prod|--recette] [--echec "message"]
//
// Codes de sortie : 0 tout est envoyé ; 3 identifiants Gmail absents (la routine se rabat alors
// sur le connecteur Gmail, sans pièce jointe, pour chaque mail) ; 1 au moins un mail non envoyé
// (lignes « ÉCHEC : <fichier email.json> »).

import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { routineContext, readJson } from '../../lib/routine.js';
import { gmailConfigured, missingGmailVars, sendGmail } from '../../lib/gmail.js';

const argv = process.argv.slice(2);
const i = argv.indexOf('--echec');
if (i > -1) argv.splice(i, 2);   // mêmes fichiers email.json : l'option ne change rien ici
const ctx = routineContext('controle-donnees', argv);

if (!existsSync(ctx.file('email.json'))) {
    console.error(`Mail absent : ${ctx.file('email.json')} — lancer d'abord controle-donnees:email`);
    process.exit(1);
}
const regionaux = (await readdir(ctx.outDir))
    .filter(f => f.startsWith(`${ctx.date}.`) && f.endsWith('.email.json') && f !== `${ctx.date}.email.json`)
    .sort().map(f => path.join(ctx.outDir, f));
const fichiers = [ctx.file('email.json'), ...regionaux];

if (!gmailConfigured()) {
    console.error(`Identifiants Gmail absents (${missingGmailVars().join(', ')}) : envoi par le script impossible.`);
    console.error(`Mails à envoyer par le connecteur :\n${fichiers.join('\n')}`);
    process.exit(3);
}

let echecs = 0;
for (const fichier of fichiers) {
    try {
        const mail = await readJson(fichier);
        const attachments = [];
        for (const a of mail.attachments || []) {
            attachments.push({ filename: a.filename, mimeType: a.mimeType, content: await readFile(a.file) });
        }
        const res = await sendGmail({
            to: mail.to, subject: mail.subject, text: mail.text || '',
            html: await readFile(mail.htmlFile, 'utf8'), attachments
        });
        console.log(`Mail envoyé (id Gmail ${res.id}) : « ${mail.subject} » à ${mail.to.join(', ')}`
            + (attachments.length ? ` avec ${attachments.map(a => a.filename).join(', ')}` : ''));
    } catch (err) {
        echecs++;
        console.error(`ÉCHEC : ${fichier}\n  ${err.message}`);
    }
}
if (echecs) process.exit(1);
