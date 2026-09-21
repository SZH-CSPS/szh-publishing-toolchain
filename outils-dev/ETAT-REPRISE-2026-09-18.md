# Nettoyeur de manuscrit — état de la reprise, 18.09.2026 au soir

Pour qui reprend sans avoir suivi. Branche `worktree-nettoyeur-manuscrit`
(worktree `.claude/worktrees/nettoyeur-manuscrit`), rebasée sur `main`, **rien n'est mergé dans `main`**.
Le contrat reste `ARCHITECTURE-nettoyeur-manuscrit.md` ; `BRIEF-REPRISE-nettoyeur-manuscrit.md`
décrit l'état d'AVANT cette reprise.

## Décisions de Robin (18.09.2026)
Vale dans l'image WSL (règles YAML éditables) ; révisions Word pour les corrections textuelles
déterministes, commentaires ancrés plafonnés pour le jugement, rapport HTML pour le volume ;
numéros manuels des titres retirés (le gabarit numérote) ; bibliographie : croisement
citations/références, DOI (Crossref, DOI seul envoyé), remise en forme APA 7 en révision.

## Commité sur la branche (dans l'ordre)
1. état repris tel quel + 14 scripts utf-8 (commit isolé, à garder ou jeter) ;
2. pont typographique : pandoc direct sous Linux, langue = produit, repli signalé, test en WSL ;
3. écrivain : XML valide, notes écrites, puce U+F0B7, ratios d'image, `correspondance` ;
4. bibliographie `manuscrit_biblio.py` ;
5. lecteur : tirets, champs, symboles, notes par id, VML, `Fragment.effectif` ; nettoyage des cellules ;
6. note opaque dans le pont typo ;
7. Vale 3.22.0 (`pipeline/vale/`, `manuscrit_vale.py`, Containerfile, CI), `manuscrit_regles.py` → 17 règles structurelles ; règle « cf. ».

Mesure après ces commits (chaîne complète dans la WSL, 12 manuscrits) : typographie appliquée
partout, 220 parties XML valides, 21/34 faux titres rattrapés, 0 vrai titre détruit,
pseudo-titres 6/17, 1/20, 2/16 (le lot titres v3 était en cours, voir ci-dessous).

## En cours au moment de l'arrêt (travail NON commité, présent dans l'arbre)
- **Titres v3** : COMMITÉ (31 tests verts) — 25/34 rattrapés, 0 détruit, 0 séparateur promu, coenseignement 4/4 ; pseudo-titres d'un manuscrit tout en gras (`3bis_`) toujours 1/17, à reprendre. Était :
  signatures sur la mise en forme effective, titres en liste numérotée isolés promus et numéro
  retiré, exclusions `────`/e-mail/téléphone/URL/légendes, plafond 3 niveaux rabattu. Cibles :
  ≥ 29/33, 0 détruit, ≥ 14/17, ≥ 15/20, ≥ 12/16, « coenseignement » 4/4.
- **En-tête** : COMMITÉ le 21.09 (182 tests verts) — titre 10/11, résumé 10/10, auteurs 9/11 ; manques connus : byline avant le titre (`3_VF`), auteur multi-lignes avec emoji (`4_`). Était :
  `manuscrit-entete.test.js`) : titre, sous-titre, auteurs, résumé, mots-clés vers le gabarit,
  relus par `pronto-lire.py` ; rôles passés aux règles ; en-tête retiré du corps AVANT
  `classer_titres`. Doit aussi remplacer dans `manuscrit-nettoyer.test.js` les deux attentes
  sur `Epicene.FormesContracteesProscrites` (règle passée à Vale).
- **Annotation Word** : COMMITÉ (13 tests verts), non branché dans la CLI.
  révisions `w:ins`/`w:del` auteur dédié, commentaires ancrés via `correspondance`, plafond
  25 et 5 par règle, preuve par `pandoc --track-changes`.

Pour juger ce qui est dans l'arbre : `git status --short`, lire `RAPPORT.md` de chaque agent
s'il existe encore dans le scratchpad de la session, sinon relancer les fichiers de test
concernés, puis la chaîne complète dans la WSL.

## Reste à faire après ces trois lots (le branchement CLI et le rapport Twig sont EN COURS le 21.09)
1. **Branchement CLI** : appeler `manuscrit_vale.analyser()` (rôles `bibliographie` sur les
   paragraphes de biblio) et `manuscrit_biblio.analyser_bibliographie()` depuis
   `manuscrit-nettoyer.py`, fusionner les alertes (retirer de `manuscrit_regles.py` ce que
   `manuscrit_biblio` recouvre : `APA.OrdreAlphabetiqueBiblio`, `APA.NombreAuteursListes`),
   puis `manuscrit_annoter.annoter()` sur le `.docx` produit avec `correspondance`.
2. **Rapport HTML** : gabarit `vscodium-extension/szh-cockpit/export-templates/rapport-manuscrit.twig`
   (l'onglet du lanceur l'appelle déjà via `outils/rendre-gabarit.js`), groupé par famille,
   dix premières occurrences par règle et le total, verdict image par `lib/qualite-image.js`.
3. Suite complète verte (`node --test test/js/*.test.js`, `python test/typo-check.py`),
   commentaires de tête de fichiers raccourcis (plusieurs agents ont laissé des pavés).
4. Mesure de faux positifs sur des versions publiées (dix numéros), lot C allemand, entrée `.odt`,
   cas A réel, puis merge dans `main` et release (bump des extensions, image WSL à reconstruire
   pour Vale — voir `TODO-UPGRADE-WSL.md`).

## Demandé par Robin le 21.09.2026, à faire une fois le branchement terminé
1. **Seconde passe sur les lignes directrices** (`outils-dev/Redaktionsrichtlinien Revue 2025.pdf`
   et `Zeitschrift 2025.pdf`) : relire chapitre par chapitre, améliorer les règles Vale YAML
   existantes et en ajouter pour toute prescription mécanisable non couverte, chaque règle avec
   son chapitre source et un positif/négatif au test.
2. **Lexique maison depuis les articles publiés** des deux dernières années sur ojs.szh.ch
   (galleys DOCX/PDF, Revue et Zeitschrift ; le corpus `tmp/corpus-ojs` de 421 galleys a été
   effacé, à remoissonner — voir la mémoire « Ce qu'ojs.szh.ch expose vraiment » pour les
   pièges du moissonnage) : analyse linguistique (fréquences, collocations, variantes
   orthographiques d'un même terme, sigles et leur développement, termes du handicap
   effectivement employés) → un lexique versionné dans `pipeline/vale/lexique/` (fr et de),
   exploité par Vale : vocabulaire accepté (`Vocab`), variantes à unifier (`Vocabulaire.Coherence`),
   sigles à développer (`Vocabulaire.Sigle`), termes privilégiés vs déconseillés mesurés sur
   l'usage réel, pas supposés. Mesure de faux positifs sur ces mêmes articles publiés.
   **Format (demande de Robin, 21.09)** : le lexique doit être exploitable humainement. Source de
   vérité versionnée en CSV/TSV (une ligne par terme : terme, langue, catégorie, forme privilégiée,
   variantes, fréquence corpus, exemples, sigle/développement, statut privilégié/déconseillé/neutre,
   source normative) ; exports générés par script : un classeur **.xlsx** pour la rédaction (un
   onglet par langue, filtres, mise en forme) et un **TBX** (TermBase eXchange, ISO 30042, format
   ouvert lu par les outils de terminologie et de TAO libres comme OmegaT) ; les règles Vale
   (`Vocab`, `Vocabulaire.Coherence`, `Vocabulaire.Sigle`) sont **générées** depuis le CSV, jamais
   éditées à la main — un seul endroit à corriger.
Supervision seule, tout délégué.

## Pièges payés ce soir
- Un agent qui fait `git add` fait entrer ses fichiers dans le commit du superviseur :
  toujours `git commit -- <chemins>`, et `git add` seulement pour les fichiers neufs voulus.
- `node --test test/js/` (dossier) ne trouve rien : passer le glob `test/js/*.test.js`.
- Vale : une section `.vale.ini` sans `*` en tête ne s'applique jamais ; un motif qui commence
  ou finit par un symbole exige `nonword: true` ; une substitution ne capture jamais la
  ponctuation ; le rôle `bibliographie` doit être posé sur les paragraphes pour que les
  règles de bibliographie s'appliquent.
- Tester le nettoyeur depuis le Python de Windows ne prouve rien : la production est la WSL.
