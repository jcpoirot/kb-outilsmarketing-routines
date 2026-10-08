# kb-outilsmarketing-routines

Routines cloud Claude autour des outils marketing de Kaufman & Broad : une analyse planifiée
produit un rapport, Claude en rédige la synthèse, le mail part depuis **jcpoirot@dimake.io**
(connecteur Gmail) dès la fin de l'analyse, et le rapport est commité ici pour servir de
référence aux variations suivantes.

Dépôt **privé** (chiffres internes), branche `main` seule : rien n'y est déployé.

## Routines

| Routine | Dossier | Planification | Contenu |
|---|---|---|---|
| Contrôle des données | `routines/controle-donnees/` | lundi et jeudi, 5 h UTC (6 h à Paris en hiver, 7 h en été) | offre diffusée B2C, problèmes de données des Apps 1 et 5 par regroupement d'agences, variations, liens vers les listes |

Chaque routine a son dossier : `ROUTINE.md` (le prompt suivi par la routine cloud),
`config.json` (nom, destinataires, adresse de test), ses scripts.

## Modes

| | Test (défaut) | Prod (`--prod`) | Recette (`--recette`) |
|---|---|---|---|
| Sorties | `out/<routine>/` (non versionné) | `historique/<routine>/` | `historique/<routine>/recette/` (jamais lu comme référence) |
| Destinataires | `destinataireTest` seul, objet préfixé `[TEST]`, bandeau dans le mail | `destinataires` | `destinataireTest` seul, objet préfixé `[RECETTE]` |
| Historique | rien n'est commité | `AAAA-MM-JJ.json` + `.synthese.md` commités et poussés | commité et poussé, comme en prod |

Les variations se calculent par rapport au **dernier rapport historisé antérieur au jour** : un
test ne devient jamais une référence. En recette, le rapport du jour compte aussi, pour que les
variations s'affichent.

Côté cloud, chaque routine existe en deux exemplaires : la routine planifiée (prompt
`Mode : prod`) et une routine de test sans planification active, lancée à la main
(« Run now » sur https://claude.ai/code/routines) avec le prompt `Mode : test`.

## En local

Node 20+, aucune dépendance. Le proxy TLS de l'entreprise impose `--use-system-ca` (jamais de
désactivation de la vérification TLS) :

```bash
export NODE_OPTIONS=--use-system-ca
npm run controle-donnees:analyse -- --cache      # rapport de test dans out/ (--cache : CSV gardés dans out/cache)
npm run controle-donnees:email                   # out/controle-donnees/AAAA-MM-JJ.email.html, à ouvrir dans un navigateur
npm run parite -- --cache                        # chiffres de la routine = chiffres des apps ?
```

Options communes : `--prod` (à ne lancer en local que pour rejouer un rapport historique),
`--date AAAA-MM-JJ`, `--cache`.

## Données

Les CSV ne sont pas copiés ici : `lib/donnees.js` lit `config.js` sur la prod
(`https://outilsmarketing.kaufmanbroad.fr/config.js`, servi sans authentification) pour y
trouver leurs URL. Variable `OUTILS_MARKETING_URL` pour viser un autre site (préprod).

## Parité avec les apps

Les indicateurs de « Contrôle des données » **reprennent le code** des contrôles de
`apps/controleDonnees.html` (App 5) et `apps/analyseImages.html` (App 1), filtres par défaut
compris, pour que le lien du mail affiche la liste dont il donne le nombre.
`npm run parite` exécute le script de ces deux pages (dépôt `outilsMarketing` cloné à côté) avec
un DOM simulé et compare, regroupement par regroupement. À lancer après toute modification d'un
contrôle, d'un côté comme de l'autre.

## Organisation

```
lib/                      commun : CSV, données, modes et historique, briques HTML des mails
routines/<routine>/       ROUTINE.md, config.json, analyse.js, email.js…
historique/<routine>/     rapports historisés (JSON + synthèse)
outils/                   outils locaux (parité)
out/                      sorties de test et cache (non versionné)
```

Ajouter une routine : un dossier dans `routines/`, ses scripts npm dans `package.json`, une ligne
dans le tableau « Routines », puis ses deux routines cloud (prod et test).
