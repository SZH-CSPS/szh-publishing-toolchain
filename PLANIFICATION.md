# Planification — Refonte du déploiement & workflow de layout

> Document de pilotage du projet. Décisions actées le **2026-07-03** (Robin Morand).
> Statut : ✅ **P1 → P5 implémentés, commités et validés** (2026-07-03). Deux releases de test publiées
> sur le dépôt public. **Reste** : pilote sur poste réel (checklist V1–V8, §5) et **phase P6**
> (lanceur intelligent, association `.md`, profils de compilation — décisions D18–D20 du 2026-07-04).
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
| D25 | **UI de mise à jour trilingue FR/DE/EN** (2026-07-04), selon la **langue d'affichage de Windows** (`Get-UICulture`, code à deux lettres) : `fr-CH`/`fr-FR` → FR, `de-CH`/`de-DE` → DE, tout le reste → EN (fallback). Table de textes + fonction `T` dans `szh-common.ps1` ; couvre update.ps1, l'écran d'erreur, l'e-mail support et le lanceur « Revues SZH ». Allemand en **orthographe suisse** (ss, pas de ß) ; unités Mo (FR) / MB (DE, EN). Variable `SZH_LANGUE=fr|de|en` pour forcer (test/support). `bootstrap.ps1` et `new-revue.ps1` restent en FR (outils du référent). | Les formats régionaux (fr-CH vs fr-FR) n'affectent pas la détection : seul le préfixe de langue compte. Validé en rendu PS 5.1 dans les trois langues. |
| D26 | **Structure de travail par article** (2026-07-05) : `articles/<slug>/<slug>.md` + `articles/<slug>/media/` (images, `.bib`, matières premières de l'article) — miroir de `out/<slug>/`. Migration automatique des `.md` à plat par la cible `import`. | Chaque article devient une unité autonome et déplaçable ; le `.bib` vit dans `media/` (exigence). |
| D27 | **Convertisseur v2, idiomatique pandoc** (2026-07-05) : filtres **Lua** exécutés dans pandoc — ① suppression des titres vides ; ② titres déduits des paragraphes tout-gras courts (fondé : 1/6 article réel sans styles, « Chanier ») ; ③ listes à puces manuelles (•, -, –) regroupées en vraies listes ; ④ images et tableaux enveloppés en **Figures** avec légende détectée dans le texte voisin (`Figure|Fig\.|Abbildung|Abb\.|Tableau|Tabelle|Table` + n°, avant OU après, deux-points optionnel), numéro manuel retiré (numérotation auto D31), alt-texts « générés par l'IA » purgés ; ⑤ notes de bas de page : natif pandoc (compté au rapport). Commentaires Word ignorés + suivi de modifications accepté (`--track-changes=accept`). | Heuristiques fondées sur l'analyse AST des **6 articles réels** de la revue 2026-01. |
| D28 | **Références via AnyStyle** (2026-07-05) : Ruby + gem `anystyle-cli` ajoutés au **rootfs**. Détection de la liste de références par **contenu + position** (séquence terminale de ≥3 paragraphes « ref-like » : année `\d{4}[a-z]?`/« sous presse »/« en préparation »/« in press », motifs auteurs, URLs ; le nom du titre n'est qu'un signal secondaire) ; entrées multi-paragraphes regroupées (fondé : « Dentz ») ; headers vides au milieu tolérés (fondé : « Piricò »). Sortie : `articles/<slug>/media/<slug>.bib`. Fallback : pas de détection → l'article reste intact + signalé au rapport. | « On part du principe que la liste est juste » ; AnyStyle ne fait que structurer. |
| D29 | **Citations liées citeproc** (2026-07-05) : après création du `.bib`, 2ᵉ passe pandoc avec filtre Lua qui convertit les citations en `[@clé]` : parenthétiques et [crochets], multiples (`;`), locators (`p./pp./S. n`), multi-années (`2011, 2016`), `et`/`&`/`et al.`/`et al`, sigles d'organisations (`[CDIP]`, `[OMS]`…), narratives `Nom (2020)`, insensible aux accents (Fauré≡Faure). Non-résolues → laissées telles quelles + listées au rapport. Rendu : `--citeproc` + **CSL APA vendorisé** (`pipeline/csl/apa.csl`), titre de section de bibliographie selon la langue de l'article. | Tout ce qui précède est du pandoc standard (Cite AST, citeproc) — zéro moteur custom. |
| D30 | **Rapport de conversion HTML trilingue** par article (`articles/<slug>/<slug>-rapport.html`) : converti / à vérifier / conseils Word ; autonome (CSS+JS inline) ; langue par défaut = langue du navigateur (`navigator.language`), boutons FR/DE/EN. Généré par `pipeline/rapport.py` (python3 de l'image) depuis les stats JSON émises par les filtres. | Fallback humain de toutes les heuristiques ; zéro plomberie de langue Windows→WSL. |
| D31 | **Numérotation automatique Figures/Tableaux** par compteurs **CSS** dans la maquette (`figcaption::before`/`caption::before` + `:lang(fr/de/en)` pour Figure/Abbildung/Tableau/Tabelle/Table) — idiomatique WeasyPrint, aucun binaire en plus (pandoc-crossref écarté). Les numéros manuels des légendes sont retirés à l'import ; le rapport signale de vérifier les renvois du texte. | Fonctionne pour le PDF et le HTML autonome (images base64 via `--embed-resources`, déjà en place). |
| D32 | **Édition des tableaux markdown** (2026-07-05) : deux extensions épinglées — `TakumiI.markdowntable` (navigation **Tab** de cellule en cellule, insertion/déplacement de lignes et colonnes, formatage auto ; édition Open VSX de « Markdown Table », takumisoft68 étant absent d'Open VSX) et `csholmq.excel-to-markdown-table` (**coller un tableau depuis Excel/Word** en markdown, Maj+Alt+V). Convertisseur : tableaux émis en **pipe** (`-simple_tables-multiline_tables`), grid en repli pour les cellules complexes. | Les extensions de tableaux ne manipulent que le format pipe ; le repli grid préserve les tableaux riches (à simplifier dans Word — conseil au rapport). |

---

## 3. Architecture cible

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
├── dossier.yaml              ← métadonnées du numéro
├── articles-word\            ← déposer ici les Word finalisés (originaux archivés dans _convertis\)
├── articles\                 ← les .md de travail (+ media\ extraits des Word)
└── revue.pdf                 ← se régénère à chaque Ctrl+S
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
- [ ] Passer le dépôt GitHub en **public** (bloque l'auto-update sans PAT).

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
- [ ] `bootstrap.ps1` (admin, 1×) : moteur WSL, winget (VSCodium, SumatraPDF), ACL `C:\ProgramData\SZH`,
      création des tâches planifiées, rappel exclusions antivirus, puis premier `update.ps1`.
- [ ] `update-launcher.ps1` (stable) : fetch manifest → si toolkit plus récent, le télécharger → déléguer à `toolkit\windows\update.ps1`.
- [ ] `update.ps1` : logique du §3.5 ; paramètre `-Version` (pin/rollback) ; logging complet dans `logs\` ;
      **UI terminal** : ton amical, barre de progression sobre (pas de pathos), erreurs claires + contact +
      `mailto:` pré-rempli (trace tronquée ~1 500 caractères, chemin du log en corps) + ouverture de l'Explorateur sur le log.
- [ ] `new-revue.ps1` : scaffold depuis `toolkit\revue-template\` ; création de « Ouvrir la revue.lnk » dans le dossier ;
      rappel « Toujours conserver sur cet appareil » ; enregistrement de la racine des revues dans la config du lanceur.
- [ ] `open-revue.ps1` : scan des dossiers contenant `dossier.yaml` sous la racine configurée
      (défaut `$env:OneDrive\Revues`) ; petite fenêtre de sélection (WinForms, PS 5.1) triée par date ; raccourci menu Démarrer.
- [ ] Contrainte transverse : **compatibilité Windows PowerShell 5.1** (pas de `?.`, `??`, `&&`/`||`).
- **Livrable** : sur machine vierge — bootstrap 1× admin, puis MAJ de bout en bout sans admin, silencieuse quand rien à faire.

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
- [ ] T6.2 `open-md.ps1` (lanceur intelligent, toolkit) : remonte l'arborescence jusqu'à `dossier.yaml`,
      compile si l'artefact manque (feedback « Préparation de l'aperçu… »), ouvre VSCodium sur le
      DOSSIER + le fichier, ouvre l'aperçu.
- [ ] T6.3 Association : ProgId `SZH.Markdown` dans « Ouvrir avec » (HKCU, posé par update.ps1) pointant
      le lanceur ; option XML DISM au bootstrap (nouveaux profils) ; procédure « Toujours » → `userdoc.md` (✅ fait).
- [ ] T6.4 Dispatch `profil:` dans le Makefile : lecture du champ (pandoc ou python3 de l'image),
      routes `article` (existant), vide (no-op avec message doux), `presentation` (pptx) ;
      erreur claire si profil inconnu ; `book` différé.
- [ ] T6.5 Étoffer `userdoc.md` au fil des besoins (doc utilisateur du poste, versionnée au dépôt).
- **Livrable** : double-clic sur un `.md` → la revue s'ouvre complète (éditeur + aperçu à jour) ;
  un dossier `profil: presentation` produit un `.pptx` au Ctrl+S, sans aucun changement côté poste.

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
