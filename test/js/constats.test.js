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

test('gravité : la bibliographie récupérée est une information, pas un défaut', () => {
  // Le cas NOMINAL de szh-biblio-detacher.lua. Sans ligne dans la table, il arrivait en
  // ambre, sous un triangle, et dans la prose allemande du filtre — un succès déguisé en
  // défaut. Ses trois voisins, eux, constatent bien quelque chose à regarder.
  assert.strictEqual(
    constats.gravite(constat('import', 'biblio-detachee'), { pdfua: true }), 'info');
  for (const code of ['biblio-incomplete', 'biblio-bornes-perdues', 'biblio-fichier-refuse']) {
    assert.strictEqual(constats.gravite(constat('import', code), { pdfua: true }), 'avert',
      'ce constat bloque ou se tait : ' + code);
  }
});

// ---- 1 bis. La croix : ce qu'on a le droit d'effacer d'un clic --------------------

test('fermable : les gris seulement, jamais un bloquant ni un avertissement', () => {
  // Un constat gris ne demande rien : il dit qu'une chose s'est bien passée. Le faire
  // taire ne cache aucun geste à faire — à l'inverse d'un ambre, qu'on refermerait pour se
  // donner un numéro propre sans l'avoir corrigé.
  assert.strictEqual(
    constats.fermable(constat('import', 'biblio-detachee'), { pdfua: true }), true);
  assert.strictEqual(
    constats.fermable(constat('pipeline', 'titre-manquant'), { pdfua: true }), false,
    'un bloquant se referme d’un clic : le défaut disparaît sans avoir été corrigé');
  assert.strictEqual(
    constats.fermable(constat('import', 'restes'), { pdfua: true }), false,
    'une attente se referme d’un clic');
  // Le réglage PDF/UA déplace la frontière du rouge, jamais celle de la croix : une image
  // muette reste un défaut là où la validation est éteinte, donc sans croix.
  const muette = constat('numerotation', 'figure-sans-alt', { image: 'media/fig-01.png' });
  assert.strictEqual(constats.fermable(muette, { pdfua: false }), false);
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

test('cible : un appel avec « / » n’est pas un chemin — il passe entier', () => {
  // « / » sépare des années, pas des dossiers : dernierSegment() le mutilerait.
  const c = constat('citations', 'appel-sans-reference', { appel: '(Schuljahr 2021/2022, 2019)' });
  assert.deepStrictEqual(constats.cible(c),
    { lieu: 'article', slug: '01-essai', focus: '(Schuljahr 2021/2022, 2019)' },
    'l’appel a été rogné comme un chemin de fichier');
});

test('cible : une référence avec son DOI n’est pas un chemin — elle passe entière', () => {
  const c = constat('citations', 'reference-orpheline',
    { reference: 'Bovey, L. (2022). https://doi.org/10.1234/abc' });
  assert.deepStrictEqual(constats.cible(c),
    { lieu: 'article', slug: '01-essai', focus: 'Bovey, L. (2022). https://doi.org/10.1234/abc' },
    'la référence a été rognée au dernier segment de son DOI');
});

test('cible : le fichier et l’image, eux, restent rognés à leur nom', () => {
  const fichier = constat('pipeline', 'pdf-verrouille', { fichier: 'out/01-essai/01-essai.pdf' });
  assert.strictEqual(constats.cible(fichier).focus, '01-essai.pdf');
  const image = constat('numerotation', 'figure-sans-alt', { image: 'media/sous-dossier/fig-01.png' });
  assert.strictEqual(constats.cible(image).focus, 'fig-01.png');
});

// Revue F03 (22.09.2026) : pdf-verrouille visait « apercu » (szh.basculerApercu), un
// INTERRUPTEUR sur l'article en aperçu courant qui ne prend même pas de slug — la flèche ne
// menait donc jamais au bon PDF, ni à aucun PDF en particulier. Il vise désormais « pdf »
// (szh.voirPdfArticle), qui accepte { slug, focus } et ouvre le PDF de CET article.
test('cible : pdf-verrouille mène à « pdf » (szh.voirPdfArticle), pas à l’interrupteur d’aperçu', () => {
  const fichier = constat('pipeline', 'pdf-verrouille', { fichier: 'out/01-essai/01-essai.pdf' });
  const cible = constats.cible(fichier);
  assert.strictEqual(cible.lieu, 'pdf');
  assert.strictEqual(cible.slug, '01-essai');
  const b = constats.bouton(fichier, 'fr');
  assert.ok(b, 'aucun bouton pour pdf-verrouille');
  assert.strictEqual(b.commande, 'szh.voirPdfArticle');
  assert.strictEqual(b.slug, '01-essai');
  assert.notStrictEqual(b.commande, 'szh.basculerApercu');
});

test('objet : la phrase et le bouton désignent la même chose, / compris', () => {
  const appel = constat('citations', 'appel-sans-reference', { appel: '(Schuljahr 2021/2022, 2019)' });
  assert.strictEqual(constats.objet(appel, 'fr'), constats.cible(appel).focus);
  const reference = constat('citations', 'reference-orpheline',
    { reference: 'Bovey, L. (2022). https://doi.org/10.1234/abc' });
  assert.strictEqual(constats.objet(reference, 'fr'), constats.cible(reference).focus);
  const image = constat('numerotation', 'figure-sans-alt', { image: 'media/sous-dossier/fig-01.png' });
  assert.strictEqual(constats.objet(image, 'fr'), constats.cible(image).focus);
});

// ---- 2 bis. Les trois familles qui n’avaient aucune ligne (revue F03, 22.09.2026) --

test('typo : le mot fautif mène à l’article, quand le filtre le fournit', () => {
  const c = constat('typo', 'eszett', { mot: 'Strasse' });
  assert.deepStrictEqual(constats.cible(c),
    { lieu: 'article', slug: '01-essai', focus: 'Strasse' });
  assert.match(constats.phrase(c, 'fr'), /^« ß » à la place de « ss » : Strasse$/);
  assert.match(constats.phrase(c, 'de'), /^„ß“ statt „ss“: Strasse$/);
  // La nuance du filtre (nom propre, citation) ne doit pas se perdre : elle vit dans le
  // détail, à part de l’intitulé court.
  for (const langue of ['fr', 'de']) {
    assert.ok(constats.detail(c, langue).length > 0, 'détail manquant en ' + langue);
  }
});

test('typo : sans le champ « mot » (pas encore écrit par le filtre), la flèche se dégrade proprement', () => {
  // Deux chantiers parallèles ajoutent ce champ à l’émetteur ; en attendant, focusChamp lit
  // un champ absent — la carte s’affiche quand même, sans flèche ni objet dans la phrase.
  for (const code of ['eszett', 'guillemets-droits', 'majuscule-accentuee']) {
    const c = constat('typo', code, {});
    assert.strictEqual(constats.cible(c).focus, '', code + ' : la flèche n’a pas dégradé sur focus vide');
    assert.strictEqual(constats.objet(c, 'fr'), '', code + ' : un objet est apparu sans champ');
  }
});

test('typo : guillemets droits et majuscule non accentuée ont leur phrase, en fr et en de', () => {
  const guillemets = constat('typo', 'guillemets-droits', { mot: '"cité"' });
  assert.match(constats.phrase(guillemets, 'fr'), /^Guillemets droits au lieu de chevrons : "cité"$/);
  assert.match(constats.phrase(guillemets, 'de'), /^Gerade Anführungszeichen statt Guillemets: "cité"$/);
  const majuscule = constat('typo', 'majuscule-accentuee', { mot: 'Ecole' });
  assert.match(constats.phrase(majuscule, 'fr'), /^Majuscule non accentuée : Ecole$/);
  assert.match(constats.phrase(majuscule, 'de'), /^Grossbuchstabe ohne Akzent: Ecole$/);
  // Les trois typo/* portent une nuance du filtre (ce qu'il NE corrige pas, et pourquoi) :
  // perdue dans l'intitulé court, elle vit dans le détail — comme pour « eszett ».
  for (const c of [guillemets, majuscule]) {
    for (const langue of ['fr', 'de']) {
      assert.ok(constats.detail(c, langue).length > 0,
        c.code + ' : détail manquant en ' + langue);
    }
  }
});

test('metafichier : l’image native Word mène au formulaire des médias', () => {
  const c = constat('metafichier', 'image-native-word', { image: 'schema.wmf' });
  assert.deepStrictEqual(constats.cible(c),
    { lieu: 'medias', slug: '01-essai', focus: 'schema.wmf' });
  assert.match(constats.phrase(c, 'fr'), /^Image native Word non rendue : schema\.wmf$/);
  assert.match(constats.phrase(c, 'de'), /^Natives Word-Bild nicht gerendert: schema\.wmf$/);
});

test('metafichier : le placeholder introuvable n’a aucun geste dans l’application', () => {
  const c = constat('metafichier', 'placeholder-introuvable', {});
  assert.strictEqual(constats.cible(c), null, 'panne de déploiement du poste : pas de bouton');
  assert.match(constats.phrase(c, 'fr'), /^Substitut d’image manquant sur ce poste$/);
});

test('scission : image et tableau introuvables mènent au bon endroit, dans le bon champ', () => {
  const image = constat('scission', 'image-introuvable', { chapitre: '02-suite', image: 'media/fig.png' });
  assert.deepStrictEqual(constats.cible(image),
    { lieu: 'medias', slug: '01-essai', focus: 'fig.png' });
  const tableau = constat('scission', 'tableau-introuvable', { chapitre: '02-suite', tableau: 'tables/table-01.html' });
  assert.strictEqual(constats.cible(tableau).lieu, 'article');
  assert.strictEqual(constats.objet(tableau, 'fr'), 'tables/table-01.html');
});

test('scission : le champ « média » (accentué) du texte de tête et des liminaires est bien lu', () => {
  // livre-scinder.py nomme ce champ « média », pas « media » : un désaccord d’accent
  // laisserait la flèche muette (champsNommes de lib/journal.js est sensible à l’accent).
  for (const code of ['liminaire-texte-media-introuvable', 'liminaire-media-introuvable']) {
    const c = constat('scission', code, { média: 'media/x.png' });
    assert.deepStrictEqual(constats.cible(c),
      { lieu: 'medias', slug: '01-essai', focus: 'x.png' }, code);
  }
});

test('scission : deux codes arrêtent vraiment la compilation, malgré leur préfixe « avertissement »', () => {
  // livre-scinder.py appelle sys.exit(1) juste après avoir écrit ces deux-là : le barrage
  // réel ne suit pas le ton du préfixe, il a été vérifié dans le code (revue F03).
  for (const code of ['aucun-titre-niveau-1', 'chapitre-cible-existe']) {
    assert.strictEqual(constats.gravite(constat('scission', code), { pdfua: true }), 'bloquant', code);
  }
});

test('scission : le dossier d’origine conservé est une information, pas un défaut', () => {
  const c = constat('scission', 'source-non-supprimee', { chapitre: '01-inclusion' });
  assert.strictEqual(constats.gravite(c, { pdfua: true }), 'info');
  assert.strictEqual(constats.fermable(c, { pdfua: true }), true);
});

test('import : le tableau des autrices et auteurs mène à l’article, sans flèche précise', () => {
  for (const code of ['tableau-auteurs-non-lu', 'biblio-references-restees', 'biblio-non-detachee']) {
    const c = constat('import', code, {});
    assert.strictEqual(constats.cible(c).lieu, 'article', code);
  }
});

test('import : le crédit de photo non repris est une information, sans geste possible', () => {
  const c = constat('import', 'credit-photo-non-repris', {});
  assert.strictEqual(constats.cible(c), null);
  assert.strictEqual(constats.gravite(c, { pdfua: true }), 'info');
});

test('import : tableau sans en-tête — la flèche vise l’extrait, la phrase continue de nommer le tableau', () => {
  const c = constat('import', 'tableau-sans-entete', { tableau: '2', debut: 'Nom de la colonne' });
  assert.strictEqual(constats.cible(c).focus, 'Nom de la colonne',
    'la flèche doit viser l’extrait repérable, pas le numéro nu');
  assert.strictEqual(constats.objet(c, 'fr'), '2',
    'la phrase doit continuer de nommer le tableau par son numéro');
  assert.match(constats.phrase(c, 'fr'), /^Tableau sans en-tête : 2$/);
});

test('import : tableau sans en-tête — sans « debut » pas encore écrit, la phrase garde son objet', () => {
  // L’autre chantier n’a pas encore ajouté ce champ à docx-tables.py : la flèche se
  // dégrade sur focus vide, mais objetChamp continue de nommer le tableau.
  const c = constat('import', 'tableau-sans-entete', { tableau: '2' });
  assert.strictEqual(constats.cible(c).focus, '');
  assert.strictEqual(constats.objet(c, 'fr'), '2');
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
    'export/refus',
    'pdfua/regle', 'cockpit/doi-double', 'cockpit/sans-fiche', 'cockpit/image-sans-alt',
    'cockpit/image-sans-legende',
    // typo (szh-typographie.lua), metafichier (szh-metafichier.lua) et scission
    // (livre-scinder.py) passent par le préfixe générique « <source>-<ton> » que
    // familleCode() de lib/journal.js reconnaît sans code ni table CLES_* dédiée (même
    // mécanisme que « scission » dans extension.js, SOURCES_CONSTAT) : codesDeJournal()
    // ci-dessus ne peut donc pas les voir, alors que le journal les produit bel et bien.
    'typo/eszett', 'typo/guillemets-droits', 'typo/majuscule-accentuee',
    'metafichier/image-native-word', 'metafichier/placeholder-introuvable',
    'scission/aucun-titre-niveau-1', 'scission/chapitre-cible-existe',
    'scission/image-introuvable', 'scission/tableau-introuvable',
    'scission/liminaire-texte-non-repris', 'scission/liminaire-texte-media-introuvable',
    'scission/liminaire-media-introuvable', 'scission/source-non-supprimee',
    // Quatre codes de docx-meta.py qui passent par « [import-avertissement] » sans entrée
    // dans CLES_IMPORT (revue F03, 22.09.2026) : même raison, même repli.
    'import/tableau-auteurs-non-lu', 'import/biblio-references-restees',
    'import/biblio-non-detachee', 'import/credit-photo-non-repris'];
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
