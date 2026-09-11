// Ce qu'un défaut ferme, où on va le corriger, et comment il s'écrit.
//
// Données pures et fonctions pures : ni `vscode`, ni `fs`, aucun accès disque — comme
// lib/codes-erreur.js, et pour la même raison, ce module est lu par l'extension comme par
// les tests. Il ne produit aucun constat : il décide de ceux que lib/journal.js lui passe.
//
// Trois décisions vivaient éparpillées, et c'est ce qui a fait diverger l'interface.
//
//  1. LA COULEUR. Elle se calcule, elle ne se déclare pas. Un constat porte la BARRIÈRE
//     qu'il ferme — la compilation, la validation PDF/UA, l'export, ou le geste qu'on
//     venait de demander — et la couleur s'en déduit : rouge si quelque chose refuse
//     vraiment, sur ce poste et pour ce numéro. La validation PDF/UA étant un réglage, une
//     image muette est rouge là où elle tourne et ambre là où elle est éteinte : la
//     couleur dit ce que la machine va faire, jamais ce qu'on estime grave.
//
//  2. LE BOUTON. Cinquante codes, mais huit destinations seulement — le texte d'un
//     article, sa fiche, ses images, les métadonnées du numéro, les réglages, le dépôt
//     Word, la Documentation, l'aperçu. Un constat porte donc une CIBLE, jamais un bouton,
//     et une seule fonction fabrique le bouton depuis LIEUX. Pas de cible quand aucun
//     geste n'existe dans l'application : renommer un dossier se fait dans l'explorateur
//     de Windows, et un bouton qui mènerait « quelque part » serait un mensonge.
//
//  3. LA PHRASE. « {défaut} : {objet} », et rien de plus. L'intitulé est un groupe nominal
//     court ; l'objet vient des champs que le constat porte déjà ; le geste est dans le
//     bouton, plus dans le texte. Les explications de la version précédente disaient trois
//     fois la même chose et se traduisaient mal. Un détail facultatif reste possible, et
//     n'existe que là où une ligne ne suffit pas : les conflits de réimport doivent dire
//     ce qui a été gardé et ce qui a été perdu.
//
// Règle de tenue : tout code que lib/journal.js sait produire a sa ligne dans TABLE.
// test/js/constats.test.js lit la source de journal.js et tombe si un code y apparaît sans
// décision ici — un défaut nouveau ne doit pas arriver gris et sans bouton à l'écran.
'use strict';

const { TL } = require('./i18n');

// ---------------------------------------------------------------------------------------
// 1. Les huit destinations
// ---------------------------------------------------------------------------------------
//
// `commande` est appelée avec { slug, focus } : les commandes qui ignorent l'un ou l'autre
// s'en accommodent déjà. `focus` désigne, dans la page visée, ce qu'il faut amener à
// l'écran — une image pour le formulaire des médias, un champ pour une fiche.
const LIEUX = Object.freeze({
  article: Object.freeze({ commande: 'szh.ouvrirArticle', icone: 'fleche',
    libelle: 'action.article', tip: 'action.article.tip' }),
  fiche: Object.freeze({ commande: 'szh.metadonneesArticle', icone: 'info',
    libelle: 'action.fiche', tip: 'action.fiche.tip' }),
  medias: Object.freeze({ commande: 'szh.mediasArticle', icone: 'camera',
    libelle: 'action.medias', tip: 'action.medias.tip' }),
  numero: Object.freeze({ commande: 'szh.metadonnees', icone: 'gear',
    libelle: 'action.numero', tip: 'action.numero.tip' }),
  reglages: Object.freeze({ commande: 'szh.reglages', icone: 'gear',
    libelle: 'action.reglages', tip: 'action.reglages.tip' }),
  word: Object.freeze({ commande: 'szh.vueWord', icone: 'inbox',
    libelle: 'action.word', tip: 'action.word.tip' }),
  documentation: Object.freeze({ commande: 'szh.documentation', icone: 'megaphone',
    libelle: 'action.documentation', tip: 'action.documentation.tip' }),
  apercu: Object.freeze({ commande: 'szh.basculerApercu', icone: 'oeil',
    libelle: 'action.apercu', tip: 'action.apercu.tip' })
});

// ---------------------------------------------------------------------------------------
// 2. La table : une ligne par code
// ---------------------------------------------------------------------------------------
//
//   barrage    'compilation' | 'pdfua' | 'export' | 'geste' | null
//              La porte que ce défaut ferme. `geste` = l'opération demandée n'a pas eu
//              lieu ; elle ne bloque aucune publication, mais elle a refusé, et le rouge
//              le dit aussi.
//   nature     'defaut'  quelque chose est faux ;
//              'attente' rien n'est faux, le travail n'a pas commencé — jamais rouge, même
//                        quand la chaîne s'arrête faute de matière ;
//              'fait'    une information, rien à corriger — gris.
//   lieu       une clé de LIEUX, ou '' quand aucun geste n'existe ici.
//   focusChamp le champ du constat qui désigne l'objet à atteindre dans ce lieu.
//   focusFixe  la même chose, quand l'objet est toujours le même.
//   defaut     la clé de l'intitulé court.
//   detail     la clé d'une seconde ligne, là où une seule ne suffit pas.
const D = 'defaut';      // abrégés de lecture : la colonne `nature` se lit en diagonale
const A = 'attente';
const F = 'fait';

const TABLE = Object.freeze({
  // ---- La compilation ------------------------------------------------------------
  'pipeline/titre-manquant': { barrage: 'compilation', nature: D, lieu: 'fiche',
    focusFixe: 'title', defaut: 'defaut.titre-manquant' },
  // Un dossier se renomme dans l'explorateur de Windows : le cockpit n'a pas ce geste.
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
  // déplacement final qui a refusé. Le seul geste du cockpit est de fermer son aperçu ;
  // Adobe, lui, se ferme à la main — le détail le dit.
  'pipeline/pdf-verrouille': { barrage: 'compilation', nature: D, lieu: 'apercu',
    focusChamp: 'fichier', defaut: 'defaut.pdf-verrouille', detail: 'detail.pdf-verrouille' },
  // ---- Le balisage du PDF --------------------------------------------------------
  'pipeline/balisage-simple': { barrage: null, nature: D, lieu: '',
    defaut: 'defaut.balisage-simple' },
  'pipeline/balisage-aucun': { barrage: 'pdfua', nature: D, lieu: '',
    defaut: 'defaut.balisage-aucun' },
  // ---- La mise en page -----------------------------------------------------------
  // Une image introuvable ne ferme aucune porte : le PDF sort, l'image manque. Ambre,
  // donc, là où elle était rouge — la couleur suit la chaîne, pas l'agacement.
  'rendu/image-manquante': { barrage: null, nature: D, lieu: 'medias',
    focusChamp: 'image', defaut: 'defaut.image-manquante' },
  'rendu/niveaux-ecrases': { barrage: null, nature: D, lieu: 'article',
    defaut: 'defaut.niveaux-ecrases' },
  'rendu/police-manquante': { barrage: null, nature: D, lieu: '',
    defaut: 'defaut.police-manquante' },
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
  // Rouge : une image qui porte de l'information sans texte alternatif fait échouer la
  // validation PDF/UA, donc l'export. Ambre sur un poste où cette validation est éteinte.
  'numerotation/figure-sans-alt': { barrage: 'pdfua', nature: D, lieu: 'medias',
    focusChamp: 'image', defaut: 'defaut.figure-sans-alt' },
  // ---- L'accessibilité du PDF ----------------------------------------------------
  'pdfua/aucun-pdf': { barrage: null, nature: A, lieu: '', defaut: 'defaut.aucun-pdf' },
  'pdfua/non-conforme': { barrage: 'pdfua', nature: D, lieu: '',
    defaut: 'defaut.pdfua-non-conforme' },
  'pdfua/regle': { barrage: 'pdfua', nature: D, lieu: '', defaut: 'defaut.pdfua-regle' },
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
  'import/restes': { barrage: null, nature: A, lieu: 'word', defaut: 'defaut.import-restes' },
  'import/tableau-sans-entete': { barrage: null, nature: D, lieu: 'article',
    focusChamp: 'tableau', defaut: 'defaut.tableau-sans-entete' },
  'import/langue-deduite': { barrage: null, nature: F, lieu: 'fiche', focusFixe: 'lang',
    defaut: 'defaut.langue-deduite' },
  'import/word-redepose': { barrage: null, nature: F, lieu: 'word', focusChamp: 'fichier',
    defaut: 'defaut.word-redepose' },
  'import/origine-inconnue': { barrage: null, nature: D, lieu: 'word', focusChamp: 'fichier',
    defaut: 'defaut.origine-inconnue' },
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
  'import/tableau-conflit': { barrage: null, nature: D, lieu: 'article',
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
  // ---- Le livre ------------------------------------------------------------------
  'livre/liminaire-introuvable': { barrage: 'compilation', nature: D, lieu: 'numero',
    focusChamp: 'pièce', defaut: 'defaut.liminaire-introuvable' },
  'livre/chapitre-ecarte': { barrage: null, nature: F, lieu: '',
    focusChamp: 'chapitre', defaut: 'defaut.chapitre-ecarte' },
  'livre/chapitre-introuvable': { barrage: 'compilation', nature: D, lieu: 'numero',
    focusChamp: 'chapitre', defaut: 'defaut.chapitre-introuvable' },
  // ---- Ce que le cockpit voit sans compiler ---------------------------------------
  // Ces quatre-là ne viennent pas du journal de la chaîne : le cockpit les calcule en
  // lisant le numéro. Ils suivent la même table, pour que la carte d'un article et la
  // liste « À corriger » ne puissent plus diverger.
  'cockpit/sans-fiche': { barrage: 'compilation', nature: D, lieu: 'fiche',
    focusFixe: 'title', defaut: 'defaut.sans-fiche' },
  'cockpit/doi-double': { barrage: 'export', nature: D, lieu: 'fiche', focusFixe: 'doi',
    defaut: 'defaut.doi-double' },
  'cockpit/image-sans-alt': { barrage: 'pdfua', nature: D, lieu: 'medias',
    focusChamp: 'image', defaut: 'defaut.figure-sans-alt' },
  'cockpit/image-sans-legende': { barrage: null, nature: D, lieu: 'medias',
    focusChamp: 'image', defaut: 'defaut.image-sans-legende' }
});

// ---------------------------------------------------------------------------------------
// 3. Les fonctions
// ---------------------------------------------------------------------------------------

function cleDe(constat) {
  return String((constat && constat.source) || '') + '/' + String((constat && constat.code) || '');
}

function entree(constat) { return TABLE[cleDe(constat)] || null; }

// Une porte n'est fermée que si elle est ouverte : la validation PDF/UA est un réglage de
// poste, et un numéro qui ne produit pas de PDF n'a rien à valider. Les deux autres portes
// sont toujours là — on compile toujours, on exporte toujours un jour.
function porteActive(barrage, contexte) {
  const ctx = contexte || {};
  if (barrage === 'pdfua') { return ctx.pdfua !== false; }
  return true;
}

// -> 'bloquant' | 'avert' | 'info'. Un code inconnu vaut 'avert' : une source neuve doit se
// voir, sans rien arrêter — c'est le même parti que lib/journal.js, qui la laisse passer
// avec la phrase du pipeline.
function gravite(constat, contexte) {
  const e = entree(constat);
  if (!e) { return 'avert'; }
  if (e.nature === 'fait') { return 'info'; }
  if (e.nature === 'attente') { return 'avert'; }
  if (e.barrage && porteActive(e.barrage, contexte)) { return 'bloquant'; }
  return 'avert';
}

// Le ton d'affichage, tel que .szh-notif et .szh-pastille le connaissent depuis toujours.
function ton(constat, contexte) {
  const g = gravite(constat, contexte);
  return g === 'bloquant' ? 'danger' : (g === 'avert' ? 'attention' : 'info');
}

// Un chemin ne sert à personne dans un formulaire : seul le nom du fichier y désigne une
// image. Les noms de champ, eux, ne portent jamais de séparateur.
function dernierSegment(valeur) {
  const v = String(valeur === undefined || valeur === null ? '' : valeur);
  const i = Math.max(v.lastIndexOf('/'), v.lastIndexOf('\\'));
  return i === -1 ? v : v.slice(i + 1);
}

// -> { lieu, slug, focus } ou null quand aucun geste n'existe pour ce défaut.
function cible(constat) {
  const e = entree(constat);
  if (!e || !e.lieu) { return null; }
  const champs = (constat && constat.champs) || {};
  let focus = '';
  if (e.focusFixe) { focus = e.focusFixe; }
  else if (e.focusChamp) { focus = dernierSegment(champs[e.focusChamp]); }
  return { lieu: e.lieu, slug: String((constat && constat.slug) || ''), focus: focus };
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
  if (e.focusChamp && champs[e.focusChamp] !== undefined) {
    return dernierSegment(champs[e.focusChamp]);
  }
  // Les constats dont l'objet ne sert pas de cible : leur champ est nommé ici.
  if (e.objetChamp && champs[e.objetChamp] !== undefined) { return String(champs[e.objetChamp]); }
  return '';
}

// Le deux-points ne se ponctue pas de la même façon dans les deux langues : espace
// insécable devant en français, rien en allemand. La règle vit ici et non dans le
// dictionnaire, le gabarit étant le même pour tous les défauts.
const DEUX_POINTS = { fr: ' : ', de: ': ' };

// « {défaut} : {objet} », ou le seul intitulé quand il n'y a pas d'objet à nommer. Jamais
// un deux-points en l'air, jamais le geste — il est dans le bouton.
function phrase(constat, langue) {
  const e = entree(constat);
  if (!e) { return String((constat && constat.brut) || ''); }
  const tete = TL(langue, e.defaut);
  const o = objet(constat, langue);
  return o ? (tete + (DEUX_POINTS[langue] || DEUX_POINTS.fr) + o) : tete;
}

// La seconde ligne, là où une seule ne suffit pas — ce qui a été gardé, ce qui a été perdu.
// Vide partout ailleurs, et c'est la règle : le gabarit ne doit pas redevenir un paragraphe.
function detail(constat, langue) {
  const e = entree(constat);
  return e && e.detail ? TL(langue, e.detail) : '';
}

module.exports = { LIEUX, TABLE, gravite, ton, cible, bouton, phrase, detail, objet };
