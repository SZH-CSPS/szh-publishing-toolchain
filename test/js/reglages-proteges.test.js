// Les réglages protégés : l'export OJS, les titres de bibliographie et les tâches
// éditoriales.
//
//   node --test test/js/reglages-proteges.test.js
//
// Ces blocs décrivent la chaîne de publication, pas le confort d'une personne : une rubrique
// OJS renommée sur un seul poste envoie ses articles dans la mauvaise section, et un titre de
// bibliographie changé d'un côté donne deux numéros de la même revue avec deux titres
// différents. Ils se lisent partout, ne se modifient qu'après un déverrouillage explicite qui
// dit ce qu'il engage, et le poste signale quand il s'écarte de la version déployée. Le
// formulaire produit le fichier à transmettre à l'administrateur.
//
// Un fichier déployé vide n'efface rien : il est livré vide, et la première mise à jour
// emporterait sinon la configuration OJS des postes qui en ont une.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const RACINE = path.resolve(__dirname, '..', '..');
const COCKPIT = path.join(RACINE, 'vscodium-extension', 'szh-cockpit');
const lire = (...p) => fs.readFileSync(path.join(RACINE, ...p), 'utf8');

// Le fichier déployé est détourné avant le premier require : aucun contrôle ne touche celui
// du poste.
const POSTE = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-proteges-'));
const DEPLOYE = path.join(POSTE, 'settings-protected.json');
process.env.SZH_REGLAGES_PROTEGES = DEPLOYE;

const proteges = require(path.join(COCKPIT, 'lib', 'reglages-proteges.js'));
const LF = String.fromCharCode(10);

function deployer(objet) {
  if (objet === null) { fs.rmSync(DEPLOYE, { force: true }); return; }
  fs.writeFileSync(DEPLOYE, typeof objet === 'string' ? objet : JSON.stringify(objet) + LF);
}

// ---- Lire le fichier déployé ----

test('le fichier déployé se lit, et son absence ne se confond pas avec son vide', () => {
  deployer(null);
  assert.strictEqual(proteges.lireReglagesProteges(), null,
    'un fichier absent doit rendre null, et non {} : « je n’ai pas su lire » n’est pas « il n’y a rien dedans »');
  deployer('{ pas du json');
  assert.strictEqual(proteges.lireReglagesProteges(), null, 'un fichier illisible doit rendre null');
  deployer([1, 2]);
  assert.strictEqual(proteges.lireReglagesProteges(), null, 'un tableau n’est pas une configuration');
  deployer({ ojs: { types: { editorial: 'ED' } } });
  assert.deepStrictEqual(proteges.lireReglagesProteges(), { ojs: { types: { editorial: 'ED' } } });
  // Un BOM ne fait pas échouer la lecture : plusieurs outils du poste en posent un.
  fs.writeFileSync(DEPLOYE, '﻿' + JSON.stringify({ biblio: { titres: {} } }));
  assert.deepStrictEqual(proteges.lireReglagesProteges(), { biblio: { titres: {} } });
});

test('seuls les deux blocs connus sont retenus', () => {
  // Une autre clé dans le fichier déployé (une clé de configuration du poste recopiée par
  // erreur) ne se déverse pas dans celle du poste.
  const lu = proteges.blocsProteges({
    ojs: { types: {} }, biblio: {}, emplacementRevues: 'production', repo: 'ailleurs/x'
  });
  assert.deepStrictEqual(Object.keys(lu).sort(), ['biblio', 'ojs']);
  // Les clés de documentation du fichier (« _lisezmoi », « _exemple ») sont ignorées aussi.
  assert.deepStrictEqual(proteges.blocsProteges({ _lisezmoi: 'x', _exemple: { ojs: {} } }), {});
});

// ---- Le relais vers la configuration du poste ----

test('un bloc déployé prend la main, un bloc absent laisse celui du poste', () => {
  // Le fichier déployé est livré vide : s'il effaçait ce qu'il ne nomme pas, la première mise
  // à jour emporterait la configuration OJS des postes qui en ont une.
  const poste = { repo: 'x', emplacementRevues: 'test', ojs: { types: { editorial: 'ED' } } };
  const apres = proteges.configAvecProteges(poste, { biblio: { titres: { revue: { fr: 'Sources' } } } });
  assert.deepStrictEqual(apres.ojs, { types: { editorial: 'ED' } },
    'un bloc que la référence ne nomme pas a été effacé');
  assert.deepStrictEqual(apres.biblio, { titres: { revue: { fr: 'Sources' } } });
  // Les clés voisines survivent : l'emplacement des revues vit dans le même fichier.
  assert.strictEqual(apres.repo, 'x');
  assert.strictEqual(apres.emplacementRevues, 'test');
  assert.deepStrictEqual(poste.biblio, undefined, 'la configuration de départ a été modifiée');
  // Une référence vide ne change rien.
  assert.deepStrictEqual(proteges.configAvecProteges(poste, {}), poste);
});

// ---- La divergence, signalée ----

test('la divergence ne se mesure que sur ce que la référence impose', () => {
  const poste = { ojs: { types: { editorial: 'ED' } }, biblio: { titres: {} } };
  assert.deepStrictEqual(proteges.divergences(poste, null), [],
    'sans référence il n’y a rien à comparer : crier « modifié localement » serait un mensonge');
  assert.deepStrictEqual(proteges.divergences(poste, {}), [],
    'une référence vide n’impose rien, donc ne diverge de rien');
  assert.deepStrictEqual(proteges.divergences(poste, { ojs: { types: { editorial: 'ED' } } }), []);
  assert.deepStrictEqual(proteges.divergences(poste, { ojs: { types: { editorial: 'AR' } } }), ['ojs']);
  // Un bloc imposé que le poste n'a pas du tout diverge aussi.
  assert.deepStrictEqual(proteges.divergences({}, { biblio: { titres: {} } }), ['biblio']);
});

test('la comparaison ne dépend pas de l’ordre des clés', () => {
  // La table des rubriques OJS en porte des dizaines : une comparaison textuelle (ordre des
  // clés) ferait diverger un poste qui n'a rien changé.
  const a = { ojs: { revues: { fr: { genreFichier: 'T', groupeAuteur: 'A' } } } };
  const b = { ojs: { revues: { fr: { groupeAuteur: 'A', genreFichier: 'T' } } } };
  assert.deepStrictEqual(proteges.divergences(a, b), []);
  assert.ok(proteges.memeValeur([1, { x: 2 }], [1, { x: 2 }]));
  assert.ok(!proteges.memeValeur([1, 2], [2, 1]), 'l’ordre d’un tableau, lui, compte');
});

// ---- Le fichier à transmettre ----

test('le fichier à télécharger porte les deux blocs et un mot d’explication', () => {
  const texte = proteges.fichierATelecharger(
    { repo: 'x', ojs: { types: { editorial: 'ED' } }, biblio: { titres: {} } },
    'À relire avant de déployer.');
  const relu = JSON.parse(texte);
  assert.strictEqual(relu._lisezmoi, 'À relire avant de déployer.');
  assert.deepStrictEqual(relu.ojs, { types: { editorial: 'ED' } });
  assert.deepStrictEqual(relu.biblio, { titres: {} });
  assert.strictEqual(relu.repo, undefined, 'une clé étrangère est partie dans le fichier');
  // Il se déploie tel quel : ce que ce module relit, ce sont les deux blocs.
  assert.deepStrictEqual(Object.keys(proteges.blocsProteges(relu)).sort(), ['biblio', 'ojs']);
  assert.match(texte, /\n$/, 'un fichier de configuration se termine par une fin de ligne');
});

// ---- Le fichier livré avec l'outil ----

test('le fichier livré n’impose rien, et montre la forme attendue', () => {
  const livre = JSON.parse(lire('windows', 'settings-protected.json'));
  assert.deepStrictEqual(proteges.blocsProteges(livre), {},
    'le fichier livré impose un bloc : il écraserait celui de tous les postes dès la mise à jour');
  assert.ok(String(livre._lisezmoi || '').length > 200,
    'le fichier livré doit dire ce qu’il est et ce qu’on en fait : c’est son seul commentaire possible');
  // L'exemple montre les deux blocs sous leur vrai nom.
  for (const bloc of proteges.BLOCS) {
    assert.ok((livre._exemple || {})[bloc], 'exemple absent pour le bloc : ' + bloc);
  }
});

// Le diagnostic du poste compare les mêmes blocs depuis PowerShell, avec sa propre liste. Un
// bloc ajouté ici et oublié là-bas ferait diverger le poste sans que rien ne le dise.
test('le diagnostic du poste regarde exactement les mêmes blocs', () => {
  const ps = lire('windows', 'diagnostic.ps1');
  const m = ps.match(/\$protegesBlocs\s*=\s*@\(([^)]*)\)/);
  assert.ok(m, 'liste des blocs introuvable dans diagnostic.ps1');
  const laBas = m[1].split(',').map((x) => x.trim().replace(/^'|'$/g, '')).filter((x) => x !== '');
  assert.deepStrictEqual(laBas.slice().sort(), proteges.BLOCS.slice().sort(),
    'diagnostic.ps1 et lib/reglages-proteges.js ne regardent plus les mêmes blocs');
});

test('la mise à jour déploie le fichier, et l’écrase — c’est son sens', () => {
  const maj = lire('windows', 'update.ps1');
  assert.match(maj, /settings-protected\.json/, 'le fichier n’est plus déployé');
  assert.match(maj, /Copy-Item \$protegesSrc \(Join-Path \$SzhBase 'settings-protected\.json'\) -Force/,
    'le déploiement n’écrase plus : la version de la rédaction ne ferait plus foi');
});

// ---- L'hôte : verrouillé par défaut, et le déverrouillage passe par une modale ----

const { revueDEssai, activerHote } = require('./hote-factice');
const { MSG } = require(path.join(COCKPIT, 'lib', 'messages.js'));
const REVUE = revueDEssai();
const HOTE = activerHote(REVUE);

async function panneauReglages() {
  await HOTE.executer('szh.reglages');
  const p = HOTE.panneauDeType('szhAccueil');
  assert.ok(p, 'panneau des réglages absent');
  await p._recepteur({ type: MSG.PRET });
  return p;
}
function dernier(p, type) {
  return p.messages.filter((m) => m.type === type).pop();
}

test('les trois blocs partent verrouillés, et l’écriture est refusée', async () => {
  const p = await panneauReglages();
  const valeurs = dernier(p, 'valeurs');
  assert.ok(valeurs.proteges, 'l’état des réglages protégés n’est pas envoyé à la page');
  assert.strictEqual(valeurs.proteges.deverrouille, false, 'la page s’ouvre déverrouillée');

  // Un message qui arrive quand même (page restée ouverte, envoi automatique en cours) est
  // refusé. Le formulaire grise déjà, mais le verrou vit dans l'hôte : la page est
  // remplaçable, l'hôte non.
  await p._recepteur({ type: 'reglerOjs', ojs: { types: { editorial: 'AR' } } });
  const refus = dernier(p, 'erreur');
  assert.ok(refus && refus.bloc === 'ojs', 'l’écriture verrouillée n’a pas été refusée');
  assert.match(refus.message, /verrouill/i);
  await p._recepteur({ type: 'reglerBiblio', titres: { revue: { fr: 'Sources' } } });
  assert.strictEqual(dernier(p, 'erreur').bloc, 'biblio', 'la bibliographie s’écrit encore verrouillée');
  // Les tâches éditoriales sont protégées aussi : elles décrivent le processus d'une revue,
  // pas le confort d'une personne.
  await p._recepteur({ type: 'taches-enregistrer', taches: { revue: [{ id: 'x', fr: 'x', de: 'x' }] } });
  assert.strictEqual(dernier(p, 'erreur').bloc, 'tachesArticle',
    'les tâches s’écrivent encore verrouillées');
});

test('les tâches partent à la page, et s’écrivent une fois déverrouillées', async () => {
  const p = await panneauReglages();
  const valeurs = dernier(p, 'valeurs');
  assert.ok(valeurs.taches, 'la table des tâches n’est pas envoyée au panneau');
  assert.ok(valeurs.taches.table.revue.length > 0 && valeurs.taches.table.zeitschrift.length > 0,
    'les deux revues doivent partir, même sur un poste qui n’a jamais rien réglé');
  assert.deepStrictEqual(valeurs.taches.revues.map((r) => r.cle), ['revue', 'zeitschrift']);
  assert.ok(valeurs.taches.revues.every((r) => r.libelle), 'les revues partent sans nom lisible');

  HOTE.repondreModale('Déverrouiller');
  await p._recepteur({ type: 'deverrouiller', valeur: true });
  await p._recepteur({ type: 'taches-enregistrer', taches: {
    revue: [{ id: '', fr: 'relecture croisée', de: 'Gegenlesen' }]
  } });
  const enregistre = dernier(p, 'enregistre');
  assert.ok(enregistre && enregistre.bloc === 'tachesArticle', 'l’écriture n’a pas abouti');

  const cfg = JSON.parse(fs.readFileSync(process.env.SZH_CONFIG_OJS, 'utf8'));
  assert.deepStrictEqual(cfg.tachesArticle.revue,
    [{ id: 'relecture-croisee', fr: 'relecture croisée', de: 'Gegenlesen' }],
    'l’identifiant n’a pas été dérivé de l’intitulé français');
  // Une revue absente du message garde ses intitulés : configAvecTaches n'en modifie qu'une
  // et écrit la table complète, où l'autre revue redescend telle qu'elle a été lue (le jeu de
  // départ sur un poste neuf). Une liste unique pour les deux revues se verrait ici.
  assert.ok(Array.isArray(cfg.tachesArticle.zeitschrift)
    && cfg.tachesArticle.zeitschrift.length > 1,
    'la revue absente du message a perdu ses intitulés');
  assert.ok(!cfg.tachesArticle.zeitschrift.some((t) => t.id === 'relecture-croisee'),
    'la tâche écrite sur une revue a débordé sur l’autre');

  // La page reçoit la table relue : sans elle, la rangée suivante fabriquerait un second
  // identifiant pour le même intitulé.
  const relu = dernier(p, 'valeurs');
  assert.strictEqual(relu.taches.table.revue[0].id, 'relecture-croisee');
  await p._recepteur({ type: 'deverrouiller', valeur: false });
});

test('déverrouiller pose une question modale, et un refus ne déverrouille pas', async () => {
  const p = await panneauReglages();
  const avant = HOTE.avertissements.length;
  // File de réponses vide : undefined, c'est-à-dire « Annuler ».
  await p._recepteur({ type: 'deverrouiller', valeur: true });
  const questions = HOTE.avertissements.slice(avant);
  assert.strictEqual(questions.length, 1, 'aucune question posée, ou plusieurs');
  const modale = HOTE.modales[HOTE.modales.length - 1];
  assert.ok(modale.options && modale.options.modal,
    'la question n’est pas modale : un avertissement qu’on chasse d’un clic n’avertit personne');
  assert.match(String(modale.options.detail), /administr|betreut/i,
    'le détail ne dit pas à qui s’adresser');
  assert.strictEqual(dernier(p, 'proteges').deverrouille, false,
    'un refus a quand même déverrouillé');
  // L'écriture reste refusée.
  await p._recepteur({ type: 'reglerOjs', ojs: {} });
  assert.ok(dernier(p, 'erreur'), 'l’écriture est passée après un refus');
});

test('déverrouiller puis accepter laisse écrire, et le poste dit qu’il diverge', async () => {
  deployer({ biblio: { titres: { revue: { fr: 'Références', de: 'Literatur', it: 'Bibliografia' } } } });
  const p = await panneauReglages();
  HOTE.repondreModale('Déverrouiller');
  await p._recepteur({ type: 'deverrouiller', valeur: true });
  assert.strictEqual(dernier(p, 'proteges').deverrouille, true, 'la modale acceptée n’a pas déverrouillé');

  await p._recepteur({ type: 'reglerBiblio', titres: { revue: { fr: 'Sources', de: 'Literatur', it: 'Bibliografia' } } });
  const enregistre = dernier(p, 'enregistre');
  assert.ok(enregistre && enregistre.bloc === 'biblio', 'l’écriture déverrouillée n’a pas abouti');
  // Le poste vient de s'écarter de la version déployée : le bandeau le dit tout de suite,
  // sans attendre le rechargement du panneau.
  const etat = dernier(p, 'proteges');
  assert.deepStrictEqual(etat.divergences, ['biblio']);
  assert.ok(etat.avertissement.length > 0, 'la divergence est mesurée mais pas dite');

  // Reverrouiller ne pose aucune question.
  const avant = HOTE.avertissements.length;
  await p._recepteur({ type: 'deverrouiller', valeur: false });
  assert.strictEqual(HOTE.avertissements.length, avant, 'reverrouiller pose une question');
  assert.strictEqual(dernier(p, 'proteges').deverrouille, false);
});

test('« Télécharger » écrit un fichier déployable, même verrouillé', async () => {
  const p = await panneauReglages();
  const cible = path.join(POSTE, 'a-transmettre.json');
  HOTE.repondreEnregistrement(cible);
  await p._recepteur({ type: 'telecharger-proteges' });
  assert.ok(fs.existsSync(cible), 'aucun fichier écrit');
  const relu = JSON.parse(fs.readFileSync(cible, 'utf8'));
  assert.ok(String(relu._lisezmoi || '').length > 0, 'le fichier part sans un mot d’explication');
  assert.deepStrictEqual(relu.biblio.titres.revue.fr, 'Sources',
    'le fichier ne porte pas les valeurs du poste, modifications comprises');

  // Annuler n'écrit rien et ne dit rien.
  HOTE.repondreEnregistrement(null);
  const erreursAvant = HOTE.erreurs.length;
  await p._recepteur({ type: 'telecharger-proteges' });
  assert.strictEqual(HOTE.erreurs.length, erreursAvant, 'annuler a produit une erreur');
});

// ---- Le formulaire, réellement rendu ----
//
// C'est l'hôte qui refuse l'écriture (vérifié plus haut). Mais un champ saisissable invite à
// saisir, et le refus n'arriverait qu'après : la page dit, avant toute saisie, que ces
// réglages sont verrouillés.

function ouvrirFormulaire() {
  const { ouvrirReglages } = require('./page-reglages');
  const page = ouvrirReglages();
  const cit = require(path.join(COCKPIT, 'lib', 'citations.js'));
  const biblio = {
    titres: cit.normaliserConfigBiblio({}).titres,
    revues: cit.REVUES_BIBLIO.map((cle) => ({ cle: cle, libelle: cle })),
    langues: cit.LANGUES_BIBLIO.map((cle) => ({ cle: cle, libelle: cle }))
  };
  const art = require(path.join(COCKPIT, 'lib', 'articles.js'));
  const taches = {
    table: art.tachesConfig({}),
    revues: art.REVUES_TACHES.map((cle) => ({ cle: cle, libelle: cle })),
    max: art.MAX_TACHES
  };
  return { page: page, biblio: biblio, taches: taches };
}

// Tous les contrôles des trois blocs protégés, à plat.
function controles(page) {
  const sortie = [];
  for (const id of ['regl-biblio', 'regl-taches', 'regl-ojs']) {
    const bloc = page.parId(id);
    if (!bloc) { continue; }
    sortie.push(...bloc.querySelectorAll('input, select, textarea, button'));
  }
  return sortie;
}

test('le formulaire grise les trois blocs tant qu’on n’a pas déverrouillé', () => {
  const { page, biblio, taches } = ouvrirFormulaire();
  page.envoyer({
    type: MSG.VALEURS, valeurs: { langue: 'fr' }, biblio: biblio, taches: taches,
    proteges: { deverrouille: false, divergences: [], avertissement: '' }
  });
  const verrouilles = controles(page);
  assert.ok(verrouilles.length > 3,
    'aucun contrôle relevé dans les blocs protégés : le contrôle ne prouve rien');
  for (const el of verrouilles) {
    assert.ok(el.classes.has('fige'), 'contrôle non grisé : ' + el.balise);
    // readOnly sur un champ de saisie, disabled sur le reste : un champ désactivé sort de
    // l'ordre de tabulation et du lecteur d'écran, alors qu'un réglage verrouillé doit rester
    // lisible.
    if (el.balise === 'input' && el.type === 'text') {
      assert.strictEqual(el.readOnly, true, 'champ de saisie encore modifiable');
      assert.strictEqual(el.disabled, false,
        'un champ de saisie désactivé sort du parcours au clavier : readOnly, pas disabled');
    } else {
      assert.strictEqual(el.disabled, true, 'contrôle encore actionnable : ' + el.balise);
    }
  }
});

test('le formulaire ne se déverrouille que sur la réponse de l’hôte', () => {
  const { page, biblio, taches } = ouvrirFormulaire();
  page.envoyer({
    type: MSG.VALEURS, valeurs: { langue: 'fr' }, biblio: biblio, taches: taches,
    proteges: { deverrouille: false, divergences: [], avertissement: '' }
  });
  const zone = page.parId('regl-proteges');
  assert.ok(zone, 'le bloc des réglages protégés n’est pas dans la page');
  const cases = zone.querySelectorAll('label.accueil-verrou input');
  assert.strictEqual(cases.length, 1, 'une seule case, « déverrouiller », attendue');
  assert.strictEqual(cases[0].checked, false);

  // Cocher n'ouvre rien : la page demande et attend. C'est l'hôte qui pose la question modale,
  // une webview ne pouvant pas bloquer.
  cases[0].checked = true;
  cases[0].dispatchEvent({ type: 'change' });
  assert.ok(controles(page).every((el) => el.classes.has('fige')),
    'la page s’est déverrouillée toute seule, sans attendre la réponse de l’hôte');

  page.envoyer({ type: MSG.PROTEGES, deverrouille: true, divergences: [], avertissement: '' });
  const ouverts = controles(page);
  assert.ok(ouverts.every((el) => !el.classes.has('fige')), 'des contrôles sont restés grisés');
  assert.ok(ouverts.every((el) => !el.disabled && !el.readOnly), 'des contrôles sont restés bloqués');
  assert.strictEqual(cases[0].checked, true, 'la case ne suit pas l’état rendu par l’hôte');
});

test('le formulaire dit quand ce poste s’écarte de la version de la rédaction', () => {
  const { page, biblio, taches } = ouvrirFormulaire();
  page.envoyer({
    type: MSG.VALEURS, valeurs: { langue: 'fr' }, biblio: biblio, taches: taches,
    proteges: { deverrouille: false, divergences: [], avertissement: '' }
  });
  const zone = page.parId('regl-proteges');
  const bandeau = () => zone.querySelectorAll('.szh-notif--attention')[0];
  assert.ok(bandeau(), 'le bandeau de divergence n’est pas posé dans la page');
  assert.strictEqual(bandeau().hidden, true, 'le bandeau paraît alors qu’il n’y a rien à dire');

  page.envoyer({
    type: MSG.PROTEGES, deverrouille: true, divergences: ['biblio'],
    avertissement: 'Ce poste ne porte plus les valeurs de la rédaction.'
  });
  assert.strictEqual(bandeau().hidden, false, 'la divergence est mesurée mais pas montrée');
  assert.match(bandeau().textContent, /ne porte plus/);
});

// Les tâches éditoriales, réellement rendues : un bloc vide s'afficherait sans erreur et ne se
// remarquerait qu'au bouclage suivant.
test('le formulaire montre les tâches des deux revues, et relit ce qui est à l’écran', () => {
  const { page, biblio, taches } = ouvrirFormulaire();
  page.envoyer({
    type: MSG.VALEURS, valeurs: { langue: 'fr' }, biblio: biblio, taches: taches,
    proteges: { deverrouille: true, divergences: [], avertissement: '' }
  });
  const zone = page.parId('regl-taches');
  assert.ok(zone, 'le bloc des tâches n’est pas dans la page');
  const champs = zone.querySelectorAll('[data-tache-revue]');
  const attendus = (taches.table.revue.length + taches.table.zeitschrift.length) * 2;
  assert.strictEqual(champs.length, attendus,
    'un champ par tâche et par langue attendu, pour les deux revues');
  // L'identifiant n'est pas un champ : il est écrit dans le sidecar de chaque article, et le
  // modifier décocherait la tâche partout.
  assert.ok(champs.every((c) => c.dataset.tacheId), 'l’identifiant ne suit plus le champ');
  assert.ok(zone.querySelectorAll('[data-tache-langue="fr"]').length > 0
    && zone.querySelectorAll('[data-tache-langue="de"]').length > 0,
    'une des deux langues manque');

  // Corriger un intitulé ne touche pas à l'identifiant, sinon tous les articles perdraient la
  // coche de cette tâche.
  // Un seul attribut par sélecteur dans le harnais DOM : le reste se filtre à la main.
  const premier = champs.filter((c) => c.dataset.tacheRevue === 'revue'
    && c.dataset.tacheLangue === 'fr')[0];
  assert.ok(premier, 'aucun champ français pour la revue');
  const idAvant = premier.dataset.tacheId;
  premier.value = 'version définitive';
  premier.dispatchEvent({ type: 'input' });
  const envoi = page.messages.filter((m) => m.type === 'taches-enregistrer').pop();
  if (envoi) {
    assert.strictEqual(envoi.taches.revue[0].id, idAvant, 'l’identifiant a été recalculé');
  }
  assert.strictEqual(premier.dataset.tacheId, idAvant, 'l’identifiant a bougé avec l’intitulé');
});
