// Le socle des constats : ce qu'un défaut ferme, où on va le corriger, et comment il
// s'écrit.
//
//   node --test "test/js/*.test.js"
//
// Trois décisions vivaient éparpillées, et c'est ce qui a fait diverger l'interface : la
// couleur (sept endroits la choisissaient, plus une huitième table qui inventait un ton
// que l'affichage ne connaissait pas), le bouton (un seul `if` en dur, pour un code sur
// cinquante) et la phrase (soixante paragraphes libres, dont quatre disaient le même
// défaut de quatre façons). lib/constats.js les réunit en trois tables, et ce fichier en
// fixe le contrat.
//
// Le contrôle qui compte est celui d'exhaustivité : tout code que lib/journal.js sait
// produire doit avoir sa ligne ici. Un code ajouté à la chaîne sans décision de gravité ni
// de destination fait tomber ce fichier, au lieu d'arriver gris et sans bouton à l'écran.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { chargerAvecVscodeFactice } = require('./dom-minimal');

const RACINE = path.resolve(__dirname, '..', '..');
const COCKPIT = path.join(RACINE, 'vscodium-extension', 'szh-cockpit');
const constats = require(path.join(COCKPIT, 'lib', 'constats.js'));
const i18n = chargerAvecVscodeFactice(path.join(COCKPIT, 'lib', 'i18n.js'));

// Un constat tel que lib/journal.js le rend, réduit à ce que ce module lit.
function constat(source, code, champs) {
  return { source: source, code: code, slug: '01-essai', champs: champs || {}, args: [] };
}

// ---- 1. La gravité se calcule, elle ne se déclare pas -----------------------------

test('gravité : un défaut qui ferme une porte ouverte est bloquant', () => {
  // Le titre manquant arrête la compilation : rien ne peut sortir.
  assert.strictEqual(
    constats.gravite(constat('pipeline', 'titre-manquant'), { pdfua: true }), 'bloquant');
});

test('gravité : la même porte fermée ailleurs, et le défaut redevient un avertissement', () => {
  // Une image muette fait échouer la validation PDF/UA — mais seulement si elle tourne.
  const muette = constat('numerotation', 'figure-sans-alt', { image: 'media/fig-01.png' });
  assert.strictEqual(constats.gravite(muette, { pdfua: true }), 'bloquant');
  assert.strictEqual(constats.gravite(muette, { pdfua: false }), 'avert',
    'la validation PDF/UA est un réglage : sans elle, plus rien ne refuse ce PDF');
});

test('gravité : ce qui n’est pas encore fait n’est jamais rouge', () => {
  // Les deux cas d'attente : aucun article dans le numéro, des Word encore en dépôt.
  // Ils ferment pourtant la compilation — mais rien n'est faux, le travail n'a pas
  // commencé, et le rouge doit rester rare pour se faire entendre.
  for (const c of [constat('pipeline', 'aucun-article'), constat('import', 'restes')]) {
    assert.strictEqual(constats.gravite(c, { pdfua: true }), 'avert',
      'une attente est passée en rouge : ' + c.code);
  }
});

test('gravité : un geste qui a échoué est rouge, même sans porte de publication', () => {
  // Le réimport qui s'arrête ne bloque aucune publication : il n'a simplement pas eu lieu.
  assert.strictEqual(
    constats.gravite(constat('import', 'reimport-echec'), { pdfua: true }), 'bloquant');
});

test('gravité : une information reste grise', () => {
  assert.strictEqual(constats.gravite(constat('citations', 'bilan'), { pdfua: true }), 'info');
  assert.strictEqual(
    constats.gravite(constat('livre', 'chapitre-ecarte'), { pdfua: true }), 'info');
});

test('gravité : un code inconnu ne disparaît pas et ne bloque pas', () => {
  // Une source neuve arrive à l'écran sans être passée par ce module : elle doit se voir,
  // en avertissement, plutôt que d'être tue ou de tout arrêter.
  assert.strictEqual(constats.gravite(constat('scission', 'jamais-vu'), { pdfua: true }), 'avert');
});

// ---- 2. La destination : huit lieux, pas cinquante boutons -------------------------

test('cible : l’image muette mène au formulaire des médias, sur cette image', () => {
  const c = constat('numerotation', 'figure-sans-alt', { image: 'media/fig-01.png' });
  assert.deepStrictEqual(constats.cible(c),
    { lieu: 'medias', slug: '01-essai', focus: 'fig-01.png' },
    'le bouton doit ouvrir l’image en cause, pas la page');
});

test('cible : un champ vide mène à la fiche, sur ce champ', () => {
  const c = constat('meta', 'champ-vide', { champ: 'title', langue: 'de' });
  assert.deepStrictEqual(constats.cible(c),
    { lieu: 'fiche', slug: '01-essai', focus: 'title' });
});

test('cible : ce qui regarde le numéro entier n’emporte pas de slug', () => {
  const c = { source: 'pipeline', code: 'profil-inconnu', slug: '', champs: {}, args: [] };
  assert.deepStrictEqual(constats.cible(c), { lieu: 'numero', slug: '', focus: '' });
});

test('cible : pas de bouton quand aucun geste n’existe dans l’application', () => {
  // Renommer un dossier se fait dans l'explorateur de Windows : un bouton qui mènerait
  // « quelque part » serait un mensonge.
  assert.strictEqual(constats.cible(constat('pipeline', 'dossier-espaces')), null);
  assert.strictEqual(constats.cible(constat('scission', 'jamais-vu')), null);
});

test('cible : chaque lieu nommé existe, avec sa commande et son libellé', () => {
  const lieux = constats.LIEUX;
  assert.ok(Object.keys(lieux).length >= 6, 'la table des lieux est trop courte');
  for (const nom of Object.keys(lieux)) {
    const l = lieux[nom];
    assert.match(l.commande, /^szh\./, 'lieu sans commande du cockpit : ' + nom);
    assert.ok(i18n.T(l.libelle) && i18n.T(l.libelle) !== l.libelle,
      'le libellé du bouton manque au dictionnaire : ' + l.libelle);
    assert.ok(i18n.T(l.tip) && i18n.T(l.tip) !== l.tip,
      'l’infobulle du bouton manque au dictionnaire : ' + l.tip);
  }
});

// ---- 3. La phrase : un gabarit, pas un paragraphe ----------------------------------

test('phrase : « {défaut} : {objet} », et rien de plus', () => {
  const c = constat('numerotation', 'figure-sans-alt', { image: 'media/fig-01.png' });
  const dit = constats.phrase(c, 'fr');
  assert.match(dit, /^Figure sans texte alternatif : fig-01\.png$/,
    'la phrase ne suit pas le gabarit : ' + dit);
  // Le geste n'est plus dans le texte : c'est le bouton qui le porte.
  assert.ok(!/Ouvrez|Cliquez|formulaire/.test(dit), 'la phrase explique encore où cliquer');
});

test('phrase : un défaut sans objet se dit seul, sans deux-points en l’air', () => {
  const dit = constats.phrase(constat('pipeline', 'titre-manquant'), 'fr');
  assert.match(dit, /^Titre manquant$/, 'un deux-points traîne sans objet : ' + dit);
});

test('phrase : le détail facultatif n’existe que là où une seule ligne ne suffit pas', () => {
  // Réservé aux constats qui doivent dire ce qui a été gardé et ce qui a été perdu.
  const avec = constats.detail(constat('import', 'tableau-conflit'), 'fr');
  assert.ok(avec && avec.length > 0, 'le conflit de tableau doit garder son détail');
  assert.strictEqual(constats.detail(constat('pipeline', 'titre-manquant'), 'fr'), '');
});

test('phrase : les deux langues, pour tout code connu', () => {
  for (const cle of Object.keys(constats.TABLE)) {
    const e = constats.TABLE[cle];
    for (const langue of ['fr', 'de']) {
      const dit = i18n.TL(langue, e.defaut);
      assert.ok(dit && dit !== e.defaut, 'défaut sans texte ' + langue + ' : ' + cle);
      assert.ok(dit.length <= 60, 'ce n’est plus un intitulé mais une phrase (' + cle + ') : ' + dit);
    }
  }
});

// ---- 4. Exhaustivité : aucun code de la chaîne sans décision -----------------------

// Les codes que lib/journal.js sait produire, relevés dans sa source : les tables de clés
// (CLES_*) et les codes littéraux de ses lecteurs (`code: 'x'`). Lire la source plutôt que
// d'énumérer ici ce qu'on croit savoir — c'est exactement ainsi qu'une divergence passe.
function codesDeJournal() {
  const src = fs.readFileSync(path.join(COCKPIT, 'lib', 'journal.js'), 'utf8');
  const vus = new Set();
  for (const m of src.matchAll(/source: '([a-z]+)', code: '([a-z-]+)'/g)) {
    vus.add(m[1] + '/' + m[2]);
  }
  // Les tables par source : CLES_IMPORT -> import, CLES_META -> meta, etc.
  const familles = { CLES_IMPORT: 'import', CLES_META: 'meta', CLES_CITATIONS: 'citations',
    CLES_LIVRE: 'livre', CLES_NUMEROTATION: 'numerotation' };
  for (const nom of Object.keys(familles)) {
    const i = src.indexOf('const ' + nom);
    assert.ok(i !== -1, 'table introuvable dans journal.js : ' + nom);
    const bloc = src.slice(i, src.indexOf('};', i));
    for (const m of bloc.matchAll(/'([a-z-]+)':\s*'ctl\./g)) {
      vus.add(familles[nom] + '/' + m[1]);
    }
  }
  return vus;
}

test('exhaustivité : tout code de la chaîne a sa gravité et sa destination', () => {
  const manquants = [];
  for (const cle of codesDeJournal()) {
    if (!constats.TABLE[cle]) { manquants.push(cle); }
  }
  assert.deepStrictEqual(manquants, [],
    'ces codes arriveraient à l’écran sans couleur décidée ni bouton : ' + manquants.join(', '));
});

test('exhaustivité : aucune ligne morte dans la table', () => {
  // L'inverse du contrôle ci-dessus : une entrée pour un code que plus personne n'émet est
  // une décision qui ne s'applique à rien, et qu'on relira comme si elle valait encore.
  const connus = codesDeJournal();
  // Les codes que le cockpit produit lui-même, hors journal de la chaîne.
  const propres = ['pipeline/pdf-verrouille', 'pdfua/non-conforme', 'pdfua/outillage',
    'pdfua/regle', 'cockpit/doi-double', 'cockpit/sans-fiche', 'cockpit/image-sans-alt',
    'cockpit/image-sans-legende'];
  const mortes = Object.keys(constats.TABLE)
    .filter((cle) => !connus.has(cle) && propres.indexOf(cle) === -1);
  assert.deepStrictEqual(mortes, [], 'entrées sans émetteur : ' + mortes.join(', '));
});

test('exhaustivité : chaque entrée est complète et bien formée', () => {
  const portes = ['compilation', 'pdfua', 'export', 'geste', null];
  const natures = ['defaut', 'attente', 'fait'];
  for (const cle of Object.keys(constats.TABLE)) {
    const e = constats.TABLE[cle];
    assert.ok(portes.indexOf(e.barrage === undefined ? null : e.barrage) !== -1,
      'barrage inconnu (' + cle + ') : ' + e.barrage);
    assert.ok(natures.indexOf(e.nature) !== -1, 'nature inconnue (' + cle + ') : ' + e.nature);
    assert.ok(e.defaut, 'entrée sans intitulé : ' + cle);
    if (e.lieu) {
      assert.ok(constats.LIEUX[e.lieu], 'lieu inconnu (' + cle + ') : ' + e.lieu);
    }
    // Une attente ou une information ne peut pas être rouge : la règle doit tenir dans la
    // table elle-même, pas seulement dans la fonction qui la lit.
    if (e.nature !== 'defaut') {
      assert.ok(!e.barrage || e.nature === 'attente',
        'une information ne ferme pas une porte : ' + cle);
    }
  }
});
