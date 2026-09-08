// Les réglages protégés : l'export OJS et les titres de bibliographie.
//
//   node --test "test/js/*.test.js"
//
// Ce qu'ils sont, et pourquoi ils sont à part. Ces deux blocs décrivent la CHAÎNE DE
// PUBLICATION et non le confort d'une personne : une rubrique OJS renommée sur un seul
// poste fait atterrir ses articles dans la mauvaise section de la revue, et un titre de
// bibliographie changé d'un côté fait paraître deux numéros de la même revue avec deux
// titres différents. Ils étaient pourtant offerts à la saisie libre dans « Réglages SZH »,
// entre le thème et le zoom, sans que rien ne dise qu'on engageait tout le monde.
//
// La règle posée : ils se LISENT partout, ils ne se MODIFIENT qu'après un déverrouillage
// explicite qui dit ce qu'il engage, et le poste dit quand il s'écarte de la version
// déployée. Le formulaire sait produire le fichier à transmettre à l'administrateur.
//
// ⚠ Ce que ces contrôles gardent avant tout : un fichier déployé VIDE ne doit rien effacer.
//   Il part vide, et la première mise à jour aurait emporté la configuration OJS des postes
//   qui en avaient une.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const RACINE = path.resolve(__dirname, '..', '..');
const COCKPIT = path.join(RACINE, 'vscodium-extension', 'szh-cockpit');
const lire = (...p) => fs.readFileSync(path.join(RACINE, ...p), 'utf8');

// Le fichier déployé est détourné AVANT le premier require : aucun contrôle ne lit ni
// n'écrit celui du poste.
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
  // Un BOM ne doit pas faire échouer la lecture : plusieurs outils du poste en posent un.
  fs.writeFileSync(DEPLOYE, '﻿' + JSON.stringify({ biblio: { titres: {} } }));
  assert.deepStrictEqual(proteges.lireReglagesProteges(), { biblio: { titres: {} } });
});

test('seuls les deux blocs connus sont retenus', () => {
  // Un fichier déployé qui porterait autre chose — une clé de la configuration du poste
  // recopiée par erreur — ne doit pas se déverser dans celle du poste.
  const lu = proteges.blocsProteges({
    ojs: { types: {} }, biblio: {}, emplacementRevues: 'production', repo: 'ailleurs/x'
  });
  assert.deepStrictEqual(Object.keys(lu).sort(), ['biblio', 'ojs']);
  // Les clés de documentation du fichier (« _lisezmoi », « _exemple ») n'en sont pas non plus.
  assert.deepStrictEqual(proteges.blocsProteges({ _lisezmoi: 'x', _exemple: { ojs: {} } }), {});
});

// ---- Le relais vers la configuration du poste ----

test('un bloc déployé prend la main, un bloc absent laisse celui du poste', () => {
  // C'EST le contrôle qui compte. Le fichier déployé part vide : s'il effaçait ce qu'il ne
  // nomme pas, la première mise à jour emporterait la configuration OJS des postes qui en
  // avaient déjà une.
  const poste = { repo: 'x', emplacementRevues: 'test', ojs: { types: { editorial: 'ED' } } };
  const apres = proteges.configAvecProteges(poste, { biblio: { titres: { revue: { fr: 'Sources' } } } });
  assert.deepStrictEqual(apres.ojs, { types: { editorial: 'ED' } },
    'un bloc que la référence ne nomme pas a été effacé');
  assert.deepStrictEqual(apres.biblio, { titres: { revue: { fr: 'Sources' } } });
  // Et les clés voisines survivent : l'emplacement des revues vit dans le même fichier.
  assert.strictEqual(apres.repo, 'x');
  assert.strictEqual(apres.emplacementRevues, 'test');
  assert.deepStrictEqual(poste.biblio, undefined, 'la configuration de départ a été modifiée');
  // Une référence entièrement vide ne change donc rien du tout.
  assert.deepStrictEqual(proteges.configAvecProteges(poste, {}), poste);
});

// ---- La divergence, dite plutôt que devinée ----

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
  // La table des rubriques OJS en porte des dizaines : une comparaison textuelle aurait
  // fait diverger un poste qui n'avait rien changé, à chaque ouverture du panneau.
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
  // Il doit pouvoir être déployé tel quel : ce que ce module relira doit être les deux blocs.
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
  // L'exemple montre les deux blocs, sous leur vrai nom, pour qu'on n'ait pas à deviner.
  for (const bloc of proteges.BLOCS) {
    assert.ok((livre._exemple || {})[bloc], 'exemple absent pour le bloc : ' + bloc);
  }
});

test('la mise à jour déploie le fichier, et l’écrase — c’est son sens', () => {
  const maj = lire('windows', 'update.ps1');
  assert.match(maj, /settings-protected\.json/, 'le fichier n’est plus déployé');
  assert.match(maj, /Copy-Item \$protegesSrc \(Join-Path \$SzhBase 'settings-protected\.json'\) -Force/,
    'le déploiement n’écrase plus : la version de la rédaction ne ferait plus foi');
});

// ---- L'hôte : verrouillé par défaut, et le déverrouillage passe par une modale ----

const { revueDEssai, activerHote } = require('./hote-factice');
const REVUE = revueDEssai();
const HOTE = activerHote(REVUE);

async function panneauReglages() {
  await HOTE.executer('szh.reglages');
  const p = HOTE.panneauDeType('szhReglages');
  assert.ok(p, 'panneau des réglages absent');
  await p._recepteur({ type: 'pret' });
  return p;
}
function dernier(p, type) {
  return p.messages.filter((m) => m.type === type).pop();
}

test('les deux blocs partent verrouillés, et l’écriture est refusée', async () => {
  const p = await panneauReglages();
  const valeurs = dernier(p, 'valeurs');
  assert.ok(valeurs.proteges, 'l’état des réglages protégés n’est pas envoyé à la page');
  assert.strictEqual(valeurs.proteges.deverrouille, false, 'la page s’ouvre déverrouillée');

  // Un message qui arriverait quand même — page restée ouverte, envoi automatique en vol —
  // ne doit pas passer. Le formulaire grise déjà, mais le verrou ne peut pas vivre dans la
  // page seule : elle est remplaçable, l'hôte ne l'est pas.
  await p._recepteur({ type: 'reglerOjs', ojs: { types: { editorial: 'AR' } } });
  const refus = dernier(p, 'erreur');
  assert.ok(refus && refus.bloc === 'ojs', 'l’écriture verrouillée n’a pas été refusée');
  assert.match(refus.message, /verrouill/i);
  await p._recepteur({ type: 'reglerBiblio', titres: { revue: { fr: 'Sources' } } });
  assert.strictEqual(dernier(p, 'erreur').bloc, 'biblio', 'la bibliographie s’écrit encore verrouillée');
});

test('déverrouiller pose une question modale, et un refus ne déverrouille pas', async () => {
  const p = await panneauReglages();
  const avant = HOTE.avertissements.length;
  // File de réponses vide -> undefined, c'est-à-dire « Annuler ».
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
  // Et l'écriture reste refusée.
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
  // Le poste vient de s'écarter de la version déployée : le bandeau doit le dire tout de
  // suite, pas au prochain rechargement du panneau.
  const etat = dernier(p, 'proteges');
  assert.deepStrictEqual(etat.divergences, ['biblio']);
  assert.ok(etat.avertissement.length > 0, 'la divergence est mesurée mais pas dite');

  // Reverrouiller ne repose aucune question : on peut toujours refermer.
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
// Le verrou ne peut pas vivre dans la page seule — elle est remplaçable, l'hôte ne l'est
// pas, et c'est lui qui refuse l'écriture (contrôlé plus haut). Mais un formulaire dont les
// champs restent saisissables invite à saisir, et le refus n'arrive qu'après coup : la page
// doit dire, avant le geste, que ces réglages ne sont pas à elle.

function ouvrirReglages() {
  const { ouvrir, libellesHote } = require('./dom-minimal');
  const page = ouvrir({
    racine: RACINE, page: 'settings', cssPartage: ['_design.css'], jsPartage: ['_messages.js'],
    txt: libellesHote(RACINE, ['REGL_LIBELLES'])
  });
  const cit = require(path.join(COCKPIT, 'lib', 'citations.js'));
  const biblio = {
    titres: cit.normaliserConfigBiblio({}).titres,
    revues: cit.REVUES_BIBLIO.map((cle) => ({ cle: cle, libelle: cle })),
    langues: cit.LANGUES_BIBLIO.map((cle) => ({ cle: cle, libelle: cle }))
  };
  return { page: page, biblio: biblio };
}

// Tous les contrôles des deux blocs protégés, à plat.
function controles(page) {
  const sortie = [];
  for (const id of ['biblio', 'ojs']) {
    const bloc = page.parId[id];
    if (!bloc) { continue; }
    sortie.push(...bloc.querySelectorAll('input, select, textarea, button'));
  }
  return sortie;
}

test('le formulaire grise les deux blocs tant qu’on n’a pas déverrouillé', () => {
  const { page, biblio } = ouvrirReglages();
  page.envoyer({
    type: 'valeurs', valeurs: { langue: 'fr' }, biblio: biblio,
    proteges: { deverrouille: false, divergences: [], avertissement: '' }
  });
  const verrouilles = controles(page);
  assert.ok(verrouilles.length > 3,
    'aucun contrôle relevé dans les blocs protégés : le contrôle ne prouve rien');
  for (const el of verrouilles) {
    assert.ok(el.classes.has('fige'), 'contrôle non grisé : ' + el.balise);
    // readOnly sur un champ de saisie, disabled sur le reste : un champ désactivé sort de
    // l'ordre de tabulation et n'est plus lisible au lecteur d'écran, alors qu'un réglage
    // qu'on ne peut pas changer doit rester lisible.
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
  const { page, biblio } = ouvrirReglages();
  page.envoyer({
    type: 'valeurs', valeurs: { langue: 'fr' }, biblio: biblio,
    proteges: { deverrouille: false, divergences: [], avertissement: '' }
  });
  const zone = page.parId.proteges;
  assert.ok(zone, 'le bloc des réglages protégés n’est pas dans la page');
  const cases = zone.querySelectorAll('input');
  assert.strictEqual(cases.length, 1, 'une seule case, « déverrouiller », attendue');
  assert.strictEqual(cases[0].checked, false);

  // Cocher n'ouvre rien par soi-même : la page demande, et attend. C'est l'hôte qui pose la
  // question modale — une webview ne peut pas bloquer.
  cases[0].checked = true;
  cases[0].dispatchEvent({ type: 'change' });
  assert.ok(controles(page).every((el) => el.classes.has('fige')),
    'la page s’est déverrouillée toute seule, sans attendre la réponse de l’hôte');

  page.envoyer({ type: 'proteges', deverrouille: true, divergences: [], avertissement: '' });
  const ouverts = controles(page);
  assert.ok(ouverts.every((el) => !el.classes.has('fige')), 'des contrôles sont restés grisés');
  assert.ok(ouverts.every((el) => !el.disabled && !el.readOnly), 'des contrôles sont restés bloqués');
  assert.strictEqual(cases[0].checked, true, 'la case ne suit pas l’état rendu par l’hôte');
});

test('le formulaire dit quand ce poste s’écarte de la version de la rédaction', () => {
  const { page, biblio } = ouvrirReglages();
  page.envoyer({
    type: 'valeurs', valeurs: { langue: 'fr' }, biblio: biblio,
    proteges: { deverrouille: false, divergences: [], avertissement: '' }
  });
  const zone = page.parId.proteges;
  const bandeau = () => zone.querySelectorAll('.szh-notif--attention')[0];
  assert.ok(bandeau(), 'le bandeau de divergence n’est pas posé dans la page');
  assert.strictEqual(bandeau().hidden, true, 'le bandeau paraît alors qu’il n’y a rien à dire');

  page.envoyer({
    type: 'proteges', deverrouille: true, divergences: ['biblio'],
    avertissement: 'Ce poste ne porte plus les valeurs de la rédaction.'
  });
  assert.strictEqual(bandeau().hidden, false, 'la divergence est mesurée mais pas montrée');
  assert.match(bandeau().textContent, /ne porte plus/);
});
