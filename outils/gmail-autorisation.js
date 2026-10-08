// Obtient, une fois, l'autorisation « envoi de mails » (scope gmail.send) du compte expéditeur,
// pour l'envoi par le script (lib/gmail.js). Outil local, sans dépendance.
//
//   GMAIL_CLIENT_ID=… GMAIL_CLIENT_SECRET=… NODE_OPTIONS=--use-system-ca node outils/gmail-autorisation.js
//
// Ouvre l'adresse affichée, connectez-vous avec le compte expéditeur (jcpoirot@dimake.io) et
// acceptez : le script affiche GMAIL_REFRESH_TOKEN, à déclarer avec les deux autres variables dans
// l'environnement cloud de la routine. Le client OAuth doit être de type « Application de bureau »
// (redirection vers 127.0.0.1 autorisée d'office).

import http from 'node:http';

const { GMAIL_CLIENT_ID: clientId, GMAIL_CLIENT_SECRET: clientSecret } = process.env;
if (!clientId || !clientSecret) {
    console.error('Renseigner GMAIL_CLIENT_ID et GMAIL_CLIENT_SECRET (client OAuth « Application de bureau »).');
    process.exit(1);
}

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${server.address().port}`);
    const code = url.searchParams.get('code');
    if (!code) { res.end(url.searchParams.get('error') || 'En attente…'); return; }
    const token = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            code, client_id: clientId, client_secret: clientSecret,
            redirect_uri: `http://127.0.0.1:${server.address().port}`, grant_type: 'authorization_code'
        })
    }).then(r => r.json());
    if (token.refresh_token) {
        res.end('Autorisation obtenue : revenez au terminal.');
        console.log(`\nGMAIL_REFRESH_TOKEN=${token.refresh_token}\n`);
    } else {
        res.end('Échec : voir le terminal.');
        console.error('Pas de refresh_token reçu :', token);
    }
    server.close();
});

server.listen(0, '127.0.0.1', () => {
    const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    auth.search = new URLSearchParams({
        client_id: clientId,
        redirect_uri: `http://127.0.0.1:${server.address().port}`,
        response_type: 'code',
        scope: 'https://www.googleapis.com/auth/gmail.send',
        access_type: 'offline',
        prompt: 'consent',
        login_hint: 'jcpoirot@dimake.io'
    }).toString();
    console.log(`Ouvrir dans le navigateur et se connecter avec le compte expéditeur :\n\n${auth}\n`);
});
