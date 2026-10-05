// Le résumé généré dans la vue Propositions (documentation-hote.js, media/_propositions.js) : il
// remplit le descriptif par défaut, marqué « à relire », avec ses doutes ; « Voir l'original »
// rend celui de la source ; l'acceptation écrit ce qui est affiché, par kirby-contenu.js. Un
// résumé dont la source a changé ne s'affiche plus.
//
//   node --test test/js/documentation-resumes.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { revueDEssai, activerHote } = require('./hote-factice');
const { ouvrir, libellesHote } = require('./dom-minimal');

const RACINE = path.resolve(__dirname, '..', '..');
const COCKPIT = path.join(RACINE, 'vscodium-extension', 'szh-cockpit');
const { MSG } = require(path.join(COCKPIT, 'lib', 'messages.js'));
const kirby = require(path.join(COCKPIT, 'lib', 'kirby-contenu.js'));
const pr = require(path.join(COCKPIT, 'lib', 'propositions.js'));
const resumes = require(path.join(COCKPIT, 'lib', 'resumes.js'));
const yaml = require(path.join(COCKPIT, 'lib', 'yaml.js'));

const REVUE = revueDEssai();
const HOTE = activerHote(REVUE);
const doc = require(path.join(COCKPIT, 'lib', 'documentation-hote.js'));
const RACINE_ARBRE = kirby.racineArbre(REVUE);

const ORIGINAL = 'Le projet étudie la lecture partagée en classe ordinaire auprès de 48 élèves. '.repeat(24).trim();
const GENERE = 'Le projet étudie la lecture partagée auprès de 48 élèves, en classe ordinaire, et en décrit les pratiques.';
function recherche(id, descriptif) {
  return { format: 'pronto-proposition/1', cle: 'recherche:hepvd:' + id, moissonneur: 'recherche', type: 'recherche',
    langue: 'fr', recolte: '2026-10-04T10:00:00Z', lien_source: 'https://exemple.ch/' + id,
    valeurs: { title: 'Projet ' + id, institutions: 'HEP Exemple', debut: '2024', fin: '2026', descriptif: descriptif },
    doutes: [], brut: {}, pertinence: { verdict: 'retenu', raison: 'r' }, doublon: null };
}
const A = recherche('a', ORIGINAL);
const B = recherche('b', ORIGINAL + ' Autre.');
function resume(p, texte, doutes) {
  return { format: 'pronto-resume/1', cle: p.cle, langue: 'fr', texte: texte, modele: 'ministral-14b-2512', prompt: 'v6',
    date: '2026-10-05T09:30:00Z', poste: 'POSTE-ESSAI', source_empreinte: resumes.empreinteTexte(p.valeurs.descriptif),
    source_car: p.valeurs.descriptif.length, mode: 'raccourcir', relance: false, jetons: 1800, doutes: doutes || [] };
}
function repartir() {
  const m = pr.cheminMoissons(RACINE_ARBRE);
  fs.rmSync(m, { recursive: true, force: true });
  fs.mkdirSync(path.join(m, 'recherche'), { recursive: true });
  fs.writeFileSync(path.join(m, 'recherche', '2026-10-04-1.jsonl'), [A, B].map((l) => JSON.stringify(l)).join('\n') + '\n');
  fs.writeFileSync(path.join(m, 'recherche', 'etat.json'), JSON.stringify({ format: 'pronto-etat/1', moissonneur: 'recherche',
    contrat: 1, derniere_moisson: '2026-10-04T10:00:00Z', propositions_ecrites: 2, lot: '', sources_en_echec: [], interrompu: null }));
  resumes.ecrireResume(RACINE_ARBRE, resume(A, GENERE, [{ code: 'nombre-hors-source', detail: '20' }]));
}

async function panneau() {
  await HOTE.executer('szh.ouvrirActualite', 'propositions');
  const p = HOTE.panneaux.filter((x) => x.type === 'szhDocumentation').pop();
  await p._recepteur({ type: MSG.PRET });
  return p;
}
async function donnees(p) {
  p.messages.length = 0;
  await p._recepteur({ type: MSG.PROP_CHARGER });
  return p.messages.filter((m) => m.type === MSG.PROP_DONNEES).pop();
}
function ficheAcceptee(cle) {
  const d = pr.lireDecision(RACINE_ARBRE, cle);
  assert.ok(d && d.decision === 'accepte', 'pas acceptée : ' + cle);
  const f = kirby.listerOrphelines(RACINE_ARBRE, 'fr').concat(kirby.listerFichesNumero(RACINE_ARBRE, 'fr', yaml.idNumero(REVUE)))
    .find((x) => x.uuid === d.fiche);
  assert.ok(f, 'fiche introuvable');
  return f;
}

// ---- L'hôte -------------------------------------------------------------------------------------

test('hôte : PROP_DONNEES porte le résumé valide, avec sa provenance et ses doutes', async () => {
  repartir();
  const d = await donnees(await panneau());
  const a = d.propositions.find((x) => x.cle === A.cle);
  assert.deepStrictEqual(a.resume, { texte: GENERE, modele: 'ministral-14b-2512', prompt: 'v6', date: '2026-10-05T09:30:00Z',
    mode: 'raccourcir', doutes: [{ code: 'nombre-hors-source', detail: '20' }] });
  assert.strictEqual(a.valeurs.descriptif, ORIGINAL, 'l’original reste dans les valeurs');
  assert.strictEqual(d.propositions.find((x) => x.cle === B.cle).resume, null);
});

test('hôte : un résumé dont la source a changé n’est plus servi', async () => {
  repartir();
  resumes.ecrireResume(RACINE_ARBRE, Object.assign(resume(B, 'Ancien résumé.'), { source_empreinte: resumes.empreinteTexte('autre source') }));
  const d = await donnees(await panneau());
  assert.strictEqual(d.propositions.find((x) => x.cle === B.cle).resume, null);
});

test('hôte : accepter en lot écrit le résumé généré ; `original` garde le descriptif de la source', async () => {
  repartir();
  const p = await panneau();
  await p._recepteur({ type: MSG.PROP_ACCEPTER, dansNumero: false, demandes: [{ cle: A.cle }] });
  assert.strictEqual(ficheAcceptee(A.cle).valeurs.descriptif, GENERE);
  repartir();
  await p._recepteur({ type: MSG.PROP_ACCEPTER, dansNumero: false, demandes: [{ cle: A.cle, original: true }] });
  assert.strictEqual(ficheAcceptee(A.cle).valeurs.descriptif, ORIGINAL);
});

// ---- La page --------------------------------------------------------------------------------------

function pageDocumentation() {
  const txt = libellesHote(RACINE, ['textesDocumentation']);
  const page = ouvrir({ racine: RACINE, page: 'documentation', cssPartage: ['_design.css', '_propositions.css'],
    jsPartage: ['_messages.js', '_fiche-doc.js', '_propositions.js'], txt: txt });
  page.envoyer({ type: MSG.CHARGER, slug: 'documentation', accent: 'bleuacier', i18n: txt,
    typesConfig: doc._libelles.typesRessourceConfig('fr'), typesRubrique: [], rubriques: [], ressources: [], orphelines: [],
    vueInitiale: { onglet: 'propositions' } });
  return { page: page, txt: txt };
}
async function relayer(page, p) {
  const envoyes = JSON.parse(JSON.stringify(page.messages.splice(0)));
  for (const m of envoyes) {
    if (!/^prop/.test(m.type)) { continue; }
    p.messages.length = 0;
    await p._recepteur(m);
    for (const r of p.messages) {
      if (r.type === MSG.PROP_DONNEES || r.type === MSG.CHARGER || r.type === MSG.PROP_VERIFIE) { page.envoyer(JSON.parse(JSON.stringify(r))); }
    }
  }
  return envoyes;
}
async function vue() {
  const p = await panneau();
  const { page, txt } = pageDocumentation();
  await relayer(page, p);
  return { page: page, txt: txt, p: p, panel: page.parId['panel-propositions'] };
}
function ligne(panel, c) { return panel.querySelectorAll('tr').find((tr) => tr.dataset.cle === c); }
function champDescriptif(panel) {
  const conteneur = panel.querySelectorAll('.prop-champ').find((x) => x.dataset.champ === 'descriptif');
  assert.ok(conteneur, 'champ descriptif absent');
  return { conteneur: conteneur, saisie: conteneur.querySelector('textarea') };
}

test('page : le détail montre le résumé généré par défaut, marqué « à relire », avec ses doutes', async () => {
  repartir();
  const { panel, txt } = await vue();
  ligne(panel, A.cle).querySelector('.prop-titre').click();
  const { conteneur, saisie } = champDescriptif(panel);
  assert.strictEqual(saisie.value, GENERE);
  const bloc = conteneur.querySelector('.prop-resume');
  assert.strictEqual(bloc.querySelector('.prop-resume-mention').textContent, txt.propResumeGenere);
  assert.strictEqual(txt.propResumeGenere.replace(/ /g, ' '), 'Résumé généré (Mistral), à relire');
  assert.strictEqual(bloc.querySelector('.prop-resume-meta').textContent, 'ministral-14b-2512, prompt v6, le 05.10.2026');
  assert.deepStrictEqual(bloc.querySelectorAll('.prop-resume-doute').map((x) => x.textContent), [txt.propResumeNombre.replace('{0}', '20')]);
  assert.strictEqual(bloc.querySelector('.prop-resume-bascule').textContent, txt.propResumeVoirOriginal);
  // Sans résumé, aucun bloc.
  ligne(panel, B.cle).querySelector('.prop-titre').click();
  assert.strictEqual(champDescriptif(panel).conteneur.querySelector('.prop-resume'), null);
  assert.strictEqual(champDescriptif(panel).saisie.value, B.valeurs.descriptif);
});

test('page : « Voir l’original » rend le descriptif de la source, et l’acceptation l’écrit', async () => {
  repartir();
  const { page, panel, txt, p } = await vue();
  ligne(panel, A.cle).querySelector('.prop-titre').click();
  const { conteneur, saisie } = champDescriptif(panel);
  const bascule = conteneur.querySelector('.prop-resume-bascule');
  bascule.click();
  assert.strictEqual(saisie.value, ORIGINAL);
  assert.strictEqual(conteneur.querySelector('.prop-resume-mention').textContent, txt.propResumeOriginal);
  assert.strictEqual(bascule.textContent, txt.propResumeVoirGenere);
  assert.strictEqual(bascule.getAttribute('aria-pressed'), 'true');
  assert.ok(conteneur.querySelectorAll('.prop-resume-meta').every((x) => x.hidden), 'la provenance du généré se cache');
  assert.ok(conteneur.querySelectorAll('.prop-resume-doutes').every((x) => x.hidden));
  bascule.click();
  assert.strictEqual(saisie.value, GENERE, 'la bascule revient au résumé généré');
  bascule.click();
  await relayer(page, p);
  panel.querySelector('.prop-detail .prop-detail-garder').click();
  const envoi = page.messages.find((m) => m.type === MSG.PROP_ACCEPTER);
  assert.strictEqual(envoi.demandes[0].valeurs.descriptif, ORIGINAL, 'depuis le détail, la saisie affichée part');
  await relayer(page, p);
  assert.strictEqual(ficheAcceptee(A.cle).valeurs.descriptif, ORIGINAL);
});

test('page : accepter depuis le détail sans basculer écrit le résumé généré', async () => {
  repartir();
  const { page, panel, p } = await vue();
  ligne(panel, A.cle).querySelector('.prop-titre').click();
  panel.querySelector('.prop-detail .prop-detail-garder').click();
  await relayer(page, p);
  assert.strictEqual(ficheAcceptee(A.cle).valeurs.descriptif, GENERE);
});

test('page : en lot, détail fermé, une proposition basculée sur l’original part avec `original`', async () => {
  repartir();
  const { page, panel, p } = await vue();
  ligne(panel, A.cle).querySelector('.prop-titre').click();
  champDescriptif(panel).conteneur.querySelector('.prop-resume-bascule').click();
  panel.querySelector('.prop-detail .prop-fermer').click();
  assert.strictEqual(panel.querySelector('.prop-detail'), null);
  page.messages.length = 0;
  ligne(panel, A.cle).querySelector('.prop-bouton-garder').click();
  const envoi = page.messages.find((m) => m.type === MSG.PROP_ACCEPTER);
  assert.ok(envoi, 'aucune acceptation partie');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(envoi.demandes)), [{ cle: A.cle, aussi: false, original: true }]);
  await relayer(page, p);
  assert.strictEqual(ficheAcceptee(A.cle).valeurs.descriptif, ORIGINAL);
});

test('page : en lot, sans bascule, la sous-ligne montre le résumé généré et l’acceptation l’écrit', async () => {
  repartir();
  const { page, panel, p } = await vue();
  assert.ok(ligne(panel, A.cle).textContent.indexOf(GENERE.slice(0, 40)) !== -1, 'la sous-ligne lit le descriptif affiché');
  ligne(panel, A.cle).querySelector('.prop-bouton-garder').click();
  const envoi = page.messages.find((m) => m.type === MSG.PROP_ACCEPTER);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(envoi.demandes)), [{ cle: A.cle, aussi: false }]);
  await relayer(page, p);
  assert.strictEqual(ficheAcceptee(A.cle).valeurs.descriptif, GENERE);
});
