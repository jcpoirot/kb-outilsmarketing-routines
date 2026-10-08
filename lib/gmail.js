// Envoi d'un mail par l'API Gmail (HTTPS), sans dépendance : le script envoie lui-même le corps
// HTML et les pièces jointes, rien n'est recopié par le modèle. SMTP n'est pas joignable depuis
// les routines cloud (seul HTTPS sort) : d'où l'API.
//
// Identifiants (variables d'environnement de la routine cloud, ou du shell en local) :
//   GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET   client OAuth « Application de bureau » (Google Cloud)
//   GMAIL_REFRESH_TOKEN                    autorisation « gmail.send » du compte expéditeur,
//                                          obtenue une fois avec outils/gmail-autorisation.js
// Le compte expéditeur est celui qui a donné l'autorisation (jcpoirot@dimake.io).

const VARS = ['GMAIL_CLIENT_ID', 'GMAIL_CLIENT_SECRET', 'GMAIL_REFRESH_TOKEN'];

export const gmailConfigured = () => VARS.every(v => process.env[v]);
export const missingGmailVars = () => VARS.filter(v => !process.env[v]);

async function accessToken() {
    const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: process.env.GMAIL_CLIENT_ID,
            client_secret: process.env.GMAIL_CLIENT_SECRET,
            refresh_token: process.env.GMAIL_REFRESH_TOKEN,
            grant_type: 'refresh_token'
        })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.access_token) {
        throw new Error(`Jeton Gmail refusé (HTTP ${res.status}) : ${data.error || ''} ${data.error_description || ''}`.trim());
    }
    return data.access_token;
}

// En-tête encodé (RFC 2047) : objet et noms de fichiers accentués.
const encodeWord = s => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`);
const b64Lines = buf => buf.toString('base64').replace(/.{76}/g, '$&\r\n');

// Message MIME : multipart/mixed { multipart/alternative { texte, HTML }, pièces jointes }.
export function buildMime({ to, subject, text, html, attachments = [] }) {
    const mixed = `mixed_${Date.now().toString(36)}`;
    const alt = `alt_${Date.now().toString(36)}`;
    const lines = [
        `To: ${to.join(', ')}`,
        `Subject: ${encodeWord(subject)}`,
        'MIME-Version: 1.0',
        `Content-Type: multipart/mixed; boundary="${mixed}"`,
        '',
        `--${mixed}`,
        `Content-Type: multipart/alternative; boundary="${alt}"`,
        '',
        `--${alt}`,
        'Content-Type: text/plain; charset=UTF-8',
        'Content-Transfer-Encoding: base64',
        '',
        b64Lines(Buffer.from(text || '', 'utf8')),
        `--${alt}`,
        'Content-Type: text/html; charset=UTF-8',
        'Content-Transfer-Encoding: base64',
        '',
        b64Lines(Buffer.from(html, 'utf8')),
        `--${alt}--`
    ];
    for (const a of attachments) {
        const name = encodeWord(a.filename);
        lines.push(`--${mixed}`,
            `Content-Type: ${a.mimeType}; name="${name}"`,
            `Content-Disposition: attachment; filename="${name}"`,
            'Content-Transfer-Encoding: base64',
            '',
            b64Lines(a.content));
    }
    lines.push(`--${mixed}--`, '');
    return lines.join('\r\n');
}

export async function sendGmail(message) {
    const raw = Buffer.from(buildMime(message), 'utf8').toString('base64url');
    const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
        method: 'POST',
        headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Envoi Gmail refusé (HTTP ${res.status}) : ${data.error?.message || ''}`);
    return data;   // { id, threadId, labelIds }
}
