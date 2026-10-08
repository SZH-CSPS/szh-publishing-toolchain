// Formulaire « Métadonnées du livre », second volet : ce qui définit l'ouvrage lui-même.
//
// CLES_METADONNEES (lib/yaml.js) ignore toute clé qu'elle ne liste pas. Ce fichier vérifie :
//   1. l'aller-retour d'une liste de personnes (liste de dicts) dans buch.yaml, sans perte
//      des autres clés ni de l'ordre ;
//   2. les clés de CLES_METADONNEES (et l'absence de impression.couverture-mm) ;
//   3. la validation côté hôte : couleur d'impression et fond dans la liste fermée de
//      pipeline/styles/couleurs-reference.json, teinte de 1 à 100 ;
//   4. le DOM du formulaire : cartes auteur·e·s et éditeur·rice·s (celles des articles),
//      pastilles de couleur, dos calculé en lecture seule ;
//   5. l'illustration de couverture et le bouton de la 4e de couverture, de bout en bout.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const RACINE = path.resolve(__dirname, '..', '..');
const COCKPIT = path.join(RACINE, 'vscodium-extension', 'szh-cockpit');
const yaml = require(path.join(COCKPIT, 'lib', 'yaml.js'));
const { livreDEssai, activerHote } = require('./hote-factice');
const { ouvrir, chargerAvecVscodeFactice } = require('./dom-minimal');
const { T } = chargerAvecVscodeFactice(path.join(COCKPIT, 'lib', 'i18n.js'));

const LF = String.fromCharCode(10);
const NBSP = String.fromCharCode(0xA0);

const REFERENCE = JSON.parse(fs.readFileSync(
  path.join(RACINE, 'pipeline', 'styles', 'couleurs-reference.json'), 'utf8'));
const CLES_COULEURS = Object.keys(REFERENCE);

// ---- 1. Liste de personnes dans buch.yaml ----

const BUCH_PERSONNES = [
  '# Banc d’essai : deux auteur·e·s, deux éditeur·rice·s.',
  'titre: "Le titre"',
  'ouvrage: collectif',
  'lang: fr',
  'auteurs:',
  '- prenom: "Anne-Sophie"',
  '  nom: "d\'Esposito"',
  '  fonction: "Professeure"',
  '  affiliation: "Université de Fribourg"',
  '  orcid: "0000-0002-1825-0097"',
  '- prenom: "Jean"',
  '  nom: "Müller \\"le Jeune\\""',
  '  fonction: ""',
  '  affiliation: "SZH / CSPS"',
  '  orcid: ""',
  'editeurs:',
  '- prenom: "Claire"',
  '  nom: "Dupont"',
  '  fonction: "Directrice"',
  '  affiliation: "HEP Vaud"',
  '  orcid: ""',
  '- prenom: "Marc"',
  '  nom: "Rochat"',
  '  fonction: ""',
  '  affiliation: ""',
  '  orcid: "0000-0001-2345-6789"',
  'mention-editeurs: "Éditeurs"',
  'ordre-chapitres: []',
  'liminaires: [demi-titre, colophon]',
  'impression:',
  '  grammage: 90',
  '  main: 1.27',
  'futur-champ-inconnu: "reste intact"',
  ''
].join(LF);

test('buch.yaml : auteurs et editeurs (2 personnes, 5 champs) font l’aller-retour sans perte', () => {
  const lu = yaml.analyserAusgabe(BUCH_PERSONNES);
  assert.strictEqual(lu.auteurs.length, 2, 'auteurs lus comme absents : ' + JSON.stringify(lu.auteurs));
  assert.strictEqual(lu.editeurs.length, 2);
  assert.deepStrictEqual(lu.auteurs[0], {
    prenom: 'Anne-Sophie', nom: 'd\'Esposito', fonction: 'Professeure',
    affiliation: 'Université de Fribourg', orcid: '0000-0002-1825-0097'
  });
  assert.strictEqual(lu.auteurs[1].nom, 'Müller "le Jeune"', 'guillemet échappé mal relu');
  assert.strictEqual(lu.editeurs[1].orcid, '0000-0001-2345-6789');
  assert.strictEqual(lu['mention-editeurs'], 'Éditeurs');
  // Réécrites telles quelles, les deux listes redonnent le fichier octet pour octet :
  // même ordre des personnes, des champs, des clés, rien d'autre ne bouge.
  const sortie = yaml.serialiserAusgabe(BUCH_PERSONNES, { auteurs: lu.auteurs, editeurs: lu.editeurs });
  assert.strictEqual(sortie, BUCH_PERSONNES);
});

test('buch.yaml : modifier les auteurs ne touche ni les éditeurs ni les autres clés', () => {
  const lu = yaml.analyserAusgabe(BUCH_PERSONNES);
  const nouveaux = [lu.auteurs[1], lu.auteurs[0],
    { prenom: 'Zoé', nom: 'Nouvelle', fonction: '', affiliation: '', orcid: '' }];
  const sortie = yaml.serialiserAusgabe(BUCH_PERSONNES, { auteurs: nouveaux });
  const relu = yaml.analyserAusgabe(sortie);
  assert.deepStrictEqual(relu.auteurs.map((a) => a.prenom), ['Jean', 'Anne-Sophie', 'Zoé'], 'ordre perdu');
  assert.deepStrictEqual(relu.editeurs, lu.editeurs, 'les éditeurs ont bougé');
  for (const l of ['# Banc d’essai : deux auteur·e·s, deux éditeur·rice·s.', 'ordre-chapitres: []',
    'liminaires: [demi-titre, colophon]', 'futur-champ-inconnu: "reste intact"', '  grammage: 90',
    'mention-editeurs: "Éditeurs"']) {
    assert.ok(sortie.split(LF).indexOf(l) !== -1, 'ligne perdue : ' + l);
  }
  assert.strictEqual((sortie.match(/^auteurs:$/gm) || []).length, 1, 'bloc auteurs dupliqué');
  // Vider la liste : la clé reste, en `[]`, comme dans les modèles du dépôt.
  const vide = yaml.serialiserAusgabe(BUCH_PERSONNES, { auteurs: [] });
  assert.match(vide, /^auteurs: \[\]$/m);
  assert.deepStrictEqual(yaml.analyserAusgabe(vide).auteurs, []);
  assert.deepStrictEqual(yaml.analyserAusgabe(vide).editeurs, lu.editeurs);
});

test('buch.yaml : les listes absentes sont créées, vides elles ne créent rien, et le tiret indenté se lit', () => {
  const src = ['titre: "Essai"', 'ordre-chapitres: []', ''].join(LF);
  const un = [{ prenom: 'Ada', nom: 'Lovelace', fonction: '', affiliation: '', orcid: '' }];
  const cree = yaml.serialiserAusgabe(src, { editeurs: un });
  assert.deepStrictEqual(yaml.analyserAusgabe(cree).editeurs, un);
  assert.strictEqual(yaml.serialiserAusgabe(src, { editeurs: [] }), src, 'une liste vide a créé une clé');
  const indente = ['auteurs:', '  - prenom: "Ada"', '    nom: "Lovelace"', 'titre: "T"', ''].join(LF);
  const lu = yaml.analyserAusgabe(indente);
  assert.strictEqual(lu.auteurs.length, 1);
  assert.strictEqual(lu.auteurs[0].nom, 'Lovelace');
  assert.strictEqual(lu.titre, 'T', 'la clé qui suit la liste a été avalée');
});

// ---- 2. Les clés ----

test('CLES_METADONNEES : clés du livre ajoutées, couverture-mm absente, types corrects', () => {
  for (const cle of ['auteurs', 'editeurs', 'mention-editeurs', 'couleur-impression',
    'couverture.fond', 'couverture.fond-teinte', 'impression.couverture-volume',
    'impression.couverture-grammage', 'impression.colle-mm']) {
    assert.ok(yaml.CLES_METADONNEES.indexOf(cle) !== -1, 'clé absente de CLES_METADONNEES : ' + cle);
  }
  assert.ok(yaml.CLES_METADONNEES.indexOf('impression.couverture-mm') === -1,
    'impression.couverture-mm est supprimée du schéma');
  for (const cle of ['couverture.fond-teinte', 'impression.couverture-volume',
    'impression.couverture-grammage', 'impression.colle-mm']) {
    assert.ok(yaml.CLES_NOMBRES.indexOf(cle) !== -1, 'nombre non nu : ' + cle);
  }
  const src = ['titre: "T"', 'couverture:', '  fond: poireau', 'impression:', '  grammage: 90', ''].join(LF);
  const sortie = yaml.serialiserAusgabe(src, {
    'couleur-impression': 'bleu-acier', 'couverture.fond': 'nuit', 'couverture.fond-teinte': '12',
    'impression.couverture-volume': '1.3', 'impression.couverture-grammage': '',
    'impression.colle-mm': '0.4', 'mention-editeurs': 'Éditrices'
  });
  assert.match(sortie, /^couleur-impression: bleu-acier$/m, 'la clé de couleur s’écrit en jeton nu');
  assert.match(sortie, /^ {2}fond: nuit$/m);
  assert.match(sortie, /^ {2}fond-teinte: 12$/m);
  assert.match(sortie, /^ {2}couverture-volume: 1\.3$/m);
  assert.match(sortie, /^ {2}colle-mm: 0\.4$/m);
  assert.match(sortie, /^mention-editeurs: "Éditrices"$/m);
  assert.strictEqual((sortie.match(/^couverture:$/gm) || []).length, 1, 'bloc couverture: dupliqué');
  const relu = yaml.analyserAusgabe(sortie);
  assert.strictEqual(relu['couverture.fond'], 'nuit');
  assert.strictEqual(relu['couverture.fond-teinte'], '12');
  assert.strictEqual(relu['couleur-impression'], 'bleu-acier');
});

// ---- 3 à 5. L'hôte et la page, sur le vrai chemin de szh.metadonnees ----

// Un seul activerHote() par processus (voir hote-factice.js) : un seul livre et un seul
// panneau pour tout le fichier. Chaque test réécrit buch.yaml, vide out/ et couverture/,
// puis rouvre le formulaire, qui relit le disque.
let amorce = null;
async function ouvrirLivre(fichierBuch) {
  if (!amorce) {
    const LIVRE = livreDEssai();
    const HOTE = activerHote(LIVRE);
    for (let i = 0; i < 200 && !(HOTE.arbre() && HOTE.arbre().racine); i++) {
      await new Promise((r) => setTimeout(r, 5));
    }
    assert.ok(HOTE.arbre() && HOTE.arbre().racine, 'la racine du livre n’a jamais été posée');
    amorce = { LIVRE: LIVRE, HOTE: HOTE, depart: fs.readFileSync(path.join(LIVRE, 'buch.yaml'), 'utf8') };
  }
  const { LIVRE, HOTE } = amorce;
  fs.writeFileSync(path.join(LIVRE, 'buch.yaml'), fichierBuch === undefined ? amorce.depart : fichierBuch);
  for (const d of ['out', 'couverture']) { fs.rmSync(path.join(LIVRE, d), { recursive: true, force: true }); }
  await HOTE.executer('szh.metadonnees', undefined);
  const p = HOTE.dernierPanneau();
  assert.ok(p && p._recepteur, 'aucun panneau ouvert par szh.metadonnees sur un livre');
  const avant = p.messages.length;
  await p._recepteur({ type: 'pret' });
  return {
    LIVRE, HOTE, p,
    valeurs: () => p.messages.slice(avant).filter((m) => m.type === 'valeurs').pop()
  };
}

// Le TXT que l'hôte injecte dans la page, relu du HTML : la page s'éprouve avec les vrais
// libellés et la vraie liste de couleurs.
function txtDuPanneau(html) {
  const debut = html.indexOf('const TXT = ');
  assert.notStrictEqual(debut, -1, 'TXT introuvable dans le HTML du panneau');
  const fin = html.indexOf(';' + LF, debut);
  return JSON.parse(html.slice(debut + 'const TXT = '.length, fin));
}

async function attendre(condition, message) {
  for (let i = 0; i < 400 && !condition(); i++) { await new Promise((r) => setTimeout(r, 5)); }
  assert.ok(condition(), message);
}

test('livre : la validation de l’hôte refuse une couleur hors de la liste de référence', async () => {
  const { LIVRE, p } = await ouvrirLivre();
  const ecrire = async (modifies) => {
    await p._recepteur({ type: 'enregistrer', auto: false, modifies: modifies });
    return fs.readFileSync(path.join(LIVRE, 'buch.yaml'), 'utf8');
  };
  let buch = await ecrire({ 'couleur-impression': 'violet', 'couverture.fond': 'fuchsia',
    'couverture.fond-teinte': '150', 'mention-editeurs': 'Éditrices' });
  assert.ok(buch.indexOf('violet') === -1, 'une couleur hors liste a été écrite');
  assert.ok(buch.indexOf('fuchsia') === -1, 'un fond hors liste a été écrit');
  assert.ok(!/fond-teinte/.test(buch), 'une teinte de 150 % a été écrite');
  assert.match(buch, /^mention-editeurs: "Éditrices"$/m, 'le texte libre est refusé à tort');
  assert.strictEqual(CLES_COULEURS.length, 8);
  for (const cle of CLES_COULEURS) {
    buch = await ecrire({ 'couleur-impression': cle });
    assert.match(buch, new RegExp('^couleur-impression: ' + cle + '$', 'm'), 'clé de référence refusée : ' + cle);
  }
  buch = await ecrire({ 'couverture.fond': 'mountbatten', 'couverture.fond-teinte': '9' });
  assert.match(buch, /^ {2}fond: mountbatten$/m);
  assert.match(buch, /^ {2}fond-teinte: 9$/m);
  buch = await ecrire({ 'couverture.fond-teinte': '0' });
  assert.match(buch, /^ {2}fond-teinte: 9$/m, 'une teinte de 0 % a été écrite');
  // Les réglages d'impression connus passent, impression.couverture-mm est ignoré.
  buch = await ecrire({ 'impression.couverture-volume': '1.3', 'impression.couverture-grammage': '300',
    'impression.colle-mm': '0.5', 'impression.couverture-mm': '12' });
  assert.match(buch, /^ {2}couverture-volume: 1\.3$/m);
  assert.match(buch, /^ {2}couverture-grammage: 300$/m);
  assert.match(buch, /^ {2}colle-mm: 0\.5$/m);
  assert.ok(buch.indexOf('couverture-mm') === -1, 'impression.couverture-mm est revenue');
});

test('livre : auteurs et éditeurs arrivent dans le formulaire, repartent assainis', async () => {
  const { LIVRE, p, valeurs } = await ouvrirLivre(BUCH_PERSONNES);
  const v = valeurs();
  assert.ok(v, 'aucun message « valeurs »');
  assert.strictEqual(v.valeurs.auteurs.length, 2);
  assert.strictEqual(v.valeurs.editeurs[0].nom, 'Dupont');
  assert.strictEqual(v.valeurs['mention-editeurs'], 'Éditeurs');
  await p._recepteur({
    type: 'enregistrer', auto: false,
    modifies: {
      editeurs: [
        { prenom: ' Claire ', nom: 'Dupont', fonction: 'Directrice', affiliation: 'HEP Vaud', orcid: '', photo: '', inconnu: 'x' },
        { prenom: '', nom: '', fonction: 'fantôme', affiliation: '', orcid: '' }
      ]
    }
  });
  const relu = yaml.analyserAusgabe(fs.readFileSync(path.join(LIVRE, 'buch.yaml'), 'utf8'));
  assert.strictEqual(relu.editeurs.length, 1, 'une personne sans nom a été écrite');
  assert.strictEqual(relu.editeurs[0].prenom, 'Claire');
  assert.ok(!('inconnu' in relu.editeurs[0]), 'une clé hors schéma a été écrite');
  assert.strictEqual(relu.auteurs.length, 2, 'les auteurs, non touchés, ont bougé');
});

function descendants(element) {
  const sortie = [];
  const visiter = (e) => { for (const c of e.enfants) { sortie.push(c); visiter(c); } };
  visiter(element);
  return sortie;
}
const parCle = (racine, cle) => descendants(racine).filter((e) => e.dataset && e.dataset.cle === cle);

async function pageDuLivre(fichierBuch, lignesOut) {
  let hote = await ouvrirLivre(fichierBuch);
  if (lignesOut) {
    fs.mkdirSync(path.join(hote.LIVRE, 'out'), { recursive: true });
    for (const [nom, contenu] of Object.entries(lignesOut)) {
      fs.writeFileSync(path.join(hote.LIVRE, 'out', path.basename(hote.LIVRE) + nom), contenu);
    }
    const avant = hote.p.messages.length;
    await hote.p._recepteur({ type: 'pret' });
    const h = hote;
    hote = Object.assign({}, h, {
      valeurs: () => h.p.messages.slice(avant).filter((m) => m.type === 'valeurs').pop()
    });
  }
  const page = ouvrir({
    racine: RACINE, page: 'metadata-book',
    cssPartage: ['_design.css', '_numero.css', '_auteurs.css'],
    jsPartage: ['_messages.js', '_auteurs.js', '_numero.js'],
    txt: txtDuPanneau(hote.p.html)
  });
  assert.deepStrictEqual(page.messages.map((m) => m.type), ['pret']);
  const v = hote.valeurs();
  const msg = { type: 'valeurs', valeurs: v.valeurs };
  if (v.dos !== undefined) { msg.dos = v.dos; }
  if (v.couverture !== undefined) { msg.couverture = v.couverture; }
  if (v.couleursImpression !== undefined) { msg.couleursImpression = v.couleursImpression; }
  page.envoyer(msg);
  return Object.assign({ page: page, formulaire: page.parId.livre }, hote);
}

test('livre : le formulaire montre les cartes auteur·e·s et éditeur·rice·s des articles', async () => {
  const { page, formulaire } = await pageDuLivre(BUCH_PERSONNES);
  const auteurs = parCle(formulaire, 'auteurs')[0];
  const editeurs = parCle(formulaire, 'editeurs')[0];
  assert.ok(auteurs, 'pas de carte « auteurs » dans le formulaire du livre');
  assert.ok(editeurs, 'pas de carte « editeurs » dans le formulaire du livre');
  const fiches = (e) => descendants(e).filter((x) => x.classes.has('auteur-fiche'));
  assert.strictEqual(fiches(auteurs).length, 2, 'une fiche (celle des articles) par auteur·e');
  assert.strictEqual(fiches(editeurs).length, 2);
  const texte = descendants(auteurs).map((x) => x.textContent).join(' ');
  assert.ok(texte.indexOf('Esposito') !== -1, 'nom d’auteur·e absent du rendu');
  // La mention : champ libre, son défaut en filigrane (langue du livre = fr).
  const mention = parCle(formulaire, 'mention-editeurs')[0];
  assert.ok(mention, 'pas de champ « mention des éditeurs »');
  assert.strictEqual(mention.value, 'Éditeurs');
  // Retirer un·e éditeur·rice et enregistrer : la liste repart sans lui ni elle, et seule
  // la liste touchée part.
  const retirer = descendants(editeurs).filter((x) => x.classes.has('szh-ico--danger'));
  assert.strictEqual(retirer.length, 2, 'un bouton « retirer » par éditeur·rice');
  retirer[1].dispatchEvent({ type: 'click' });
  page.parId.enregistrer.dispatchEvent({ type: 'click' });
  const envoi = page.messages.filter((m) => m.type === 'enregistrer').pop();
  assert.ok(envoi, 'rien n’est parti à l’enregistrement');
  assert.deepStrictEqual(Array.from(Object.keys(envoi.modifies)), ['editeurs']);
  assert.strictEqual(envoi.modifies.editeurs.length, 1);
  assert.strictEqual(envoi.modifies.editeurs[0].nom, 'Dupont');
});

test('livre : couleur d’impression en pastilles, les huit de la référence, et la couleur numérique relibellée', async () => {
  const { page, formulaire } = await pageDuLivre('titre: "T"\ncouleur-impression: rouge\nlang: fr\n');
  for (const cle of ['couleur-impression', 'couverture.fond']) {
    const zone = parCle(formulaire, cle)[0];
    assert.ok(zone, 'pas de zone « ' + cle + ' »');
    const pastilles = descendants(zone).filter((x) => x.classes.has('pastille'));
    assert.strictEqual(pastilles.length, 8, cle + ' : une pastille par couleur de référence');
    const noms = pastilles.map((x) => x.textContent).sort();
    assert.deepStrictEqual(noms, CLES_COULEURS.map((k) => REFERENCE[k].nom).sort());
    // La pastille montre la couleur RGB de la ligne de référence, lue du JSON et non recopiée.
    const puces = pastilles.map((x) => descendants(x).find((y) => y.classes.has('puce')).style.background);
    assert.deepStrictEqual(puces.sort(), CLES_COULEURS.map((k) => REFERENCE[k].rgb).sort());
  }
  const rouge = descendants(parCle(formulaire, 'couleur-impression')[0])
    .find((x) => x.textContent === 'Rouge');
  assert.strictEqual(rouge.getAttribute('aria-pressed'), 'true', 'la valeur du fichier n’est pas allumée');
  // Un clic choisit et ne propose que la clé de référence.
  const nuit = descendants(parCle(formulaire, 'couleur-impression')[0]).find((x) => x.textContent === 'Nuit');
  nuit.dispatchEvent({ type: 'click' });
  page.parId.enregistrer.dispatchEvent({ type: 'click' });
  const envoi = page.messages.filter((m) => m.type === 'enregistrer').pop();
  assert.deepStrictEqual(JSON.parse(JSON.stringify(envoi.modifies)), { 'couleur-impression': 'nuit' });
  // Le champ `couleur` existant reste, relibellé : écran, EPUB, web.
  const libelle = descendants(formulaire).filter((x) => x.balise === 'label')
    .map((x) => x.textContent).join(' | ');
  assert.ok(/écran/.test(libelle) && /EPUB/.test(libelle), 'libellé de la couleur numérique : ' + libelle);
});

test('livre : le dos calculé se lit depuis out/<livre>-dos.json, ou dit qu’il manque', async () => {
  const sans = await pageDuLivre('titre: "T"\nlang: fr\n');
  assert.strictEqual(sans.valeurs().dos, null, 'sans fichier, l’hôte doit envoyer null');
  const absent = parCle(sans.formulaire, 'dos')[0];
  assert.ok(absent, 'pas de ligne « dos calculé »');
  assert.strictEqual(absent.textContent, 'pas encore calculé' + NBSP + ': compilez la couverture');

  const avec = await pageDuLivre('titre: "T"\nlang: fr\n', {
    '-dos.json': JSON.stringify({ nb_pages: 134, dos_mm: 9.3, grammage_couverture: 250, source: 'calcul' })
  });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(avec.valeurs().dos)),
    { nb_pages: 134, dos_mm: 9.3, grammage_couverture: 250, source: 'calcul' });
  const ligne = parCle(avec.formulaire, 'dos')[0];
  assert.strictEqual(ligne.textContent,
    '9,3' + NBSP + 'mm' + NBSP + '– 134' + NBSP + 'pages' + NBSP + '– couverture 250' + NBSP + 'g/m²');
  // Lecture seule : un texte, pas un champ qui repartirait à l'enregistrement.
  assert.strictEqual(ligne.balise, 'p');
  // Un JSON illisible vaut « pas calculé », sans exception ni NaN à l'écran.
  const casse = await pageDuLivre('titre: "T"\nlang: fr\n', { '-dos.json': '{ pas du json' });
  assert.strictEqual(casse.valeurs().dos, null);
});

test('livre : l’illustration de couverture se dépose, se remplace sur confirmation, et la 4e de couverture s’ouvre', async () => {
  const { LIVRE, HOTE, p } = await ouvrirLivre();
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const dossier = path.join(LIVRE, 'couverture');
  await p._recepteur({ type: 'couverture-deposer', nomFichier: 'Ma Couv.PNG', donneesBase64: png.toString('base64') });
  await attendre(() => fs.existsSync(path.join(dossier, 'illustration.png')), 'illustration.png non écrite');
  const rep = p.messages.filter((m) => m.type === 'couverture').pop();
  assert.ok(rep && rep.nom === 'illustration.png' && /^data:image\/png;base64,/.test(rep.apercu),
    'aucun aperçu renvoyé à la page : ' + JSON.stringify(rep && rep.nom));
  // Format refusé : ni écrit, ni remplacé.
  await p._recepteur({ type: 'couverture-deposer', nomFichier: 'x.gif', donneesBase64: png.toString('base64') });
  assert.deepStrictEqual(fs.readdirSync(dossier), ['illustration.png']);
  // Remplacement : refusé à la modale, l'ancienne reste ; accepté, elle est remplacée et
  // aucun autre illustration.* ne traîne.
  const jpg = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');
  HOTE.repondreModale(undefined);
  await p._recepteur({ type: 'couverture-deposer', nomFichier: 'autre.jpg', donneesBase64: jpg.toString('base64') });
  await new Promise((r) => setTimeout(r, 50));
  assert.deepStrictEqual(fs.readdirSync(dossier), ['illustration.png'], 'remplacée sans confirmation');
  HOTE.repondreModale(T('meta.livre.illustration.remplacer.oui'));
  await p._recepteur({ type: 'couverture-deposer', nomFichier: 'autre.jpg', donneesBase64: jpg.toString('base64') });
  await attendre(() => fs.existsSync(path.join(dossier, 'illustration.jpg')), 'illustration.jpg non écrite');
  assert.deepStrictEqual(fs.readdirSync(dossier), ['illustration.jpg']);
  // La 4e de couverture : le bouton crée le fichier vide s'il manque, puis l'ouvre.
  assert.ok(!fs.existsSync(path.join(dossier, 'quatrieme.md')));
  await p._recepteur({ type: 'ouvrir', cible: 'quatrieme' });
  assert.ok(fs.existsSync(path.join(dossier, 'quatrieme.md')), 'quatrieme.md non créé');
  assert.strictEqual(fs.readFileSync(path.join(dossier, 'quatrieme.md'), 'utf8'), '');
  fs.writeFileSync(path.join(dossier, 'quatrieme.md'), 'Texte existant' + LF);
  await p._recepteur({ type: 'ouvrir', cible: 'quatrieme' });
  assert.strictEqual(fs.readFileSync(path.join(dossier, 'quatrieme.md'), 'utf8'), 'Texte existant' + LF,
    'un 4e de couverture existant a été écrasé');
});

// ---- Décalage de l'illustration et retour à la ligne forcé dans un titre ----

test('décalage de l’illustration : clés du bloc couverture, nombres nus, négatifs et décimales permis', () => {
  for (const cle of ['couverture.illustration-x-mm', 'couverture.illustration-y-mm']) {
    assert.ok(yaml.CLES_METADONNEES.indexOf(cle) !== -1, 'absente de CLES_METADONNEES : ' + cle);
    assert.ok(yaml.CLES_NOMBRES.indexOf(cle) !== -1, 'écrite autrement qu’en nombre nu : ' + cle);
  }
  const src = ['titre: "T"', 'couverture:', '  fond: poireau', '  fond-teinte: 9', 'locked: false', ''].join(LF);
  const sortie = yaml.serialiserAusgabe(src, {
    'couverture.illustration-x-mm': '-1.5', 'couverture.illustration-y-mm': '2.25'
  });
  assert.match(sortie, /^ {2}illustration-x-mm: -1\.5$/m);
  assert.match(sortie, /^ {2}illustration-y-mm: 2\.25$/m);
  const lignes = sortie.split(LF);
  assert.ok(lignes.indexOf('  illustration-x-mm: -1.5') < lignes.indexOf('locked: false'),
    'décalage écrit hors du bloc couverture:');
  assert.strictEqual((sortie.match(/^couverture:$/gm) || []).length, 1);
  const relu = yaml.analyserAusgabe(sortie);
  assert.strictEqual(relu['couverture.illustration-x-mm'], '-1.5');
  assert.strictEqual(relu['couverture.fond'], 'poireau', 'le fond voisin a bougé');
  // Vidé : la clé reste, sans valeur (= 0).
  const vide = yaml.serialiserAusgabe(sortie, { 'couverture.illustration-x-mm': '' });
  assert.match(vide, /^ {2}illustration-x-mm:\s*$/m);
});

test('livre : le décalage passe la validation de l’hôte, les valeurs absurdes non', async () => {
  const { LIVRE, p } = await ouvrirLivre();
  const ecrire = async (modifies) => {
    await p._recepteur({ type: 'enregistrer', auto: false, modifies: modifies });
    return yaml.analyserAusgabe(fs.readFileSync(path.join(LIVRE, 'buch.yaml'), 'utf8'));
  };
  let lu = await ecrire({ 'couverture.illustration-x-mm': '-3,5', 'couverture.illustration-y-mm': '4' });
  assert.strictEqual(lu['couverture.illustration-x-mm'], '-3.5', 'la virgule décimale n’est pas ramenée au point');
  assert.strictEqual(lu['couverture.illustration-y-mm'], '4');
  lu = await ecrire({ 'couverture.illustration-x-mm': 'abc', 'couverture.illustration-y-mm': '99999' });
  assert.strictEqual(lu['couverture.illustration-x-mm'], '-3.5', 'un texte a été écrit comme décalage');
  assert.strictEqual(lu['couverture.illustration-y-mm'], '4', 'un décalage de 99 mètres a été écrit');
  lu = await ecrire({ 'couverture.illustration-x-mm': '' });
  assert.strictEqual(lu['couverture.illustration-x-mm'], '', 'vider le champ doit remettre le décalage à zéro');
});

test('livre : champs de décalage dans le bloc de couverture, aide « Entrée » sous titre et sous-titre', async () => {
  const { page, formulaire } = await pageDuLivre('titre: "T"\nlang: fr\ncouverture:\n  illustration-x-mm: -2\n');
  const x = parCle(formulaire, 'couverture.illustration-x-mm')[0];
  const y = parCle(formulaire, 'couverture.illustration-y-mm')[0];
  assert.ok(x && y, 'champs de décalage absents');
  assert.strictEqual(x.type, 'number');
  assert.strictEqual(x.getAttribute('step') || x.step, 'any', 'les décimales ne passent pas');
  assert.strictEqual(x.value, '-2');
  assert.strictEqual(y.value, '');
  const aides = (cle) => {
    const bloc = parCle(formulaire, cle)[0].parent;
    return descendants(bloc).filter((e) => e.classes.has('champ-aide')).map((e) => e.textContent);
  };
  assert.deepStrictEqual(Array.from(aides('couverture.illustration-x-mm')), ['+ vers la droite / + vers le bas']);
  assert.deepStrictEqual(Array.from(aides('titre')), ['Entrée' + NBSP + ': retour à la ligne forcé']);
  assert.deepStrictEqual(Array.from(aides('sous-titre')), ['Entrée' + NBSP + ': retour à la ligne forcé']);
  // Dans le même bloc que le fond : ils se suivent dans le formulaire (un seul bloc à fusionner).
  const ordre = descendants(formulaire).map((e) => e.dataset && e.dataset.cle)
    .filter((c) => c && c.indexOf('couverture.') === 0);
  assert.deepStrictEqual(ordre, ['couverture.fond', 'couverture.fond-teinte',
    'couverture.illustration-x-mm', 'couverture.illustration-y-mm', 'couverture.modele',
    'couverture.illustration-plein', 'couverture.titre-2', 'couverture.sous-titre-2']);
  // Saisir un décalage négatif le fait partir à l'enregistrement.
  y.value = '-0.5';
  y.dispatchEvent({ type: 'input' });
  page.parId.enregistrer.dispatchEvent({ type: 'click' });
  const envoi = page.messages.filter((m) => m.type === 'enregistrer').pop();
  assert.deepStrictEqual(JSON.parse(JSON.stringify(envoi.modifies)), { 'couverture.illustration-y-mm': '-0.5' });
});

// ---- Titres sur plusieurs lignes : « // » dans le fichier, vrais retours à la ligne à l'écran ----

test('titres : une seule conversion, dans les deux sens (A\nB <-> A // B)', async () => {
  await ouvrirLivre();   // l'hôte doit être actif pour charger lib/metadonnees-hote.js
  const h = require(path.join(COCKPIT, 'lib', 'metadonnees-hote.js'));
  assert.strictEqual(h.lignesVersTitre('A\nB'), 'A // B');
  assert.strictEqual(h.titreVersLignes('A // B'), 'A\nB');
  assert.strictEqual(h.titreVersLignes('A//B'), 'A\nB', '« A//B » doit se lire en deux lignes');
  assert.strictEqual(h.titreVersLignes('  A  //   // B  // '), 'A\nB', 'lignes vides ou espaces de bord conservées');
  assert.strictEqual(h.lignesVersTitre('A\r\n\r\n  B  \n'), 'A // B');
  assert.strictEqual(h.lignesVersTitre('Une seule ligne'), 'Une seule ligne');
  assert.strictEqual(h.lignesVersTitre('\n\n'), '');
  const t = 'Créer ensemble // Facile à Lire';
  assert.strictEqual(h.lignesVersTitre(h.titreVersLignes(t)), t, 'l’aller-retour ne rend pas la chaîne');
});

test('livre : titre et sous-titre sont des champs de plusieurs lignes, écrits sur une seule', async () => {
  const { LIVRE, p, valeurs } = await ouvrirLivre('titre: "Créer ensemble//Facile à Lire"\nsous-titre: "x"\nlang: fr\n');
  assert.strictEqual(valeurs().valeurs.titre, 'Créer ensemble\nFacile à Lire', '« // » non montré en retour à la ligne');
  const page = await pageDuLivre('titre: "A // B"\nlang: fr\n');
  for (const cle of ['titre', 'sous-titre']) {
    const champ = parCle(page.formulaire, cle)[0];
    assert.strictEqual(champ.balise, 'textarea', cle + ' n’est pas un champ de plusieurs lignes');
    assert.strictEqual(champ.rows, 1, 'une ligne au départ');
  }
  assert.strictEqual(parCle(page.formulaire, 'titre')[0].value, 'A\nB');
  const champ = parCle(page.formulaire, 'sous-titre')[0];
  champ.value = 'Un\n\n Deux ';
  champ.dispatchEvent({ type: 'input' });
  page.page.parId.enregistrer.dispatchEvent({ type: 'click' });
  const envoi = page.page.messages.filter((m) => m.type === 'enregistrer').pop();
  assert.strictEqual(envoi.modifies['sous-titre'], 'Un\n\n Deux ', 'la page doit envoyer le texte tel que saisi');
  // L'hôte, lui, écrit une ligne.
  await p._recepteur({ type: 'enregistrer', auto: false, modifies: { titre: 'Un\n\n Deux ', 'sous-titre': 'a//b' } });
  const buch = fs.readFileSync(path.join(LIVRE, 'buch.yaml'), 'utf8');
  assert.match(buch, /^titre: "Un \/\/ Deux"$/m);
  assert.match(buch, /^sous-titre: "a \/\/ b"$/m);
});

test('chapitre : title et subtitle se lisent en lignes et s’écrivent « // » (livre seulement)', async () => {
  const { LIVRE } = await ouvrirLivre();
  const h = require(path.join(COCKPIT, 'lib', 'metadonnees-hote.js'));
  const carte = h.nettoyerCarte({ title: { fr: 'A\nB' }, subtitle: { fr: 'C\n\nD' }, resume: { fr: 'Un\nrésumé' } });
  assert.strictEqual(carte.title.fr, 'A // B');
  assert.strictEqual(carte.subtitle.fr, 'C // D');
  assert.strictEqual(carte.resume.fr, 'Un résumé', 'le résumé ne change pas');
  const fiche = path.join(LIVRE, 'chapitres', '01-ouverture', '01-ouverture.meta.yaml');
  fs.writeFileSync(fiche, ['lang: fr', 'title:', '  fr: "A // B"', 'subtitle:', '  fr: "C//D"', ''].join(LF));
  const lues = h.lireMetadonneesArticles({ racine: LIVRE, listerArticles: () => ['01-ouverture'] });
  assert.strictEqual(lues[0].valeurs.title.fr, 'A\nB');
  assert.strictEqual(lues[0].valeurs.subtitle.fr, 'C\nD');
});

test('fiches : en livre, titre et sous-titre sont des champs qui grandissent ; en revue, une ligne', () => {
  const { libellesHote } = require('./dom-minimal');
  const rendre = (estLivre) => {
    const page = ouvrir({
      racine: RACINE, page: 'metadata-articles',
      cssPartage: ['_design.css', '_auteurs.css', '_fiches.css'],
      jsPartage: ['_messages.js', '_auteurs.js', '_fiches.js'],
      txt: libellesHote(RACINE, ['textesCarteArticle', 'textesAuteur', 'htmlApercuMetadonnees'])
    });
    page.envoyer({ type: 'valeurs', langue: 'fr', types: [], licences: [], licenceDefaut: '', filtre: null,
      capacites: require(path.join(COCKPIT, 'lib', 'profil.js')).PROFILS[estLivre ? 'livre' : 'revue'].capacites,
      articles: [{ slug: '01-a', valeurs: { lang: 'fr', title: { fr: 'A\nB' }, subtitle: { fr: 'C' },
        resume: { fr: 'R' }, keywords: {}, author: [] } }] });
    const champs = {};
    for (const e of descendants(page.conteneur())) {
      if (e.dataset && (e.dataset.cle === 'title' || e.dataset.cle === 'subtitle') && e.dataset.langue === 'fr') {
        champs[e.dataset.cle] = e;
      }
    }
    return { champs, aides: descendants(page.conteneur()).filter((e) => e.classes.has('champ-aide')).length };
  };
  const livre = rendre(true);
  assert.strictEqual(livre.champs.title.balise, 'textarea');
  assert.strictEqual(livre.champs.title.value, 'A\nB');
  assert.strictEqual(livre.champs.subtitle.balise, 'textarea');
  assert.ok(livre.aides >= 2, 'l’aide « Entrée » manque sous les titres du chapitre');
  const revue = rendre(false);
  assert.strictEqual(revue.champs.title.balise, 'input', 'la revue doit garder des champs d’une ligne');
  assert.strictEqual(revue.aides, 0);
});

// ---- Couverture : modèle, illustration pleine, titre et sous-titre dans la langue voisine ----

const CLES_COUV_NOUVELLES = ['couverture.modele', 'couverture.illustration-plein',
  'couverture.titre-2', 'couverture.sous-titre-2'];

test('couverture : les quatre clés sont lues et écrites dans le bloc couverture, modèle en jeton nu', () => {
  for (const cle of CLES_COUV_NOUVELLES) {
    assert.ok(yaml.CLES_METADONNEES.indexOf(cle) !== -1, 'absente de CLES_METADONNEES : ' + cle);
  }
  assert.ok(yaml.CLES_JETONS_NUS.indexOf('couverture.modele') !== -1, 'le modèle doit s’écrire en jeton nu');
  const src = ['titre: "T"', 'couverture:', '  fond: poireau', 'locked: false', ''].join(LF);
  const sortie = yaml.serialiserAusgabe(src, {
    'couverture.modele': 'prospectrum', 'couverture.illustration-plein': 'true',
    'couverture.titre-2': 'Titel // Zwei', 'couverture.sous-titre-2': 'Unter'
  });
  assert.match(sortie, /^ {2}modele: prospectrum$/m);
  assert.match(sortie, /^ {2}illustration-plein: (true|"true")$/m);
  assert.match(sortie, /^ {2}titre-2: "Titel \/\/ Zwei"$/m);
  const relu = yaml.analyserAusgabe(sortie);
  assert.strictEqual(relu['couverture.modele'], 'prospectrum');
  assert.strictEqual(relu['couverture.titre-2'], 'Titel // Zwei');
  assert.strictEqual(relu['couverture.sous-titre-2'], 'Unter');
});

test('couverture : l’hôte valide le modèle (liste fermée, vide permis) et la case (true/false seuls)', async () => {
  const { LIVRE, p } = await ouvrirLivre();
  const ecrire = async (modifies) => {
    await p._recepteur({ type: 'enregistrer', auto: false, modifies: modifies });
    return yaml.analyserAusgabe(fs.readFileSync(path.join(LIVRE, 'buch.yaml'), 'utf8'));
  };
  for (const m of ['falc', 'classique', 'recherche', 'prospectrum']) {
    const lu = await ecrire({ 'couverture.modele': m });
    assert.strictEqual(lu['couverture.modele'], m, 'modèle valide refusé : ' + m);
  }
  let lu = await ecrire({ 'couverture.modele': 'inconnu' });
  assert.strictEqual(lu['couverture.modele'], 'prospectrum', 'un modèle hors liste a été écrit');
  lu = await ecrire({ 'couverture.modele': '' });
  assert.strictEqual(lu['couverture.modele'], '', 'le modèle vide (selon la maquette) est refusé');
  lu = await ecrire({ 'couverture.illustration-plein': 'true' });
  assert.ok(yaml.estVraiYaml(lu['couverture.illustration-plein']));
  lu = await ecrire({ 'couverture.illustration-plein': 'peut-être' });
  assert.ok(yaml.estVraiYaml(lu['couverture.illustration-plein']), 'une valeur autre que true/false a été écrite');
  lu = await ecrire({ 'couverture.illustration-plein': 'false' });
  assert.ok(!yaml.estVraiYaml(lu['couverture.illustration-plein']));
  const buch = fs.readFileSync(path.join(LIVRE, 'buch.yaml'), 'utf8');
  assert.match(buch, /^ {2}illustration-plein: false$/m, 'la case doit s’écrire en booléen nu');
  // Titre et sous-titre voisins : une ligne par ligne, « // » dans le fichier.
  await ecrire({ 'couverture.titre-2': 'Un\n\n Deux ', 'couverture.sous-titre-2': 'a//b' });
  const apres = fs.readFileSync(path.join(LIVRE, 'buch.yaml'), 'utf8');
  assert.match(apres, /^ {2}titre-2: "Un \/\/ Deux"$/m);
  assert.match(apres, /^ {2}sous-titre-2: "a \/\/ b"$/m);
});

test('couverture : le formulaire montre les quatre champs, relit titre-2 en lignes et envoie la case', async () => {
  const { page, formulaire, valeurs } = await pageDuLivre(
    'titre: "T"\nlang: fr\ncouverture:\n  modele: classique\n  illustration-plein: true\n  titre-2: "Un // Deux"\n');
  const v = valeurs().valeurs;
  assert.strictEqual(v['couverture.modele'], 'classique');
  assert.strictEqual(v['couverture.illustration-plein'], 'true');
  assert.strictEqual(v['couverture.titre-2'], 'Un\nDeux', '« // » non montré en retour à la ligne');
  const sel = parCle(formulaire, 'couverture.modele')[0];
  assert.strictEqual(sel.balise, 'select');
  assert.strictEqual(sel.value, 'classique');
  assert.deepStrictEqual(Array.from(sel.enfants.map((o) => o.value)),
    ['', 'falc', 'classique', 'recherche', 'prospectrum']);
  assert.strictEqual(sel.enfants[0].textContent, 'Selon la maquette');
  const caseIllus = parCle(formulaire, 'couverture.illustration-plein')[0];
  assert.strictEqual(caseIllus.type, 'checkbox');
  assert.strictEqual(caseIllus.checked, true);
  for (const cle of ['couverture.titre-2', 'couverture.sous-titre-2']) {
    assert.strictEqual(parCle(formulaire, cle)[0].balise, 'textarea', cle + ' n’est pas un champ de plusieurs lignes');
  }
  assert.strictEqual(parCle(formulaire, 'couverture.titre-2')[0].value, 'Un\nDeux');
  caseIllus.checked = false;
  caseIllus.dispatchEvent({ type: 'change' });
  page.parId.enregistrer.dispatchEvent({ type: 'click' });
  const envoi = page.messages.filter((m) => m.type === 'enregistrer').pop();
  assert.deepStrictEqual(JSON.parse(JSON.stringify(envoi.modifies)), { 'couverture.illustration-plein': 'false' });
  // Libellés : chaque clé existe en fr et en de.
  for (const cle of ['livre.couverture.modele', 'livre.couverture.modele.defaut', 'livre.couverture.modele.falc',
    'livre.couverture.modele.classique', 'livre.couverture.modele.recherche',
    'livre.couverture.modele.prospectrum', 'livre.couverture.illustrationPlein',
    'livre.couverture.illustrationPlein.aide', 'livre.couverture.titre2', 'livre.couverture.sousTitre2',
    'livre.couverture.voisinAide']) {
    assert.notStrictEqual(T(cle), cle, 'clé i18n absente : ' + cle);
  }
});
