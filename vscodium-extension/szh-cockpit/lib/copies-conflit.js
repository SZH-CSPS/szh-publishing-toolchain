// Détection des copies en conflit créées par OneDrive/SharePoint quand deux postes
// modifient le même fichier simultanément. Le synchroniseur ne fusionne pas : il
// place la version perdante à côté de l'original avec un marqueur (« copie en
// conflit » en français, etc.). Le cockpit doit avertir qu'une version n'a pas été
// intégrée au numéro.
//
// Les doublons numérotés (fichier (1).yaml, (2).yaml) sont aussi détectés : pour
// distinguer une vraie copie en conflit d'un nom intentionnel comme « essai (1).yaml »,
// on demande à l'appelant de vérifier que l'original existe dans le même dossier.
//
// Ni vscode ni configuration : fs et path seulement, donc éprouvable hors de l'éditeur.
// estCopieConflit() ne juge qu'un NOM et ne touche pas au disque ; c'est chercherCopies()
// qui parcourt, et lui ne lève jamais — il est appelé depuis un rafraîchissement d'interface.
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
  // Un nom vide ne peut pas être une copie.
  if (!nom || typeof nom !== 'string') { return null; }

  // Temporaire d'écriture atomique du cockpit : jamais une copie en conflit.
  if (nom.startsWith('~$')) { return null; }

  // Extrait l'extension et le nom sans extension.
  const dernierPoint = nom.lastIndexOf('.');
  if (dernierPoint <= 0) { return null; }
  const ext = nom.slice(dernierPoint);
  const nomSansExt = nom.slice(0, dernierPoint);

  // Extension doit être surveillée (case-insensitive).
  if (!EXTENSIONS.some((e) => e.toLowerCase() === ext.toLowerCase())) { return null; }

  // Cherche les marqueurs textuels (case-insensitive).
  //
  // ⚠ La CASSE du nom reconstitué est celle du fichier examiné, jamais minusculisée : ce
  // nom sert à ouvrir le fichier d'origine dans le comparateur, et une revue posée sur un
  // système sensible à la casse — la compilation passe par WSL — ne le retrouverait pas.
  const marqueursLc = MARQUEURS.map((m) => m.toLowerCase());
  for (const marqueur of marqueursLc) {
    const idx = nomSansExt.toLowerCase().indexOf(marqueur);
    if (idx !== -1) {
      // Tronque avant le marqueur et nettoie ; un nom qui COMMENCE par le marqueur ne
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
  // Ne compte QUE si l'original existe dans le même dossier.
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

// Parcourt récursivement un dossier et rend un tableau de copies en conflit.
// Retour : [{ chemin, dossier, nom, original, cheminOriginal, marqueur }]
// - chemin : chemin absolu du fichier suspect
// - dossier : chemin absolu de son dossier parent
// - nom : nom du fichier
// - original : nom du fichier d'origine reconstitué (peut ne pas exister)
// - cheminOriginal : chemin absolu du fichier d'origine (pour vérifier son existence)
// - marqueur : le marqueur ou 'doublon' qui l'a identifié
function chercherCopies(racine) {
  if (!racine || typeof racine !== 'string') { return []; }

  const resultats = [];
  const dossierAIgnorer = new Set([
    'out', '.szh-avant-reimport', '.szh-edition', '.vscode', '.git', 'node_modules'
  ]);

  // withFileTypes : le type vient avec l'entrée, sans un stat par fichier. Le dossier d'un
  // numéro tient des centaines de fichiers sur OneDrive, et ce parcours est refait à chaque
  // balayage ; un stat par fichier sur des fichiers « à la demande » se paierait à l'écran.
  function parcourir(dossierCourant, profondeur) {
    if (profondeur > 6) { return; }                // garde-fou : arborescence inattendue
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
  catch (e) { /* même une exception à la racine reste silencieuse : jamais bloquant */ }

  // Trie par chemin pour une stabilité d'ordre d'un rafraîchissement à l'autre.
  // Comparaison lexicographique case-sensitive pour prévisibilité.
  resultats.sort((a, b) => a.chemin < b.chemin ? -1 : a.chemin > b.chemin ? 1 : 0);

  return resultats;
}

// La copie en conflit d'un fichier donné, ou null. Un seul readdir, sur le dossier du
// fichier : l'éditeur appelle ceci pour CHAQUE onglet ouvert (fournisseur de diff rapide),
// il n'est pas question de parcourir le numéro à chaque fois.
//
// La comparaison des noms ignore la casse : Windows ne la distingue pas, et le
// synchroniseur ne conserve pas toujours celle du fichier d'origine.
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

// ---- Résoudre une copie en conflit, bloc par bloc --------------------------------
//
// C'est l'ÉDITEUR qui calcule les blocs de divergence : il les passe aux commandes du menu
// « scm/change/title » sous la forme (uri, blocs, index). Ici on ne fait que les appliquer,
// donc aucun algorithme de comparaison à écrire ni à maintenir.
//
// Un bloc est un LineChange de VS Code : quatre numéros de ligne comptés À PARTIR DE 1, et
// deux conventions à connaître —
//   originalEndLineNumber === 0  « rien du côté original » : c'est une INSERTION, qui vient
//                                 juste après la ligne originalStartLineNumber ;
//   modifiedEndLineNumber === 0  « rien du côté modifié » : c'est une SUPPRESSION.
// Tout le reste est un remplacement de originalStart..originalEnd par modifiedStart..End.

// ⚠ Le découpage GARDE la ligne vide finale d'un fichier qui se termine par un saut de
// ligne : c'est le modèle de document de l'éditeur — lineCount la compte — et les numéros
// des blocs s'y réfèrent. Retirer cette ligne décalerait le dernier bloc d'un cran.
// « a\nb\n » donne donc ['a', 'b', ''], et le join() rend le texte à l'octet.
function decouperLignes(texte) {
  const t = String(texte === undefined || texte === null ? '' : texte);
  return { lignes: t.split(/\r?\n/), eol: t.indexOf('\r\n') !== -1 ? '\r\n' : '\n' };
}

function assemblerLignes(doc) { return doc.lignes.join(doc.eol); }

// Le même bloc vu de l'autre côté : ce qui était l'original devient le modifié. C'est ce
// qui permet d'écrire les deux sens de résolution avec une seule fonction.
function inverserBloc(bloc) {
  return {
    originalStartLineNumber: bloc.modifiedStartLineNumber,
    originalEndLineNumber: bloc.modifiedEndLineNumber,
    modifiedStartLineNumber: bloc.originalStartLineNumber,
    modifiedEndLineNumber: bloc.originalEndLineNumber
  };
}

// Le texte de `texteOriginal` où les blocs demandés ont été remplacés par ceux de
// `texteModifie`. Les blocs doivent être dans l'ordre croissant et ne pas se chevaucher —
// c'est le cas de ceux que l'éditeur fournit.
//
// Les fins de fichier se règlent d'elles-mêmes par le découpage en lignes : une insertion en
// fin de document a originalStartLineNumber égal au nombre de lignes, donc les lignes
// ajoutées se posent après tout le reste, et une suppression finale laisse le curseur au
// bout. Aucun calcul de caractère n'est nécessaire, contrairement à la même opération faite
// sur des positions de texte.
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
  MARQUEURS, EXTENSIONS, estCopieConflit, chercherCopies, copieConflitPour,
  decouperLignes, assemblerLignes, inverserBloc, appliquerBlocs
};
