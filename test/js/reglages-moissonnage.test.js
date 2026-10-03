// Paramètres de l'Accueil, section Moissonnage (media/accueil.js) : un curseur par revue qui
// règle la finesse de toute la rédaction, la table des dix crans de chaque langue, l'explication
// des catégories. Les données sont synthétiques, au format de docs/FORMAT-PROPOSITIONS.md.
//
//   node --test test/js/reglages-moissonnage.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { ouvrirReglages, MSG } = require('./page-reglages');

const SEUILS = [0, 5, 9, 12, 12, 18, 29, 38, 56, 78];
const CRANS = SEUILS.map((s, i) => ({ cran: i + 1, seuil: s, par_mois: 81 - i * 8, rappel: i === 9 ? null : 73 - i * 6,
  rappel_sur: 79, identique_au_cran_precedent: i > 0 && SEUILS[i - 1] === s }));
const TEXTES = {
  titre: 'Moissonnage', astuce: 'Astuce.', passe: 'Dernière passe le {0}.', passeInconnue: 'Inconnue.',
  finesse: 'Finesse – {0}, {1}', regle: 'Réglé par {0} le {1}.', regleAucun: 'Pas réglé.',
  lecture: 'Cran {0} : environ {1} par mois, retrouve {2} des {3}', lectureSans: 'Cran {0} : environ {1} par mois',
  identique: ' (identique au cran {0})', valeur: '{0} sur 10, environ {1} par mois', crans: 'Les dix crans – {0}',
  cransAide: 'Du {0} au {1}, calculés le {2}.', cransCommun: 'Déciles communs.', colCran: 'Cran', colSeuil: 'Note dès',
  colMois: 'Par mois', colRappel: 'Rappel (sur {0})', colActif: 'Réglage actif', egal: '= cran {0}', actif: 'réglage actif',
  optimiste: 'Optimiste.', categories: 'Catégories', categoriesAide: 'Aide.', sansCrans: 'Pas de crans.',
  large: 'Large', strict: 'Strict', revues: { fr: 'Revue (fr)', de: 'Zeitschrift (de)' },
  jetons: { titre: 'terme dans le titre', 'signal-faible': 'signal faible' }
};
function moissonnage() {
  return {
    textes: TEXTES, langue: 'fr',
    moissonneurs: [
      { id: 'isbn', libelle: 'Livres (ISBN)', derniere: '2026-09-30T06:05:00Z', types: [{ type: 'livre', libelle: 'Livres' }],
        langues: { fr: { crans: null, source: '', reglages: {} }, de: { crans: null, source: '', reglages: {} } },
        calculeLe: '', fenetre: null, categories: [] },
      { id: 'parlement', libelle: 'Interventions (OpenParlData)', derniere: '2026-10-01T05:12:00Z',
        types: [{ type: 'intervention', libelle: 'Interventions parlementaires' }],
        langues: {
          fr: { crans: CRANS, source: 'langue', reglages: { intervention: { cran: 6, par: 'Claire Exemple', le: '2026-10-01' } } },
          de: { crans: CRANS, source: 'commun', reglages: {} }
        },
        calculeLe: '2026-10-01', fenetre: { du: '2026-04-01', au: '2026-09-30' }, categories: ['titre', 'signal-faible'] }
    ]
  };
}
function ouvrir() {
  const p = ouvrirReglages();
  p.envoyer({ type: MSG.VALEURS, valeurs: {}, poste: { produit: '', produitAuto: 'revue' },
    services: { shlinkUrl: '', shlinkCle: false, ojsCle: false }, moissonnage: moissonnage() });
  return p;
}
function rangeeFinesse(p, cle) { return p.tous('.accueil-tache').find((r) => r.dataset.finesse === cle); }
function rangeeCrans(p, cle) { return p.tous('.accueil-tache').find((r) => r.dataset.crans === cle); }

test('réglages : sans moissonneur, pas de section Moissonnage', () => {
  const p = ouvrirReglages();
  p.envoyer({ type: MSG.VALEURS, valeurs: {}, poste: { produit: '', produitAuto: 'revue' },
    services: { shlinkUrl: '', shlinkCle: false, ojsCle: false } });
  assert.strictEqual(p.parId('regl-moissonnage').hidden, true);
  assert.strictEqual(p.parId('regl-moissonnage').enfants.length, 0);
});

test('réglages : une section par moissonneur ; sans crans, une ligne qui le dit', () => {
  const p = ouvrir();
  const s = p.parId('regl-moissonnage');
  assert.strictEqual(s.hidden, false);
  assert.deepStrictEqual(s.querySelectorAll('.accueil-moiss-nom').map((h) => h.textContent), ['Livres (ISBN)', 'Interventions (OpenParlData)']);
  assert.deepStrictEqual(s.querySelectorAll('.accueil-moiss-sans').map((x) => x.textContent), ['Pas de crans.']);
  assert.ok(s.textContent.indexOf('Dernière passe le 01.10.2026.') !== -1);
});

test('réglages : un curseur par revue, avec « réglé par… le… » ; il écrit le réglage partagé', () => {
  const p = ouvrir();
  const fr = rangeeFinesse(p, 'parlement:fr:intervention');
  const de = rangeeFinesse(p, 'parlement:de:intervention');
  assert.ok(fr && de, 'un curseur par revue');
  assert.strictEqual(fr.querySelector('.accueil-tache-nom').textContent, 'Finesse – Revue (fr), Interventions parlementaires');
  assert.strictEqual(fr.querySelector('.accueil-tache-aide').textContent, 'Réglé par Claire Exemple le 01.10.2026.');
  assert.strictEqual(de.querySelector('.accueil-tache-aide').textContent, 'Pas réglé.');
  const c = fr.querySelector('.accueil-finesse-curseur');
  assert.deepStrictEqual([c.type, c.min, c.max, c.value], ['range', '1', '10', '6']);
  assert.strictEqual(c.getAttribute('aria-valuetext'), '6 sur 10, environ 41 par mois');
  assert.strictEqual(fr.querySelector('.accueil-finesse-lecture').textContent, 'Cran 6 : environ 41 par mois, retrouve 43 des 79');
  c.value = '5';
  c.dispatchEvent({ type: 'input' });
  assert.strictEqual(fr.querySelector('.accueil-finesse-lecture').textContent,
    'Cran 5 : environ 49 par mois, retrouve 49 des 79 (identique au cran 4)');
  c.dispatchEvent({ type: 'change' });
  assert.deepStrictEqual(p.postes(MSG.ACCUEIL_FINESSE),
    [{ type: MSG.ACCUEIL_FINESSE, moissonneur: 'parlement', typeFiche: 'intervention', langue: 'fr', cran: 5 }]);
  assert.strictEqual(de.querySelector('.accueil-finesse-curseur').value, '1', 'sans réglage : cran 1');
});

test('réglages : la table des dix crans de chaque langue — note dès, par mois, rappel, « = cran k », le réglage actif en texte', () => {
  const p = ouvrir();
  const r = rangeeCrans(p, 'parlement:fr');
  assert.ok(r && rangeeCrans(p, 'parlement:de'), 'une table par langue');
  assert.strictEqual(r.querySelector('.accueil-tache-nom').textContent, 'Les dix crans – Revue (fr)');
  const lignes = r.querySelector('tbody').querySelectorAll('tr');
  assert.strictEqual(lignes.length, 10);
  const cellules = (tr) => tr.querySelectorAll('td').map((td) => td.textContent);
  assert.deepStrictEqual(cellules(lignes[4]), ['= cran 4', '49', '49', '']);
  assert.deepStrictEqual(cellules(lignes[5]), ['18', '41', '43', '◀ réglage actif']);
  assert.deepStrictEqual(cellules(lignes[9]), ['78', '9', '–', '']);
  assert.strictEqual(lignes[0].querySelector('th').textContent, '1 · Large');
  assert.strictEqual(lignes[9].querySelector('th').textContent, '10 · Strict');
  assert.ok(lignes[5].classList.contains('accueil-finesse-actif'));
  const t = r.querySelector('thead').querySelectorAll('th').map((x) => x.textContent);
  assert.deepStrictEqual(t, ['Cran', 'Note dès', 'Par mois', 'Rappel (sur 79)', 'Réglage actif']);
  assert.strictEqual(r.querySelector('.accueil-tache-aide').textContent, 'Du 01.04.2026 au 30.09.2026, calculés le 01.10.2026.');
  // Sans réglage, le cran 1 est l'actif.
  assert.strictEqual(cellules(rangeeCrans(p, 'parlement:de').querySelector('tbody').querySelectorAll('tr')[0])[3], '◀ réglage actif');
});

// Une langue sans fiches de référence (rappel_sur = 0) n'a pas de rappel mesuré : jamais « 0 des 0 ».
test('réglages : une langue sans fiches de référence dit « non mesuré », jamais « 0 des 0 »', () => {
  const m = moissonnage();
  m.moissonneurs[1].langues.fr.crans = CRANS.map((c) => Object.assign({}, c, { rappel: 0, rappel_sur: 0 }));
  const p = ouvrirReglages();
  p.envoyer({ type: MSG.VALEURS, valeurs: {}, poste: { produit: '', produitAuto: 'revue' },
    services: { shlinkUrl: '', shlinkCle: false, ojsCle: false }, moissonnage: m });
  const r = rangeeCrans(p, 'parlement:fr');
  const lignes = r.querySelector('tbody').querySelectorAll('tr');
  assert.strictEqual(lignes[0].querySelectorAll('td')[2].textContent, '–');
  assert.strictEqual(r.querySelector('thead').querySelectorAll('th')[3].textContent, 'Rappel (sur –)');
  assert.ok(rangeeFinesse(p, 'parlement:fr:intervention').textContent.indexOf('des 0') === -1);
});

test('réglages : crans_source dit quand une langue prend les déciles communs ; les catégories s’expliquent', () => {
  const p = ouvrir();
  assert.strictEqual(rangeeCrans(p, 'parlement:fr').querySelector('.accueil-moiss-commun'), null);
  assert.strictEqual(rangeeCrans(p, 'parlement:de').querySelector('.accueil-moiss-commun').textContent, 'Déciles communs.');
  const ol = p.un('.accueil-moiss-categories');
  assert.deepStrictEqual(ol.querySelectorAll('li').map((li) => li.textContent), ['terme dans le titre', 'signal faible']);
});

// ---- Les demandes sur le lexique ------------------------------------------------------------

const TEXTES_DEMANDES = Object.assign({}, TEXTES, {
  demandes: 'Demandes', demandesAide: 'Aide demandes.', demandesAucune: 'Aucune demande.', ouvrirTermes: 'Ouvrir Termes',
  ouvrirTermesTip: 'Dans le numéro ouvert.', par: 'demandé par {0} le {1}', effet: 'rappel {0} → {1} · {2} → {3} par mois',
  effetIncomplet: 'effet complet après la prochaine moisson', mesure: 'mesuré le {0}', perdues: 'Fiches perdues ({0})',
  perteUn: 'Perte d’une fiche.', pertePlus: 'Perte de {0} fiches.', confirmee: 'Confirmé par {0} le {1}.',
  quandMeme: 'Appliquer quand même', quandMemeTip: 'Vous avez vu les fiches.', quandMemeAutre: 'Seul {0} peut le faire.',
  retirer: 'Retirer', retirerLabel: 'Retirer : {0} {1}', retirerTipAttente: 'tip attente', retirerTipAppliquee: 'tip appliquée',
  retirerTipClose: 'tip close', retirerTipRetrait: 'tip retrait', retiree: 'Retirée : {0} {1}.', retraitDemande: 'Retrait de {0}.',
  confirmeeAvis: 'Confirmée : {0}.', annuler: 'Annuler', annulee: 'Retrait annulé.', refus: 'Refus ({0}).',
  ignoree: 'Ignorée : {0} ({1}).', illisible: 'Illisible : {0}.', terme: '« {0} »',
  sens: { ajout: 'ajouter', exclusion: 'exclure', retrait: 'défaire' },
  st: { 'en-attente': 'en attente', applique: 'appliquée', 'applique-partiel': 'appliquée en partie', 'refuse-perte': 'refusée : perte',
    'refuse-bruit': 'refusée : bruit', doublon: 'doublon', 'a-confirmer': 'à confirmer', 'retrait-en-attente': 'retrait en attente' },
  expl: { 'en-attente': 'Sera mesurée.', 'applique-partiel': 'Base locale seulement.', 'refuse-bruit': 'Trop de bruit.',
    doublon: 'Déjà au lexique.', 'a-confirmer': 'À confirmer.', 'retrait-en-attente': 'Retrait mesuré à la prochaine passe.' }
});
const effet = (complet) => ({ rappel_avant: 73, rappel_apres: 70, par_mois_avant: 81, par_mois_apres: 69, complet: complet });
function demande(id, statut, extra) {
  return Object.assign({ id: id, terme: 'terme ' + id, langue: 'fr', sens: 'exclusion', par: 'Claire Exemple',
    le: '2026-10-02T09:15:00Z', statut: statut, effet: null, fiches_perdues: [], mesure_le: '' }, extra || {});
}
function moissonnageDemandes(extra) {
  const m = moissonnage();
  m.textes = TEXTES_DEMANDES;
  m.moi = 'Claire Exemple';
  const p = m.moissonneurs[1];
  p.aTermes = true;
  p.avertissements = [{ code: 'demande-ignoree', moissonneur: 'parlement', fichier: 'x y.json', raison: 'id non sûr' }];
  p.demandes = [
    demande('attente', 'en-attente'),
    demande('appliquee', 'applique', { effet: effet(true), mesure_le: '2026-09-15' }),
    demande('partielle', 'applique-partiel', { sens: 'ajout', effet: effet(false), mesure_le: '2026-10-01' }),
    demande('perte', 'refuse-perte', { fiches_perdues: ['Intégration au cycle 3', 'Transition vers le secondaire'], mesure_le: '2026-09-15' }),
    demande('perte-autre', 'refuse-perte', { par: 'Jonas Beispiel', fiches_perdues: ['Participation des familles'] }),
    demande('confirmee', 'refuse-perte', { fiches_perdues: ['X'], confirme_par: 'Claire Exemple', confirme_le: '2026-10-03T08:00:00Z' }),
    demande('bruit', 'refuse-bruit', { sens: 'ajout' }),
    demande('doublon', 'doublon', { sens: 'ajout' }),
    demande('a-confirmer', 'a-confirmer', { fiches_perdues: ['Y'] }),
    demande('retrait', 'retrait-en-attente')
  ];
  return Object.assign(m, extra || {});
}
function ouvrirDemandes(extra) {
  const p = ouvrirReglages();
  p.envoyer({ type: MSG.VALEURS, valeurs: {}, poste: { produit: '', produitAuto: 'revue' },
    services: { shlinkUrl: '', shlinkCle: false, ojsCle: false }, moissonnage: moissonnageDemandes(extra) });
  return p;
}
function ligneDemande(p, id) { return p.tous('.accueil-demande').find((li) => li.dataset.id === id); }

test('réglages : sans demande ni termes, pas de bloc des demandes', () => {
  const p = ouvrir();
  assert.strictEqual(p.tous('.accueil-tache').filter((r) => r.dataset.demandes !== undefined).length, 0);
});

test('réglages : un moissonneur à termes sans demande montre le bloc, vide, avec le lien vers Termes', () => {
  const p = ouvrirDemandes();
  const m = moissonnageDemandes();
  m.moissonneurs[1].demandes = [];
  m.moissonneurs[1].avertissements = [];
  p.envoyer({ type: MSG.VALEURS, valeurs: {}, poste: { produit: '', produitAuto: 'revue' },
    services: { shlinkUrl: '', shlinkCle: false, ojsCle: false }, moissonnage: m });
  const bloc = p.tous('.accueil-tache').find((r) => r.dataset.demandes === 'parlement');
  assert.ok(bloc, 'bloc absent');
  assert.strictEqual(bloc.querySelector('.accueil-demandes-aucune').textContent, 'Aucune demande.');
  bloc.querySelector('.accueil-moiss-termes').click();
  assert.deepStrictEqual(p.postes(MSG.ACCUEIL_OUVRIR_TERMES), [{ type: MSG.ACCUEIL_OUVRIR_TERMES, moissonneur: 'parlement' }]);
});

test('réglages : chaque demande dit son statut en texte et en badge, qui et quand, et l’effet mesuré', () => {
  const p = ouvrirDemandes();
  const statut = (id) => ligneDemande(p, id).querySelector('.accueil-demande-statut');
  for (const [id, texte] of [['attente', 'en attente'], ['appliquee', 'appliquée'], ['partielle', 'appliquée en partie'],
    ['perte', 'refusée : perte'], ['bruit', 'refusée : bruit'], ['doublon', 'doublon'], ['a-confirmer', 'à confirmer'],
    ['retrait', 'retrait en attente']]) {
    assert.strictEqual(statut(id).textContent, texte, id);
    assert.ok(statut(id).classList.contains('szh-pastille'), id);
  }
  assert.ok(statut('appliquee').classList.contains('szh-pastille--ok'));
  assert.ok(statut('perte').classList.contains('szh-pastille--attention'));
  const l = ligneDemande(p, 'appliquee');
  assert.strictEqual(l.querySelector('.accueil-demande-terme').textContent, 'exclure « terme appliquee » (fr)');
  assert.strictEqual(l.querySelector('.accueil-demande-par').textContent, 'demandé par Claire Exemple le 02.10.2026');
  assert.strictEqual(l.querySelector('.accueil-demande-effet').textContent, 'rappel 73 → 70 · 81 → 69 par mois · mesuré le 15.09.2026');
  assert.strictEqual(ligneDemande(p, 'partielle').querySelector('.accueil-demande-effet').textContent,
    'rappel 73 → 70 · 81 → 69 par mois · effet complet après la prochaine moisson · mesuré le 01.10.2026');
  assert.ok(ligneDemande(p, 'attente').textContent.indexOf('Sera mesurée.') !== -1);
  assert.ok(ligneDemande(p, 'bruit').textContent.indexOf('Trop de bruit.') !== -1);
  assert.ok(p.un('[data-demandes="parlement"]').textContent.indexOf('Ignorée : x y.json (id non sûr).') !== -1, 'la demande ignorée remonte');
});

test('réglages : une demande refusée pour perte déplie ses fiches perdues ; « Appliquer quand même » au demandeur seul', () => {
  const p = ouvrirDemandes();
  const perte = ligneDemande(p, 'perte');
  const det = perte.querySelector('details');
  assert.strictEqual(det.open, true);
  assert.strictEqual(det.querySelector('summary').textContent, 'Fiches perdues (2)');
  assert.deepStrictEqual(det.querySelectorAll('li').map((x) => x.textContent), ['Intégration au cycle 3', 'Transition vers le secondaire']);
  assert.ok(perte.textContent.indexOf('Perte de 2 fiches.') !== -1);
  const b = perte.querySelector('.accueil-demande-quand-meme');
  assert.strictEqual(b.disabled, false);
  assert.strictEqual(b.title, 'Vous avez vu les fiches.');
  b.click();
  assert.deepStrictEqual(p.postes(MSG.ACCUEIL_DEMANDE_CONFIRMER), [{ type: MSG.ACCUEIL_DEMANDE_CONFIRMER, moissonneur: 'parlement', id: 'perte' }]);
  // Une autre personne voit pourquoi, en infobulle et en texte.
  const autre = ligneDemande(p, 'perte-autre');
  const ba = autre.querySelector('.accueil-demande-quand-meme');
  assert.strictEqual(ba.disabled, true);
  assert.strictEqual(ba.title, 'Seul Jonas Beispiel peut le faire.');
  assert.strictEqual(autre.querySelector('.accueil-demande-qui').textContent, 'Seul Jonas Beispiel peut le faire.');
  // Une fois confirmée, tout le monde voit qui et quand.
  const conf = ligneDemande(p, 'confirmee');
  assert.strictEqual(conf.querySelector('.accueil-demande-quand-meme'), null);
  assert.ok(conf.textContent.indexOf('Confirmé par Claire Exemple le 03.10.2026.') !== -1);
  assert.ok(ligneDemande(p, 'a-confirmer').querySelector('.accueil-demande-quand-meme'), 'à confirmer : le geste aussi');
});

test('réglages : « Retirer » part à l’hôte, dit ce qu’il fera, et un bandeau Annuler suit le geste', () => {
  const p = ouvrirDemandes();
  const retirer = (id) => ligneDemande(p, id).querySelector('.accueil-demande-retirer');
  assert.strictEqual(retirer('attente').title, 'tip attente');
  assert.strictEqual(retirer('appliquee').title, 'tip appliquée');
  assert.strictEqual(retirer('partielle').title, 'tip appliquée');
  assert.strictEqual(retirer('bruit').title, 'tip close');
  assert.strictEqual(retirer('retrait').disabled, true);
  assert.strictEqual(retirer('retrait').title, 'tip retrait');
  assert.strictEqual(retirer('attente').getAttribute('aria-label'), 'Retirer : exclure terme attente');
  retirer('appliquee').click();
  assert.deepStrictEqual(p.postes(MSG.ACCUEIL_DEMANDE_RETIRER), [{ type: MSG.ACCUEIL_DEMANDE_RETIRER, moissonneur: 'parlement', id: 'appliquee' }]);
  // La réponse de l'hôte : le bandeau, et Annuler.
  p.envoyer({ type: MSG.VALEURS, valeurs: {}, poste: { produit: '', produitAuto: 'revue' },
    services: { shlinkUrl: '', shlinkCle: false, ojsCle: false },
    moissonnage: moissonnageDemandes({ demandeGeste: { geste: 'retiree', ok: true, action: 'retrait', terme: 'terme appliquee', sens: 'exclusion' } }) });
  let bandeau = p.un('.accueil-moiss-bandeau');
  assert.ok(bandeau, 'bandeau absent');
  assert.ok(bandeau.textContent.indexOf('Retrait de terme appliquee.') !== -1);
  bandeau.querySelector('.accueil-moiss-annuler').click();
  assert.deepStrictEqual(p.postes(MSG.ACCUEIL_DEMANDE_ANNULER), [{ type: MSG.ACCUEIL_DEMANDE_ANNULER }]);
  assert.strictEqual(p.un('.accueil-moiss-bandeau'), null, 'Annuler retire le bandeau');
  // Une demande en attente retirée : le texte le dit.
  p.envoyer({ type: MSG.VALEURS, valeurs: {}, poste: { produit: '', produitAuto: 'revue' },
    services: { shlinkUrl: '', shlinkCle: false, ojsCle: false },
    moissonnage: moissonnageDemandes({ demandeGeste: { geste: 'retiree', ok: true, action: 'supprimee', terme: 'terme attente', sens: 'exclusion' } }) });
  bandeau = p.un('.accueil-moiss-bandeau');
  assert.ok(bandeau.textContent.indexOf('Retirée : exclure terme attente.') !== -1);
  // Le bandeau survit à un rendu sans geste.
  p.envoyer({ type: MSG.VALEURS, valeurs: {}, poste: { produit: '', produitAuto: 'revue' },
    services: { shlinkUrl: '', shlinkCle: false, ojsCle: false }, moissonnage: moissonnageDemandes() });
  assert.ok(p.un('.accueil-moiss-bandeau'));
  // Un refus de l'hôte se dit, sans Annuler.
  p.envoyer({ type: MSG.VALEURS, valeurs: {}, poste: { produit: '', produitAuto: 'revue' },
    services: { shlinkUrl: '', shlinkCle: false, ojsCle: false },
    moissonnage: moissonnageDemandes({ demandeGeste: { geste: 'confirmee', ok: false, raison: 'pas-le-demandeur', terme: '' } }) });
  bandeau = p.un('.accueil-moiss-bandeau');
  assert.ok(bandeau.textContent.indexOf('Refus (pas-le-demandeur).') !== -1);
  assert.strictEqual(bandeau.querySelector('.accueil-moiss-annuler'), null);
});
