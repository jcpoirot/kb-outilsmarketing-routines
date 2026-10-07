// Briques HTML des mails. Styles en ligne et tableaux uniquement : Outlook et Gmail ignorent
// les feuilles de style et la mise en page flex/grid.

export const COLORS = {
    green: '#1D362C', primary: '#0066FF', bad: '#C62828', good: '#2E7D32',
    muted: '#6B7280', line: '#E5E7EB', bg: '#F8F9FA', text: '#1A1D1F', warn: '#D97706'
};

export const esc = s => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const fmt = n => Number(n).toLocaleString('fr-FR');

// Variation par rapport au rapport précédent. `sens` : 'bad' si une hausse est mauvaise
// (défauts de données), 'neutral' sinon. null = pas de référence.
export function variation(d, sens = 'neutral') {
    if (d === null || d === undefined) return '';
    if (d === 0) return `<span style="color:${COLORS.muted}">=</span>`;
    const color = sens === 'bad' ? (d > 0 ? COLORS.bad : COLORS.good) : COLORS.muted;
    return `<span style="color:${color};font-weight:600">${d > 0 ? '+' : '−'}${fmt(Math.abs(d))}</span>`;
}

// Markdown minimal (titres, listes -, gras **, paragraphes) : celui de la synthèse.
export function markdownToHtml(md) {
    const inline = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    const html = [];
    let list = false;
    for (const raw of md.split(/\r?\n/)) {
        const line = raw.trim();
        const item = /^[-*]\s+(.*)/.exec(line);
        if (!item && list) { html.push('</ul>'); list = false; }
        if (!line) continue;
        if (item) {
            if (!list) html.push('<ul style="margin:6px 0 10px;padding-left:20px">');
            list = true;
            html.push(`<li style="margin:3px 0">${inline(item[1])}</li>`);
        } else if (/^#{1,6}\s/.test(line)) {
            html.push(`<h3 style="font-size:15px;margin:14px 0 6px;color:${COLORS.green}">${inline(line.replace(/^#+\s*/, ''))}</h3>`);
        } else {
            html.push(`<p style="margin:6px 0">${inline(line)}</p>`);
        }
    }
    if (list) html.push('</ul>');
    return html.join('\n');
}

export function section(title, body, subtitle = '') {
    return `<h2 style="font-size:17px;margin:28px 0 4px;padding-bottom:4px;border-bottom:2px solid ${COLORS.green};color:${COLORS.green}">${esc(title)}</h2>`
        + (subtitle ? `<p style="margin:0 0 8px;color:${COLORS.muted};font-size:12px">${esc(subtitle)}</p>` : '')
        + body;
}

export const th = (label, align = 'left') =>
    `<th style="padding:6px 8px;text-align:${align};font-size:12px;color:${COLORS.muted};font-weight:600;border-bottom:2px solid ${COLORS.line};vertical-align:bottom">${label}</th>`;

export const td = (html, align = 'left', extra = '') =>
    `<td style="padding:6px 8px;text-align:${align};border-bottom:1px solid ${COLORS.line};vertical-align:top;${extra}">${html}</td>`;

export const table = (head, rows) =>
    `<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;font-size:13px">`
    + `<thead><tr>${head}</tr></thead><tbody>${rows.join('')}</tbody></table>`;

export const link = (href, html) =>
    `<a href="${esc(href)}" style="color:${COLORS.primary};text-decoration:none">${html}</a>`;

export function page(inner) {
    return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>`
        + `<body style="margin:0;padding:0;background:${COLORS.bg}">`
        + `<div style="max-width:720px;margin:0 auto;padding:20px 16px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.45;color:${COLORS.text};background:#ffffff">`
        + inner + '</div></body></html>';
}
