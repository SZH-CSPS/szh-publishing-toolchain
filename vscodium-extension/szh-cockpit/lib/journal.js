// Lit le journal de compilation (.szh-journal.log, écrit par `tee` dans
// vscodium-user/tasks.json) et le traduit en constats que le cockpit affiche sur des cartes.
//
// Règles du module :
//  1. Une seule langue à l'écran, celle du cockpit. Le pipeline écrit ses deux langues sur
//     la même ligne, l'allemande introduite par « [de] » ; on garde la moitié demandée.
//  2. C'est le code d'une ligne qui décide, pas sa phrase. Seule la prose du Makefile, de
//     pandoc et de WeasyPrint est encore reconnue, dans des fonctions de repli signalées.
//  3. Une ligne non reconnue est jetée, sauf si elle porte « ⚠ » ou « ✗ » sous un préfixe
//     maison : un nouvel avertissement du pipeline s'affiche sans règle ici, le bruit des
//     outils (propriété CSS ignorée, chemin de venv) ne s'affiche pas.
//  4. Trois tons : `danger`, la compilation s'est arrêtée ou le document n'est pas
//     publiable ; `attention`, il faut regarder avant de publier ; `info`, un chiffre pour
//     situer. Un avertissement non bloquant ne s'affiche pas comme un échec.
//
// En bas de fichier, constatsReimport() traduit la ligne JSON du réimport d'un article avec
// les mêmes tables de tons et de libellés.
//
// Un constat vaut { source, code, ton, cle, args, slug, brut } : `cle` est une clé d'i18n
// (vide si seule la phrase du pipeline existe), `args` ses substitutions, `slug` l'article
// concerné s'il est connu, `brut` la phrase du pipeline dans la langue demandée, en repli.
'use strict';

const { TL } = require('./i18n');
const { gravite } = require('./constats');

// Séparateur des clés de dédoublonnage : un caractère absent de toute phrase du journal.
const SEP = '\u0001';

// ---- Le format à codes ---------------------------------------------------------
//
//   [<source>-<ton>] <code> | <champ> | … | <phrase fr> | [de] <Satz de>
//
// La source est la famille de contrôle, le code donne la clé d'i18n, les champs nommés
// donnent ses substitutions. « blocage » signale que la compilation s'est arrêtée : le
// filtre qui l'écrit sort ensuite en erreur.
const TONS_PREFIXE = { blocage: 'danger', avertissement: 'attention', info: 'info' };

// La source et le ton d'un préfixe, ou null s'il n'a pas cette forme. Une source inconnue
// d'ici s'affiche quand même, avec la phrase du pipeline.
function familleCode(prefixe) {
  const m = prefixe.match(/^([a-z]+)-(blocage|avertissement|info)$/);
  if (!m) { return null; }
  return { source: m[1], ton: TONS_PREFIXE[m[2]] };
}

// Ton par code pour l'import, qui écrit tout sous « [import-avertissement] » (il convertit
// ce qu'il peut et rend compte à la fin) alors que certains de ses codes sont des échecs.
// Un code absent prend le ton du préfixe. Les codes du réimport sont tous listés, même
// ceux qui valent le défaut, pour que la règle se lise d'un bloc.
const TONS_IMPORT = {
  'tableau-sans-entete': 'attention',
  'langue-deduite': 'attention',
  'sous-titre-deduit': 'attention',
  // Rien n'a été créé et l'article publié reste l'ancien : ce n'est pas un échec.
  'word-redepose': 'attention',
  'origine-inconnue': 'attention',
  'titre-manquant': 'attention',
  'meta-illisible': 'attention',
  'homonymes-epuises': 'danger',
  // Le .docx ne s'ouvre pas : l'import est refusé, comme un échec.
  'fichier-illisible': 'danger',
  'tableau-texte-perdu': 'attention',
  // ---- Le lecteur du gabarit « Pronto » (pipeline/pronto-lire.py) ------------------
  //
  // Ce lecteur lit une structure imposée par le gabarit et ne devine pas (contrairement à
  // docx-meta.py). Ses codes se rangent en trois familles.
  //
  //   Rouge : une clé non vide qu'il n'a pas su ranger. L'import est refusé en entier (ni
  //   fiche ni article, le Word reste en attente), pour ne pas perdre ce qu'elle portait.
  'etiquette-metadonnees-inconnue': 'danger',
  'auteur-etiquette-inconnue': 'danger',
  'auteur-champ-hors-gabarit': 'danger',
  'metadonnees-champ-hors-gabarit': 'danger',
  'bloc-etiquette-inconnue': 'danger',
  'cle-ambigue': 'danger',
  //   Ambre : l'article est importé, mais un point du Word est à vérifier.
  'cle-approximee': 'attention',
  'type-article-non-reconnu': 'attention',
  'structure-inattendue': 'attention',
  'bloc-ancienne-forme': 'attention',
  'bloc-contenu-absent': 'attention',
  'bloc-cles-sans-contenu': 'attention',
  'bloc-mal-forme': 'attention',
  'biblio-tableau-apres-titre': 'attention',
  //   Info : rien n'est perdu, rien à faire (champ laissé vide, blocs collés que le lecteur
  //   a réparés, champ retiré du gabarit dans un ancien document).
  'cle-attendue-absente': 'info',
  'blocs-colles': 'info',
  'langue-du-document-ignoree': 'info',
  // ---- Le réimport d'un article corrigé -----------------------------------------
  //
  //   Refusé : rien n'a été touché, il y a une action à faire. En « attention » : un rouge
  //   ferait croire à un numéro cassé.
  'reimport-sans-article': 'attention',
  'reimport-sans-word': 'attention',
  'reimport-fiche-sans-source': 'attention',
  'reimport-plusieurs-articles': 'attention',
  'annuler-sans-etat': 'attention',
  //   Échoué : la conversion ou le disque a lâché ; l'article est intact.
  'reimport-echec': 'danger',
  'reimport-panne': 'danger',
  //   Interrompu à la main : rien n'a été remplacé à moitié.
  'reimport-interrompu': 'attention',
  //   Réussi : ce que le remplacement a coûté, et où retrouver ce qu'il a déplacé.
  'fiche-du-word-differente': 'attention',
  'tableau-conflit': 'attention',
  'tableaux-origine-inconnue': 'attention',
  'image-non-reimportee': 'attention',
  'corps-retravaille': 'attention',
  //   Bibliographie détachée : seul le conflit (deux versions, l'une à recopier dans
  //   l'autre) demande une action ; les deux autres sont de simples informations.
  'biblio-conflit': 'attention',
  'biblio-retiree': 'info',
  'biblio-origine-inconnue': 'info',
  'reimport-reprise': 'info',
  //   Le dossier n'a pas pu être remis en place : l'article manque au numéro.
  'reimport-reprise-impossible': 'danger'
};

// Clé d'i18n par code, quand le cockpit a sa propre phrase. Un code absent garde la phrase
// du pipeline, dans la langue demandée.
const CLES_IMPORT = {
  'tableau-sans-entete': 'ctl.import.tableau-sans-entete',
  'langue-deduite': 'ctl.import.langue-deduite',
  'sous-titre-deduit': 'ctl.import.sous-titre-deduit',
  'word-redepose': 'ctl.import.word-redepose',
  'origine-inconnue': 'ctl.import.origine-inconnue',
  // Bibliographie détachée à l'import (szh-biblio-detacher.lua). Leur couleur est décidée
  // dans lib/constats.js.
  'biblio-detachee': 'ctl.import.biblio-detachee',
  'biblio-incomplete': 'ctl.import.biblio-incomplete',
  'biblio-bornes-perdues': 'ctl.import.biblio-bornes-perdues',
  'biblio-fichier-refuse': 'ctl.import.biblio-fichier-refuse',
  // Le lecteur du gabarit « Pronto ». Ses phrases, faites pour un terminal, sont longues ;
  // celles-ci disent plutôt quoi faire, et reprennent l'étiquette fautive en substitution.
  'etiquette-metadonnees-inconnue': 'ctl.import.pronto-meta-inconnue',
  'auteur-etiquette-inconnue': 'ctl.import.pronto-auteur-inconnue',
  'auteur-champ-hors-gabarit': 'ctl.import.pronto-champ-hors-gabarit',
  'metadonnees-champ-hors-gabarit': 'ctl.import.pronto-meta-hors-gabarit',
  'bloc-etiquette-inconnue': 'ctl.import.pronto-bloc-inconnue',
  'cle-ambigue': 'ctl.import.pronto-cle-ambigue',
  'cle-approximee': 'ctl.import.pronto-cle-approximee',
  'cle-attendue-absente': 'ctl.import.pronto-cle-absente',
  'type-article-non-reconnu': 'ctl.import.pronto-type-inconnu',
  'structure-inattendue': 'ctl.import.pronto-structure',
  'bloc-ancienne-forme': 'ctl.import.pronto-bloc-ancien',
  'bloc-contenu-absent': 'ctl.import.pronto-bloc-vide',
  'bloc-cles-sans-contenu': 'ctl.import.pronto-cles-sans-contenu',
  'bloc-mal-forme': 'ctl.import.pronto-bloc-mal-forme',
  'blocs-colles': 'ctl.import.pronto-blocs-colles',
  'biblio-tableau-apres-titre': 'ctl.import.pronto-biblio-tableau',
  'langue-du-document-ignoree': 'ctl.import.pronto-langue-ignoree',
  // Le réimport. Table partagée entre le journal d'import et la ligne JSON lue par
  // constatsReimport().
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

// « meta » : szh-maquette.lua, les métadonnées et la langue de l'article.
const CLES_META = {
  'champ-vide': 'ctl.meta.champvide',
  'marque-champ': 'ctl.meta.marque.champ',
  'marque-motcle': 'ctl.meta.marque.motcle',
  'sans-langue': 'ctl.meta.sanslangue',
  'langue-inconnue': 'ctl.meta.langueinconnue'
};

// « citations » : szh-citations.lua. « appel-sans-reference » est le message le plus
// fréquent de la chaîne.
const CLES_CITATIONS = {
  'appel-sans-reference': 'ctl.cit.sansref',
  'appel-ambigu': 'ctl.cit.ambigu',
  'reference-orpheline': 'ctl.cit.jamais',
  'ancrage-inconnu': 'ctl.cit.ancrage',
  'caractere-sans-repli': 'ctl.cit.ascii',
  'bilan': 'ctl.cit.bilan'
};

// « livre » : pipeline/livre-assembler.py (une pièce liminaire manquante arrête
// l'assemblage) et la cible verifie-livre de pipeline/profils/livre.mk (un chapitre écarté
// ou introuvable ne bloque pas). Ces lignes nomment leur unité par le champ « chapitre »,
// que lireConstatCode() accepte à la place d'« article ».
const CLES_LIVRE = {
  'liminaire-introuvable': 'ctl.livre.liminaireintrouvable',
  'chapitre-ecarte': 'ctl.livre.chapitreecarte',
  'chapitre-introuvable': 'ctl.livre.chapitreintrouvable'
};

// « numerotation » : szh-numerotation.lua signale une image sans texte alternatif ni
// légende, comme l'encadré « lecteur d'écran » de l'aperçu et imagesSansAlternative()
// (lib/references.js).
const CLES_NUMEROTATION = { 'figure-sans-alt': 'ctl.figure.sansalt' };

// « rendu » : szh-image-introuvable.lua, qui remplace l'image absente par un cadre. Même
// code et même phrase que les replis pandoc et WeasyPrint de lireRendu().
const CLES_RENDU = { 'image-manquante': 'ctl.image.manquante' };

const CLES = { import: CLES_IMPORT, meta: CLES_META, citations: CLES_CITATIONS, livre: CLES_LIVRE,
  numerotation: CLES_NUMEROTATION, rendu: CLES_RENDU };
const TONS = { import: TONS_IMPORT };

// Substitutions de la phrase du cockpit, par « source/code ». Elles se prennent par nom de
// champ et non par position : le pipeline peut ajouter un champ sans décaler les autres.
const ARGS = {
  'import/tableau-sans-entete': (ch) => [ch('tableau')],
  'import/langue-deduite': (ch, l) => [nomLangue(ch('langue'), l)],
  'import/sous-titre-deduit': (ch) => [ch('soustitre')],
  'import/word-redepose': (ch) => [ch('fichier')],
  'import/origine-inconnue': (ch) => [ch('fichier')],
  // Nombre de paragraphes restés dans le texte.
  'import/biblio-incomplete': (ch) => [ch('paragraphes')],
  // Le lecteur du gabarit « Pronto » : chaque phrase nomme ce qu'il faut retrouver dans le
  // Word (étiquette telle que tapée, numéro du tableau, légende du bloc).
  'import/etiquette-metadonnees-inconnue': (ch) => [ch('etiquette')],
  'import/auteur-etiquette-inconnue': (ch) => [ch('ligne')],
  'import/auteur-champ-hors-gabarit': (ch) => [ch('champ')],
  'import/metadonnees-champ-hors-gabarit': (ch) => [ch('champ')],
  'import/bloc-etiquette-inconnue': (ch) => [ch('etiquette')],
  'import/cle-ambigue': (ch) => [ch('clé')],
  'import/cle-approximee': (ch) => [ch('clé'), ch('reconnue')],
  'import/cle-attendue-absente': (ch) => [ch('clé')],
  'import/type-article-non-reconnu': (ch) => [ch('valeur')],
  'import/bloc-ancienne-forme': (ch) => [ch('tableau')],
  'import/bloc-contenu-absent': (ch) => [ch('legende')],
  'import/bloc-cles-sans-contenu': (ch) => [ch('legende')],
  'import/bloc-mal-forme': (ch) => [ch('tableau')],
  'import/blocs-colles': (ch) => [ch('blocs')],
  'import/biblio-tableau-apres-titre': (ch) => [ch('titre')],
  'import/langue-du-document-ignoree': (ch) => [ch('valeur')],
  'meta/champ-vide': (ch, l) => [nomChamp(ch('champ'), l), nomLangue(ch('langue'), l)],
  'meta/marque-champ': (ch, l) => [nomChamp(ch('champ'), l), nomLangue(ch('langue'), l)],
  'meta/marque-motcle': (ch, l) => [ch('motcle'), nomLangue(ch('langue'), l)],
  // Langue inconnue : son code se cite tel quel, il n'a pas de nom à traduire.
  'meta/langue-inconnue': (ch) => [ch('langue')],
  'citations/appel-sans-reference': (ch) => [ch('appel')],
  'citations/appel-ambigu': (ch) => [ch('appel')],
  'citations/reference-orpheline': (ch) => [ch('reference')],
  'citations/ancrage-inconnu': (ch) => [ch('ancrage')],
  'citations/caractere-sans-repli': (ch) => [ch('caractere')],
  'citations/bilan': (ch) => [ch('references'), ch('appels'), ch('lies'),
                              ch('ambigus'), ch('sansref')],
  'livre/liminaire-introuvable': (ch) => [ch('pièce')],
  'livre/chapitre-ecarte': (ch) => [ch('chapitre')],
  'livre/chapitre-introuvable': (ch) => [ch('chapitre')],
  'numerotation/figure-sans-alt': (ch) => [nomFichier(ch('image'))],
  'rendu/image-manquante': (ch) => [nomFichier(ch('image'))]
};

// Préfixes maison sans format à codes : le Makefile, les journaux d'import, szh-niveaux.lua.
// « citations » et « szh » couvrent les anciens journaux, encore présents dans des numéros
// rouverts : leurs lignes s'affichent brutes. Une ligne sans aucun de ces préfixes n'est lue
// que par les règles pandoc et WeasyPrint de lireRendu().
const PREFIXES = ['citations', 'szh', 'pipeline', 'pdf-ua', 'niveaux', 'import',
                  'docx-tables'];

// Nom lisible d'un champ de fiche ou d'une langue, avec les libellés des formulaires.
function nomChamp(cle, langue) {
  const connus = { title: 'trad.champ.title', subtitle: 'trad.champ.subtitle', resume: 'trad.champ.resume' };
  return connus[cle] ? TL(langue, connus[cle]) : cle;
}

// Le nom de fichier seul, sans chemin ni URL file:// : c'est ainsi qu'on retrouve l'image
// dans un formulaire. La regex accepte les deux séparateurs.
function nomFichier(chemin) {
  return String(chemin).replace(/[?#].*$/, '').replace(/^.*[/\\]/, '');
}

function nomLangue(code, langue) {
  const connus = { fr: 'meta.langue.fr', de: 'meta.langue.de', it: 'meta.langue.it', en: 'meta.langue.en' };
  return connus[code] ? TL(langue, connus[code]) : code;
}

// ---- Lecture ligne à ligne -------------------------------------------------------

// Le préfixe « [xxx] » d'une ligne et le reste. La moitié allemande d'une ligne bilingue
// porte « [xxx] [de] ».
function decouper(ligne) {
  const m = ligne.match(/^\[([a-z-]+)\]\s?(\[de\]\s?)?(.*)$/);
  if (!m) { return null; }
  return { prefixe: m[1], allemand: !!m[2], reste: m[3] };
}

// Repli sur la prose : « [pipeline] », les messages écrits en clair dans les recettes du
// Makefile. Reformuler l'un d'eux dans le Makefile empêche de le reconnaître ici. Chaque
// phrase reconnue mène à une clé d'i18n.
function lirePipeline(reste) {
  let m = reste.match(/^⚠ L'article «\s*(.+?)\s*» n'a pas de titre/);
  if (m) {
    return { source: 'pipeline', code: 'titre-manquant', ton: 'danger', slug: m[1],
             cle: 'ctl.titre.manquant', args: [], champs: {} };
  }
  if (/^⚠ Un dossier de articles\/ contient des espaces/.test(reste)) {
    return { source: 'pipeline', code: 'dossier-espaces', ton: 'danger', slug: '',
             cle: 'ctl.espaces', args: [], champs: {} };
  }
  if (/^Aucun article \(articles\//.test(reste)) {
    return { source: 'pipeline', code: 'aucun-article', ton: 'danger', slug: '',
             cle: 'ctl.aucunarticle', args: [], champs: {} };
  }
  if (/n'est pas une revue/.test(reste)) {
    return { source: 'pipeline', code: 'pas-une-revue', ton: 'danger', slug: '',
             cle: 'ctl.pasrevue', args: [], champs: {} };
  }
  m = reste.match(/^PDF\/UA-1 indisponible -> PDF balisé simple : out\/([^/]+)\//);
  if (m) {
    return { source: 'pipeline', code: 'balisage-simple', ton: 'attention', slug: m[1],
             cle: 'ctl.balisage.simple', args: [], champs: {} };
  }
  m = reste.match(/^balisage PDF indisponible -> PDF non balisé : out\/([^/]+)\//);
  if (m) {
    return { source: 'pipeline', code: 'balisage-aucun', ton: 'danger', slug: m[1],
             cle: 'ctl.balisage.aucun', args: [], champs: {} };
  }
  if (/^profil vide dans ausgabe\.yaml/.test(reste)) {
    return { source: 'pipeline', code: 'profil-rien', ton: 'info', slug: '',
             cle: 'ctl.profil.rien', args: [], champs: {} };
  }
  // Phrase de la cible profil-book-sans-fichier du Makefile, mot pour mot
  // (test/js/contrats.test.js vérifie la concordance).
  if (/^Ce dossier déclare « profil: book » mais n'a pas de buch\.yaml\./.test(reste)) {
    return { source: 'pipeline', code: 'profil-differe', ton: 'danger', slug: '',
             cle: 'ctl.profil.differe', args: [], champs: {} };
  }
  m = reste.match(/^profil inconnu dans ausgabe\.yaml : «\s*(.*?)\s*»/);
  if (m) {
    return { source: 'pipeline', code: 'profil-inconnu', ton: 'danger', slug: '',
             cle: 'ctl.profil.inconnu', args: [m[1]], champs: {} };
  }
  if (/^Aucun PDF à valider/.test(reste)) {
    return { source: 'pdfua', code: 'aucun-pdf', ton: 'danger', slug: '',
             cle: 'ctl.pdfua.aucun', args: [], champs: {} };
  }
  return null;
}

// Repli sur la prose : « [import] », le journal de conversion du Makefile. Seuls les échecs
// remontent ici ; le bilan est affiché par la vue « Word en attente ».
function lireImport(reste) {
  let m = reste.match(/^⚠ échec sur\s*:\s*(.+?)(?:\s*[—(].*)?$/);
  if (m) {
    return { source: 'import', code: 'echec', ton: 'danger', slug: '',
             cle: 'ctl.import.echec', args: [m[1]], champs: {} };
  }
  m = reste.match(/^⚠ (\d+) fichier\(s\) Word ne sont pas entrés/);
  if (m) {
    return { source: 'import', code: 'restes', ton: 'danger', slug: '',
             cle: 'ctl.import.restes', args: [m[1]], champs: {} };
  }
  return null;
}

// Repli sur la prose : « [niveaux] », szh-niveaux.lua, qui n'écrit pas encore le format à
// codes. Les deux moitiés de langue sont reconnues et donnent un seul constat.
function lireNiveaux(reste) {
  const m = reste.match(/^(\S+)\s*:\s*(?:plus de \d+ rangs de titre|mehr als \d+ Titelstufen)\s*—\s*(?:les niveaux|die Stufen)\s+(.+?)\s+(?:se retrouvent|landen)/);
  if (!m) { return null; }
  return { source: 'rendu', code: 'niveaux-ecrases', ton: 'attention', slug: m[1],
           cle: 'ctl.niveaux', args: [m[2]], champs: {} };
}

// Lignes de pandoc et de WeasyPrint, en anglais et sans préfixe maison. Leur article vient
// de la ligne de commande pandoc qui précède. Seuls les avertissements utiles à la rédaction
// sont retenus ; les autres concernent la feuille de style.
function lireRendu(ligne, slug) {
  // pandoc voit l'image manquante avant WeasyPrint, en incorporant les ressources.
  let m = ligne.match(/^\[WARNING\] Could not fetch resource (.+?)\s*$/);
  if (m) {
    return { source: 'rendu', code: 'image-manquante', ton: 'danger', slug: slug,
             cle: 'ctl.image.manquante', args: [nomFichier(m[1])], champs: { image: nomFichier(m[1]) } };
  }
  m = ligne.match(/^WARNING: Failed to load image at ["']?(.+?)["']?\s*:/);
  if (m) {
    return { source: 'rendu', code: 'image-manquante', ton: 'danger', slug: slug,
             cle: 'ctl.image.manquante', args: [nomFichier(m[1])], champs: { image: nomFichier(m[1]) } };
  }
  m = ligne.match(/^WARNING: Failed to load (?:font|local font) ["']?(.+?)["']?\s*[:.]/);
  if (m) {
    return { source: 'rendu', code: 'police-manquante', ton: 'attention', slug: slug,
             cle: 'ctl.police.manquante', args: [m[1]], champs: { police: m[1] } };
  }
  // mv refuse de déposer le PDF dans out/ quand un lecteur (Adobe Reader) le tient ouvert.
  // Le Makefile écrit aussi « [pipeline-blocage] pdf-verrouille » ; cette règle couvre un
  // toolkit plus ancien que le cockpit. Le slug vient du chemin de destination, car la
  // ligne peut arriver sans ligne pandoc avant elle.
  m = ligne.match(/^mv: cannot move '.*?' to '(.+\.pdf)': Permission denied$/);
  if (m) {
    return { source: 'pipeline', code: 'pdf-verrouille', ton: 'danger',
             slug: slugDuPdf(nomFichier(m[1])), cle: '', args: [],
             champs: { fichier: m[1] }, brut: ligne };
  }
  return null;
}

// Les champs d'une ligne codée sont nommés : « article « 03-autre » », « champ « title » »,
// « tableau 2 », « appel « (Sen, 2001) » ». Un champ sans cette forme (un chemin, un
// « détail : … ») est ignoré. Les noms allemands sont acceptés par précaution.
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

// Une ligne du format à codes : le code, les champs et la phrase dans la langue demandée.
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
  // Le bilan de citations n'est gardé que si `ambigus` ou `sansref` n'est pas nul.
  if (famille.source === 'citations' && code === 'bilan'
      && Number(ch('ambigus')) === 0 && Number(ch('sansref')) === 0) { return null; }
  const args = ARGS[famille.source + '/' + code];
  // Un numéro nomme son unité « article », un livre « chapitre ». pdf-verrouille n'a ni
  // l'un ni l'autre : le slug se tire du fichier de destination (out/<slug>/<slug>.pdf),
  // sans quoi la carte n'aurait rien à ouvrir.
  let slug = ch('article') || ch('chapitre');
  if (!slug && famille.source === 'pipeline' && code === 'pdf-verrouille') {
    slug = slugDuPdf(nomFichier(ch('fichier')));
  }
  return {
    source: famille.source, code: code,
    ton: (TONS[famille.source] || {})[code] || famille.ton,
    slug: slug, cle: (CLES[famille.source] || {})[code] || '',
    args: args ? args(ch, langue) : [], champs: nommes,
    brut: (langue === 'de' && de !== '') ? de : fr
  };
}

// ---- Le journal entier -----------------------------------------------------------

// Les lignes « [pdf-ua] » se lisent en bloc : le titre d'une règle, sa cause et la
// correction arrivent sur des lignes successives, puis la même chose en allemand.
function lirePdfUa(reste, courant) {
  let m = reste.match(/^PDF\/UA-1\s*:?\s*(\S+)\s+—\s+(?:NON conforme|NICHT konform), (\d+)/);
  if (m) {
    return { source: 'pdfua', code: 'non-conforme', ton: 'danger', slug: slugDuPdf(m[1]),
             cle: 'ctl.pdfua.nonconforme', args: [m[2]], champs: {} };
  }
  m = reste.match(/^PDF\/UA-1\s*:?\s*(\S+)\s+—\s+(?:conforme|konform)\.$/);
  if (m) { return null; }                            // rien à dire d'un PDF conforme
  m = reste.match(/^\s*•\s*(.+)$/);
  if (m) {
    return { source: 'pdfua', code: 'regle', ton: 'danger', slug: courant.pdf,
             cle: '', args: [], champs: { regle: m[1], explication: '' }, brut: m[1] };
  }
  // Cause et correction d'une règle : rattachées au constat précédent.
  if (/^\s{4,}\S/.test(reste)) { return { suite: reste.trim() }; }
  // Repère ISO de la règle, qui dit où la corriger (CIBLES_REGLE_PDFUA, lib/constats.js).
  m = reste.match(/^\s*ISO 14289-1 (\S+)$/);
  if (m) { return { repere: m[1] }; }
  if (reste.indexOf('✗') === 0) {
    return { source: 'pdfua', code: 'outillage', ton: 'danger', slug: '',
             cle: '', args: [], champs: {}, brut: reste.replace(/^✗\s*/, '') };
  }
  return null;
}

function slugDuPdf(nom) {
  return String(nom).replace(/\.pdf$/i, '');
}

// verdictsPdfUa(texte) -> [{ fichier, verdict: 'conforme'|'non-conforme', regles,
// details: { fr: [{ regle, explication, repere }], de: [...] } }], avec une propriété
// `outillage: true` posée sur le tableau rendu si une ligne « [pdf-ua] ✗ » est présente.
// `details` garde chaque règle en échec dans les deux langues.
//
// Lit la sortie brute de verifier-ua.sh juste après son lancement (lib/pdfua-hote.js).
// Contrairement à analyserJournal(), le verdict conforme est gardé : il dit si l'article est
// bon à publier.
function verdictsPdfUa(texte) {
  const verdicts = [];
  const parFichier = new Map();
  // rapport-ua.py écrit un bloc entier par langue, le français d'abord.
  const verdictDe = (fichier, verdict, regles) => {
    let v = parFichier.get(fichier);
    if (!v) {
      v = { fichier: fichier, verdict: verdict, regles: regles, details: { fr: [], de: [] } };
      parFichier.set(fichier, v);
      verdicts.push(v);
    }
    return v;
  };
  let outillage = false;
  let fiche = null;
  let regle = null;
  for (const brute of String(texte === undefined || texte === null ? '' : texte).split(/\r?\n/)) {
    const ligne = brute.replace(/\s+$/, '');
    if (ligne === '') { continue; }
    const coupe = decouper(ligne);
    if (!coupe || coupe.prefixe !== 'pdf-ua') { regle = null; continue; }
    const langue = coupe.allemand ? 'de' : 'fr';
    let m = coupe.reste.match(/^PDF\/UA-1\s*:?\s*(\S+)\s+—\s+(?:NON conforme|NICHT konform), (\d+)/);
    if (m) { fiche = verdictDe(m[1], 'non-conforme', Number(m[2])); regle = null; continue; }
    m = coupe.reste.match(/^PDF\/UA-1\s*:?\s*(\S+)\s+—\s+(?:conforme|konform)\.$/);
    if (m) { verdictDe(m[1], 'conforme', 0); fiche = null; regle = null; continue; }
    m = coupe.reste.match(/^\s*•\s*(.+)$/);
    if (m && fiche) {
      regle = { regle: m[1], explication: '' };
      fiche.details[langue].push(regle);
      continue;
    }
    // Cause et correction (quatre espaces ou plus) ; le repère ISO n'en a que deux.
    if (regle && /^\s{4,}\S/.test(coupe.reste)) {
      regle.explication = (regle.explication + ' ' + coupe.reste).replace(/\s+/g, ' ').trim();
      continue;
    }
    m = coupe.reste.match(/^\s*ISO 14289-1 (\S+)$/);
    if (m && regle) { regle.repere = m[1]; regle = null; continue; }
    regle = null;
    if (!coupe.allemand && coupe.reste.indexOf('✗') === 0) { outillage = true; }
  }
  if (outillage) { verdicts.outillage = true; }
  return verdicts;
}

// Retire le résumé « PDF non conforme PDF/UA — N règle(s) » d'un article (slug, '' pour le
// livre) dont au moins une règle « pdfua/regle » est listée : sinon le défaut serait compté
// N + 1 fois. Sans règle lisible (ancien cache, bloc tronqué), le résumé reste, pour que
// l'article apparaisse dans « À corriger ». Le badge de la barre d'état ne lit pas ces
// constats (pdfuaHote.etat).
function sansResumePdfUaRedondant(constats) {
  const liste = Array.isArray(constats) ? constats : [];
  const detailles = new Set();
  for (const c of liste) {
    if (c && c.source === 'pdfua' && c.code === 'regle') { detailles.add(String(c.slug || '')); }
  }
  if (detailles.size === 0) { return liste; }
  return liste.filter((c) => !(c && c.source === 'pdfua' && c.code === 'non-conforme'
    && detailles.has(String(c.slug || ''))));
}

// La moitié demandée d'une ligne dont l'allemand suit « [de] » au milieu de la phrase
// (lignes « [import] » du Makefile).
function moitieInline(texte, langue) {
  const i = texte.indexOf('[de] ');
  if (i === -1) { return texte; }
  return (langue === 'de' ? texte.slice(i + 5) : texte.slice(0, i)).replace(/\s+$/, '');
}

// analyserJournal(texte, langue) -> [constat]
// `langue` ('fr' ou 'de') est celle du cockpit. Les deux moitiés de langue sont lues puis
// départagées à la fin, car certaines lignes n'existent qu'en français.
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
    // Les filtres ne nomment pas leur article : la ligne de commande pandoc qui précède le fait.
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
      if (constat && constat.repere) {
        if (dernier && dernier.moitie === moitie && dernier.code === 'regle') {
          dernier.champs.repere = constat.repere;
        }
        dernier = null;
        continue;
      }
      if (constat && constat.suite) {
        // Suite d'une règle : ajoutée au constat précédent s'il est de la même langue.
        if (dernier && dernier.moitie === moitie) {
          dernier.brut = dernier.brut + ' ' + constat.suite;
          if (dernier.champs.explication !== undefined) {
            dernier.champs.explication = (dernier.champs.explication + ' ' + constat.suite)
              .replace(/\s+/g, ' ').trim();
          }
        }
        continue;
      }
    }
    if (constat) { poser(constat, moitie); continue; }
    // Ligne non reconnue qui porte ⚠ ou ✗ : affichée brute.
    if (/[⚠✗]/.test(coupe.reste)) {
      poser({ source: coupe.prefixe === 'pdf-ua' ? 'pdfua' : 'pipeline',
              code: 'autre', ton: coupe.reste.indexOf('✗') !== -1 ? 'danger' : 'attention',
              slug: courant.slug, cle: '', args: [], champs: {},
              brut: moitieInline(coupe.reste, lang).replace(/^[⚠✗]\s*/, '') }, moitie);
      continue;
    }
    dernier = null;
  }
  return sansResumePdfUaRedondant(departager(constats, lang));
}

function complet(constat, moitie) {
  return {
    source: constat.source, code: constat.code, ton: constat.ton,
    cle: constat.cle || '', args: constat.args || [], slug: constat.slug || '',
    champs: constat.champs || {}, brut: constat.brut || '', moitie: moitie
  };
}

// Dédoublonne les constats :
//   * chaque article est compilé deux fois (PDF et aperçu) : de deux constats identiques,
//     on en garde un ;
//   * une ligne bilingue est lue dans ses deux moitiés : on garde celle de la langue du
//     cockpit.
// Sans clé d'i18n, deux jumeaux diffèrent par leur texte : on les apparie par leur rang
// dans leur moitié, les deux moitiés listant les mêmes choses dans le même ordre.
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
             slug: c.slug, champs: c.champs, brut: c.brut };
  });
}

// Les articles compilés lors de ce passage, d'après les lignes de commande pandoc.
// `make` est incrémental et le journal est réécrit à chaque tâche : l'hôte ne remplace que
// les constats de ces articles, et garde ceux des autres.
function slugsCompiles(texte) {
  const vus = new Set();
  for (const brute of String(texte === undefined || texte === null ? '' : texte).split(/\r?\n/)) {
    let m = brute.match(/^pandoc articles\/([^/]+)\//);
    if (!m) { m = brute.match(/^pandoc .* -> out\/([^/]+)\//); }
    if (m) { vus.add(m[1]); }
  }
  return vus;
}

// Les phrases des constats `bloc-mal-forme`, montrées dans une boîte de dialogue : un
// tableau qui porte les étiquettes d'une figure ou d'un tableau sans en avoir la forme
// s'imprime tel quel, sans numéro ni texte alternatif, et ne se répare que dans le Word.
// La phrase est celle du pipeline (`brut`), qui situe le tableau (page, rang, légende).
// Dédoublonnées : le journal d'import n'est pas vidé entre deux conversions.
function phrasesBlocMalForme(texte, langue) {
  const vues = [];
  for (const c of analyserJournal(texte, langue)) {
    if (c.source !== 'import' || c.code !== 'bloc-mal-forme') { continue; }
    const phrase = String(c.brut || '').trim();
    if (phrase !== '' && vues.indexOf(phrase) === -1) { vues.push(phrase); }
  }
  return vues;
}

// La phrase à montrer : celle du cockpit si le constat a une clé, celle du pipeline sinon.
function phraseConstat(constat, langue) {
  if (constat.cle) { return TL(langue, constat.cle, constat.args); }
  return constat.brut || '';
}

// Les comptes de la barre d'état, de la notification et de l'arbre. Comptés par la gravité
// de lib/constats.js, comme la vue « À corriger », et non par le ton (une carte regroupée
// n'en a pas). `contexte` est celui de la vue (controles-hote.contexteConstats) ; absent,
// la validation PDF/UA compte comme active.
function resumeJournal(constats, contexte) {
  let bloquants = 0, avertissements = 0, infos = 0;
  for (const c of constats || []) {
    const g = gravite(c, contexte);
    if (g === 'bloquant') { bloquants++; }
    else if (g === 'avert') { avertissements++; }
    else { infos++; }
  }
  return { bloquants: bloquants, avertissements: avertissements, infos: infos,
           total: bloquants + avertissements + infos };
}

// ---- Les citations, regroupées par article ---------------------------------------
//
// La vue « Articles » montre sur chaque carte l'état des références de l'article. Seuls
// comptent les codes d'un lien manquant ou douteux entre le texte et la bibliographie ; la
// vue « Contrôles » montre les autres.
const CODES_CITATIONS_CARTE = ['appel-sans-reference', 'appel-ambigu', 'reference-orpheline'];

// -> Map slug -> { 'appel-sans-reference': n, 'appel-ambigu': n, 'reference-orpheline': n,
//                  total: n }
// Un constat sans article n'est rattaché à aucune carte.
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
// Le cockpit lance le réimport et lit sa réponse, une ligne JSON sur la sortie standard ;
// ses messages vont dans le journal d'import. Les deux chemins partagent TONS_IMPORT et
// CLES_IMPORT.
//
// Ton de la notification, selon l'issue :
//   reussi   le texte vient du Word ; les avertissements disent ce que ça a coûté
//   rien     le Word n'apportait rien
//   refuse   rien n'a été touché, il y a une action à faire
//   echec    la conversion ou le disque a lâché ; l'article est intact
// Une issue absente ou inconnue vaut « danger ».
const TONS_RESULTAT_REIMPORT = {
  reussi: 'ok', rien: 'info', refuse: 'attention', echec: 'danger'
};

function tonResultatReimport(resultat) {
  const nom = String((resultat && resultat.resultat) || '');
  return TONS_RESULTAT_REIMPORT[nom] || 'danger';
}

// La ligne JSON du réimport -> des constats de même forme que ceux du journal. `slug` sert
// de repli : les refus précoces répondent sans nom d'article.
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
      // Pas de phrase de repli (le script écrit ses phrases sur la sortie d'erreur) : un
      // code sans clé d'i18n est écarté ; il reste lisible dans le journal d'import.
      brut: ''
    });
  }
  return constats.filter((c) => c.cle !== '');
}

module.exports = {
  TONS_IMPORT, CLES_IMPORT, TONS_RESULTAT_REIMPORT,
  analyserJournal, phrasesBlocMalForme, phraseConstat, resumeJournal, slugsCompiles,
  CODES_CITATIONS_CARTE, citationsParArticle,
  constatsReimport, tonResultatReimport,
  verdictsPdfUa, sansResumePdfUaRedondant
};
