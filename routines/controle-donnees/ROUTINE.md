# Routine « Contrôle des données » (lundi et jeudi, 5 h UTC)

Mail aux directeurs : offre diffusée (programmes et lots B2C, par état d'avancement et par
regroupement d'agences), problèmes de données des Apps 1 et 5, par regroupement, et cohérence
des descriptifs de programmes avec leur stock (détail en Excel joint), avec la variation depuis
le dernier rapport historisé et un lien vers chaque liste dans outilsMarketing.

En parallèle, chaque regroupement d'agences configuré dans `destinatairesParRegroupement`
(`config.json`) reçoit un mail limité à ses chiffres, avec sa propre synthèse et l'Excel de ses
seuls descriptifs.

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
- Envoi par le script : variables d'environnement `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET` et
  `GMAIL_REFRESH_TOKEN` (autorisation « gmail.send » de jcpoirot@dimake.io, voir le README), et
  accès réseau à `oauth2.googleapis.com` et `gmail.googleapis.com`. SMTP n'est pas joignable
  depuis les routines cloud.
- Connecteur **Gmail** (compte jcpoirot@dimake.io) : repli seulement, sans pièce jointe.
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
     de la sortie d'erreur>"`, lancer l'envoi comme à l'étape 7, puis s'arrêter (aucun commit).

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
     du mail ; nommer un regroupement par sa partie avant le `|` (« Ouest », « Centre-Est /
     Nord-Est 1 ») ; **ne jamais citer une personne** : le prénom après le `|` (« Margaux »,
     « Constance »…) n'apparaît jamais dans la synthèse ; premier rapport (`datePrecedente` nul) :
     décrire l'état sans parler d'évolution.

   **Synthèses régionales** : lancer `node routines/controle-donnees/lire-regroupements.js FLAG`.
   Il affiche, pour chaque regroupement qui reçoit un mail, ses chiffres et le fichier à écrire
   (`AAAA-MM-JJ.<regroupement>.synthese.md`). Pour chacun, écrire ce fichier, **5 lignes
   maximum**, mêmes règles que la synthèse générale mais à partir des **seuls chiffres de ce
   regroupement** affichés par le script : verdict pour le regroupement, puis 1 ou 2 faits
   marquants ; ne pas comparer aux autres regroupements ; ne jamais citer une personne. S'il
   affiche « Aucun mail régional », il n'y a rien à écrire. Les « Alertes de configuration »
   éventuelles sont à signaler en tête de la sortie de la session.

5. Lancer `npm run controle-donnees:email -- FLAG`. Il écrit `AAAA-MM-JJ.email.html` et
   `AAAA-MM-JJ.email.json` (`to`, `subject`, `htmlFile`, `attachments`), et pour chaque mail
   régional `AAAA-MM-JJ.<regroupement>.email.html` et `.email.json`. Une ligne « SANS synthèse »
   signale une synthèse régionale oubliée : l'écrire et relancer.

6. **Prod et recette** : lancer `npm run controle-donnees:historiser -- FLAG`. Il commite les
   seuls `AAAA-MM-JJ.json`, `AAAA-MM-JJ.synthese.md`, les synthèses régionales et
   `AAAA-MM-JJ.descriptifs.json` du mode et
   les pousse sur `main` (`HEAD:main`, avec un rebase si `main` a avancé). Ne faire aucun autre
   commit ni push, et ne pas pousser autrement que par ce script : le push sur `main` est
   autorisé par le propriétaire du dépôt pour ces seuls fichiers. Si le script échoue, envoyer
   quand même le mail et signaler l'erreur en tête de la sortie de la session (en prod, les
   prochaines variations partiront du rapport précédent ; en recette, c'est précisément ce que
   la vérification doit révéler).
   **Test** : ne rien commiter, ne rien pousser.

7. Lancer `npm run controle-donnees:envoyer -- FLAG`. Le script envoie lui-même le mail général
   puis les mails régionaux par l'API Gmail (corps HTML, version texte et Excel joint lus sur
   disque) : ne rien recopier.
   - Code de sortie 0 : tout est envoyé, c'est terminé.
   - Code 3 (identifiants Gmail absents) : **repli** pour chaque fichier `email.json` listé par
     le script. Code 1 : repli pour les seuls fichiers des lignes « ÉCHEC : » (les autres mails
     sont partis : ne pas les renvoyer). Repli = l'outil Gmail
     `send_message` du connecteur — `to`, `subject` et `body` (= `text`) du fichier `email.json`,
     `htmlBody` = le contenu **intégral et inchangé** du fichier `htmlFile`, **sans pièce
     jointe** (ne jamais recopier un fichier encodé en base64). Ne pas réécrire ni simplifier le
     mail. Signaler en tête de la sortie de la session que l'Excel n'a pas été joint, et pourquoi.
     En cas d'échec du connecteur, réessayer une fois.
   - Un mail d'échec (étape 1) suit le même chemin.

## Règles des descriptifs

Ce qu'on cherche : un texte qui annonce ce que le **stock de la famille** ne porte pas. Textes
analysés, avec les mêmes règles : le **descriptif**, le **titre événement** et la **description
événement** (`merchandisingTitle` / `merchandisingDescription`), le **texte annonces**
(`listingSitesDescription`, texte des portails d'annonces) et les **détails programme**
(`programDetails`). S'y ajoutent les **forces de programme** (`programStrengths`, étiquettes
choisies dans une liste). `overrideMainDescriptionB2B` et `unitsOverview` ne sont pas
analysés. Un texte long « identique à celui de X (même famille) » n'est jugé que sur X.

Un **champ vide** ne se signale jamais dans les verdicts : le script compte à part les
programmes dont le descriptif, le texte annonces ou les forces de programme sont vides (bloc
« Champs vides » du mail et de l'Excel). Les détails programme ne sont pas obligatoires : vides,
ils ne sont pas comptés.

Le dossier donne, pour chaque programme, le stock
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
stock annoncé ; une mention TVA 5,5 % dès qu'un lot disponible de la famille a une TVA réduite.

**Programme `VIRTUELS SEULS`** (avant-première) : ses lots virtuels diffusés sont traités comme
de vrais lots ; un texte qui annonce une typologie, une gamme ou un nombre qu'ils ne portent pas
est signalé comme pour un programme avec stock.

**Programme `SANS STOCK`** (aucun lot diffusé disponible dans la famille, logements comme autres
lots, virtuels compris) : `sansStock: true`.
- Le texte ne parle pas de stock (il décrit seulement la résidence, ses typologies d'origine
  — « déclinés du 2 au 4 pièces » —, ou il est vide) : `parleDuStock: false`, `anomalies: []`.
  Rien n'est signalé.
- Il en parle (« dernier 3 pièces », « dernière opportunité », « encore disponible », « il reste »,
  un lot précis décrit, un prix « à partir de ») — une simple invitation à acheter (« profitez de
  l'opportunité unique de devenir propriétaire », « profitez du PTZ et de la TVA réduite ») n'en
  est pas une : `parleDuStock: true` et **une anomalie** de
  type `stock`, sévérité `faible`, avec l'extrait en cause. Ces programmes forment un groupe à
  part, en fin de liste : jamais en priorité haute.
- Tous les textes du programme sont lus (descriptif, événement, texte annonces, détails) ; les
  **forces de programme** décrivent la résidence, pas le stock : jamais signalées sur un
  programme sans stock.

**Programme avec stock** : une anomalie par écart réel, avec sa sévérité.

- **Un écart, une anomalie** : le même écart repris dans plusieurs champs (la même gamme dans le
  descriptif, le texte annonces et les détails) ne fait qu'une anomalie, sur le champ le plus
  visible (descriptif, puis texte annonces, événement, détails programme, forces de programme) ;
  le `constat` cite les autres champs concernés. Deux écarts différents (gamme fausse ici,
  nombre de logements faux là) restent deux anomalies.
- Les **lots virtuels** diffusés comptent comme de vrais lots pour juger une gamme ou une typologie.
- Une incohérence entre deux textes du programme (distance, nom d'arrêt) n'est pas signalée,
  sauf si l'un d'eux contredit le stock ou la ville.

| Type | Écart | Sévérité |
|---|---|---|
| `typologie` | typologie annoncée **comme disponible** (« dernier T3 », « encore des maisons »), y compris dans une gamme présentée comme disponible (« Dernières opportunités du 2 au 4 pièces »), absente du stock de la famille | forte |
| `typologie` | typologie ou lot présenté sans marqueur de disponibilité (« le programme propose également une maison 4 pièces », « un bel appartement de 5 pièces de 107 m² ») absent du stock de la famille | moyenne |
| `typologie` | gamme de présentation (« du 2 au 4 pièces ») dont **aucune** typologie n'est en stock | moyenne |
| `typologie` | gamme de présentation dont une partie seulement manque — y compris la gamme d'origine d'une résidence presque vendue (« du studio au 5 pièces » quand il ne reste que des T3), dans tous les champs | faible |
| `prix` | prix « à partir de » annoncé inférieur de plus de 3 % au prix minimum réel (remise valable déduite) | forte |
| `prix` | prix « à partir de » supérieur de plus de 15 % au prix minimum réel | faible |
| `offre` | remise, frais de notaire offerts ou offre annoncés alors qu'ils n'existent ni dans l'offre programme valable ni sur un lot disponible ; offre datée dans le texte et expirée | forte |
| `ville` | la résidence est située dans une autre ville que celle du programme (les villes voisines citées pour la desserte ne comptent pas) | forte |
| `quantite` | nombre de logements disponibles ou total annoncé faux (comparer à `logements au total` et au stock) | moyenne |
| `surface` | surface annoncée pour un lot ou une typologie disponible hors de la plage du stock | moyenne |
| `statut` | livraison, travaux, lancement ou événement (portes ouvertes…) dépassés au jour du rapport, ou contraires au statut programme | moyenne (événement passé : faible) |
| `copie` | texte identique à celui d'un programme d'une **autre** famille (ligne « Texte identique à » du dossier), ou nom d'un autre programme dans le texte. Jamais entre programmes d'une même famille | moyenne |
| `texte_provisoire` | texte de travail resté en ligne : « XXX », « à compléter », « lorem ipsum », crochets à remplir | moyenne |
| `prix_aberrant` | prix au m² aberrant dans la grille (ligne « prix aberrants » du dossier) : donnée à corriger | faible |
| `force_programme` | **force de programme** contredite par la ville ou par les textes du programme : « Plage à proximité » loin de la mer, « Au pied des pistes » ou « Casiers à skis » hors station, « Jardins privatifs », « Balcon ou terrasse », « Parking sécurisé en sous-sol » ou « Caves » démentis par les textes. Une étiquette simplement non reprise dans les textes n'est pas un écart | faible |

Champs d'une anomalie : `champ` (`descriptif`, `titre événement`, `description événement`,
`texte annonces`, `détails programme` ou `forces de programme` : le texte d'où vient
l'extrait ; `stock` pour `prix_aberrant`), `extrait` (citation exacte et
courte de ce texte ; pour `prix_aberrant`, le lot), `constat` (ce que dit le stock, chiffré), `commentaire` (l'action à mener, une phrase).
Ne rien affirmer que le dossier ne dise pas.
