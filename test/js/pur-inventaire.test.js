// Fige la liste des noms exportés par extension.js sous `module.exports._pur`. Un nom qui
// passe dans un module de lib/ reste ré-exporté par extension.js : un contrôle qui l'attend
// là s'éteindrait sinon sans bruit.
//
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

// Ajouter ou retirer un nom ici seulement pour un vrai changement de contrat, pas pour suivre
// un déplacement de code. chargeChapitres (test/js/livre-vue-chapitres.test.js) et
// proposerTutoriel (pas d'invitation au tutoriel sur un livre) sont exposés pour être testés
// sans activation complète.
const NOMS_ATTENDUS = [
  'SCHEME_CONFLIT', 'TEXTES_COCKPIT', 'adressesAuteurs', 'ajouterColonne', 'ajouterLigne',
  'alignerCellules', 'analyserAusgabe', 'analyserFrontmatter', 'analyserMeta',
  'analyserTable', 'analyserTachesFaites', 'analyserTraduction', 'appliquerOperationTable',
  'assainirCheminPhoto', 'avertirCopiesConflit', 'basculerCitation', 'basculerEnrobage',
  'basculerSouligne', 'basculerTache', 'basculerTitre', 'blocReferenceTable',
  'brouillonAuteur', 'brouillonTraduction', 'canoniserInline', 'chargeChapitres',
  'cheminDepuisUriConflit',
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
  'positionMot', 'prefixeOrdre', 'proposerTutoriel', 'rafraichirConflitsScm',
  'rafraichirEmpreinteCoedition', 'refusCoedition', 'refusCoeditionNumero',
  'rejouerCompilationsDifferees',
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

test('module.exports._pur d’extension.js expose exactement les 120 noms figés, avant tout découpage', () => {
  assert.ok(ext && ext._pur, 'extension.js ne rend pas de module.exports._pur');
  const obtenus = Object.keys(ext._pur).sort();
  // Le deepStrictEqual détaille les noms en trop ou manquants, ce qui couvre aussi le compte.
  assert.deepStrictEqual(obtenus, NOMS_ATTENDUS,
    'la liste des noms exportés par _pur a changé (attendu ' + NOMS_ATTENDUS.length + ' noms, ' +
    'trouvé ' + obtenus.length + ') — un module extrait doit RÉ-EXPORTER, jamais seulement déplacer');
});

test('chaque nom de _pur pointe une valeur définie, jamais un trou laissé par un déplacement', () => {
  for (const nom of NOMS_ATTENDUS) {
    assert.notStrictEqual(ext._pur[nom], undefined,
      '_pur.' + nom + ' est undefined : un module extrait a perdu sa ré-exportation');
  }
});
