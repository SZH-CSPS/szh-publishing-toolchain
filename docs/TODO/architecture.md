# Architecture : pistes ouvertes

Ce qui reste du refactor d'octobre 2026 (release 3.0.0). Ce sont des pistes, pas des
engagements.

- **Ranger `vscodium-extension/szh-cockpit/lib/` en sous-dossiers par domaine** (commun,
  publication, documentation, secrétariat), sur le modèle de `lib/webviews/`. C'est utile
  seulement si les tests suivent sans réécriture.
- **Multiplateforme** : l'étape 1 de [`../MULTIPLATEFORME.md`](../MULTIPLATEFORME.md)
  (abstraire `poste.js` et `moteur.js` sans rien changer sous Windows) rend service même
  sans la suite.
- **Textes amont des patchs WeasyPrint** : à réécrire avec ses propres mots puis à poster,
  si Robin le décide. Voir [`../../image/patches/amont/README.md`](../../image/patches/amont/README.md).
- **`_chemin_wsl_exe` et `_requete`** restent en double dans le Python du nettoyeur, faute
  de test qui couvre le réseau ; à regrouper le jour où un test le permettra.
