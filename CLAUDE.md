# CLAUDE.md — kb-outilsmarketing-routines

Fonctionnement, modes et commandes : `README.md`. Déroulé de chaque routine : son `ROUTINE.md`
(c'est le prompt exécuté par la routine cloud — toute modification change ce que fait la
routine au prochain lancement, une fois poussée).

## Règles

- **Pousser uniquement sur demande explicite.** Les routines cloud lisent `main` : un push
  modifie la prochaine exécution.
- **Zéro dépendance npm**, Node 20+ (`fetch`, `node:util` `parseArgs`, modules ES).
- **Mode test par défaut** : `--prod` est explicite. En local, ne jamais lancer `--prod` puis
  commiter un rapport à la main sans demande : il deviendrait la référence des variations.
- **Les chiffres doivent être ceux des apps.** `routines/controle-donnees/indicateurs.js`
  reprend le code et les filtres par défaut des Apps 1 et 5 (`outilsMarketing/apps/`). Toute
  évolution d'un contrôle, d'un côté ou de l'autre, se reporte de l'autre côté et se vérifie avec
  `NODE_OPTIONS=--use-system-ca npm run parite`. Les liens du mail portent le regroupement dans
  le hash (`#/loyers?regroupement=…`, `#/?regroupement=…`), lu par les deux pages.
- **Descriptifs et stock** : contrôle sans équivalent dans les apps (pas de parité). Le script
  (`descriptifs.js`, `consolider.js`) calcule tout ce qui est calculable ; Claude ne juge que le
  texte, selon les « Règles des descriptifs » de `ROUTINE.md`, et seulement pour les programmes
  dont le `hash` a changé. Toute règle nouvelle va dans `ROUTINE.md` **et** dans la notion
  « Cohérence descriptif / stock » de `outilsMarketing/.claude/rules/ontologie.md`.
  `programsDescriptions.csv` se lit avec `parseCSVStrict`, jamais avec le parseur des apps.
- **Mails** : HTML à styles en ligne et tableaux (`lib/email.js`), pas de CSS externe ni de
  flex/grid. L'envoi est fait par le script (`lib/gmail.js`, API Gmail) : ne jamais faire recopier
  par le modèle un fichier encodé (base64) dans un outil, c'est la cause de l'échec du 08/10/2026.
  Identifiants `GMAIL_*` en variables d'environnement, jamais dans le dépôt.
- Textes en français avec accents ; identifiants en anglais ou en français selon le domaine
  (indicateurs métier en français, comme dans les apps).
- Proxy TLS en local : `NODE_OPTIONS=--use-system-ca`, jamais de désactivation de la vérification TLS.
