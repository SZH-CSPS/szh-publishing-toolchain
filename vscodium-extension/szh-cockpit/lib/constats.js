// Pour chaque défaut : ce qu'il bloque, où on le corrige, et comment il s'écrit.
//
// Données et fonctions pures, sans `vscode` ni accès disque, comme lib/codes-erreur.js :
// l'extension et les tests le chargent. Le module ne produit aucun constat ; il décide de
// l'affichage de ceux que lib/journal.js lui passe. Trois décisions :
//
//  1. La couleur se calcule. Un constat porte la barrière qu'il ferme (la compilation, la
//     validation PDF/UA, l'export, ou l'opération qu'on venait de demander), et la couleur
//     s'en déduit : rouge si quelque chose refuse vraiment, sur ce poste et pour ce numéro.
//     La validation PDF/UA étant un réglage, une image sans description est rouge là où
//     elle tourne et ambre là où elle est éteinte : la couleur dit ce que la machine va
//     faire.
//
//  2. Le bouton. Une cinquantaine de codes, mais huit destinations (LIEUX) : le texte d'un
//     article, sa fiche, ses images, les métadonnées du numéro, les réglages, le dépôt
//     Word, la Documentation, l'aperçu. Un constat porte une cible, et une seule fonction
//     fabrique le bouton depuis LIEUX. Pas de cible quand l'application n'offre aucune
//     action (renommer un dossier se fait dans l'explorateur de Windows).
//
//  3. La phrase : « {défaut} : {objet} ». L'intitulé est un groupe nominal court ; l'objet
//     vient des champs du constat ; l'action est dans le bouton. Une carte a un second
//     étage (SECOND_ETAGE) : une phrase qui commence par l'action, et l'explication (ce qui
//     a été gardé ou perdu, la cause, le repère ISO) dans une infobulle.
//
// Tout code que lib/journal.js sait produire a sa ligne dans TABLE :
// test/js/constats.test.js lit la source de journal.js et échoue sur un code sans ligne ici.
'use strict';

const { TL } = require('./i18n');

// ---------------------------------------------------------------------------------------
// 1. Les huit destinations
// ---------------------------------------------------------------------------------------
//
// `commande` est appelée avec { slug, focus }. `focus` désigne, dans la page visée, ce
// qu'il faut amener à l'écran : une image pour le formulaire des médias, un champ pour une
// fiche.
const LIEUX = Object.freeze({
  article: Object.freeze({ commande: 'szh.ouvrirArticle', icone: 'fleche',
    libelle: 'action.article', tip: 'action.article.tip' }),
  fiche: Object.freeze({ commande: 'szh.metadonneesArticle', icone: 'info',
    libelle: 'action.fiche', tip: 'action.fiche.tip' }),
  medias: Object.freeze({ commande: 'szh.mediasArticle', icone: 'camera',
    libelle: 'action.medias', tip: 'action.medias.tip' }),
  // L'éditeur HTML d'un tableau de l'article. `focus` y nomme le fichier (table-01.html).
  // Sans focus, ouvrirEditeurTable (extension.js) ouvre le seul tableau de l'article, une
  // liste s'il y en a plusieurs, l'article s'il n'y en a aucun. C'est là que se déclare un
  // en-tête : le .md ne porte que la référence au tableau.
  table: Object.freeze({ commande: 'szh.editerTable', icone: 'tableau',
    libelle: 'action.table', tip: 'action.table.tip' }),
  numero: Object.freeze({ commande: 'szh.metadonnees', icone: 'gear',
    libelle: 'action.numero', tip: 'action.numero.tip' }),
  reglages: Object.freeze({ commande: 'szh.reglages', icone: 'gear',
    libelle: 'action.reglages', tip: 'action.reglages.tip' }),
  word: Object.freeze({ commande: 'szh.vueWord', icone: 'inbox',
    libelle: 'action.word', tip: 'action.word.tip' }),
  documentation: Object.freeze({ commande: 'szh.documentation', icone: 'megaphone',
    libelle: 'action.documentation', tip: 'action.documentation.tip' }),
  apercu: Object.freeze({ commande: 'szh.basculerApercu', icone: 'oeil',
    libelle: 'action.apercu', tip: 'action.apercu.tip' }),
  // Le PDF déjà produit d'un article précis, révélé dans l'Explorateur (szh.voirPdfArticle,
  // extension.js). Distinct d'« apercu » : basculerApercu bascule l'article en aperçu
  // courant et ne reçoit pas de slug, alors que voirPdfArticle accepte { slug, focus }.
  // Sert à pipeline/pdf-verrouille.
  pdf: Object.freeze({ commande: 'szh.voirPdfArticle', icone: 'oeil',
    libelle: 'action.pdf', tip: 'action.pdf.tip' }),
  // On corrige depuis l'avertissement, sans passer par le panneau d'export.
  pagination: Object.freeze({ commande: 'szh.rafraichirPagination', icone: 'imprimante',
    libelle: 'action.pagination', tip: 'action.pagination.tip' })
});

// ---------------------------------------------------------------------------------------
// 2. La table : une ligne par code
// ---------------------------------------------------------------------------------------
//
//   barrage    'compilation' | 'pdfua' | 'export' | 'geste' | null
//              La barrière que ce défaut ferme. 'geste' : l'opération demandée n'a pas eu
//              lieu ; aucune publication n'est bloquée, mais c'est un refus, donc rouge.
//   nature     'defaut'  quelque chose est faux ;
//              'attente' rien n'est faux, le travail n'a pas commencé ; jamais rouge, même
//                        quand la chaîne s'arrête faute de matière ;
//              'fait'    une information, rien à corriger ; gris.
//   lieu       une clé de LIEUX, ou '' quand l'application n'offre aucune action.
//   focusChamp le champ du constat qui désigne l'objet à atteindre dans ce lieu.
//   focusFixe  la même chose, quand l'objet est toujours le même.
//   defaut     la clé de l'intitulé court.
//   detail     la clé d'une seconde ligne, là où une seule ne suffit pas.
//   ciblesRepere  une cible par repère ISO (champ `repere` du constat), quand le lieu
//              dépend de la règle en cause et non du code.
const D = 'defaut';      // abrégés de lecture : la colonne `nature` se lit en diagonale
const A = 'attente';
const F = 'fait';

// Où se corrige une règle PDF/UA, par son repère ISO 14289-1 (la ligne « ISO 14289-1
// 7.1-9 » de pipeline/rapport-ua.py). Seules les règles qu'un rédacteur peut corriger ont
// une cible ; les autres sont des défauts de la chaîne (« signalez-le »). Les tableaux
// s'éditent dans leur éditeur : veraPDF ne nomme que des pages, regrouper() retrouve les
// tableaux, et une carte sans tableau identifié mène à la liste des tableaux.
const CIBLES_REGLE_PDFUA = Object.freeze({
  '7.1-9': Object.freeze({ lieu: 'fiche', focus: 'title' }),
  '7.2-29': Object.freeze({ lieu: 'fiche', focus: 'lang' }),
  '7.2-34': Object.freeze({ lieu: 'fiche', focus: 'lang' }),
  '7.3-1': Object.freeze({ lieu: 'medias', focus: '' }),
  '7.4.2-1': Object.freeze({ lieu: 'article', focus: '' }),
  '7.5-1': Object.freeze({ lieu: 'table', focus: '' }),
  '7.5-2': Object.freeze({ lieu: 'table', focus: '' })
});

const TABLE = Object.freeze({
  // ---- La compilation ------------------------------------------------------------
  'pipeline/titre-manquant': { barrage: 'compilation', nature: D, lieu: 'fiche',
    focusFixe: 'title', defaut: 'defaut.titre-manquant' },
  // Un dossier se renomme dans l'explorateur de Windows : pas de bouton.
  'pipeline/dossier-espaces': { barrage: 'compilation', nature: D, lieu: '',
    defaut: 'defaut.dossier-espaces', detail: 'detail.dossier-espaces' },
  'pipeline/aucun-article': { barrage: 'compilation', nature: A, lieu: 'word',
    defaut: 'defaut.aucun-article' },
  'pipeline/pas-une-revue': { barrage: 'compilation', nature: D, lieu: '',
    defaut: 'defaut.pas-une-revue' },
  'pipeline/profil-rien': { barrage: null, nature: F, lieu: 'numero',
    defaut: 'defaut.profil-rien' },
  'pipeline/profil-differe': { barrage: 'compilation', nature: D, lieu: 'numero',
    defaut: 'defaut.profil-differe' },
  'pipeline/profil-inconnu': { barrage: 'compilation', nature: D, lieu: 'numero',
    defaut: 'defaut.profil-inconnu' },
  // Le PDF est tenu ouvert par un lecteur : WeasyPrint a produit le fichier, c'est le
  // déplacement final qui a échoué. Le bouton révèle ce PDF dans l'Explorateur (lieu 'pdf',
  // szh.voirPdfArticle) ; le lecteur se ferme à la main, le détail le dit.
  'pipeline/pdf-verrouille': { barrage: 'compilation', nature: D, lieu: 'pdf',
    focusChamp: 'fichier', defaut: 'defaut.pdf-verrouille', detail: 'detail.pdf-verrouille' },
  // ---- Le balisage du PDF --------------------------------------------------------
  'pipeline/balisage-simple': { barrage: null, nature: D, lieu: '',
    defaut: 'defaut.balisage-simple' },
  'pipeline/balisage-aucun': { barrage: 'pdfua', nature: D, lieu: '',
    defaut: 'defaut.balisage-aucun' },
  // ---- La mise en page -----------------------------------------------------------
  // Une image introuvable ne bloque rien : le PDF sort, sans l'image. Ambre.
  'rendu/image-manquante': { barrage: null, nature: D, lieu: 'medias',
    focusChamp: 'image', defaut: 'defaut.image-manquante' },
  'rendu/niveaux-ecrases': { barrage: null, nature: D, lieu: 'article',
    defaut: 'defaut.niveaux-ecrases' },
  'rendu/police-manquante': { barrage: null, nature: D, lieu: '',
    defaut: 'defaut.police-manquante' },
  // ---- La typographie (szh-typographie.lua) ---------------------------------------
  // Le champ « mot » est omis quand le filtre n'a pas retrouvé le mot : la flèche mène alors
  // à l'article sans position (focus '', voir valeurChamp()).
  'typo/eszett': { barrage: null, nature: D, lieu: 'article', focusChamp: 'mot',
    defaut: 'defaut.typo-eszett', detail: 'detail.typo-eszett' },
  'typo/guillemets-droits': { barrage: null, nature: D, lieu: 'article', focusChamp: 'mot',
    defaut: 'defaut.typo-guillemets-droits', detail: 'detail.typo-guillemets-droits' },
  'typo/majuscule-accentuee': { barrage: null, nature: D, lieu: 'article', focusChamp: 'mot',
    defaut: 'defaut.typo-majuscule-accentuee', detail: 'detail.typo-majuscule-accentuee' },
  // ---- Les images natives Word (szh-metafichier.lua) ------------------------------
  'metafichier/image-native-word': { barrage: null, nature: D, lieu: 'medias',
    focusChamp: 'image', defaut: 'defaut.metafichier-image-native' },
  // Le toolkit de ce poste n'a pas l'image de remplacement : un défaut de déploiement, que
  // l'application ne corrige pas.
  'metafichier/placeholder-introuvable': { barrage: null, nature: D, lieu: '',
    defaut: 'defaut.metafichier-placeholder-introuvable' },
  // ---- Les métadonnées et la langue ----------------------------------------------
  'meta/champ-vide': { barrage: 'compilation', nature: D, lieu: 'fiche',
    focusChamp: 'champ', defaut: 'defaut.champ-vide' },
  'meta/marque-champ': { barrage: 'compilation', nature: D, lieu: 'fiche',
    focusChamp: 'champ', defaut: 'defaut.marque-champ' },
  'meta/marque-motcle': { barrage: 'compilation', nature: D, lieu: 'fiche',
    focusFixe: 'keywords', defaut: 'defaut.marque-motcle' },
  'meta/sans-langue': { barrage: null, nature: D, lieu: 'fiche',
    focusFixe: 'lang', defaut: 'defaut.sans-langue' },
  'meta/langue-inconnue': { barrage: 'compilation', nature: D, lieu: 'fiche',
    focusFixe: 'lang', defaut: 'defaut.langue-inconnue' },
  // ---- Les figures ---------------------------------------------------------------
  // Rouge : une image informative sans texte alternatif fait échouer la validation PDF/UA,
  // donc l'export. Ambre sur un poste où cette validation est éteinte.
  'numerotation/figure-sans-alt': { barrage: 'pdfua', nature: D, lieu: 'medias',
    focusChamp: 'image', defaut: 'defaut.figure-sans-alt' },
  // ---- L'accessibilité du PDF ----------------------------------------------------
  'pdfua/aucun-pdf': { barrage: null, nature: A, lieu: '', defaut: 'defaut.aucun-pdf' },
  'pdfua/non-conforme': { barrage: 'pdfua', nature: D, lieu: '',
    defaut: 'defaut.pdfua-non-conforme', detail: 'detail.pdfua-non-conforme' },
  // La règle se nomme dans la phrase ; sa cause et l'action à faire viennent du champ
  // `explication` (consigne(), infobulle()).
  // objetSeul : le titre de la carte est la règle elle-même (« Le document n'a pas de titre
  // (1 fois, page 3) »), sans le préfixe « Règle PDF/UA non respectée » que la source de
  // la carte dit déjà.
  'pdfua/regle': { barrage: 'pdfua', nature: D, lieu: '', objetChamp: 'regle', objetSeul: true,
    detailChamp: 'explication', ciblesRepere: CIBLES_REGLE_PDFUA, defaut: 'defaut.pdfua-regle' },
  'pdfua/outillage': { barrage: null, nature: D, lieu: '', defaut: 'defaut.pdfua-outillage' },
  // ---- Les citations -------------------------------------------------------------
  'citations/appel-sans-reference': { barrage: null, nature: D, lieu: 'article',
    focusChamp: 'appel', defaut: 'defaut.appel-sans-reference' },
  'citations/appel-ambigu': { barrage: null, nature: D, lieu: 'article',
    focusChamp: 'appel', defaut: 'defaut.appel-ambigu' },
  'citations/reference-orpheline': { barrage: null, nature: D, lieu: 'article',
    focusChamp: 'reference', defaut: 'defaut.reference-orpheline' },
  'citations/ancrage-inconnu': { barrage: null, nature: D, lieu: 'article',
    focusChamp: 'ancrage', defaut: 'defaut.ancrage-inconnu' },
  'citations/caractere-sans-repli': { barrage: null, nature: F, lieu: '',
    defaut: 'defaut.caractere-sans-repli' },
  'citations/bilan': { barrage: null, nature: F, lieu: '', defaut: 'defaut.bilan' },
  // ---- L'import des Word ---------------------------------------------------------
  'import/echec': { barrage: 'geste', nature: D, lieu: 'word', focusChamp: 'fichier',
    defaut: 'defaut.import-echec' },
  // Le .docx est endommagé : rien n'est créé, le Word reste en attente. Même barrage que l'échec.
  'import/fichier-illisible': { barrage: 'geste', nature: D, lieu: 'word',
    defaut: 'defaut.fichier-illisible' },
  'import/restes': { barrage: null, nature: A, lieu: 'word', defaut: 'defaut.import-restes' },
  // La flèche vise un extrait repérable de la première cellule (« debut », écrit par
  // docx-tables.py) ; la phrase nomme le tableau (« tableau ») : objetChamp passe avant
  // focusChamp dans objet(), pour que cible et objet soient deux champs distincts.
  // Un en-tête se déclare dans l'éditeur du tableau, pas dans le texte : la flèche y mène,
  // sur le fichier que docx-tables.py a écrit (table-02.html pour « tableau 2 », focusTable).
  // `debut` reste lu par la carte regroupée.
  'import/tableau-sans-entete': { barrage: null, nature: D, lieu: 'table',
    focusTable: 'tableau', objetChamp: 'tableau', defaut: 'defaut.tableau-sans-entete' },
  'import/langue-deduite': { barrage: null, nature: F, lieu: 'fiche', focusFixe: 'lang',
    defaut: 'defaut.langue-deduite' },
  // Titre et sous-titre sont voisins dans le formulaire : la carte ouvre le premier, et
  // la coupe se défait d'un copier-coller.
  'import/sous-titre-deduit': { barrage: null, nature: F, lieu: 'fiche', focusFixe: 'title',
    objetChamp: 'soustitre', defaut: 'defaut.sous-titre-deduit' },
  'import/word-redepose': { barrage: null, nature: F, lieu: 'word', focusChamp: 'fichier',
    defaut: 'defaut.word-redepose' },
  // ---- Le lecteur du gabarit « Pronto » -------------------------------------------
  //
  // La correction se fait presque toujours dans le Word, qui porte l'étiquette mal tapée,
  // le bloc mal formé ou le champ vide : lieu `word`, pas `article` (le .md n'existe pas
  // quand l'import est refusé). Les deux exceptions sont des champs de la fiche.
  //
  // `barrage: 'geste'` sur les quatre premiers : l'import a été refusé, l'article n'est pas
  // dans le numéro, et le Word attend toujours. Même barrage que « import/echec ».
  'import/etiquette-metadonnees-inconnue': { barrage: 'geste', nature: D, lieu: 'word',
    focusChamp: 'fichier', objetChamp: 'etiquette', defaut: 'defaut.pronto-meta-inconnue' },
  // Étiquette reconnue (par exemple « Mots-clés »), mais le gabarit n'a pas de case pour
  // elle. Même barrage.
  'import/metadonnees-champ-hors-gabarit': { barrage: 'geste', nature: D, lieu: 'word',
    focusChamp: 'fichier', objetChamp: 'champ', defaut: 'defaut.pronto-meta-hors-gabarit' },
  'import/auteur-etiquette-inconnue': { barrage: 'geste', nature: D, lieu: 'word',
    focusChamp: 'fichier', objetChamp: 'ligne', defaut: 'defaut.pronto-auteur-inconnue' },
  // Champ reconnu que le gabarit ne porte pas (adresse, biographie, téléphone, photo). Même
  // barrage (l'import est refusé, la valeur serait perdue), mais un intitulé distinct :
  // l'étiquette est juste, c'est le gabarit qui n'a pas de case.
  'import/auteur-champ-hors-gabarit': { barrage: 'geste', nature: D, lieu: 'word',
    focusChamp: 'fichier', objetChamp: 'champ', defaut: 'defaut.pronto-champ-hors-gabarit' },
  'import/bloc-etiquette-inconnue': { barrage: 'geste', nature: D, lieu: 'word',
    focusChamp: 'fichier', objetChamp: 'etiquette', defaut: 'defaut.pronto-bloc-inconnue' },
  'import/cle-ambigue': { barrage: 'geste', nature: D, lieu: 'word', focusChamp: 'fichier',
    objetChamp: 'clé', defaut: 'defaut.pronto-cle-ambigue' },
  // L'article est importé : pas de barrage, mais une correction à faire dans le Word avant
  // la prochaine version.
  'import/cle-approximee': { barrage: null, nature: D, lieu: 'word', focusChamp: 'fichier',
    objetChamp: 'clé', defaut: 'defaut.pronto-cle-approximee' },
  'import/structure-inattendue': { barrage: null, nature: D, lieu: 'word',
    focusChamp: 'fichier', defaut: 'defaut.pronto-structure' },
  'import/bloc-ancienne-forme': { barrage: null, nature: D, lieu: 'word',
    focusChamp: 'fichier', defaut: 'defaut.pronto-bloc-ancien' },
  'import/bloc-contenu-absent': { barrage: null, nature: D, lieu: 'word', focusChamp: 'fichier',
    defaut: 'defaut.pronto-bloc-vide' },
  'import/bloc-cles-sans-contenu': { barrage: null, nature: D, lieu: 'word',
    focusChamp: 'fichier', defaut: 'defaut.pronto-cles-sans-contenu' },
  // Un tableau qui porte les étiquettes d'un bloc sans en avoir la forme. L'import ouvre
  // aussi une boîte de dialogue (lib/import-hote.js) : il faut rouvrir le Word.
  'import/bloc-mal-forme': { barrage: null, nature: D, lieu: 'word', focusChamp: 'fichier',
    defaut: 'defaut.pronto-bloc-mal-forme' },
  // Ce que l'import n'a pas su ranger est resté visible dans le texte : la flèche y mène
  // (valeur, image), et il reste à le ranger. szh-legendes.lua et docx-controle-import.py
  // émettent ces codes sans entrée dans CLES_IMPORT : la phrase de la chaîne s'affiche en
  // repli, comme pour bloc-mal-forme.
  'import/bloc-valeur-non-reprise': { barrage: null, nature: D, lieu: 'article',
    focusChamp: 'valeur', defaut: 'defaut.bloc-valeur-non-reprise' },
  'import/image-absente-import': { barrage: null, nature: D, lieu: 'article',
    focusChamp: 'image', defaut: 'defaut.image-absente-import' },
  // Une image d'un groupe sans texte alternatif : même couleur et même action que la figure
  // sans description de la compilation, mais dit dès l'import.
  'import/figure-alt-a-completer': { barrage: null, nature: D, lieu: 'medias',
    focusChamp: 'image', defaut: 'defaut.figure-alt-a-completer' },
  // Tableau d'images sous-titrées gardé en tableau : rien n'est perdu, une information.
  // Le texte d'un tableau du Word ne se retrouve pas dans l'article : à reprendre à la main.
  'import/tableau-texte-perdu': { barrage: null, nature: D, lieu: 'article',
    defaut: 'defaut.tableau-texte-perdu' },
  'import/tableau-images-et-texte': { barrage: null, nature: F, lieu: 'word',
    defaut: 'defaut.tableau-images-et-texte' },
  'import/biblio-tableau-apres-titre': { barrage: null, nature: D, lieu: 'word',
    focusChamp: 'fichier', defaut: 'defaut.pronto-biblio-tableau' },
  // Le type se choisit dans la fiche, pas dans le Word.
  'import/type-article-non-reconnu': { barrage: null, nature: D, lieu: 'fiche',
    focusFixe: 'type', objetChamp: 'valeur', defaut: 'defaut.pronto-type-inconnu' },
  // Les trois informations : rien n'est perdu, rien à faire tout de suite.
  'import/cle-attendue-absente': { barrage: null, nature: F, lieu: 'word',
    focusChamp: 'fichier', objetChamp: 'clé', defaut: 'defaut.pronto-cle-absente' },
  'import/blocs-colles': { barrage: null, nature: F, lieu: 'word', focusChamp: 'fichier',
    defaut: 'defaut.pronto-blocs-colles' },
  // La langue se corrige dans la fiche : c'est la seule façon de déclarer un article
  // italien, le gabarit n'ayant pas ce champ.
  'import/langue-du-document-ignoree': { barrage: null, nature: F, lieu: 'fiche',
    focusFixe: 'lang', defaut: 'defaut.pronto-langue-ignoree' },
  'import/origine-inconnue': { barrage: null, nature: D, lieu: 'word', focusChamp: 'fichier',
    defaut: 'defaut.origine-inconnue' },
  // Quatre codes de docx-meta.py.
  'import/tableau-auteurs-non-lu': { barrage: null, nature: D, lieu: 'article',
    defaut: 'defaut.tableau-auteurs-non-lu' },
  'import/biblio-references-restees': { barrage: null, nature: D, lieu: 'article',
    defaut: 'defaut.biblio-references-restees' },
  'import/biblio-non-detachee': { barrage: null, nature: D, lieu: 'article',
    defaut: 'defaut.biblio-non-detachee' },
  // Le crédit de photo n'a pas de champ dans la fiche : une information.
  'import/credit-photo-non-repris': { barrage: null, nature: F, lieu: '',
    defaut: 'defaut.credit-photo-non-repris' },
  // ---- Le réimport d'un Word corrigé ---------------------------------------------
  'import/reimport-sans-article': { barrage: null, nature: D, lieu: 'word',
    defaut: 'defaut.reimport-sans-article' },
  'import/reimport-sans-word': { barrage: null, nature: D, lieu: 'word',
    defaut: 'defaut.reimport-sans-word' },
  'import/reimport-fiche-sans-source': { barrage: null, nature: D, lieu: 'word',
    defaut: 'defaut.reimport-fiche-sans-source' },
  'import/reimport-plusieurs-articles': { barrage: null, nature: D, lieu: 'word',
    defaut: 'defaut.reimport-plusieurs-articles' },
  'import/reimport-echec': { barrage: 'geste', nature: D, lieu: '',
    defaut: 'defaut.reimport-echec' },
  'import/reimport-panne': { barrage: 'geste', nature: D, lieu: '',
    defaut: 'defaut.reimport-panne' },
  // Interrompu par la personne qui l'avait lancé : rien n'a été remplacé à moitié, et ce
  // n'est pas un échec. Ambre.
  'import/reimport-interrompu': { barrage: null, nature: D, lieu: '',
    defaut: 'defaut.reimport-interrompu' },
  'import/reimport-reprise-impossible': { barrage: 'geste', nature: D, lieu: '',
    defaut: 'defaut.reimport-reprise-impossible' },
  'import/reimport-reprise': { barrage: null, nature: F, lieu: '',
    defaut: 'defaut.reimport-reprise' },
  'import/annuler-sans-etat': { barrage: 'geste', nature: D, lieu: '',
    defaut: 'defaut.annuler-sans-etat' },
  'import/fiche-du-word-differente': { barrage: null, nature: D, lieu: 'fiche',
    defaut: 'defaut.fiche-differente', detail: 'detail.fiche-differente' },
  // Les tableaux se refont dans leur éditeur : sans tableau nommé, la liste des tableaux.
  'import/tableau-conflit': { barrage: null, nature: D, lieu: 'table',
    defaut: 'defaut.tableau-conflit', detail: 'detail.tableau-conflit' },
  'import/tableaux-origine-inconnue': { barrage: null, nature: F, lieu: '',
    defaut: 'defaut.tableaux-inconnus' },
  'import/image-non-reimportee': { barrage: null, nature: D, lieu: 'medias',
    defaut: 'defaut.image-perdue', detail: 'detail.image-perdue' },
  'import/corps-retravaille': { barrage: null, nature: D, lieu: 'article',
    defaut: 'defaut.corps-retravaille', detail: 'detail.corps-retravaille' },
  'import/biblio-conflit': { barrage: null, nature: D, lieu: 'article',
    defaut: 'defaut.biblio-conflit', detail: 'detail.biblio-conflit' },
  'import/biblio-retiree': { barrage: null, nature: F, lieu: '',
    defaut: 'defaut.biblio-retiree' },
  'import/biblio-origine-inconnue': { barrage: null, nature: F, lieu: '',
    defaut: 'defaut.biblio-inconnue' },
  // ---- La bibliographie détachée à l'import --------------------------------------
  //
  // szh-biblio-detacher.lua sort la liste des références du corps de l'article et
  // l'enregistre à part. Le cas normal est une simple information.
  'import/biblio-detachee': { barrage: null, nature: F, lieu: '',
    defaut: 'defaut.biblio-detachee' },
  // Des paragraphes sont restés dans le texte, juste après la liste. Rien n'est perdu et
  // le PDF sort : ambre, avec un bouton vers le texte de l'article. Le compte est dans le
  // détail et non en objet : « restés dans le texte : 2 Rien n'est perdu » se lisait mal.
  'import/biblio-incomplete': { barrage: null, nature: D, lieu: 'article',
    defaut: 'defaut.biblio-incomplete', detail: 'detail.biblio-incomplete' },
  'import/biblio-bornes-perdues': { barrage: null, nature: D, lieu: 'article',
    defaut: 'defaut.biblio-bornes-perdues', detail: 'detail.biblio-bornes-perdues' },
  // Le dossier du numéro refuse l'écriture : le cockpit n'y peut rien, pas de bouton.
  'import/biblio-fichier-refuse': { barrage: null, nature: D, lieu: '',
    defaut: 'defaut.biblio-fichier-refuse', detail: 'detail.biblio-fichier-refuse' },
  // ---- La scission d'un manuscrit de livre (livre-scinder.py) --------------------
  // Préfixe « [scission-avertissement] » pour tous, mais deux d'entre eux appellent
  // sys.exit(1) juste après : ils arrêtent la compilation.
  'scission/aucun-titre-niveau-1': { barrage: 'compilation', nature: D, lieu: 'article',
    defaut: 'defaut.scission-aucun-titre' },
  // Un dossier de chapitre porte déjà ce nom, sans rapport avec ce manuscrit : à renommer
  // dans l'explorateur de Windows, le cockpit ne le fait pas.
  'scission/chapitre-cible-existe': { barrage: 'compilation', nature: D, lieu: '',
    defaut: 'defaut.scission-chapitre-existe' },
  'scission/image-introuvable': { barrage: null, nature: D, lieu: 'medias',
    focusChamp: 'image', defaut: 'defaut.scission-image-introuvable' },
  'scission/tableau-introuvable': { barrage: null, nature: D, lieu: 'article',
    focusChamp: 'tableau', defaut: 'defaut.scission-tableau-introuvable' },
  'scission/liminaire-texte-non-repris': { barrage: null, nature: D, lieu: 'numero',
    defaut: 'defaut.scission-liminaire-texte-non-repris' },
  'scission/liminaire-texte-media-introuvable': { barrage: null, nature: D, lieu: 'medias',
    focusChamp: 'média', defaut: 'defaut.scission-liminaire-texte-media-introuvable' },
  'scission/liminaire-media-introuvable': { barrage: null, nature: D, lieu: 'medias',
    focusChamp: 'média', defaut: 'defaut.scission-liminaire-media-introuvable' },
  // Le dossier d'origine reste sur le disque, en plus des nouveaux chapitres : une
  // information à lire, le nettoyage qui suit est manuel.
  'scission/source-non-supprimee': { barrage: null, nature: F, lieu: '',
    defaut: 'defaut.scission-source-non-supprimee' },
  // ---- Le livre ------------------------------------------------------------------
  'livre/liminaire-introuvable': { barrage: 'compilation', nature: D, lieu: 'numero',
    focusChamp: 'pièce', defaut: 'defaut.liminaire-introuvable' },
  'livre/chapitre-ecarte': { barrage: null, nature: F, lieu: '',
    focusChamp: 'chapitre', defaut: 'defaut.chapitre-ecarte' },
  'livre/chapitre-introuvable': { barrage: 'compilation', nature: D, lieu: 'numero',
    focusChamp: 'chapitre', defaut: 'defaut.chapitre-introuvable' },
  // ---- Ce que le cockpit voit sans compiler ---------------------------------------
  // Ces constats ne viennent pas du journal : le cockpit les calcule en lisant le numéro.
  // Ils suivent la même table, pour que la carte d'un article et la liste « À corriger »
  // concordent.
  'cockpit/sans-fiche': { barrage: 'compilation', nature: D, lieu: 'fiche',
    focusFixe: 'title', defaut: 'defaut.sans-fiche' },
  // La chaîne s'est arrêtée sans qu'aucun constat du journal ne dise pourquoi : posé par
  // relireJournal (lib/controles-hote.js). Les dernières lignes du journal vont dans `brut`,
  // donc dans l'infobulle.
  'cockpit/compilation-echec': { barrage: 'compilation', nature: D, lieu: '',
    defaut: 'defaut.compilation-echec' },
  'cockpit/doi-double': { barrage: 'export', nature: D, lieu: 'fiche', focusFixe: 'doi',
    defaut: 'defaut.doi-double' },
  // Pagination continue du numéro (pipeline/pagination.py, émis par `make pdf` dès qu'un
  // numéro a été paginé) : les folios imprimés sont faux. Sans barrage, donc ambre : on
  // continue d'écrire et de compiler. Le refus est à l'export (lib/export-ojs.js refuse un
  // numéro à la pagination périmée, en rouge sous export/refus) ; avec barrage: 'export'
  // ici, chaque article décalé serait rouge pendant toute la rédaction. Posé sur l'article
  // dont la longueur ou la place a changé, et sur tous ceux qui le suivent.
  'pagination/perimee': { barrage: null, nature: D, lieu: 'pagination',
    defaut: 'defaut.pagination-perimee', detail: 'detail.pagination-perimee' },
  'cockpit/image-sans-alt': { barrage: 'pdfua', nature: D, lieu: 'medias',
    focusChamp: 'image', defaut: 'defaut.figure-sans-alt' },
  // L'export refuse, et chaque raison devient une carte. Le lieu dépend de la raison (les
  // réglages OJS pour un champ de configuration, la fiche de l'article sinon) : c'est le
  // constat qui le porte.
  'export/refus': { barrage: 'export', nature: D, lieu: '',
    defaut: 'defaut.export-refus', objetChamp: 'raison' },
  'cockpit/image-sans-legende': { barrage: null, nature: D, lieu: 'medias',
    focusChamp: 'image', defaut: 'defaut.image-sans-legende' },
  // ---- Les cartes regroupées (regrouper(), plus bas) --------------------------------
  // Une seule carte pour un défaut arrivé par plusieurs voies : le compte dans le titre
  // (`compte`), un lien par objet (champs.elements), une phrase, un bouton.
  'cockpit/images-sans-description': { barrage: 'pdfua', nature: D, lieu: 'medias', compte: true,
    defaut: 'defaut.images-sans-description' },
  // Deux gravités pour les tableaux : rouge quand le validateur PDF/UA a refusé (7.5-1,
  // 7.5-2), ambre quand seul l'import a douté (un tableau sans en-tête peut être légitime).
  'cockpit/tableaux-entete': { barrage: 'pdfua', nature: D, lieu: 'table', compte: true,
    defaut: 'defaut.tableaux-entete' },
  'cockpit/tableaux-sans-entete': { barrage: null, nature: D, lieu: 'table', compte: true,
    defaut: 'defaut.tableaux-sans-entete' },
  // Une case d'en-tête (th) sans intitulé : un lecteur d'écran annonce une colonne sans nom.
  // Le cockpit la voit en lisant les tableaux de l'article (constatEnteteVide). Ambre
  // seulement : ni la validation PDF/UA ni l'export ne la refusent.
  'cockpit/entete-vide': { barrage: null, nature: D, lieu: 'table', compte: true,
    defaut: 'defaut.entete-vide' },
  // Les champs du gabarit « Pronto » laissés vides (import/cle-attendue-absente) : une carte
  // par article, un lien par champ, là où il se remplit (la fiche pour l'en-tête et les
  // auteurs, Médias pour les clés d'une figure).
  'cockpit/champs-gabarit-vides': { barrage: null, nature: F, lieu: 'fiche', compte: true,
    defaut: 'defaut.champs-gabarit-vides' }
});

// ---------------------------------------------------------------------------------------
// 2 bis. Le second étage d'une carte : une phrase d'action, et le pourquoi en infobulle
// ---------------------------------------------------------------------------------------
//
// Une carte « À corriger » se lit en quatre temps : un titre court (defaut.* et son objet),
// l'objet en cause (un lien par objet s'il y en a plusieurs), une phrase qui commence par
// l'action (consigne), un bouton. L'explication (pourquoi c'est un défaut, ce qui a été
// gardé ou perdu, le repère ISO) va dans l'infobulle.
//
// `consigne` : la clé de la phrase d'action. Ses arguments sont ceux du constat.
// `infobulle` : la clé d'une explication, quand ni le message ctl.* du constat ni la
// phrase de la chaîne n'en portent une (voir infobulle() pour l'ordre des replis).
// Une information (nature 'fait') peut n'avoir aucune consigne : elle ne demande rien.
const SECOND_ETAGE = Object.freeze({
  'pipeline/titre-manquant': { consigne: 'consigne.titre-manquant' },
  'pipeline/dossier-espaces': { consigne: 'consigne.dossier-espaces' },
  'pipeline/aucun-article': { consigne: 'consigne.aucun-article' },
  'pipeline/pas-une-revue': { consigne: 'consigne.pas-une-revue' },
  'pipeline/profil-rien': { consigne: 'consigne.profil-rien' },
  'pipeline/profil-differe': { consigne: 'consigne.profil' },
  'pipeline/profil-inconnu': { consigne: 'consigne.profil' },
  'pipeline/pdf-verrouille': { consigne: 'detail.pdf-verrouille' },
  'pipeline/balisage-simple': { consigne: 'consigne.signaler' },
  'pipeline/balisage-aucun': { consigne: 'consigne.signaler' },
  'rendu/image-manquante': { consigne: 'consigne.image-manquante' },
  'rendu/niveaux-ecrases': { consigne: 'consigne.niveaux-ecrases' },
  'rendu/police-manquante': { consigne: 'consigne.signaler' },
  'typo/eszett': { consigne: 'consigne.typo-eszett' },
  'typo/guillemets-droits': { consigne: 'consigne.typo-guillemets-droits' },
  'typo/majuscule-accentuee': { consigne: 'consigne.typo-majuscule-accentuee' },
  'metafichier/image-native-word': { consigne: 'consigne.metafichier-image-native' },
  'metafichier/placeholder-introuvable': { consigne: 'consigne.signaler' },
  'meta/champ-vide': { consigne: 'consigne.champ-vide' },
  'meta/marque-champ': { consigne: 'consigne.marque-champ' },
  'meta/marque-motcle': { consigne: 'consigne.marque-motcle' },
  'meta/sans-langue': { consigne: 'consigne.sans-langue' },
  'meta/langue-inconnue': { consigne: 'consigne.langue-inconnue' },
  'numerotation/figure-sans-alt': { consigne: 'consigne.images-sans-description',
    infobulle: 'infobulle.images-sans-description' },
  'pdfua/aucun-pdf': { consigne: 'consigne.aucun-pdf' },
  'pdfua/non-conforme': { consigne: 'consigne.pdfua-non-conforme' },
  'pdfua/outillage': { consigne: 'consigne.signaler' },
  'citations/appel-sans-reference': { consigne: 'consigne.appel-sans-reference' },
  'citations/appel-ambigu': { consigne: 'consigne.appel-ambigu' },
  'citations/reference-orpheline': { consigne: 'consigne.reference-orpheline' },
  'citations/ancrage-inconnu': { consigne: 'consigne.ancrage-inconnu' },
  'import/echec': { consigne: 'consigne.import-echec' },
  'import/fichier-illisible': { consigne: 'consigne.fichier-illisible' },
  'import/tableau-texte-perdu': { consigne: 'consigne.tableau-texte-perdu' },
  'import/restes': { consigne: 'consigne.import-restes' },
  'import/tableau-sans-entete': { consigne: 'consigne.tableau-sans-entete' },
  'import/langue-deduite': { consigne: 'consigne.langue-deduite' },
  'import/sous-titre-deduit': { consigne: 'consigne.sous-titre-deduit' },
  'import/word-redepose': { consigne: 'consigne.word-redepose' },
  'import/origine-inconnue': { consigne: 'consigne.origine-inconnue' },
  'import/etiquette-metadonnees-inconnue': { consigne: 'consigne.pronto-etiquette' },
  'import/auteur-etiquette-inconnue': { consigne: 'consigne.pronto-etiquette' },
  'import/auteur-champ-hors-gabarit': { consigne: 'consigne.pronto-champ-hors-gabarit' },
  'import/metadonnees-champ-hors-gabarit': { consigne: 'consigne.pronto-meta-hors-gabarit' },
  'import/bloc-etiquette-inconnue': { consigne: 'consigne.pronto-etiquette' },
  'import/cle-ambigue': { consigne: 'consigne.pronto-cle-ambigue' },
  'import/cle-approximee': { consigne: 'consigne.pronto-cle-approximee' },
  'import/structure-inattendue': { consigne: 'consigne.pronto-structure' },
  'import/bloc-ancienne-forme': { consigne: 'consigne.pronto-bloc-ancien' },
  'import/bloc-contenu-absent': { consigne: 'consigne.pronto-bloc-vide' },
  'import/bloc-cles-sans-contenu': { consigne: 'consigne.pronto-cles-sans-contenu' },
  'import/bloc-mal-forme': { consigne: 'consigne.pronto-bloc-mal-forme' },
  'import/bloc-valeur-non-reprise': { consigne: 'consigne.bloc-valeur-non-reprise' },
  'import/image-absente-import': { consigne: 'consigne.image-absente-import' },
  'import/figure-alt-a-completer': { consigne: 'consigne.figure-alt-a-completer' },
  'import/biblio-tableau-apres-titre': { consigne: 'consigne.pronto-biblio-tableau' },
  'import/type-article-non-reconnu': { consigne: 'consigne.pronto-type-inconnu' },
  'import/cle-attendue-absente': { consigne: 'consigne.pronto-cle-absente' },
  'import/langue-du-document-ignoree': { consigne: 'consigne.pronto-langue-ignoree' },
  'import/tableau-auteurs-non-lu': { consigne: 'consigne.tableau-auteurs-non-lu' },
  'import/biblio-references-restees': { consigne: 'consigne.biblio-style' },
  'import/biblio-non-detachee': { consigne: 'consigne.biblio-style' },
  'import/credit-photo-non-repris': { consigne: 'consigne.credit-photo-non-repris' },
  'import/reimport-sans-article': { consigne: 'consigne.reimport-sans-article' },
  'import/reimport-sans-word': { consigne: 'consigne.reimport-sans-word' },
  'import/reimport-fiche-sans-source': { consigne: 'consigne.reimport-fiche-sans-source' },
  'import/reimport-plusieurs-articles': { consigne: 'consigne.reimport-plusieurs-articles' },
  'import/reimport-echec': { consigne: 'consigne.reimport-echec' },
  'import/reimport-panne': { consigne: 'consigne.reimport-panne' },
  'import/reimport-interrompu': { consigne: 'consigne.reimport-interrompu' },
  'import/reimport-reprise-impossible': { consigne: 'consigne.reimport-reprise-impossible' },
  // Rien n'a été touché, et il n'y a rien à faire : l'infobulle (ctl.*) le dit.
  'import/annuler-sans-etat': {},
  'import/fiche-du-word-differente': { consigne: 'consigne.fiche-differente' },
  'import/tableau-conflit': { consigne: 'consigne.tableau-conflit' },
  'import/image-non-reimportee': { consigne: 'consigne.image-perdue' },
  'import/corps-retravaille': { consigne: 'consigne.corps-retravaille' },
  'import/biblio-conflit': { consigne: 'consigne.biblio-conflit' },
  'import/biblio-incomplete': { consigne: 'consigne.biblio-style' },
  'import/biblio-bornes-perdues': { consigne: 'consigne.signaler-cas' },
  'import/biblio-fichier-refuse': { consigne: 'consigne.biblio-fichier-refuse' },
  'scission/aucun-titre-niveau-1': { consigne: 'consigne.scission-aucun-titre' },
  'scission/chapitre-cible-existe': { consigne: 'consigne.scission-chapitre-existe' },
  'scission/image-introuvable': { consigne: 'consigne.image-manquante' },
  'scission/tableau-introuvable': { consigne: 'consigne.scission-tableau-introuvable' },
  'scission/liminaire-texte-non-repris': { consigne: 'consigne.scission-liminaire-texte-non-repris' },
  'scission/liminaire-texte-media-introuvable': { consigne: 'consigne.image-manquante' },
  'scission/liminaire-media-introuvable': { consigne: 'consigne.image-manquante' },
  'scission/source-non-supprimee': { consigne: 'consigne.scission-source-non-supprimee' },
  'livre/liminaire-introuvable': { consigne: 'consigne.liminaire-introuvable' },
  'livre/chapitre-ecarte': { consigne: 'consigne.chapitre-ecarte' },
  'livre/chapitre-introuvable': { consigne: 'consigne.chapitre-introuvable' },
  'cockpit/sans-fiche': { consigne: 'consigne.sans-fiche', infobulle: 'infobulle.sans-fiche' },
  'cockpit/compilation-echec': { consigne: 'consigne.compilation-echec' },
  'cockpit/doi-double': { consigne: 'consigne.doi-double', infobulle: 'infobulle.doi-double' },
  'pagination/perimee': { consigne: 'consigne.pagination-perimee' },
  'cockpit/image-sans-alt': { consigne: 'consigne.images-sans-description',
    infobulle: 'infobulle.images-sans-description' },
  'export/refus': { consigne: 'consigne.export-refus' },
  'cockpit/image-sans-legende': { consigne: 'consigne.image-sans-legende',
    infobulle: 'infobulle.image-sans-legende' },
  'cockpit/images-sans-description': { consigne: 'consigne.images-sans-description',
    infobulle: 'infobulle.images-sans-description' },
  'cockpit/tableaux-entete': { consigne: 'consigne.tableaux-entete',
    infobulle: 'infobulle.tableaux-entete' },
  'cockpit/tableaux-sans-entete': { consigne: 'consigne.tableau-sans-entete',
    infobulle: 'infobulle.tableau-sans-entete' },
  'cockpit/entete-vide': { consigne: 'consigne.entete-vide', infobulle: 'infobulle.entete-vide' },
  'cockpit/champs-gabarit-vides': { consigne: 'consigne.champs-gabarit-vides',
    infobulle: 'infobulle.champs-gabarit-vides' }
});

// ---------------------------------------------------------------------------------------
// 3. Les fonctions
// ---------------------------------------------------------------------------------------

function cleDe(constat) {
  return String((constat && constat.source) || '') + '/' + String((constat && constat.code) || '');
}

function entree(constat) { return TABLE[cleDe(constat)] || null; }

// Une barrière n'est fermée que si elle existe : la validation PDF/UA est un réglage de
// poste, et un numéro sans PDF n'a rien à valider. Compilation et export existent toujours.
function porteActive(barrage, contexte) {
  const ctx = contexte || {};
  if (barrage === 'pdfua') { return ctx.pdfua !== false; }
  return true;
}

// -> 'bloquant' | 'avert' | 'info'. Un code inconnu vaut 'avert' : visible, sans rien
// arrêter, comme lib/journal.js qui l'affiche avec la phrase de la chaîne.
function gravite(constat, contexte) {
  const e = entree(constat);
  if (!e) { return 'avert'; }
  if (e.nature === 'fait') { return 'info'; }
  if (e.nature === 'attente') { return 'avert'; }
  if (e.barrage && porteActive(e.barrage, contexte)) { return 'bloquant'; }
  return 'avert';
}

// Le ton d'affichage, tel que .szh-notif et .szh-pastille le connaissent.
function ton(constat, contexte) {
  const g = gravite(constat, contexte);
  return g === 'bloquant' ? 'danger' : (g === 'avert' ? 'attention' : 'info');
}

// Ce qui peut s'effacer d'un clic : les gris, qui ne demandent rien et finiraient par cacher
// ce qui reste à faire. Rouges et ambres n'ont pas de croix : ils se corrigent.
//
// Exception : tout ce que dit l'import se ferme, quelle que soit sa couleur. Un import
// refusé ne laisse aucun article à corriger, et son message survivrait au Word abandonné.
function fermable(constat, contexte) {
  const c = constat || {};
  if (c.source === 'import' || c.origine === 'import') { return true; }
  return gravite(constat, contexte) === 'info';
}

// Les focusChamp qui désignent un fichier sur le disque, dont le formulaire ne veut que le
// nom. objet() lit le même ensemble que cible(), pour que le bouton et la phrase désignent
// la même chose. « média » : comme « image » (un média de pièce liminaire de
// livre-scinder.py), vers le formulaire des médias.
const CHAMPS_FICHIER = new Set(['fichier', 'image', 'média']);

// Dans un formulaire, seul le nom du fichier désigne une image ou un Word. Réservé aux
// champs de CHAMPS_FICHIER : un appel de citation, un DOI ou une fourchette d'années peuvent
// porter un « / » sans être un chemin.
function dernierSegment(valeur) {
  const v = String(valeur === undefined || valeur === null ? '' : valeur);
  const i = Math.max(v.lastIndexOf('/'), v.lastIndexOf('\\'));
  return i === -1 ? v : v.slice(i + 1);
}

// La valeur d'un focusChamp telle qu'elle se lit : réduite au nom de fichier pour
// CHAMPS_FICHIER, entière pour les autres. cible() (le bouton) et objet() (la phrase)
// l'appellent tous deux.
function valeurChamp(nomChamp, valeur) {
  if (CHAMPS_FICHIER.has(nomChamp)) { return dernierSegment(valeur); }
  return String(valeur === undefined || valeur === null ? '' : valeur);
}

// Le fichier qu'écrit docx-tables.py pour le n-ième tableau d'un article (table-%02d.html).
function fichierTable(numero) {
  const n = parseInt(numero, 10);
  if (!(n > 0)) { return ''; }
  return 'table-' + (n < 10 ? '0' : '') + n + '.html';
}

// -> { lieu, slug, focus } ou null quand l'application n'offre aucune action pour ce défaut.
//
// `champs.focusCalcule` : l'extrait que l'hôte a retrouvé dans le .md pour un constat qui
// n'en citait aucun (lib/reperage-focus.js, focusDeRepli). Repli seulement : le focus que
// porte le constat passe avant.
// `champs.elements` (cartes regroupées) : un seul objet, et le bouton y mène directement.
function cible(constat) {
  const e = entree(constat);
  if (!e) { return null; }
  const champs = (constat && constat.champs) || {};
  const slug = String((constat && constat.slug) || '');
  if (e.compte) {
    const els = Array.isArray(champs.elements) ? champs.elements : [];
    if (els.length === 1 && els[0].lieu) {
      return { lieu: els[0].lieu, slug: slug, focus: String(els[0].focus || '') };
    }
    return { lieu: e.lieu, slug: slug, focus: '' };
  }
  if (e.ciblesRepere) {
    const c = e.ciblesRepere[champs.repere];
    if (!c) { return null; }
    return { lieu: c.lieu, slug: slug,
             focus: c.focus || (c.lieu === 'article' ? String(champs.focusCalcule || '') : '') };
  }
  // Un constat peut nommer sa cible quand la table ne peut pas la deviner : les raisons
  // d'un refus d'export ne mènent pas toutes au même endroit.
  const lieu = (constat && constat.lieu) || e.lieu;
  if (!lieu) { return null; }
  let focus = '';
  if (e.focusFixe) { focus = e.focusFixe; }
  else if (e.focusTable) { focus = fichierTable(champs[e.focusTable]); }
  else if (e.focusChamp) { focus = valeurChamp(e.focusChamp, champs[e.focusChamp]); }
  if (focus === '' && lieu === 'article' && champs.focusCalcule) { focus = String(champs.focusCalcule); }
  return { lieu: lieu, slug: slug, focus: focus };
}

// Le bouton à poser sur la carte, ou null. Les libellés vivent dans le dictionnaire : huit
// paires, quel que soit le nombre de codes.
function bouton(constat, langue) {
  const c = cible(constat);
  if (!c) { return null; }
  const l = LIEUX[c.lieu];
  return { id: c.lieu, libelle: TL(langue, l.libelle), icone: l.icone,
           tip: TL(langue, l.tip), commande: l.commande, slug: c.slug, focus: c.focus };
}

// L'objet dont parle le défaut, tel qu'il s'écrit après les deux-points. Le même champ que
// la cible quand il y en a un : la phrase et le bouton désignent alors la même chose.
function objet(constat, langue) {
  const e = entree(constat);
  if (!e) { return ''; }
  const champs = (constat && constat.champs) || {};
  // objetChamp d'abord : posé quand l'objet de la phrase doit différer de la cible du bouton
  // (import/tableau-sans-entete : la flèche vise un extrait repérable, la phrase nomme le
  // tableau). Sinon, le champ de la cible.
  if (e.objetChamp && champs[e.objetChamp] !== undefined) { return String(champs[e.objetChamp]); }
  if (e.focusChamp && champs[e.focusChamp] !== undefined) {
    return valeurChamp(e.focusChamp, champs[e.focusChamp]);
  }
  return '';
}

// Le deux-points ne se ponctue pas de la même façon dans les deux langues : espace
// insécable devant en français, rien en allemand. La règle vit ici et non dans le
// dictionnaire, le gabarit étant le même pour tous les défauts.
const DEUX_POINTS = { fr: ' : ', de: ': ' };

// « {défaut} : {objet} », ou l'intitulé seul quand il n'y a pas d'objet à nommer. L'action
// est dans le bouton et la consigne, pas ici. Une carte regroupée (`compte`) dit son nombre
// d'objets : « 2 images sans description ».
function phrase(constat, langue) {
  const e = entree(constat);
  if (!e) { return String((constat && constat.brut) || ''); }
  if (e.compte) {
    const n = (((constat && constat.champs) || {}).elements || []).length;
    return n > 0 ? TL(langue, e.defaut + (n === 1 ? '.1' : '.n'), [n]) : TL(langue, e.defaut);
  }
  const o = objet(constat, langue);
  if (e.objetSeul && o) { return o; }
  const tete = TL(langue, e.defaut);
  return o ? (tete + (DEUX_POINTS[langue] || DEUX_POINTS.fr) + o) : tete;
}

// Les deux moitiés d'une explication de pipeline/rapport-ua.py : « En cause : … » (le
// pourquoi) puis « À faire : … » (l'action), recollées par lib/journal.js en une ligne.
const MARQUE_CAUSE = /^\s*(?:En cause|Ursache)\s*:\s*/;
const MARQUE_GESTE = /\s*(?:À faire|Zu tun)\s*:\s*/;

function decouperExplication(texte) {
  const t = String(texte === undefined || texte === null ? '' : texte).trim();
  const i = t.search(MARQUE_GESTE);
  const avant = i === -1 ? t : t.slice(0, i);
  const apres = i === -1 ? '' : t.slice(i).replace(MARQUE_GESTE, '');
  return { cause: avant.replace(MARQUE_CAUSE, '').trim(), geste: apres.trim() };
}

// La phrase d'action : une seule, qui commence par l'action. Vide pour une information qui
// ne demande rien. Elle reçoit les arguments du constat, donc un compte éventuel
// (« 3 règle(s) en échec : recompilez… »).
function consigne(constat, langue) {
  const e = entree(constat);
  if (!e) { return ''; }
  // detailChamp : un texte déjà rédigé par la chaîne, dans la langue du cockpit (la cause
  // et l'action d'une règle PDF/UA, écrites par pipeline/rapport-ua.py) ; seule l'action
  // est une consigne.
  if (e.detailChamp) {
    return decouperExplication(((constat && constat.champs) || {})[e.detailChamp]).geste;
  }
  const s = SECOND_ETAGE[cleDe(constat)];
  return s && s.consigne ? TL(langue, s.consigne, (constat && constat.args) || []) : '';
}

// La seconde ligne de la carte, c'est-à-dire la consigne. La vue et l'empreinte d'un message
// fermé (extension.js) composent leur texte de phrase() et de detail().
function detail(constat, langue) { return consigne(constat, langue); }

// L'explication du défaut, pour l'infobulle. Le premier texte non vide, et différent de la
// consigne, parmi :
//   1. l'explication que la table lui donne (SECOND_ETAGE.infobulle) ;
//   2. la cause écrite par la chaîne (règle PDF/UA), suivie de son repère ISO ;
//   3. le message complet du cockpit (ctl.*, la clé que lib/journal.js a posée) ;
//   4. la seconde ligne de la table (`detail`) ;
//   5. la phrase de la chaîne elle-même (`brut`), dans la langue du cockpit.
function infobulle(constat, langue) {
  const e = entree(constat);
  const c = constat || {};
  const args = c.args || [];
  const dit = consigne(constat, langue);
  const candidats = [];
  const s = SECOND_ETAGE[cleDe(constat)];
  if (s && s.infobulle) { candidats.push(TL(langue, s.infobulle, args)); }
  if (e && e.detailChamp) {
    const cause = decouperExplication((c.champs || {})[e.detailChamp]).cause;
    const repere = (c.champs || {}).repere;
    candidats.push([cause, repere ? TL(langue, 'infobulle.pdfua-repere', [repere]) : '']
      .filter(Boolean).join(' '));
  }
  if (c.cle) {
    const t = TL(langue, c.cle, args);
    if (t !== c.cle) { candidats.push(t); }
  }
  if (e && e.detail) { candidats.push(TL(langue, e.detail, args)); }
  if (c.brut) { candidats.push(String(c.brut)); }
  for (const t of candidats) {
    const v = String(t || '').trim();
    if (v !== '' && v !== dit && v !== phrase(constat, langue)) { return v; }
  }
  return '';
}

// Les objets d'une carte regroupée, tels qu'un lien les nomme : le nom, et entre
// parenthèses ce que le nom seul ne dit pas (« table-01.html (en-tête fusionné) »).
// -> [{ libelle, lieu, focus }]
function elements(constat, langue) {
  const els = (((constat && constat.champs) || {}).elements) || [];
  return els.map((el) => {
    const p = el.precision;
    const precis = p && p.cle ? TL(langue, p.cle, p.args || []) : '';
    const nom = (el.noms && el.noms[langue]) || el.nom;
    return { libelle: String(nom || '') + (precis ? ' (' + precis + ')' : ''),
             lieu: String(el.lieu || ''), focus: String(el.focus || '') };
  });
}

// ---------------------------------------------------------------------------------------
// 4. Le regroupement : une carte par défaut, et non une par voie d'arrivée
// ---------------------------------------------------------------------------------------
//
// Une image sans description arrive par plusieurs voies : la règle 7.3-1 du validateur
// PDF/UA, qui ne connaît que des pages, et une ligne par image de szh-numerotation.lua ou du
// cockpit. Un tableau sans en-tête arrive par 7.5-1 ou 7.5-2 et par l'import. Chaque famille
// devient une carte par article, dont les objets viennent du .md et des tableaux lus par
// l'hôte au moment de l'affichage : c'est l'état actuel, et lui seul dit où cliquer
// (veraPDF ne nomme ni l'image ni le tableau).
//
// `lire(slug)` -> { images: [{ nom, lieu, focus, precision? }],
//                   tableaux: [{ nom, raison: 'sans-entete'|'fusion' }],   les suspects
//                   tousTableaux: [nom] } | null                           tous, lus
// Pure : l'hôte lit le disque, ce module décide. Les constats sans slug (le numéro entier)
// ne se regroupent pas. L'ordre est gardé : la carte prend la place du premier constat
// qu'elle remplace.
const REPERES_IMAGES = new Set(['7.3-1']);
const REPERES_TABLEAUX = new Set(['7.5-1', '7.5-2']);
const CODES_IMAGES = new Set(['numerotation/figure-sans-alt', 'cockpit/image-sans-alt']);

function familleDe(c) {
  const cle = cleDe(c);
  const repere = String(((c && c.champs) || {}).repere || '');
  if (CODES_IMAGES.has(cle) || (cle === 'pdfua/regle' && REPERES_IMAGES.has(repere))) { return 'images'; }
  if (cle === 'import/tableau-sans-entete'
      || (cle === 'pdfua/regle' && REPERES_TABLEAUX.has(repere))) { return 'tableaux'; }
  if (cle === 'import/cle-attendue-absente') { return 'champs-vides'; }
  return '';
}

// Un lien par champ, une seule fois même quand trois fiches d'auteur l'ont laissé vide, dans
// l'ordre où l'import les a nommés. Le nom dans les deux langues du gabarit (`clé`, `clé-de`) :
// elements() choisit celui de la personne qui lit.
function elementsChampsVides(membres) {
  const vus = new Set();
  const els = [];
  for (const c of membres) {
    const champs = c.champs || {};
    const fr = String(champs['clé'] || '');
    if (fr === '' || vus.has(fr)) { continue; }
    vus.add(fr);
    els.push({ nom: fr, noms: { fr: fr, de: String(champs['clé-de'] || fr) },
               lieu: champs.lieu === 'bloc' ? 'medias' : 'fiche', focus: '' });
  }
  return els;
}

function sansDoublon(liste) {
  const vus = new Set();
  return liste.filter((el) => {
    const k = String(el.lieu) + ':' + String(el.focus).toLowerCase();
    if (vus.has(k)) { return false; }
    vus.add(k);
    return true;
  });
}

function elementsImages(membres, lu) {
  const disque = (lu && Array.isArray(lu.images)) ? lu.images : [];
  if (disque.length > 0) { return sansDoublon(disque); }
  // Rien d'identifié sur le disque : les noms que la chaîne a donnés.
  return sansDoublon(membres
    .map((c) => valeurChamp('image', ((c.champs || {}).image)))
    .filter((n) => n !== '')
    .map((n) => ({ nom: n, lieu: 'medias', focus: n })));
}

function elementsTableaux(membres, lu, avecPdfUa) {
  const suspects = (lu && Array.isArray(lu.tableaux)) ? lu.tableaux : null;
  const precision = (t) => ({ cle: t.raison === 'fusion' ? 'objet.tableau.fusion' : 'objet.tableau.sans-entete' });
  if (avecPdfUa && suspects) {
    // Un en-tête fusionné est ce que le validateur refuse ; un tableau sans aucun en-tête
    // (souvent un tableau de mise en page, comme le bloc des auteurs) ne lui fait pas
    // refuser le PDF. Quand il y a des fusions, elles seules sont nommées ; sinon, les
    // tableaux sans en-tête.
    const fusions = suspects.filter((t) => t.raison === 'fusion');
    return (fusions.length > 0 ? fusions : suspects)
      .map((t) => ({ nom: t.nom, lieu: 'table', focus: t.nom, precision: precision(t) }));
  }
  // L'import seul a douté : les tableaux qu'il nomme, tant qu'ils sont encore sans en-tête.
  // Un tableau que l'hôte n'a pas pu lire reste nommé.
  const bas = (n) => String(n).toLowerCase();
  const suspect = new Set((suspects || []).map((t) => bas(t.nom)));
  const lus = new Set(((lu && lu.tousTableaux) || []).map(bas));
  return sansDoublon(membres
    .map((c) => fichierTable((c.champs || {}).tableau))
    .filter((nom) => nom !== '' && !(lus.has(bas(nom)) && !suspect.has(bas(nom))))
    .map((nom) => ({ nom: nom, lieu: 'table', focus: nom,
                     precision: { cle: 'objet.tableau.sans-entete' } })));
}

function regrouper(constats, lire) {
  const liste = Array.isArray(constats) ? constats : [];
  const groupes = new Map();          // slug + famille -> { membres, index }
  const sortie = [];
  for (const c of liste) {
    const famille = c && c.slug ? familleDe(c) : '';
    if (!famille) { sortie.push(c); continue; }
    const cle = c.slug + '\u0001' + famille;
    let g = groupes.get(cle);
    if (!g) {
      g = { slug: c.slug, famille: famille, membres: [], index: sortie.length };
      groupes.set(cle, g);
      sortie.push(null);              // la place de la carte, remplie plus bas
    }
    g.membres.push(c);
  }
  for (const g of groupes.values()) {
    let lu = null;
    try { lu = typeof lire === 'function' ? lire(g.slug) : null; } catch (e) { lu = null; }
    let code;
    let els;
    if (g.famille === 'images') {
      code = 'images-sans-description';
      els = elementsImages(g.membres, lu);
    } else if (g.famille === 'champs-vides') {
      code = 'champs-gabarit-vides';
      els = elementsChampsVides(g.membres);
    } else {
      const avecPdfUa = g.membres.some((c) => c.source === 'pdfua');
      code = avecPdfUa ? 'tableaux-entete' : 'tableaux-sans-entete';
      els = elementsTableaux(g.membres, lu, avecPdfUa);
    }
    sortie[g.index] = {
      source: 'cockpit', code: code, ton: '', slug: g.slug, cle: '', args: [],
      champs: { elements: els }, brut: '',
      // La source du premier constat remplacé : le sous-titre de la carte la nomme
      // (« Figures », « Accessibilité du PDF »).
      origine: g.membres[0].source,
      // Les constats remplacés restent lisibles (rapport d'erreur, tests).
      membres: g.membres
    };
  }
  return sortie;
}

// Le constat « case d'en-tête vide » d'un article, un lien par tableau fautif, ou null.
// `noms` : les fichiers de tables/ dont une case d'en-tête n'a pas d'intitulé, lus par
// l'hôte au moment de l'affichage (aucun journal ne le produit).
function constatEnteteVide(slug, noms) {
  const liste = (noms || []).map(String).filter(Boolean);
  if (!slug || liste.length === 0) { return null; }
  return { source: 'cockpit', code: 'entete-vide', ton: '', slug: String(slug), cle: '', args: [],
           champs: { elements: liste.map((n) => ({ nom: n, lieu: 'table', focus: n })) },
           brut: '', origine: 'pdfua' };
}

module.exports = { LIEUX, TABLE, CIBLES_REGLE_PDFUA, SECOND_ETAGE, gravite, ton, fermable, cible,
  bouton, phrase, detail, consigne, infobulle, elements, objet, regrouper, fichierTable,
  decouperExplication, constatEnteteVide };
