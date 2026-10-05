// Les résumés générés (lib/resumes.js) et le client Mistral (lib/mistral.js) : la garde de
// fidélité sur les nombres, la requête qui ne lit que la proposition, la relance, le magasin
// _Resumes et sa péremption. Le client parle à un faux serveur local, jamais à l'API réelle.
//
//   node --test test/js/resumes.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const COCKPIT = path.join(__dirname, '..', '..', 'vscodium-extension', 'szh-cockpit');
const resumes = require(path.join(COCKPIT, 'lib', 'resumes.js'));
const mistral = require(path.join(COCKPIT, 'lib', 'mistral.js'));
const pr = require(path.join(COCKPIT, 'lib', 'propositions.js'));
const kirby = require(path.join(COCKPIT, 'lib', 'kirby-contenu.js'));
const FIXTURE = path.join(__dirname, 'fixtures', 'resume-exemple.json');

const TRAVAIL = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-resumes-'));
process.on('exit', () => { try { fs.rmSync(TRAVAIL, { recursive: true, force: true }); } catch (e) { /* débris */ } });

const LONG = 'Le projet étudie la lecture chez 120 élèves de 5 cantons, entre 2020 et 2024. '.repeat(25);
function recherche(id, descriptif) {
  return { format: 'pronto-proposition/1', cle: 'recherche:hepvd:' + id, moissonneur: 'recherche', type: 'recherche',
    langue: 'fr', recolte: '2026-10-04T10:00:00Z', lien_source: 'https://exemple.ch/' + id,
    valeurs: { title: 'Lire ensemble', institutions: 'HEP Exemple', debut: '2024', fin: '2026', descriptif: descriptif },
    doutes: [], brut: {} };
}
function intervention(corps, id, texte) {
  const p = { format: 'pronto-proposition/1', cle: 'parlement:openparldata:' + corps + ':' + id, moissonneur: 'parlement',
    type: 'intervention', langue: 'fr', recolte: '2026-10-04T10:00:00Z', lien_source: 'https://exemple.ch/' + id,
    valeurs: { title: 'Écoles inclusives', canton: corps === 'CHE' ? 'CH' : 'BE', categorie: 'motion', numero: 'M 12', date: '2026-03-04' },
    doutes: [], brut: {} };
  if (texte !== undefined) { p.texte_depose = texte; }
  return p;
}

// ---- La garde de fidélité ---------------------------------------------------------------------

test('garde : un nombre se compare entier — « 20 » n’est pas dans « 2020 »', () => {
  assert.deepStrictEqual(resumes.nombresHorsSource('Seuls 20 % des élèves lisent.', 'Une étude menée en 2020.'), ['20']);
  assert.deepStrictEqual(resumes.nombresHorsSource('En 2020, une étude.', 'Une étude menée en 2020.'), []);
  assert.deepStrictEqual(resumes.nombresHorsSource('2020 et 202', 'en 2020'), ['202']);
});

test('garde : milliers, décimales et dates se reconnaissent sous leurs formes suisses', () => {
  assert.deepStrictEqual(resumes.nombresHorsSource('745 000 francs, 1,5 poste', 'CHF 745\'000 pour 1.5 EPT'), []);
  assert.deepStrictEqual(resumes.nombresHorsSource('le 4 mars 2026', 'déposée le 04.03.2026'), []);
  assert.deepStrictEqual(resumes.nombresHorsSource('25 %', '25%'), []);
  // Une source anglaise ou allemande sépare les milliers par une virgule ou un point.
  assert.deepStrictEqual(resumes.nombresHorsSource('745 000 personnes, 1 244 112 menacées', '745,000 people and 1,244,112 at risk'), []);
  assert.deepStrictEqual(resumes.nombresHorsSource('745 000 Personen', '745.000 Personen'), []);
  assert.deepStrictEqual(resumes.nombresHorsSource('745 Personen', '745,000 people'), [], 'une partie d’un millier reste admise');
  assert.deepStrictEqual(resumes.nombresHorsSource('31 élèves, 31 classes', 'trois classes'), ['31'], 'un nombre absent se dit une fois');
});

test('garde : les doutes d’un résumé — nombre absent, longueur hors plage, source coupée', () => {
  const req = resumes.construireRequete(recherche('a', LONG), 'fr');
  const court = 'Le projet étudie la lecture chez 20 élèves.';
  assert.deepStrictEqual(resumes.doutesDe(court, req), [
    { code: 'nombre-hors-source', detail: '20' }, { code: 'longueur-hors-plage', detail: String(court.length) }]);
  const juste = ('Le projet étudie la lecture chez 120 élèves de 5 cantons entre 2020 et 2024. ').repeat(10).trim();
  assert.deepStrictEqual(resumes.doutesDe(juste, req), []);
  const enorme = resumes.construireRequete(intervention('BE', '1', 'x'.repeat(25000)), 'fr');
  assert.deepStrictEqual(resumes.doutesDe('Une motion.', enorme).map((d) => d.code), ['longueur-hors-plage', 'source-tronquee']);
});

// ---- La source et la requête ---------------------------------------------------------------------

test('source : un descriptif de recherche se raccourcit au-delà de la borne haute, pas en deçà', () => {
  const P = resumes.prompts();
  assert.strictEqual(P.version, 'v6');
  assert.strictEqual(resumes.sourceDe(recherche('a', 'x'.repeat(P.types.recherche.max))), null);
  const s = resumes.sourceDe(recherche('a', 'x'.repeat(P.types.recherche.max + 1)));
  assert.deepStrictEqual([s.mode, s.tronquee, s.texte.length], ['raccourcir', false, P.types.recherche.max + 1]);
});

test('source : une intervention n’a de résumé que si son lot porte le texte déposé, plafonné', () => {
  assert.strictEqual(resumes.sourceDe(intervention('BE', '1')), null, 'sans texte_depose, rien à créer');
  assert.strictEqual(resumes.sourceDe(intervention('BE', '1', '   ')), null);
  const s = resumes.sourceDe(intervention('BE', '1', 'Le Grand Conseil demande…'));
  assert.deepStrictEqual([s.mode, s.tronquee], ['creer', false]);
  const t = resumes.sourceDe(intervention('BE', '1', 'y'.repeat(30000)));
  assert.deepStrictEqual([t.tronquee, t.texte.length], [true, resumes.prompts().plafond_source]);
});

test('source : un texte déposé qui finit par « […] » a été coupé par le moissonneur, d’où le doute source-tronquee', () => {
  const coupe = 'Le Grand Conseil demande un plan pour l’école inclusive. […]';
  const s = resumes.sourceDe(intervention('BE', '1', coupe + '\n'));
  assert.deepStrictEqual([s.tronquee, s.texte], [true, coupe], 'le texte reste entier, il est seulement marqué');
  const req = resumes.construireRequete(intervention('BE', '1', coupe), 'fr');
  assert.deepStrictEqual(resumes.doutesDe('Une motion.', req).filter((d) => d.code === 'source-tronquee'),
    [{ code: 'source-tronquee', detail: String(coupe.length) }]);
  // « […] » au milieu, ou un descriptif de recherche qui en finit : rien n'a été coupé par le moissonneur.
  assert.strictEqual(resumes.sourceDe(intervention('BE', '1', 'Il cite « […] » puis conclut.')).tronquee, false);
  const P = resumes.prompts();
  const d = 'x'.repeat(P.types.recherche.max) + ' […]';
  assert.strictEqual(resumes.sourceDe(recherche('a', d)).tronquee, false);
});

test('requête : le prompt de la langue cible, la consigne du type, la fiche, et rien d’autre que la proposition', () => {
  const p = recherche('a', LONG);
  const req = resumes.construireRequete(p, 'de');
  assert.strictEqual(req.messages.length, 2);
  assert.ok(req.messages[0].content.startsWith('Du verfasst'), 'le système allemand pour la Zeitschrift');
  assert.ok(req.messages[0].content.indexOf('Vier bis sechs Sätze') !== -1, '{mots} remplacé');
  assert.ok(req.messages[0].content.indexOf('{mots}') === -1);
  assert.ok(req.messages[0].content.endsWith(resumes.prompts().types.recherche.consigne.de));
  const u = req.messages[1].content;
  assert.ok(u.indexOf(LONG.trim()) !== -1, 'la source est le descriptif');
  assert.ok(u.indexOf('"institutions":"HEP Exemple"') !== -1, 'la fiche voyage en JSON');
  assert.ok(u.indexOf(p.lien_source) === -1, 'le lien de la source ne part pas');
  assert.strictEqual(resumes.construireRequete(recherche('b', 'court'), 'fr'), null);
});

test('requête : l’exécutif d’une intervention vient du corps de sa cle ; une commune n’en a pas', () => {
  assert.strictEqual(resumes.ficheDe(intervention('BE', '1', 't'), 'fr', resumes.prompts()).executif, 'le Conseil-exécutif');
  assert.strictEqual(resumes.ficheDe(intervention('CHE', '1', 't'), 'de', resumes.prompts()).executif, 'der Bundesrat');
  assert.strictEqual(resumes.ficheDe(intervention('5192', '1', 't'), 'fr', resumes.prompts()).executif, undefined);
  assert.strictEqual(resumes.ficheDe(intervention('BE', '1', 't'), 'fr', resumes.prompts()).instrument, 'Motion');
});

test('prompts : versionnés, deux langues, une plage et une consigne par type', () => {
  const P = resumes.prompts();
  for (const l of ['fr', 'de']) {
    assert.ok(P.systeme[l] && P.utilisateur[l] && P.relance[l], 'variante ' + l);
    for (const t of ['recherche', 'intervention']) { assert.ok(P.types[t].mots[l] && P.types[t].consigne[l]); }
  }
  assert.deepStrictEqual([P.types.recherche.min, P.types.recherche.max, P.types.recherche.cible], [700, 1000, 850]);
  assert.deepStrictEqual([P.types.intervention.min, P.types.intervention.max, P.types.intervention.cible], [400, 700, 550]);
  assert.strictEqual(P.modele, 'ministral-14b-2512');
});

// ---- Le client Mistral contre un faux serveur ----------------------------------------------------

const CLE_ESSAI = 'cle-essai-mistral-0f9e8d7c6b5a';
// reponses : une file de { statut, entetes?, corps? } ; chaque requête reçue est notée.
async function fauxServeur(reponses) {
  const recues = [];
  const serveur = http.createServer((req, rep) => {
    let corps = '';
    req.on('data', (m) => { corps += m; });
    req.on('end', () => {
      recues.push({ methode: req.method, url: req.url, auth: req.headers.authorization, corps: corps ? JSON.parse(corps) : null });
      const r = reponses.length > 1 ? reponses.shift() : reponses[0];
      rep.writeHead(r.statut, Object.assign({ 'Content-Type': 'application/json' }, r.entetes || {}));
      rep.end(r.corps === undefined ? '{}' : (typeof r.corps === 'string' ? r.corps : JSON.stringify(r.corps)));
    });
  });
  await new Promise((r) => serveur.listen(0, '127.0.0.1', r));
  return { base: 'http://127.0.0.1:' + serveur.address().port, recues: recues, fermer: () => new Promise((r) => serveur.close(r)) };
}
function reponseChat(texte, jetons) { return { statut: 200, corps: { choices: [{ message: { content: texte } }], usage: { total_tokens: jetons || 100 } } }; }
async function erreurDe(promesse) { try { await promesse; } catch (e) { return e; } return null; }

test('client : chat poste au bon point d’entrée, avec la clé en en-tête seulement', async () => {
  const s = await fauxServeur([reponseChat('Un résumé.', 1234)]);
  try {
    const c = mistral.creerClient({ cle: CLE_ESSAI, base: s.base });
    const r = await c.chat({ model: 'ministral-14b-2512', messages: [{ role: 'user', content: 'x' }] });
    assert.deepStrictEqual(r, { texte: 'Un résumé.', jetons: 1234 });
    assert.strictEqual(s.recues[0].methode, 'POST');
    assert.strictEqual(s.recues[0].url, '/v1/chat/completions');
    assert.strictEqual(s.recues[0].auth, 'Bearer ' + CLE_ESSAI);
    assert.strictEqual(s.recues[0].corps.model, 'ministral-14b-2512');
  } finally { await s.fermer(); }
});

test('client : un 429 attend (Retry-After) et réessaie ; au-delà de la limite, erreur « quota »', async () => {
  const attentes = [];
  const attendre = (ms) => { attentes.push(ms); return Promise.resolve(); };
  let s = await fauxServeur([{ statut: 429, entetes: { 'Retry-After': '3' } }, { statut: 429 }, reponseChat('Enfin.')]);
  try {
    const r = await mistral.creerClient({ cle: CLE_ESSAI, base: s.base, attendre }).chat({ model: 'm', messages: [] });
    assert.strictEqual(r.texte, 'Enfin.');
    assert.deepStrictEqual(attentes, [3000, 4000], 'Retry-After, puis 2 s × 2^1');
    assert.strictEqual(s.recues.length, 3);
  } finally { await s.fermer(); }
  s = await fauxServeur([{ statut: 429 }]);
  try {
    const e = await erreurDe(mistral.creerClient({ cle: CLE_ESSAI, base: s.base, attendre, essais: 3 }).chat({ model: 'm', messages: [] }));
    assert.strictEqual(e.code, 'quota');
    assert.strictEqual(s.recues.length, 3, 'trois essais, pas un de plus');
    assert.ok(String(e.message).indexOf(CLE_ESSAI) === -1 && String(e.stack).indexOf(CLE_ESSAI) === -1, 'la clé dans l’erreur');
  } finally { await s.fermer(); }
});

test('client : un 429 à limite zéro ne s’attend pas ; 401 dit la clé refusée ; un corps illisible se dit', async () => {
  const attendre = () => { throw new Error('attente interdite'); };
  let s = await fauxServeur([{ statut: 429, entetes: { 'x-ratelimit-limit-req-minute': '0' } }]);
  try {
    assert.strictEqual((await erreurDe(mistral.creerClient({ cle: CLE_ESSAI, base: s.base, attendre }).chat({}))).code, 'quota-nul');
    assert.strictEqual(s.recues.length, 1);
  } finally { await s.fermer(); }
  s = await fauxServeur([{ statut: 401, corps: { message: 'Unauthorized' } }]);
  try { assert.strictEqual((await erreurDe(mistral.creerClient({ cle: CLE_ESSAI, base: s.base }).modeles())).code, 'cle-refusee'); }
  finally { await s.fermer(); }
  s = await fauxServeur([{ statut: 200, corps: 'pas du json' }]);
  try { assert.strictEqual((await erreurDe(mistral.creerClient({ cle: CLE_ESSAI, base: s.base }).chat({}))).code, 'reponse'); }
  finally { await s.fermer(); }
  s = await fauxServeur([{ statut: 500 }]);
  try {
    const e = await erreurDe(mistral.creerClient({ cle: CLE_ESSAI, base: s.base }).chat({}));
    assert.deepStrictEqual([e.code, e.statut], ['http', 500]);
  } finally { await s.fermer(); }
});

test('client : GET /v1/models rend les identifiants ; http hors de la machine est refusé', async () => {
  const s = await fauxServeur([{ statut: 200, corps: { data: [{ id: 'ministral-8b-2512' }, { id: 'ministral-14b-2512' }] } }]);
  try {
    assert.deepStrictEqual(await mistral.creerClient({ cle: CLE_ESSAI, base: s.base }).modeles(), ['ministral-8b-2512', 'ministral-14b-2512']);
    assert.deepStrictEqual([s.recues[0].methode, s.recues[0].url], ['GET', '/v1/models']);
  } finally { await s.fermer(); }
  const e = await erreurDe(mistral.creerClient({ cle: CLE_ESSAI, base: 'http://api.exemple.ch' }).modeles());
  assert.strictEqual(e.code, 'reseau', 'une clé ne part jamais en clair sur le réseau');
  assert.strictEqual(mistral.BASE, 'https://api.mistral.ai');
});

// ---- La génération --------------------------------------------------------------------------------

function faussesReponses(textes) {
  const appels = [];
  return { appels: appels, chat: async (corps) => { appels.push(corps); return { texte: textes[appels.length - 1], jetons: 1000 }; } };
}

test('résumer : un premier jet trop long est relancé une fois, avec la consigne de longueur', async () => {
  const client = faussesReponses(['a'.repeat(1600), '« Le projet étudie la lecture chez 120 élèves. »\n']);
  const r = await resumes.resumer(recherche('a', LONG), 'fr', { client, modele: 'ministral-14b-2512', poste: 'POSTE-ESSAI' });
  assert.strictEqual(client.appels.length, 2);
  const relance = client.appels[1].messages;
  assert.strictEqual(relance.length, 4);
  assert.strictEqual(relance[2].role, 'assistant');
  assert.strictEqual(relance[3].content, 'Ce descriptif fait 1600 caractères. Raccourcis-le à moins de 1000 caractères, espaces comprises, sans rien ajouter ni changer de sens. Réponds uniquement par le descriptif raccourci.');
  assert.deepStrictEqual([client.appels[0].temperature, client.appels[0].max_tokens, client.appels[0].model], [0.1, 800, 'ministral-14b-2512']);
  assert.strictEqual(r.texte, 'Le projet étudie la lecture chez 120 élèves.', 'une ligne, sans guillemets autour');
  assert.deepStrictEqual([r.format, r.cle, r.langue, r.modele, r.prompt, r.poste, r.relance, r.jetons, r.mode],
    ['pronto-resume/1', 'recherche:hepvd:a', 'fr', 'ministral-14b-2512', 'v6', 'POSTE-ESSAI', true, 2000, 'raccourcir']);
  assert.strictEqual(r.source_empreinte, resumes.empreinteTexte(LONG.trim()));
  assert.deepStrictEqual(r.doutes.map((d) => d.code), ['longueur-hors-plage']);
});

test('résumer : trop de mots sous la borne en caractères relance aussi ; deux relances au plus, puis un doute', async () => {
  const bavard = 'abcd '.repeat(160).trim();
  let client = faussesReponses([bavard, ('Le projet étudie la lecture chez 120 élèves de 5 cantons. ').repeat(13).trim()]);
  let r = await resumes.resumer(recherche('a', LONG), 'fr', { client, modele: 'm' });
  assert.ok(bavard.length <= 1000, 'sous la borne en caractères');
  assert.strictEqual(client.appels.length, 2, '160 mots dépassent les 150 permis en fr');
  assert.strictEqual(r.relance, true);
  assert.deepStrictEqual(r.doutes, []);
  client = faussesReponses(['a'.repeat(1300), 'a'.repeat(1200), 'a'.repeat(1100), 'jamais lu']);
  r = await resumes.resumer(recherche('a', LONG), 'fr', { client, modele: 'm' });
  assert.strictEqual(client.appels.length, 3, 'deux relances, pas une de plus');
  assert.strictEqual(client.appels[2].messages.length, 6, 'la seconde relance garde la première');
  assert.deepStrictEqual(r.doutes.map((d) => d.code), ['longueur-hors-plage']);
});

test('résumé valide : un résumé plus long que la plage actuelle est périmé et se régénère', async () => {
  const p = recherche('a', LONG);
  const court = { format: 'pronto-resume/1', cle: p.cle, langue: 'fr', texte: 'a'.repeat(900),
    source_empreinte: resumes.empreinteTexte(LONG.trim()) };
  assert.strictEqual(resumes.resumeValide(p, 'fr', court), true);
  assert.strictEqual(resumes.resumeValide(p, 'fr', Object.assign({}, court, { texte: 'a'.repeat(1372) })), false);
});

test('résumer : un jet dans la plage part tel quel, sans relance ; un chiffre inventé fait un doute', async () => {
  const texte = ('Le projet étudie la lecture chez 30 élèves de 5 cantons entre 2020 et 2024. ').repeat(10).trim();
  const client = faussesReponses([texte]);
  const r = await resumes.resumer(recherche('a', LONG), 'fr', { client, modele: 'm' });
  assert.strictEqual(client.appels.length, 1);
  assert.strictEqual(r.relance, false);
  assert.deepStrictEqual(r.doutes, [{ code: 'nombre-hors-source', detail: '30' }]);
});

// ---- Le magasin -----------------------------------------------------------------------------------

function racine(nom) {
  const r = path.join(TRAVAIL, nom);
  fs.mkdirSync(path.join(pr.cheminMoissons(r), 'recherche'), { recursive: true });
  return r;
}
function ecrireLot(r, lignes) {
  fs.writeFileSync(path.join(pr.cheminMoissons(r), 'recherche', '2026-10-04-1.jsonl'), lignes.map((l) => JSON.stringify(l)).join('\n') + '\n');
}

test('magasin : un fichier par cle et par langue sous _Resumes, relu tel quel ; une régénération écrase', async () => {
  const r = racine('magasin');
  const p = recherche('a', LONG);
  const res = await resumes.resumer(p, 'fr', { client: faussesReponses(['Premier.']), modele: 'm' });
  resumes.ecrireResume(r, res);
  const chemin = path.join(pr.cheminMoissons(r), '_Resumes', 'fr', pr.empreinteCle(p.cle) + '.json');
  assert.strictEqual(resumes.cheminResume(r, 'fr', p.cle), chemin);
  assert.deepStrictEqual(resumes.lireResume(r, 'fr', p.cle), res);
  resumes.ecrireResume(r, Object.assign({}, res, { texte: 'Second.' }));
  assert.strictEqual(resumes.lireResume(r, 'fr', p.cle).texte, 'Second.');
  assert.deepStrictEqual(fs.readdirSync(path.dirname(chemin)), [path.basename(chemin)], 'aucun temporaire ne reste');
  assert.strictEqual(resumes.lireResume(r, 'de', p.cle), null, 'une autre langue, un autre fichier');
  // _Resumes n'est pas un moissonneur.
  assert.ok(pr.listerPropositions(r, 'fr').avertissements.every((a) => a.moissonneur !== '_Resumes'));
});

test('magasin : la fixture du format se relit, et vaut pour sa source', () => {
  const fx = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  const r = racine('fixture');
  fs.mkdirSync(resumes.cheminResumes(r, 'fr'), { recursive: true });
  fs.copyFileSync(FIXTURE, resumes.cheminResume(r, 'fr', fx.cle));
  assert.deepStrictEqual(resumes.lireResume(r, 'fr', fx.cle), fx);
  const p = recherche(fx.cle.split(':')[2], LONG);
  assert.strictEqual(p.cle, fx.cle);
  assert.strictEqual(resumes.resumeValide(p, 'fr', fx), true);
});

test('péremption : la source a changé, le résumé ne vaut plus et redevient candidat', async () => {
  const r = racine('peremption');
  const a = recherche('a', LONG);
  const b = recherche('b', LONG + ' Encore.');
  const c = recherche('c', 'Assez court.');
  ecrireLot(r, [a, b, c]);
  assert.deepStrictEqual(resumes.candidats(r, 'fr').liste.map((p) => p.cle), [a.cle, b.cle], 'le descriptif court n’est pas candidat');
  for (const p of [a, b]) { resumes.ecrireResume(r, await resumes.resumer(p, 'fr', { client: faussesReponses(['Résumé.']), modele: 'm' })); }
  const c0 = resumes.candidats(r, 'fr');
  assert.deepStrictEqual([c0.liste.length, c0.jetons], [0, 0], 'les résumés valides sont sautés');
  assert.deepStrictEqual([...resumes.resumesValides(r, 'fr', [a, b]).keys()], [a.cle, b.cle]);
  // Le moissonneur relit la source : le descriptif de b change.
  const b2 = Object.assign({}, b, { valeurs: Object.assign({}, b.valeurs, { descriptif: LONG + ' Modifié.' }) });
  fs.writeFileSync(path.join(pr.cheminMoissons(r), 'recherche', '2026-10-05-1.jsonl'), JSON.stringify(b2) + '\n');
  assert.strictEqual(resumes.resumeValide(b2, 'fr', resumes.lireResume(r, 'fr', b.cle)), false);
  assert.deepStrictEqual([...resumes.resumesValides(r, 'fr', [a, b2]).keys()], [a.cle]);
  const c1 = resumes.candidats(r, 'fr');
  assert.deepStrictEqual(c1.liste.map((p) => p.cle), [b.cle]);
  assert.deepStrictEqual(c1.parType, { recherche: 1 });
  assert.ok(c1.jetons > 300, 'une estimation en jetons : ' + c1.jetons);
});

test('candidats : une proposition décidée n’est plus candidate ; un fichier illisible n’est pas un résumé', () => {
  const r = racine('decidees');
  const a = recherche('a', LONG);
  ecrireLot(r, [a]);
  fs.mkdirSync(resumes.cheminResumes(r, 'fr'), { recursive: true });
  fs.writeFileSync(resumes.cheminResume(r, 'fr', a.cle), '{ illisible');
  assert.strictEqual(resumes.lireResume(r, 'fr', a.cle), null);
  assert.strictEqual(resumes.candidats(r, 'fr').liste.length, 1);
  pr.refuserLot(r, 'fr', [a.cle], 'hors-sujet');
  assert.strictEqual(resumes.candidats(r, 'fr').liste.length, 0);
  assert.ok(kirby.languesDuContrat().indexOf('fr') !== -1);
});
