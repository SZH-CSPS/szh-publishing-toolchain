// Le garde-fou du gabarit « Pronto » : un tableau qui porte les étiquettes d'une figure ou
// d'un tableau sans en avoir la forme.
//
//   node --test "test/js/*.test.js"
//
// Pourquoi une boîte de dialogue et pas une ligne de plus dans le panneau : ce tableau
// s'imprimera tel quel, sa légende ne sera ni numérotée ni reprise comme texte alternatif, et
// la seule réparation possible est dans le document Word — qu'il faut donc rouvrir. Un
// avertissement qu'on lit trois jours plus tard ne fait rouvrir aucun Word.
//
// C'est phrasesBlocMalForme() qu'on exerce ici (lib/journal.js) : pur, il prend le TEXTE du
// journal et rend les phrases à afficher. lib/import-hote.js n'y ajoute que la lecture du
// fichier et le showWarningMessage — d'où un contrôle qui n'a besoin d'aucun vscode factice.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const RACINE = path.resolve(__dirname, '..', '..');
const COCKPIT = path.join(RACINE, 'vscodium-extension', 'szh-cockpit');
const { phrasesBlocMalForme } = require(path.join(COCKPIT, 'lib', 'journal.js'));

const LF = String.fromCharCode(10);
const journalAvec = (lignes) => lignes.join(LF) + LF;

// La ligne telle que pipeline/pronto_modele.py l'écrit, avec ses trois repères : la page
// (quand Word a repaginé), le rang du tableau, et la légende annoncée.
const LIGNE_MAL_FORME = '[import-avertissement] bloc-mal-forme | article « essai » | '
  + 'tableau 3 | Le tableau de la page 5 (3ᵉ tableau, « Légende : Répartition des élèves ») '
  + 'porte les étiquettes d’une figure ou d’un tableau, mais pas la forme attendue. | '
  + '[de] Die Tabelle auf Seite 5 trägt die Bezeichnungen einer Abbildung oder Tabelle, '
  + 'aber nicht die erwartete Form.';

test('import : un tableau aux allures de bloc est remonté pour la modale, avec ses repères', () => {
  const vues = phrasesBlocMalForme(journalAvec([
    '[import] converti : essai.docx -> articles/essai/essai.md',
    LIGNE_MAL_FORME
  ]), 'fr');
  assert.strictEqual(vues.length, 1, 'le garde-fou n’a pas été remonté : ' + JSON.stringify(vues));
  assert.match(vues[0], /page 5/, 'la phrase a perdu le repère de page : ' + vues[0]);
  assert.match(vues[0], /Répartition des élèves/,
    'la phrase a perdu la légende, seul moyen de retrouver le tableau : ' + vues[0]);
  assert.ok(vues[0].indexOf('[de]') === -1,
    'la moitié allemande est restée dans la phrase française : ' + vues[0]);
});

test('import : la modale parle la langue du cockpit', () => {
  const vues = phrasesBlocMalForme(journalAvec([LIGNE_MAL_FORME]), 'de');
  assert.strictEqual(vues.length, 1);
  assert.match(vues[0], /Seite 5/, 'la moitié allemande n’a pas été retenue : ' + vues[0]);
  assert.ok(vues[0].indexOf('page 5') === -1,
    'les deux langues se retrouvent dans la même phrase : ' + vues[0]);
});

test('import : un journal ordinaire ne lève aucune modale', () => {
  // La modale doit rester rare pour se faire entendre : tout ce qui n'est pas ce garde-fou
  // précis reste dans le panneau, y compris les autres avertissements du même lecteur.
  assert.deepStrictEqual(phrasesBlocMalForme(journalAvec([
    '[import] converti : essai.docx -> articles/essai/essai.md',
    '[import-avertissement] bloc-ancienne-forme | article « essai » | tableau 3 | Forme '
      + 'dépassée. | [de] Veraltete Form.',
    '[import-avertissement] tableau-sans-entete | article « essai » | tableau 1 | Pas '
      + 'd’en-tête. | [de] Keine Kopfzeile.'
  ]), 'fr'), []);
});

test('import : deux fois le même tableau ne fait qu’une ligne dans la modale', () => {
  // Le journal d'import n'est pas remis à zéro entre deux conversions : la même ligne peut
  // s'y trouver deux fois. Une modale qui répéterait la même phrase se lirait mal.
  assert.strictEqual(
    phrasesBlocMalForme(journalAvec([LIGNE_MAL_FORME, LIGNE_MAL_FORME]), 'fr').length, 1);
});

test('import : un journal vide ne lève rien — un dossier neuf n’est pas une panne', () => {
  assert.deepStrictEqual(phrasesBlocMalForme('', 'fr'), []);
});
