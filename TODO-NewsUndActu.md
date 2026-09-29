# TODO — _NewsUndActu (Documentation)

Rapport de référence : [RAPPORT-VEILLE-DOCUMENTATION.md](RAPPORT-VEILLE-DOCUMENTATION.md) (24.09.2026).
Projets de la première moisson, à trier : [PROJETS-RECHERCHE-A-TRIER.md](PROJETS-RECHERCHE-A-TRIER.md).

## Moissonneur de recherches (`..\szh-harvest-research\`) : à trancher

- [ ] **FNS et robots.txt.** data.snf.ch interdit tout robot, même pour ses données ouvertes.
      Trois options : télécharger l'export à la main (état actuel), demander au FNS si l'usage
      est toléré, ou faire une exception documentée pour ce seul hôte.
- [ ] **Largeur du filtre FNS.** Le réglage actuel retient 95 subsides et perd Tea2C. La règle
      « toute la psychologie passe » retrouve Tea2C mais ramène 1126 subsides.
- [ ] **Où vont les fiches exportées.** Dans `sortie\`, puis copie à la main (état actuel), ou
      directement dans `_NewsUndActu\Fiches\` avec `--vers`, où elles arrivent au Réservoir.
- [ ] **Descriptif.** Le résumé brut de la source est souvent en anglais. À reformuler à la main,
      ou proposer une suggestion de/fr générée ?
- [ ] **Langue des titres anglais** (FNS) : `de` par défaut. À confirmer.
- [ ] **Suisse romande mal couverte** (HEP Vaud seule, au mieux). Faut-il ajouter UNIGE, UNIFR
      (pédagogie curative), HETSL, HES-SO ? Demander un flux à la PHZH et à la PHLU, dont les
      listes sont illisibles sans JavaScript ?
- [ ] **Rythme.** Tâche planifiée hebdomadaire sous Windows, ou lancement à la main à chaque
      numéro ?
- [ ] **Dépôt.** Faut-il un dépôt distant et un premier commit pour `szh-harvest-research` ?
- [ ] **Défauts vus dans la première liste, à corriger** : dates de la PH FHNW mal lues
      (« Septemb », « 1.4.202 ») et absentes pour la PHSG et la HEP Vaud ; doublons entre sources
      non fusionnés quand les titres diffèrent (SWING et FluSS vus à la fois par le FNS et par
      l'école) ; bruit médical du FNS sur « disability ».

## Catégories des fiches : à trancher (rien d'implémenté)

- [ ] Adopter les **trois axes communs** (thème, degré ou étape de vie, besoins et handicap),
      et faire valider les libellés contre la terminologie SZH et CDIP.
- [ ] **Thèmes** : les 8 dossiers 21 à 28 de `1_Themen` tels quels ? Faut-il y ajouter
      compensation des désavantages et transition, tirés de sous-dossiers ? (Inclusion scolaire :
      non. Vieillesse : supprimée. Enfants et adolescent·es : réunis. Âge de lecture : abandonné,
      décisions de Robin du 24.09.2026.)
- [ ] **Imprimé ou web seulement ?** Les nouvelles catégories seraient-elles des filtres du site
      seulement, ou aussi des pastilles imprimées, comme la catégorie actuelle ?
- [ ] **Sortir `jeunesse`** de la catégorie livre pour le mettre dans le public cible.
- [ ] **Film** : âge minimal (automatisation mesurée : 1 film sur 28 classé sur Wikidata ; TMDB
      à tester avec une clé ; quelle source fait foi en Suisse ?). *The Holdovers* est classé
      « documentaire » alors que c'est une fiction : à corriger dans la fiche., accessibilité (AD, sous-titres,
      langue des signes), clé TMDB pour préremplir.
- [ ] **Livre** : ajouter l'ISBN, qui permet de préremplir depuis la DNB et la BnF.
- [ ] **Suggestion automatique** : mots-clés, vedettes-matière DNB/BnF, ou modèle de langue ?
      Toujours validée par la rédaction.

## Veille des sources 2025

- [ ] Créer la bibliothèque de groupe Zotero et y abonner les flux RSS repérés (rapport, §1).
