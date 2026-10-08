# kb-outilsmarketing-routines

Routines cloud Claude autour des outils marketing de Kaufman & Broad : une analyse planifiée
produit un rapport, Claude en rédige la synthèse, le mail part depuis **jcpoirot@dimake.io**
(connecteur Gmail) dès la fin de l'analyse, et le rapport est commité ici pour servir de
référence aux variations suivantes.

Dépôt **privé** (chiffres internes), branche `main` seule : rien n'y est déployé.

## Routines

| Routine | Dossier | Planification | Contenu |
|---|---|---|---|
| Contrôle des données | `routines/controle-donnees/` | lundi et jeudi, 5 h UTC (6 h à Paris en hiver, 7 h en été) | offre diffusée B2C, problèmes de données des Apps 1 et 5 par regroupement d'agences, cohérence des descriptifs de programmes avec leur stock (Excel joint), variations, liens vers les listes |

Chaque routine a son dossier : `ROUTINE.md` (le prompt suivi par la routine cloud),
`config.json` (nom, destinataires, adresse de test), ses scripts.

## Modes

| | Test (défaut) | Prod (`--prod`) | Recette (`--recette`) |
|---|---|---|---|
| Sorties | `out/<routine>/` (non versionné) | `historique/<routine>/` | `historique/<routine>/recette/` (jamais lu comme référence) |
| Destinataires | `destinataireTest` seul, objet préfixé `[TEST]`, bandeau dans le mail | `destinataires` | `destinataireTest` seul, objet préfixé `[RECETTE]` |
| Historique | rien n'est commité | `AAAA-MM-JJ.json`, `.synthese.md` et `.descriptifs.json` commités et poussés (`npm run controle-donnees:historiser`) | commité et poussé, comme en prod |

Les variations se calculent par rapport au **dernier rapport historisé antérieur au jour** : un
test ne devient jamais une référence. En recette, le rapport du jour compte aussi, pour que les
variations s'affichent.

Côté cloud, chaque routine existe en trois exemplaires : la routine planifiée (prompt
`Mode : prod`), et deux routines sans planification active, lancées à la main (« Run now » sur
https://claude.ai/code/routines) avec les prompts `Mode : test` et `Mode : recette`.

## En local

Node 20+, aucune dépendance. Le proxy TLS de l'entreprise impose `--use-system-ca` (jamais de
désactivation de la vérification TLS) :

```bash
export NODE_OPTIONS=--use-system-ca
npm run controle-donnees:analyse -- --cache      # rapport de test et dossier des descriptifs dans out/ (--cache : CSV gardés dans out/cache)
npm run controle-donnees:dossier -- 1            # lot 1 des descriptifs à relire, en texte (étape Claude)
npm run controle-donnees:descriptifs             # consolide les verdicts relus-*.json : descriptifs.json, Excel, agrégats
npm run controle-donnees:email                   # out/controle-donnees/AAAA-MM-JJ.email.html, à ouvrir dans un navigateur
npm run parite -- --cache                        # chiffres de la routine = chiffres des apps ?
```

Options communes : `--prod` (à ne lancer en local que pour rejouer un rapport historique),
`--date AAAA-MM-JJ`, `--cache`.

## Données

Les CSV ne sont pas copiés ici : `lib/donnees.js` lit `config.js` sur la prod
(`https://outilsmarketing.kaufmanbroad.fr/config.js`, servi sans authentification) pour y
trouver leurs URL. Variable `OUTILS_MARKETING_URL` pour viser un autre site (préprod, ou le Front
local `http://localhost:5578` servi par `outilsMarketing/tools/local/serve.js`, pour essayer un
`config.js` pas encore déployé). Une URL absente de `config.js` fait échouer l'analyse avec un
message qui le dit.

| Fichier | Clé de `CONFIG.apps.controleDonnees` | Lecture | Usage |
|---|---|---|---|
| programs.csv | `programsUrl` | parseur des apps (`parseCSV`) | tous les indicateurs |
| lots.csv | `lotsUrl` | parseur des apps | tous les indicateurs |
| otherUnits.csv | `otherUnitsUrl` | parseur des apps | descriptifs : locaux, parkings, bureaux (absents de lots.csv) |
| programsDescriptions.csv | `programsDescriptionsUrl` | parseur CSV standard (`parseCSVStrict`) : descriptifs HTML de plus de 20 lignes | descriptifs |

### Descriptifs et stock

Cohérence entre le descriptif de chaque programme diffusé B2C et le stock disponible de sa
famille (parent et enfants). Règles : section « Règles des descriptifs » de
`routines/controle-donnees/ROUTINE.md` ; notion « Cohérence descriptif / stock » de
`outilsMarketing/.claude/rules/ontologie.md`.

1. `analyse.js` (script) écrit `AAAA-MM-JJ.descriptifs.dossier.json` : texte nettoyé, famille,
   stock du programme et de la famille, offre, statut, et un `hash`.
2. Claude relit les seuls programmes dont le `hash` a changé depuis le dernier
   `descriptifs.json` historisé (`lire-dossier.js`, par lots de 15) et écrit ses verdicts dans
   `AAAA-MM-JJ.descriptifs.relus-<n>.json`.
3. `consolider.js` (script) reprend les verdicts inchangés, vérifie qu'il n'en manque aucun et
   écrit `AAAA-MM-JJ.descriptifs.json` (historisé), l'Excel joint au mail
   (`AAAA-MM-JJ.descriptifs.xlsx`, `lib/xlsx.js` sans dépendance) et les agrégats du mail.

Ce contrôle **n'a pas d'équivalent dans les apps**, donc pas de contrôle de parité : ses
chiffres ne se vérifient que dans l'Excel.

## Parité avec les apps

Les indicateurs de « Contrôle des données » (hors descriptifs, voir plus haut) **reprennent le code** des contrôles de
`apps/controleDonnees.html` (App 5) et `apps/analyseImages.html` (App 1), filtres par défaut
compris, pour que le lien du mail affiche la liste dont il donne le nombre.
`npm run parite` exécute le script de ces deux pages (dépôt `outilsMarketing` cloné à côté) avec
un DOM simulé et compare, regroupement par regroupement. À lancer après toute modification d'un
contrôle, d'un côté comme de l'autre.

## Organisation

```
lib/                      commun : CSV, données, modes et historique, briques HTML des mails, Excel (xlsx.js), historisation
routines/<routine>/       ROUTINE.md, config.json, analyse.js, email.js…
historique/<routine>/     rapports historisés (JSON, synthèse, verdicts des descriptifs)
outils/                   outils locaux (parité)
out/                      sorties de test et cache (non versionné)
```

Ajouter une routine : un dossier dans `routines/`, ses scripts npm dans `package.json`, une ligne
dans le tableau « Routines », puis ses routines cloud (prod, test, recette).
