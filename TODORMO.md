# Todo Robin (mis à jour le 2026-08-13, après la palette APCA et P6)

## Validations qui demandent un humain

- [ ] **Scénarios GUI du lot M** : redémarrer VSCodium, puis vérifier l'aperçu HTML cliquable,
  le formulaire de métadonnées d'article, le menu de réglages, la bascule de langue.
- [ ] **Double-clic sur un `.md`** (P6) : clic droit → Ouvrir avec → **« Revue SZH »** (pas
  « VSCodium » !) → cocher « Toujours ». Vérifier que la revue s'ouvre complète et que
  l'aperçu apparaît tout seul. Deux points à regarder de près :
  - le **libellé affiché** dans la boîte « Ouvrir avec » (il dépend de `FriendlyAppName` ;
    non vérifiable sans écrire dans le vrai registre) ;
  - le comportement quand **une autre revue est déjà ouverte** (nouvelle fenêtre ou réutilisation).
- [ ] **Collage de tableau Excel** (`Maj+Alt+V`, D75) : la conversion est testée headless
  (7 cas), le geste ne l'est pas.
- [ ] **Planche de palette** : ouvrir `docs/palette.html` et juger **à l'œil** les nouvelles
  teintes. Les fonds « couleur » des tableaux sont nettement plus colorés qu'avant (le fondu
  à 18 % gaspillait une douzaine de points de contraste) : moutarde, poireau et bleu acier
  changent beaucoup. Si un fond te paraît trop franc, il suffit de faire pointer l'alias
  `--c-<nom>-clair` vers `-50` au lieu de `-100` dans `couleurs.css`, puis de relancer
  `python3 test/apca-check.py` et `python3 test/palette-html.py`.
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
- **Palette APCA** : module `pipeline/apca.py`, échelle 50→900 des 6 couleurs, vérificateur
  `test/apca-check.py` (127 paires, 0 échec), planche `docs/palette.html`. Deux vraies fautes
  corrigées : texte annuel moutarde sous le seuil, et son filet fin écrasé en quasi-noir.
  L'éditeur de tableau ne recalcule plus les teintes : il lit celles du pipeline.
- **P6** : `open-md.ps1`, association `.md` en HKCU, dispatch `profil:` (6 routes vérifiées en
  build réel), aperçu ouvert au démarrage par le cockpit, `userdoc.md` réécrit.

# Todo Features

*(le lot palette est fait — voir « Planche de palette » ci-dessus pour la seule chose qui
reste : la juger à l'œil)*
