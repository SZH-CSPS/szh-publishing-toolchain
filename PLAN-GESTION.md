# PLAN — Gestion de revue (méta-données, revues, articles, assets)

> Spec d'implémentation auto-porteuse, sur le modèle de `PLAN-COCKPIT.md`. Décisions D37–D41
> actées le 2026-07-15 (Robin Morand). Exécution **tranche par tranche**, un commit `G<n>: …`
> chacune, gate humain entre chaque. Conventions du dépôt à respecter : « Garde-fous » (§8 de
> PLAN-COCKPIT.md) — JS pur, zéro dépendance, API VS Code ^1.75, PowerShell 5.1, tout en français.
>
> ⚠ Les décisions D37–D41 sont **à transcrire dans `PLANIFICATION.md`** par Robin, avec le lot
> D34 aujourd'hui non commité (je ne touche pas à PLANIFICATION.md tant que D34 y traîne — cf.
> note S5). Elles font foi ici en attendant.

---

## 1. Résumé

Étendre l'extension `szh-cockpit` (D36) d'une **gestion de revue** : éditer les méta-données d'un
numéro dans un **formulaire (webview)** qui écrit `ausgabe.yaml` ; **créer / ouvrir** une revue
depuis l'éditeur ; **supprimer** un article et tous ses fichiers liés ; **effacer** le docx source
après conversion ; **gérer les images** (lister, contrôler taille/dimensions, remplacer) depuis la
barre. Tout dans `szh-cockpit` (une webview + des actions de tree), livré par le canal existant
(CI → VSIX → `manifest.json` → `update.ps1`).

## 2. Périmètre

**Objectif** : un rédacteur pilote un numéro **de bout en bout** depuis la barre « Revue SZH » —
métadonnées, articles, images — sans éditer de YAML à la main, sans explorateur ni terminal.

**Critères de succès (observables)**
- Ouvrir « Méta-données du numéro » → modifier un champ → Enregistrer → `ausgabe.yaml` reflète la
  valeur (et les clés/commentaires non gérés sont préservés).
- « Nouvelle revue » → choisir un dossier → une revue valide (`ausgabe.yaml` + `articles/` +
  `articles-word/`) est créée et ouverte.
- « Supprimer l'article X » (confirmation) → `articles/X/` **et** `out/X/` disparaissent, l'article
  quitte la liste.
- Importer un docx → l'article apparaît **et** le `.docx` source a disparu d'`articles-word/`.
- Déplier un article → ses images listées (taille + dimensions) ; « Remplacer » → l'image est
  échangée, le prochain build montre la nouvelle.

**Hors périmètre (explicitement)**
- **Affichage** des méta-données (volume/numéro/revue) dans le PDF (bandeau/ours) : c'est du
  rendu (template HTML + `print.css`) — tranche ultérieure, pas ici. G1 se limite à **éditer +
  persister** dans `ausgabe.yaml`.
- Analyse « qualité » d'image au-delà de **taille + dimensions** (pas de lib de traitement d'image).
- Conversion de format d'asset (png↔jpg), recadrage, compression.
- Historique/annulation, opérations en masse, corbeille applicative.
- `.odt` (import `.docx` uniquement, D35).

**Contraintes & hypothèses**
- `szh-cockpit` : **JS pur, zéro dépendance, API ^1.75**. La webview : **CSP stricte, tout inline**
  (aucune ressource externe), thème clair/sombre via les variables VS Code.
- Écriture `ausgabe.yaml` **sans lib YAML** : fichier plat, sérialiseur maison qui **préserve les
  lignes non gérées** (à valider — R1).
- `update.ps1` **inchangé** ; livraison identique au cockpit (VSIX maison, sha au build → manifest).
- **Assets** : le remplacement conserve le **nom de fichier** (le lien du `.md` reste valide).

## 3. Approche technique — décisions (ADR)

**D37 — Méta-données : webview formulaire.** Contexte : le rédacteur ne doit pas voir de YAML.
Décision : commande `szh.metadonnees` (bouton en tête de la vue) ouvrant un `WebviewPanel`
« Méta-données du numéro » ; formulaire → `postMessage` → l'hôte réécrit `ausgabe.yaml`.
**Schéma de clés** (consommables par le futur template de rendu) :
`title` (titre du dossier thématique) · `revue` (nom de la revue) · `volume` · `numero` (issue) ·
`date` (date de publication) · `lang` (fr/de/en/it). Les autres clés présentes (`subtitle`…) sont
**préservées**. Conséquence : première webview du dépôt ; ~200–300 lignes (HTML/CSS/JS + pont).

**D38 — Créer / ouvrir : dans le PowerShell (lanceur), PAS dans l'extension** (corrigé 2026-07-15 ;
revient à la reco initiale). Raison de fond : la vue cockpit n'existe **que dans une revue déjà
ouverte** (contexte `szh.estRevue`) — « ouvrir une autre revue » / « créer une revue » depuis le
cockpit serait un chicken-and-egg. Le point d'entrée naturel est le **lanceur « Revues SZH »**
(`open-revue.ps1`, menu Démarrer), qui tourne **avant** toute revue ouverte.
Décision : `open-revue.ps1` gagne une action **« ＋ Nouvelle revue… »** à côté de la liste des revues
existantes ; elle appelle `new-revue.ps1` (scaffold + « Ouvrir la revue.lnk » + enregistrement, déjà
écrits) puis ouvre la revue. Ouvrir une revue existante = déjà le rôle du lanceur. **Aucune commande
create/open dans l'extension** → source unique, pas de duplication (R3 dissous).

**D39 — Import : suppression du docx après conversion réussie.** Le `Makefile` (cible `import`)
remplace `mv -f "$$f" _convertis/` par `rm -f "$$f"`. **Seuls les docx convertis avec succès** sont
supprimés ; un docx « déjà converti (ignoré) » **reste** (marqueur ⚠, il peut être une nouvelle
version à renommer). `_convertis/` n'est plus créé. Conséquence : plus de doublons fantômes ; perte
du filet « ré-import depuis la source » (le `.md` est déjà la copie de travail). Retour arrière = git.

**D40 — Suppression d'article depuis le tree.** Bouton inline « Supprimer » (corbeille) sur un
article → **confirmation modale** → efface `articles/<slug>/` + `out/<slug>/`. Première action
destructive du cockpit ; garde-fou modal obligatoire ; jamais silencieux.

**D41 — Assets dans le tree.** L'article devient **dépliable** ; ses enfants = les images de
`articles/<slug>/media/` (récursif), avec **taille + dimensions** en légende ; clic = **aperçu
natif** (VSCodium ouvre l'image) ; bouton inline « Remplacer » → `showOpenDialog` (image) → écrase
le fichier cible **en conservant son nom**. Dimensions lues des en-têtes PNG/GIF/SVG (triviales) ;
JPEG au mieux (parcours des marqueurs SOF) — sinon taille seule.

**Points d'intégration** : `vscodium-extension/szh-cockpit/` (extension.js + package.json ; webview
inline, pas de `media/`), `pipeline/Makefile` (D39, cible `import`), `windows/open-revue.ps1` (G2 :
bouton « Nouvelle revue… ») + `windows/new-revue.ps1` (inchangé), `release.yml` (inchangé — packe
déjà szh-cockpit + le toolkit qui embarque les `.ps1`), `userdoc.md` (gestes), `README`.

## 4. Découpage — tranches verticales (ordre d'exécution recommandé)

Ordre par risque : **G1 d'abord** (webview = techno nouvelle, à dérisquer) ; **G4** trivial et
indépendant ; puis G3, G5, G2.

### G1 — Méta-données (webview) *(taille M ; dérisque la webview)*
- [x] Commande `szh.metadonnees` + bouton en tête de vue ; `WebviewPanel` « Méta-données du numéro ».
- [x] Lecture `ausgabe.yaml` → parse des clés du schéma D37 → pré-remplit le formulaire (langue =
      liste déroulante fr/de/en/it ; date = champ `type=date`).
- [x] « Enregistrer » → `postMessage` → l'hôte réécrit `ausgabe.yaml` : met à jour les clés du
      schéma, **préserve les lignes non gérées**, échappe correctement les valeurs (deux-points,
      accents, guillemets). Écriture atomique (fichier temporaire + rename).
- [x] CSP stricte, styles via variables de thème VS Code, aucun script/ressource externe.
- **Acceptation** : modifier « Volume » → Enregistrer → `ausgabe.yaml` contient `volume: …` ; une
  clé `subtitle:` préexistante et un commentaire d'en-tête sont **toujours là** ; rouvrir le
  formulaire ré-affiche les valeurs. Vérif headless du sérialiseur (round-trip + préservation).

### G4 — Import : suppression du docx *(taille XS ; pipeline)*
- [ ] `pipeline/Makefile` cible `import` : `rm -f` au lieu de `mv … _convertis/` sur succès ; ne
      plus créer `_convertis/` ; « déjà converti (ignoré) » **laisse** le docx. Commentaires à jour.
- **Acceptation** : importer 2 docx → 2 articles + `articles-word/` **vide** ; re-déposer un docx
  déjà converti → il **reste** (⚠), l'import le signale « ignoré » sans le supprimer.

### G3 — Supprimer un article *(taille S)*
- [ ] Commande `szh.supprimerArticle` (inline corbeille, `viewItem == article`) → `showWarningMessage`
      modal (« Supprimer « X » et son PDF ? Action irréversible. ») → `rm -rf articles/<slug>` +
      `out/<slug>` → refresh. Ferme proprement si des onglets du dossier étaient ouverts.
- **Acceptation** : supprimer un article → dossiers `articles/X` et `out/X` disparus, article hors
  liste ; annuler la modale → rien n'est touché.

### G5 — Assets : lister + remplacer *(taille M)*
- [ ] Article `collapsibleState = Collapsed` s'il a des images (sinon `None`) ; le clic ouvre
      toujours le `.md`, la flèche déplie les assets.
- [ ] `getChildren(article)` → images de `media/` (png/jpg/jpeg/gif/svg), légende « L×H, taille » ;
      clic = `vscode.open` (aperçu natif) ; `contextValue = 'asset'`.
- [ ] Bouton inline « Remplacer » (`viewItem == asset`) → `showOpenDialog` (filtre images) → si
      l'extension diffère de la cible, **avertir** (le lien `.md` pointe l'ancien nom) ; écraser le
      fichier cible (même nom) ; refresh.
- [ ] Helper dimensions sans dépendance (PNG/GIF/SVG sûrs ; JPEG au mieux).
- **Acceptation** : déplier un article importé → ses images listées avec dimensions ; « Remplacer »
  par une autre image de même nom → build → le PDF montre la nouvelle image.

### G2 — Créer / ouvrir une revue : lanceur PowerShell *(taille S ; indépendant de G1 ; PS 5.1)*
- [ ] `windows/open-revue.ps1` : ajouter un bouton **« Nouvelle revue… »** dans la fenêtre WinForms
      (à côté de « Ouvrir » / « Annuler ») → demande dossier parent + nom (ou un dossier) → appelle
      `new-revue.ps1 -Dossier <…>` → ouvre la revue créée dans VSCodium.
- [ ] **Rien dans l'extension** (pas de commande create/open). `new-revue.ps1` inchangé (déjà :
      scaffold depuis le template + « Ouvrir la revue.lnk » + enregistrement pour le lanceur).
- [ ] Garde-fous PS 5.1 (pas de `?.`/`??`/`&&`), français, BOM UTF-8 + CRLF comme les autres `.ps1`.
- **Acceptation** : menu Démarrer → « Revues SZH » → « Nouvelle revue… » → saisir un nom → une revue
  valide est créée, enregistrée et ouverte ; ouvrir une revue existante marche comme avant.

## 5. Definition of Done (par tranche)
- Testée sur la revue réelle `test` (pas seulement fixture).
- Zéro dépendance ; JS pur ; webview autonome (CSP, inline) ; PS 5.1 si PS touché (ici : aucun).
- `node --check` + JSON valides ; vérif **headless** du comportement (sérialiseur YAML, diff de
  liste, dimensions) + **scénario GUI** précis fourni pour ce qui exige l'interface.
- Copie dev mise à jour + **redémarrage VSCodium** requis (rappel : pas de déploiement auto avant tag).
- Docs à jour quand la tranche les touche ; case cochée ici ; commit `G<n>: …`.

## 6. Risques
| # | Risque | Prob. | Impact | Mitigation |
|---|---|---|---|---|
| R1 | Sérialiseur YAML maison clobbe commentaires/clés inconnues ou mal-échappe | M | M | Préserver les lignes non gérées ; échappement des valeurs ; écriture atomique ; **test round-trip headless** sur un `ausgabe.yaml` réel avant G1-done |
| R2 | Item article dépliable ET cliquable (clic vs flèche) ambigu | M | F | Vérifier en GUI ; repli : nœud enfant « Images (n) » plutôt que dépliage direct |
| R3 | ~~Divergence create extension vs `new-revue.ps1`~~ **Dissous par D38** : create/ouvrir uniquement en PS (source unique) | — | — | — |
| R4 | Remplacement d'asset avec extension différente → lien `.md` cassé | M | M | Avertir/refuser si extension ≠ ; documenter « même format » ; (option future : mettre à jour le lien) |
| R5 | Webview : fuite hors CSP / ne suit pas le thème | F | F | CSP stricte, `data:`/inline only, variables `--vscode-*` ; test clair/sombre |
| R6 | Suppression d'article irréversible sur mauvais clic | F | M | Modale de confirmation nommant l'article ; jamais de suppression silencieuse |

## 7. Questions ouvertes (à trancher au fil de l'eau, non bloquantes)
- Schéma exact des clés `ausgabe.yaml` (noms `numero` vs `issue`, `revue` vs `journal`) — figé en
  D37 mais réajustable quand le **rendu** (bandeau PDF) sera fait.
- ~~« Nouvelle revue » dans l'extension ou le lanceur ?~~ **Tranché (D38)** : dans le lanceur PS.
- Afficher les métadonnées dans le PDF (ours/bandeau) : tranche de rendu séparée (post-G).
