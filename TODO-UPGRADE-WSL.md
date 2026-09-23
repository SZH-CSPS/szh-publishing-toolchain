# TODO — correctifs de sécurité de la WSL sans dégeler la maquette

**Pour qui :** la personne qui reprendra l'entretien de l'image WSL. Elle connaît le dépôt,
mais n'a pas assisté à la discussion du 18.09.2026 d'où sort cette liste.

**Où en est-on :** le modèle est bon et ne doit pas changer. Ce qui manque n'est pas une
architecture, c'est une **cadence** : rien, dans le dépôt, ne déclenche une reconstruction au
bout d'un certain temps. Rien de ce qui suit n'est urgent ; rien de ce qui suit n'est
facultatif non plus si l'on veut que la flotte reçoive les correctifs Debian sans qu'une
personne y pense.

**Montée du 23.09.2026 :** les étapes 1 et 4 sont faites, une fois, à la main — voir « Ce qui a
été mesuré le 23.09.2026 » en fin de fichier. La cadence, elle, reste à poser (étapes 2 et 3).

---

## Ce qui est déjà en place, et pourquoi il ne faut pas y toucher

`image/Containerfile` bâtit une image **immuable** : elle part de `debian:13-slim`, installe
ce qu'il faut, et tout ce qui décide du rendu est épinglé — pandoc 3.5 en `.deb`, WeasyPrint
69.0 et ses douze dépendances transitives dans `image/requirements.txt`, veraPDF, les deux
modèles ONNX et le profil ICC vérifiés par sha256. Le résultat part en `.tar.gz`, et les
postes l'installent par `wsl --import`.

Dans ce modèle, **reconstruire *est* mettre à jour** : chaque `apt-get install` du build tire
la version corrigée du jour, pendant que les outils restent où on les a cloués. La séparation
« correctifs système automatiques / outils figés » que l'on cherche existe donc déjà — elle
est simplement manuelle.

**Ne jamais poser `unattended-upgrades` dans la distro.** Pas par principe : parce que
**Pango et HarfBuzz sont le moteur de mise en page de WeasyPrint**. Une montée silencieuse de
HarfBuzz change la césure et la coupure de ligne, donc la pagination. Appliquée
automatiquement, elle arriverait **à des dates différentes sur des postes différents** : deux
rédactrices compilent le même numéro et obtiennent deux PDF, sans que rien ne le dise.
`docs/MAINTENANCE.md:171` l'interdit déjà, et il a raison.

**La surface d'attaque réelle n'est pas celle qu'on croit.** L'image n'a ni systemd, ni sshd,
ni démon, ni port en écoute, et `image/wsl.conf` coupe même le PATH Windows
(`appendWindowsPath=false`). Le seul vecteur est **l'analyse de fichiers** — ghostscript,
Pillow, Pango, OpenCV — sur des manuscrits et des photos qui viennent de l'extérieur. C'est un
risque vrai, mais ce n'est pas celui que corrigerait un `apt upgrade` nocturne : c'est celui
que corrige une reconstruction régulière.

---

## Les trois trous, tous dans la cadence

### 1. Aucun déclencheur temporel

`.github/workflows/release.yml` ne part que sur un tag ou à la main, et le rootfs n'est rebâti
**que si `image/` a changé depuis la release précédente** (`git diff … -- image/`, étape
« Faut-il reconstruire le rootfs ? »). Or `image/` ne bouge presque jamais : au 18.09.2026,
son dernier changement date du **01.09.2026** (`c78304c`, le profil CMJN). Le déclencheur est
donc un **changement de code**, jamais le calendrier. Le « 2×/an » de
`docs/MAINTENANCE.md:84` est un geste humain que personne ne fera.

### 2. `apt-get upgrade` n'existe nulle part dans le build

`image/Containerfile` fait `apt-get update && apt-get install` (lignes 29 et 81), jamais
`upgrade`. Une reconstruction corrige donc les paquets **qu'elle installe**, pas ceux déjà
présents dans la base — libc, openssl, zlib. Le tag `debian:13-slim` flotte et amont le
republie régulièrement, si bien qu'une construction en CI part déjà d'une base récente ; il
reste l'écart entre la dernière publication amont et le jour du build. Quelques semaines, pour
une ligne à écrire.

### 3. Les épinglages pip ne reçoivent jamais de correctif

C'est le trou le plus concret des trois, et il n'a rien à voir avec Debian. `pillow==12.2.0`
dans `image/requirements.txt`, `pillow==12.3.0` dans `image/requirements-portraits.txt` : ces
versions ne bougeront que le jour où quelqu'un les changera. Or **Pillow est exactement ce qui
ouvre les photos d'autrices et d'auteurs** — le composant le plus exposé de l'image est aussi
celui qui est gelé le plus durement.

---

## Les étapes, dans l'ordre

### 1. `apt-get upgrade` au build — fait le 23.09.2026

Deux lignes, dans les deux étapes de `image/Containerfile` :
`apt-get update && apt-get upgrade -y && apt-get install …`. Aucun risque propre — cela ne
fait que rapprocher le build de ce que Debian sert le jour même. À faire en premier parce que
c'est le moins cher.

### 2. Un workflow mensuel de reconstruction

Un `schedule: cron` qui reconstruit le rootfs, le passe au banc, et **ne publie que si le
rendu n'a pas bougé**. C'est le cœur de la manœuvre : ce qui rend un correctif automatique
acceptable ici, ce n'est pas la confiance en Debian, c'est le banc.

⚠ **Lire l'étape 3 avant d'écrire ce workflow.** Le banc, aujourd'hui, ne prouve pas tout ce
qu'il faudrait.

### 3. Décider ce que la porte automatique doit prouver

**C'est l'étape qui demande une décision, pas du code.** Deux limites, mesurées :

- **La CI n'éprouve pas le rootfs.** `.github/workflows/ci.yml` installe pandoc, WeasyPrint et
  veraPDF **nativement sur le runner Ubuntu**, aux mêmes versions que `image/` mais pas dans
  l'image. Le rootfs, lui, n'est vérifié que par le `RUN pandoc --version | grep …` de fin de
  `Containerfile` : trois outils qui démarrent. **Personne ne compile jamais un PDF dans
  l'image qu'on livre.** Tant que c'est vrai, une reconstruction mensuelle publie une image
  que le banc n'a pas vue.
- **La comparaison PNG n'est pas automatisable en l'état.** `ci.yml` le dit lui-même (vers la
  ligne 295) : « jamais le rendu PNG (pas de pypdfium2 ici, et de toute façon un PNG se juge à
  l'œil) ». Les portes qui tournent — PDF/UA-1, corpus d'accessibilité, `polices-check.py`,
  légendes, glyphes, métriques du titre — attrapent beaucoup, mais **aucune ne voit une césure
  qui se déplace**, c'est-à-dire précisément ce qu'une montée de HarfBuzz provoque.

Trois issues, à trancher :

- faire tourner le banc **dans** l'image reconstruite (`docker run` sur le rootfs frais) et y
  ajouter pypdfium2 pour comparer les PNG page à page à ceux de la release précédente ;
- ou publier automatiquement sur les portes existantes seules, en acceptant qu'un glissement
  de pagination passe — et le rattraper à la compilation du numéro suivant ;
- ou ne rien publier automatiquement : le workflow mensuel **ouvre une issue** quand une
  reconstruction diffère, et un humain décide.

La troisième est la moins ambitieuse et la plus sûre ; la première est la bonne à terme.

### 4. Revoir les épinglages pip au même rythme — fait une fois le 23.09.2026

Refaire le `pip freeze` décrit en tête de `image/requirements.txt` et de
`image/requirements-portraits.txt`, vérifier le rendu, committer. C'est là que vivent les
failles de Pillow. Même cadence que la reconstruction, même porte.

### 5. Debian 14, vers 2028

Le seul geste structurel à long terme : `ARG DEBIAN_TAG=13-slim` → 14. Trixie est sortie en
août 2025 ; support standard environ trois ans, puis LTS. Une ligne, plus une passe de banc.
`docs/MAINTENANCE.md:85` porte déjà le contrôle annuel — il s'agit de ne pas le rater.

---

## Les pièges

**Le `.deb` de pandoc n'est pas ce qui gèle quoi que ce soit.** Installer pandoc par `dpkg`
n'empêche pas `apt` de monter le reste : cela veut seulement dire qu'aucun dépôt ne propose
pandoc, donc qu'apt n'y touchera pas. Ce qui gèle vraiment la chaîne, ce sont les venvs et les
sha256. Ne pas bâtir une décision sur l'idée que le `.deb` protège.

**« Deux reconstructions donnent le même rendu » n'est vrai qu'à couche Debian égale.**
`docs/MAINTENANCE.md` le promet, et c'est exact pour les composants épinglés ; la couche
Debian, elle, avance à chaque build. Reconstruire tous les mois, c'est donc **choisir** de la
faire avancer plus souvent — d'où l'exigence du banc. Les deux décisions vont ensemble et ne
se prennent pas séparément.

**Les polices ne sont pas dans le rootfs.** `docs/MAINTENANCE.md` le dit : ce que
`pipeline/fonts/` ne couvre pas, fontconfig le comble avec ce qu'il trouve sur la machine, et
le PDF dépend alors de l'image. Une montée de `fonts-noto` ou de fontconfig peut donc changer
un rendu sans qu'aucun pin ait bougé. `test/polices-check.py` garde cette route — il doit
faire partie de la porte du workflow mensuel.

**Un poste bricolé ne se répare pas, il se réimporte.** Si quelqu'un finit par lancer un
`apt install` dans la distro pour corriger une faille dans l'urgence, le poste a divergé.
`docs/MAINTENANCE.md:143` donne la manœuvre : `wsl --unregister` puis réimport. Aucune donnée
de revue ne vit dans la distro, il n'y a rien à sauver avant.

**Le rootfs n'est pas retéléchargé si `image/` n'a pas changé.** `release.yml` réutilise
l'asset de la release précédente et recopie son entrée dans `manifest.json`. Un workflow
mensuel qui reconstruit sans changer `image/` doit donc forcer explicitement, sans quoi il
republiera l'ancien.

---

## Décisions en attente

- [ ] **Publier automatiquement, ou ouvrir une issue ?** (étape 3) — c'est la seule décision
  qui engage : elle dit si la flotte reçoit un correctif sans qu'un humain le regarde.
- [ ] **Faire tourner le banc dans le rootfs** plutôt qu'avec des outils natifs sur le
  runner : plus lent, mais c'est la seule façon d'éprouver ce qu'on livre vraiment.
- [ ] **Ajouter pypdfium2 à la CI** pour comparer les PNG d'une release à l'autre, ou assumer
  que le glissement de pagination se voit à la compilation du numéro suivant.
- [ ] **Quelle cadence ?** Mensuelle est le réflexe ; trimestrielle suffirait peut-être, vu
  l'absence de service exposé. À décider en connaissant le coût de l'étape 3.

---

---

## Ce qui a été mesuré le 23.09.2026

Banc complet (`test/build-render.sh`) rejoué dans la distro sous chaque combinaison d'outils,
PNG comparés pixel à pixel, onze Word réels du lot A réimportés sous chaque pandoc.

- **WeasyPrint 69.0 → 70.0.** Correctif de sécurité (CVE-2026-55073 : rendu EPS et filtrage
  des URL). Deux conséquences.
  - Il balise tout `<svg>` inline en `/Figure` et exige un `<title>` : le filigrane et les
    flèches du hero faisaient tomber PDF/UA-1 sur **chaque** article. Ils sont devenus des
    fonds CSS (`print.css`, `.szh-book` et `.szh-arrow`), identiques au pixel près sous 69.
  - **Il coupe les mots quatre fois plus souvent** : 25 → 104 césures sur le banc, aucune
    page de plus ou de moins, règle L4 du français respectée partout. C'est son moteur de
    coupure de ligne (#2614, #2803), pas pyphen, mesuré en isolant les deux. Un numéro
    recompilé change donc de composition ; le dictionnaire allemand de pyphen propose aussi
    des coupures fausses que 69 n'atteignait presque jamais (« Seite-numbrüche »).
  - Réglé par `p, li { hyphenate-limit-zone: 10% }` dans `print.css`, mesuré sur les huit
    articles publiés de `test/composition/` : sans lui, neuf suites de quatre lignes coupées
    ou plus et huit coupures en bas de page ; avec, aucune, et le texte reste un peu plus
    serré que sous 69. Le banc rapide, trop court, donnait 5 % pour suffisant.
  - Les tableaux à cellules fusionnées (`rowspan`, `colspan`) échouaient à PDF/UA sous 69
    (deux articles publiés du corpus) ; ils passent sous 70.
- **libharfbuzz-subset0** ajouté : WeasyPrint 70 découpe les polices avec lui. Pixel pour
  pixel identique au découpage fontTools, sans les avertissements.
- **pandoc 3.5 → 3.7.0.2, et pas plus loin.** 3.7.0.2 lit les onze Word exactement comme 3.5
  (seul change l'espacement des puces, `-   ` → `- `). À partir de 3.8, le contenu d'une
  zone de texte passe avant le paragraphe qui l'ancre : deux paragraphes s'inversent et le
  style de titre du paragraphe d'ancrage se perd (`2-dense`, `2-grappes`) ; les formes
  dessinées deviennent des images (`1bis`, `4_La méthode Flip Flap`). 19 manuscrits réels sur
  58 ont des zones de texte. Côté compilation, 3.11 est déjà prête : `print.css` pose
  lui-même le `code { white-space: pre-wrap }` que pandoc ne fournit plus depuis 3.9, et vise
  `h2.szh-rubrique-titre` depuis que 3.10 recopie la classe du titre sur la `<section>`.
  Restent quatre tests de `test/filtres-pandoc.test.js` écrits sur la forme exacte du HTML
  des rubriques, qui tombent sous 3.11 (mesuré) et donc dès 3.10.
- **Venvs** : `pip freeze` refait pour les deux. Portraits : sortie identique au pixel près sur
  deux photos (avec et sans visage).
- **Inchangés, déjà à jour** : Vale 3.22.0, veraPDF 1.30.2, Debian `13-slim`. **Gardés
  volontairement** : les modèles ONNX et le profil ICC.
- **Actions GitHub** montées de majeure (checkout 7, cache 6, setup-node 7, setup-java 6,
  upload-artifact 7). Leurs ruptures ne portent que sur les runners auto-hébergés et sur le
  cache automatique de setup-node, que ce dépôt n'active pas (aucun `packageManager`).

*Dernière mise à jour : 23.09.2026, après la montée de WeasyPrint 70 et de pandoc 3.7.0.2. À reprendre chaque fois qu'une de ces lignes bouge.*
