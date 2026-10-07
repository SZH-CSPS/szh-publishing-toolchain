// Détecte les copies en conflit que OneDrive/SharePoint crée quand deux postes modifient le
// même fichier : il ne fusionne pas, il place la version perdante à côté de l'original avec
// un marqueur (« copie en conflit », etc.).
//
// Les doublons numérotés (« fichier (1).yaml ») sont aussi détectés, à condition que
// l'original existe dans le même dossier : « essai (1).yaml » peut être un nom voulu.
// estCopieConflit() juge un nom ; chercherCopies() parcourt un dossier et ne lève pas.
'use strict';

const fs = require('fs');
const path = require('path');

// Marqueurs textuels reconnus dans les noms de fichier en conflit, insensibles à la
// casse. Dès qu'un marqueur est trouvé, l'original est le nom tronqué juste avant lui.
const MARQUEURS = [
  'copie en conflit',      // OneDrive/SharePoint français
  'konfliktkopie',         // OneDrive allemand
  'conflicted copy',       // Dropbox, Nextcloud anglais
  'copia in conflitto',    // italien
  'copia en conflicto'     // espagnol
];

// Extensions surveillées. Une copie en conflit d'image ferait trop de bruit pour trop peu.
const EXTENSIONS = ['.yaml', '.yml', '.md', '.html', '.json', '.bib'];

// Reconstitue le nom original en nettoyant les résidus du marqueur ou du doublon.
function nettoyerNom(nom) {
  // Enlève espaces, tirets, tirets bas, parenthèses ouvrantes de fin.
  return nom.replace(/[\s\-_\(]*$/, '');
}

// Retourne { marqueur, original } si le nom est une copie en conflit, null sinon.
// `nom` est un nom de fichier seul, pas un chemin.
// `existe` optionnelle : fonction (nomVoisin) => bool pour vérifier les doublons.
function estCopieConflit(nom, existe) {
  if (!nom || typeof nom !== 'string') { return null; }

  // Temporaire d'écriture atomique du cockpit : pas une copie en conflit.
  if (nom.startsWith('~$')) { return null; }

  const dernierPoint = nom.lastIndexOf('.');
  if (dernierPoint <= 0) { return null; }
  const ext = nom.slice(dernierPoint);
  const nomSansExt = nom.slice(0, dernierPoint);

  // L'extension doit être surveillée (casse ignorée).
  if (!EXTENSIONS.some((e) => e.toLowerCase() === ext.toLowerCase())) { return null; }

  // Cherche les marqueurs textuels (casse ignorée).
  //
  // Le nom reconstitué garde la casse du fichier examiné : il sert à ouvrir le fichier
  // d'origine, et la compilation passe par la WSL, sensible à la casse.
  const marqueursLc = MARQUEURS.map((m) => m.toLowerCase());
  for (const marqueur of marqueursLc) {
    const idx = nomSansExt.toLowerCase().indexOf(marqueur);
    if (idx !== -1) {
      // Tronque avant le marqueur et nettoie ; un nom qui commence par le marqueur ne
      // laisse rien devant, et « .yaml » n'est pas un fichier d'origine.
      const base = nettoyerNom(nomSansExt.slice(0, idx));
      const original = base + ext;
      if (base !== '' && original !== nom) {
        return { marqueur: marqueur, original: original };
      }
      // Sinon, ce marqueur n'a pas produit un original valide ; continue.
    }
  }

  // Doublon numéroté : un nom qui finit par ' (N)' avant l'extension, N 1-2 chiffres.
  // Ne compte que si l'original existe dans le même dossier.
  const reDoublon = / \((\d{1,2})\)$/;
  const match = nomSansExt.match(reDoublon);
  if (match && existe) {
    const base = nettoyerNom(nomSansExt.slice(0, match.index));
    const original = base + ext;
    if (base !== '' && original !== nom && existe(original)) {
      return { marqueur: 'doublon', original: original };
    }
  }

  return null;
}

// Parcourt la racine sur `profondeurMax` niveaux au plus. Rend un tableau de copies en
// conflit :
// - chemin : chemin absolu du fichier suspect
// - dossier : chemin absolu de son dossier parent
// - nom : nom du fichier
// - original : nom du fichier d'origine reconstitué (peut ne pas exister)
// - cheminOriginal : chemin absolu du fichier d'origine
// - marqueur : le marqueur, ou 'doublon'
//
// Deux arborescences s'y balaient : le dossier d'un numéro, profond et large
// (chercherCopies, 6 niveaux au plus), et le dossier partagé de l'outil, plat
// (chercherCopiesPlat).
function balayer(racine, profondeurMax) {
  const resultats = [];
  const dossierAIgnorer = new Set([
    'out', '.szh-avant-reimport', '.szh-edition', '.vscode', '.git', 'node_modules'
  ]);

  // withFileTypes donne le type avec l'entrée, sans un stat par fichier : sur OneDrive, un
  // stat par fichier « à la demande » ralentirait chaque balayage.
  function parcourir(dossierCourant, profondeur) {
    if (profondeur > profondeurMax) { return; }    // garde-fou : arborescence inattendue
    let entrees;
    try { entrees = fs.readdirSync(dossierCourant, { withFileTypes: true }); }
    catch (e) { return; }                          // dossier illisible : sauté sans un mot
    const noms = new Set(entrees.map((e) => e.name));
    const existe = (nomVoisin) => noms.has(nomVoisin);
    for (const entree of entrees) {
      const cheminComplet = path.join(dossierCourant, entree.name);
      if (entree.isDirectory()) {
        if (dossierAIgnorer.has(entree.name) || entree.name.startsWith('~$')) { continue; }
        parcourir(cheminComplet, profondeur + 1);
        continue;
      }
      if (!entree.isFile()) { continue; }          // lien, tube : pas notre affaire
      const verdict = estCopieConflit(entree.name, existe);
      if (!verdict) { continue; }
      resultats.push({
        chemin: cheminComplet,
        dossier: dossierCourant,
        nom: entree.name,
        original: verdict.original,
        cheminOriginal: path.join(dossierCourant, verdict.original),
        marqueur: verdict.marqueur
      });
    }
  }

  try { parcourir(racine, 0); }
  catch (e) { /* une exception à la racine reste silencieuse */ }

  // Tri par chemin, sensible à la casse, pour un ordre stable d'un rafraîchissement à l'autre.
  resultats.sort((a, b) => a.chemin < b.chemin ? -1 : a.chemin > b.chemin ? 1 : 0);

  return resultats;
}

// Le dossier d'un numéro, en profondeur : des centaines de fichiers, plusieurs niveaux.
function chercherCopies(racine) {
  if (!racine || typeof racine !== 'string') { return []; }
  return balayer(racine, 6);
}

// Le dossier partagé de l'outil (`_Systeme` : rapports d'erreur, journaux, suggestions de
// traduction, inventaire des postes). Il est plat (un niveau de sous-dossiers) : un balayage
// court suffit. Une copie en conflit déposée là n'appartient à aucun numéro, et personne
// n'ouvre ce dossier à la main : sans ce balayage, elle passerait inaperçue.
// `niveaux` vaut 1 par défaut : le dossier lui-même et ses sous-dossiers directs.
function chercherCopiesPlat(racine, niveaux) {
  if (!racine || typeof racine !== 'string') { return []; }
  const profondeur = (typeof niveaux === 'number' && niveaux >= 0) ? Math.floor(niveaux) : 1;
  return balayer(racine, profondeur);
}

// La copie en conflit d'un fichier donné, ou null. Un seul readdir, sur le dossier du
// fichier : l'éditeur appelle cette fonction pour chaque onglet ouvert.
//
// La comparaison des noms ignore la casse : Windows ne la distingue pas, et OneDrive ne
// conserve pas toujours celle du fichier d'origine.
function copieConflitPour(chemin) {
  if (!chemin || typeof chemin !== 'string') { return null; }
  const dossier = path.dirname(chemin);
  const cible = path.basename(chemin).toLowerCase();
  let entrees;
  try { entrees = fs.readdirSync(dossier); }
  catch (e) { return null; }                       // dossier disparu
  const noms = new Set(entrees);
  const existe = (voisin) => noms.has(voisin);
  const trouvees = [];
  for (const nom of entrees) {
    const verdict = estCopieConflit(nom, existe);
    if (verdict && verdict.original.toLowerCase() === cible) { trouvees.push(nom); }
  }
  if (trouvees.length === 0) { return null; }
  trouvees.sort();                                 // deux copies : toujours la même d'abord
  return path.join(dossier, trouvees[0]);
}

// Deux versions qui ne diffèrent que par le BOM, les fins de ligne ou les sauts de ligne
// finaux sont égales : l'éditeur ne montre pas ces écarts, et l'enregistrement peut en
// ajouter un (files.insertFinalNewline).
function memeContenu(a, b) {
  const norme = (t) => String(t === undefined || t === null ? '' : t)
    .replace(/^﻿/, '').replace(/\r\n?/g, '\n').replace(/\n+$/, '');
  return norme(a) === norme(b);
}

// La copie ne retient plus rien que l'original n'ait. Faux dès que l'un des deux ne se lit pas.
function copieRedondante(original, copie) {
  try { return memeContenu(fs.readFileSync(original, 'utf8'), fs.readFileSync(copie, 'utf8')); }
  catch (e) { return false; }
}

// ---- Résoudre une copie en conflit, bloc par bloc --------------------------------
//
// L'éditeur calcule les blocs de divergence et les passe aux commandes du menu
// « scm/change/title » sous la forme (uri, blocs, index). Ce module les applique.
//
// Un bloc est un LineChange de VS Code : quatre numéros de ligne comptés à partir de 1, avec
// deux conventions :
//   originalEndLineNumber === 0  rien du côté original : insertion juste après la ligne
//                                originalStartLineNumber ;
//   modifiedEndLineNumber === 0  rien du côté modifié : suppression.
// Sinon, remplacement de originalStart..originalEnd par modifiedStart..End.
//
// Le découpage garde la ligne vide finale d'un fichier terminé par un saut de ligne, comme
// le modèle de document de l'éditeur (lineCount la compte) auquel les numéros se réfèrent.
// « a\nb\n » donne ['a', 'b', ''], et join() rend le texte à l'octet.
function decouperLignes(texte) {
  const t = String(texte === undefined || texte === null ? '' : texte);
  return { lignes: t.split(/\r?\n/), eol: t.indexOf('\r\n') !== -1 ? '\r\n' : '\n' };
}

function assemblerLignes(doc) { return doc.lignes.join(doc.eol); }

// Le même bloc vu de l'autre côté : l'original devient le modifié. Une seule fonction sert
// ainsi aux deux sens de résolution.
function inverserBloc(bloc) {
  return {
    originalStartLineNumber: bloc.modifiedStartLineNumber,
    originalEndLineNumber: bloc.modifiedEndLineNumber,
    modifiedStartLineNumber: bloc.originalStartLineNumber,
    modifiedEndLineNumber: bloc.originalEndLineNumber
  };
}

// Le texte de `texteOriginal` où les blocs demandés sont remplacés par ceux de
// `texteModifie`. Les blocs sont en ordre croissant et ne se chevauchent pas, comme ceux que
// fournit l'éditeur.
//
// Les fins de fichier se règlent par le découpage en lignes : une insertion en fin de
// document a originalStartLineNumber égal au nombre de lignes, et ses lignes se posent après
// tout le reste. Aucun calcul de position en caractères n'est nécessaire.
function appliquerBlocs(texteOriginal, texteModifie, blocs) {
  const original = decouperLignes(texteOriginal);
  const modifie = decouperLignes(texteModifie);
  const resultat = [];
  let curseur = 0;                                 // prochaine ligne de l'original à recopier
  for (const bloc of (Array.isArray(blocs) ? blocs : [])) {
    if (!bloc) { continue; }
    const insertion = bloc.originalEndLineNumber === 0;
    const suppression = bloc.modifiedEndLineNumber === 0;
    const finOriginal = insertion ? bloc.originalStartLineNumber : bloc.originalStartLineNumber - 1;
    for (const ligne of original.lignes.slice(curseur, Math.max(curseur, finOriginal))) {
      resultat.push(ligne);
    }
    if (!suppression) {
      for (const ligne of modifie.lignes.slice(bloc.modifiedStartLineNumber - 1, bloc.modifiedEndLineNumber)) {
        resultat.push(ligne);
      }
    }
    curseur = insertion ? bloc.originalStartLineNumber : bloc.originalEndLineNumber;
  }
  for (const ligne of original.lignes.slice(curseur)) { resultat.push(ligne); }
  return assemblerLignes({ lignes: resultat, eol: original.eol });
}

module.exports = {
  MARQUEURS, EXTENSIONS, estCopieConflit, chercherCopies, chercherCopiesPlat, copieConflitPour,
  memeContenu, copieRedondante, decouperLignes, assemblerLignes, inverserBloc, appliquerBlocs
};
