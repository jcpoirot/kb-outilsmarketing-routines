// Étape d'envoi : envoie le mail préparé par email.js (<date>.email.json : to, subject, htmlFile,
// text, attachments) par l'API Gmail, corps HTML et pièces jointes lus sur disque.
//
//   node routines/controle-donnees/envoyer.js [--prod|--recette] [--echec "message"]
//
// Codes de sortie : 0 envoyé ; 3 identifiants Gmail absents (la routine se rabat alors sur le
// connecteur Gmail, sans pièce jointe) ; 1 autre erreur.

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { routineContext, readJson } from '../../lib/routine.js';
import { gmailConfigured, missingGmailVars, sendGmail } from '../../lib/gmail.js';

const argv = process.argv.slice(2);
const i = argv.indexOf('--echec');
if (i > -1) argv.splice(i, 2);   // même fichier email.json : l'option ne change rien ici
const ctx = routineContext('controle-donnees', argv);

if (!existsSync(ctx.file('email.json'))) {
    console.error(`Mail absent : ${ctx.file('email.json')} — lancer d'abord controle-donnees:email`);
    process.exit(1);
}
if (!gmailConfigured()) {
    console.error(`Identifiants Gmail absents (${missingGmailVars().join(', ')}) : envoi par le script impossible.`);
    process.exit(3);
}

const mail = await readJson(ctx.file('email.json'));
const attachments = [];
for (const a of mail.attachments || []) {
    attachments.push({ filename: a.filename, mimeType: a.mimeType, content: await readFile(a.file) });
}
try {
    const res = await sendGmail({
        to: mail.to, subject: mail.subject, text: mail.text || '',
        html: await readFile(mail.htmlFile, 'utf8'), attachments
    });
    console.log(`Mail envoyé (id Gmail ${res.id}) à ${mail.to.join(', ')}`
        + (attachments.length ? ` avec ${attachments.map(a => a.filename).join(', ')}` : ''));
} catch (err) {
    console.error(err.message);
    process.exit(1);
}
