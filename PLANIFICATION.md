# Planification — Refonte du déploiement & workflow de layout

> Document de pilotage du projet. Décisions actées le **2026-07-03** (Robin Morand), poursuivies
> jusqu'à **D56**. Statut au **2026-08-13** : ✅ **P0 → P5 et P7 faits** ; lots cockpit **G, N, M1–M7**
> faits ; **reste** le pilote sur poste réel (checklist V1–V8, §5), la **phase P6** hors T6.1 (lanceur
> intelligent, association `.md`, profils de compilation) et les validations humaines du §7.
> Ce fichier est vivant : cocher les tâches au fur et à mesure, consigner ici toute nouvelle décision.

---

## 1. Objectifs

1. **Maintenance minimale** : une seule source de vérité par élément ; zéro retouche par poste ou par revue.
2. **Auto-update silencieux** : check quotidien invisible ; l'utilisateur ne voit quelque chose que
   s'il y a réellement une mise à jour (interface sobre et rassurante).
3. **Téléchargements minimaux** : check quotidien ≈ quelques Ko ; le gros rootfs ne se retélécharge
   que lors d'un changement de toolchain (rare).
4. **Dossier de revue épuré** : le rédacteur ne voit que le contenu (articles, métadonnées, PDF).
5. **Layout accessible aux non-techniciens** : Word/LibreOffice → Markdown sans rien installer de plus,
   tout packagé dans la distro WSL existante.

### Workflow métier de référence

```
Lectorats (Word/LibreOffice, allers-retours auteurs ↔ rédaction)
        │
        ▼  version finalisée (plus de retouches de contenu)
Passage au layout : création du dossier de revue
        │
        ▼  dépôt des .docx/.odt dans articles-word/   ← (A) conversion auto Pandoc
Édition des .md : métadonnées, styles :::, relecture   ← (B) snippets de styles
        │
        ▼  Ctrl+S
revue.pdf régénéré à la racine du dossier
```

---

## 2. Décisions actées (2026-07-03)

| #   | Décision | Justification / note |
|-----|----------|----------------------|
| D1  | Le pipeline (Makefile, styles, futurs filtres Lua) **sort des dossiers de revue** : centralisé, versionné, livré par `update.ps1`. | Fin des copies divergentes ; corriger un bug = 1 release, pas N dossiers OneDrive. |
| D2  | Le pipeline est hébergé **côté Windows** dans `C:\ProgramData\SZH\toolkit\pipeline\`, consommé par WSL via `/mnt/c`. Le rootfs reste une **toolchain pure** (Debian + Pandoc + WeasyPrint). | MAJ du pipeline = simple copie de fichiers, sans réimport de distro. Le rootfs ne change que pour un bump toolchain. Lecture 9P de 2-3 petits fichiers : négligeable. |
| D3  | `deploy.ps1` est **scindé** : `bootstrap.ps1` (admin, 1× par poste) / `update.ps1` (utilisateur, silencieux, tâche planifiée) / `new-revue.ps1` (scaffold) / `open-revue.ps1` (lanceur). La tâche planifiée exécute un **lanceur stable** (`update-launcher.ps1`) qui télécharge le toolkit puis délègue → les scripts s'auto-mettent à jour. | Seuls le moteur WSL et winget machine exigent l'admin ; tout le reste tourne en utilisateur standard → l'auto-update ne demande plus jamais d'intervention. |
| D4  | Résolution de version via **GitHub `releases/latest` + `manifest.json`** (asset de release). Plus de `$TargetVersion` codé en dur. **Le dépôt passe en public** (action : Robin, prérequis à l'auto-update sans PAT). | `git tag` → toute la flotte suit. |
| D5  | UX de mise à jour : check **silencieux** ; si MAJ → fenêtre **visible**, ton amical, barre de progression sobre. En erreur : message clair, contact **robin.morand@szh.ch**, touche pour ouvrir un e-mail pré-rempli (`mailto:`) avec extrait de trace + chemin du log complet. | Ne pas faire peur aux non-techniciens ; diagnostic facile pour le support. |
| D6  | Rootfs publié en **`.tar.gz`** (accepté nativement par `wsl --import`). | ~50 % de volume en moins, une ligne changée. |
| D7  | **Polices : statu quo pour l'instant, point documenté.** Cible : embarquer **Open Sans** (pas Noto) via `COPY fonts/` + `fc-cache` et retirer `fonts-noto` (métapaquet de plusieurs centaines de Mo — le plus gros poste du tar après Pandoc). | Ajustement ultérieur ; voir §6. |
| D8  | Config éditeur **au maximum au niveau utilisateur** (`settings`, `keybindings`, `tasks`, `snippets` dans `%APPDATA%\VSCodium\User\`), seedée par `update.ps1`. | Vide les dossiers de revue ; config centralement actualisable. `files.exclude` documenté en réserve (§6). |
| D9  | `requirements.txt` **réellement utilisé** par l'image, avec **pins transitifs** (pip-compile : weasyprint + pydyf, tinycss2, fonttools…). | Reproductibilité du rendu ; fichier actuellement mort. |
| D10 | Staging : **rétention N et N-1** (rollback immédiat), purge du reste. `update.ps1 -Version X` permet de forcer/revenir à une version. | Le staging actuel ne se nettoie jamais. |
| D11 | VSIX : pinnés dans un **`vsix.lock`** (id + version + sha256), téléchargés et vérifiés **par la CI**, publiés en assets de release, installés/mis à jour par `update.ps1`. | Même posture anti-GlassWorm (pin + empreinte), mais MAJ de flotte possible. |
| D12 | Import Word : dossier **`articles-word/`** dans la revue ; dépôt par drag & drop OneDrive ; **conversion automatique à l'ouverture** de la revue (Pandoc dans WSL) + tâche manuelle en secours. `.md` existants jamais écrasés ; originaux archivés dans `articles-word/_convertis/` ; images extraites dans `articles/media/`. | Zéro logiciel en plus ; geste connu des utilisateurs. Formats : `.docx`/`.odt` (pas `.doc` ancien). |
| D13 | **Pas de compilation de `.md` isolés** : le modèle « un dossier = une revue » est conservé (ordre des articles, `dossier.yaml`, styles). | Robustesse ; l'ergonomie est réglée par D14. |
| D14 | Points d'entrée : **raccourci « Ouvrir la revue.lnk » dans le dossier** (voyage avec la revue) + **lanceur « Revues SZH » dans le menu Démarrer** listant toutes les revues détectées (scan des dossiers contenant `dossier.yaml`). **Pas** de raccourci bureau par revue. | Menu Démarrer utilisateur (`%APPDATA%\…\Start Menu`) → installable sans admin par `update.ps1`. VSCodium offre en plus sa liste « Récents » (jump list). |
| D15 | Autocomplétion des styles `:::` via **snippets Markdown user-level** + raccourci « Insérer un bloc de style ». Réactiver `editor.quickSuggestions` **uniquement pour le Markdown** (actuellement désactivé globalement). | Liste des styles maintenue avec la maquette, livrée par le même canal. |
| D16 | ~~PDF final à la racine (`revue.pdf`), intermédiaires en tmp WSL~~ — validée, puis **remplacée par D21** le 2026-07-04 (sorties par article dans `out/`). | La leçon associée (ne jamais exclure les PDF du watcher) est reprise en D21. |
| D17 | Contact support affiché et pré-rempli : **robin.morand@szh.ch** (paramètre central, changeable en une ligne). | |
| D18 | **Association `.md` → VSCodium** (2026-07-04) : enregistrement dans « Ouvrir avec » (ProgId posé par les scripts, ciblant à terme le lanceur intelligent T6.2) **+ geste « Toujours » unique par utilisateur**, documenté dans `userdoc.md`. Ni outil tiers (type SetUserFTA), ni forçage du défaut ; XML DISM optionnel au bootstrap pour les nouveaux profils. | Windows scelle le choix par défaut (clé `UserChoice` hashée) : le geste utilisateur est la seule voie 100 % propre sur un profil existant. |
| D19 | **Aperçu PDF : préview intégrée dans l'éditeur** (volet), via tomoki1207.pdf. Analyse du code 1.2.2 (2026-07-04) : l'auto-reload **existe et est soigné** (watcher + reload du webview, scroll/zoom préservés, anti-scintillement) ; la panne historique s'explique par notre ancienne config (`files.watcherExclude: **/out/**` + PDF dans `out/` → événements étouffés), corrigée en P4 (PDF à la racine). Pas de verrou fichier (lecture ponctuelle via webview). « Sumatra dans un onglet » : impossible (les webviews n'hébergent pas de fenêtres natives), écarté. Fork maison (licence MIT, base PDF.js) : **dernier recours** si T6.1 échoue. | Reste T6.1 : test GUI de 2 min — vérifier que le remplacement atomique déclenche « change » (reload) et non « delete » (le code fermerait le volet). |
| D20 | **Profil de compilation par DOSSIER** : champ `profil:` dans `ausgabe.yaml` — `article` (défaut, existant), `book` (WeasyPrint, différé), vide = aucun build (no-op propre), `presentation` (`pandoc -t pptx`, natif, zéro ajout au rootfs). Dispatch dans le Makefile central ; le lanceur Windows reste « bête » (ouvre l'artefact le plus récent). Profil par fichier non retenu (réservé à d'éventuels produits monofichiers). | « Un dossier = un produit = un moteur » prolonge D13 ; toute l'intelligence voyage par le canal toolkit (zéro impact poste/admin/update). |
| D21 | **Sorties PAR ARTICLE** (2026-07-04, remplace D16) : `out/<article>/<article>.pdf` + `<article>.html` — chaque article de la revue est un produit publié séparément. Le HTML est la sortie Pandoc brute pour l'instant (la version « responsive » propre la remplacera au même endroit) et sert aussi d'entrée à WeasyPrint (tmp WSL supprimé, `--embed-resources` suffit). PDF écrit atomiquement (`~$…` ignoré par OneDrive). ⚠ Interdit d'exclure `out/` de `files.watcherExclude` (l'aperçu cesserait de se rafraîchir — leçon T6.1) ; `search.exclude` seulement. | Reflète le modèle de publication réel de la revue (articles individuels). Rebuild incrémental : seuls les articles modifiés sont régénérés. |
| D22 | **`dossier.yaml` → `ausgabe.yaml`** (2026-07-04) : renommé partout (pipeline, lanceur, scaffold, template, réglages, docs). Les revues existantes doivent être renommées (fait pour `2026-01`). Masquage de `*.lnk` dans l'explorateur VSCodium (files.exclude). | « Ausgabe » = le numéro/l'édition — vocabulaire métier bilingue de la SZH. |
| D23 | **Import « à la volée » : non retenu.** L'import des Word tourne à l'ouverture de la revue ET à chaque build (Ctrl+S, ~2 s, validé) — déposer un Word puis enregistrer n'importe quoi suffit. Un vrai watcher du dossier `articles-word/` exigerait une extension ou un daemon supplémentaire (inotify ne traverse pas `/mnt/c`). À reconsidérer seulement si un besoin réel émerge. | Zéro dépendance en plus ; comportement déterministe. |
| D24 | **Aperçu ouvert automatiquement en vue scindée après compilation** (2026-07-04) via la mini-extension maison `szh-csps.szh-apercu` (~50 lignes, zéro dépendance) : à la fin réussie de la tâche de build, ouvre `out/<article-actif>/<article>.pdf` avec `pdf.preview` en `ViewColumn.Beside` + `preserveFocus`, **seulement s'il n'est pas déjà ouvert** (le rechargement continu reste assuré par tomoki). Réglage `szh.apercuAuto`. VSIX construit par la CI, livré via `manifest.json` comme les extensions épinglées. | Aucune voie sans extension : la CLI ne sait pas ouvrir « à côté » (elle recouvrirait le texte), les keybindings n'acceptent pas de chemins dynamiques, le hack « task inputs » vole le focus à chaque autosave sans test « déjà ouvert ». |
| D25 | **UI de mise à jour trilingue FR/DE/EN** (2026-07-04), selon la **langue d'affichage de Windows** (`Get-UICulture`, code à deux lettres) : `fr-CH`/`fr-FR` → FR, `de-CH`/`de-DE` → DE, tout le reste → EN (fallback). Table de textes + fonction `T` dans `szh-common.ps1` ; couvre update.ps1, l'écran d'erreur, l'e-mail support et le lanceur « Revues SZH ». Allemand en **orthographe suisse** (ss, pas de ß) ; unités Mo (FR) / MB (DE, EN). Variable `SZH_LANGUE=fr\|de\|en` pour forcer (test/support). `bootstrap.ps1` et `new-revue.ps1` restent en FR (outils du référent). | Les formats régionaux (fr-CH vs fr-FR) n'affectent pas la détection : seul le préfixe de langue compte. Validé en rendu PS 5.1 dans les trois langues. |
| D26 | **Structure de travail par article** (2026-07-05) : `articles/<slug>/<slug>.md` + `articles/<slug>/media/` (images, `.bib`, matières premières de l'article) — miroir de `out/<slug>/`. Migration automatique des `.md` à plat par la cible `import`. | Chaque article devient une unité autonome et déplaçable ; le `.bib` vit dans `media/` (exigence). |
| D27 | **Convertisseur v2, idiomatique pandoc** (2026-07-05) : filtres **Lua** exécutés dans pandoc — ① suppression des titres vides ; ② titres déduits des paragraphes tout-gras courts (fondé : 1/6 article réel sans styles, « Chanier ») ; ③ listes à puces manuelles (•, -, –) regroupées en vraies listes ; ④ images et tableaux enveloppés en **Figures** avec légende détectée dans le texte voisin (`Figure\|Fig\.\|Abbildung\|Abb\.\|Tableau\|Tabelle\|Table` + n°, avant OU après, deux-points optionnel), numéro manuel retiré (numérotation auto D31), alt-texts « générés par l'IA » purgés ; ⑤ notes de bas de page : natif pandoc (compté au rapport). Commentaires Word ignorés + suivi de modifications accepté (`--track-changes=accept`). | Heuristiques fondées sur l'analyse AST des **6 articles réels** de la revue 2026-01. |
| D28 | **Références via AnyStyle** (2026-07-05) : Ruby + gem `anystyle-cli` ajoutés au **rootfs**. Détection de la liste de références par **contenu + position** (séquence terminale de ≥3 paragraphes « ref-like » : année `\d{4}[a-z]?`/« sous presse »/« en préparation »/« in press », motifs auteurs, URLs ; le nom du titre n'est qu'un signal secondaire) ; entrées multi-paragraphes regroupées (fondé : « Dentz ») ; headers vides au milieu tolérés (fondé : « Piricò »). Sortie : `articles/<slug>/media/<slug>.bib`. Fallback : pas de détection → l'article reste intact + signalé au rapport. | « On part du principe que la liste est juste » ; AnyStyle ne fait que structurer. |
| D29 | **Citations liées citeproc** (2026-07-05) : après création du `.bib`, 2ᵉ passe pandoc avec filtre Lua qui convertit les citations en `[@clé]` : parenthétiques et [crochets], multiples (`;`), locators (`p./pp./S. n`), multi-années (`2011, 2016`), `et`/`&`/`et al.`/`et al`, sigles d'organisations (`[CDIP]`, `[OMS]`…), narratives `Nom (2020)`, insensible aux accents (Fauré≡Faure). Non-résolues → laissées telles quelles + listées au rapport. Rendu : `--citeproc` + **CSL APA vendorisé** (`pipeline/csl/apa.csl`), titre de section de bibliographie selon la langue de l'article. | Tout ce qui précède est du pandoc standard (Cite AST, citeproc) — zéro moteur custom. |
| D30 | **Rapport de conversion HTML trilingue** par article (`articles/<slug>/<slug>-rapport.html`) : converti / à vérifier / conseils Word ; autonome (CSS+JS inline) ; langue par défaut = langue du navigateur (`navigator.language`), boutons FR/DE/EN. Généré par `pipeline/rapport.py` (python3 de l'image) depuis les stats JSON émises par les filtres. | Fallback humain de toutes les heuristiques ; zéro plomberie de langue Windows→WSL. |
| D31 | **Numérotation automatique Figures/Tableaux** par compteurs **CSS** dans la maquette (`figcaption::before`/`caption::before` + `:lang(fr/de/en)` pour Figure/Abbildung/Tableau/Tabelle/Table) — idiomatique WeasyPrint, aucun binaire en plus (pandoc-crossref écarté). Les numéros manuels des légendes sont retirés à l'import ; le rapport signale de vérifier les renvois du texte. | Fonctionne pour le PDF et le HTML autonome (images base64 via `--embed-resources`, déjà en place). |
| D33 | **Tableaux : tout en pipe, fusions supprimées** (2026-07-06, option 1 choisie par Robin ; option « tableaux dans des fichiers séparés » écartée — elle fragmenterait l'article). Le filtre d'import **normalise tout tableau complexe** : fusions dépliées (cellules vides comblées, grille d'occupation), cellules multi-blocs aplaties (blocs joints par `<br>`, préservé au rendu ; `LineBreak` remplacés **récursivement**), largeurs de colonnes retirées (**reconstruction** `pandoc.Table` — l'affectation de colspecs ne prend pas), première ligne promue en en-tête si absent (le pipe l'exige). Writer sans `grid_tables` (sinon la relecture d'un pipe large ré-attribue des largeurs → retour au grid). Simplifications comptées et signalées au rapport (« vérifier la lisibilité »). | Validé : 0 ligne grid et 0 table HTML brute sur les 6 articles réels (7 tableaux, tous pipe éditables au Tab). |
| D36 | **Extension « szh-cockpit »** (2026-07-15) : barre latérale « Revue SZH » (articles, Word en attente, badge) + commande « Importer des Word » (sélecteur → copie → tâche import → notification) + actions Ouvrir le PDF / Compiler. Extension **séparée** de szh-apercu (isolation des risques), zéro dépendance, livrée par le canal CI/vsix.lock existant. Plan détaillé, tranches S1–S5 et critères d'acceptation : `PLAN-COCKPIT.md`, retiré du dépôt le 2026-08-13 → `git show 94c7866^:PLAN-COCKPIT.md`. | Comble l'essentiel de l'écart UX identifié face aux plateformes web (bilan Stylo du 2026-07-15) sans toucher au pipeline ni au modèle de déploiement. |
| D35 | **Import docx simplifié** (2026-07-15, remplace le comportement D27–D30 ; D33 suspendue) : `make import` = pandoc nu (`--track-changes=accept`, `--extract-media`) + filtre unique `szh-tabelle-platzhalter.lua` remplaçant chaque tableau par un placeholder **`{{TABELLE NN}}`** en gras (rappel : insérer le tableau manuellement — gestion des tableaux à re-décider plus tard). Heuristiques, AnyStyle/.bib, citations liées et rapports **débranchés, pas supprimés** (`pipeline/attic/`), réactivables. `.docx` uniquement. Citeproc de la règle html reste conditionnel (ne se déclenche plus faute de .bib). | Chaîne d'import minimale et prévisible pendant la construction de l'UX cockpit ; retour arrière = git. |
| D34 | **Empreinte WSL maîtrisée** (2026-07-15) : `windows/user.wslconfig` seedé par `update.ps1` vers `%UserProfile%\.wslconfig` — `memory=3GB` (défaut Windows : 50 % de la RAM, cache vmmem compris), `processors=2`, **`vmIdleTimeout=300000`** (extinction de la VM 5 min après le dernier build ; défaut 60 s), `autoMemoryReclaim=gradual`, `sparseVhd=true`. Fichier **global** à toutes les distros du poste — acceptable (postes dédiés). Le préchauffage à la connexion reste utile (premier build de la session). | Les builds étant des `wsl.exe` éphémères, la VM s'éteint déjà seule ; on borne surtout la RAM (`vmmem` gonfle avec le cache disque Linux) et on garde 5 min de réactivité pour les rafales de Ctrl+S. |
| D32 | **Édition des tableaux markdown** (2026-07-05) : deux extensions épinglées — `TakumiI.markdowntable` (navigation **Tab** de cellule en cellule, insertion/déplacement de lignes et colonnes, formatage auto ; édition Open VSX de « Markdown Table », takumisoft68 étant absent d'Open VSX) et `csholmq.excel-to-markdown-table` (**coller un tableau depuis Excel/Word** en markdown, Maj+Alt+V — extension disparue d'Open VSX, fonction reprise par le cockpit, D57). Convertisseur : tableaux émis en **pipe** (`-simple_tables-multiline_tables`), grid en repli pour les cellules complexes. **+ `yzhang.markdown-all-in-one` 3.6.2** (validé par Robin) : **Ctrl+B/Ctrl+I** gras/italique, **continuation automatique des listes** à Entrée, formatage de tableaux — les gestes que les rédacteurs venant de Word attendent. | Les extensions de tableaux ne manipulent que le format pipe ; le repli grid préserve les tableaux riches (à simplifier dans Word — conseil au rapport). |
| D37 | **Métadonnées du numéro par formulaire** (2026-07-15) : commande `szh.metadonnees` → webview « Méta-données du numéro » ; le formulaire réécrit `ausgabe.yaml` (`title`, `revue`, `volume`, `numero`, `date`, `lang`), les autres clés sont **préservées**. | Le rédacteur ne voit jamais de YAML. Première webview du dépôt (volontairement dérisquée en premier). |
| D38 | **Créer / ouvrir une revue restent dans le lanceur PowerShell**, pas dans l'extension : `open-revue.ps1` gagne une action « ＋ Nouvelle revue… » qui appelle `new-revue.ps1`. | La vue cockpit n'existe **que dans une revue déjà ouverte** (`szh.estRevue`) : « ouvrir une autre revue » depuis le cockpit serait un chicken-and-egg. Source unique, zéro duplication. |
| D39 | **Le `.docx` est supprimé après conversion réussie** (cible `import` : `rm -f` au lieu du `mv` vers `_convertis/`) ; un docx « déjà converti (ignoré) » **reste**, signalé ⚠ (ce peut être une nouvelle version à renommer). | Plus de doublons fantômes dans le dossier de revue ; le `.md` est déjà la copie de travail, retour arrière = git. |
| D40 | **Suppression d'article depuis l'arborescence** : bouton corbeille → **confirmation modale** → efface `articles/<slug>/` et `out/<slug>/`. | Première action destructive du cockpit : garde-fou modal obligatoire, jamais silencieux. |
| D41 | **Assets dans l'arborescence** : l'article est dépliable, ses enfants sont les images de `articles/<slug>/media/` (poids + dimensions en légende), clic = aperçu natif, « Remplacer » écrase le fichier **en conservant son nom**. Dimensions lues des en-têtes PNG/GIF/SVG, JPEG au mieux (marqueurs SOF). | Gestion des images sans quitter l'éditeur ni ouvrir l'Explorateur. |
| D42 | **WSL maintenue en vie par l'extension** : à l'ouverture d'une revue, un processus dormant (`wsl -d SZH-Publishing -- sh -c 'exec sleep infinity'`) empêche l'extinction de la VM ; tué au `deactivate` ou en quittant la revue. | Réactivité du premier build sans tâche planifiée supplémentaire ; **ne touche pas** au `.wslconfig` (D34). |
| D43 | **Titre de vue dynamique** lu dans `ausgabe.yaml` : `{Z\|R}{AAAA}-{numero} \| {title}` (`Z` si `lang: de`, sinon `R` ; `AAAA` extraite de `date`), rafraîchi à la volée, repli gracieux si une clé manque. | Le rédacteur voit immédiatement sur quel numéro il travaille. Hors revue, le libellé `package.json` (« Revue SZH ») reste. |
| D44 | **« Tout exporter » = rebuild FORCÉ** de tous les articles : cible `tout-exporter` (= `clean` puis `all`), tâche dédiée, bouton en tête de vue. | Distinct du build incrémental de Ctrl+S : sert quand la maquette (et non le contenu) a changé. |
| D45 | **Un seul niveau de médias** : `articles/<slug>/media/`. Normalisation dans `import-docx.sh` (nouveaux imports) **et** migration idempotente dans la cible `import` (fusion de `media/media/`, réécriture des liens, suppression du dossier en trop). | Corrige le `media/media/` produit par `--extract-media` sur les revues existantes. |
| D46 | **Clic sur un article = tout** : ouvre le `.md` (colonne 1), **compile s'il est obsolète** (`.md` plus récent que la sortie, ou sortie absente), affiche l'aperçu (colonne 2), **ferme celui de l'article précédent**. Les boutons inline « Ouvrir le PDF » et « Compiler » sont supprimés. | Un geste au lieu de trois ; `szh-apercu` reste chargé du rafraîchissement après Ctrl+S. |
| D47 | **Tableaux en fichiers HTML** (abandonne le placeholder `{{TABELLE NN}}` de D35 comme mécanisme final) : 1 fichier par tableau dans `articles/<slug>/tables/`, référence `::: {.szh-tabelle src="tables/table-NN.html"}` dans le `.md`, **ré-injectée à la compilation** par `szh-tabelle-inclure.lua` ; tableaux listés comme assets (ouvrir / remplacer). Éditeur WYSIWYG : hors lot. | Le `.md` reste lisible et éditable ; la richesse du tableau (fusions) survit hors du markdown. Extraction elle-même : voir D50. |
| D48 | ~~Métadonnées d'article dans le frontmatter YAML du `.md`~~ — **remplacée par D49**. | Le frontmatter obligeait à préserver le corps de l'article à chaque enregistrement du formulaire (risque de perte de texte). |
| D49 | **Métadonnées d'article dans `articles/<slug>/<slug>.meta.yaml`** (masqué par `files.exclude`), **édité uniquement par le formulaire** ; le `.md` ne contient que du texte ; lu par pandoc via `--metadata-file` en plus d'`ausgabe.yaml` (l'article surcharge le numéro). | Fichier « form-owned », régénéré à chaque enregistrement (clés inconnues préservées par prudence) : plus aucun corps d'article à préserver. |
| D50 | **Extraction des tableaux par `pipeline/docx-tables.py`** (stdlib `zipfile` + `xml`, zéro dépendance) : lit `word/document.xml` et rend chaque `<w:tbl>` en HTML **fusions préservées** (`w:gridSpan` → `colspan`, `w:vMerge` → `rowspan`) ; le placement de la référence dans le `.md` reste fait par un filtre Lua (ordre du document). | Corrige l'aplatissement des cellules par pandoc constaté en D33, sans binaire supplémentaire. |
| D51 | **Schéma unifié de `<slug>.meta.yaml`** : `type` (jeton canonique ∈ varia, documentation, article, interview, tribune-libre, editorial — **libellé traduit** selon `lang`), `doi`, `title`/`subtitle`/`resume` en maps langue→texte, `keywords` en map langue→liste, `author[]` (`prenom`, `nom`, `fonction`, `affiliation`, `orcid`). Langues : **fr + de** par défaut, **it** activable par article, **pas d'en**. | Même posture que les blocs de style : jeton canonique dans le fichier, libellé traduit à l'écran. `resume` est une métadonnée, **jamais** un bloc `:::` (D55). |
| D52 | **Menu de réglages « SZH »** (webview) écrivant au niveau **utilisateur** via `ConfigurationTarget.Global` : thème Système/Clair/Sombre (uniquement *Default Light/Dark Modern*), taille de police de l'interface (`window.zoomLevel`), taille de police des `.md` (`[markdown].editor.fontSize`, l'affichage seulement), langue FR/DE des chaînes du cockpit. | Jamais d'édition manuelle de `settings.json`, jamais d'effet sur un YAML. La langue **native** de VSCodium exige en plus le pack DE (`vsix.lock`) + `locale` dans `argv.json` + redémarrage. |
| D53 | **Aperçu commutable HTML↔PDF** (`szh.apercuMode`, **défaut `html`**), bascule globale (barre d'état + bouton + bandeau de l'aperçu) : en HTML, la colonne 2 affiche `out/<slug>/<slug>.html` dans une **webview maison** (survol = surlignage, clic = `revealRange` sur la ligne source) ; en PDF, tomoki, sans clic. La position source est portée par pandoc et **ignorée par WeasyPrint** → **le PDF reste inchangé**. | Navigation aperçu → source sans quitter WeasyPrint (aucun Chromium ; cf. comparatif WeasyPrint vs Paged.js). |
| D54 | **`szh-apercu` conscient du mode** : conservé, modifié a minima — il n'ouvre/rafraîchit le PDF **qu'en mode `pdf`** (lecture du réglage partagé `szh.apercuMode`) et ne fait rien en mode `html`. | La colonne 2 n'a qu'un seul propriétaire à la fois ; une garde, pas une refonte. |
| D55 | **Menu « Mise en forme » (clic droit) + raccourcis** : gras / italique / souligné, H1–H3, blocs **important** (titre paramétrable `data-titre`, rendu par CSS), **highlight**, **question**, **citation** (blockquote natif `>`), insérer une figure, insérer un tableau. Commandes maison `szh.fmt.*`, localisées FR/DE (`package.nls`), raccourcis dans `keybindings.json`. **Les anciens blocs sont supprimés** (chapo, encadre, exergue, note, avertissement). | Les gestes attendus par un rédacteur venant de Word, avec la classe canonique insérée (`::: {.important}`…) et le libellé traduit à l'écran. |
| D56 | **Couleur annuelle du numéro** : champ `couleur` (hex) dans `ausgabe.yaml`, choisi par **pastilles** dans le formulaire du numéro — Rouge `#D31932`, Capucine `#EB5E51`, Moutarde `#C7CF1C`, Poireau `#51A66D`, Bleu acier `#5F9FBC`, Mountbatten `#A98899`. | Stockage + choix visuel ; consommation par la maquette (`pipeline/styles/couleurs.css`, `pipeline/accent-css.py`). |

| D57 | **Éditeur de tableau WYSIWYG maison** : ~~bouton « Éditer » sur l'asset tableau~~ → **le clic sur le tableau** (D84) ouvre la webview qui rend `table-NN.html` en **grille éditable** et le réécrit (écriture atomique). Style encodé en **classes + attributs `data-*`** sur `<table>`/`<th>`/`<tr>` (HTML lisible, round-trip sûr), rendu par `print.css`. Accent = **gris neutre** OU **couleur annuelle** (`--szh-accent`, exposée à la compilation). | Zéro dépendance externe ; le fichier reste un `<table>` autonome, réparable à la main en dernier recours. |
| D58 | **Largeurs et hauteurs 100 % automatiques** : `table-layout: auto` + `width: 100%`, cellules qui reviennent à la ligne (`overflow-wrap: anywhere`, `hyphens: auto` selon la langue). Aucune largeur fixe n'est émise ni stockée ; le redimensionnement manuel de colonne est **abandonné** au profit de l'auto-distribution. | Prolonge la leçon de D33 (les largeurs de colonnes font resurgir le grid) ; la hauteur mini dans l'éditeur est cosmétique et n'affecte pas le PDF. |
| D59 | **Alignement du texte** par cellule et par colonne : `data-align="left\|center\|right"` sur la cellule (défaut `left`), applicable en bloc à une colonne via la sélection ; rendu par `print.css` et reflété dans l'aperçu de l'éditeur. | |
| D60 | **Historique d'édition** (annuler / rétablir) dans la webview : pile d'états du **modèle** sérialisable, bornée (~100 pas). Le fichier n'est touché qu'à l'enregistrement. | |
| D61 | **Markup de tableau accessible (WCAG H43)** : tableau **simple** (≤ 1 ligne ET ≤ 1 colonne d'en-tête) → `scope="col"/"row"` ; tableau **complexe** (2 lignes OU 2 colonnes d'en-tête, ou en-tête fusionné) → `<thead>`/`<tbody>` + `id` sur chaque en-tête + `headers="…"` sur chaque cellule de données + `scope="colgroup"/"rowgroup"` sur un en-tête qui fusionne un groupe. **Dérivé du modèle**, régénéré à la sérialisation. | L'accessibilité ne se saisit pas à la main : elle se déduit de la structure, donc elle survit à toute édition (round-trip stable). |
| D62 | **PDF balisé (PDF/UA-1)** : WeasyPrint 69 avec `--pdf-variant pdf/ua-1` ; `lang` du `<html>` déjà fourni par les métadonnées. Ne doit **jamais** casser le build (repli si le mode strict échoue). | Sans PDF balisé, le markup accessible de D61 ne servirait qu'au HTML. |
| D63 | **Heuristique de titres à l'import** : quand le `.docx` n'utilise pas les styles Heading, déduire les titres de la mise en forme — paragraphe isolé sur sa ligne, court, sans style de titre, dont les runs sont **gras et/ou d'une police plus grande** que le corps → `#`/`##` selon la taille. **Conservateur** (les faux positifs coûtent plus que les oublis). Analyse sur `word/document.xml`, comme `docx-tables.py`. | Prolonge D27② : pandoc perd la taille de police, donc l'AST ne suffisait pas. |
| D64 | **Styles au NIVEAU tableau** (attributs `data-*` sur `<table>`), en remplacement du remplissage par cellule ; attributs absents ⇒ tableau nu. | Rétrocompatible avec les tableaux déjà écrits. |
| D65 | **Ligne de total = dernière ligne**, détectée automatiquement, stylée seulement si un style de total est actif. | |
| D66 | **Remplissage structuré uniquement** : le remplissage **par cellule** (fond / négatif / couleur) est retiré de l'éditeur ; le formatage **texte** par cellule reste (gras, italique, souligné, alignement). | Évite les tableaux bariolés au cas par cas — et avec eux les contrastes non maîtrisés. |
| D67 | **Mappage des remplissages** (contrastes garantis par `couleurs.css`, tous ≥ 4,5:1) : **négatif** = fond `--szh-accent-fonce` + texte blanc ; **couleur annuelle** = fond `--szh-accent-clair` + texte noir ; **gris** = gris clair neutre + texte noir (indépendant de la couleur annuelle) ; **aucun** = pas de remplissage. | |
| D68 | **(AX1)** Markup accessible dérivé du modèle dans `serialiserTable` — même règle que D61, fusionnée avec la refonte des styles de tableau (mêmes fichiers). | |
| D69 | **Géométrie & pleine-marge** : `@page { size: A4; margin: 0 }` pour la **couverture** (`:first`) → le hero déborde **jusqu'au bord** ; pages courantes avec marges haute et basse réservées à l'en-tête et au pied. | Exigence de maquette : la bande ne doit plus s'arrêter à la marge. |
| D70 | **Hero bleu nuit PERMANENT** : fond `#252B46` (`--c-nuit`) en toutes circonstances. Tout le reste du « bleu acier » de la maquette devient la **couleur annuelle** (filet sous le hero, bordure du résumé, fond des mots-clés, encadrés, citation / hervorhebung, accents de tableau). Marqueurs de liste et numéros de titre restent **noirs**. | Fidèle à la maquette imprimée : un seul élément est fixe, tout le reste suit l'année. |
| D71 | **Étiquette de dossier selon le type d'article** : types **liés au dossier** (`article`, `editorial`, `interview`) → afficher le **titre du dossier thématique** (métadonnée du numéro) ; types **hors dossier** (`varia`, `tribune-libre`, `documentation`) → afficher le **libellé du type**, localisé. Même logique pour l'en-tête courant des pages intérieures. Libellés de/fr/it dans `szh-maquette.lua` **et** `LIBELLES_TYPES` de l'extension. | ⚠ Les libellés DE et IT sont un **premier jet** : à confronter aux noms de rubriques réellement imprimés (voir `TODORMO.md`). Les deux tables doivent rester identiques. |
| D72 | **Couleur annuelle unifiée** : `accent-css.py` émet **un** bloc de jetons canonique, consommé à la fois par les tableaux (`--szh-accent*`) et par la maquette (`--c-annual*`, alias) ; repli gris si le numéro n'a pas de couleur. | Une seule définition de la couleur : impossible que tableau et maquette divergent. |
| D73 | **Polices empaquetées** : `pipeline/fonts/` + `@font-face` (Open Sans, Source Serif 4, IBM Plex Mono — licences OFL vendorisées) ; `font-stretch: 87.5%` avec repli sur la fonte statique la plus proche si WeasyPrint ne le supporte pas. | La maquette ne dépend plus des polices **installées dans le rootfs**, et les polices voyagent par le toolkit (release de quelques Mo). D7 reste ouvert pour la seule question de la **taille** du rootfs (retirer `fonts-noto`). |
| D74 | **Revue = choix fermé (radio)** qui fixe nom + ISSN + langue par défaut : `Schweizerische Zeitschrift für Heilpädagogik` → **ISSN 2813-4907**, défaut **de** ; `Revue suisse de pédagogie spécialisée` → **ISSN 2813-4915**, défaut **fr**. Un seul champ canonique (`revue: zeitschrift\|revue`) dans `ausgabe.yaml`, dont nom, ISSN et langue sont **dérivés**. Cette langue par défaut pilote (a) compilation / couverture / césure et libellés localisés (D71), (b) **l'ordre des champs traductibles** dans les formulaires (langue par défaut en premier). | Plus d'ISSN saisi à la main, plus de nom de revue en texte libre (assouplit D37) : deux produits, deux jeux de valeurs dérivées. |
| D75 | **`csholmq.excel-to-markdown-table` retiré d'Open VSX** (constaté le 2026-08-13 : l'extension entière a disparu du registre, pas seulement la version épinglée — la CI échouait en 404 sur tout nouveau tag). Décision : **dépin** dans `vsix.lock` et **reprise de la fonction par le cockpit** — commande `szh.fmt.collerTableau` (Maj+Alt+V) qui lit le presse-papiers, le convertit de TSV en tableau pipe (première ligne en en-tête, `\|` échappés, lignes courtes complétées) et l'insère. Aucune ré-implémentation côté tableaux riches : les tableaux issus de Word restent sur le chemin D47/D50 (fichiers HTML + éditeur du cockpit). | Le pin protégeait d'une MAJ malveillante, pas d'une disparition : le repli est de **rapatrier la fonction** (7 lignes utiles, testées) plutôt que de chercher une source alternative non vérifiable. Une extension tierce en moins à auditer. |

| D76 | **Contrastes en APCA** (2026-08-13, remplace le calcul WCAG 2 de D67) : module `pipeline/apca.py` — APCA-W3 0.1.9 + conversions OKLab, stdlib, auto-vérifié à l'import sur les deux ancres connues (noir sur blanc +106,0 ; blanc sur noir −107,9). Vérificateur ré-exécutable `test/apca-check.py` (157 paires réelles, sortie non nulle si une échoue) et planche générée `docs/palette.html` (`test/palette-html.py`). | WCAG 2 se trompe sur les teintes vives : il refusait des jaunes lisibles et acceptait des gris sombres illisibles. Trois corrections concrètes trouvées par la mesure : le texte annuel **moutarde** était sous le seuil (Lc 68,9 → 78,0), son filet fin avait été « corrigé » en quasi-noir, ce qui tuait la couleur (→ `#ACB201`), et le filet de tableau moutarde sur fond zébré était à Lc 22,4 (→ 37,4, via `--c-annual-ui`). |
| D79 | **Palette en grille à CLARTÉ FIXE de 11 crans** (2026-08-13, remplace l'échelle de 7 crans ancrée sur le contraste, première forme de D76) : les crans `50 100 200 300 400 500 600 700 800 900 950` visent des clartés OKLab **imposées** (0,97 → 0,31, progression régulière), identiques pour les six teintes — un même numéro veut donc dire la même clarté partout (dispersion mesurée : **0,002**, du bruit d'arrondi 8 bits). Le contraste devient une **conséquence**, annoncée cran par cran comme un `Lc` **garanti** (le pire des six teintes) : texte courant en noir sur 50/100/200 (≥ 79,6), en blanc sur 700/800/900/950 (≥ 81,3) ; gros titres seulement sur 300, 500, 600 ; **aucun texte** sur 400. ~~La **couleur de charte sort de la numérotation** — jeton `--c-<nom>-marque`, hex intact — parce qu'elle ne tombe pas sur un cran~~ → **remplacé par D80** le même jour : la charte occupe désormais un cran. Alias inchangés de nom : `-normal` → `-marque`, `-clair` → `-200`, `-fonce` → `-700`. | La convention numérique promettait une comparabilité qu'elle n'assurait pas : la marque était étiquetée « 500 » pour les six couleurs alors que sa clarté réelle allait de 0,555 (rouge) à 0,821 (moutarde) — dispersion **0,266**, dix fois celle des crans calculés. Deux artefacts en découlaient : `--c-rouge-500` était identique à `-700`, et `--c-moutarde-500` à 0,009 de son propre `-200`. Le cran 400 mort n'est pas un défaut : c'est le croisement où le noir est déjà tombé sous 60 et le blanc pas encore monté, présent dans toute échelle saturée — il est donc étiqueté décoratif, pas caché. Quatre des six chartes vivant près du cran 500, l'ancienne convention *semblait* juste. |
| D77 | **Le lanceur `.md` est BÊTE ; l'aperçu est ouvert par le cockpit** (2026-08-13, précise T6.2 de D18) : `windows/open-md.ps1` remonte jusqu'à `ausgabe.yaml`, ouvre VSCodium sur le **dossier + le fichier**, et s'arrête là — aucun `make`, aucun appel WSL. C'est le cockpit qui, au démarrage, détecte que l'éditeur actif est un `articles/<slug>/<slug>.md` et enchaîne le chemin unique de D46 (compiler si obsolète, puis aperçu en colonne 2). Association posée en HKCU par `update.ps1` (ProgId `SZH.Markdown` + `.md\OpenWithProgids` en REG_NONE, `FriendlyAppName` = « Revue SZH ») ; **jamais** de forçage de `UserChoice` (D18). | Compiler depuis le lanceur, c'était lancer un `make` en concurrence de `triggerTaskOnSave` et de la tâche `folderOpen` sur le même `out/` — or le Makefile n'a aucun verrou ; et ouvrir un PDF hors de l'éditeur le verrouille, faisant échouer le remplacement atomique (D21). Un seul endroit compile, un seul possède la colonne 2 (D54). Prolonge D20 : l'intelligence dans le toolkit, les scripts OS bêtes. |
| D78 | **Arbitrages du dispatch `profil:`** (2026-08-13, met D20 en œuvre — T6.4) : lecture par `sed` comme `lang:`, avec détection **séparée** de la présence de la clé (`grep -c '^profil:'`) car « clé absente » et « clé vide » se lisent tous deux « vide ». Routes : absente ou `article` → comportement historique **à l'octet** ; **vide** → aucun build, message doux, **sortie 0** (c'est un choix, pas une panne) ; `presentation` → un `.pptx` par article **plus les aperçus HTML** ; `book` et valeur inconnue → message clair et **sortie non nulle**. Le cockpit lit le même champ et **force l'aperçu HTML** dès que le profil n'est pas `article`. | Le code de sortie est une décision d'UX : tout code non nul remonte en erreur rouge à chaque Ctrl+S. On n'échoue donc que si la configuration ne **peut pas** être honorée. Les aperçus HTML sont régénérés par la route `presentation` précisément pour que la colonne 2 ne tombe pas sur « aperçu indisponible » alors que la compilation a réussi. Limite mesurée : les tableaux de D47 (HTML brut réinjecté) **disparaissent** du `.pptx`. |

| D80 | **La couleur de charte OCCUPE un cran de la grille** (2026-08-13, remplace la partie « hors grille » de D79) : elle écrase le cran dont le `Lc` calculé est le plus proche du sien, **dans la même polarité de texte** — rouge → **700**, capucine → **500** (le cran calculé valait déjà `#EB5E51`), moutarde → **300**, poireau/bleu acier/mountbatten → **500**. Le cran est **calculé** par `apca.cran_de_charte()`, jamais codé en dur : un changement de charte suivra tout seul. `--c-<nom>-marque` devient un **alias** vers ce cran, donc toujours un seul hex par couleur. Deux garanties baissent en conséquence, sans casser leur contrat : cran 500 → **60,9** (fixé par la charte bleu acier, seuil gros titres 60) et cran 700 → **79,7** (charte rouge, seuil texte courant 75). | Un jeton hors grille à côté d'un cran de valeur presque identique, c'était deux noms pour la même intention et une case en trop sur la planche. Prix mesuré et assumé : le cran concerné adopte la clarté de la charte, donc la dispersion y monte — 0,012 (cran 300), 0,014 (cran 500) et **0,035 (cran 700, rouge)** contre 0,002 ailleurs. Pour le rouge c'est irréductible : sa charte tombe entre deux crans (0,035 au 700, 0,036 au 600). Effet en production : `-fonce` visant le cran 700, le fond « négatif » des tableaux d'un numéro rouge redevient **le** rouge SZH `#D31932` au lieu d'un rouge assombri. |

| D81 | **Collage de tableau = un fichier HTML, pas du pipe** (2026-08-13, refond la partie « collage » de D75) : `Ctrl+Alt+V` (et non plus Maj+Alt+V) crée `articles/<slug>/tables/table-NN.html` au premier numéro libre et insère `::: {.szh-tabelle src="…"}` au curseur — donc exactement le mécanisme D47 des tableaux importés de Word, avec l'éditeur du cockpit disponible dessus. **Le presse-papiers est lu en HTML**, pas en texte : `vscode.env.clipboard.readText()` ne rend que du TSV, où les cellules fusionnées **n'existent pas**. La variante HTML (celle qu'Excel et Word déposent, et qui porte `colspan`/`rowspan`) n'est pas accessible à l'API VS Code, donc lecture par un `powershell` court qui appelle `[Windows.Forms.Clipboard]::GetDataObject()` — et **pas** `Get-Clipboard -TextFormatType Html`, qui rend les octets UTF-8 d'Excel déjà décodés en page ANSI (« Élèves — Zürich » revient « Ã‰lÃ¨ves â€” ZÃ¼rich ») : on ré-encode donc dans cette page puis on décode en UTF-8 **strict**, ce qui laisse intacte une chaîne qui n'avait pas été mal décodée. En-tête CF_HTML retirée, HTML bureautique nettoyé (`mso-*`, `<o:p>`, `<font>`, rangée fantôme d'Excel), puis `analyserTable` → `serialiserTable` du modèle existant. Repli TSV si aucune variante HTML. | Robin a testé le collage en pipe : les fusions étaient perdues, et c'est structurel — le format pipe ne sait pas les exprimer (leçon déjà tirée en D33). Passer par le chemin D47 rend le collage identique à l'import, éditeur compris. Limite mesurée : **Excel** met son gras et ses en-têtes dans des classes CSS, jamais dans `<b>` — un tableau collé depuis Excel arrive donc sans gras ni ligne d'en-tête (à régler d'un clic dans l'éditeur), alors que Word émet de vrais `<b>`/`<i>` et conserve tout. |
| D82 | **L'aperçu HTML surligne le BLOC, pas l'inline** (2026-08-13, précise D53) : le survol et le clic remontent au premier élément de bloc portant une position source (`p`, titres, `li`, `blockquote`, `figure`, `table`…). Le mot sous le curseur reste transmis à l'éditeur pour y placer le curseur (A2), ce qui est une précision de position et non une réduction de la sélection. | Pandoc pose des positions source aussi sur l'**inline** : viser l'élément le plus interne surlignait « Morand » au milieu de « je suis Robin Morand » au lieu du paragraphe. Ce qu'on désigne dans un aperçu, c'est un passage à retrouver dans le texte — l'unité utile est le bloc. |

| D83 | **Invariant de grille : aucune fusion d'en-tête ne dépasse dans le corps** (2026-08-13) : le compte de rangées d'en-tête est réduit — jusqu'à 0 s'il faut — tant qu'une cellule de l'en-tête porte un `rowspan` qui franchirait la frontière `<thead>`/`<tbody>`. Posé à **un seul endroit par producteur** : `normaliserModele()` côté extension (passage obligé de l'analyse d'un fichier, du collage et des opérations de l'éditeur) et la décision de `lignes_entete` dans `pipeline/docx-tables.py` (import Word). | Un `rowspan` **ne franchit pas** la frontière de section : navigateurs et WeasyPrint le bornent. Un en-tête d'une rangée sur un tableau dont la rangée 0 fusionne deux rangées — la forme même d'un en-tête Word à deux niveaux dont seule la première rangée est en gras — décale donc la rangée suivante d'une colonne. Mesuré au rendu sur un collage réel, puis retrouvé **à l'identique** dans l'éditeur de tableau et dans l'import Word, où il produisait des PDF faux sans que rien ne proteste. Arbitrage : un tableau **sans** `<thead>` reste juste, un tableau à `<thead>` tronqué est faux — on préfère perdre la sémantique d'en-tête, que l'éditeur repose d'un clic, plutôt que la grille. |

| D84 | **Le clic sur un tableau ouvre l'éditeur, pas le HTML brut** (2026-08-14, précise D57) : dans la barre latérale, cliquer un `table-NN.html` ouvre directement l'éditeur de tableau ; le bouton « Éditer » du survol est **retiré** du menu, devenu redondant (la commande `szh.editerTable` reste, c'est elle que le clic appelle). « Remplacer » reste. Le HTML brut demeure accessible par l'Explorateur pour qui le veut. | Personne dans l'équipe de rédaction n'a à lire un `<td colspan="2">` pour corriger une cellule : le clic doit mener au geste utile, pas au format de stockage. Deux commandes pour une seule intention, c'était aussi un bouton de plus à survoler. |

| D85 | **Éditeur de tableau : place à la grille, et des préréglages** (2026-08-14) : à l'ouverture de l'éditeur, l'aperçu de l'**article** (colonne 2) se ferme — deux boutons de la barre le rouvrent (« Voir le tableau dans l'aperçu », qui pousse en plus le surlignage G3 sur la ligne de la référence) et le referment. Le panneau de réglages passe en **deux colonnes** : styles des en-têtes à droite, préréglages et styles du tableau à gauche. Le paragraphe d'aide de l'en-tête est **supprimé** (les gestes vivent dans `userdoc.md`). Huit **préréglages** en boutons radio appliquent d'un coup tout l'habillage — un seul pas d'annulation — sans jamais toucher aux comptes d'en-tête, qui décrivent la structure et non l'apparence. | La grille et deux colonnes de réglages ne tiennent pas à côté d'un aperçu d'article ; et empilés, les réglages dépassaient la hauteur utile, le zébrage tombant hors écran. Les huit préréglages sont des **propositions à comparer** : leur liste et leur ordre viennent du modèle (`PRESETS_ORDRE`), donc en réduire le nombre se fait à un seul endroit, plus les libellés traduits. |

| D86 | **Saut de page volontaire** (2026-08-14) : entrée « Insérer un saut de page » dans la palette SZH (`Ctrl+Alt+Entrée`), qui écrit un bloc vide `::: {.szh-saut}` — même forme que les autres blocs de la maquette (D55) et que la référence de tableau (D47). Le sens vient de `print.css` : `break-after: page`, plus `break-before: avoid` sur le marqueur lui-même. **Aucune condition de média** n'est posée. | Il n'existe pas de balise pandoc universelle pour cela : `\newpage` ne vaut que pour LaTeX, et notre PDF sort de WeasyPrint. Confier le sens au CSS a un effet secondaire heureux : un saut de page n'existe que dans un média **paginé**, donc la même feuille sert au HTML autonome et à l'aperçu, où la règle est simplement inerte — le marqueur n'y produit rien, sans qu'on ait à l'exclure. Vérifié par un build réel : **1 page sans le marqueur, 2 avec**, et un texte visible identique en HTML. Le `break-before: avoid` évite qu'une coupure tombe juste avant le marqueur, ce qui transformerait le saut demandé en page blanche. |

> **Provenance de D37–D74** : décisions prises dans les plans de lot retirés du dépôt le 2026-08-13
> (commit `94c7866`) après réalisation — `PLAN-GESTION.md` (D37–D41), `PLAN-FONCTIONS.md` (D42–D48),
> `PLAN-CORRECTIONS.md` (D49–D56), `PLAN-TABLEAU.md` (D57), `PLAN-EDITEUR-V2.md` (D58–D60),
> `PLAN-ACCESSIBILITE-IMPORT.md` (D61–D63), `PLAN-TABLEAU-STYLES.md` (D64–D68), `PLAN-MAQUETTE.md`
> (D69–D74). Les plans détaillés (tranches G1–G5, N1–N7, M1–M7, T1–T…, AX1–AX5, critères
> d'acceptation) restent consultables : `git show 94c7866^:PLAN-MAQUETTE.md`.
>
> D66 est la seule décision de la série qui n'est **citée nulle part dans le code** — c'est normal :
> elle consiste à *retirer* une fonction (le remplissage par cellule), ce qui ne laisse pas de trace.

---

## 3. Architecture cible

> ⚠ Les arborescences ci-dessous sont celles **décidées le 2026-07-03** ; elles ont depuis évolué
> (D21 sorties par article, D22 `ausgabe.yaml`, D26 `articles/<slug>/`, D49 `.meta.yaml`, extensions
> maison). L'état **courant** du dépôt et du poste est décrit dans
> [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — source de vérité ; ce §3 reste ici comme trace de
> la décision initiale.

### 3.1 Dépôt

```
szh-publishing-toolchain/
├── .github/workflows/release.yml     # CI : toolkit.zip toujours ; rootfs seulement si image/ a changé
├── image/                            # rootfs pur — change rarement
│   ├── Containerfile                 # Debian + Pandoc + WeasyPrint (venv, pins transitifs)
│   ├── requirements.txt              # généré par pip-compile (D9)
│   ├── wsl.conf
│   └── build-rootfs.sh               # sortie .tar.gz (D6)
├── pipeline/                         # → C:\ProgramData\SZH\toolkit\pipeline\
│   ├── Makefile                      # cibles : pdf, import, clean
│   ├── styles/print.css
│   └── filters/                      # (futur : filtres Lua)
├── windows/                          # → C:\ProgramData\SZH\toolkit\windows\
│   ├── bootstrap.ps1                 # ADMIN, 1× par poste
│   ├── update-launcher.ps1           # stable, appelé par la tâche planifiée — ne change jamais
│   ├── update.ps1                    # le vrai update (auto-mis à jour via toolkit)
│   ├── new-revue.ps1
│   ├── open-revue.ps1                # lanceur « toutes les revues »
│   └── vsix.lock                     # id + version + sha256 des extensions (D11)
├── vscodium-user/                    # → %APPDATA%\VSCodium\User\  (seedé par update.ps1)
│   ├── settings.json
│   ├── keybindings.json
│   ├── tasks.json                    # tâches USER-LEVEL (V1)
│   └── snippets/markdown.json        # blocs de style ::: (D15)
├── revue-template/                   # → modèle copié par new-revue.ps1
│   ├── BIENVENUE.md
│   ├── dossier.yaml
│   ├── articles/01-exemple.md
│   └── articles-word/                # dossier de dépôt Word (D12)
└── PLANIFICATION.md                  # ce fichier
```

### 3.2 Assets d'une release (tag `vX`)

| Asset | Taille | Publié | Contenu |
|---|---|---|---|
| `manifest.json` | ~1 Ko | toujours | versions + URLs + sha256 de tout le reste ; pointe vers le rootfs **applicable** (possiblement d'une release antérieure) |
| `toolkit-X.zip` | quelques Ko–Mo | toujours | `pipeline/` + `vscodium-user/` + `revue-template/` + `windows/` |
| `vsix/*.vsix` | Mo | si `vsix.lock` a changé | extensions vérifiées par la CI |
| `szh-publishing-rootfs-Y.tar.gz` (+ `.sha256`) | centaines de Mo | **seulement si `image/` a changé** | la toolchain |

→ Une retouche de style = release de quelques Ko. Un bump Pandoc = release avec rootfs. C'est le
découpage gros-immuable / petit-mutable (95 % du bénéfice des diffs binaires pour 5 % de la complexité ;
zsync/casync écartés, disproportionnés ici).

### 3.3 Poste (après bootstrap)

```
C:\ProgramData\SZH\
├── toolkit\            # contenu de toolkit-X.zip (pipeline, windows, vscodium-user, template)
├── staging\            # téléchargements ; rétention N et N-1 (D10)
├── logs\               # update-YYYYMMDD.log
├── state.json          # versions installées {toolkit, rootfs, vsix} — le check quotidien ne boote PAS WSL
└── WSL\SZH-Publishing\ # ext4.vhdx

Tâches planifiées (créées par bootstrap.ps1) :
• « SZH – Mise à jour »   : session UTILISATEUR, à la connexion + 1×/jour, fenêtre cachée ;
                            devient visible seulement si une MAJ est appliquée (D5).
                            (WSL est enregistré par utilisateur → jamais en SYSTEM.)
• « SZH – Préchauffage »  : à la connexion, `wsl -d SZH-Publishing --exec /bin/true`
                            (remplace la tâche folderOpen actuelle).
• « SZH – Apps » (option) : SYSTEM, hebdo, winget upgrade VSCodium/SumatraPDF — voir risque V2.

Menu Démarrer utilisateur : « Revues SZH.lnk » → open-revue.ps1 (D14).
ACL : bootstrap.ps1 donne Modify aux Utilisateurs sur C:\ProgramData\SZH (update sans admin).
```

### 3.4 Dossier de revue (ce que voit le rédacteur)

```
OneDrive\Revues\2026-01\
├── Ouvrir la revue.lnk       ← double-clic = tout démarre
├── BIENVENUE.md
├── ausgabe.yaml              ← métadonnées du numéro (D22 ; ex-dossier.yaml)
├── articles-word\            ← déposer ici les Word finalisés (supprimés après conversion, D39)
├── articles\<slug>\          ← <slug>.md + media\ + tables\ + <slug>.meta.yaml masqué (D26/D47/D49)
└── out\<slug>\               ← <slug>.pdf + <slug>.html, régénérés à chaque Ctrl+S (D21)
```

Plus aucun fichier d'outillage. (Si un résidu doit être masqué plus tard : `files.exclude` + `attrib +h`, voir §6.)

### 3.5 Flux de mise à jour

```
Tâche planifiée (cachée)
  → GET releases/latest → manifest.json (~1 Ko)
  → comparer à state.json
      ├─ identique → log 1 ligne, fin (l'utilisateur ne voit rien)
      └─ différent → fenêtre visible « Mise à jour de l'outil Revue… »
           1. toolkit.zip   (Ko)   → vérif sha256 → C:\ProgramData\SZH\toolkit\
           2. rootfs.tar.gz (si version rootfs ≠) → vérif sha256 → wsl --unregister + --import
           3. vsix          (si ≠) → codium --install-extension
           4. seed %APPDATA%\VSCodium\User\ + raccourci menu Démarrer
           5. purge staging (garder N-1) → écrire state.json → « ✓ Tout est à jour »
      En erreur : message calme + « Contactez Robin Morand — robin.morand@szh.ch »
                  + [E] e-mail pré-rempli (mailto, trace tronquée) + log complet ouvert dans l'Explorateur.
```

Rollback : `update.ps1 -Version <X>` (le tar N-1 est encore en staging).
La distro étant jetable, une MAJ pendant l'édition est sans risque (au pire un Ctrl+S échoue une fois).

---

## 4. Plan de mise en œuvre

Ordre : **P1 → P2 → P3** (P4 en parallèle de P3) **→ P5**. Estimations grossières à titre indicatif.

### P0 — Prérequis (Robin)
- [x] Passer le dépôt GitHub en **public** (bloque l'auto-update sans PAT) — ✅ vérifié le 2026-08-13
      (`releases/latest` répond 200 sans authentification).

### P1 — Réorganisation du dépôt & pipeline central (~0,5–1 j)
- [x] Restructurer : `deploy/` → `image/` + `windows/` ; créer `pipeline/` (Makefile + styles sortis de `revue-template/`).
- [x] `Makefile` : chemin d'appel `make -f /mnt/c/ProgramData/SZH/toolkit/pipeline/Makefile` ;
      `STYLE` avec override local (`styles/print.css` s'il existe dans la revue → sinon style central) ;
      PDF atomique **à la racine** `revue.pdf` (tmp `~$…` invisible pour OneDrive) ; intermédiaires en tmp WSL (V3).
- [x] `Makefile` : cible **`import`** — `articles-word/*.{docx,odt}` → `articles/<slug>.md`
      (`--extract-media=articles/media/<slug>`, skip si le `.md` existe, déplacement vers `_convertis/`, résumé lisible).
- [x] `image/Containerfile` : toolchain pure ; `pip install -r requirements.txt` (pins transitifs **réels**,
      extraits par `pip freeze` de l'environnement déployé) ; TODO polices Open Sans (D7) ; marqueur de version conservé.
- [x] `build-rootfs.sh` : sortie `.tar.gz`.
- **Livrable** : ✅ **validé le 2026-07-03** sur la distro réelle — import d'un docx piégé
  (« Étude Müller (V3).docx » → `articles/etude-muller-v3.md`), images extraites **et** embarquées dans le
  PDF, `revue.pdf` à la racine, aucun fichier temporaire résiduel, idempotence (2ᵉ passage silencieux).

### P2 — CI de release (~0,5–1 j)
- [x] `release.yml` : sur tag `v*` — construire `toolkit-X.zip` (toujours) ; construire le rootfs
      **seulement si `image/**` a changé** depuis la release précédente (ou input manuel `force_rootfs`),
      sinon reprendre l'URL/sha du rootfs du `manifest.json` précédent.
- [x] Étape VSIX : télécharger les versions de `vsix.lock`, vérifier les sha256, publier en assets
      (simplification vs D11 : publiés à **chaque** release — quelques Mo — le manifest reste trivial).
- [x] Générer et publier `manifest.json` (schéma §3.2).
- [x] *(option macOS-ready, coût ~nul)* Pousser aussi l'image OCI sur GHCR (`ghcr.io/szh-csps/…:X`) — voir §6 « Portabilité macOS ».
- **Livrable** : ✅ **validé le 2026-07-03** sur la CI réelle (dépôt public) :
  - `v2026.07.0` (bump toolchain) : rootfs `.tar.gz` de **128 Mo**, toolkit **20 Ko**, 5 VSIX, manifest sha256 OK ;
  - `v2026.07.1` (retouche de `print.css` hors `image/`) : **aucun rootfs republié**, toolkit **28 Ko** ; le
    `manifest.json` réutilise le rootfs de `v2026.07.0` (`rootfs.version = 2026.07.0`). Un poste en 07.0 qui
    passe en 07.1 ne télécharge donc que ~30 Ko. Découpage gros-immuable / petit-mutable prouvé.

### P3 — Scripts Windows (~1–2 j)
- [x] `bootstrap.ps1` (admin, 1×) : moteur WSL, winget (VSCodium, SumatraPDF), ACL `C:\ProgramData\SZH`,
      création des tâches planifiées, rappel exclusions antivirus, puis premier `update.ps1`.
- [x] `update-launcher.ps1` (stable) : fetch manifest → si toolkit plus récent, le télécharger → déléguer à `toolkit\windows\update.ps1`.
- [x] `update.ps1` : logique du §3.5 ; paramètre `-Version` (pin/rollback) ; logging complet dans `logs\` ;
      **UI terminal** : ton amical, barre de progression sobre (pas de pathos), erreurs claires + contact +
      `mailto:` pré-rempli (trace tronquée ~1 500 caractères, chemin du log en corps) + ouverture de l'Explorateur sur le log.
- [x] `new-revue.ps1` : scaffold depuis `toolkit\revue-template\` ; création de « Ouvrir la revue.lnk » dans le dossier ;
      rappel « Toujours conserver sur cet appareil » ; enregistrement de la racine des revues dans la config du lanceur.
- [x] `open-revue.ps1` : scan des dossiers contenant `ausgabe.yaml` (D22) sous la racine configurée
      (défaut `$env:OneDrive\Revues`) ; petite fenêtre de sélection (WinForms, PS 5.1) triée par date ; raccourci menu
      Démarrer ; action « ＋ Nouvelle revue… » (D38).
- [x] Contrainte transverse : **compatibilité Windows PowerShell 5.1** (pas de `?.`, `??`, `&&`/`||`).
- **Livrable** : les cinq scripts sont écrits, publiés dans le toolkit et exercés par les releases
      `v2026.07.*`/`v2026.08.*`. ⏳ Reste la validation « machine vierge » de bout en bout, qui se confond
      avec le poste pilote (P5).

### P4 — Config VSCodium user-level (~0,5 j, parallèle à P3)
- [x] `tasks.json` **utilisateur** : « Aperçu / Export PDF » (**make all** = import + pdf) et « Importer les articles
      Word » (make import, `runOn: folderOpen` best-effort + Ctrl+Alt+I). **Décision de conception** : l'import est
      replié dans le build (`make all`, récursion validée) → l'inclusion des Word ne dépend plus de `folderOpen`,
      ce qui neutralise le point le plus fragile de V1. Repli inchangé : mini `.vscode/` masqué.
- [x] `settings.json` : `triggerTaskOnSave`, `files.exclude`/`search.exclude`, `editor.quickSuggestions` réactivé
      **scope `[markdown]`** (D15), config cSpell complète (mots + bascule `.de/.fr/.en`) rapatriée du template.
- [x] `snippets/markdown.json` : blocs `::: {.classe}` (chapô, encadré, exergue, résumé, note, avertissement,
      front-matter) — classes assorties ajoutées à `print.css`.
- [x] `keybindings.json` : Ctrl+E (export) et Ctrl+Alt+R conservés ; **Ctrl+Alt+I** (importer),
      **Ctrl+Alt+S** (insérer un bloc de style).
- [x] Supprimer `revue.code-workspace`, `.vscode/` **et** `.editorconfig` du template (config 100 % user-level).
- **Livrable** : ✅ **validé le 2026-07-03** — `make all` importe et inclut un Word déposé en une seule action ;
      les classes `chapo/encadre/exergue/avertissement` sont rendues dans le PDF ; le dossier de revue ne
      contient plus que du contenu. ⏳ Reste V1 côté poste : confirmer que *Trigger Task on Save* voit bien la
      tâche utilisateur (build à la sauvegarde) — à cocher au pilote.

### P5 — Documentation & pilote (~0,5–1 j)
- [x] README : nouvelle architecture, nouveau runbook (bootstrap 1×, releases par tag, plus d'édition de script).
- [x] `BIENVENUE.md` : workflow rédacteur (déposer les Word → ouvrir la revue → Ctrl+S), lanceur menu Démarrer.
- [x] Doc polices (D7/§6) et doc « masquage résiduel » (`files.exclude`/`attrib +h`, §6) — dans README + §6.
- [ ] **Poste pilote** : dérouler la checklist V1–V8 ci-dessous, corriger, puis généraliser. *(à faire sur poste réel)*

### P6 — Lanceur intelligent, associations & profils (décidé le 2026-07-04 — D18/D19/D20)
- [x] **T6.1 Test GUI de l'aperçu intégré** — ✅ **validé 2026-07-04** (poste de Robin, après
      migration de la revue au nouveau format) : volet rafraîchi **sans se fermer**, position de
      lecture conservée, ~2 s après Ctrl+S → **D19 confirmée, pas de fork**. Le remplacement
      atomique est bien rapporté « change ». Prérequis découvert : la revue doit être au nouveau
      format (l'ancien `.vscode` local avec `watcherExclude **/out/**` reproduisait la panne).
- [x] T6.2 `open-md.ps1` (lanceur, toolkit) — ✅ **2026-08-13**. Remonte jusqu'à `ausgabe.yaml` (D22)
      et ouvre VSCodium sur le DOSSIER + le fichier. **Ne compile pas** : la compilation et
      l'aperçu passent par le cockpit, qui ouvre l'article actif au démarrage (**D77** — le plan
      prévoyait l'inverse ; les raisons sont dans la décision). Cas limites traités et testés :
      hors revue, `.md` non article, chemin UNC, fichier absent, sans argument, VSCodium absent.
- [x] T6.3 Association — ✅ **2026-08-13**. ProgId `SZH.Markdown` + `.md\OpenWithProgids` (REG_NONE)
      posés en **HKCU** par `update.ps1`, avec `FriendlyAppName` (sans elle, « Ouvrir avec »
      afficherait « Windows Based Script Host »). Aucun forçage de `UserChoice` (D18).
      ⏳ Reste l'option XML DISM au bootstrap (nouveaux profils) et la vérification du libellé
      réellement affiché dans la boîte « Ouvrir avec » — à cocher au pilote.
- [x] T6.4 Dispatch `profil:` dans le Makefile — ✅ **2026-08-13** (lecture `sed`, comme `lang:`).
      Les 6 routes sont vérifiées par un **build réel** dans la distro : absente et `article`
      → PDF + HTML ; vide → aucun document, sortie 0 ; `presentation` → `.pptx` **+ aperçus HTML** ;
      `book` et valeur inconnue → message clair, sortie non nulle. Arbitrages : **D78**.
- [x] T6.5 `userdoc.md` — section « Ouvrir les `.md` » réécrite (« Revue SZH » et non « VSCodium » :
      sceller `UserChoice` sur VSCodium contournerait définitivement le lanceur) + les 4 cas du
      double-clic. ⏳ `profil:` n'y est pas encore documenté (ni dans `BIENVENUE.md`).
- **Livrable** : ✅ double-clic sur un `.md` → la revue s'ouvre complète (dossier + texte, puis
  aperçu ouvert par le cockpit) ; un dossier `profil: presentation` produit un `.pptx` au Ctrl+S,
  sans aucun changement côté poste. ⏳ Reste la validation GUI (double-clic réel, libellé
  « Ouvrir avec », rendu du `.pptx` à l'œil).

### P7 — Convertisseur v2 (décidé et implémenté le 2026-07-05 — D26 à D31)
- [x] Analyse AST des **6 articles réels** (styles, légendes, références, formes de citation) — chaque heuristique fondée sur des preuves.
- [x] `image/` : **Ruby + AnyStyle 1.6.0** dans le rootfs (outils de compilation purgés après build de wapiti).
- [x] `pipeline/filters/szh-import.lua` : purge des titres vides (sans avaler les images à alt vide !), titres
      déduits du tout-gras (« Chanier »), listes manuelles, normalisation des paragraphes d'images
      (`[Image, déchet]`, `[Image, Image]` — « Leclerc »), figures/tableaux légendés (voisin avant puis après,
      espaces insécables assainis partout), extraction des références par contenu+position (tables bio
      intercalées sautées — « Piricò », continuations regroupées — « Dentz »), alt-texts IA purgés.
- [x] `pipeline/filters/szh-citations.lua` : liaison citeproc — parenthétiques, [crochets], multiples (;),
      locators (p./pp./S.), multi-années (2011, 2016), « sous presse »/« en préparation », sigles
      d'organisations indexés depuis les lignes brutes (AnyStyle perd les [OMS]), narratives « Nom (année) »,
      insensible aux accents (Fauré≡Faure) ; délimiteurs éclatés en tokens (ponctuation collée, nbsp) ;
      non-résolues → rapport. Passe B en `--standalone` (sinon le YAML bibliography est perdu — bug trouvé au test).
- [x] `pipeline/import-docx.sh` (2 passes pandoc + AnyStyle + rapport), `pipeline/rapport.py` (HTML trilingue
      autonome : langue du navigateur + boutons FR/DE/EN), `pipeline/csl/apa.csl` (APA 7 vendorisé),
      compteurs CSS figures/tableaux (D31) + style bibliographie.
- [x] Makefile : structure `articles/<slug>/{<slug>.md, media/}` (D26), **migration automatique** des `.md`
      à plat, build par article avec `--citeproc` conditionnel (présence du `.bib`).
- **Livrable** : ✅ **validé le 2026-07-05 sur les 6 articles réels** — 6/6 convertis, **85/107 citations
  liées (~80 %)**, 86 références structurées en `.bib`, 6 PDF/HTML avec bibliographie APA rendue et titre
  localisé, figures numérotées automatiquement, rapports générés. Chaque citation non liée est listée
  dans le rapport de l'article — c'est le fallback humain prévu (D29/D30).

---

## 5. Points de validation & risques

| # | Risque / à valider | Impact | Repli |
|---|---|---|---|
| V1 | ✅ **Validé 2026-07-04** (poste de Robin) — build ~2 s après Ctrl+S (et via l'autosave) : la tâche user-level est bien vue par *Trigger Task on Save* ; `folderOpen` neutralisé par `make all` | ~~Build auto à la sauvegarde~~ | (plus nécessaire) |
| V2 | `winget` sous compte SYSTEM (tâche « SZH – Apps ») : winget n'est pas nativement dispo pour SYSTEM | VSCodium/Sumatra ne se MAJ pas seuls | Workaround chemin WindowsApps, sinon upgrade lors d'un passage admin occasionnel (documenté) |
| V3 | ✅ **Validé 2026-07-03** — résolu par `pandoc --embed-resources` (HTML autonome en tmp WSL, images et CSS inlinés ; testé docx→media→PDF) | ~~PDF sans images~~ | (plus nécessaire) |
| V4 | Rechargement auto de l'aperçu : **analyse code 2026-07-04 (D19)** — mécanisme présent dans tomoki 1.2.2 ; cause de la panne historique identifiée (`watcherExclude **/out/**` + PDF dans `out/`, corrigé en P4). Reste T6.1 : « change » vs « delete » au remplacement atomique | Confort | Secours Ctrl+Alt+R / SumatraPDF ; dernier recours : fork maison (D19) |
| V5 | `mailto:` : corps limité (~2 000 caractères) | Trace incomplète dans l'e-mail | Trace tronquée + log complet désigné dans l'Explorateur (à joindre) |
| V6 | API GitHub non authentifiée : 60 req/h/IP | Échec du check | 2 checks/jour/poste → très en dessous ; réessai silencieux au prochain déclenchement |
| V7 | `.lnk` synchronisés par OneDrive et chemin absolu de VSCodium | Raccourci mort | Flotte homogène (install machine par bootstrap) ; le lanceur du menu Démarrer reste l'entrée de secours |
| V8 | Conversion auto à l'ouverture : docx corrompu/protégé par mot de passe | Message d'erreur anxiogène | La cible `import` isole les échecs par fichier et affiche un résumé calme ; l'original reste dans `articles-word/` |

---

## 6. Documenté pour plus tard (hors périmètre immédiat)

- **Polices (D7)** : `fonts-noto` est un métapaquet énorme (core + extra + ui-extra…), le plus gros poste
  du rootfs après Pandoc. Cible : `COPY fonts/` avec **Open Sans** (licence OFL — embarquable) + `fc-cache`,
  suppression de `fonts-noto`, conservation de `fonts-dejavu` en filet. Gain estimé : plusieurs centaines de Mo
  sur chaque téléchargement de rootfs. À faire lors du travail sur la maquette.
- **Masquage résiduel** : si des fichiers techniques doivent réapparaître dans les revues, deux leviers
  documentés : `files.exclude` (masque dans VSCodium, niveau user) et `attrib +h` posé par le scaffold
  (masque dans l'Explorateur ; OneDrive synchronise quand même).
- **Canal de test** : marquer une release *pre-release* → `releases/latest` l'ignore ; un poste pilote peut
  la cibler via `update.ps1 -Version`. À formaliser si besoin d'un vrai canal bêta.
- **Langue FR de l'interface** : inchangé (voir README) — vendoriser le language pack si demandé.
- **Compilation de `.md` isolés** : non retenu (D13) ; une cible `make single FILE=…` resterait possible si un vrai besoin émerge.
- **Diffs binaires (zsync/casync)** : écartés — le découpage toolkit/rootfs suffit à cette échelle.
- **Migration Silverblue** : inchangée — `Containerfile` et pipeline sont déjà la future base bootc ;
  l'hébergement Windows du pipeline (D2) sera alors remplacé par un chemin natif.
- **Portabilité macOS** (évaluée 2026-07-03) : ~80 % du système est déjà agnostique — `Containerfile`/image
  OCI, `pipeline/` (make POSIX, exécuté *dans* le conteneur), config VSCodium (JSON identiques,
  `tasks.json` supporte des variantes `"windows"`/`"osx"` par tâche), modèle release/manifest, template,
  OneDrive, extensions. À remplacer (la « colle » OS, ~20 %) : WSL → **Podman machine** (image tirée de
  GHCR : pulls incrémentaux par couches, gratuit, évite la licence Docker Desktop) ; scripts PowerShell →
  équivalents bash fins ; Task Scheduler → launchd ; `.lnk`/menu Démarrer → fichiers `.command`/Dock ;
  SumatraPDF → Aperçu/Skim (l'aperçu intégré tomoki1207.pdf est déjà multiplateforme). Effort initial
  estimé : **2–4 jours** ; le vrai coût est récurrent (deux jeux de scripts à tester à chaque release).
  **Garde-fous pris dès maintenant (coût ~nul)** : ① pousser l'image sur GHCR en CI (option ajoutée en P2) ;
  ② toute l'intelligence dans `Makefile`/`manifest.json`, scripts OS « bêtes » ; ③ aucun chemin `/mnt/c`
  codé en dur dans `pipeline/` (chemins fournis par la tâche appelante) ; ④ prévoir les clés `"osx"` dans
  `tasks.json` (P4). Si seulement 1–2 Mac isolés : setup manuel documenté (brew + podman) plutôt que
  porter toute la machinerie d'auto-update.

---

## 7. Restes à faire (après le lot M1–M5, 2026-08-13)

- [x] **Transcrire les décisions D37–D74** dans la table du § 2 — fait le 2026-08-13 (les plans de lot
  avaient été retirés du dépôt : récupérés depuis `git show 94c7866^:PLAN-*.md`). La dette était plus
  large que « D37–D54 » : le code cite des décisions **jusqu'à D74** (éditeur de tableau, styles,
  accessibilité, maquette, choix de revue). M6 (D55) et M7 (D56) étaient encore notés « À FAIRE » dans
  le plan alors qu'ils sont faits. La décision du 2026-08-13 (retrait de `csholmq`) prend donc le
  numéro **D75**, D57 étant déjà pris par l'éditeur de tableau.
- [x] **Pack de langue DE** : `MS-CEINTL.vscode-language-pack-de` **1.108.0** ajouté à `windows/vsix.lock`
  (M4). Version choisie *sous* celle de l'éditeur : un pack déclare `engines ^1.<minor>.0`, et VSCodium
  est en 1.109 sur le poste de référence — la « dernière » (1.131.0) serait refusée. `update.ps1` écrit
  en plus `"locale"` dans `%APPDATA%\VSCodium\argv.json` quand Windows est en allemand : sans cela, le
  pack est installé mais les menus natifs restent en anglais.
- [x] **Bump de version szh-cockpit** : `0.2.0` + description corrigée (elle annonçait « lecture seule »).
- [ ] **Tag de release** : livre sur les postes les deux extensions (szh-cockpit 0.2.0, szh-apercu)
  **et** le pipeline (extracteur Python D50, aperçu HTML D53). En attendant, tester M2/M5 exige un
  re-sync manuel de `pipeline/` vers `C:\ProgramData\SZH\toolkit\pipeline\`.
- [ ] **Validations humaines du lot M** (ne peuvent pas être automatisées) : scénarios GUI, libellés
  DE/IT des 6 types d'article, relecture germanophone des 102 clés `TEXTES_COCKPIT`. Voir `TODORMO.md`.
