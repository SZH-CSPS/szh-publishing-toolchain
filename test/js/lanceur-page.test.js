// La page du lanceur dans l'éditeur (media/lanceur.*), chargée dans le DOM minimal avec les
// libellés que l'hôte lui injecte (lib/lanceur-page.js, textesLanceur).
//
//   node --test test/js/lanceur-page.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { ouvrir, chargerAvecVscodeFactice } = require('./dom-minimal');

const RACINE = path.resolve(__dirname, '..', '..');
const COCKPIT = path.join(RACINE, 'vscodium-extension', 'szh-cockpit');
const { MSG } = require(path.join(COCKPIT, 'lib', 'messages.js'));
const { TEXTES_COCKPIT } = chargerAvecVscodeFactice(path.join(COCKPIT, 'lib', 'i18n.js'));
const TEXTES = path.join(COCKPIT, 'lib', 'lanceur-page.js');
const { textesLanceur, produitParDefaut } = require(TEXTES);

const TXT = textesLanceur();
const ORDRE = [['produits', 'ongletProduits'], ['nouveau', 'ongletNouveau'], ['preproc', 'ongletPreproc'],
  ['secretariat', 'ongletSecretariat'], ['reglages', 'ongletReglages'], ['journal', 'ongletJournal']];
const f = (cle, valeurs) => valeurs.reduce((t, v, i) => t.split('{' + i + '}').join(String(v)), TXT[cle]);

const e = (dossier, nom, titre, autres) => Object.assign({ nom: nom, titre: titre, chemin: dossier + '\\' + nom,
  modifie: '01.09.2026', verrouillee: false }, autres || {});
function charger(autres) {
  return Object.assign({
    type: MSG.CHARGER, langue: 'fr', anneeCourante: 2026, version: '2026.10.1', exports: 'C:\\P\\Exports',
    produits: [
      { jeton: 'revue', libelle: 'Revue', type: 'numero', racine: 'C:\\P\\Revue', anneeZeroVolume: 2010,
        enCours: [e('C:\\P\\Revue', '2026-02', 'Deux'), e('C:\\P\\Revue', '2026-01', 'Un')],
        archives: [e('C:\\P\\Archive', '2025-04', 'Quatre', { verrouillee: true })] },
      { jeton: 'zeitschrift', libelle: 'Zeitschrift', type: 'numero', racine: 'C:\\P\\Zeitschrift', anneeZeroVolume: 1994,
        enCours: [e('C:\\P\\Zeitschrift', '2026-05', 'Fünf')], archives: [] },
      { jeton: 'livre', libelle: 'Book', type: 'livre', racine: 'C:\\P\\Book',
        enCours: [e('C:\\P\\Book', '2026-B13-ecole', 'École')], archives: [] }
    ],
    dernierOuvert: 'C:\\P\\Revue\\2026-01',
    historique: { edudoc: { revue: { '2026-01': '09.04.2026' } } },
    journaux: [
      { rang: 0, date: '01.10.2026 08:12', verdict: 'ok', ko: 14 },
      { rang: 1, date: '24.09.2026 08:05', verdict: 'echec', ko: 22 }
    ]
  }, autres || {});
}
const OJS = [[2026, 3, 'Trois'], [2026, 2, 'Deux'], [2026, 1, 'Un']];

function page() {
  return ouvrir({ racine: RACINE, page: 'lanceur', cssPartage: ['_design.css'], jsPartage: ['_messages.js'], txt: TXT });
}
const parId = (p, id) => p.parId.lanceur.querySelector('[id="' + id + '"]');
const tous = (p, sel) => p.parId.lanceur.querySelectorAll(sel);
// Les messages viennent du contexte de la page : on les recopie pour les comparer.
const posts = (p, type) => JSON.parse(JSON.stringify(p.messages.filter((m) => m.type === type)));
const clic = (el, mod) => el.dispatchEvent(Object.assign({ type: 'click' }, mod || {}));
const visibles = (p) => tous(p, '[role="tabpanel"]').filter((x) => !x.hidden).map((x) => x.id);
const coche = (p, nom) => tous(p, 'input[name="' + nom + '"]').filter((r) => r.checked).map((r) => r.value);
function ojsRecus(p) {
  for (const n of OJS) {
    p.envoyer({ type: MSG.LANCEUR_LIGNE, commande: 'numeros-ojs',
      ligne: { t: 'numero', cle: n[0] + '-0' + n[1], libelle: n[2], annee: n[0], numero: n[1] } });
  }
  p.envoyer({ type: MSG.LANCEUR_FIN, commande: 'numeros-ojs', ok: true, texte: '' });
}

test('lanceur : la page se charge, annonce « pret » et pose six onglets étiquetés dans l’ordre', () => {
  const p = page();
  assert.strictEqual(posts(p, MSG.PRET).length, 1);
  const tablist = tous(p, '[role="tablist"]');
  assert.strictEqual(tablist.length, 1);
  assert.strictEqual(tablist[0].getAttribute('aria-label'), TXT.ongletsAria);
  const onglets = tous(p, '[role="tab"]');
  assert.deepStrictEqual(onglets.map((o) => o.id), ORDRE.map((o) => 'onglet-' + o[0]));
  ORDRE.forEach(([cle, libelle], i) => {
    const o = onglets[i];
    assert.ok(TXT[libelle], 'libellé vide : ' + libelle);
    assert.strictEqual(o.textContent, TXT[libelle]);
    // Le double du libellé, réservé en gras par ::after, est le libellé lui-même.
    assert.strictEqual(o.dataset.libelle, TXT[libelle]);
    const panneau = parId(p, o.getAttribute('aria-controls'));
    assert.ok(panneau, 'pas de panneau pour ' + cle);
    assert.strictEqual(panneau.getAttribute('role'), 'tabpanel');
    assert.strictEqual(panneau.getAttribute('aria-labelledby'), o.id);
  });
  assert.strictEqual(tous(p, '[role="tabpanel"]').length, ORDRE.length);
});

test('lanceur : l’onglet Produits est actif au chargement, avant comme après les données', () => {
  const p = page();
  assert.strictEqual(parId(p, 'onglet-produits').getAttribute('aria-selected'), 'true');
  assert.deepStrictEqual(visibles(p), ['panneau-produits']);
  p.envoyer(charger());
  assert.strictEqual(parId(p, 'onglet-produits').getAttribute('aria-selected'), 'true');
  assert.deepStrictEqual(visibles(p), ['panneau-produits']);
  assert.deepStrictEqual(tous(p, '[role="tab"]').map((o) => o.getAttribute('tabindex')), ['0', '-1', '-1', '-1', '-1', '-1']);
});

test('lanceur : la page ouvre le produit que l’hôte désigne, sans règle de langue à elle', () => {
  const pFr = page();
  pFr.envoyer(charger({ langue: 'fr', produit: 'revue' }));
  assert.deepStrictEqual(coche(pFr, 'produit-prod'), ['revue']);
  assert.deepStrictEqual(coche(pFr, 'produit-nv'), ['revue']);
  assert.deepStrictEqual(coche(pFr, 'produit-sec'), ['revue']);
  assert.ok(parId(pFr, 'entree-0').textContent.includes('2026-02'));
  // Une page en français sur la Zeitschrift : c'est l'hôte qui l'a dit, la langue n'y peut rien.
  const pDe = page();
  pDe.envoyer(charger({ langue: 'fr', produit: 'zeitschrift' }));
  assert.deepStrictEqual(coche(pDe, 'produit-prod'), ['zeitschrift']);
  assert.deepStrictEqual(coche(pDe, 'produit-sec'), ['zeitschrift']);
  assert.ok(parId(pDe, 'entree-0').textContent.includes('2026-05'));
  const pSans = page();
  pSans.envoyer(charger({ langue: 'de' }));
  assert.deepStrictEqual(coche(pSans, 'produit-prod'), ['revue'], 'sans désignation, le premier produit');
  const pChoix = page();
  pChoix.envoyer(charger({ langue: 'de', produit: 'livre' }));
  assert.deepStrictEqual(coche(pChoix, 'produit-prod'), ['livre']);
  // Le livre n'a pas de secrétariat : celui-ci garde une revue.
  assert.deepStrictEqual(coche(pChoix, 'produit-sec'), ['revue']);
});

test('lanceur : le produit d’office suit la langue, puis le choix du compte, puis SZH_ONGLET', () => {
  assert.strictEqual(produitParDefaut('fr', '', ''), 'revue');
  assert.strictEqual(produitParDefaut('de', '', ''), 'zeitschrift');
  assert.strictEqual(produitParDefaut('it', '', ''), 'zeitschrift');
  assert.strictEqual(produitParDefaut('fr', 'livre', ''), 'livre');
  assert.strictEqual(produitParDefaut('fr', 'Zeitschrift', ''), 'zeitschrift');
  assert.strictEqual(produitParDefaut('fr', 'livre', 'revue'), 'revue');
  assert.strictEqual(produitParDefaut('de', 'inconnu', 'aussi'), 'zeitschrift');
  assert.strictEqual(produitParDefaut('de', '', '', ['revue', 'livre']), 'revue');
});

test('produits : le dernier ouvert est choisi et prend le focus ; Entrée, double-clic et Ouvrir l’ouvrent', () => {
  const p = page();
  p.envoyer(charger());
  const liste = tous(p, '[role="listbox"]')[0];
  const options = liste.querySelectorAll('[role="option"]');
  assert.deepStrictEqual(options.map((o) => o.getAttribute('aria-selected')), ['false', 'true']);
  assert.ok(options[1].textContent.includes(TXT.prodDernier));
  assert.strictEqual(liste._focused, true);
  liste.dispatchEvent({ type: 'keydown', key: 'Enter' });
  clic(parId(p, 'prod-ouvrir'));
  options[0].dispatchEvent({ type: 'dblclick' });
  assert.deepStrictEqual(posts(p, MSG.LANCEUR_OUVRIR).map((m) => m.chemin),
    ['C:\\P\\Revue\\2026-01', 'C:\\P\\Revue\\2026-01', 'C:\\P\\Revue\\2026-02']);
  // Les archives sont repliées ; y choisir une entrée retire le choix de la liste en cours.
  const archives = tous(p, '.lanceur-archives')[0];
  assert.notStrictEqual(archives.open, true);
  assert.strictEqual(parId(p, 'prod-archives').textContent, f('prodArchives', [1]));
  clic(parId(p, 'archive-0'));
  assert.deepStrictEqual(options.map((o) => o.getAttribute('aria-selected')), ['false', 'false']);
  clic(parId(p, 'prod-ouvrir'));
  assert.strictEqual(posts(p, MSG.LANCEUR_OUVRIR).pop().chemin, 'C:\\P\\Archive\\2025-04');
  clic(parId(p, 'prod-versions'));
  assert.strictEqual(posts(p, MSG.LANCEUR_VERSIONS).length, 1);
});

test('produits : un produit vide propose de créer, sans bouton Ouvrir', () => {
  const p = page();
  const vide = charger();
  vide.produits[0].enCours = [];
  vide.produits[0].archives = [];
  p.envoyer(vide);
  assert.ok(p.parId.lanceur.textContent.includes(f('prodVide', ['Revue'])));
  assert.strictEqual(parId(p, 'prod-ouvrir').hidden, true);
  clic(parId(p, 'prod-creer'));
  assert.deepStrictEqual(visibles(p), ['panneau-nouveau']);
});

test('nouveau : le numéro suivant et le volume sont proposés, un nom pris est refusé sur place', () => {
  const p = page();
  p.envoyer(charger());
  clic(parId(p, 'onglet-nouveau'));
  const numero = parId(p, 'nv-numero');
  assert.strictEqual(parId(p, 'nv-annee').value, '2026');
  assert.strictEqual(numero.value, '3');
  assert.strictEqual(parId(p, 'nv-volume').value, '16');
  const creer = parId(p, 'nv-creer');
  assert.strictEqual(creer._focused, true);
  clic(creer);
  assert.deepStrictEqual(posts(p, MSG.LANCEUR_CREER),
    [{ type: MSG.LANCEUR_CREER, produit: 'revue', annee: 2026, numero: 3, volume: 16, volumeManuel: false }]);
  numero.value = '2';
  numero.dispatchEvent({ type: 'input' });
  assert.strictEqual(creer.disabled, true);
  assert.strictEqual(numero.getAttribute('aria-invalid'), 'true');
  assert.strictEqual(parId(p, 'nv-erreur').textContent, f('nvExiste', ['2026-02', 'Deux']));
  p.envoyer({ type: MSG.LANCEUR_CREE, ok: false, texte: 'Volume 16, numéro 3 déjà pris.' });
  assert.ok(parId(p, 'panneau-nouveau').textContent.includes(f('nvRefus', ['Volume 16, numéro 3 déjà pris.'])));
});

test('secrétariat : les numéros publiés se chargent seuls, et chaque tâche part en un clic', () => {
  const p = page();
  p.envoyer(charger());
  clic(parId(p, 'onglet-secretariat'));
  // Depuis l'année du dernier numéro exporté : 2026.
  assert.deepStrictEqual(posts(p, MSG.LANCEUR_OJS_CHARGER), [{ type: MSG.LANCEUR_OJS_CHARGER, revue: 'revue', depuisAnnee: 2026 }]);
  assert.strictEqual(parId(p, 'sec-edudoc').disabled, true, 'Exporter reste actif pendant le chargement');
  ojsRecus(p);
  assert.strictEqual(parId(p, 'sec-edudoc-resume').textContent, f('secResumeNonExportesPlus', ['2026-02, 2026-03']));
  // Sans historique, les numéros de l'année.
  assert.strictEqual(parId(p, 'sec-caracteres-resume').textContent, f('secResumeAnneePlus', ['2026-01, 2026-02, 2026-03', 2026]));
  clic(parId(p, 'sec-edudoc'));
  clic(parId(p, 'sec-newsletter'));
  assert.deepStrictEqual(posts(p, MSG.LANCEUR_EXPORTER), [
    { type: MSG.LANCEUR_EXPORTER, commande: 'edudoc', revue: 'revue', cles: ['2026-02', '2026-03'] },
    { type: MSG.LANCEUR_EXPORTER, commande: 'newsletter', revue: 'revue', numeros: ['C:\\P\\Revue\\2026-02'] }
  ]);
  // Déplier, décocher : le résumé le dit au singulier.
  clic(parId(p, 'sec-edudoc-modifier'));
  assert.strictEqual(parId(p, 'sec-edudoc-cases').hidden, false);
  const cases = parId(p, 'sec-edudoc-cases').querySelectorAll('input');
  assert.deepStrictEqual(cases.map((c) => c.checked), [true, true, false]);
  cases[0].checked = false;
  cases[0].dispatchEvent({ type: 'change' });
  assert.strictEqual(parId(p, 'sec-edudoc-resume').textContent, f('secResumeChoisisUn', ['2026-02']));
  clic(parId(p, 'sec-edudoc-plus'));
  assert.strictEqual(posts(p, MSG.LANCEUR_OJS_CHARGER).pop().depuisAnnee, 2025);
});

test('secrétariat : avancement sur la ligne, avis du contrat et « Afficher le fichier », détails ouverts en cas d’échec', () => {
  const p = page();
  p.envoyer(charger());
  clic(parId(p, 'onglet-secretariat'));
  ojsRecus(p);
  const ligne = tous(p, '[data-tache="newsletter"]')[0];
  const barre = ligne.querySelectorAll('progress')[0];
  p.envoyer({ type: MSG.LANCEUR_DEBUT, commande: 'newsletter' });
  assert.strictEqual(barre.hidden, false);
  assert.strictEqual(parId(p, 'sec-newsletter').hidden, true);
  assert.strictEqual(parId(p, 'sec-metadonnees').disabled, true);
  p.envoyer({ type: MSG.LANCEUR_LIGNE, commande: 'newsletter', ligne: { t: 'etape', texte: 'Lecture…' } });
  p.envoyer({ type: MSG.LANCEUR_LIGNE, commande: 'newsletter', ligne: { t: 'progres', fait: 3, total: 6 } });
  p.envoyer({ type: MSG.LANCEUR_LIGNE, commande: 'newsletter', ligne: { t: 'fichier', chemin: 'C:\\E\\auteurs.csv' } });
  assert.strictEqual(barre.getAttribute('value'), '3');
  clic(parId(p, 'sec-newsletter-interrompre'));
  assert.deepStrictEqual(posts(p, MSG.LANCEUR_INTERROMPRE), [{ type: MSG.LANCEUR_INTERROMPRE, commande: 'newsletter' }]);
  p.envoyer({ type: MSG.LANCEUR_FIN, commande: 'newsletter', ok: true, texte: '1 fichier produit.', dossier: 'C:\\E' });
  const issue = ligne.querySelectorAll('.lanceur-issue')[0];
  assert.strictEqual(issue.textContent, TXT.secReussiNewsletter + ' 1 fichier produit.' + TXT.secAfficherUn);
  assert.strictEqual(barre.hidden, true);
  const details = ligne.querySelectorAll('details')[0];
  assert.notStrictEqual(details.open, true);
  assert.ok(details.textContent.includes('Lecture…'));
  clic(parId(p, 'sec-newsletter-afficher'));
  assert.deepStrictEqual(posts(p, MSG.LANCEUR_AFFICHER), [{ type: MSG.LANCEUR_AFFICHER, chemin: 'C:\\E\\auteurs.csv' }]);
  // L'échec : le texte du contrat, et les détails dépliés d'eux-mêmes.
  p.envoyer({ type: MSG.LANCEUR_DEBUT, commande: 'metadonnees' });
  p.envoyer({ type: MSG.LANCEUR_FIN, commande: 'metadonnees', ok: false, texte: 'Le site ne répond pas.' });
  const echec = tous(p, '[data-tache="metadonnees"]')[0];
  assert.strictEqual(echec.querySelectorAll('details')[0].open, true);
  assert.ok(echec.textContent.includes(f('secEchec', ['Le site ne répond pas.'])));
  // Edudoc réussi : ses numéros entrent dans l'historique, plus rien n'est à exporter.
  clic(parId(p, 'sec-edudoc'));
  p.envoyer({ type: MSG.LANCEUR_DEBUT, commande: 'edudoc' });
  p.envoyer({ type: MSG.LANCEUR_FIN, commande: 'edudoc', ok: true, texte: '', date: '01.10.2026' });
  assert.strictEqual(parId(p, 'sec-edudoc-resume').textContent, TXT.secToutExporte);
});

test('log : le journal le plus récent s’ouvre de lui-même, son verdict écrit en toutes lettres ; signaler en une phrase', () => {
  const p = page();
  p.envoyer(charger());
  assert.deepStrictEqual(posts(p, MSG.LANCEUR_JOURNAL_LIRE), []);
  clic(parId(p, 'onglet-journal'));
  assert.deepStrictEqual(posts(p, MSG.LANCEUR_JOURNAL_LIRE), [{ type: MSG.LANCEUR_JOURNAL_LIRE, rang: 0 }]);
  assert.strictEqual(parId(p, 'jrn-titre').textContent, f('jrnLecture', ['01.10.2026 08:12', TXT.jrnOk]));
  const options = parId(p, 'panneau-journal').querySelectorAll('[role="option"]');
  assert.ok(options[1].textContent.includes(TXT.jrnEchec));
  p.envoyer({ type: MSG.LANCEUR_JOURNAL_TEXTE, rang: 0, texte: 'ligne 1\nligne 2', lignes: 200 });
  assert.strictEqual(parId(p, 'panneau-journal').querySelectorAll('pre')[0].textContent, 'ligne 1\nligne 2');
  p.envoyer({ type: MSG.LANCEUR_JOURNAL_TEXTE, rang: 0, erreur: 'verrouillé' });
  assert.ok(parId(p, 'panneau-journal').textContent.includes(f('jrnIllisible', ['verrouillé'])));
  const boutons = parId(p, 'panneau-journal').querySelectorAll('button').map((b) => b.textContent);
  assert.ok(boutons.indexOf(TXT.jrnSignaler) !== -1);
  clic(parId(p, 'jrn-signaler'));
  parId(p, 'jrn-phrase').value = '  Le PDF sort sans images.  ';
  clic(parId(p, 'jrn-signal-envoyer'));
  assert.deepStrictEqual(posts(p, MSG.LANCEUR_SIGNALER),
    [{ type: MSG.LANCEUR_SIGNALER, phrase: 'Le PDF sort sans images.', rang: 0 }]);
  p.envoyer({ type: MSG.LANCEUR_SIGNALE, issue: 'fait', courriel: true });
  assert.ok(parId(p, 'panneau-journal').textContent.includes(TXT.jrnSignalerFait));
  assert.ok(parId(p, 'panneau-journal').textContent.includes(TXT.jrnCourriel));
});

// Tout texte affiché vient de la table de l'hôte ou des données qu'il envoie : un libellé
// écrit en dur dans la page échapperait à la traduction et au mode « Trad ».
test('lanceur : chaque texte affiché vient de l’hôte', () => {
  const p = page();
  const c = charger();
  p.envoyer(c);
  clic(parId(p, 'onglet-secretariat'));
  ojsRecus(p);
  clic(parId(p, 'sec-edudoc-modifier'));
  p.envoyer({ type: MSG.LANCEUR_DEBUT, commande: 'newsletter' });
  p.envoyer({ type: MSG.LANCEUR_FIN, commande: 'newsletter', ok: true, texte: 'Bilan.', dossier: 'C:\\E' });
  clic(parId(p, 'onglet-nouveau'));
  clic(parId(p, 'onglet-journal'));
  const donnees = ['Bilan.', ' Bilan.'];
  for (const pr of c.produits) {
    donnees.push(pr.libelle);
    for (const x of pr.enCours.concat(pr.archives)) { donnees.push(x.nom, x.titre); }
  }
  for (const n of OJS) { donnees.push(n[2]); }
  for (const j of c.journaux) { donnees.push(j.date); }
  const motifs = Object.values(TXT).map((t) => new RegExp('^' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\\\{\d\\\}/g, '.+') + '$'));
  const textes = [];
  const visiter = (el) => { if (el._texte) { textes.push(el._texte); } el.enfants.forEach(visiter); };
  visiter(p.parId.lanceur);
  assert.ok(textes.length > 60, 'trop peu de textes relevés : ' + textes.length);
  const etrangers = textes.filter((t) => donnees.indexOf(t) === -1 && !motifs.some((m) => m.test(t)));
  assert.deepStrictEqual(etrangers, []);
});

test('lanceur : chaque TXT.x de la page est fourni et lu, et chaque clé existe en fr et en de', () => {
  const js = fs.readFileSync(path.join(COCKPIT, 'media', 'lanceur.js'), 'utf8');
  const lus = new Set([...js.matchAll(/\bTXT\.([A-Za-z0-9_]+)/g)].map((m) => m[1]));
  // Les clés lues par une variable (VERDICTS, ISSUES, remplir, pluriel) se nomment entre apostrophes.
  for (const m of js.matchAll(/'((?:prod|nv|sec|jrn)[A-Z][A-Za-z]+)'/g)) { lus.add(m[1]); }
  const fournis = new Set(Object.keys(TXT));
  for (const cle of lus) {
    const pluriel = fournis.has(cle + 'Un') && fournis.has(cle + 'Plus');
    assert.ok(fournis.has(cle) || pluriel, 'TXT.' + cle + ' lu par la page mais absent de textesLanceur');
  }
  for (const cle of fournis) {
    const base = cle.replace(/(Un|Plus)$/, '');
    assert.ok(lus.has(cle) || lus.has(base), 'TXT.' + cle + ' fourni mais jamais lu par la page');
  }
  const src = fs.readFileSync(TEXTES, 'utf8');
  const debut = src.indexOf('function textesLanceur');
  assert.notStrictEqual(debut, -1, 'textesLanceur a quitté lib/lanceur-page.js');
  const bloc = src.slice(debut, src.indexOf('\n}', debut));
  const cles = [...bloc.matchAll(/T\('([^']+)'\)/g)].map((m) => m[1]);
  assert.strictEqual(cles.length, Object.keys(TXT).length);
  for (const c of cles) {
    assert.ok(c.startsWith('lanceur.'), c);
    assert.ok(c in TEXTES_COCKPIT.fr, 'clé sans texte français : ' + c);
    assert.ok(c in TEXTES_COCKPIT.de, 'clé sans texte allemand : ' + c);
  }
  // Et aucune clé lanceur.* orpheline dans lib/i18n.js : chacune va à la page, ou sert à l'hôte.
  const hote = fs.readFileSync(path.join(COCKPIT, 'lib', 'lanceur-hote.js'), 'utf8');
  const clesHote = [...hote.matchAll(/'(lanceur\.[^']+)'/g)].map((m) => m[1]);
  for (const c of clesHote) { assert.ok(c in TEXTES_COCKPIT.de, 'clé de l’hôte sans texte allemand : ' + c); }
  const orphelines = Object.keys(TEXTES_COCKPIT.fr).filter((k) => k.startsWith('lanceur.')
    && cles.indexOf(k) === -1 && clesHote.indexOf(k) === -1);
  assert.deepStrictEqual(orphelines, []);
});

test('lanceur : la feuille de style ne porte aucune couleur en dur', () => {
  const css = fs.readFileSync(path.join(COCKPIT, 'media', 'lanceur.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.deepStrictEqual(css.match(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|(?<![-\w])(?:white|black)(?![-\w])/g) || [], []);
});
