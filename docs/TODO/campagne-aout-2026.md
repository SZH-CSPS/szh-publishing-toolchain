# Campagne du 23 août 2026 — ce qui reste

Points encore ouverts de la campagne du 23 août 2026, repris tels quels de `FEATURES.md`
(réduit au nettoyage du 01.10.2026 ; la spécification complète est dans l’historique git).

### Repris dans la vague 4 (vue « Articles » et remontée des messages)

- [ ] **Le badge « déjà converti » mentira.** `extension.js` (lignes 396 et 2194) appelle encore
  `slugifierArticle` ; un Word en attente dont le slug de base est pris est désormais importé
  avec un suffixe, pas ignoré. `slugifierArticleUnique` est exportée pour ce raccordement.
- [ ] **Le bouton « Changer la langue de l'article »** de `media/metadata-articles.html` n'a plus
  d'objet : la langue est désormais sur chaque carte. Son message a été réécrit pour renvoyer
  vers la carte, faute de pouvoir retirer le bouton hors territoire.
- [ ] **Le formulaire du numéro propose encore `en`** comme langue de numéro, alors que
  `langueDefaut()` la ramène à `fr` sans rien dire. Pré-existant, mais devenu visible depuis que
  l'article, lui, refuse une langue hors fr/de/it.

### Repris dans la vague 5 (harnais)

- [ ] **Deux contrôles de miroir manquent à `contrats.test.js`** : que `LANGUES_ARTICLE` de
  `lib/yaml.js`, `LANGUES_CHOIX` de `media/_commun.js` et la table `LANGUES` de
  `szh-maquette.lua` restent la même liste ; et que le brouillon de traduction garde son
  destinataire et sa langue par produit. Les deux vivent provisoirement dans
  `test/js/langue.test.js`.
- [ ] **Le scénario « toolkit plus ancien que l'extension »** n'est couvert par aucun test : il
  faudrait un faux `C:\ProgramData`. C'est pourtant le cas qui s'est produit cette semaine.

### Sans vague assignée

- [ ] **`docx-titres.py` et `import-medias.py`** gardent leur `|| true`, documentés comme non
  bloquants. À réexaminer une fois que les avertissements arrivent à l'écran.

### F7 — La légende par défaut disparaît

- [ ] À l'insertion d'une image, la légende est aujourd'hui pré-remplie avec le mot
  « Légende » (`fmt.figure.legende`), posé par `extension.js:5031` et
  `lib/formatting.js:170`. Le propriétaire le refuse, avec raison : **un texte par défaut
  se prend pour un texte rempli**, et l'image part sans légende en ayant l'air d'en avoir une.
  La légende naît donc **vide**.

  **Attention à un couplage** : `lib/export-ojs.js` construit `LEGENDES_PAR_DEFAUT` depuis
  cette même clé, précisément pour reconnaître la légende oubliée et le dire. Si la valeur
  par défaut devient vide, c'est le **vide** qu'il faut désormais détecter — et il faut
  garder la reconnaissance de l'ancien mot pour les articles déjà écrits, sinon leur
  légende oubliée redevient invisible.

- [ ] **Ne rien changer aux images importées** : la légende et le texte alternatif venus du
  Word sont repris comme aujourd'hui. C'est explicitement demandé.
