// Chargement des CSV des outils marketing.
//
// Les URL (avec leur jeton SAS) ne sont pas copiées ici : elles sont lues dans config.js,
// servi sans authentification par la SWA (exception de l'App 10). Un changement de jeton
// côté Front est donc suivi sans toucher aux routines.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { parseCSV } from './csv.js';
import { ROOT } from './chemins.js';

export const SITE = process.env.OUTILS_MARKETING_URL || 'https://outilsmarketing.kaufmanbroad.fr';

async function fetchText(url, label) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} en lisant ${label}`);
    return res.text();
}

// config.js déclare `const CONFIG` et l'exporte si `module` existe : on l'exécute dans un
// contexte isolé qui ne fournit que `module`.
export async function loadSiteConfig() {
    const code = await fetchText(`${SITE}/config.js`, 'config.js');
    const sandbox = { module: { exports: {} } };
    vm.runInNewContext(code, sandbox, { timeout: 1000 });
    const config = sandbox.module.exports;
    if (!config?.apps) throw new Error('config.js lu, mais CONFIG.apps est introuvable');
    return config;
}

// files : { cle: 'nomDeLaPropriete dans CONFIG.apps[app]' }, ex. { lots: 'lotsUrl' }.
// `cache` (option --cache) garde une copie dans out/cache pour itérer en local sans
// retélécharger ; jamais utilisé par la routine.
export async function loadCsvs(app, files, { cache = false } = {}) {
    const cacheDir = path.join(ROOT, 'out', 'cache');
    let config = null;
    const out = {};
    for (const [key, prop] of Object.entries(files)) {
        const cached = path.join(cacheDir, `${app}.${key}.csv`);
        let text;
        if (cache && existsSync(cached)) {
            text = await readFile(cached, 'utf8');
        } else {
            config ??= await loadSiteConfig();
            const url = config.apps[app]?.[prop];
            if (!url) throw new Error(`CONFIG.apps.${app}.${prop} absent de config.js`);
            text = await fetchText(url, `${key}.csv`);
            if (cache) {
                await mkdir(cacheDir, { recursive: true });
                await writeFile(cached, text);
            }
        }
        out[key] = parseCSV(text);
        if (!out[key].length) throw new Error(`${key}.csv est vide`);
    }
    return out;
}
