// Contrôles de l'import Word : les trois façons qu'il avait de perdre un article sans
// le dire.
//
//   node --test "test/js/*.test.js"
//
// 1. Deux Word aux titres proches recevaient le même slug une fois borné à 39 caractères,
//    et le second était « déjà converti (ignoré) » — compté hors des échecs, sortie 0.
// 2. Sans fiche <slug>.meta.yaml, l'article compilait avec un titre de document vide, le
//    PDF s'annonçant tout de même conforme PDF/UA.
// 3. Un tableau sans rangée d'en-tête gras sortait sans un seul <th>, sans un mot.
//
// Et le piège du correctif 1 : suffixer sans distinguer remplacerait la perte silencieuse
// par un doublon silencieux. Le champ `source:` de la fiche sépare les deux cas.
//
// Deux familles de contrôle, comme contrats.test.js : l'unité, sur slugifierArticleUnique ;
// et la cohérence, où le shell du Makefile doit reprendre les mêmes constantes que le JS.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const RACINE = path.resolve(__dirname, '..', '..');
const COCKPIT = path.join(RACINE, 'vscodium-extension', 'szh-cockpit');
const slug = require(path.join(COCKPIT, 'lib', 'slug.js'));

const lire = (...p) => fs.readFileSync(path.join(RACINE, ...p), 'utf8');

const MAX = slug.LONGUEUR_MAX_SLUG_ARTICLE;

// Les trois fichiers mesurés sur le corpus de l'éditeur : le tiret est un demi-cadratin.
const TEIL = [
  'Inklusive Bildung in der Sekundarstufe I – Teil 1.docx',
  'Inklusive Bildung in der Sekundarstufe I – Teil 2.docx',
  'Inklusive Bildung in der Sekundarstufe I – Teil 3.docx'
];

// ---- Désambiguïsation des slugs ----

test('slug d’article : les trois parties d’un même dossier ne se marchent plus dessus', () => {
  // Le défaut, tel qu'il était : la borne de 39 caractères écrase les trois en un.
  const bruts = TEIL.map(slug.slugifierArticle);
  assert.strictEqual(new Set(bruts).size, 1,
    'la collision mesurée n’existe plus — ce contrôle n’a plus de sujet');

  const pris = [];
  for (const nom of TEIL) { pris.push(slug.slugifierArticleUnique(nom, pris)); }
  assert.deepStrictEqual(pris, [
    'inklusive-bildung-in-der-sekundarstufe',
    'inklusive-bildung-in-der-sekundarstuf-2',
    'inklusive-bildung-in-der-sekundarstuf-3'
  ]);
});

test('slug d’article : un nom libre est rendu tel quel, sans suffixe', () => {
  assert.strictEqual(slug.slugifierArticleUnique('4_Titre.docx', []), '04-titre');
  assert.strictEqual(slug.slugifierArticleUnique('4_Titre.docx', ['09-autre']), '04-titre');
  // Le suffixe ne monte que d'un cran à la fois, et saute les noms déjà pris.
  assert.strictEqual(slug.slugifierArticleUnique('4_Titre.docx',
    ['04-titre', '04-titre-2']), '04-titre-3');
});

test('slug d’article : la borne de 39 caractères tient, suffixe compris', () => {
  // Des noms de longueurs variées, dont ceux qui tombent pile sur la borne.
  const noms = [];
  for (let n = 1; n <= 60; n++) {
    noms.push('9_' + ('mot' + n + ' ').repeat(Math.ceil(n / 3)) + '.docx');
    noms.push('9_' + 'a'.repeat(n) + ' fin.docx');
  }
  for (const nom of noms) {
    const base = slug.slugifierArticle(nom);
    const pris = [base];
    for (let n = 2; n <= 12; n++) {
      const s = slug.slugifierArticleUnique(nom, pris);
      assert.ok(s, 'slug abandonné trop tôt pour ' + nom);
      assert.ok(s.length <= MAX, 'borne dépassée : ' + s + ' (' + s.length + ')');
      assert.ok(!/--/.test(s), 'tiret doublé : ' + s);
      assert.ok(!/^-|-$/.test(s), 'tiret orphelin : ' + s);
      assert.ok(pris.indexOf(s) === -1, 'slug déjà pris rendu une seconde fois : ' + s);
      pris.push(s);
    }
  }
});

test('slug d’article : au-delà de 99 homonymes, on refuse plutôt que d’inventer', () => {
  const pris = [];
  let s = slug.slugifierArticleUnique('Titre.docx', pris);
  while (s) { pris.push(s); s = slug.slugifierArticleUnique('Titre.docx', pris); }
  assert.strictEqual(pris.length, slug.MAX_HOMONYMES,
    'le nombre d’homonymes servis ne suit pas MAX_HOMONYMES');
  assert.strictEqual(slug.slugifierArticleUnique('Titre.docx', pris), null);
});

// ---- Le shell du Makefile doit dire la même chose que le JS ----

test('Makefile : la désambiguïsation du shell reprend les constantes de slug.js', () => {
  const mk = lire('pipeline', 'Makefile');
  // La boucle cherche un slug libre au lieu d'abandonner sur « déjà converti ».
  // ⚠ Le dossier des unités est une VARIABLE depuis que l'import sert aussi aux chapitres
  //   d'un livre ($(UNITES_DIR), qui vaut « articles » par défaut et « chapitres » sous
  //   livre.mk). Le contrat porte sur la BOUCLE, pas sur le nom du dossier : c'est elle qui
  //   cherche un slug libre au lieu d'abandonner, et c'est elle qui doit rester.
  assert.match(mk, /while \[ -e "\$\(UNITES_DIR\)\/\$\$slug\/\$\$slug\.md" \]; do/,
    'la boucle de désambiguïsation a disparu du Makefile');
  assert.ok(mk.indexOf('déjà converti (ignoré)') === -1,
    'la branche d’abandon silencieux est de retour');
  // Mêmes nombres des deux côtés : la borne et le plafond d'homonymes.
  assert.ok(mk.indexOf('if [ $$n -gt ' + slug.MAX_HOMONYMES + ' ]') !== -1,
    'le plafond d’homonymes du shell ne suit pas MAX_HOMONYMES');
  assert.ok(mk.indexOf('$$((' + MAX + ' - $${#suf}))') !== -1,
    'la place réservée au suffixe ne suit pas LONGUEUR_MAX_SLUG_ARTICLE');
  assert.ok(mk.indexOf('suf="-$$n"') !== -1, 'le suffixe du shell n’est plus « -n »');
  // Coupe au caractère près, puis tirets de fin retirés : pas de « --2 ».
  const coupe = mk.split('\n').filter((l) => l.indexOf('tronc=$$(printf') !== -1)[0] || '';
  assert.ok(coupe.indexOf('"$${base:0:') !== -1, 'la coupe du shell ne part plus du slug de base');
  assert.ok(coupe.indexOf("sed -E 's/-+$$//'") !== -1,
    'la coupe du shell ne retire plus les tirets de fin');
});

test('Makefile : un Word resté sur le carreau fait échouer l’import, et all le propage', () => {
  const mk = lire('pipeline', 'Makefile');
  // Le « - » devant l'appel à import avalait le code de retour.
  assert.ok(mk.indexOf('-@$(MAKE) --no-print-directory -f $(THIS) import') === -1,
    'l’appel à import est de nouveau précédé d’un « - » : l’échec est avalé');
  assert.match(mk, /^\t@\$\(MAKE\) --no-print-directory -f \$\(THIS\) import$/m,
    'la cible all n’appelle plus import');
  // La recette sort non nulle dès qu'un fichier n'a pas été importé.
  assert.match(mk, /if \[ \$\$rate -ne 0 \]; then/,
    'la recette import ne teste plus le compte d’échecs');
  assert.ok(/\$\$rate fichier\(s\) Word/.test(mk),
    'le bilan ne dit plus au rédacteur ce qui est resté en attente');
});

// ---- Fiche obligatoire ----

test('Makefile : un article sans titre de fiche ne se compile plus', () => {
  const mk = lire('pipeline', 'Makefile');
  assert.match(mk, /^define exiger_titre$/m, 'le contrôle de titre a disparu');
  // Les deux chemins d'entrée : la compilation du numéro, et le make d'un seul article
  // que lance le cockpit (il court-circuite verifie-dossier).
  assert.ok(mk.indexOf('$(call exiger_titre,$(SLUGS))') !== -1,
    'verifie-dossier ne contrôle pas les titres');
  assert.ok(mk.indexOf('$(call exiger_titre,$(notdir $*))') !== -1,
    'la cible HTML ne contrôle pas le titre de son article');
  // La fiche étant exigée, --metadata-file n'est plus conditionnel.
  assert.ok(mk.indexOf('--metadata-file="$$slug.meta.yaml"') !== -1,
    'la fiche n’est plus passée à pandoc');
  // Le message doit nommer le geste de correction, et exister en allemand.
  const bloc = mk.slice(mk.indexOf('define exiger_titre'), mk.indexOf('\nendef'));
  assert.match(bloc, /Métadonnées des articles/, 'le message ne dit pas où corriger');
  assert.match(bloc, /\[de\] /, 'le message n’existe qu’en français');
  assert.match(bloc, /exit 1/, 'le contrôle n’arrête pas la compilation');
});

test('import-docx.sh : des métadonnées illisibles ne passent plus pour un import réussi', () => {
  const sh = lire('pipeline', 'import-docx.sh');
  assert.ok(!/docx-meta\.py"[^\n]*\|\| true/.test(sh),
    'le « || true » sur docx-meta.py est de retour : l’article s’importerait sans fiche');
  assert.match(sh, /if ! STATS="\$\(python3 "\$PIPE\/docx-meta\.py"/,
    'l’échec de docx-meta.py n’est plus testé');
  assert.match(sh, /export SZH_SLUG="\$SLUG"/,
    'le slug n’est plus annoncé aux pré-passes, qui ne peuvent plus nommer l’article');
  // Le message d'échec vaut pour un rédacteur, en deux langues.
  const ligne = sh.split('\n').filter((l) => l.indexOf('signaler "[import]') !== -1)[0];
  assert.ok(ligne, 'aucun message d’échec adressé au rédacteur');
  assert.match(ligne, /\[de\] /, 'le message d’échec n’existe qu’en français');
});

// ---- Tableau sans en-tête : un avertissement, pas un blocage ----

test('docx-tables.py : un tableau sans en-tête avertit sans faire échouer l’import', () => {
  const py = lire('pipeline', 'docx-tables.py');
  // Préfixe et code stables : c'est par eux que l'interface reconnaîtra la ligne.
  assert.match(py, /PREFIXE_AVERT = '\[import-avertissement\]'/,
    'le préfixe des avertissements a changé — l’interface ne les retrouvera plus');
  assert.match(py, /'tableau-sans-entete'/, 'le code de l’avertissement a changé');
  // stderr et articles-word/.import.log, les deux.
  assert.match(py, /print\(ligne, file=sys\.stderr\)/, 'l’avertissement ne va plus sur stderr');
  assert.match(py, /os\.getenv\('SZH_IMPORT_LOG'\)/, 'l’avertissement n’entre plus au journal');
  // Un rédacteur doit pouvoir lire la ligne, en français et en allemand.
  assert.match(py, /'\[de\] '/, 'l’avertissement n’existe qu’en français');
  // L'article et le tableau sont nommés.
  assert.match(py, /article « %s »/, 'l’avertissement ne nomme plus l’article');
  assert.match(py, /'tableau %d'/, 'l’avertissement ne nomme plus le tableau');
  // Et surtout : rien de tout cela ne change le code de sortie. Les deux seuls retours
  // non nuls restent la lecture impossible du .docx et l'appel mal formé.
  assert.strictEqual((py.match(/^ *return 1$/gm) || []).length, 1,
    'un nouveau chemin d’échec est apparu dans docx-tables.py');
  assert.strictEqual((py.match(/^ *return 2$/gm) || []).length, 1,
    'un nouveau chemin d’échec est apparu dans docx-tables.py');
  // La ligne de statistiques porte le compte, comme le reste.
  assert.match(py, /sans en-tête' % len\(plats\)/,
    'le compte de tableaux plats a quitté la ligne de statistiques');
});

// ---- Redépôt du même Word contre homonymie de deux Word différents ----

test('Makefile : le même Word redéposé ne fabrique pas un second article', () => {
  const mk = lire('pipeline', 'Makefile');
  // La décision se prend sur le champ `source:` des fiches, avant toute désambiguïsation.
  const iSource = mk.indexOf("sed -n 's/^source:[[:space:]]*//p'");
  const iBoucle = mk.indexOf('while [ -e "$(UNITES_DIR)/$$slug/$$slug.md" ]; do');
  assert.ok(iSource !== -1, 'la lecture du champ source: a disparu du Makefile');
  assert.ok(iSource < iBoucle,
    'le redépôt est cherché après le suffixe : un doublon serait déjà créé');
  // Trois issues nommées, chacune avec son code stable.
  assert.ok(mk.indexOf('word-redepose') !== -1, 'le code du redépôt a changé');
  assert.ok(mk.indexOf('origine-inconnue') !== -1,
    'le cas « fiche sans source: » n’est plus traité — il rouvre la porte au doublon');
  // Un redépôt ne crée rien : il continue la boucle sans appeler import-docx.sh.
  const bloc = mk.slice(mk.indexOf('venu_de=""'), iBoucle);
  assert.strictEqual((bloc.match(/redepot=\$\$\(\(redepot\+1\)\); continue;/g) || []).length, 2,
    'les deux issues ne comptent pas leur redépôt, ou ne sortent pas de la boucle');
  assert.ok(bloc.indexOf('import-docx.sh') === -1,
    'un redépôt lance encore la conversion');
  // Son propre mot au bilan : ni converti, ni renommé, ni échec.
  assert.match(mk, /\$\$redepot redéposé\(s\)/, 'le redépôt n’a pas sa place au bilan');
  assert.match(mk, /if \[ \$\$redepot -ne 0 \]; then/,
    'le bilan ne dit pas au rédacteur que sa correction attend');
});

// ---- Les deux champs que docx-meta.py est seul à écrire ----

test('docx-meta.py : la fiche reçoit la langue de l’article et son Word d’origine', () => {
  const py = lire('pipeline', 'docx-meta.py');
  // Écrits dans le dict de la fiche…
  assert.match(py, /'lang': langue if langue in LANGUES_META else '',/,
    'le champ lang ne part plus dans la fiche');
  assert.match(py, /'source': os\.path\.basename\(chemin_docx\),/,
    'le champ source ne part plus dans la fiche');
  // …et sérialisés, dans l'ordre du cockpit : type, lang, source, doi.
  const ser = py.slice(py.indexOf('def serialiser_meta'), py.indexOf('# ---', py.indexOf('def serialiser_meta')));
  const rang = (t) => ser.indexOf(t);
  assert.ok(rang("'type: '") < rang("'lang: '"), 'lang passe avant type');
  assert.ok(rang("'lang: '") < rang("'source: '"), 'source passe avant lang');
  assert.ok(rang("'source: '") < rang("'doi: '"), 'doi passe avant source');
  // Jeton nu pour lang (szh-maquette.lua relit la ligne hors pandoc), valeur citée pour
  // source (le nom d'un Word porte des espaces et des apostrophes).
  assert.match(ser, /lignes\.append\('lang: ' \+ meta\['lang'\]\)/, 'lang est cité');
  assert.match(ser, /lignes\.append\('source: ' \+ citer\(/, 'source n’est pas cité');
});

test('docx-meta.py : une langue devinée est écrite, mais elle est dite', () => {
  const py = lire('pipeline', 'docx-meta.py');
  // Écrite dans tous les cas : un champ vide bloquerait la composition d'un article dont
  // la langue diffère de celle du numéro. Aucune condition sur langue_source à l'écriture.
  assert.ok(py.indexOf("'lang': langue if langue in LANGUES_META else ''") !== -1);
  // Et signalée quand elle vient d'une déduction, jamais sur une fiche conservée.
  assert.match(py, /if meta_ecrit and langue_source in \('contenu', 'defaut'\):/,
    'la provenance d’une langue devinée n’est plus signalée');
  assert.ok(py.indexOf("'langue-deduite'") !== -1, 'le code de l’avertissement a changé');
  // Même mécanique d'avertissement que docx-tables.py : un seul motif pour l'interface.
  assert.match(py, /PREFIXE_AVERT = '\[import-avertissement\]'/);
  assert.match(py, /os\.getenv\('SZH_IMPORT_LOG'\)/);
  assert.match(py, /'\[de\] '/, 'l’avertissement n’existe qu’en français');
});

// ---- Le tableau des auteurs : ce qui l'a fait tomber en silence ----
//
// Un seul « ém. » inconnu coûtait les quatre autrices et auteurs d'un article, sans un
// mot : la cellule refusée faisait tomber le tableau entier, la fiche se rabattait sur la
// byline (des noms, rien d'autre), et rien ne le disait. Sur les 486 Word du corpus de
// mise au point, ces règles font passer les tableaux lus de 404 à 421, sans régression.

test('docx-meta.py : un titre académique composé ne fait plus tomber le tableau', () => {
  const py = lire('pipeline', 'docx-meta.py');
  // Le test d'un jeton vit en UN endroit, et il découpe le jeton : « Univ.-Prof. »,
  // « Dipl.-Psych. », « Dr.in ». Allonger la liste à chaque graphie ne tenait pas.
  assert.match(py, /def _est_titre_academique\(jeton\):/,
    'le test d’un titre académique n’est plus centralisé');
  assert.match(py, /re\.split\(r'\[\.\\-\/\]', jeton/,
    'un titre composé (« Dipl.-Psych. ») n’est plus découpé en fragments');
  assert.match(py, /SUFFIXES_TITRE = \{'in', 'innen'\}/,
    '« Dr.in » redeviendrait un prénom, et deux portraits se battraient pour un slug');
  // La chaîne d'honneur « Dr. Dr. et Prof. h. c. » : le liant tombe entre deux titres.
  assert.match(py, /LIANTS_TITRE = /, 'les liants d’une chaîne d’honneur ne tombent plus');
  // Les deux bouts passent par la même fonction, jamais par un test réécrit sur place.
  assert.strictEqual((py.match(/_oter_titres\(/g) || []).length, 4,
    'l’épluchage des titres s’est remis à vivre en plusieurs exemplaires');
  // Un titre écrit lettre par lettre (« , M. A. ») ne se lit pas jeton par jeton.
  assert.match(py, /colle = ''\.join\(queue\)\.replace\('\.', ''\)\.lower\(\)/,
    '« Lisa Neumann, M. A. » garderait son titre dans le nom');
  // « Prof. Dr. » seul sur sa ligne : le nom est à la suivante. Uniquement dans ce cas —
  // chercher un nom plus loin dans n'importe quelle cellule ferait passer un encadré de
  // contenu pour un bloc auteurs.
  assert.match(py, /if not premier and len\(lignes\) > 1 and not _sans_titres_academiques\(/,
    'une cellule dont la 1re ligne ne porte que des titres reste illisible');
});

test('docx-meta.py : un encadré de fin ne masque plus le bloc auteurs', () => {
  const py = lire('pipeline', 'docx-meta.py');
  const boucle = py.slice(py.indexOf('for k in range(len(tables) - 1, -1, -1):'),
    py.indexOf('premier_tbl_consomme = idx_bloc') + 40);
  assert.ok(boucle, 'la boucle des tableaux de fin a disparu');
  // Le refus d'un tableau ne clôt plus la recherche : sinon un encadré de contenu placé
  // après le bloc auteurs le rendait invisible — et l'article partait avec deux auteurs
  // sur cinq, sans que la ligne de statistiques n'ait l'air anormale.
  assert.match(boucle, /if not ok:[\s\S]*?continue/,
    'un tableau refusé arrête à nouveau la remontée : le bloc auteurs derrière est perdu');
  assert.ok(boucle.indexOf('if not ok:\n            break') === -1,
    'la boucle s’arrête encore au premier tableau refusé');
  // Le garde-fou de position reste le seul arrêt : jamais un bloc auteurs si tôt.
  assert.match(boucle, /if idx_bloc \/ nblocs < 0\.4:[^\n]*\n *break/,
    'la remontée n’est plus bornée au dernier tiers du document');
});

test('docx-meta.py : un tableau d’auteurs non lu, et un crédit emporté, se disent', () => {
  const py = lire('pipeline', 'docx-meta.py');
  // C'est l'avertissement manquant qui a laissé passer les cas pendant tout un corpus :
  // la fiche n'avait que des noms, l'export partait sans affiliation ni e-mail, et le
  // rédacteur n'avait rien à l'écran.
  assert.ok(py.indexOf("'tableau-auteurs-non-lu'") !== -1,
    'le repli sur la byline est redevenu muet');
  assert.match(py, /if refuses_parlants and not auteurs_table:/,
    'le repli ne se dit plus, ou se dit quand le tableau a été lu');
  // Un e-mail dans un tableau refusé : c'est ce signal, et lui seul, qui distingue un
  // bloc auteurs illisible d'un encadré de contenu qu'on a eu raison de laisser.
  assert.match(py, /RE_EMAIL\.search\(' '\.join\(texte_paragraphe\(p\)/,
    'le tri entre bloc auteurs illisible et encadré de contenu a disparu');
  // Le crédit du portrait n'a pas de champ dans le schéma : il part avec le tableau, donc
  // il se dit. Règle d'or — ne jamais perdre de texte en silence.
  assert.match(py, /RE_CREDIT_PHOTO = re\.compile\(/,
    'un crédit sous le portrait fait de nouveau tomber le tableau entier');
  assert.ok(py.indexOf("'credit-photo-non-repris'") !== -1,
    'le crédit emporté avec le tableau disparaît sans un mot');
  // Les deux phrases existent dans les deux langues, comme tout le reste du journal.
  const bloc = py.slice(py.indexOf("'tableau-auteurs-non-lu'"),
    py.indexOf("'biblio-references-restees'"));
  assert.strictEqual((bloc.match(/article « %s »/g) || []).length, 2,
    'un des deux avertissements ne nomme plus l’article');
  assert.ok(bloc.indexOf('Autorinnen und Autoren') !== -1,
    'les nouveaux avertissements n’existent qu’en français');
});

test('la fiche garde son champ source après un passage par le formulaire', () => {
  // `source:` est une clé de première classe de lib/yaml.js. Ce contrôle vérifie qu'elle
  // survit à un aller-retour du sérialiseur — sinon la détection du redépôt s'éteindrait
  // au premier enregistrement. Le trajet complet par le formulaire, où la carte ne porte
  // pas le champ et où ecrireCartesArticles() le relit du fichier, est dans
  // test/js/licence.test.js.
  const yaml = require(path.join(COCKPIT, 'lib', 'yaml.js'));
  const nom = 'Inklusive Bildung in der Sekundarstufe I – Teil 1.docx';
  const src = ['type: article', 'lang: de', 'source: "' + nom + '"',
    'title:', '  de: "Ein Titel"', ''].join('\n');
  const relu = yaml.analyserMeta(src);
  const sortie = yaml.serialiserMeta(relu);
  assert.ok(sortie.indexOf('source: "' + nom + '"') !== -1,
    'le champ source ne survit pas à un enregistrement du formulaire');
  assert.strictEqual(yaml.serialiserMeta(yaml.analyserMeta(sortie)), sortie,
    'le champ source se déplace à chaque enregistrement');
  assert.strictEqual(relu.lang, 'de');
});
