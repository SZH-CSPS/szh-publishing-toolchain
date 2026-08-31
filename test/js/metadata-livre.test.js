// Formulaire « Métadonnées du livre » (media/metadata-book.*, media/_numero.js,
// extension.js) : buch.yaml n'avait aucun formulaire, le plus gros manque de parité
// cockpit revue/livre (docs/REPRISE-LIVRES.md §2.1a). Le formulaire réutilise le moteur
// partagé de media/_numero.js (SZH.formulaireLivre, à côté de SZH.formulaireNumero) plutôt
// que d'en recopier un second — c'est le même contrôle qui vaut pour les deux : voir
// articles.test.js pour celui du numéro.
//
// Trois familles de contrôle, comme pour le numéro :
//   1. la table CHAMPS_LIVRE contre le FILTRE de lib/yaml.js — CLES_METADONNEES ne
//      remonte que ce qu'elle connaît, une clé oubliée s'y perd EN SILENCE (voir
//      l'avertissement au-dessus de la constante) ; c'est exactement le défaut qui a déjà
//      coûté `ordre-chapitres` une fois ;
//   2. chaque intitulé de la table existe dans les deux langues ;
//   3. l'aller-retour réel sur un buch.yaml — commentaires et clés inconnues compris —
//      puis le même geste flanqué de bout en bout, host compris, sur le vrai chemin que
//      szh.metadonnees emprunte pour un livre.
//
// buch.yaml n'a pas de frontmatter : ses métadonnées sont un YAML plat comme ausgabe.yaml,
// donc l'aller-retour passe par analyserAusgabe/serialiserAusgabe (lib/yaml.js) — pas par
// serialiserMeta, qui est le sérialiseur d'un <slug>.meta.yaml d'article ou de chapitre, un
// format différent.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const RACINE = path.resolve(__dirname, '..', '..');
const COCKPIT = path.join(RACINE, 'vscodium-extension', 'szh-cockpit');
const yaml = require(path.join(COCKPIT, 'lib', 'yaml.js'));
const { livreDEssai, activerHote } = require('./hote-factice');

const LF = String.fromCharCode(10);

// ---- 1 & 2. La table des champs, lue depuis le fragment partagé ----

function champsLivre() {
  const fragment = fs.readFileSync(path.join(COCKPIT, 'media', '_numero.js'), 'utf8');
  const debut = fragment.indexOf('var CHAMPS_LIVRE = [');
  assert.notStrictEqual(debut, -1, 'CHAMPS_LIVRE a disparu de media/_numero.js');
  const fin = fragment.indexOf('\n  ];', debut);
  const table = fragment.slice(debut, fin);
  return {
    cles: [...table.matchAll(/\{ cle: '([^']+)'/g)].map((m) => m[1]),
    libelles: [...table.matchAll(/libelle: '([^']+)'/g)].map((m) => m[1])
  };
}

const CLES_IMPRESSION = ['impression.grammage', 'impression.main', 'impression.dos-mm',
  'impression.fond-perdu-mm', 'impression.traits-de-coupe', 'impression.profil-cmjn'];

test('formulaire du livre : chaque clé de CHAMPS_LIVRE est dans CLES_METADONNEES (lib/yaml.js)', () => {
  const { cles } = champsLivre();
  assert.ok(cles.length >= 15, 'table des champs trop maigre : ' + cles.length);
  assert.strictEqual(new Set(cles).size, cles.length, 'une clé apparaît deux fois dans CHAMPS_LIVRE');
  for (const cle of cles) {
    assert.ok(yaml.CLES_METADONNEES.indexOf(cle) !== -1,
      'clé « ' + cle + ' » absente de CLES_METADONNEES : analyserAusgabe la lira comme ' +
      'absente, EN SILENCE (voir l’avertissement au-dessus de la constante) — c’est le ' +
      'défaut qui avait déjà perdu ordre-chapitres.');
  }
  for (const cle of CLES_IMPRESSION) {
    assert.ok(cles.indexOf(cle) !== -1, 'clé imbriquée manquante dans CHAMPS_LIVRE : ' + cle);
  }
});

test('formulaire du livre : les clés du bloc impression: sont aux bonnes listes (booléenne, nombres)', () => {
  // La case à cocher : une clé booléenne connue, sinon elle s'écrirait citée (« "true" »),
  // ce que ni szh-maquette.lua ni pipeline/profils/livre.mk ne lisent comme vrai.
  assert.ok(yaml.CLES_BOOLEENNES.indexOf('impression.traits-de-coupe') !== -1,
    'impression.traits-de-coupe doit être dans CLES_BOOLEENNES');
  // Les cinq nombres : nus, jamais cités (voir l'en-tête de CLES_NOMBRES, lib/yaml.js).
  for (const cle of ['annee', 'impression.grammage', 'impression.main',
    'impression.dos-mm', 'impression.fond-perdu-mm']) {
    assert.ok(yaml.CLES_NOMBRES.indexOf(cle) !== -1, 'clé numérique absente de CLES_NOMBRES : ' + cle);
  }
  // profil-cmjn est un nom de fichier .icc : jamais dans CLES_NOMBRES ni CLES_BOOLEENNES.
  assert.ok(yaml.CLES_NOMBRES.indexOf('impression.profil-cmjn') === -1);
  assert.ok(yaml.CLES_BOOLEENNES.indexOf('impression.profil-cmjn') === -1);
});

test('formulaire du livre : chaque intitulé de la table existe dans les deux langues', () => {
  const { libelles } = champsLivre();
  assert.ok(libelles.length >= 15, 'table des intitulés trop maigre : ' + libelles.length);
  const src = fs.readFileSync(path.join(COCKPIT, 'extension.js'), 'utf8');
  const i = src.indexOf('const LIBELLES_LIVRE = [');
  assert.notStrictEqual(i, -1, 'LIBELLES_LIVRE a disparu de extension.js');
  const bloc = src.slice(i, src.indexOf('];', i));
  const fournies = new Set([...bloc.matchAll(/'([^']+)'/g)].map((m) => m[1]));
  for (const cle of libelles) {
    assert.ok(fournies.has(cle), 'intitulé « ' + cle + ' » de CHAMPS_LIVRE absent de LIBELLES_LIVRE');
  }
  const i18n = fs.readFileSync(path.join(COCKPIT, 'lib', 'i18n.js'), 'utf8');
  // Deux occurrences ou plus : une par bloc de langue (fr, puis de). Une seule voudrait
  // dire que la clé n'existe que dans une langue — exactement le défaut que ce contrôle
  // doit attraper, puisqu'un texte manquant en allemand retombe en silence.
  for (const cle of fournies) {
    const occ = i18n.split("'" + cle + "'").length - 1;
    assert.ok(occ >= 2, 'clé i18n « ' + cle + ' » absente d’une des deux langues (' + occ + ' occurrence(s))');
  }
  // Deux clés hors CHAMPS_LIVRE mais réellement utilisées par ce formulaire : le titre du
  // panneau, et l'option « non définie » de la licence (textesLivre(), extension.js).
  for (const cle of ['meta.livre.panneau', 'meta.livre.licence.aucune']) {
    const occ = i18n.split("'" + cle + "'").length - 1;
    assert.ok(occ >= 2, 'clé i18n « ' + cle + ' » absente d’une des deux langues (' + occ + ' occurrence(s))');
  }
});

// ---- 3a. Aller-retour pur, sur un buch.yaml synthétique ----

test('buch.yaml : l’aller-retour ne perd ni commentaire ni clé inconnue', () => {
  const src = [
    '# En-tête du fichier, comme sur un vrai buch.yaml.',
    '# Deuxième ligne de commentaire.',
    'titre: "Ancien titre"',
    'sous-titre: "Ancien sous-titre"',
    'ouvrage: monographie',
    'lang: de',
    'maquette: normal',
    'format: standard',
    'collection: "Une collection"',
    'tome: "3"',
    'annee: 2025',
    'isbn-print: "978-0-00-000000-0"',
    'isbn-ebook: "978-0-00-000000-1"',
    'doi: "10.1/ancien"',
    'licence: cc-by-nc-nd-4.0',
    'couleur: "#112233"',
    'auteurs: []',
    'ordre-chapitres: []',
    'liminaires: [demi-titre, colophon]',
    'impression:',
    '  grammage: 90',
    '  main: 1.22',
    '  dos-mm:',
    '  fond-perdu-mm: 3',
    '  traits-de-coupe: true',
    '  profil-cmjn: ""',
    'locked: false',
    'archived: false',
    'version-toolkit: "2026.08.66"',
    'futur-champ-inconnu: "une clé que ce lot ne connaît pas encore"',
    ''
  ].join(LF);

  const modifies = {
    titre: 'Nouveau titre',
    'sous-titre': 'Nouveau sous-titre',
    annee: '2026',
    'isbn-print': '978-1-11-111111-1',
    licence: 'cc-by-4.0',
    couleur: '#ABCDEF',
    'impression.grammage': '115',
    'impression.main': '1.3',
    'impression.dos-mm': '',            // efface l'imposition : redevient calculé
    'impression.traits-de-coupe': 'false'
  };
  const sortie = yaml.serialiserAusgabe(src, modifies);

  // Rien de ce qui n'a pas été touché n'a bougé — commentaires et clé inconnue compris.
  assert.match(sortie, /^# En-tête du fichier, comme sur un vrai buch\.yaml\.$/m, 'commentaire perdu');
  assert.match(sortie, /^# Deuxième ligne de commentaire\.$/m, 'second commentaire perdu');
  assert.match(sortie, /^futur-champ-inconnu: "une clé que ce lot ne connaît pas encore"$/m,
    'une clé inconnue du formulaire a été perdue à l’écriture');
  assert.match(sortie, /^ouvrage: monographie$/m, 'clé plate non touchée perdue');
  assert.match(sortie, /^liminaires: \[demi-titre, colophon\]$/m, 'liminaires non touchée perdue');
  assert.match(sortie, /^locked: false$/m);
  assert.match(sortie, /^version-toolkit: "2026\.08\.66"$/m);
  assert.match(sortie, /^\s+fond-perdu-mm: 3$/m, 'sous-clé du bloc impression non touchée perdue');
  assert.match(sortie, /^\s+profil-cmjn: ""$/m, 'sous-clé du bloc impression non touchée perdue');

  // Ce qui a été touché a changé — nombres nus, jamais cités, dos-mm vidé sans casser
  // l'indentation du bloc.
  assert.match(sortie, /^titre: "Nouveau titre"$/m);
  assert.match(sortie, /^sous-titre: "Nouveau sous-titre"$/m);
  assert.match(sortie, /^annee: 2026$/m, 'annee doit s’écrire nue, jamais citée');
  assert.match(sortie, /^isbn-print: "978-1-11-111111-1"$/m);
  assert.match(sortie, /^licence: cc-by-4\.0$/m);
  assert.match(sortie, /^couleur: "#ABCDEF"$/m);
  assert.match(sortie, /^\s+grammage: 115$/m);
  assert.match(sortie, /^\s+main: 1\.3$/m);
  assert.match(sortie, /^\s+dos-mm:\s*$/m, 'dos-mm effacé devrait redevenir « pas de valeur imposée »');
  assert.match(sortie, /^\s+traits-de-coupe: false$/m);

  // Et relu, le fichier rend exactement ces valeurs, pour de bon — pas seulement en texte.
  const relu = yaml.analyserAusgabe(sortie);
  assert.strictEqual(relu.titre, 'Nouveau titre');
  assert.strictEqual(relu['sous-titre'], 'Nouveau sous-titre');
  assert.strictEqual(relu.annee, '2026');
  assert.strictEqual(relu['isbn-ebook'], '978-0-00-000000-1', 'clé plate non touchée : valeur changée');
  assert.strictEqual(relu.licence, 'cc-by-4.0');
  assert.strictEqual(relu.couleur, '#ABCDEF');
  assert.strictEqual(relu['impression.grammage'], '115');
  assert.strictEqual(relu['impression.main'], '1.3');
  assert.strictEqual(relu['impression.dos-mm'], '');
  assert.strictEqual(relu['impression.fond-perdu-mm'], '3', 'sous-clé non touchée : valeur changée');
  assert.strictEqual(relu['impression.traits-de-coupe'], 'false');
  assert.strictEqual(relu['impression.profil-cmjn'], '', 'sous-clé non touchée : valeur changée');
});

test('buch.yaml : une sous-clé manquante d’un bloc existant s’insère dans le bloc, pas en fin de fichier', () => {
  const src = ['titre: "Essai"', 'impression:', '  grammage: 90', 'locked: false', ''].join(LF);
  const sortie = yaml.serialiserAusgabe(src, { 'impression.main': '1.22', 'impression.fond-perdu-mm': '3' });
  const lignes = sortie.split(LF);
  const iImpression = lignes.indexOf('impression:');
  const iLocked = lignes.indexOf('locked: false');
  assert.notStrictEqual(iImpression, -1);
  assert.notStrictEqual(iLocked, -1);
  assert.ok(lignes.indexOf('  main: 1.22') > iImpression && lignes.indexOf('  main: 1.22') < iLocked,
    'main a été ajoutée hors du bloc impression:');
  assert.ok(lignes.indexOf('  fond-perdu-mm: 3') > iImpression && lignes.indexOf('  fond-perdu-mm: 3') < iLocked,
    'fond-perdu-mm a été ajoutée hors du bloc impression:');
});

test('buch.yaml : un bloc impression: absent est créé, avec toutes ses sous-clés manquantes ensemble', () => {
  const src = ['titre: "Essai"', 'ordre-chapitres: []', ''].join(LF);
  const sortie = yaml.serialiserAusgabe(src, { 'impression.grammage': '100', 'impression.main': '1.25' });
  assert.match(sortie, /^impression:$/m);
  assert.strictEqual((sortie.match(/^impression:$/gm) || []).length, 1, 'le bloc a été créé deux fois');
  const relu = yaml.analyserAusgabe(sortie);
  assert.strictEqual(relu['impression.grammage'], '100');
  assert.strictEqual(relu['impression.main'], '1.25');
});

test('buch.yaml : une clé numérique reçoit tout, mais n’écrit que des chiffres', () => {
  const src = ['titre: "Essai"', 'impression:', '  grammage: 90', ''].join(LF);
  const sortie = yaml.serialiserAusgabe(src, { 'impression.grammage': ' 90 kg/m² ' });
  assert.match(sortie, /^\s+grammage: 90$/m, 'un texte accolé au nombre a fini dans le fichier : ' + sortie);
});

// ---- 3b. Aller-retour host, sur le vrai chemin de szh.metadonnees ----

test('livre : szh.metadonnees ouvre le formulaire du LIVRE et écrit buch.yaml, pas ausgabe.yaml', async () => {
  const LIVRE = livreDEssai();
  const HOTE = activerHote(LIVRE);

  // La racine du fournisseur n'est posée qu'après le réveil (simulé) de la machine WSL,
  // en tâche de fond (extension.js, demarrageInitial()) : activerHote() rend la main avant
  // que ce réveil n'ait résolu. Même attente que hote-livre.test.js pour les surveillants
  // de fichiers, pour la même raison.
  for (let i = 0; i < 200 && !(HOTE.arbre() && HOTE.arbre().racine); i++) {
    await new Promise((r) => setTimeout(r, 5));
  }
  assert.ok(HOTE.arbre() && HOTE.arbre().racine, 'la racine du livre n’a jamais été posée : le contrôle ne prouve rien');

  await HOTE.executer('szh.metadonnees', undefined);
  const p = HOTE.dernierPanneau();
  assert.ok(p, 'aucun panneau ouvert par szh.metadonnees sur un livre');
  assert.ok(p.html && p.html.length > 3000, 'HTML absent ou tronqué');
  assert.ok(p.html.indexOf('%%SZH:') === -1, 'libellé non résolu dans le panneau');
  assert.ok(p._recepteur, 'aucun récepteur de message');

  await p._recepteur({ type: 'pret' });
  const valeursMsg = p.messages.find((m) => m.type === 'valeurs');
  assert.ok(valeursMsg, 'aucun message « valeurs » reçu');
  // Le fixture de livreDEssai() (hote-factice.js) n'a pas de bloc impression: du tout :
  // c'est le cas le plus dur, celui où le formulaire doit créer le bloc à la première
  // écriture plutôt que de le trouver déjà là.
  assert.strictEqual(valeursMsg.valeurs.titre, 'Essai de livre');
  assert.strictEqual(valeursMsg.valeurs.ouvrage, 'monographie');
  assert.strictEqual(valeursMsg.valeurs['impression.grammage'], '', 'bloc impression: absent : devrait lire vide, pas planter');
  assert.strictEqual(valeursMsg.valeurs['impression.traits-de-coupe'], 'false');

  // Écriture : un jeton hors liste (ouvrage) et une couleur invalide doivent être refusés
  // en silence — la webview ne peut pas les produire, mais l'hôte ne lui fait pas confiance.
  await p._recepteur({
    type: 'enregistrer', auto: false,
    modifies: {
      titre: 'Nouveau titre du banc', ouvrage: 'roman', couleur: 'pas-un-hex',
      'impression.grammage': '135', 'impression.traits-de-coupe': 'true'
    }
  });
  const buch = fs.readFileSync(path.join(LIVRE, 'buch.yaml'), 'utf8');
  assert.match(buch, /^titre: "Nouveau titre du banc"$/m);
  assert.match(buch, /^ouvrage: monographie$/m, 'un type d’ouvrage hors liste a été écrit');
  assert.ok(buch.indexOf('pas-un-hex') === -1, 'une couleur invalide a été écrite dans buch.yaml');
  assert.match(buch, /^impression:$/m, 'le bloc impression: n’a pas été créé');
  assert.match(buch, /^\s+grammage: 135$/m);
  assert.match(buch, /^\s+traits-de-coupe: true$/m);
  assert.ok(!fs.existsSync(path.join(LIVRE, 'ausgabe.yaml')),
    'un ausgabe.yaml parasite a été créé dans un livre — le dossier deviendrait ambigu ' +
    'pour le cockpit ET pour le Makefile (lib/profil.js)');
});
