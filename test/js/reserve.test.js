// lib/reserve.js : la réserve de fiches hors numéro (cahier des charges, §4) — l'aller-
// retour du frontmatter, le dépôt (avec ou sans image), la liste et le retrait. Module PUR
// (fs, path, lib/slug.js), exercé ici sans hôte VSCode, dans un dossier temporaire nettoyé
// à la fin de chaque test.
//
//   node --test "test/js/reserve.test.js"
//   node --test "test/js/*.test.js"
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const RACINE = path.resolve(__dirname, '..', '..');
const COCKPIT = path.join(RACINE, 'vscodium-extension', 'szh-cockpit');
const reserve = require(path.join(COCKPIT, 'lib', 'reserve.js'));

// Un dossier de numéro factice, sous un dossier temporaire : reserve.js range la réserve
// dans le PARENT du numéro (voir cheminReserve), donc `racineNumero` doit être un
// sous-dossier réel pour que path.dirname() désigne quelque chose de sensé.
function nouveauNumero() {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-reserve-'));
  const racineNumero = path.join(parent, '2026-02');
  fs.mkdirSync(racineNumero, { recursive: true });
  return { parent, racineNumero };
}

// ---- autreRevue ---------------------------------------------------------------------

test('autreRevue : bascule dans les deux sens, null sur une valeur inconnue', () => {
  assert.strictEqual(reserve.autreRevue('revue'), 'zeitschrift');
  assert.strictEqual(reserve.autreRevue('zeitschrift'), 'revue');
  assert.strictEqual(reserve.autreRevue('livre'), null);
  assert.strictEqual(reserve.autreRevue(''), null);
  assert.strictEqual(reserve.autreRevue(undefined), null);
  assert.deepStrictEqual(reserve.REVUES, ['revue', 'zeitschrift']);
});

// ---- cheminReserve --------------------------------------------------------------------

test('cheminReserve : dans le PARENT du numéro, sous _reserve/<revue>', () => {
  const { parent, racineNumero } = nouveauNumero();
  try {
    assert.strictEqual(reserve.NOM_DOSSIER, '_reserve');
    assert.strictEqual(
      reserve.cheminReserve(racineNumero, 'revue'),
      path.join(parent, '_reserve', 'revue')
    );
    assert.strictEqual(
      reserve.cheminReserve(racineNumero, 'zeitschrift'),
      path.join(parent, '_reserve', 'zeitschrift')
    );
  } finally { fs.rmSync(parent, { recursive: true, force: true }); }
});

// ---- Frontmatter : aller-retour ---------------------------------------------------

test('frontmatter : aller-retour fidèle, cas simple', () => {
  const fiche = {
    origine: 'revue', numeroOrigine: 'R2026-2', aTraduire: true, deposeLe: '2026-09-01',
    bloc: '::: {#r1a2b3c4 .szh-ressource type="livre" titre="Un titre"}\nDescriptif.\n:::'
  };
  const texte = reserve.serialiserFiche(fiche);
  // Forme attendue par le §4 du cahier des charges : les quatre clés dans cet ordre.
  const lignes = texte.split('\n');
  assert.strictEqual(lignes[0], '---');
  assert.strictEqual(lignes[1], 'origine: revue');
  assert.strictEqual(lignes[2], 'numero-origine: "R2026-2"');
  assert.strictEqual(lignes[3], 'a-traduire: true');
  assert.strictEqual(lignes[4], 'depose-le: "2026-09-01"');
  assert.strictEqual(lignes[5], '---');
  assert.deepStrictEqual(reserve.analyserFiche(texte), fiche);
});

test('frontmatter : aller-retour fidèle avec a-traduire à false et origine zeitschrift', () => {
  const fiche = {
    origine: 'zeitschrift', numeroOrigine: 'Z2026-1', aTraduire: false, deposeLe: '2026-01-15',
    bloc: '::: {#z1 .szh-ressource type="film" titre="Un film"}\n:::'
  };
  assert.deepStrictEqual(reserve.analyserFiche(reserve.serialiserFiche(fiche)), fiche);
});

test('frontmatter : le bloc contient lui-même une ligne « --- » — l’aller-retour reste fidèle', () => {
  const fiche = {
    origine: 'revue', numeroOrigine: 'R2026-3', aTraduire: true, deposeLe: '2026-09-01',
    bloc: '::: {#r9 .szh-ressource type="livre" titre="X"}\nAvant.\n\n---\n\nAprès le filet.\n:::'
  };
  const texte = reserve.serialiserFiche(fiche);
  const relu = reserve.analyserFiche(texte);
  assert.deepStrictEqual(relu, fiche);
  // Et le filet du bloc n'a pas été pris pour la fermeture du frontmatter : il n'y a
  // qu'une seule paire de bornes « --- » avant le bloc, une deuxième les suivrait sinon.
  assert.ok(relu.bloc.indexOf('---') !== -1, 'le filet doit survivre dans le bloc relu');
});

test('frontmatter : le bloc contient des « ::: » (bloc pandoc imbriqué) — aucune confusion', () => {
  const fiche = {
    origine: 'revue', numeroOrigine: 'R2026-4', aTraduire: false, deposeLe: '2026-02-02',
    bloc: '::: {#r1 .szh-ressource type="film" titre="Y"}\n::: aparte\nnote\n:::\n:::'
  };
  assert.deepStrictEqual(reserve.analyserFiche(reserve.serialiserFiche(fiche)), fiche);
});

test('frontmatter : absent — tout le texte devient le bloc, valeurs de repli sinon', () => {
  const texte = '::: {#r1 .szh-ressource type="livre" titre="Sans frontmatter"}\nDescriptif.\n:::';
  assert.deepStrictEqual(reserve.analyserFiche(texte), {
    origine: '', numeroOrigine: '', aTraduire: false, deposeLe: '', bloc: texte
  });
});

test('frontmatter : texte vide — repli sans lever', () => {
  assert.deepStrictEqual(reserve.analyserFiche(''), {
    origine: '', numeroOrigine: '', aTraduire: false, deposeLe: '', bloc: ''
  });
  assert.deepStrictEqual(reserve.analyserFiche(undefined), {
    origine: '', numeroOrigine: '', aTraduire: false, deposeLe: '', bloc: ''
  });
});

test('frontmatter : jamais refermé — repli sur tout le texte, comme une absence de frontmatter', () => {
  const texte = '---\norigine: revue\nnumero-origine: "R1"\n(oubli du deuxième ---)\n::: bloc\n:::';
  assert.deepStrictEqual(reserve.analyserFiche(texte), {
    origine: '', numeroOrigine: '', aTraduire: false, deposeLe: '', bloc: texte
  });
});

test('frontmatter : fichier trafiqué à la main, clés inconnues mêlées aux quatre attendues', () => {
  const texte = [
    '---',
    'origine: revue',
    'note-personnelle: à revoir avant envoi',
    'a-traduire: true',
    '---',
    '::: {#r1 .szh-ressource type="livre" titre="Z"}',
    ':::'
  ].join('\n') + '\n';
  const relu = reserve.analyserFiche(texte);
  assert.strictEqual(relu.origine, 'revue');
  assert.strictEqual(relu.aTraduire, true);
  // Les deux clés absentes retombent sur leur valeur de repli plutôt que de lever.
  assert.strictEqual(relu.numeroOrigine, '');
  assert.strictEqual(relu.deposeLe, '');
  assert.strictEqual(relu.bloc, '::: {#r1 .szh-ressource type="livre" titre="Z"}\n:::');
});

// ---- nomFichierFiche ------------------------------------------------------------------

test('nomFichierFiche : sûr, ordonnable, unique dans le temps', () => {
  const t1 = new Date(2026, 8, 1, 10, 0, 0, 0);
  const t2 = new Date(2026, 8, 1, 10, 0, 0, 1);   // une milliseconde plus tard
  const nomA = reserve.nomFichierFiche('livre', 'Le silence des bêtes', t1);
  const nomB = reserve.nomFichierFiche('livre', 'Le silence des bêtes', t2);
  assert.notStrictEqual(nomA, nomB, 'deux dépôts du même livre ne doivent pas porter le même nom');
  assert.ok(nomA.endsWith('.md'));
  assert.ok(/^[a-z0-9-]+\.md$/.test(nomA), 'nom pas sûr pour un système de fichiers : ' + nomA);
  // Le tri alphabétique doit suivre l'ordre chronologique de dépôt.
  assert.ok(nomA < nomB, 'le tri du dossier doit être chronologique : ' + nomA + ' >= ' + nomB);
});

test('nomFichierFiche : un titre vide ou entièrement non-alphanumérique reste un nom valide', () => {
  const quand = new Date(2026, 0, 1);
  for (const titre of ['', '   ', '!!!', '???...', null, undefined]) {
    const nom = reserve.nomFichierFiche('livre', titre, quand);
    assert.ok(/^[a-z0-9-]+\.md$/.test(nom), 'nom invalide pour le titre ' + JSON.stringify(titre) + ' : ' + nom);
    assert.ok(nom.length > '.md'.length);
  }
});

test('nomFichierFiche : un type vide reste aussi un nom valide', () => {
  const nom = reserve.nomFichierFiche('', 'Un titre', new Date(2026, 0, 1));
  assert.ok(/^[a-z0-9-]+\.md$/.test(nom));
});

test('nomFichierFiche : les diacritiques et la ponctuation d’un titre ne cassent rien', () => {
  const nom = reserve.nomFichierFiche('film', 'Dr. Strangelove : où l’École rêvait...', new Date(2026, 0, 1));
  assert.ok(/^[a-z0-9-]+\.md$/.test(nom), nom);
  // Le point de « Dr. » ne doit pas être pris pour une extension et amputer le titre :
  // il doit rester quelque chose du titre après le segment de type.
  assert.ok(nom.indexOf('strangelove') !== -1 || nom.indexOf('ecole') !== -1, nom);
});

// ---- lister sur un dossier absent -------------------------------------------------

test('lister : dossier de réserve absent -> liste vide, pas une erreur', () => {
  const { parent, racineNumero } = nouveauNumero();
  try {
    assert.deepStrictEqual(reserve.lister(racineNumero, 'revue'), []);
    assert.ok(!fs.existsSync(reserve.cheminReserve(racineNumero, 'revue')),
      'lister() ne doit JAMAIS créer le dossier');
  } finally { fs.rmSync(parent, { recursive: true, force: true }); }
});

// ---- deposer, sans image -----------------------------------------------------------

test('deposer : écrit le fichier, crée l’arborescence, et lister() le retrouve', () => {
  const { parent, racineNumero } = nouveauNumero();
  try {
    const fiche = {
      type: 'livre', titre: 'Un ouvrage',
      origine: 'revue', numeroOrigine: 'R2026-2', aTraduire: false, deposeLe: '2026-09-01',
      bloc: '::: {#r1 .szh-ressource type="livre" titre="Un ouvrage"}\nDescriptif.\n:::'
    };
    const { chemin } = reserve.deposer(racineNumero, 'revue', fiche);
    assert.ok(fs.existsSync(chemin));
    assert.strictEqual(path.dirname(chemin), reserve.cheminReserve(racineNumero, 'revue'));

    const trouvees = reserve.lister(racineNumero, 'revue');
    assert.strictEqual(trouvees.length, 1);
    assert.strictEqual(trouvees[0].chemin, chemin);
    assert.strictEqual(trouvees[0].fiche.origine, 'revue');
    assert.strictEqual(trouvees[0].fiche.aTraduire, false);
    assert.strictEqual(trouvees[0].fiche.bloc, fiche.bloc);
  } finally { fs.rmSync(parent, { recursive: true, force: true }); }
});

test('deposer : plusieurs fiches -> lister() les rend du plus récent au plus ancien', () => {
  const { parent, racineNumero } = nouveauNumero();
  try {
    const base = { origine: 'revue', numeroOrigine: 'R1', aTraduire: false, deposeLe: '2026-01-01' };
    reserve.deposer(racineNumero, 'revue', Object.assign({}, base,
      { type: 'livre', titre: 'Premier', bloc: ':::a:::', quand: new Date(2026, 0, 1, 10, 0, 0, 0) }));
    reserve.deposer(racineNumero, 'revue', Object.assign({}, base,
      { type: 'livre', titre: 'Second', bloc: ':::b:::', quand: new Date(2026, 0, 1, 10, 0, 0, 1) }));
    reserve.deposer(racineNumero, 'revue', Object.assign({}, base,
      { type: 'livre', titre: 'Troisième', bloc: ':::c:::', quand: new Date(2026, 0, 1, 10, 0, 0, 2) }));

    const trouvees = reserve.lister(racineNumero, 'revue');
    assert.strictEqual(trouvees.length, 3);
    assert.deepStrictEqual(trouvees.map((t) => t.fiche.bloc), [':::c:::', ':::b:::', ':::a:::']);
  } finally { fs.rmSync(parent, { recursive: true, force: true }); }
});

test('deposer : deux dépôts du même livre le même jour, à des instants différents, ne s’écrasent pas', () => {
  const { parent, racineNumero } = nouveauNumero();
  try {
    const fiche = (quand) => ({
      type: 'livre', titre: 'Même livre',
      origine: 'revue', numeroOrigine: 'R1', aTraduire: false, deposeLe: '2026-01-01',
      bloc: '::: {#r1}\n:::', quand
    });
    const r1 = reserve.deposer(racineNumero, 'revue', fiche(new Date(2026, 0, 1, 8, 0, 0, 0)));
    const r2 = reserve.deposer(racineNumero, 'revue', fiche(new Date(2026, 0, 1, 8, 0, 0, 1)));
    assert.notStrictEqual(r1.chemin, r2.chemin);
    assert.ok(fs.existsSync(r1.chemin) && fs.existsSync(r2.chemin));
  } finally { fs.rmSync(parent, { recursive: true, force: true }); }
});

// ---- deposer, avec image ------------------------------------------------------------

// ⚠ L'image va dans un SOUS-DOSSIER media/ à côté du .md, et le bloc garde son préfixe
//    `media/`. Ce n'est pas une préférence de rangement : lireRessources()
//    (lib/ressources.js) ne reconnaît une image que si sa cible commence par `media/`, et
//    une réserve à plat rendait donc ses propres blocs illisibles — la fiche revenait de la
//    réserve sans son image, avec une ligne `![](…)` collée dans son descriptif. Constaté
//    sur un aller-retour réel dépôt -> lecture -> insertion.
test('deposer : avec image — le fichier est copié dans media/ et le bloc garde son préfixe', () => {
  const { parent, racineNumero } = nouveauNumero();
  try {
    // La source de l'image : hors de la réserve, comme le serait media/couverture-x.jpg
    // dans l'article d'origine.
    const sourceImage = path.join(parent, 'couverture-x.jpg');
    fs.writeFileSync(sourceImage, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));  // JPEG minimal

    const fiche = {
      type: 'livre', titre: 'Livre illustré',
      origine: 'revue', numeroOrigine: 'R2026-2', aTraduire: true, deposeLe: '2026-09-01',
      bloc: '::: {#r1 .szh-ressource type="livre" titre="Livre illustré"}\nDescriptif.\n\n' +
        '![](media/couverture-x.jpg){alt=""}\n:::',
      image: { source: sourceImage, nom: 'couverture-x.jpg' }
    };
    const { chemin } = reserve.deposer(racineNumero, 'revue', fiche);
    const dossier = path.dirname(chemin);
    const nomImageAttendu = 'couverture-x.jpg';
    const cheminImage = path.join(dossier, 'media', nomImageAttendu);

    assert.ok(fs.existsSync(cheminImage), 'l’image n’a pas été copiée dans media/');
    assert.deepStrictEqual(fs.readFileSync(cheminImage), fs.readFileSync(sourceImage));
    // La source ne doit pas avoir disparu : deposer() COPIE, ne déplace jamais.
    assert.ok(fs.existsSync(sourceImage), 'la source ne doit pas être déplacée');

    const relue = reserve.lister(racineNumero, 'revue')[0].fiche;
    assert.ok(relue.bloc.indexOf('](media/' + nomImageAttendu + ')') !== -1,
      'le bloc doit garder son préfixe media/ : ' + relue.bloc);
    assert.ok(relue.bloc.indexOf('alt=""') !== -1, 'le reste du bloc doit survivre intact');
    // La preuve qui compte : le bloc de la réserve se relit comme un bloc d'article.
    const ressources = require(path.join(__dirname, '..', '..', 'vscodium-extension',
      'szh-cockpit', 'lib', 'ressources.js'));
    const fiches = ressources.lireRessources(relue.bloc);
    assert.strictEqual(fiches.length, 1, 'le bloc de réserve n’est plus une fiche lisible');
    assert.strictEqual(fiches[0].valeurs.image, nomImageAttendu,
      'lireRessources() ne retrouve pas l’image du bloc mis en réserve');
    assert.strictEqual(fiches[0].valeurs.descriptif, 'Descriptif.',
      'la ligne d’image a fui dans le descriptif');
  } finally { fs.rmSync(parent, { recursive: true, force: true }); }
});

test('deposer : avec image — un nom déjà pris dans la réserve est désambiguïsé', () => {
  const { parent, racineNumero } = nouveauNumero();
  try {
    const sourceImage = path.join(parent, 'source.jpg');
    fs.writeFileSync(sourceImage, Buffer.from('un'));
    const dossierMedia = path.join(reserve.cheminReserve(racineNumero, 'revue'), 'media');
    fs.mkdirSync(dossierMedia, { recursive: true });
    // Un fichier occupe déjà le nom voulu, déposé par une autre fiche.
    fs.writeFileSync(path.join(dossierMedia, 'couverture.jpg'), Buffer.from('déjà là'));

    const fiche = {
      type: 'livre', titre: 'Autre livre',
      origine: 'revue', numeroOrigine: 'R1', aTraduire: false, deposeLe: '2026-01-01',
      bloc: '::: {#r2}\n![](media/couverture.jpg){alt=""}\n:::',
      image: { source: sourceImage, nom: 'couverture.jpg' }
    };
    reserve.deposer(racineNumero, 'revue', fiche);
    // Le fichier déjà présent ne doit pas avoir été écrasé.
    assert.strictEqual(fs.readFileSync(path.join(dossierMedia, 'couverture.jpg'), 'utf8'), 'déjà là');
    assert.ok(fs.existsSync(path.join(dossierMedia, 'couverture-1.jpg')));
  } finally { fs.rmSync(parent, { recursive: true, force: true }); }
});

// ---- retirer ------------------------------------------------------------------------

test('retirer : supprime le fichier de réserve et rend true', () => {
  const { parent, racineNumero } = nouveauNumero();
  try {
    const { chemin } = reserve.deposer(racineNumero, 'revue', {
      type: 'livre', titre: 'À retirer',
      origine: 'revue', numeroOrigine: 'R1', aTraduire: false, deposeLe: '2026-01-01',
      bloc: '::: {#r1}\n:::'
    });
    assert.strictEqual(reserve.retirer(chemin), true);
    assert.ok(!fs.existsSync(chemin));
  } finally { fs.rmSync(parent, { recursive: true, force: true }); }
});

test('retirer : un fichier déjà absent rend false sans lever', () => {
  const { parent, racineNumero } = nouveauNumero();
  try {
    const chemin = path.join(reserve.cheminReserve(racineNumero, 'revue'), 'inexistant.md');
    assert.strictEqual(reserve.retirer(chemin), false);
  } finally { fs.rmSync(parent, { recursive: true, force: true }); }
});
