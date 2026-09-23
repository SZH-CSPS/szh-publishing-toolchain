// Le groupe « Livre » du panneau d'édition et du clic droit — szh.fmt.falcHeader (en-tête
// FALC) et szh.fmt.qrLink (code QR) — réservé au profil livre. Trois niveaux :
//
//   node --test test/js/formatting-livre.test.js
//
//   * PUR (lib/formatting-pur.js, sans vscode) : le texte des deux snippets, par langue du
//     LIVRE (fr/de/it/en), et langueLivre() qui le lit dans buch.yaml.
//   * CONTRAT (package.json, package.nls*.json, lib/i18n.js) : les commandes sont
//     déclarées, `when: szh.estLivre` là où elles apparaissent, les libellés existent dans
//     les deux langues.
//   * HÔTE (lib/formatting.js, extension.js réellement activée sur un livre d'essai) :
//     présence dans les deux menus, contenu réel du snippet inséré (langue du livre, alt
//     dans la langue de l'interface), et la sélection jamais détruite.
//
// L'absence de ces deux entrées pour une revue (et donc une Zeitschrift, même profil) est
// éprouvée dans formatting-hote.test.js, sur l'hôte déjà activé là-bas — activerHote() ne
// se rappelle qu'une fois par processus (voir son commentaire).
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.SZH_LANGUE = 'fr';

const RACINE = path.resolve(__dirname, '..', '..');
const COCKPIT = path.join(RACINE, 'vscodium-extension', 'szh-cockpit');
const lire = (...p) => fs.readFileSync(path.join(RACINE, ...p), 'utf8');

// ---- PUR ------------------------------------------------------------------------------

const pur = require(path.join(COCKPIT, 'lib', 'formatting-pur.js'));

test('texteFalcHeader : le texte par défaut suit la langue du LIVRE, fr/de/it/en', () => {
  const attendus = {
    fr: ['Cette histoire existe aussi en audio.', 'Scannez le code QR.'],
    de: ['Diese Geschichte gibt es auch zum Hören.', 'Scannen Sie den QR-Code.'],
    it: ['Questa storia esiste anche in versione audio.', 'Scansiona il codice QR.'],
    en: ['This story is also available as audio.', 'Scan the QR code.']
  };
  for (const langue of Object.keys(attendus)) {
    const [audio, scan] = attendus[langue];
    const corps = pur.texteFalcHeader(langue, 'ALT');
    assert.strictEqual(corps, [
      ':::: falc-header',
      '${1:' + audio + '}',
      '${2:' + scan + '}',
      '',
      '![${3:ALT}](${4:media/image.jpg})',
      '',
      '::: qr-link',
      '${5:https://}',
      ':::',
      '::::'
    ].join('\n'), 'corps inattendu pour ' + langue);
  }
  // Langue inconnue : repli français, jamais une chaîne vide ou une exception.
  assert.match(pur.texteFalcHeader('zz', 'ALT'), /Cette histoire existe aussi en audio\./);
});

test('TEXTE_QR_LINK : tracked et size posés, les autres options laissées à la main', () => {
  assert.strictEqual(pur.TEXTE_QR_LINK, '::: {.qr-link tracked=true size=25mm}\n${1:https://}\n:::');
});

test('langueLivre : lit buch.yaml (lang:), fr/de/it/en, repli fr si absent/inconnu/illisible', () => {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-langue-livre-'));
  for (const langue of ['fr', 'de', 'it', 'en']) {
    fs.writeFileSync(path.join(dossier, 'buch.yaml'), 'titre: "Essai"\nlang: ' + langue + '\n');
    assert.strictEqual(pur.langueLivre(dossier), langue, 'langue non reconnue : ' + langue);
  }
  // 'en' : buch.yaml l'accepte (CHAMPS_LIVRE, media/_numero.js) mais yaml.langueRevue() le
  // bornerait à fr/de/it (LANGUES_META) — langueLivre() le lit donc en direct, sans passer
  // par ce plafond, ce qui est tout l'intérêt de ne pas réutiliser langueRevue() ici.
  fs.writeFileSync(path.join(dossier, 'buch.yaml'), 'titre: "Essai"\nlang: en\n');
  const yaml = require(path.join(COCKPIT, 'lib', 'yaml.js'));
  assert.strictEqual(yaml.langueRevue(dossier), 'fr', 'langueRevue ne borne plus à fr/de/it : ce test est caduc');
  assert.strictEqual(pur.langueLivre(dossier), 'en');

  fs.writeFileSync(path.join(dossier, 'buch.yaml'), 'titre: "Essai"\nlang: pt\n');
  assert.strictEqual(pur.langueLivre(dossier), 'fr', 'langue hors table : le repli doit être fr');
  fs.rmSync(path.join(dossier, 'buch.yaml'));
  assert.strictEqual(pur.langueLivre(dossier), 'fr', 'buch.yaml absent : le repli doit être fr');
  assert.strictEqual(pur.langueLivre(path.join(dossier, 'inexistant')), 'fr',
    'dossier inexistant : le repli doit être fr, jamais une exception');
});

test('PALETTE_MEF_LIVRE : le groupe « Livre », falc-header puis qr-link, qrLink documenté', () => {
  assert.deepStrictEqual(pur.PALETTE_MEF_LIVRE[0], ['--', 'palette.g.livre']);
  assert.strictEqual(pur.PALETTE_MEF_LIVRE[1][1], 'szh.fmt.falcHeader');
  assert.strictEqual(pur.PALETTE_MEF_LIVRE[2][1], 'szh.fmt.qrLink');
  assert.strictEqual(pur.PALETTE_MEF_LIVRE[2][4], 'palette.qrLink.detail',
    'qrLink ne pointe plus vers son texte d’options (tracked/size posés, les autres à la main)');
  // Ni l'une ni l'autre n'a de raccourci propre (demande de Robin : aucun de libre et
  // évident n'a été réservé — ctrl+alt+e serait libre pour falcHeader, mais rien ne le dit
  // ailleurs dans le dépôt, donc pas inventé ici).
  assert.strictEqual(pur.PALETTE_MEF_LIVRE[1][2], '');
  assert.strictEqual(pur.PALETTE_MEF_LIVRE[2][2], '');
});

// ---- CONTRAT ----------------------------------------------------------------------------

test('package.json : les deux commandes sont déclarées, catégorie SZH/CSPS', () => {
  const pkg = JSON.parse(lire('vscodium-extension', 'szh-cockpit', 'package.json'));
  for (const id of ['szh.fmt.falcHeader', 'szh.fmt.qrLink']) {
    const c = pkg.contributes.commands.find((x) => x.command === id);
    assert.ok(c, 'commande absente de contributes.commands : ' + id);
    assert.strictEqual(c.category, 'SZH/CSPS');
  }
});

test('package.json : commandPalette n’offre les deux commandes que pour un livre', () => {
  const pkg = JSON.parse(lire('vscodium-extension', 'szh-cockpit', 'package.json'));
  const palette = pkg.contributes.menus.commandPalette;
  for (const id of ['szh.fmt.falcHeader', 'szh.fmt.qrLink']) {
    const e = palette.find((x) => x.command === id);
    assert.ok(e, id + ' absente de commandPalette');
    assert.strictEqual(e.when, 'szh.estLivre', id + ' : when incorrect (' + e.when + ')');
  }
});

test('package.nls.json / package.nls.de.json : les deux titres de commande existent', () => {
  const nls = JSON.parse(lire('vscodium-extension', 'szh-cockpit', 'package.nls.json'));
  const nlsDe = JSON.parse(lire('vscodium-extension', 'szh-cockpit', 'package.nls.de.json'));
  for (const cle of ['cmd.fmt.falcHeader', 'cmd.fmt.qrLink']) {
    assert.ok(nls[cle], 'libellé français absent : ' + cle);
    assert.ok(nlsDe[cle], 'libellé allemand absent : ' + cle);
  }
});

test('lib/i18n.js : les clés du groupe « Livre » existent en français ET en allemand', () => {
  const i18n = lire('vscodium-extension', 'szh-cockpit', 'lib', 'i18n.js');
  for (const cle of ['fmt.falcHeader.alt', 'palette.g.livre', 'palette.falcHeader',
    'palette.qrLink', 'palette.qrLink.detail']) {
    const n = i18n.split("'" + cle + "':").length - 1;
    assert.strictEqual(n, 2, 'la clé « ' + cle + ' » n’existe pas en fr ET en de (trouvé ' + n + ')');
  }
});

// ---- HÔTE -------------------------------------------------------------------------------
//
// L'extension activée pour de vrai (hote-factice.js) sur un livre d'essai — lang: fr
// (voir livreDEssai(), test/js/hote-factice.js).

const archivage = require(path.join(COCKPIT, 'lib', 'archivage.js'));
archivage.lancerArchivage = () => null;   // neutralise avant activerHote, comme hote-livre.test.js

const { livreDEssai, activerHote, demarrageSeTait } = require('./hote-factice');
const LIVRE = livreDEssai();
const HOTE = activerHote(LIVRE);

const i18n = require(path.join(COCKPIT, 'lib', 'i18n.js'));
const T = i18n.T;

// Éditeur factice pour ces deux commandes : insertSnippet remplace edit() comme moyen
// d'écriture — c'est justement ce que le contrôle « sélection préservée » ci-dessous
// vérifie (aucun edit() n'est jamais appelé).
function fauxEditeurSnippet(fsPath, lignes) {
  const info = { snippets: [], edits: 0 };
  const ed = {
    document: {
      uri: { fsPath: fsPath },
      languageId: 'markdown',
      get lineCount() { return ed._lignes.length; },
      lineAt: (i) => ({ text: ed._lignes[i] })
    },
    selection: { isEmpty: true, start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
    edit: (f) => { info.edits++; f({ replace: () => {} }); return Promise.resolve(true); },
    insertSnippet: (snippet, position) => {
      info.snippets.push({ valeur: snippet.value, position: position });
      return Promise.resolve(true);
    },
    _lignes: lignes,
    _info: info
  };
  return ed;
}

test('mise en route (livre) : le démarrage se tait', async () => { await demarrageSeTait(HOTE); });

test('szh.panneauEdition : le groupe « Livre » apparaît, falc-header puis qr-link, détail sur qr-link',
  async () => {
    let propose = null;
    HOTE.stub.window.showQuickPick = (items) => { propose = items; return Promise.resolve(undefined); };
    await HOTE.executer('szh.panneauEdition');

    assert.ok(propose, 'aucun QuickPick proposé');
    const iGroupe = propose.findIndex((i) => !i.commande && i.label === T('palette.g.livre'));
    assert.notStrictEqual(iGroupe, -1, 'séparateur « Livre » absent du panneau d’édition');
    assert.strictEqual(propose[iGroupe + 1].commande, 'szh.fmt.falcHeader');
    assert.strictEqual(propose[iGroupe + 2].commande, 'szh.fmt.qrLink');
    assert.strictEqual(propose[iGroupe + 2].detail, T('palette.qrLink.detail'),
      'le détail des options qr-link non posées dans le snippet a disparu');
    // Groupe en dernier, comme les deux entrées PALETTE_MEF_LIVRE sont concaténées après
    // toute la palette de mise en forme.
    assert.strictEqual(iGroupe + 2, propose.length - 1);
  });

test('szh.miseEnForme (clic droit) : le groupe « Livre » apparaît aussi', async () => {
  const ed = fauxEditeurSnippet(path.join(LIVRE, 'chapitres', '01-ouverture', '01-ouverture.md'), ['Un paragraphe.']);
  HOTE.stub.window.activeTextEditor = ed;
  let propose = null;
  HOTE.stub.window.showQuickPick = (items) => { propose = items; return Promise.resolve(undefined); };

  await HOTE.executer('szh.miseEnForme');

  assert.ok(propose, 'aucun QuickPick proposé');
  assert.ok(propose.some((i) => i.commande === 'szh.fmt.falcHeader'));
  assert.ok(propose.some((i) => i.commande === 'szh.fmt.qrLink'));
});

test('szh.fmt.falcHeader : insère le snippet en langue du livre (fr), alt en langue de l’interface',
  async () => {
    const chapitre = path.join(LIVRE, 'chapitres', '01-ouverture', '01-ouverture.md');
    const ed = fauxEditeurSnippet(chapitre, ['']);
    ed.selection = { isEmpty: true, start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };
    HOTE.stub.window.activeTextEditor = ed;

    await HOTE.executer('szh.fmt.falcHeader');

    assert.strictEqual(ed._info.edits, 0, 'la commande a appelé editor.edit : une sélection pourrait être détruite');
    assert.strictEqual(ed._info.snippets.length, 1, 'aucun (ou plusieurs) snippet inséré');
    const attendu = pur.texteFalcHeader('fr', T('fmt.falcHeader.alt'));
    assert.strictEqual(ed._info.snippets[0].valeur, attendu,
      'le corps du snippet ne correspond pas à texteFalcHeader(\'fr\', …) — livre d’essai en fr');
  });

test('szh.fmt.falcHeader : une sélection non vide n’est jamais détruite, le bloc s’insère après elle',
  async () => {
    const chapitre = path.join(LIVRE, 'chapitres', '01-ouverture', '01-ouverture.md');
    const ed = fauxEditeurSnippet(chapitre, ['Un paragraphe sélectionné.']);
    const fin = { line: 0, character: 'Un paragraphe sélectionné.'.length };
    ed.selection = { isEmpty: false, start: { line: 0, character: 0 }, end: fin };
    HOTE.stub.window.activeTextEditor = ed;

    await HOTE.executer('szh.fmt.falcHeader');

    assert.strictEqual(ed._info.edits, 0, 'la sélection a été touchée par un edit()');
    assert.strictEqual(ed._lignes[0], 'Un paragraphe sélectionné.',
      'le texte sélectionné a changé : il ne devrait jamais l’être');
    assert.deepStrictEqual(ed._info.snippets[0].position, fin,
      'le snippet ne s’insère pas juste après la fin de la sélection');
    // La ligne sélectionnée n'est pas vide : une ligne vide doit séparer le bloc de ce
    // qui précède (même règle que les blocs ::: existants, blocSautPage/blocReferenceTable).
    assert.ok(ed._info.snippets[0].valeur.startsWith('\n\n::::'),
      'aucune ligne vide avant le bloc alors que la sélection touche du texte');
  });

test('szh.fmt.qrLink : insère le QR seul, tracked/size posés, jamais de sélection détruite',
  async () => {
    const chapitre = path.join(LIVRE, 'chapitres', '01-ouverture', '01-ouverture.md');
    const ed = fauxEditeurSnippet(chapitre, ['']);
    ed.selection = { isEmpty: true, start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };
    HOTE.stub.window.activeTextEditor = ed;

    await HOTE.executer('szh.fmt.qrLink');

    assert.strictEqual(ed._info.edits, 0);
    assert.strictEqual(ed._info.snippets[0].valeur, pur.TEXTE_QR_LINK);
  });

test('szh.miseEnForme : choisir « En-tête de chapitre (FALC) » depuis le clic droit exécute bien szh.fmt.falcHeader',
  async () => {
    const chapitre = path.join(LIVRE, 'chapitres', '01-ouverture', '01-ouverture.md');
    const ed = fauxEditeurSnippet(chapitre, ['']);
    ed.selection = { isEmpty: true, start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };
    HOTE.stub.window.activeTextEditor = ed;
    HOTE.stub.window.showQuickPick = (items) =>
      Promise.resolve(items.find((i) => i.commande === 'szh.fmt.falcHeader'));

    await HOTE.executer('szh.miseEnForme');

    assert.strictEqual(ed._info.snippets.length, 1,
      'le choix « En-tête de chapitre (FALC) » n’a pas déclenché szh.fmt.falcHeader');
  });
