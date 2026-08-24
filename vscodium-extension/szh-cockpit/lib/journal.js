// Ce que la chaîne de compilation a relevé, relu dans son journal.
//
// La chaîne détecte beaucoup — appel de citation sans référence, tableau sans en-tête,
// titre vide dans la langue de l'article, PDF non conforme PDF/UA, image manquante — et
// tout partait sur la sortie d'erreur d'un terminal que rien n'ouvre. Le journal est
// désormais écrit dans un fichier (voir vscodium-user/tasks.json, `tee`), et ce module le
// traduit en constats que l'interface pose sur des cartes.
//
// Trois règles tiennent tout le module :
//
//  1. Une seule langue à l'écran, celle du cockpit. Le pipeline, faute de mécanisme de
//     locale en shell et en Python, met ses deux langues sur la même ligne (l'allemande
//     introduite par « [de] ») ; quelques lignes anciennes n'en portent qu'une. Quand les
//     deux moitiés existent, on garde celle qu'on demande ; quand une seule existe, on
//     passe par une clé d'i18n et la prose du pipeline devient un repli.
//
//  1 bis. Et c'est un CODE, jamais une phrase, qui décide de tout. Ce module a longtemps
//     reconnu la prose de szh-maquette.lua et de szh-citations.lua, dans les deux langues,
//     pour pouvoir la redire : une reformulation innocente cassait la remontée, en
//     silence. Les filtres écrivent désormais le format à codes, et la seule prose encore
//     reconnue ici est celle d'outils qui ne sont pas de la maison (pandoc, WeasyPrint) ou
//     du Makefile — un repli, nommé comme tel à chaque endroit où il subsiste.
//
//  2. Le silence par défaut. Une ligne non reconnue est jetée, sauf si elle porte « ⚠ »
//     ou « ✗ » sous un préfixe de la maison : un nouvel avertissement du pipeline
//     apparaîtra donc à l'écran même sans règle ici, mais le bruit d'outillage
//     (« Ignored `overflow-x: auto`, unknown property ») n'y arrive jamais. Un message qui
//     nomme une propriété CSS ou un chemin de venv n'est pas un message pour une
//     rédactrice.
//
//  3. Trois tons, et ils ne mentent pas. `danger` = la compilation s'est arrêtée ou le
//     document produit n'est pas publiable ; `attention` = c'est sorti, mais il faut
//     regarder avant de publier ; `info` = un chiffre pour situer. Un avertissement non
//     bloquant ne doit jamais se présenter comme un échec — c'est exactement le piège que
//     lireRapportImport() a longtemps tendu en classant « danger » toute ligne portant ⚠.
//
// Une exception, en bas de fichier : le réimport d'un article corrigé est le seul maillon
// que le cockpit lance lui-même, et il répond par une ligne JSON. constatsReimport() la
// traduit en constats de la même forme, avec les MÊMES tables de tons et de libellés —
// c'est tout l'intérêt qu'elle vive ici.
//
// Un constat vaut :
//   { source, code, ton, cle, args, slug, brut }
// où `cle` est une clé d'i18n (vide si seule la prose du pipeline est disponible), `args`
// ses substitutions, `slug` l'article concerné quand on le sait, et `brut` la phrase du
// pipeline dans la langue demandée — repli d'affichage, et rien de plus.
'use strict';

const { TL } = require('./i18n');

// Séparateur des clés de dédoublonnage : un caractère qu'aucune phrase du journal ne
// contient, pour que deux constats voisins ne se confondent pas.
const SEP = '\u0001';

// ---- Le format à codes ---------------------------------------------------------
//
//   [<source>-<ton>] <code> | <champ> | … | <phrase fr> | [de] <Satz de>
//
// C'est le seul format que le pipeline pose exprès pour cette interface, et il porte tout
// ce dont elle a besoin : la SOURCE (la famille de contrôle, telle que la vue la nomme),
// le TON, un CODE stable d'où vient la clé d'i18n, des champs NOMMÉS d'où viennent ses
// substitutions, et les deux langues — celle qu'on n'affiche pas est jetée ici.
//
// Trois tons, trois préfixes, une seule grammaire. « blocage » dit que la compilation
// s'est arrêtée : le filtre qui l'écrit sort ensuite sur un code non nul. Rien ici n'a à
// le deviner d'une phrase.
const TONS_PREFIXE = { blocage: 'danger', avertissement: 'attention', info: 'info' };

// La famille d'une ligne, ou null si le préfixe n'est pas de cette forme. Une source neuve
// arrive donc à l'écran sans qu'on soit repassé ici : elle n'aura ni clé d'i18n ni
// substitutions, et montrera la phrase du pipeline dans la bonne langue.
function familleCode(prefixe) {
  const m = prefixe.match(/^([a-z]+)-(blocage|avertissement|info)$/);
  if (!m) { return null; }
  return { source: m[1], ton: TONS_PREFIXE[m[2]] };
}

// Ton par code, là où le préfixe ne suffit pas. Une seule source en a besoin, et elle est
// particulière : l'import écrit tout sous « [import-avertissement] » parce qu'il ne
// s'arrête jamais — il convertit ce qu'il peut et rend compte à la fin — et quelques-uns
// de ses codes sont pourtant des échecs. Ailleurs, le préfixe dit le ton et cette table
// n'a rien à dire.
// Un code absent d'ici prend « attention », le ton du préfixe. Les codes du réimport y
// figurent tous, y compris ceux qui prennent ce défaut : c'est la seule façon de relire la
// règle des cinq issues d'un seul regard.
const TONS_IMPORT = {
  'tableau-sans-entete': 'attention',
  'langue-deduite': 'attention',
  // Rien n'a été créé, mais l'import se termine en code 0 : le Word attend, l'article
  // publié est encore l'ancien. Ce n'est pas un échec, et le dire comme tel ferait croire
  // à un numéro cassé.
  'word-redepose': 'attention',
  'origine-inconnue': 'attention',
  'titre-manquant': 'attention',
  'meta-illisible': 'attention',
  'homonymes-epuises': 'danger',
  // ---- Le réimport d'un article corrigé -----------------------------------------
  //
  // Ses codes sont listés en entier, ton par ton, même quand c'est « attention » : c'est
  // ici que se lit la règle des cinq issues, et elle ne se lit que d'un bloc.
  //
  //   REFUSÉ — rien n'a été touché, et il y a un geste à faire. Jamais « danger » : peindre
  //   en rouge un réimport qui n'a rien remplacé ferait croire à un numéro cassé.
  'reimport-sans-article': 'attention',
  'reimport-sans-word': 'attention',
  'reimport-fiche-sans-source': 'attention',
  'reimport-plusieurs-articles': 'attention',
  'annuler-sans-etat': 'attention',
  //   ÉCHOUÉ — la conversion ou le disque a lâché ; l'article est intact.
  'reimport-echec': 'danger',
  'reimport-panne': 'danger',
  //   Interrompu à la main : rien n'a été remplacé à moitié. Ce n'est pas une panne.
  'reimport-interrompu': 'attention',
  //   RÉUSSI — ce que le remplacement a coûté, et où retrouver ce qu'il a déplacé.
  'fiche-du-word-differente': 'attention',
  'tableau-conflit': 'attention',
  'tableaux-origine-inconnue': 'attention',
  'image-non-reimportee': 'attention',
  'corps-retravaille': 'attention',
  //   La bibliographie détachée, sur le même modèle que les tableaux. Une seule des trois
  //   demande un geste : le conflit, où deux versions existent et où l'une doit être
  //   recopiée dans l'autre. Les deux autres constatent — la liste est repartie dans le
  //   texte, ou l'on ne peut pas savoir d'où venait celle d'ici — et un constat peint en
  //   orange se prendrait pour un défaut.
  'biblio-conflit': 'attention',
  'biblio-retiree': 'info',
  'biblio-origine-inconnue': 'info',
  //   Une reprise réussie n'a rien à faire faire : elle se dit, et c'est tout.
  'reimport-reprise': 'info',
  //   ... sauf quand le dossier n'a pas pu être remis en place : l'article manque au numéro.
  'reimport-reprise-impossible': 'danger'
};

// Un code absent de la table ci-dessus prend le ton de son préfixe, et sa phrase vient du
// pipeline, qui l'écrit dans les deux langues. Un code neuf arrive donc à l'écran, dans la
// bonne langue et sans se faire prendre pour un échec, avant même qu'on soit repassé ici.

// Clé d'i18n par code, quand la maison écrit mieux que le pipeline. Un code absent d'ici
// garde la phrase du pipeline, dans la langue demandée.
const CLES_IMPORT = {
  'tableau-sans-entete': 'ctl.import.tableau-sans-entete',
  'langue-deduite': 'ctl.import.langue-deduite',
  'word-redepose': 'ctl.import.word-redepose',
  'origine-inconnue': 'ctl.import.origine-inconnue',
  // Le réimport. Une seule table pour les deux chemins qui mènent ces codes à l'écran —
  // le journal d'import relu ligne à ligne, et la ligne JSON que le cockpit reçoit quand
  // il lance le réimport lui-même (constatsReimport ci-dessous).
  'reimport-sans-article': 'ctl.reimport.sans-article',
  'reimport-sans-word': 'ctl.reimport.sans-word',
  'reimport-fiche-sans-source': 'ctl.reimport.fiche-sans-source',
  'reimport-plusieurs-articles': 'ctl.reimport.plusieurs-articles',
  'reimport-echec': 'ctl.reimport.echec',
  'reimport-interrompu': 'ctl.reimport.interrompu',
  'reimport-panne': 'ctl.reimport.panne',
  'annuler-sans-etat': 'ctl.reimport.annuler-sans-etat',
  'fiche-du-word-differente': 'ctl.reimport.fiche-differente',
  'tableau-conflit': 'ctl.reimport.tableau-conflit',
  'tableaux-origine-inconnue': 'ctl.reimport.tableaux-inconnus',
  'image-non-reimportee': 'ctl.reimport.image-perdue',
  'corps-retravaille': 'ctl.reimport.corps-retravaille',
  'biblio-conflit': 'ctl.reimport.biblio-conflit',
  'biblio-retiree': 'ctl.reimport.biblio-retiree',
  'biblio-origine-inconnue': 'ctl.reimport.biblio-inconnue',
  'reimport-reprise': 'ctl.reimport.reprise',
  'reimport-reprise-impossible': 'ctl.reimport.reprise-impossible'
};

// « meta » : szh-maquette.lua, les métadonnées et la langue de l'article. Ses cinq cas ont
// tous leur phrase ici — c'est la maison qui parle, le filtre ne fournit qu'un repli.
const CLES_META = {
  'champ-vide': 'ctl.meta.champvide',
  'marque-champ': 'ctl.meta.marque.champ',
  'marque-motcle': 'ctl.meta.marque.motcle',
  'sans-langue': 'ctl.meta.sanslangue',
  'langue-inconnue': 'ctl.meta.langueinconnue'
};

// « citations » : szh-citations.lua. Le corpus historique donne ~27 % d'appels non liés,
// « appel-sans-reference » est donc le message le plus vu de toute la chaîne.
const CLES_CITATIONS = {
  'appel-sans-reference': 'ctl.cit.sansref',
  'appel-ambigu': 'ctl.cit.ambigu',
  'reference-orpheline': 'ctl.cit.jamais',
  'ancrage-inconnu': 'ctl.cit.ancrage',
  'caractere-sans-repli': 'ctl.cit.ascii',
  'bilan': 'ctl.cit.bilan'
};

const CLES = { import: CLES_IMPORT, meta: CLES_META, citations: CLES_CITATIONS };
const TONS = { import: TONS_IMPORT };

// Les substitutions de la phrase de la maison, par « source/code ». Elles se prennent dans
// les champs NOMMÉS de la ligne, jamais dans leur position : le pipeline peut en ajouter
// un sans décaler les autres. Un code sans entrée ici n'a pas de substitution — ce qui est
// le cas de tous ceux dont la phrase reste celle du pipeline.
const ARGS = {
  'import/tableau-sans-entete': (ch) => [ch('tableau')],
  'import/langue-deduite': (ch, l) => [nomLangue(ch('langue'), l)],
  'import/word-redepose': (ch) => [ch('fichier')],
  'import/origine-inconnue': (ch) => [ch('fichier')],
  'meta/champ-vide': (ch, l) => [nomChamp(ch('champ'), l), nomLangue(ch('langue'), l)],
  'meta/marque-champ': (ch, l) => [nomChamp(ch('champ'), l), nomLangue(ch('langue'), l)],
  'meta/marque-motcle': (ch, l) => [ch('motcle'), nomLangue(ch('langue'), l)],
  // La langue est inconnue, justement : son jeton se cite tel quel, il n'a pas de nom à
  // traduire. Même champ que « langue-deduite », traitement inverse.
  'meta/langue-inconnue': (ch) => [ch('langue')],
  'citations/appel-sans-reference': (ch) => [ch('appel')],
  'citations/appel-ambigu': (ch) => [ch('appel')],
  'citations/reference-orpheline': (ch) => [ch('reference')],
  'citations/ancrage-inconnu': (ch) => [ch('ancrage')],
  'citations/caractere-sans-repli': (ch) => [ch('caractere')],
  'citations/bilan': (ch) => [ch('references'), ch('appels'), ch('lies'),
                              ch('ambigus'), ch('sansref')]
};

// Préfixes de la maison qui n'ont pas (encore) de format à codes : le Makefile, les
// journaux d'import, szh-niveaux.lua. S'y ajoutent « citations » et « szh », la prose que
// les deux filtres écrivaient avant les codes : un numéro rouvert avec un journal d'hier
// en porte, et mieux vaut le montrer brut que se taire. Une ligne qui ne porte aucun de
// ces préfixes n'est regardée que par les règles nommées (WeasyPrint, pandoc) ; tout le
// reste est du bruit d'outillage.
const PREFIXES = ['citations', 'szh', 'pipeline', 'pdf-ua', 'niveaux', 'import',
                  'docx-tables'];

// Nom lisible d'un champ de fiche et d'une langue : les mêmes libellés que les
// formulaires, pas les clés YAML.
function nomChamp(cle, langue) {
  const connus = { title: 'trad.champ.title', subtitle: 'trad.champ.subtitle', resume: 'trad.champ.resume' };
  return connus[cle] ? TL(langue, connus[cle]) : cle;
}

// Le nom de fichier seul : les outils nomment l'image par son chemin, parfois par une URL
// file://, et un chemin n'aide personne à retrouver une image dans un formulaire.
// ⚠ Les deux séparateurs, et la contre-oblique doublée : un littéral à contre-oblique
//   simple s'effondrerait en silence.
function nomFichier(chemin) {
  return String(chemin).replace(/[?#].*$/, '').replace(/^.*[/\\]/, '');
}

function nomLangue(code, langue) {
  const connus = { fr: 'meta.langue.fr', de: 'meta.langue.de', it: 'meta.langue.it', en: 'meta.langue.en' };
  return connus[code] ? TL(langue, connus[code]) : code;
}

// ---- Lecture ligne à ligne -------------------------------------------------------

// Le préfixe « [xxx] » d'une ligne, et ce qui reste. La moitié allemande d'une ligne
// bilingue porte « [xxx] [de] » : elle est reconnue ici pour être gardée ou jetée selon la
// langue demandée.
function decouper(ligne) {
  const m = ligne.match(/^\[([a-z-]+)\]\s?(\[de\]\s?)?(.*)$/);
  if (!m) { return null; }
  return { prefixe: m[1], allemand: !!m[2], reste: m[3] };
}

// ⚠ REPLI SUR LA PROSE — « [pipeline] », les lignes du Makefile. Le shell n'a pas de
// table de codes, et ces messages sont écrits en clair dans les recettes ; on reconnaît
// donc leur phrase, et reformuler l'une d'elles coupe la remontée. Le jour où le Makefile
// passe au format à codes ([pipeline-blocage] …), cette fonction disparaît. Certaines de
// ses lignes portent leur moitié allemande, d'autres non ; on passe par une clé d'i18n
// dans les deux cas, la phrase de la maison disant la même chose en mieux.
function lirePipeline(reste) {
  let m = reste.match(/^⚠ L'article «\s*(.+?)\s*» n'a pas de titre/);
  if (m) {
    return { source: 'pipeline', code: 'titre-manquant', ton: 'danger', slug: m[1],
             cle: 'ctl.titre.manquant', args: [] };
  }
  if (/^⚠ Un dossier de articles\/ contient des espaces/.test(reste)) {
    return { source: 'pipeline', code: 'dossier-espaces', ton: 'danger', slug: '',
             cle: 'ctl.espaces', args: [] };
  }
  if (/^Aucun article \(articles\//.test(reste)) {
    return { source: 'pipeline', code: 'aucun-article', ton: 'danger', slug: '',
             cle: 'ctl.aucunarticle', args: [] };
  }
  if (/n'est pas une revue/.test(reste)) {
    return { source: 'pipeline', code: 'pas-une-revue', ton: 'danger', slug: '',
             cle: 'ctl.pasrevue', args: [] };
  }
  m = reste.match(/^PDF\/UA-1 indisponible -> PDF balisé simple : out\/([^/]+)\//);
  if (m) {
    return { source: 'pipeline', code: 'balisage-simple', ton: 'attention', slug: m[1],
             cle: 'ctl.balisage.simple', args: [] };
  }
  m = reste.match(/^balisage PDF indisponible -> PDF non balisé : out\/([^/]+)\//);
  if (m) {
    return { source: 'pipeline', code: 'balisage-aucun', ton: 'danger', slug: m[1],
             cle: 'ctl.balisage.aucun', args: [] };
  }
  if (/^profil vide dans ausgabe\.yaml/.test(reste)) {
    return { source: 'pipeline', code: 'profil-rien', ton: 'info', slug: '',
             cle: 'ctl.profil.rien', args: [] };
  }
  if (/^profil « book »/.test(reste)) {
    return { source: 'pipeline', code: 'profil-differe', ton: 'danger', slug: '',
             cle: 'ctl.profil.differe', args: [] };
  }
  m = reste.match(/^profil inconnu dans ausgabe\.yaml : «\s*(.*?)\s*»/);
  if (m) {
    return { source: 'pipeline', code: 'profil-inconnu', ton: 'danger', slug: '',
             cle: 'ctl.profil.inconnu', args: [m[1]] };
  }
  if (/^Aucun PDF à valider/.test(reste)) {
    return { source: 'pdfua', code: 'aucun-pdf', ton: 'danger', slug: '',
             cle: 'ctl.pdfua.aucun', args: [] };
  }
  return null;
}

// ⚠ REPLI SUR LA PROSE — « [import] », le journal de conversion du Makefile (les
// avertissements de l'import, eux, ont leurs codes : voir « [import-avertissement] »). Ses
// lignes de bilan restent à la vue « Word en attente », qui les montre déjà ; seuls les
// échecs remontent ici.
function lireImport(reste) {
  let m = reste.match(/^⚠ échec sur\s*:\s*(.+?)(?:\s*[—(].*)?$/);
  if (m) {
    return { source: 'import', code: 'echec', ton: 'danger', slug: '',
             cle: 'ctl.import.echec', args: [m[1]] };
  }
  m = reste.match(/^⚠ (\d+) fichier\(s\) Word ne sont pas entrés/);
  if (m) {
    return { source: 'import', code: 'restes', ton: 'danger', slug: '',
             cle: 'ctl.import.restes', args: [m[1]] };
  }
  return null;
}

// ⚠ REPLI SUR LA PROSE — « [niveaux] », szh-niveaux.lua, qui écrit ses deux langues. On
// reconnaît la moitié utile et on redit la phrase soi-même — deux lignes du pipeline pour
// un seul constat. Un code stable y mettrait fin, comme pour szh-maquette et
// szh-citations ; ce filtre est hors du chantier qui les a convertis.
function lireNiveaux(reste) {
  const m = reste.match(/^(\S+)\s*:\s*(?:plus de \d+ rangs de titre|mehr als \d+ Titelstufen)\s*—\s*(?:les niveaux|die Stufen)\s+(.+?)\s+(?:se retrouvent|landen)/);
  if (!m) { return null; }
  return { source: 'rendu', code: 'niveaux-ecrases', ton: 'attention', slug: m[1],
           cle: 'ctl.niveaux', args: [m[2]] };
}

// Repli assumé, et le seul qui le restera : pandoc et WeasyPrint, en anglais et sans
// préfixe de la maison. Ce sont des outils étrangers — on ne leur demandera pas d'écrire
// nos codes, et c'est aussi pourquoi eux seuls ont encore besoin du contexte d'article
// pris sur la ligne de commande. Trois de leurs avertissements concernent la rédaction ; tous les autres parlent de la feuille de style
// du toolkit ou du gabarit, et n'ont rien à faire sous les yeux d'une rédactrice — « Ignored
// `overflow-x: auto`, unknown property » ne dit rien à personne d'utile.
function lireRendu(ligne, slug) {
  // pandoc, à l'incorporation des ressources : c'est lui, et non WeasyPrint, qui voit
  // l'image manquante en premier — mesuré sur un article dont la figure a été renommée.
  let m = ligne.match(/^\[WARNING\] Could not fetch resource (.+?)\s*$/);
  if (m) {
    return { source: 'rendu', code: 'image-manquante', ton: 'danger', slug: slug,
             cle: 'ctl.image.manquante', args: [nomFichier(m[1])] };
  }
  m = ligne.match(/^WARNING: Failed to load image at ["']?(.+?)["']?\s*:/);
  if (m) {
    return { source: 'rendu', code: 'image-manquante', ton: 'danger', slug: slug,
             cle: 'ctl.image.manquante', args: [nomFichier(m[1])] };
  }
  m = ligne.match(/^WARNING: Failed to load (?:font|local font) ["']?(.+?)["']?\s*[:.]/);
  if (m) {
    return { source: 'rendu', code: 'police-manquante', ton: 'attention', slug: slug,
             cle: 'ctl.police.manquante', args: [m[1]] };
  }
  return null;
}

// Les champs d'une ligne codée sont NOMMÉS : « article « 03-autre » », « champ « title » »,
// « tableau 2 », « appel « (Sen, 2001) » ». Un champ que personne ne nomme — un chemin, un
// « détail : … » — est ignoré sans bruit : le pipeline en pose, et ce n'est pas une erreur.
// Les noms allemands sont acceptés au cas où un émetteur les écrive un jour ; aucun ne le
// fait aujourd'hui.
const ALIAS_CHAMP = { Artikel: 'article', Datei: 'fichier', Tabelle: 'tableau',
                      Sprache: 'langue', Feld: 'champ', Schlagwort: 'motcle' };

function champsNommes(restants) {
  const champs = {};
  for (const champ of restants) {
    const m = champ.match(/^([A-Za-zÀ-ÿ-]+)\s+(?:«\s*([\s\S]*?)\s*»|([^\s«»]+))$/);
    if (!m) { continue; }
    champs[ALIAS_CHAMP[m[1]] || m[1]] = m[2] === undefined ? m[3] : m[2];
  }
  return champs;
}

// Une ligne du format à codes. Le préfixe a déjà donné la source et le ton ; ici on prend
// le code, les champs, et la moitié de langue demandée.
function lireConstatCode(famille, reste, langue) {
  const champs = reste.split('|').map((c) => c.trim());
  const code = champs.shift() || '';
  if (code === '') { return null; }
  let fr = '', de = '';
  const restants = [];
  for (const champ of champs) {
    if (champ.indexOf('[de]') === 0) { de = champ.slice(4).trim(); continue; }
    restants.push(champ);
  }
  if (restants.length > 0) { fr = restants.pop(); }   // la phrase française ferme la liste
  const nommes = champsNommes(restants);
  const ch = (nom) => (nommes[nom] === undefined ? '' : nommes[nom]);
  // Le bilan de citations ne vaut d'être lu que s'il reste quelque chose à lier : sinon il
  // remplirait la vue d'une carte par article pour dire que tout va bien.
  if (famille.source === 'citations' && code === 'bilan'
      && Number(ch('ambigus')) === 0 && Number(ch('sansref')) === 0) { return null; }
  const args = ARGS[famille.source + '/' + code];
  return {
    source: famille.source, code: code,
    ton: (TONS[famille.source] || {})[code] || famille.ton,
    slug: ch('article'), cle: (CLES[famille.source] || {})[code] || '',
    args: args ? args(ch, langue) : [],
    brut: (langue === 'de' && de !== '') ? de : fr
  };
}

// ---- Le journal entier -----------------------------------------------------------

// Les lignes « [pdf-ua] » se lisent en bloc : un titre de règle, sa cause et son geste
// arrivent sur trois lignes successives, et la même chose suit en allemand. On garde le
// bloc de la langue demandée, et le verdict devient une phrase de la maison.
function lirePdfUa(reste, courant) {
  let m = reste.match(/^PDF\/UA-1\s*:?\s*(\S+)\s+—\s+(?:NON conforme|NICHT konform), (\d+)/);
  if (m) {
    return { source: 'pdfua', code: 'non-conforme', ton: 'danger', slug: slugDuPdf(m[1]),
             cle: 'ctl.pdfua.nonconforme', args: [m[2]] };
  }
  m = reste.match(/^PDF\/UA-1\s*:?\s*(\S+)\s+—\s+(?:conforme|konform)\.$/);
  if (m) { return null; }                            // rien à dire d'un PDF conforme
  m = reste.match(/^\s*•\s*(.+)$/);
  if (m) {
    return { source: 'pdfua', code: 'regle', ton: 'danger', slug: courant.pdf,
             cle: '', args: [], brut: m[1] };
  }
  // Cause et geste d'une règle : accrochés au constat qu'on vient de poser.
  if (/^\s{4,}\S/.test(reste)) { return { suite: reste.trim() }; }
  if (reste.indexOf('✗') === 0) {
    return { source: 'pdfua', code: 'outillage', ton: 'danger', slug: '',
             cle: '', args: [], brut: reste.replace(/^✗\s*/, '') };
  }
  return null;
}

function slugDuPdf(nom) {
  return String(nom).replace(/\.pdf$/i, '');
}

// Certaines lignes portent leurs deux langues d'un seul tenant, l'allemande introduite par
// « [de] » au milieu de la phrase : c'est le cas des lignes « [import] » du Makefile. On
// coupe, et on ne garde que la moitié demandée.
function moitieInline(texte, langue) {
  const i = texte.indexOf('[de] ');
  if (i === -1) { return texte; }
  return (langue === 'de' ? texte.slice(i + 5) : texte.slice(0, i)).replace(/\s+$/, '');
}

// analyserJournal(texte, langue) -> [constat]
// `langue` vaut 'fr' ou 'de' : c'est celle du cockpit, et la seule qui sortira d'ici.
//
// Les deux moitiés de langue sont lues, puis départagées à la fin. Ne lire d'emblée que la
// moitié demandée paraissait plus simple, et perdait tout ce que le pipeline n'écrit qu'en
// français — les avertissements de citations, les plus nombreux du lot.
function analyserJournal(texte, langue) {
  const lang = langue === 'de' ? 'de' : 'fr';
  const constats = [];
  const courant = { slug: '', pdf: '' };
  let dernier = null;                                // pour accrocher la suite d'un bloc
  const poser = (constat, moitie) => {
    dernier = complet(constat, moitie);
    constats.push(dernier);
  };
  for (const brute of String(texte === undefined || texte === null ? '' : texte).split(/\r?\n/)) {
    const ligne = brute.replace(/\s+$/, '');
    if (ligne === '') { continue; }
    // Contexte : les avertissements des filtres ne nomment pas leur article, la ligne de
    // commande de pandoc le fait juste avant.
    let m = ligne.match(/^pandoc articles\/([^/]+)\//);
    if (m) { courant.slug = m[1]; dernier = null; continue; }
    m = ligne.match(/^pandoc .* -> out\/([^/]+)\//);
    if (m) { courant.slug = m[1]; dernier = null; continue; }
    const coupe = decouper(ligne);
    if (!coupe) {
      const rendu = lireRendu(ligne, courant.slug);
      if (rendu) { poser(rendu, 'fr'); } else { dernier = null; }
      continue;
    }
    const famille = familleCode(coupe.prefixe);
    if (!famille && PREFIXES.indexOf(coupe.prefixe) === -1) { continue; }
    const moitie = coupe.allemand ? 'de' : 'fr';
    let constat = null;
    if (famille) { constat = lireConstatCode(famille, coupe.reste, lang); }
    else if (coupe.prefixe === 'pipeline') { constat = lirePipeline(coupe.reste); }
    else if (coupe.prefixe === 'import') { constat = lireImport(coupe.reste); }
    else if (coupe.prefixe === 'niveaux') { constat = lireNiveaux(coupe.reste); }
    else if (coupe.prefixe === 'pdf-ua') {
      constat = lirePdfUa(coupe.reste, courant);
      if (constat && constat.code === 'non-conforme') { courant.pdf = constat.slug; }
      if (constat && constat.suite) {
        // Cause ou geste d'une règle : la phrase se poursuit sur le constat précédent, et
        // seulement s'il vient de la même moitié de langue.
        if (dernier && dernier.moitie === moitie) { dernier.brut = dernier.brut + ' ' + constat.suite; }
        continue;
      }
    }
    if (constat) { poser(constat, moitie); continue; }
    // Rien de reconnu, mais la ligne se plaint : mieux vaut une phrase brute qu'un
    // silence. C'est ce qui fera apparaître le prochain avertissement du pipeline sans
    // qu'on ait eu à revenir ici.
    if (/[⚠✗]/.test(coupe.reste)) {
      poser({ source: coupe.prefixe === 'pdf-ua' ? 'pdfua' : 'pipeline',
              code: 'autre', ton: coupe.reste.indexOf('✗') !== -1 ? 'danger' : 'attention',
              slug: courant.slug, cle: '', args: [],
              brut: moitieInline(coupe.reste, lang).replace(/^[⚠✗]\s*/, '') }, moitie);
      continue;
    }
    dernier = null;
  }
  return departager(constats, lang);
}

function complet(constat, moitie) {
  return {
    source: constat.source, code: constat.code, ton: constat.ton,
    cle: constat.cle || '', args: constat.args || [], slug: constat.slug || '',
    brut: constat.brut || '', moitie: moitie
  };
}

// Deux raisons de voir deux fois le même constat, et elles ne se règlent pas pareil :
//
//   * la chaîne compile chaque article deux fois — le PDF et l'aperçu cliquable — et ses
//     filtres parlent donc deux fois. Deux constats identiques : on en garde un.
//   * une ligne bilingue a été lue dans ses deux moitiés. Deux constats jumeaux dont la
//     phrase brute diffère : on garde celui de la langue du cockpit.
//
// Les jumeaux d'un constat sans clé d'i18n ne se reconnaissent pas à leur texte, qui est
// justement ce qui les sépare : ils se reconnaissent à leur rang dans leur moitié. Les
// deux moitiés listent les mêmes choses dans le même ordre.
function departager(constats, langue) {
  const rangs = new Map();
  const groupes = new Map();
  const ordre = [];
  for (const c of constats) {
    let cle;
    if (c.cle !== '') {
      cle = ['k', c.source, c.code, c.slug, c.cle, c.args.join(SEP)].join(SEP);
    } else {
      const compteur = ['r', c.source, c.code, c.slug, c.moitie].join(SEP);
      const rang = (rangs.get(compteur) || 0) + 1;
      rangs.set(compteur, rang);
      cle = ['b', c.source, c.code, c.slug, rang].join(SEP);
    }
    const vu = groupes.get(cle);
    if (!vu) { groupes.set(cle, c); ordre.push(cle); continue; }
    // Le premier arrivé fait foi, sauf si le second parle la bonne langue.
    if (vu.moitie !== langue && c.moitie === langue) { groupes.set(cle, c); }
  }
  return ordre.map((cle) => {
    const c = groupes.get(cle);
    return { source: c.source, code: c.code, ton: c.ton, cle: c.cle, args: c.args,
             slug: c.slug, brut: c.brut };
  });
}

// La phrase à montrer : celle de la maison si le constat a une clé, celle du pipeline
// sinon. Jamais les deux langues, jamais une clé nue.
function phraseConstat(constat, langue) {
  if (constat.cle) { return TL(langue, constat.cle, constat.args); }
  return constat.brut || '';
}

// Ce que la barre d'état et la notification ont besoin de savoir.
function resumeJournal(constats) {
  let bloquants = 0, avertissements = 0, infos = 0;
  for (const c of constats || []) {
    if (c.ton === 'danger') { bloquants++; }
    else if (c.ton === 'attention') { avertissements++; }
    else { infos++; }
  }
  return { bloquants: bloquants, avertissements: avertissements, infos: infos,
           total: bloquants + avertissements + infos };
}

// ---- Les citations, regroupées par article ---------------------------------------
//
// La vue « Articles » pose sur chaque carte l'état des références de SON article : un
// rédacteur doit voir d'un coup d'oeil lequel a un problème, sans lire la liste entière des
// constats. Ce regroupement vit ici et non dans la vue, parce qu'il n'y a qu'un lecteur de
// journal et que les codes sont déjà nommés plus haut : un code ajouté à szh-citations
// arrive ici dès qu'il est inscrit dans CLES_CITATIONS.
//
// Trois codes seulement, ceux qui parlent d'un lien manquant ou douteux entre le texte et
// la bibliographie. « bilan » est un chiffre, pas un défaut ; « ancrage-inconnu » et
// « caractere-sans-repli » sont d'autres familles, et la vue « Contrôles » les montre
// toutes. Ce sont des CODES et non des phrases : la prose des filtres n'est plus lue nulle
// part dans ce module, et ce regroupement ne la relit pas non plus.
const CODES_CITATIONS_CARTE = ['appel-sans-reference', 'appel-ambigu', 'reference-orpheline'];

// -> Map slug -> { 'appel-sans-reference': n, 'appel-ambigu': n, 'reference-orpheline': n,
//                  total: n }
// Un constat sans article — le pipeline n'a pas nommé le fichier — n'est rattaché à aucune
// carte : le compter sur toutes serait faux.
function citationsParArticle(constats) {
  const parSlug = new Map();
  for (const c of (constats || [])) {
    if (!c || c.source !== 'citations') { continue; }
    const slug = String(c.slug || '');
    if (slug === '' || CODES_CITATIONS_CARTE.indexOf(c.code) === -1) { continue; }
    if (!parSlug.has(slug)) {
      const vide = { total: 0 };
      for (const code of CODES_CITATIONS_CARTE) { vide[code] = 0; }
      parSlug.set(slug, vide);
    }
    const compte = parSlug.get(slug);
    compte[c.code]++;
    compte.total++;
  }
  return parSlug;
}

// ---- Le réimport d'un article corrigé, lu dans sa ligne JSON ---------------------
//
// Le réimport est le seul maillon que le cockpit lance lui-même et dont il lit la réponse :
// une ligne JSON sur la sortie normale, pendant que ses messages partent, eux, dans le
// journal d'import comme ceux de la conversion. Les deux chemins mènent donc les mêmes
// codes à l'écran, et c'est exprès qu'ils partagent tout ce qui précède — TONS_IMPORT pour
// le ton, CLES_IMPORT pour la phrase. Une seconde table serait une seconde vérité.
//
// Le ton des CINQ ISSUES, celui de la notification qui suit le geste. Il ne se déduit pas
// des avertissements : « refusé » n'en porte qu'un, et pourtant rien n'a été touché.
//
//   reussi   le texte vient du Word ; ce qu'il a coûté est dans les avertissements
//   rien     le Word n'apportait rien. Ni échec ni avertissement : un fait
//   refuse   RIEN n'a été touché, et il y a un geste à faire. Jamais « danger »
//   echec    la conversion ou le disque a lâché ; l'article est intact
//
// Une réponse absente ou inconnue vaut « danger » : ne rien dire serait pire.
const TONS_RESULTAT_REIMPORT = {
  reussi: 'ok', rien: 'info', refuse: 'attention', echec: 'danger'
};

function tonResultatReimport(resultat) {
  const nom = String((resultat && resultat.resultat) || '');
  return TONS_RESULTAT_REIMPORT[nom] || 'danger';
}

// La ligne JSON du réimport -> des constats, de la même forme que ceux du journal, pour la
// même vue et la même barre d'état. `slug` sert de repli : les refus les plus précoces
// répondent sans nom d'article, et une carte sans article n'est pas ouvrable.
function constatsReimport(resultat, slug) {
  const r = resultat || {};
  const article = String(r.article || slug || '');
  const constats = [];
  const vus = new Set();
  for (const brut of (Array.isArray(r.avertissements) ? r.avertissements : [])) {
    const code = String(brut || '');
    if (code === '' || vus.has(code)) { continue; }     // deux fois le même : une carte
    vus.add(code);
    constats.push({
      source: 'import', code: code,
      ton: TONS_IMPORT[code] || 'attention',
      cle: CLES_IMPORT[code] || '', args: [], slug: article,
      // Aucune phrase brute de repli : le script parle sur sa sortie d'erreur, que le
      // cockpit ne lit pas. Un code sans clé d'i18n ne doit donc pas donner une carte
      // muette — il est écarté, et reste lisible dans le journal d'import.
      brut: ''
    });
  }
  return constats.filter((c) => c.cle !== '');
}

module.exports = {
  TONS_IMPORT, CLES_IMPORT, TONS_RESULTAT_REIMPORT,
  analyserJournal, phraseConstat, resumeJournal,
  CODES_CITATIONS_CARTE, citationsParArticle,
  constatsReimport, tonResultatReimport
};
