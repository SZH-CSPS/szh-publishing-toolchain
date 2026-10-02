// La page de l'Accueil dans l'éditeur (media/accueil.*), chargée dans le DOM minimal avec les
// libellés que l'hôte lui injecte (lib/accueil-page.js, textesAccueil).
//
//   node --test test/js/accueil-page.test.js
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
const TEXTES = path.join(COCKPIT, 'lib', 'accueil-page.js');
const { textesAccueil, produitParDefaut } = require(TEXTES);

const TXT = textesAccueil();
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
  return ouvrir({ racine: RACINE, page: 'accueil', cssPartage: ['_design.css'], jsPartage: ['_messages.js'], txt: TXT });
}
const parId = (p, id) => p.parId.accueil.querySelector('[id="' + id + '"]');
const tous = (p, sel) => p.parId.accueil.querySelectorAll(sel);
// Les messages viennent du contexte de la page : on les recopie pour les comparer.
const posts = (p, type) => JSON.parse(JSON.stringify(p.messages.filter((m) => m.type === type)));
const clic = (el, mod) => el.dispatchEvent(Object.assign({ type: 'click' }, mod || {}));
const visibles = (p) => tous(p, '[role="tabpanel"]').filter((x) => !x.hidden).map((x) => x.id);
const coche = (p, nom) => tous(p, 'input[name="' + nom + '"]').filter((r) => r.checked).map((r) => r.value);
function ojsRecus(p) {
  for (const n of OJS) {
    p.envoyer({ type: MSG.ACCUEIL_LIGNE, commande: 'numeros-ojs',
      ligne: { t: 'numero', cle: n[0] + '-0' + n[1], libelle: n[2], annee: n[0], numero: n[1] } });
  }
  p.envoyer({ type: MSG.ACCUEIL_FIN, commande: 'numeros-ojs', ok: true, texte: '' });
}

test('accueil : la page se charge, annonce « pret » et pose six onglets étiquetés dans l’ordre', () => {
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

test('accueil : l’onglet Produits est actif au chargement, avant comme après les données', () => {
  const p = page();
  assert.strictEqual(parId(p, 'onglet-produits').getAttribute('aria-selected'), 'true');
  assert.deepStrictEqual(visibles(p), ['panneau-produits']);
  p.envoyer(charger());
  assert.strictEqual(parId(p, 'onglet-produits').getAttribute('aria-selected'), 'true');
  assert.deepStrictEqual(visibles(p), ['panneau-produits']);
  assert.deepStrictEqual(tous(p, '[role="tab"]').map((o) => o.getAttribute('tabindex')), ['0', '-1', '-1', '-1', '-1', '-1']);
});

test('accueil : la page ouvre le produit que l’hôte désigne, sans règle de langue à elle', () => {
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

test('accueil : le produit d’office suit la langue, puis le choix du compte, puis SZH_ONGLET', () => {
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
  assert.deepStrictEqual(posts(p, MSG.ACCUEIL_OUVRIR).map((m) => m.chemin),
    ['C:\\P\\Revue\\2026-01', 'C:\\P\\Revue\\2026-01', 'C:\\P\\Revue\\2026-02']);
  // Les archives sont repliées ; y choisir une entrée retire le choix de la liste en cours.
  const archives = tous(p, '.accueil-archives')[0];
  assert.notStrictEqual(archives.open, true);
  assert.strictEqual(parId(p, 'prod-archives').textContent, f('prodArchives', [1]));
  clic(parId(p, 'archive-0'));
  assert.deepStrictEqual(options.map((o) => o.getAttribute('aria-selected')), ['false', 'false']);
  clic(parId(p, 'prod-ouvrir'));
  assert.strictEqual(posts(p, MSG.ACCUEIL_OUVRIR).pop().chemin, 'C:\\P\\Archive\\2025-04');
  clic(parId(p, 'prod-versions'));
  assert.strictEqual(posts(p, MSG.ACCUEIL_VERSIONS).length, 1);
});

test('produits : un produit vide propose de créer, sans bouton Ouvrir', () => {
  const p = page();
  const vide = charger();
  vide.produits[0].enCours = [];
  vide.produits[0].archives = [];
  p.envoyer(vide);
  assert.ok(p.parId.accueil.textContent.includes(f('prodVide', ['Revue'])));
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
  assert.deepStrictEqual(posts(p, MSG.ACCUEIL_CREER),
    [{ type: MSG.ACCUEIL_CREER, produit: 'revue', annee: 2026, numero: 3, volume: 16, volumeManuel: false }]);
  numero.value = '2';
  numero.dispatchEvent({ type: 'input' });
  assert.strictEqual(creer.disabled, true);
  assert.strictEqual(numero.getAttribute('aria-invalid'), 'true');
  assert.strictEqual(parId(p, 'nv-erreur').textContent, f('nvExiste', ['2026-02', 'Deux']));
  p.envoyer({ type: MSG.ACCUEIL_CREE, ok: false, texte: 'Volume 16, numéro 3 déjà pris.' });
  assert.ok(parId(p, 'panneau-nouveau').textContent.includes(f('nvRefus', ['Volume 16, numéro 3 déjà pris.'])));
});

test('secrétariat : les numéros publiés se chargent seuls, et chaque tâche part en un clic', () => {
  const p = page();
  p.envoyer(charger());
  clic(parId(p, 'onglet-secretariat'));
  // Depuis l'année du dernier numéro exporté : 2026.
  assert.deepStrictEqual(posts(p, MSG.ACCUEIL_OJS_CHARGER), [{ type: MSG.ACCUEIL_OJS_CHARGER, revue: 'revue', depuisAnnee: 2026 }]);
  assert.strictEqual(parId(p, 'sec-edudoc').disabled, true, 'Exporter reste actif pendant le chargement');
  ojsRecus(p);
  assert.strictEqual(parId(p, 'sec-edudoc-resume').textContent, f('secResumeNonExportesPlus', ['2026-02, 2026-03']));
  // Sans historique, les numéros de l'année.
  assert.strictEqual(parId(p, 'sec-caracteres-resume').textContent, f('secResumeAnneePlus', ['2026-01, 2026-02, 2026-03', 2026]));
  clic(parId(p, 'sec-edudoc'));
  clic(parId(p, 'sec-newsletter'));
  assert.deepStrictEqual(posts(p, MSG.ACCUEIL_EXPORTER), [
    { type: MSG.ACCUEIL_EXPORTER, commande: 'edudoc', revue: 'revue', cles: ['2026-02', '2026-03'] },
    { type: MSG.ACCUEIL_EXPORTER, commande: 'newsletter', revue: 'revue', numeros: ['C:\\P\\Revue\\2026-02'] }
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
  assert.strictEqual(posts(p, MSG.ACCUEIL_OJS_CHARGER).pop().depuisAnnee, 2025);
});

test('secrétariat : avancement sur la ligne, avis du contrat et « Afficher le fichier », détails ouverts en cas d’échec', () => {
  const p = page();
  p.envoyer(charger());
  clic(parId(p, 'onglet-secretariat'));
  ojsRecus(p);
  const ligne = tous(p, '[data-tache="newsletter"]')[0];
  const barre = ligne.querySelectorAll('progress')[0];
  p.envoyer({ type: MSG.ACCUEIL_DEBUT, commande: 'newsletter' });
  assert.strictEqual(barre.hidden, false);
  assert.strictEqual(parId(p, 'sec-newsletter').hidden, true);
  assert.strictEqual(parId(p, 'sec-metadonnees').disabled, true);
  p.envoyer({ type: MSG.ACCUEIL_LIGNE, commande: 'newsletter', ligne: { t: 'etape', texte: 'Lecture…' } });
  p.envoyer({ type: MSG.ACCUEIL_LIGNE, commande: 'newsletter', ligne: { t: 'progres', fait: 3, total: 6 } });
  p.envoyer({ type: MSG.ACCUEIL_LIGNE, commande: 'newsletter', ligne: { t: 'fichier', chemin: 'C:\\E\\auteurs.csv' } });
  assert.strictEqual(barre.getAttribute('value'), '3');
  clic(parId(p, 'sec-newsletter-interrompre'));
  assert.deepStrictEqual(posts(p, MSG.ACCUEIL_INTERROMPRE), [{ type: MSG.ACCUEIL_INTERROMPRE, commande: 'newsletter' }]);
  p.envoyer({ type: MSG.ACCUEIL_FIN, commande: 'newsletter', ok: true, texte: '1 fichier produit.', dossier: 'C:\\E' });
  const issue = ligne.querySelectorAll('.accueil-issue')[0];
  assert.strictEqual(issue.textContent, TXT.secReussiNewsletter + ' 1 fichier produit.' + TXT.secAfficherUn);
  assert.strictEqual(barre.hidden, true);
  const details = ligne.querySelectorAll('details')[0];
  assert.notStrictEqual(details.open, true);
  assert.ok(details.textContent.includes('Lecture…'));
  clic(parId(p, 'sec-newsletter-afficher'));
  assert.deepStrictEqual(posts(p, MSG.ACCUEIL_AFFICHER), [{ type: MSG.ACCUEIL_AFFICHER, chemin: 'C:\\E\\auteurs.csv' }]);
  // L'échec : le texte du contrat, et les détails dépliés d'eux-mêmes.
  p.envoyer({ type: MSG.ACCUEIL_DEBUT, commande: 'metadonnees' });
  p.envoyer({ type: MSG.ACCUEIL_FIN, commande: 'metadonnees', ok: false, texte: 'Le site ne répond pas.' });
  const echec = tous(p, '[data-tache="metadonnees"]')[0];
  assert.strictEqual(echec.querySelectorAll('details')[0].open, true);
  assert.ok(echec.textContent.includes(f('secEchec', ['Le site ne répond pas.'])));
  // Edudoc réussi : ses numéros entrent dans l'historique, plus rien n'est à exporter.
  clic(parId(p, 'sec-edudoc'));
  p.envoyer({ type: MSG.ACCUEIL_DEBUT, commande: 'edudoc' });
  p.envoyer({ type: MSG.ACCUEIL_FIN, commande: 'edudoc', ok: true, texte: '', date: '01.10.2026' });
  assert.strictEqual(parId(p, 'sec-edudoc-resume').textContent, TXT.secToutExporte);
});

const etatPp = (autres) => Object.assign({ type: MSG.ACCUEIL_PREPROC_ETAT, produit: 'zeitschrift', format: 'docx',
  dossier: 'C:\\M\\Reçus', depot: true, tailleMax: 50 * 1024 * 1024 }, autres || {});
const deposer = (p, donnees) => tous(p, '.preproc-zone')[0].dispatchEvent({ type: 'drop', preventDefault() {},
  dataTransfer: { getData: (t) => (t === 'text/uri-list' ? donnees.uri || '' : ''), files: donnees.files || [] } });

test('préprocessing : le produit d’office vient de l’hôte, et choisir un manuscrit envoie produit et format', () => {
  const p = page();
  p.envoyer(charger({ produit: 'revue' }));
  clic(parId(p, 'onglet-preproc'));
  assert.deepStrictEqual(visibles(p), ['panneau-preproc']);
  const panneau = parId(p, 'panneau-preproc');
  // Le livre n'a pas de nettoyeur : deux produits seulement, la revue en attendant l'hôte.
  assert.deepStrictEqual(tous(p, 'input[name="produit-pp"]').map((r) => r.value), ['revue', 'zeitschrift']);
  assert.deepStrictEqual(coche(p, 'produit-pp'), ['revue']);
  p.envoyer(etatPp());
  assert.deepStrictEqual(coche(p, 'produit-pp'), ['zeitschrift']);
  // Le choix des autres onglets n'y change rien.
  assert.deepStrictEqual(coche(p, 'produit-prod'), ['revue']);
  assert.ok(panneau.textContent.includes(f('ppDossier', ['C:\\M\\Reçus'])));
  // La sortie se dit dans les exports de Pronto, plus sur le Bureau.
  assert.ok(panneau.textContent.includes(TXT.ppSortie));
  assert.ok(TXT.ppSortie.includes('Exports\\Préprocessing'), TXT.ppSortie);
  assert.doesNotMatch(TXT.ppSortie, /Bureau|Desktop/);
  assert.strictEqual(parId(p, 'pp-options').textContent, f('ppOptions', [TXT.ppFormatDocx]));
  clic(parId(p, 'pp-choisir'));
  const odt = parId(p, 'pp-format-odt');
  odt.checked = true;
  odt.dispatchEvent({ type: 'change' });
  assert.strictEqual(parId(p, 'pp-options').textContent, f('ppOptions', [TXT.ppFormatOdt]));
  const revue = parId(p, 'produit-pp-revue');
  revue.checked = true;
  revue.dispatchEvent({ type: 'change' });
  clic(parId(p, 'pp-choisir'));
  assert.deepStrictEqual(posts(p, MSG.ACCUEIL_PREPROC_CHOISIR), [
    { type: MSG.ACCUEIL_PREPROC_CHOISIR, produit: 'zeitschrift', format: 'docx' },
    { type: MSG.ACCUEIL_PREPROC_CHOISIR, produit: 'revue', format: 'odt' }
  ]);
  // Un compte réglé sur le livre : le nettoyeur garde une revue.
  const pLivre = page();
  pLivre.envoyer(charger({ produit: 'livre' }));
  assert.deepStrictEqual(coche(pLivre, 'produit-pp'), ['revue']);
});

test('préprocessing : un dépôt part avec son adresse ou ses octets, et se refuse hors .docx et .odt ou trop gros', () => {
  const p = page();
  p.envoyer(charger());
  p.envoyer(etatPp({ depot: false }));
  deposer(p, { uri: 'file:///C:/M/a.docx' });
  assert.deepStrictEqual(posts(p, MSG.ACCUEIL_PREPROC_DEPOSER), [], 'dépôt retenu alors que l’hôte ne l’offre pas');
  p.envoyer(etatPp());
  assert.match(TXT.ppDeposer, /Maj/, 'la zone dit de maintenir Maj');
  assert.ok(parId(p, 'panneau-preproc').textContent.includes(TXT.ppDeposer));
  deposer(p, { uri: 'file:///C:/M/a.docx' });
  assert.deepStrictEqual(posts(p, MSG.ACCUEIL_PREPROC_DEPOSER),
    [{ type: MSG.ACCUEIL_PREPROC_DEPOSER, uri: 'file:///C:/M/a.docx', produit: 'zeitschrift', format: 'docx' }]);
  // Un fichier de l'Explorateur n'a pas d'adresse : ses octets partent en base64.
  deposer(p, { files: [{ name: 'Étude.docx', size: 3, _dataUrl: 'data:application/octet-stream;base64,QUJD' }] });
  assert.deepStrictEqual(posts(p, MSG.ACCUEIL_PREPROC_DEPOSER)[1],
    { type: MSG.ACCUEIL_PREPROC_DEPOSER, nomFichier: 'Étude.docx', donneesBase64: 'QUJD', produit: 'zeitschrift', format: 'docx' });
  const avisDepot = tous(p, '.preproc-depot-avis')[0];
  deposer(p, { uri: 'file:///C:/M/a.pdf' });
  assert.strictEqual(avisDepot.textContent, TXT.ppDepotFormat);
  deposer(p, { files: [{ name: 'a.pdf', size: 3, _dataUrl: 'data:,x' }] });
  assert.strictEqual(avisDepot.textContent, TXT.ppDepotFormat);
  deposer(p, { files: [{ name: 'gros.odt', size: 50 * 1024 * 1024 + 1, _dataUrl: 'data:,x' }] });
  assert.strictEqual(avisDepot.textContent, f('ppDepotTaille', [50]));
  assert.strictEqual(posts(p, MSG.ACCUEIL_PREPROC_DEPOSER).length, 2);
});

test('préprocessing : l’avancement compte les étapes, l’issue garde ses alertes et ses liens, l’échec ouvre les détails', () => {
  const p = page();
  p.envoyer(charger());
  p.envoyer(etatPp());
  clic(parId(p, 'onglet-preproc'));
  const repos = tous(p, '.preproc-repos')[0];
  const cours = tous(p, '.preproc-cours')[0];
  p.envoyer({ type: MSG.ACCUEIL_PREPROC_DEBUT, nom: 'a.docx', produit: 'zeitschrift', format: 'docx' });
  assert.strictEqual(repos.hidden, true, 'le bouton principal reste pendant le nettoyage');
  assert.strictEqual(cours.hidden, false);
  assert.ok(cours.textContent.includes(f('ppEnCours', ['a.docx'])));
  assert.ok(cours.textContent.includes(f('ppEnCoursProduit', ['Zeitschrift', TXT.ppFormatDocx])));
  assert.ok(tous(p, 'input[name="produit-pp"]').every((r) => r.disabled));
  p.envoyer({ type: MSG.ACCUEIL_PREPROC_ETAPE, etape: 'lecture' });
  p.envoyer({ type: MSG.ACCUEIL_PREPROC_ETAPE, etape: 'titres' });
  assert.ok(cours.textContent.includes(f('ppEtape', [5, 12, TXT.ppEtapeTitres])));
  assert.strictEqual(cours.querySelectorAll('progress')[0].getAttribute('value'), '4');
  clic(parId(p, 'pp-interrompre'));
  assert.deepStrictEqual(posts(p, MSG.ACCUEIL_PREPROC_INTERROMPRE), [{ type: MSG.ACCUEIL_PREPROC_INTERROMPRE }]);
  p.envoyer({ type: MSG.ACCUEIL_PREPROC_FIN, issue: 'alertes', document: 'a-nettoye.docx', rapport: true,
    rapportOuvert: true, alertes: { erreurs: 1, avertissements: 0, suggestions: 2 } });
  assert.strictEqual(repos.hidden, false);
  assert.strictEqual(cours.hidden, true);
  const issue = tous(p, '.preproc-issue')[0];
  assert.ok(issue.textContent.includes(f('ppReussi', ['a-nettoye.docx'])));
  assert.ok(issue.textContent.includes(TXT.ppReussiAlertes));
  assert.ok(issue.textContent.includes(TXT.ppRapportOuvert));
  assert.deepStrictEqual(issue.querySelectorAll('.szh-pastille').map((x) => x.textContent),
    [f('ppErreursUn', [1]), f('ppSuggestionsPlus', [2])]);
  const details = tous(p, '.preproc-details')[0];
  assert.strictEqual(details.hidden, false);
  assert.notStrictEqual(details.open, true);
  assert.deepStrictEqual(details.querySelectorAll('li').map((l) => l.className),
    ['preproc-ligne preproc-ligne--fait', 'preproc-ligne preproc-ligne--fait']);
  clic(parId(p, 'pp-ouvrir-rapport'));
  clic(parId(p, 'pp-ouvrir-dossier'));
  assert.deepStrictEqual(posts(p, MSG.ACCUEIL_PREPROC_OUVRIR).map((m) => m.quoi), ['rapport', 'dossier']);
  // L'échec : la phrase de l'hôte, l'étape en échec, les détails dépliés, aucun lien.
  p.envoyer({ type: MSG.ACCUEIL_PREPROC_DEBUT, nom: 'b.docx' });
  assert.strictEqual(details.hidden, true, 'les détails d’avant restent pendant le nettoyage suivant');
  p.envoyer({ type: MSG.ACCUEIL_PREPROC_ETAPE, etape: 'lecture' });
  p.envoyer({ type: MSG.ACCUEIL_PREPROC_FIN, issue: 'echec', texte: 'Réessayez.' });
  assert.ok(issue.textContent.includes(TXT.ppEchec) && issue.textContent.includes('Réessayez.'));
  assert.strictEqual(details.open, true);
  assert.deepStrictEqual(details.querySelectorAll('li').map((l) => l.className), ['preproc-ligne preproc-ligne--echec']);
  assert.strictEqual(parId(p, 'pp-ouvrir-rapport'), null);
});

test('log : le journal le plus récent s’ouvre de lui-même, son verdict écrit en toutes lettres ; signaler en une phrase', () => {
  const p = page();
  p.envoyer(charger());
  assert.deepStrictEqual(posts(p, MSG.ACCUEIL_JOURNAL_LIRE), []);
  clic(parId(p, 'onglet-journal'));
  assert.deepStrictEqual(posts(p, MSG.ACCUEIL_JOURNAL_LIRE), [{ type: MSG.ACCUEIL_JOURNAL_LIRE, rang: 0 }]);
  assert.strictEqual(parId(p, 'jrn-titre').textContent, f('jrnLecture', ['01.10.2026 08:12', TXT.jrnOk]));
  const options = parId(p, 'panneau-journal').querySelectorAll('[role="option"]');
  assert.ok(options[1].textContent.includes(TXT.jrnEchec));
  p.envoyer({ type: MSG.ACCUEIL_JOURNAL_TEXTE, rang: 0, texte: 'ligne 1\nligne 2', lignes: 200 });
  assert.strictEqual(parId(p, 'panneau-journal').querySelectorAll('pre')[0].textContent, 'ligne 1\nligne 2');
  p.envoyer({ type: MSG.ACCUEIL_JOURNAL_TEXTE, rang: 0, erreur: 'verrouillé' });
  assert.ok(parId(p, 'panneau-journal').textContent.includes(f('jrnIllisible', ['verrouillé'])));
  const boutons = parId(p, 'panneau-journal').querySelectorAll('button').map((b) => b.textContent);
  assert.ok(boutons.indexOf(TXT.jrnSignaler) !== -1);
  clic(parId(p, 'jrn-signaler'));
  parId(p, 'jrn-phrase').value = '  Le PDF sort sans images.  ';
  clic(parId(p, 'jrn-signal-envoyer'));
  assert.deepStrictEqual(posts(p, MSG.ACCUEIL_SIGNALER),
    [{ type: MSG.ACCUEIL_SIGNALER, phrase: 'Le PDF sort sans images.', rang: 0 }]);
  p.envoyer({ type: MSG.ACCUEIL_SIGNALE, issue: 'fait', courriel: true });
  assert.ok(parId(p, 'panneau-journal').textContent.includes(TXT.jrnSignalerFait));
  assert.ok(parId(p, 'panneau-journal').textContent.includes(TXT.jrnCourriel));
});

// Tout texte affiché vient de la table de l'hôte ou des données qu'il envoie : un libellé
// écrit en dur dans la page échapperait à la traduction et au mode « Trad ».
test('accueil : chaque texte affiché vient de l’hôte', () => {
  const p = page();
  const c = charger();
  p.envoyer(c);
  clic(parId(p, 'onglet-secretariat'));
  ojsRecus(p);
  clic(parId(p, 'sec-edudoc-modifier'));
  p.envoyer({ type: MSG.ACCUEIL_DEBUT, commande: 'newsletter' });
  p.envoyer({ type: MSG.ACCUEIL_FIN, commande: 'newsletter', ok: true, texte: 'Bilan.', dossier: 'C:\\E' });
  clic(parId(p, 'onglet-nouveau'));
  clic(parId(p, 'onglet-journal'));
  p.envoyer(etatPp());
  p.envoyer({ type: MSG.ACCUEIL_PREPROC_DEBUT, nom: 'a.docx' });
  p.envoyer({ type: MSG.ACCUEIL_PREPROC_ETAPE, etape: 'lecture' });
  p.envoyer({ type: MSG.ACCUEIL_PREPROC_FIN, issue: 'alertes', document: 'a-nettoye.docx', rapport: true,
    rapportOuvert: true, alertes: { erreurs: 2, avertissements: 1, suggestions: 0 } });
  // Les noms des deux langues s'écrivent chacun dans sa langue, et les tailles sont des nombres de pixels.
  const donnees = ['Bilan.', ' Bilan.', 'Français', 'Deutsch', '14 px', '16 px', '18 px',
    ' ' + TXT.ppReussiAlertes, ' ' + TXT.ppRapportOuvert];
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
  visiter(p.parId.accueil);
  assert.ok(textes.length > 60, 'trop peu de textes relevés : ' + textes.length);
  const etrangers = textes.filter((t) => donnees.indexOf(t) === -1 && !motifs.some((m) => m.test(t)));
  assert.deepStrictEqual(etrangers, []);
});

test('accueil : chaque TXT.x de la page est fourni et lu, et chaque clé existe en fr et en de', () => {
  const js = fs.readFileSync(path.join(COCKPIT, 'media', 'accueil.js'), 'utf8');
  const lus = new Set([...js.matchAll(/\bTXT\.([A-Za-z0-9_]+)/g)].map((m) => m[1]));
  // Les clés lues par une variable (VERDICTS, ISSUES, remplir, pluriel) se nomment entre apostrophes.
  for (const m of js.matchAll(/'((?:prod|nv|pp|sec|jrn|rg)[A-Z][A-Za-z]+)'/g)) { lus.add(m[1]); }
  const fournis = new Set(Object.keys(TXT));
  for (const cle of lus) {
    const pluriel = fournis.has(cle + 'Un') && fournis.has(cle + 'Plus');
    assert.ok(fournis.has(cle) || pluriel, 'TXT.' + cle + ' lu par la page mais absent de textesAccueil');
  }
  for (const cle of fournis) {
    const base = cle.replace(/(Un|Plus)$/, '');
    assert.ok(lus.has(cle) || lus.has(base), 'TXT.' + cle + ' fourni mais jamais lu par la page');
  }
  const src = fs.readFileSync(TEXTES, 'utf8');
  const debut = src.indexOf('function textesAccueil');
  assert.notStrictEqual(debut, -1, 'textesAccueil a quitté lib/accueil-page.js');
  const bloc = src.slice(debut, src.indexOf('\n}', debut));
  const cles = [...bloc.matchAll(/\bTP?\('([^']+)'/g)].map((m) => m[1]);
  assert.strictEqual(cles.length, Object.keys(TXT).length);
  // Les textes des réglages d'avant la fusion gardent leurs clés (regl., ojs., biblio., art.taches.).
  const reutilisees = /^(accueil|regl|ojs|biblio|art.taches)./;
  for (const c of cles) {
    assert.ok(reutilisees.test(c), c);
    assert.ok(c in TEXTES_COCKPIT.fr, 'clé sans texte français : ' + c);
    assert.ok(c in TEXTES_COCKPIT.de, 'clé sans texte allemand : ' + c);
  }
  // Et aucune clé accueil.* orpheline dans lib/i18n.js : chacune va à la page, ou sert à l'hôte
  // (l'Accueil, ses Paramètres et son Préprocessing).
  const hote = ['accueil-hote.js', 'accueil-reglages-hote.js', 'accueil-preproc-hote.js']
    .map((f) => fs.readFileSync(path.join(COCKPIT, 'lib', f), 'utf8')).join('\n');
  const clesHote = [...hote.matchAll(/'(accueil\.[^']+)'/g)].map((m) => m[1]);
  for (const c of clesHote) { assert.ok(c in TEXTES_COCKPIT.de, 'clé de l’hôte sans texte allemand : ' + c); }
  // Une variante « .livre » (TP) se lit avec sa clé de base.
  const orphelines = Object.keys(TEXTES_COCKPIT.fr).filter((k) => k.startsWith('accueil.')
    && cles.indexOf(k) === -1 && clesHote.indexOf(k) === -1 && cles.indexOf(k.replace(/\.livre$/, '')) === -1);
  assert.deepStrictEqual(orphelines, []);
});

test('accueil : la feuille de style ne porte aucune couleur en dur', () => {
  const css = fs.readFileSync(path.join(COCKPIT, 'media', 'accueil.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.deepStrictEqual(css.match(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|(?<![-\w])(?:white|black)(?![-\w])/g) || [], []);
});
