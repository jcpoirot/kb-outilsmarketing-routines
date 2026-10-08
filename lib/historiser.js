// Commit et push de l'historique d'une routine — seuls les deux fichiers du jour
// (<date>.json et <date>.synthese.md), jamais autre chose.
//
//   node lib/historiser.js <routine> --prod|--recette [--date AAAA-MM-JJ]
//
// La routine cloud travaille sur un HEAD détaché : on commite dessus et on pousse vers main
// (HEAD:main). Si main a avancé entre-temps, on se rebase une fois sur origin/main.

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from './chemins.js';
import { routineContext } from './routine.js';

const [routine, ...argv] = process.argv.slice(2);
if (!routine) throw new Error('Usage : node lib/historiser.js <routine> --prod|--recette');
const ctx = routineContext(routine, argv);
if (ctx.mode === 'test') throw new Error('Mode test : rien à historiser');

const git = (...args) => execFileSync('git', args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();

const files = ['json', 'synthese.md'].map(ctx.file).filter(existsSync).map(f => path.relative(ROOT, f));
if (!files.some(f => f.endsWith('.json'))) throw new Error(`Rapport absent : ${ctx.file('json')}`);

git('add', '--', ...files);
const label = ctx.mode === 'recette' ? 'recette' : 'rapport';
if (git('diff', '--cached', '--name-only')) {
    git('-c', 'user.name=Routine outils marketing', '-c', 'user.email=jcpoirot@dimake.io',
        'commit', '-m', `${routine}: ${label} du ${ctx.date}`);
}

function push() { git('push', 'origin', 'HEAD:main'); }
try {
    push();
} catch (err) {
    const msg = String(err.stderr || err.message);
    if (!/rejected|non-fast-forward|fetch first/i.test(msg)) throw new Error(msg);
    git('fetch', 'origin', 'main');
    git('rebase', 'origin/main');
    push();
}
console.log(`Historisé et poussé sur main : ${files.join(', ')} (${git('rev-parse', '--short', 'HEAD')})`);
