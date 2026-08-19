# Todo Robin (mis à jour le 2026-08-19, après la vague 1 des features F1–F8)

## Validations qui demandent un humain — correctifs C1–C3 (2026-08-19)

- [ ] **C1 — compilation après import** : importer un ou deux `.docx` → la compilation
  s'enchaîne toute seule (statut « Compilation des articles importés… ») AVANT le
  dialogue de vérification ; ensuite, le premier clic sur un article importé montre
  l'aperçu sans attente. Vérifier sur un import de plusieurs fichiers que la durée
  reste acceptable (sinon : à passer en tâche de fond).
- [ ] **C2 — aperçu pas encore prêt** : cliquer un article dont `out/` a été effacé →
  l'aperçu s'ouvre avec « pas encore compilé » **+ « Compilation en cours, merci de
  patienter quelques secondes… »**, la compilation part, et le rendu remplace le
  message tout seul. Rejouer en mode PDF (message d'erreur + même phrase, puis le PDF
  s'ouvre), et pendant qu'une autre compilation tourne déjà (message d'attente au lieu
  de l'abandon silencieux d'avant).
- [ ] **C3 — poubelle images/tableaux** : au survol d'une image et d'un tableau, la 🗑
  demande confirmation, supprime le fichier **et** retire l'insertion du texte
  (`![…](media/…)` / bloc `::: {.szh-tabelle …}`). Vérifier : le compte annoncé dans la
  barre d'état, le texte enregistré et recompilé, Ctrl+Z qui restaure le texte, un
  tableau ouvert dans l'éditeur qui se ferme, une image ouverte en aperçu dont l'onglet
  se ferme, et le cas « aucune insertion trouvée » (fichier orphelin) qui supprime quand
  même sans rien casser.

## Validations qui demandent un humain — lot F1/F5/F8 + portraits + export OJS (D88–D93)

- [ ] **Barre épurée (D88)** : ouvrir une revue → la vue « Revue SZH » ne montre que 3 boutons
  (🚀 ✏ ⬆), tooltips FR ; en VSCodium DE, tooltips DE. Ctrl+Maj+P → « Rafraîchir la barre
  Revue » fonctionne toujours (bouton retiré, commande conservée).
- [ ] **Panneau Commande** (`Ctrl+Alt+A` et clic) : les 5 entrées ouvrent bien importer /
  convertir / méta-données numéro / métadonnées articles / réglages.
- [ ] **Panneau Édition** (`Ctrl+Alt+S`) : depuis un `.md`, chaque action s'applique à la
  sélection ; depuis un non-`.md`, une action de mise en forme → message « Ouvrez un
  article… », mais « Basculer l'aperçu » fonctionne. Vérifier aussi `Ctrl+Alt+S` dans un
  `.md` **hors** revue. Le clic droit → « Mise en forme » reste la palette pure, inchangée.
- [ ] **Panneau Export** (`Ctrl+Alt+D`) : « Recompiler toute la revue » lance le rebuild ;
  l'entrée « Exporter en XML (OJS) » doit être **présente** (la commande est livrée).
- [ ] **F5 pleine page (D89)** : article ouvert avec aperçu PDF à droite → « Méta-données du
  numéro » : l'onglet PDF se ferme. Idem en mode HTML, idem via un aperçu ouvert par
  szh-apercu (Ctrl+S). Rejouer avec « Métadonnées des articles » déjà ouvert en arrière-plan
  (le reveal doit fermer les aperçus d'abord). Éditeur de tableau : ouverture = tout se ferme ;
  « Voir le tableau dans l'aperçu » rouvre et scrolle ; « Cacher l'aperçu » referme.
- [ ] **F8 (D90)** : Réglages SZH → radio « Aperçu par défaut » reflète l'état courant ;
  passer sur PDF → barre d'état « Aperçu : PDF » immédiate, prochain clic d'article ouvre le
  PDF ; `Ctrl+Alt+P` bascule ; radio resynchronisée à la réouverture des réglages.
- [ ] **Raccourcis `Ctrl+Alt+A/S/D/P`** sur clavier suisse FR et DE (collision AltGr à
  confirmer physiquement).
- [ ] **Portraits (D91) — vraies photos** : le test automatique n'a couvert qu'un visage
  synthétique. À valider sur de vraies photos : visages non frontaux, lunettes, groupes,
  contre-jour, photo très serrée (padding), photo sans visage (fallback). Vérifier le rendu
  N&B 400×400 des deux versions.
- [ ] **Bloc auteurs (D92)** : jugement visuel sur un article réel (taille de la pastille
  ORCID, wording du titre) ; les libellés DE/IT du bloc sont un PREMIER JET à relire.
- [ ] **Taille du rootfs (D91)** : venv portraits ≈ 735 Mo + modèle 168 Mo (weasyprint : 80 Mo).
  Accepter, ou épingler un rembg plus ancien sans scikit-image/numba (re-freeze à faire).
  Premier build CI du Containerfile = la preuve finale (pas de podman local pour l'essai).
- [ ] **Export OJS (D93)** : import d'essai du XML généré dans un OJS de test (ou le vrai,
  numéro dépublié) — rubriques rattachées, galleys téléchargeables, résumés/mots-clés, et ce
  qu'OJS fait **sans email d'auteur**. ⚠ `genre`/`uploader`/`user_group_ref` sont rattachés
  par NOM (constantes en tête d'export-ojs.js) : valables pour le journal FR observé, à
  vérifier pour la Zeitschrift (DE). Un XML de production fera 30-50 Mo : la limite d'upload
  PHP peut imposer l'import CLI d'OJS.
- [ ] **DOCX régénérés (D93)** : ouvrir un `out/<slug>/<slug>.docx` dans Word — tableaux
  fusionnés, images, bibliographie. ⚠ Les SVG de la maquette sont perdus (« rsvg-convert is
  not in path ») : ajouter `librsvg2-bin` au rootfs si ça se voit.
- [ ] **Drop de .docx (D94)** : tirer depuis l'Explorateur Windows sur la vue « Revue SZH » —
  1 fichier, plusieurs, conflit (→ modale Remplacer/Ignorer), mélange avec des non-docx
  (→ message « seuls les .docx… »), drop de texte (→ rien). Confirmer que le `text/uri-list`
  externe marche sur le VSCodium déployé (API ≥ 1.66).
- [ ] **Modale photo (D95) — bout-en-bout sur un poste à jour** (rootfs avec `/opt/portraits`
  ET toolkit avec `portraits.py`) : dépôt → 3 versions → Valider → Enregistrer → `photo:`
  dans le meta.yaml → bloc « À propos » visible dans le PDF. Réouverture = radio
  présélectionnée ; redépôt .jpg après .png ; photo « trop serrée » (note padding) ; image
  sans visage (note + recadrage centré). Icônes poubelle/photo et damier de transparence
  lisibles en thème clair ET sombre ; console webview sans erreur CSP.
- [ ] **Sans WSL / distro absente (D95)** : la modale affiche une erreur propre, pas de
  blocage ni de « Chargement… » figé.
- [ ] **E-mail d'auteur → export OJS** : saisir un email dans le formulaire, exporter le XML,
  vérifier `<email>` dans le bloc auteur.
- [ ] **Dialogue de vérification d'import (F6)** : importer un vrai .docx → le panneau
  s'ouvre seul (plus de simple notification) ; badges « détecté / à compléter » conformes au
  meta.yaml, compteur recalculé à la saisie et au « + Italien » ; Enregistrer → fiche
  réécrite (clés inconnues préservées) ; modale photo de bout en bout depuis le dialogue ;
  remplacement d'image par drop ET par bouton (confirmation, nom conservé, description
  rafraîchie, > 50 Mo refusé, refus pendant build/import) ; Fermer avec modifications →
  modale ; deuxième conversion panneau ouvert → reveal + recharge (les saisies non
  enregistrées de la vague précédente sont perdues — même logique que le formulaire) ;
  0 nouveau → notification classique ; tout rejouer en DE ; console webview sans
  violation CSP. ⚠ La croix de l'onglet ne passe pas par la garde « non enregistré »
  (limite API webview, comme l'éditeur de tableau).
- [ ] **Convertisseur (D96/D97) — relecture humaine d'un échantillon** : compiler et relire
  1 article FR + 1 DE + 1 éditorial + 1 « Actualité et ressources » convertis depuis
  tmp/docx-dev (le tableau complet des 64 est dans `tmp/rapport-calibration-f6.md`) :
  corps sans perte, titres aux bons niveaux, résumés/mots-clés dans la bonne langue,
  bibliographie rendue par citeproc sous son titre. Points connus à repérer : 2 cas
  prénom/nom inversés dans la source, seconds prénoms rangés dans `nom`,
  fonction/affiliation parfois fusionnées — se corrigent au formulaire.
- [ ] **Citations (D97)** : décider si la liaison des citations (`szh-citations`, 72,6 %
  auto) devient une action supervisée du cockpit — NE PAS l'activer à l'import.
- [ ] **Charts/SmartArt Word** : 4 légendes orphelines dans le corpus (pandoc ne convertit
  pas ces objets) — fournir les images via le dialogue d'import (zone « originaux »).
- [ ] **Types `interview`** : non détectables automatiquement — requalifier à la main dans
  le formulaire après import.

## Validations qui demandent un humain (lots précédents)

- [ ] **Scénarios GUI du lot M** : redémarrer VSCodium, puis vérifier l'aperçu HTML cliquable,
  le formulaire de métadonnées d'article, le menu de réglages, la bascule de langue.
- [ ] **Double-clic sur un `.md`** (P6) : clic droit → Ouvrir avec → **« Revue SZH »** (pas
  « VSCodium » !) → cocher « Toujours ». Vérifier que la revue s'ouvre complète et que
  l'aperçu apparaît tout seul. Deux points à regarder de près :
  - le **libellé affiché** dans la boîte « Ouvrir avec » (il dépend de `FriendlyAppName` ;
    non vérifiable sans écrire dans le vrai registre) ;
  - le comportement quand **une autre revue est déjà ouverte** (nouvelle fenêtre ou réutilisation).
- [ ] **Collage de tableau** (`Ctrl+Alt+V`, D81 — le raccourci a CHANGÉ) : copier dans
  Excel **puis** dans Word, coller dans un article. Attendu : un fichier
  `articles/<slug>/tables/table-NN.html` créé, sa référence insérée au curseur, le tableau
  visible aussitôt sous l'article dans la barre « Revue SZH », et « Éditer le tableau »
  l'ouvre correctement. Points à regarder :
  - **les cellules fusionnées** doivent survivre (c'était le défaut de l'ancienne version) ;
  - depuis **Excel**, le tableau arrive **sans gras ni ligne d'en-tête** : Excel met ces
    informations dans des classes CSS, jamais dans des balises. Ça se règle d'un clic dans
    l'éditeur. Depuis **Word**, gras, italique et en-tête sont conservés ;
  - le **délai** : la lecture du presse-papiers passe par un `powershell` court, soit
    environ une demi-seconde à une seconde avant l'insertion. À dire si c'est gênant ;
  - que `Ctrl+Alt+V` ne soit pas déjà pris par une des extensions installées.
- [ ] **Entrée « Ouvrir avec »** (D18, corrigé) : elle doit s'appeler **« Revue SZH »** et
  non plus « Microsoft ® Windows Based Script Host », avec l'icône SZH (tuile bleu nuit
  barrée de rouge) — reconnaissable au premier coup d'œil face à l'entrée « VSCodium »
  juste à côté. Et dans l'Explorateur, la colonne Type doit dire « Article de revue SZH ».
- [ ] **Clic sur un tableau** (D84) : dans la barre latérale, cliquer un tableau doit ouvrir
  l'**éditeur de tableau** (la grille), pas le fichier HTML. Le bouton « Éditer » du survol a
  disparu — seul « Remplacer » reste. À vérifier aussi que rouvrir un tableau déjà ouvert le
  ramène au premier plan au lieu d'en ouvrir un second.
- [ ] **Aplats de tableau plus pâles et plus sombres** (D87) : les fonds « couleur » et
  « négatif » des tableaux ont changé pour tenir le seuil de lisibilité à la taille réelle
  du texte de tableau (13,6 px). À juger à l'œil sur un tableau réel : `-clair` passe du
  cran 200 au 100, `-fonce` du 700 au 800. Pour un numéro **rouge**, le fond négatif n'est
  plus le rouge de charte mais `#9F001F`.
- [ ] **Deux jetons de maquette à arbitrer** (D87, laissés en attente parce qu'ils touchent
  la couverture) :
  - `--c-kw-bg` : les puces de mots-clés sont à **10 px**, plus petit que tout ce que les
    quatre niveaux couvrent. Rouge 82, capucine 90 — sous le seuil. Soit on grossit la puce
    dans `print.css`, soit on éclaircit le mélange dans `accent-css.py`. Mon avis : à 10 px,
    éclaircir ne suffira jamais vraiment ; c'est la taille qu'il faut revoir.
  - `--c-annual-text` : **aucune règle ne le consomme**. Il est déclaré et émis, rien ne
    l'applique. Soit une règle l'utilise et il faut le porter à 90, soit c'est du code mort
    à supprimer.
- [ ] **Saut de page** (`Ctrl+Alt+Entrée`, D86) : vérifier sur un article réel que la page
  se coupe où voulu dans le PDF, et que l'aperçu HTML reste inchangé. Le comportement est
  prouvé par un build (1 page → 2 pages), mais le geste et le placement du marqueur dans
  le texte n'ont pas été essayés en vrai.
- [ ] **Choisir 4 préréglages de tableau parmi les 8** (D85) : ouvrir un tableau, cliquer
  chaque préréglage et juger au rendu. Les huit sont des propositions — académique, en-tête
  foncé, en-tête couleur, en-tête gris, lignes alternées, colonnes alternées, synthèse,
  matrice. Pour n'en garder que quatre : supprimer les entrées inutiles de `PRESETS_TABLE`
  et `PRESETS_ORDRE` (`lib/table-model.js`) **et** leurs libellés `table.preset.<clé>` dans
  `lib/i18n.js` (fr **et** de). Rien d'autre.
- [ ] **Éditeur de tableau : la place** (D85) : vérifier que l'aperçu de l'article se ferme
  bien à l'ouverture, que « Voir le tableau dans l'aperçu » le rouvre **et** amène la vue
  sur le tableau (au pire il rouvre sans scroller : le tableau inclus n'a pas de position
  source), et que les deux colonnes de réglages tiennent sans défilement.
- [ ] **Aperçu HTML : le survol prend le bloc** (D82) : survoler un mot au milieu d'une
  phrase doit surligner **tout le paragraphe**, pas le mot ni le passage en gras.
- [ ] **Planche de palette** — `docs/palette.html` (ou le lien partagé) : juger **à l'œil**.
  La palette est une **grille à clarté fixe de 11 crans** (D79) : un même numéro = la même
  clarté pour les six couleurs. La couleur de charte **occupe** l'un de ces crans (D80) —
  rouge 700, capucine/poireau/bleu acier/mountbatten 500, moutarde 300 — badgé « charte ».
  À regarder en particulier :
  - le **fond « négatif » des tableaux d'un numéro rouge** est désormais *le* rouge de charte
    `#D31932` au lieu du `#C3112C` assombri : plus vif, texte blanc à Lc 79,7 ;
  - les crans clairs du **rouge** et de la **capucine** tirent au rose (sRGB n'a pas de rouge
    clair vif : la chroma y est rabotée jusqu'à −49 %), et les crans sombres de la **moutarde**
    sont olive plutôt que jaunes — même cause, en sens inverse ;
  - le **cran 400** ne porte aucun texte : c'est le croisement où ni le noir ni le blanc ne
    passent. Vérifier que sa présentation ne prête pas à confusion.
  Si un fond te paraît trop franc, fais pointer l'alias `--c-<nom>-clair` vers `-100` au lieu
  de `-200` dans `couleurs.css`, puis relance `python3 test/apca-check.py` **et**
  `python3 test/palette-html.py`.
- [ ] **Aperçu de l'éditeur de tableau** : il ne recalcule plus les teintes, il lit celles que
  le pipeline écrit dans `out/.szh-accent.css`. Donc à vérifier sur un tableau réel, dans un
  numéro **coloré** : les fonds « couleur » et « négatif » de l'éditeur doivent être
  **identiques** à ceux du PDF. C'est le seul moyen de confirmer que la dérive WCAG/APCA est
  bien éteinte. Repli documenté : un numéro jamais compilé montre les gris neutres.
- [ ] **Rendu du `.pptx`** (`profil: presentation`) : validé structurellement (OOXML, texte
  complet), jamais ouvert dans PowerPoint. À voir à l'œil sur un article réel. ⚠ Limite
  mesurée : les tableaux de D47 (HTML réinjecté) **disparaissent** du diaporama.
- [ ] **Libellés DE/IT des 6 types d'article** (D71) : à confronter aux **noms de rubriques
  réellement imprimés**. Cas à regarder : `tribune-libre` → « Freie Tribüne » / « Tribuna
  libera », et les deux en-têtes de groupe. ⚠ **Deux** tables à modifier ensemble :
  `LIBELLES_TYPES` (extension) et `LIBELLES` de `pipeline/filters/szh-maquette.lua`.
- [ ] **Relecture germanophone** — classeur prêt : `C:\Users\robin\Documents\SZH-traductions-a-relire.xlsx`
  (230 textes du cockpit + 29 menus + les types d'articles). L'audit mécanique est propre :
  0 `ß`, 0 placeholder divergent, parité FR/DE totale. ⚠ Ce classeur ne couvre **pas** les
  textes des scripts PowerShell (`szh-common.ps1`, dont les 4 nouveaux `openmd.*`) — ils sont
  aussi un premier jet.

## Reste technique

- [ ] **Bordures épaisses de la maquette en moutarde** : `--c-abstract-border` (3 px),
  `.szh-filet` (6 px) et les bords d'encadré gardent la couleur de marque brute, à Lc **30,1**
  — pile sur le plancher. Les filets de tableau, eux, sont passés au jeton `--c-annual-ui`
  (Lc 45). Si tu veux de la marge partout, c'est le même changement à faire sur ces trois
  règles ; c'est un choix esthétique, je ne l'ai pas pris.
- [ ] **Masquer la bascule d'aperçu** sur un dossier `profil: presentation` : le mode HTML est
  forcé (il n'y a pas de PDF), mais le bouton reste cliquable et semble ne rien faire.
  Repoussé volontairement : cela demande un nouveau texte traduit, à joindre au prochain lot.
- [ ] **Commande « Ouvrir le diaporama »** : rien n'ouvre un `.pptx` depuis le cockpit.
- [ ] **`profil:` dans le formulaire du numéro** : aujourd'hui à écrire à la main dans
  `ausgabe.yaml` (une ligne posée à la main survit au formulaire, c'est vérifié). Piège si un
  sélecteur est ajouté : le sérialiseur saute les valeurs vides, donc le choix « aucun
  document » (clé présente et vide) n'est pas exprimable en l'état.
- [ ] **`--slide-level`** : au défaut de pandoc, un article réel donne 5 diapositives ; en
  `--slide-level=2`, 16, sans perte de texte. Le levier est commenté à l'endroit exact du
  Makefile. Arbitrage d'usage à prendre.
- [ ] **Option XML DISM** au bootstrap (associations des nouveaux profils, D18) : non faite.
- [ ] **Extension résiduelle** : `csholmq.excel-to-markdown-table@1.4.0` est encore installée
  sur ce poste, plus sur les nouveaux. `codium --uninstall-extension csholmq.excel-to-markdown-table`.
- [ ] **Poste pilote** : checklist V1–V8 du §5 sur une machine vierge (celle-ci ne l'est plus).
- [ ] **D7** : retirer `fonts-noto` du rootfs. D73 a déjà rendu la maquette indépendante des
  polices du rootfs ; il ne reste que le gain de taille (plusieurs centaines de Mo).

## Fait le 2026-08-13

- **Release v2026.08.7** : cockpit 0.2.0, pack de langue DE, pipeline complet livré.
- **Poste installé** par `bootstrap.ps1` (toolkit, tâches planifiées, `.wslconfig`, extensions).
- **Décisions D37–D74 transcrites** dans `PLANIFICATION.md` (la dette allait plus loin que prévu),
  **D75** retrait de `csholmq`, **D76** palette APCA, **D77** lanceur bête, **D78** dispatch `profil:`.
- **Palette APCA** (D76) : module `pipeline/apca.py`, vérificateur `test/apca-check.py`
  (157 paires, 0 échec), planche générée `docs/palette.html`. Trois vraies fautes corrigées :
  texte annuel moutarde sous le seuil, son filet fin écrasé en quasi-noir, filet de tableau
  moutarde invisible sur fond zébré. L'éditeur de tableau ne recalcule plus les teintes.
- **Grille à clarté fixe de 11 crans** (D79, release v2026.08.9) : dispersion de clarté ramenée
  de 0,266 à 0,002 par cran. Puis la **charte intégrée dans la grille** (D80, v2026.08.10) :
  elle occupe le cran le plus proche de son Lc, calculé et non codé en dur.
- **Planche** enrichie : cran 400 présenté comme les autres, badge « charte » au-dessus de la
  case, liseré doublé, échantillons « Texte » (14 px) / « Titre » (19 px gras) à la taille que
  le seuil autorise, et verdict d'usage en **élément d'interface** par cran.
- **P6** : `open-md.ps1`, association `.md` en HKCU, dispatch `profil:` (6 routes vérifiées en
  build réel), aperçu ouvert au démarrage par le cockpit, `userdoc.md` réécrit.

# Todo Features

*(le lot palette est fait — voir « Planche de palette » ci-dessus pour la seule chose qui
reste : la juger à l'œil)*
