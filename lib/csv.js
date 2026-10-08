// Portage de parseCSV (outilsMarketing/shared/csv-loader.js). Garder les deux alignés : les
// chiffres des routines doivent être ceux que montrent les apps.
//
// Particularités reprises telles quelles :
// - les guillemets sont supprimés des valeurs (un champ JSON n'est donc plus du JSON) ;
// - une ligne se poursuit tant qu'il lui manque des colonnes ou qu'un guillemet n'est pas
//   refermé (legalNoticeB2C, dernière colonne de programs.csv, contient un retour à la ligne) ;
// - BOM retiré en tête.

function parseCSVLine(line, separator) {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (const char of line) {
        if (char === '"') inQuotes = !inQuotes;
        else if (char === separator && !inQuotes) { result.push(current); current = ''; }
        else current += char;
    }
    result.push(current);
    return result;
}

export function parseCSV(text, separator = ';') {
    text = text.replace(/^﻿/, '').replace(/\r\n/g, '\n');
    const lines = text.split('\n');
    if (!lines[0]) return [];

    let headerEndIdx = 0;
    let headerLine = lines[0];
    while (headerEndIdx + 1 < lines.length) {
        if ((headerLine.match(/"/g) || []).length % 2 === 0) break;
        headerEndIdx++;
        headerLine += '\n' + lines[headerEndIdx];
    }
    const headers = parseCSVLine(headerLine, separator).map(h => h.trim().replace(/^"|"$/g, ''));

    const unbalanced = s => (s.match(/"/g) || []).length % 2 === 1;
    const MAX_CONTINUATION = 20;
    const result = [];
    let i = headerEndIdx + 1;
    while (i < lines.length) {
        if (!lines[i].trim()) { i++; continue; }
        let row = lines[i];
        let values = parseCSVLine(row, separator);
        let j = i;
        while (j + 1 < lines.length && j - i < MAX_CONTINUATION && (values.length < headers.length || unbalanced(row))) {
            j++;
            row += '\n' + lines[j];
            values = parseCSVLine(row, separator);
        }
        if (unbalanced(row) && j - i >= MAX_CONTINUATION) {
            row = lines[i];
            values = parseCSVLine(row, separator);
            j = i;
        }
        i = j;
        const obj = {};
        headers.forEach((header, idx) => {
            obj[header] = values[idx] ? values[idx].trim().replace(/^"|"$/g, '') : '';
        });
        result.push(obj);
        i++;
    }
    return result;
}

// Parseur CSV standard (RFC 4180) : valeurs entre guillemets sur autant de lignes qu'il faut,
// guillemet doublé "" = guillemet littéral, guillemets conservés dans la valeur. Pour les
// fichiers qu'aucune app ne lit (programsDescriptions.csv : descriptifs HTML de plus de
// 20 lignes, attributs class=""…""), où la parité avec parseCSV n'a pas d'objet.
export function parseCSVStrict(text, separator = ';') {
    text = text.replace(/^﻿/, '');
    const rows = [];
    let row = [], field = '', inQuotes = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (inQuotes) {
            if (c === '"') {
                if (text[i + 1] === '"') { field += '"'; i++; }
                else inQuotes = false;
            } else field += c;
        } else if (c === '"') inQuotes = true;
        else if (c === separator) { row.push(field); field = ''; }
        else if (c === '\n' || c === '\r') {
            if (c === '\r' && text[i + 1] === '\n') i++;
            row.push(field); field = '';
            if (row.some(v => v !== '')) rows.push(row);
            row = [];
        } else field += c;
    }
    row.push(field);
    if (row.some(v => v !== '')) rows.push(row);
    const [headers, ...data] = rows;
    return data.map(values => Object.fromEntries(headers.map((h, i) => [h.trim(), (values[i] ?? '').trim()])));
}
