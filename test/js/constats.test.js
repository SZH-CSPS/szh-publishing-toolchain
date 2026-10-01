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
  // `\s` et non une espace littérale : test/typo-check.py pose des insécables dans les
  // guillemets français et les colle en allemand. La typographie de ces libellés est sa
  // décision ; ce test ne juge que la composition de la phrase.
  assert.match(constats.phrase(c, 'fr'), /^«\s*ß\s*» à la place de «\s*ss\s*»\s*: Strasse$/);
  assert.match(constats.phrase(c, 'de'), /^Eszett statt «\s*ss\s*»\s*: Strasse$/);
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

// Un en-tête se déclare dans l'éditeur du tableau, jamais dans le .md (29.09.2026) : la
// flèche mène à CE tableau, le fichier que docx-tables.py a écrit pour son numéro.
test('import : tableau sans en-tête — la flèche ouvre l’éditeur de CE tableau, la phrase le nomme', () => {
  const c = constat('import', 'tableau-sans-entete', { tableau: '2', debut: 'Nom de la colonne' });
  assert.deepStrictEqual(constats.cible(c), { lieu: 'table', slug: '01-essai', focus: 'table-02.html' },
    'la flèche doit ouvrir l’éditeur du tableau, pas le texte de l’article');
  assert.strictEqual(constats.LIEUX.table.commande, 'szh.editerTable');
  assert.strictEqual(constats.objet(c, 'fr'), '2',
    'la phrase doit continuer de nommer le tableau par son numéro');
  assert.match(constats.phrase(c, 'fr'), /^Tableau sans en-tête : 2$/);
});

test('import : tableau sans en-tête — sans « debut », le numéro suffit à désigner le fichier', () => {
  const c = constat('import', 'tableau-sans-entete', { tableau: '12' });
  assert.strictEqual(constats.cible(c).focus, 'table-12.html');
  assert.strictEqual(constats.objet(c, 'fr'), '12');
  // Sans numéro lisible : le lieu reste l'éditeur de tableaux, sans tableau nommé — c'est
  // ouvrirEditeurTable qui retombe alors sur la liste des tableaux de l'article.
  assert.deepStrictEqual(constats.cible(constat('import', 'tableau-sans-entete', {})),
    { lieu: 'table', slug: '01-essai', focus: '' });
});

test('pdfua : les règles de tableau 7.5-1 et 7.5-2 mènent à l’éditeur de tableaux', () => {
  for (const repere of ['7.5-1', '7.5-2']) {
    const c = constat('pdfua', 'regle', { regle: 'Cellule de tableau…', explication: '', repere: repere });
    assert.strictEqual(constats.cible(c).lieu, 'table', repere);
  }
});

// ---- 3. La phrase : un gabarit, pas un paragraphe ----------------------------------

test('phrase : « {défaut} : {objet} », et rien de plus', () => {
  const c = constat('numerotation', 'figure-sans-alt', { image: 'media/fig-01.png' });
  const dit = constats.phrase(c, 'fr');
  assert.match(dit, /^Image sans description : fig-01\.png$/,
    'la phrase ne suit pas le gabarit : ' + dit);
  // Le geste n'est plus dans le texte : c'est le bouton qui le porte.
  assert.ok(!/Ouvrez|Cliquez|formulaire/.test(dit), 'la phrase explique encore où cliquer');
});

test('phrase : un défaut sans objet se dit seul, sans deux-points en l’air', () => {
  const dit = constats.phrase(constat('pipeline', 'titre-manquant'), 'fr');
  assert.match(dit, /^Titre manquant$/, 'un deux-points traîne sans objet : ' + dit);
});

// La seconde ligne est devenue UNE phrase d'action (29.09.2026) ; ce qu'elle disait de
// ce qui a été gardé ou perdu n'a pas disparu, il est dans l'infobulle.
test('phrase : la seconde ligne est une consigne, l’explication part en infobulle', () => {
  const conflit = constat('import', 'tableau-conflit');
  conflit.cle = 'ctl.reimport.tableau-conflit';
  const geste = constats.detail(conflit, 'fr');
  assert.ok(geste && /^Ouvrez /.test(geste), 'la consigne ne commence pas par le geste : ' + geste);
  assert.strictEqual(constats.consigne(conflit, 'fr'), geste, 'detail() n’est plus la consigne');
  const pourquoi = constats.infobulle(conflit, 'fr');
  assert.ok(/sauvegarde/.test(pourquoi),
    'ce qui a été gardé (la sauvegarde) a été perdu en route : ' + pourquoi);
  assert.match(constats.detail(constat('pipeline', 'titre-manquant'), 'fr'), /^Saisissez le titre/);
});

test('consigne : une seule phrase, dans les deux langues, pour tout défaut à corriger', () => {
  const vides = [];
  for (const cle of Object.keys(constats.TABLE)) {
    const e = constats.TABLE[cle];
    if (e.nature === 'fait' || e.detailChamp) { continue; }
    const s = constats.SECOND_ETAGE[cle];
    // Une entrée vide, posée exprès : le geste a été refusé et il n'y a rien à faire.
    if (s && !s.consigne) { continue; }
    if (!s) { vides.push(cle); continue; }
    for (const langue of ['fr', 'de']) {
      const dit = i18n.TL(langue, s.consigne, ['3']);
      assert.ok(dit && dit !== s.consigne, 'consigne sans texte ' + langue + ' : ' + cle);
      assert.ok(dit.length <= 140, 'ce n’est plus une phrase mais un paragraphe (' + cle + ') : ' + dit);
      assert.strictEqual((dit.match(/[.!?](\s|$)/g) || []).length, 1,
        'plus d’une phrase (' + cle + ', ' + langue + ') : ' + dit);
      if (langue === 'de') { assert.ok(dit.indexOf('ß') === -1, 'orthographe suisse : ' + cle); }
    }
  }
  assert.deepStrictEqual(vides, [], 'défauts sans phrase d’action : ' + vides.join(', '));
});

test('règle PDF/UA : le geste en consigne, la cause et le repère en infobulle, rien de perdu', () => {
  const c = constat('pdfua', 'regle', {
    regle: 'Le document n’a pas de titre (1 fois, page(s) 3)',
    explication: 'En cause : le champ title de la fiche est vide. À faire : remplir le titre.',
    repere: '7.1-9' });
  // Le titre de la carte est la règle elle-même : la source de la carte dit déjà PDF/UA.
  assert.strictEqual(constats.phrase(c, 'fr'), 'Le document n’a pas de titre (1 fois, page(s) 3)');
  assert.strictEqual(constats.consigne(c, 'fr'), 'remplir le titre.');
  const pourquoi = constats.infobulle(c, 'fr');
  assert.match(pourquoi, /le champ title de la fiche est vide\./);
  assert.match(pourquoi, /ISO 14289-1 7\.1-9/);
  // Une règle sans geste (défaut de la chaîne) n'invente pas de consigne.
  const sansGeste = constat('pdfua', 'regle', { regle: 'X', explication: 'En cause : y.', repere: '7.1-10' });
  assert.strictEqual(constats.consigne(sansGeste, 'fr'), '');
  assert.match(constats.infobulle(sansGeste, 'fr'), /^y\./);
});

test('infobulle : le message complet de la maison, ou la phrase de la chaîne, jamais rien', () => {
  const c = constat('citations', 'appel-sans-reference', { appel: '(Shaw, 2023)' });
  c.cle = 'ctl.cit.sansref'; c.args = ['(Shaw, 2023)'];
  assert.match(constats.infobulle(c, 'fr'), /ne mène à aucune référence/);
  const typo = constat('typo', 'eszett', { mot: 'Straße' });
  typo.brut = 'Un « ß » dans le texte.';
  // La typographie n'a pas de message ctl.* : c'est l'ancienne seconde ligne qui explique.
  assert.match(constats.infobulle(typo, 'fr'), /usage suisse/);
});

// ---- 3 bis. Une carte par défaut, et non une par voie d'arrivée -------------------

function regle(repere, slug) {
  return { source: 'pdfua', code: 'regle', slug: slug || '01-essai', args: [], cle: '',
           champs: { regle: 'R (1 fois, page(s) 2)', explication: 'En cause : c. À faire : g.', repere: repere } };
}

test('regrouper : la règle 7.3-1 et les images de la chaîne font UNE carte, nommée par le disque', () => {
  const liste = [
    constat('citations', 'appel-ambigu', { appel: '(Sen, 2001)' }),
    regle('7.3-1'),
    constat('numerotation', 'figure-sans-alt', { image: 'media/fig-01.png' }),
    constat('numerotation', 'figure-sans-alt', { image: 'media/fig-02.png' })
  ];
  const lire = () => ({ images: [
    { nom: 'fig-01.png', lieu: 'medias', focus: 'fig-01.png' },
    { nom: 'portrait.jpeg', lieu: 'table', focus: 'table-02.html',
      precision: { cle: 'objet.image.tableau', args: ['table-02.html'] } }
  ], tableaux: [], tousTableaux: [] });
  const r = constats.regrouper(liste, lire);
  assert.strictEqual(r.length, 2, 'la même image fait encore plusieurs cartes');
  assert.strictEqual(r[0].code, 'appel-ambigu', 'l’ordre de la liste n’est pas gardé');
  const carte = r[1];
  assert.strictEqual(carte.source + '/' + carte.code, 'cockpit/images-sans-description');
  assert.strictEqual(constats.phrase(carte, 'fr'), '2 images sans description');
  assert.strictEqual(constats.phrase(carte, 'de'), '2 Bilder ohne Beschreibung');
  assert.deepStrictEqual(constats.elements(carte, 'fr').map((e) => [e.libelle, e.lieu + ':' + e.focus]),
    [['fig-01.png', 'medias:fig-01.png'], ['portrait.jpeg (dans table-02.html)', 'table:table-02.html']]);
  assert.match(constats.consigne(carte, 'fr'), /«.Image purement décorative.»/,
    'la consigne ne nomme pas la case telle que le formulaire l’écrit');
  // Plusieurs objets : le bouton ouvre le formulaire, sans en choisir un.
  assert.deepStrictEqual(constats.cible(carte), { lieu: 'medias', slug: '01-essai', focus: '' });
  // Rouge tant que la validation PDF/UA tourne, comme les constats qu'elle remplace.
  assert.strictEqual(constats.gravite(carte, { pdfua: true }), 'bloquant');
  assert.strictEqual(carte.membres.length, 3, 'les constats remplacés sont perdus');
});

test('regrouper : une seule image — le singulier, et le bouton va droit sur elle', () => {
  const r = constats.regrouper([constat('numerotation', 'figure-sans-alt', { image: 'media/fig-1.png' })],
    () => ({ images: [], tableaux: [] }));
  assert.strictEqual(constats.phrase(r[0], 'fr'), '1 image sans description');
  assert.deepStrictEqual(constats.cible(r[0]), { lieu: 'medias', slug: '01-essai', focus: 'fig-1.png' },
    'sans rien sur le disque, les noms de la chaîne servent de repli');
});

test('regrouper : les tableaux de la règle 7.5-1, avec la raison de chacun', () => {
  // table-02 : un tableau de mise en page sans en-tête (le bloc des auteurs de l'article
  // massie) — le validateur ne le refuse pas, c'est l'en-tête fusionné de table-01 qu'il
  // relève. Il n'est donc pas nommé tant qu'une fusion explique la règle.
  const lire = () => ({ images: [], tousTableaux: ['table-01.html', 'table-02.html'],
    tableaux: [{ nom: 'table-01.html', raison: 'fusion' }, { nom: 'table-02.html', raison: 'sans-entete' }] });
  const r = constats.regrouper([regle('7.5-1'), regle('7.5-2')], lire);
  assert.strictEqual(r.length, 1);
  assert.strictEqual(constats.phrase(r[0], 'fr'), '1 tableau aux en-têtes incomplets');
  assert.deepStrictEqual(constats.elements(r[0], 'fr').map((e) => e.libelle), ['table-01.html (en-tête fusionné)']);
  assert.deepStrictEqual(constats.cible(r[0]), { lieu: 'table', slug: '01-essai', focus: 'table-01.html' });
  assert.strictEqual(constats.gravite(r[0], { pdfua: true }), 'bloquant');
  assert.match(constats.consigne(r[0], 'fr'), /fusionner/);
  // Aucun tableau identifié : un titre sans compte, et le bouton retombe sur la liste.
  const rien = constats.regrouper([regle('7.5-1')], () => ({ images: [], tableaux: [], tousTableaux: [] }));
  assert.strictEqual(constats.phrase(rien[0], 'fr'), 'Tableaux aux en-têtes incomplets');
  assert.deepStrictEqual(constats.cible(rien[0]), { lieu: 'table', slug: '01-essai', focus: '' });
});

test('regrouper : l’import seul reste ambre, et un tableau corrigé depuis ne se nomme plus', () => {
  const lire = () => ({ images: [], tousTableaux: ['table-01.html', 'table-02.html'],
    tableaux: [{ nom: 'table-02.html', raison: 'sans-entete' }] });
  const r = constats.regrouper([
    constat('import', 'tableau-sans-entete', { tableau: '1' }),
    constat('import', 'tableau-sans-entete', { tableau: '2' })
  ], lire);
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].code, 'tableaux-sans-entete');
  assert.strictEqual(constats.gravite(r[0], { pdfua: true }), 'avert');
  assert.deepStrictEqual(constats.elements(r[0], 'fr').map((e) => e.focus), ['table-02.html']);
});

// Constaté par Robin (30.09.2026) : vingt cartes « Champ du gabarit laissé vide » pour un
// article, sans le nom du champ, toutes à la même empreinte (fermer l'une les fermait
// toutes), et un bouton vers les Word en attente, où le document n'était plus.
test('regrouper : les champs du gabarit laissés vides font UNE carte, un lien par champ, dans la langue de qui lit', () => {
  const vide = (cle, cleDe, lieu) => constat('import', 'cle-attendue-absente',
    { 'clé': cle, 'clé-de': cleDe, lieu: lieu });
  const r = constats.regrouper([
    vide('Sous-titre', 'Untertitel', 'tableau metadonnees'),
    vide('ORCID', 'ORCID', 'auteur'), vide('ORCID', 'ORCID', 'auteur'),
    vide('Crédit', 'Copyright', 'bloc')
  ], () => null);
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].source + '/' + r[0].code, 'cockpit/champs-gabarit-vides');
  assert.strictEqual(constats.phrase(r[0], 'fr'), '3 champs du gabarit laissés vides');
  assert.deepStrictEqual(constats.elements(r[0], 'de').map((e) => [e.libelle, e.lieu]),
    [['Untertitel', 'fiche'], ['ORCID', 'fiche'], ['Copyright', 'medias']]);
  assert.deepStrictEqual(constats.cible(r[0]), { lieu: 'fiche', slug: '01-essai', focus: '' },
    'le bouton ne doit plus mener aux Word en attente');
  assert.strictEqual(constats.gravite(r[0], {}), 'info');
});

test('regrouper : rien à regrouper sans article, ni hors des deux familles', () => {
  const numero = Object.assign(constat('numerotation', 'figure-sans-alt', { image: 'a.png' }), { slug: '' });
  const autre = regle('7.1-9');
  assert.deepStrictEqual(constats.regrouper([numero, autre], () => null), [numero, autre]);
});

test('cible : un focus calculé par l’hôte sert de repli vers le texte, jamais d’objet', () => {
  const c = constat('rendu', 'niveaux-ecrases', { focusCalcule: '###### Annexe' });
  assert.strictEqual(constats.cible(c).focus, '###### Annexe');
  assert.strictEqual(constats.phrase(c, 'fr'), 'Titres trop profonds');
  // Le focus que le constat porte lui-même passe avant.
  const appel = constat('citations', 'appel-ambigu', { appel: '(Sen, 2001)', focusCalcule: 'autre' });
  assert.strictEqual(constats.cible(appel).focus, '(Sen, 2001)');
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

test('exhaustivité : fichier-illisible et tableau-texte-perdu, émis par pipeline/, sont dans la table', () => {
  // Relève dans les .py les appels avertir('code', ...) (même sur deux lignes) et exige une
  // entrée pour chacun : un code absent arriverait en carte grise, sans bouton.
  const dossier = path.join(RACINE, 'pipeline');
  const emis = new Set();
  for (const f of fs.readdirSync(dossier).filter((n) => n.endsWith('.py'))) {
    const src = fs.readFileSync(path.join(dossier, f), 'utf8');
    for (const m of src.matchAll(/avertir\(\s*'([a-z-]+)'/g)) { emis.add(m[1]); }
  }
  // Les deux refus et pertes de l'import qui portaient une carte grise (01.10.2026). Les autres
  // codes d'avertir() relèvent d'autres sources (scission, rendu...) ou de repli connu.
  for (const code of ['fichier-illisible', 'tableau-texte-perdu']) {
    assert.ok(emis.has(code), 'plus émis par pipeline/ : ' + code);
    assert.ok(constats.TABLE['import/' + code], 'code émis sans entrée : ' + code);
    assert.strictEqual(constats.TABLE['import/' + code].defaut, 'defaut.' + code);
  }
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
    // Les cartes regroupées : regrouper() les fabrique à partir des constats ci-dessus.
    'cockpit/images-sans-description', 'cockpit/tableaux-entete', 'cockpit/tableaux-sans-entete',
    'cockpit/champs-gabarit-vides',
    // pipeline/pagination.py écrit « [pagination-avertissement] perimee », préfixe
    // générique lui aussi : codesDeJournal() ne le voit pas, et le journal le produit.
    'pagination/perimee',
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
    'import/biblio-non-detachee', 'import/credit-photo-non-repris',
    // La garantie « rien ne disparaît » de l'import (29.09.2026) : szh-legendes.lua,
    // docx-controle-import.py et pronto_modele.py les émettent par le même préfixe, sans
    // entrée CLES_IMPORT — même repli que les quatre ci-dessus.
    'import/bloc-valeur-non-reprise', 'import/image-absente-import',
    'import/figure-alt-a-completer', 'import/tableau-images-et-texte',
    // Émis par docx-meta.py, pronto-lire.py et docx-controle-import.py (revue du 01.10.2026).
    'import/fichier-illisible', 'import/tableau-texte-perdu',
    // Vu par le cockpit en lisant les tableaux de l'article (constatEnteteVide).
    'cockpit/entete-vide'];
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
