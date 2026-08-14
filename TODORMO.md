# Todo Robin (mis à jour le 2026-08-13, après la palette en grille et P6)

## Validations qui demandent un humain

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
