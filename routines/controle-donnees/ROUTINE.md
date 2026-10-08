# Routine « Contrôle des données » (lundi et jeudi, 5 h UTC)

Mail aux directeurs : offre diffusée (programmes et lots B2C, par état d'avancement et par
regroupement d'agences) et problèmes de données des Apps 1 et 5, par regroupement, avec la
variation depuis le dernier rapport historisé et un lien vers chaque liste dans outilsMarketing.

Ce fichier est le prompt de la routine cloud : la routine se contente de demander de le suivre.

## Prompts à coller dans les routines

Routine planifiée (prod) :

```
Mode : prod. Suis exactement routines/controle-donnees/ROUTINE.md (section « Déroulement »).
```

Routine de test (lancée à la main) :

```
Mode : test. Suis exactement routines/controle-donnees/ROUTINE.md (section « Déroulement »).
```

Recette (exécution ponctuelle, pour vérifier toute la chaîne de la prod, push compris, avec un
mail au seul destinataire de test) :

```
Mode : recette. Suis exactement routines/controle-donnees/ROUTINE.md (section « Déroulement »).
```

## Prérequis de la routine

- Node 20+ (aucune dépendance npm).
- Accès réseau à `outilsmarketing.kaufmanbroad.fr` (lecture de `config.js`) et à
  `outilsmarketing.blob.core.windows.net` (CSV).
- Connecteur **Gmail** (compte jcpoirot@dimake.io).
- Prod et recette : droit de pousser sur `main` (l'historique sert de référence aux variations).
  Il est donné par l'app GitHub « Claude », qui doit avoir accès à ce dépôt.

## Déroulement

Le **mode** est donné en tête du prompt. `FLAG` vaut `--prod` en mode prod, `--recette` en mode
recette, rien en mode test. Les fichiers sont dans `historique/controle-donnees/` en prod,
`historique/controle-donnees/recette/` en recette, `out/controle-donnees/` en test ;
`AAAA-MM-JJ` est la date du jour à Paris, affichée par l'étape 1.

1. Lancer `npm run controle-donnees:analyse -- FLAG`. Il écrit `AAAA-MM-JJ.json` et affiche un résumé.
   - S'il échoue : lancer `npm run controle-donnees:email -- FLAG --echec "<les 40 dernières lignes
     de la sortie d'erreur>"`, envoyer le mail comme à l'étape 5, puis s'arrêter (aucun commit).

2. Lire `AAAA-MM-JJ.json` : `diffusion` (totaux, `parStatut`, `parRegroupement`, avec `variation`),
   `indicateurs` (`total`, `variation`, `parRegroupement`, `variationParRegroupement`),
   `datePrecedente`. Les variations valent `null` s'il n'y a pas de rapport précédent.

3. Écrire `AAAA-MM-JJ.synthese.md` à côté du rapport, en français, **10 lignes maximum**, en
   Markdown simple (listes `-`, gras `**`), pour des directeurs :
   - **Verdict** en une phrase : la qualité des données s'améliore, se dégrade ou est stable
     depuis le `datePrecedente`, et pourquoi.
   - Les **2 ou 3 faits marquants** : plus fortes hausses ou baisses d'indicateurs, regroupement
     qui se distingue, évolution notable de l'offre diffusée (programmes ou lots).
   - Règles : ne rien affirmer qui ne figure pas dans le rapport ; ne pas recopier les tableaux
     du mail ; nommer un regroupement par sa partie avant le `|` (« Ouest ») ; premier rapport
     (`datePrecedente` nul) : décrire l'état sans parler d'évolution.

4. Lancer `npm run controle-donnees:email -- FLAG`. Il écrit `AAAA-MM-JJ.email.html` et
   `AAAA-MM-JJ.email.json` (`to`, `subject`, `htmlFile`).
   - **Prod** : commiter `historique/controle-donnees/AAAA-MM-JJ.json` et
     `historique/controle-donnees/AAAA-MM-JJ.synthese.md` (message :
     `controle-donnees: rapport du AAAA-MM-JJ`) et pousser sur `main`. Ne modifier ni commiter
     aucun autre fichier. Si le push échoue, envoyer quand même le mail et le signaler dans la
     sortie de la session (les prochaines variations partiront du rapport précédent).
   - **Recette** : comme la prod, mais avec les deux fichiers de
     `historique/controle-donnees/recette/` et le message `controle-donnees: recette du AAAA-MM-JJ`.
     Un push qui échoue est ici le résultat à signaler en tête de la sortie de la session.
   - **Test** : ne rien commiter, ne rien pousser.

5. Envoyer le mail avec l'outil Gmail `send_message` :
   - `to` et `subject` : ceux de `AAAA-MM-JJ.email.json` ;
   - `htmlBody` : le contenu **intégral et inchangé** du fichier `htmlFile` ;
   - `body` : une version texte courte (le verdict de la synthèse et le lien
     https://outilsmarketing.kaufmanbroad.fr/apps/controleDonnees.html).
   En cas d'échec, réessayer une fois ; si l'échec persiste, le dire dans la sortie de la session.
