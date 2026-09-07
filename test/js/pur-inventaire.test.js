// Fige la liste des noms exportés par extension.js sous `module.exports._pur` : le
// contrat que le découpage d'extension.js (lib/session.js, lib/cycle-vie.js, …) ne doit
// pas rompre. Un nom qui migre vers un module de lib/ doit être RÉ-EXPORTÉ par
// extension.js, jamais simplement déplacé — sinon un contrôle qui l'attend là s'éteint
// en silence.
//
// Exécution : depuis la racine du dépôt,
//   node --test test/js/pur-inventaire.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const { revueDEssai, activerHote } = require('./hote-factice');

const COCKPIT = path.join(__dirname, '..', '..', 'vscodium-extension', 'szh-cockpit');

const REVUE = revueDEssai();
activerHote(REVUE);   // pose le crochet Module._load qui remplace 'vscode' ; extension.js
                       // en a besoin dès son premier require, avant même toute activation.

const ext = require(path.join(COCKPIT, 'extension.js'));

// Relevée le 06.09.2026, avant le découpage en lib/session.js, lib/cycle-vie.js,
// lib/medias-hote.js, lib/documentation-hote.js, lib/apercu.js et lib/import-hote.js.
// Ne pas ajouter ni retirer un nom ici sans avoir vérifié qu'il s'agit d'un vrai
// changement de contrat, et non d'un effet de bord du découpage.
const NOMS_ATTENDUS = [
  'SCHEME_CONFLIT', 'TEXTES_COCKPIT', 'adressesAuteurs', 'ajouterColonne', 'ajouterLigne',
  'alignerCellules', 'analyserAusgabe', 'analyserFrontmatter', 'analyserMeta',
  'analyserTable', 'analyserTachesFaites', 'analyserTraduction', 'appliquerOperationTable',
  'assainirCheminPhoto', 'avertirCopiesConflit', 'basculerCitation', 'basculerEnrobage',
  'basculerSouligne', 'basculerTache', 'basculerTitre', 'blocReferenceTable',
  'brouillonAuteur', 'brouillonTraduction', 'canoniserInline', 'cheminDepuisUriConflit',
  'collerDans', 'compacterGrille', 'comparerConflit', 'compilerPuisAfficher',
  'configAvecTaches', 'construireLienTraduction', 'decomposerPhoto', 'deplacerArticle',
  'deplacerColonne', 'deplacerLigne', 'disposition', 'doisCalculesArticles',
  'ecrireAttributsImage', 'ecrireCartesArticles', 'ecrireClesAusgabe', 'ecrireDoisCalcules',
  'ecrireOrdreNouveauxArticles', 'ecrireSousMain', 'enroberBloc', 'etendreGrille',
  'finaliserModele', 'focaliserUnite', 'fournisseurDiffConflit', 'fragmentCfHtml',
  'fusionner', 'jetonSource', 'libelleArticle', 'libelleTache', 'libererCoedition',
  'lignePos', 'lignesTraduction', 'lireAttributsImage', 'lireProfil', 'mainCoedition',
  'matriceOccupation', 'messageCartes', 'moiCoedition', 'nettoyerCarte',
  'nettoyerContenuCellule', 'nettoyerHtmlBureautique', 'nomCouverture', 'nomTableLibre',
  'normaliserModele', 'noterLectureCoedition', 'numerosOrdreEnAttente', 'ordonnerArticles',
  'oublierCopiesSignalees', 'permuterStatutsTraduction', 'plagePos', 'poidsLisible',
  'positionMot', 'prefixeOrdre', 'rafraichirConflitsScm', 'rafraichirEmpreinteCoedition',
  'refusCoedition', 'refusCoeditionNumero', 'rejouerCompilationsDifferees',
  'relancerCompilation', 'relancerCompilationCartes', 'relatifImageValide',
  'resoudreBlocConflit', 'resoudreNumeroOrdre', 'resumeTaches', 'resumeTraduction',
  'retirerImage', 'retirerTable', 'scinder', 'separerFrontmatter', 'serialiserAusgabe',
  'serialiserFrontmatter', 'serialiserMeta', 'serialiserTable', 'serialiserTachesFaites',
  'serialiserTraduction', 'slugDepuisChemin', 'slugifier', 'slugifierArticle',
  'squeletteTableau', 'supprimerColonne', 'supprimerCopieConflit', 'supprimerLigne',
  'tableauDepuisHtmlBureautique', 'tableauDepuisTsv', 'tableauVierge', 'tachesConfig',
  'tachesRevue', 'texteChamp', 'titreFiche', 'titreNumero', 'uriMailto', 'valeurChamp',
  'versionsDivergent', 'viderCellules'
].sort();

test('module.exports._pur d’extension.js compte 118 noms', () => {
  assert.strictEqual(NOMS_ATTENDUS.length, 118,
    'la liste figée elle-même a changé de taille : ' + NOMS_ATTENDUS.length);
});

test('module.exports._pur d’extension.js expose exactement les noms figés, avant tout découpage', () => {
  assert.ok(ext && ext._pur, 'extension.js ne rend pas de module.exports._pur');
  const obtenus = Object.keys(ext._pur).sort();
  assert.deepStrictEqual(obtenus, NOMS_ATTENDUS,
    'la liste des noms exportés par _pur a changé — un module extrait doit RÉ-EXPORTER, ' +
    'jamais seulement déplacer');
});

test('chaque nom de _pur pointe une valeur définie, jamais un trou laissé par un déplacement', () => {
  for (const nom of NOMS_ATTENDUS) {
    assert.notStrictEqual(ext._pur[nom], undefined,
      '_pur.' + nom + ' est undefined : un module extrait a perdu sa ré-exportation');
  }
});
