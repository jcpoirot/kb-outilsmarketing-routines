# Routine « Contrôle des données » (lundi et jeudi, 5 h UTC)

Mail aux directeurs : offre diffusée (programmes et lots B2C, par état d'avancement et par
regroupement d'agences), problèmes de données des Apps 1 et 5, par regroupement, et cohérence
des descriptifs de programmes avec leur stock (détail en Excel joint), avec la variation depuis
le dernier rapport historisé et un lien vers chaque liste dans outilsMarketing.

Ce fichier est le prompt de la routine cloud : la routine se contente de demander de le suivre.

## Prompts à coller dans les routines

Routine planifiée (prod) :

```
Mode : prod. Suis exactement routines/controle-donnees/ROUTINE.md (section « Déroulement »). Tu es autorisé à commiter et pousser sur main les fichiers d'historique, uniquement via `npm run controle-donnees:historiser`.
```

Routine de test (lancée à la main) :

```
Mode : test. Suis exactement routines/controle-donnees/ROUTINE.md (section « Déroulement »).
```

Recette (exécution ponctuelle, pour vérifier toute la chaîne de la prod, push compris, avec un
mail au seul destinataire de test) :

```
Mode : recette. Suis exactement routines/controle-donnees/ROUTINE.md (section « Déroulement »). Tu es autorisé à commiter et pousser sur main les fichiers d'historique, uniquement via `npm run controle-donnees:historiser`.
```

## Prérequis de la routine

- Node 20+ (aucune dépendance npm).
- Accès réseau à `outilsmarketing.kaufmanbroad.fr` (lecture de `config.js`) et à
  `outilsmarketing.blob.core.windows.net` (CSV : programs, lots, otherUnits, programsDescriptions).
- `config.js` de la prod doit déclarer `CONFIG.apps.controleDonnees.programsDescriptionsUrl` ;
  sinon l'analyse échoue avec un message qui le dit (Front non déployé).
- Connecteur **Gmail** (compte jcpoirot@dimake.io), pièces jointes comprises.
- Prod et recette : droit de pousser sur `main` (l'historique sert de référence aux variations).
  Il est donné par l'app GitHub « Claude », qui doit avoir accès à ce dépôt.

## Déroulement

Le **mode** est donné en tête du prompt. `FLAG` vaut `--prod` en mode prod, `--recette` en mode
recette, rien en mode test. Les fichiers sont dans `historique/controle-donnees/` en prod,
`historique/controle-donnees/recette/` en recette, `out/controle-donnees/` en test ;
`AAAA-MM-JJ` est la date du jour à Paris, affichée par l'étape 1.

1. Lancer `npm run controle-donnees:analyse -- FLAG`. Il écrit `AAAA-MM-JJ.json` (indicateurs) et
   `AAAA-MM-JJ.descriptifs.dossier.json` (descriptifs), et affiche un résumé, dont le nombre de
   programmes dont le descriptif est à relire.
   - S'il échoue : lancer `npm run controle-donnees:email -- FLAG --echec "<les 40 dernières lignes
     de la sortie d'erreur>"`, envoyer le mail comme à l'étape 7, puis s'arrêter (aucun commit).

2. **Descriptifs** : juger les programmes à relire (section « Règles des descriptifs » plus bas).
   Les autres reprennent tels quels le verdict du dernier rapport historisé : leur texte et leur
   stock n'ont pas changé (même `hash`) ; ne pas les relire.
   - `node routines/controle-donnees/lire-dossier.js FLAG` donne le nombre de lots ;
     `node routines/controle-donnees/lire-dossier.js FLAG <n>` affiche le lot `n` (15 programmes :
     texte nettoyé, stock de la famille, offre, statut). Ne pas lire le JSON du dossier en entier.
   - Pour chaque lot `n`, écrire `AAAA-MM-JJ.descriptifs.relus-<n>.json` (même dossier que le
     rapport) : un tableau avec **une entrée par programme du lot**, même sans anomalie :
     `{"idProgram": "72101", "sansStock": false, "parleDuStock": false, "anomalies": [{"champ": "descriptif", "type": "typologie", "severite": "faible", "extrait": "…", "constat": "…", "commentaire": "…"}]}`.
   - Puis lancer `npm run controle-donnees:descriptifs -- FLAG`. Il vérifie que chaque programme
     à relire a son verdict (sinon il liste ceux qui manquent : les compléter et relancer), écrit
     `AAAA-MM-JJ.descriptifs.json`, l'Excel `AAAA-MM-JJ.descriptifs.xlsx` et les agrégats dans
     `AAAA-MM-JJ.json`.

3. Lire `AAAA-MM-JJ.json` : `diffusion` (totaux, `parStatut`, `parRegroupement`, avec `variation`),
   `indicateurs` (`total`, `variation`, `parRegroupement`, `variationParRegroupement`),
   `descriptifs` (programmes en écart avec stock par sévérité, sans stock, `variation`),
   `datePrecedente`. Les variations valent `null` s'il n'y a pas de rapport précédent.

4. Écrire `AAAA-MM-JJ.synthese.md` à côté du rapport, en français, **10 lignes maximum**, en
   Markdown simple (listes `-`, gras `**`), pour des directeurs :
   - **Verdict** en une phrase : la qualité des données s'améliore, se dégrade ou est stable
     depuis le `datePrecedente`, et pourquoi.
   - Les **2 ou 3 faits marquants** : plus fortes hausses ou baisses d'indicateurs, regroupement
     qui se distingue, évolution notable de l'offre diffusée ou des descriptifs en écart.
   - Règles : ne rien affirmer qui ne figure pas dans le rapport ; ne pas recopier les tableaux
     du mail ; nommer un regroupement par sa partie avant le `|` (« Ouest ») ; premier rapport
     (`datePrecedente` nul) : décrire l'état sans parler d'évolution.

5. Lancer `npm run controle-donnees:email -- FLAG`. Il écrit `AAAA-MM-JJ.email.html` et
   `AAAA-MM-JJ.email.json` (`to`, `subject`, `htmlFile`, `attachments`).

6. **Prod et recette** : lancer `npm run controle-donnees:historiser -- FLAG`. Il commite les
   seuls `AAAA-MM-JJ.json`, `AAAA-MM-JJ.synthese.md` et `AAAA-MM-JJ.descriptifs.json` du mode et
   les pousse sur `main` (`HEAD:main`, avec un rebase si `main` a avancé). Ne faire aucun autre
   commit ni push, et ne pas pousser autrement que par ce script : le push sur `main` est
   autorisé par le propriétaire du dépôt pour ces seuls fichiers. Si le script échoue, envoyer
   quand même le mail et signaler l'erreur en tête de la sortie de la session (en prod, les
   prochaines variations partiront du rapport précédent ; en recette, c'est précisément ce que
   la vérification doit révéler).
   **Test** : ne rien commiter, ne rien pousser.

7. Envoyer le mail avec l'outil Gmail `send_message` :
   - `to` et `subject` : ceux de `AAAA-MM-JJ.email.json` ;
   - `htmlBody` : le contenu **intégral et inchangé** du fichier `htmlFile` ;
   - `body` : une version texte courte (le verdict de la synthèse et le lien
     https://outilsmarketing.kaufmanbroad.fr/apps/controleDonnees.html) ;
   - `attachments` : une entrée par élément de `attachments` de `email.json` —
     `content` = le fichier `file` en base64 (`base64 -w0 <file>`, sortie complète et inchangée),
     `filename` et `mimeType` = ceux de `email.json`.
   En cas d'échec, réessayer une fois ; si l'échec persiste, le dire dans la sortie de la session.

## Règles des descriptifs

Ce qu'on cherche : un texte qui annonce ce que le **stock de la famille** ne porte pas. Trois
textes sont analysés, avec les mêmes règles : le **descriptif**, le **titre événement** et la
**description événement** (champs `merchandisingTitle` / `merchandisingDescription`, affichés
sous le descriptif quand ils existent). Le dossier donne, pour chaque programme, le stock
**diffusé** (lot et programme diffusés B2C), **disponible** (Libre, Option, vide) et
**commercialisable** (hors virtuels et hors grille non validée) de toute sa famille — la racine
(on remonte les parents) et tous ses descendants, plus les programmes de même code d'étude — en logements et en autres lots, ses lots
virtuels diffusés à part, l'offre du programme et sa validité au jour du rapport. **Seuls les
lots diffusés comptent** : un lot disponible mais non diffusé n'existe pas pour ce contrôle.
La ligne « logements de la résidence, tous états » ne sert qu'à juger un nombre total de
logements annoncé (« résidence de 40 appartements »).

**Ne pas signaler** : les généralités marketing (cadre de vie, transports, prestations,
architecture) ; l'absence de nom (`operationName` vient de lots.csv) ou un nom générique
(« Nouvelle résidence », « Prochainement »…), qui est normal ; un descriptif marqué « identique à
celui de X, parent de la famille » : il n'est jugé que sur X (programmes d'une même opération) ; un lot non diffusé ; le statut Backbone, qui
n'est pas pris en compte ; un enfant au descriptif vide ou repris du parent si la famille a le
stock annoncé ; une mention TVA 5,5 % dès qu'un lot disponible de la famille a une TVA réduite ;
un programme en avant-première dont le stock n'est fait que de lots virtuels (`VIRTUELS SEULS`),
sauf si le texte contredit les typologies de ces lots virtuels.

**Programme `SANS STOCK`** (aucun lot diffusé disponible dans la famille, logements comme autres
lots, virtuels compris) : `sansStock: true`.
- Le texte ne parle pas de stock (il décrit seulement la résidence, ses typologies d'origine
  — « déclinés du 2 au 4 pièces » —, ou il est vide) : `parleDuStock: false`, `anomalies: []`.
  Rien n'est signalé.
- Il en parle (« dernier 3 pièces », « dernière opportunité », « encore disponible », « il reste »,
  un lot précis décrit, un prix « à partir de ») : `parleDuStock: true` et **une anomalie** de
  type `stock`, sévérité `faible`, avec l'extrait en cause. Ces programmes forment un groupe à
  part, en fin de liste : jamais en priorité haute.

**Programme avec stock** : une anomalie par écart réel, avec sa sévérité.

| Type | Écart | Sévérité |
|---|---|---|
| `typologie` | typologie annoncée **comme disponible** (« dernier T3 », « encore des maisons ») absente du stock de la famille | forte |
| `typologie` | gamme de présentation (« du 2 au 4 pièces ») dont **aucune** typologie n'est en stock | moyenne |
| `typologie` | gamme de présentation dont une partie seulement manque | faible |
| `prix` | prix « à partir de » annoncé inférieur de plus de 3 % au prix minimum réel (remise valable déduite) | forte |
| `prix` | prix « à partir de » supérieur de plus de 15 % au prix minimum réel | faible |
| `offre` | remise, frais de notaire offerts ou offre annoncés alors qu'ils n'existent ni dans l'offre programme valable ni sur un lot disponible ; offre datée dans le texte et expirée | forte |
| `ville` | la résidence est située dans une autre ville que celle du programme (les villes voisines citées pour la desserte ne comptent pas) | forte |
| `quantite` | nombre de logements disponibles ou total annoncé faux (comparer à `logements au total` et au stock) | moyenne |
| `surface` | surface annoncée pour un lot ou une typologie disponible hors de la plage du stock | moyenne |
| `statut` | livraison, travaux, lancement ou événement (portes ouvertes…) dépassés au jour du rapport, ou contraires au statut programme | moyenne (événement passé : faible) |
| `copie` | texte identique à celui d'un programme d'une **autre** famille (ligne « Texte identique à » du dossier), ou nom d'un autre programme dans le texte. Jamais entre programmes d'une même famille | moyenne |
| `prix_aberrant` | prix au m² aberrant dans la grille (ligne « prix aberrants » du dossier) : donnée à corriger | faible |

Champs d'une anomalie : `champ` (`descriptif`, `titre événement` ou `description événement` :
le texte d'où vient l'extrait ; `stock` pour `prix_aberrant`), `extrait` (citation exacte et
courte de ce texte ; pour `prix_aberrant`, le lot), `constat` (ce que dit le stock, chiffré), `commentaire` (l'action à mener, une phrase).
Ne rien affirmer que le dossier ne dise pas.
