'use strict';

// Synthèse des compteurs d'usage : lit les fichiers de `_Systeme\compteurs` (lib/compteurs.js
// en fixe le format) et produit une page HTML autonome et un CSV de synthèse, pour repérer les
// problèmes récurrents du nettoyeur de manuscrit et du parser d'import Word. Les fichiers ne
// portent ni nom, ni titre, ni heure : la synthèse porte sur le logiciel, pas sur les personnes.
//
// Lancé par VSCodium-en-Node (ELECTRON_RUN_AS_NODE=1), comme outils/rendre-gabarit.js :
//   node compteurs-synthese.js [--dossier D] [--depuis AAAA-MM-JJ] [--jusqua AAAA-MM-JJ]
//        [--contexte prod|dev|tous] [--sortie D] [--purger]
// Sortie : un JSON sur STDOUT, rien d'autre sur ce flux :
//   { "ok": true, "html": "<chemin>", "csv": "<chemin>", ... }
//   { "ok": false, "erreur": "<message>" }
// Code de sortie : 0 si ok, 1 sinon.
//
// `--purger` supprime les fichiers de plus de 24 mois (date lue dans le nom du fichier) ; sans
// ce drapeau, rien n'est supprimé. Un fichier illisible, un en-tête différent ou une mesure
// inconnue ne font pas échouer la synthèse : ils sont comptés et signalés.

const fs = require('fs');
const path = require('path');
const { compiler } = require(path.join(__dirname, '..', 'lib', 'gabarits.js'));
const compteurs = require(path.join(__dirname, '..', 'lib', 'compteurs.js'));

const MOIS_CONSERVATION = 24;
const GABARIT = path.join(__dirname, '..', 'export-templates', 'compteurs-synthese.twig');
const SERVICES_RESEAU = [['crossref', 'Crossref'], ['ror', 'ROR'], ['orcid', 'ORCID']];
const PROPOSES = [['doi.proposes', 'DOI proposés'], ['ror.proposes', 'ROR proposés'],
  ['orcid.proposes', 'ORCID proposés'], ['orcid.candidats', 'ORCID candidats']];
// Sous ce nombre d'alertes, la part en rapport n'est pas significative : la règle n'entre
// pas dans ce classement.
const SEUIL_PART_RAPPORT = 5;
const MAX_A_EXAMINER = 5;

// ---- Arguments ---------------------------------------------------------------------------

function analyserArguments(argv) {
  const o = { dossier: null, depuis: null, jusqua: null, contexte: 'prod', sortie: null, purger: false };
  const valeurs = { '--dossier': 'dossier', '--depuis': 'depuis', '--jusqua': 'jusqua',
    '--contexte': 'contexte', '--sortie': 'sortie' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--purger') { o.purger = true; continue; }
    if (!Object.prototype.hasOwnProperty.call(valeurs, a)) { throw new Error('argument inconnu : ' + a); }
    if (i + 1 >= argv.length) { throw new Error('valeur manquante pour ' + a); }
    o[valeurs[a]] = argv[++i];
  }
  for (const k of ['depuis', 'jusqua']) {
    if (o[k] !== null && !/^\d{4}-\d{2}-\d{2}$/.test(o[k])) { throw new Error('--' + k + ' attend AAAA-MM-JJ'); }
  }
  if (['prod', 'dev', 'tous'].indexOf(o.contexte) === -1) { throw new Error('--contexte attend prod, dev ou tous'); }
  return o;
}

// ---- Lecture -----------------------------------------------------------------------------

// -> { fichiers: [{ nom, source, passage, mesures: Map }], lus, illisibles, entetes, invalides }.
// Un fichier compte quand il garde au moins une ligne après les filtres de date et de contexte.
function lireDossier(dossier, filtres) {
  const f = filtres || {};
  const sortie = { fichiers: [], lus: 0, illisibles: 0, entetes: 0, invalides: 0 };
  let noms = [];
  try { noms = fs.readdirSync(dossier); } catch (e) { throw new Error('dossier illisible'); }
  for (const nom of noms.sort()) {
    if (!/\.csv$/i.test(nom) || nom.indexOf('~$') === 0) { continue; }
    let texte;
    try { texte = fs.readFileSync(path.join(dossier, nom), 'utf8'); }
    catch (e) { sortie.illisibles++; continue; }
    const r = compteurs.analyserCsvCompteurs(texte);
    if (!r.ok) { sortie.entetes++; continue; }
    sortie.lus++;
    sortie.invalides += r.invalides;
    const gardees = r.lignes.filter((l) =>
      (f.contexte === 'tous' || !f.contexte || l.contexte === f.contexte)
      && (!f.depuis || l.date >= f.depuis) && (!f.jusqua || l.date <= f.jusqua));
    if (gardees.length === 0) { continue; }
    const mesures = new Map();
    for (const l of gardees) { mesures.set(l.mesure, (mesures.get(l.mesure) || 0) + l.valeur); }
    sortie.fichiers.push({ nom: nom, source: gardees[0].source, passage: gardees[0].passage, mesures: mesures });
  }
  return sortie;
}

// ---- Agrégation --------------------------------------------------------------------------

function somme(fichiers, mesure) {
  let n = 0;
  for (const f of fichiers) { n += f.mesures.get(mesure) || 0; }
  return n;
}

function avec(fichiers, mesure) {
  return fichiers.filter((f) => (f.mesures.get(mesure) || 0) > 0).length;
}

// Un entier « pour N », arrondi ; 0 si le dénominateur est nul.
function pour(n, d, base) { return d > 0 ? Math.round(n * base / d) : 0; }

function agreger(lecture) {
  const nett = lecture.fichiers.filter((f) => f.source === 'nettoyeur');
  const imp = lecture.fichiers.filter((f) => f.source === 'import');
  const a = { lecture: lecture, passages: nett.length };
  a.passagesDistincts = new Set(nett.map((f) => f.passage)).size;
  a.signes = somme(nett, 'signes');

  const regles = new Map();
  const toutes = new Map();
  const codesImport = new Map();
  const refus = new Map();
  for (const f of lecture.fichiers) {
    for (const [mesure, n] of f.mesures) {
      toutes.set(mesure, (toutes.get(mesure) || 0) + n);
      let m = /^regle:(.+):(revision|commentaire|rapport)$/.exec(mesure);
      if (m && f.source === 'nettoyeur') {
        const r = regles.get(m[1]) || { regle: m[1], revision: 0, commentaire: 0, rapport: 0 };
        r[m[2]] += n;
        regles.set(m[1], r);
        continue;
      }
      m = /^import\.code:(.+)$/.exec(mesure);
      if (m && f.source === 'import') { codesImport.set(m[1], (codesImport.get(m[1]) || 0) + n); continue; }
      m = /^issue\.refus:(.+)$/.exec(mesure);
      if (m && f.source === 'nettoyeur') { refus.set(m[1], (refus.get(m[1]) || 0) + n); }
    }
  }
  a.regles = Array.from(regles.values()).map((r) => {
    r.total = r.revision + r.commentaire + r.rapport;
    r.pourMillion = pour(r.total, a.signes, 1000000);          // alertes pour un million de signes
    r.rapportPourMille = pour(r.rapport, r.total, 1000);        // part en rapport, pour 1000
    return r;
  }).sort((x, y) => (y.pourMillion - x.pourMillion) || (y.total - x.total) || (x.regle < y.regle ? -1 : 1));
  a.toutes = toutes;
  a.refus = Array.from(refus.entries()).sort((x, y) => (y[1] - x[1]) || (x[0] < y[0] ? -1 : 1));
  a.issues = { ok: somme(nett, 'issue.ok'), alertes: somme(nett, 'issue.alertes'),
    plantage: somme(nett, 'issue.plantage'), interrompu: somme(nett, 'issue.interrompu') };
  a.plafond = avec(nett, 'plafond_commentaires_atteint');
  a.reseau = SERVICES_RESEAU.map(([cle, libelle]) => ({ cle: cle, libelle: libelle,
    pannes: somme(nett, 'reseau.' + cle + '.panne'), passages: avec(nett, 'reseau.' + cle + '.panne') }));
  a.proposes = PROPOSES.map(([cle, libelle]) => ({ cle: cle, libelle: libelle, n: somme(nett, cle) }));

  // Les articles de l'import : un fichier qui porte la mesure `auteurs` (écrite même à 0).
  // Un réimport n'écrit que des codes : ses codes comptent, il n'entre pas dans le dénominateur.
  const articles = imp.filter((f) => f.mesures.has('auteurs'));
  a.import = { articles: articles.length, auteurs: somme(imp, 'auteurs'),
    orcid: somme(imp, 'auteurs_orcid'), ror: somme(imp, 'auteurs_ror'),
    langueDeduite: somme(imp, 'langue_deduite') };
  a.codesImport = Array.from(codesImport.entries())
    .sort((x, y) => (y[1] - x[1]) || (x[0] < y[0] ? -1 : 1));
  return a;
}

// Les 3 à 5 règles à examiner : les plus fréquentes pour 1000 signes, puis celles qui
// finissent le plus souvent dans le rapport (avec au moins SEUIL_PART_RAPPORT alertes). Une
// règle présente dans les deux listes cumule ses raisons.
function reglesAExaminer(a) {
  if (a.signes <= 0) { return []; }
  const choisies = new Map();
  const ajouter = (r, raison) => {
    if (!choisies.has(r.regle)) { choisies.set(r.regle, { regle: r.regle, raisons: [] }); }
    choisies.get(r.regle).raisons.push(raison);
  };
  a.regles.filter((r) => r.total > 0).slice(0, 3)
    .forEach((r) => ajouter(r, 'bruyante : ' + decimal(r.pourMillion / 1000, 2) + ' alerte(s) pour 1000 signes'));
  a.regles.filter((r) => r.total >= SEUIL_PART_RAPPORT && r.rapport > 0)
    .sort((x, y) => (y.rapportPourMille - x.rapportPourMille) || (y.total - x.total))
    .slice(0, 3)
    .forEach((r) => ajouter(r, 'finit en rapport : ' + pourcent(r.rapport, r.total) + ' de ses alertes'));
  return Array.from(choisies.values()).slice(0, MAX_A_EXAMINER)
    .map((c) => ({ regle: c.regle, raison: c.raisons.join(' ; ') }));
}

// ---- Mise en forme -----------------------------------------------------------------------

// La virgule décimale de la maison, pour la page seulement (le CSV n'écrit que des entiers).
function decimal(x, chiffres) { return x.toFixed(chiffres).replace('.', ','); }
function pourcent(n, d) { return d > 0 ? decimal(100 * n / d, 0) + ' %' : '–'; }
function date10(d) {
  const p2 = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
}

function construireVue(a, filtres, maintenant) {
  const nett = a.passages;
  const periode = (filtres.depuis || filtres.jusqua)
    ? 'du ' + (filtres.depuis || 'début') + ' au ' + (filtres.jusqua || 'jour')
    : 'toute la période disponible';
  const avertissements = [];
  if (a.lecture.illisibles > 0) { avertissements.push(a.lecture.illisibles + ' fichier(s) illisible(s), ignoré(s).'); }
  if (a.lecture.entetes > 0) { avertissements.push(a.lecture.entetes + ' fichier(s) à l’en-tête différent, ignoré(s).'); }
  if (a.lecture.invalides > 0) { avertissements.push(a.lecture.invalides + ' ligne(s) hors contrat, écartée(s).'); }
  if (a.passages > 0 && a.signes === 0) { avertissements.push('Aucun signe compté : les taux par signe ne sont pas calculables.'); }
  return {
    periode: periode, contextes: filtres.contexte === 'tous' ? 'prod et dev' : filtres.contexte,
    genere: date10(maintenant),
    apercu: [
      { libelle: 'Fichiers lus', valeur: String(a.lecture.lus) },
      { libelle: 'Passages du nettoyeur', valeur: String(a.passages) },
      { libelle: 'Passages distincts (fichiers d’entrée différents)', valeur: String(a.passagesDistincts) },
      { libelle: 'Signes analysés', valeur: String(a.signes) },
      { libelle: 'Articles convertis à l’import', valeur: String(a.import.articles) }
    ],
    avertissements: avertissements,
    examiner: reglesAExaminer(a),
    regles: a.regles.filter((r) => r.total > 0).map((r) => ({
      regle: r.regle, revision: r.revision, commentaire: r.commentaire, rapport: r.rapport, total: r.total,
      densite: a.signes > 0 ? decimal(r.pourMillion / 1000, 2) : '–',
      part_rapport: pourcent(r.rapport, r.total) })),
    plafond: { passages: nett, atteints: a.plafond, part: pourcent(a.plafond, nett) },
    issues: [
      { libelle: 'Terminés sans alerte', n: a.issues.ok },
      { libelle: 'Terminés avec alertes', n: a.issues.alertes },
      { libelle: 'Plantages', n: a.issues.plantage },
      { libelle: 'Interrompus', n: a.issues.interrompu }],
    refus: a.refus.map(([code, n]) => ({ code: code, n: n })),
    reseau: a.reseau.map((s) => ({ service: s.libelle, pannes: s.pannes, part: pourcent(s.passages, nett) })),
    proposes: a.proposes.map((p) => ({ libelle: p.libelle, n: p.n,
      par_passage: nett > 0 ? decimal(p.n / nett, 2) : '–' })),
    'import': { articles: a.import.articles, auteurs: a.import.auteurs, orcid: a.import.orcid, ror: a.import.ror,
      part_orcid: pourcent(a.import.orcid, a.import.auteurs), part_ror: pourcent(a.import.ror, a.import.auteurs) },
    codes: a.codesImport.map(([code, n]) => ({ code: code, n: n,
      pour_cent: a.import.articles > 0 ? decimal(100 * n / a.import.articles, 1) : '–' })),
    mesures: Array.from(a.toutes.entries()).sort((x, y) => (x[0] < y[0] ? -1 : 1))
      .map(([mesure, total]) => ({ mesure: mesure, total: total }))
  };
}

// Le CSV de synthèse : section;cle;detail;valeur. Que des entiers ; un taux est un entier
// « pour 1000 » (ou « pour un million de signes » quand pour 1000 serait presque toujours 0).
function construireCsv(a) {
  const l = [];
  const ligne = (section, cle, detail, valeur) => l.push([section, cle, detail, String(valeur)].join(';'));
  ligne('apercu', 'fichiers_lus', '', a.lecture.lus);
  ligne('apercu', 'fichiers_illisibles', '', a.lecture.illisibles);
  ligne('apercu', 'fichiers_entete_different', '', a.lecture.entetes);
  ligne('apercu', 'lignes_hors_contrat', '', a.lecture.invalides);
  ligne('apercu', 'passages_nettoyeur', '', a.passages);
  ligne('apercu', 'signes', '', a.signes);
  ligne('apercu', 'articles_importes', '', a.import.articles);
  for (const r of a.regles) {
    ligne('regle', r.regle, 'revision', r.revision);
    ligne('regle', r.regle, 'commentaire', r.commentaire);
    ligne('regle', r.regle, 'rapport', r.rapport);
    ligne('regle', r.regle, 'total', r.total);
    ligne('regle', r.regle, 'pour_million_signes', r.pourMillion);
    ligne('regle', r.regle, 'rapport_pour_1000', r.rapportPourMille);
  }
  ligne('plafond_commentaires', 'passages_atteints', '', a.plafond);
  ligne('plafond_commentaires', 'pour_1000_passages', '', pour(a.plafond, a.passages, 1000));
  for (const k of Object.keys(a.issues)) { ligne('issue', k, '', a.issues[k]); }
  for (const [code, n] of a.refus) { ligne('refus', code, '', n); }
  for (const s of a.reseau) {
    ligne('reseau', s.cle, 'pannes', s.pannes);
    ligne('reseau', s.cle, 'pour_1000_passages', pour(s.passages, a.passages, 1000));
  }
  for (const p of a.proposes) { ligne('propose', p.cle, '', p.n); }
  for (const [code, n] of a.codesImport) {
    ligne('import_code', code, 'occurrences', n);
    ligne('import_code', code, 'pour_1000_articles', pour(n, a.import.articles, 1000));
  }
  ligne('import_auteurs', 'auteurs', '', a.import.auteurs);
  ligne('import_auteurs', 'orcid_pour_1000', '', pour(a.import.orcid, a.import.auteurs, 1000));
  ligne('import_auteurs', 'ror_pour_1000', '', pour(a.import.ror, a.import.auteurs, 1000));
  ligne('import_auteurs', 'langue_deduite', '', a.import.langueDeduite);
  for (const [mesure, total] of Array.from(a.toutes.entries()).sort((x, y) => (x[0] < y[0] ? -1 : 1))) {
    ligne('mesure', mesure, '', total);
  }
  return '\uFEFF' + ['section;cle;detail;valeur'].concat(l).join('\r\n') + '\r\n';
}

// ---- Purge -------------------------------------------------------------------------------

// Les fichiers dont la date (AAAAMMJJ en tête du nom) a plus de 24 mois ; un nom sans date
// est ignoré. -> { purges, gardes }. Ne supprime rien sans `executer`.
function purgerAnciens(dossier, maintenant, executer) {
  const limite = new Date(maintenant.getFullYear(), maintenant.getMonth() - MOIS_CONSERVATION, maintenant.getDate());
  const seuil = date10(limite).replace(/-/g, '');
  let purges = 0;
  let gardes = 0;
  for (const nom of fs.readdirSync(dossier)) {
    const m = /^(\d{8})-.*\.csv$/i.exec(nom);
    if (!m) { continue; }
    if (m[1] < seuil) {
      if (executer) { try { fs.unlinkSync(path.join(dossier, nom)); purges++; } catch (e) { gardes++; } }
      else { gardes++; }
    } else { gardes++; }
  }
  return { purges: purges, gardes: gardes };
}

// ---- Programme ---------------------------------------------------------------------------

// Rend { html, csv, vue, agregat } sans rien écrire : c'est ce que les tests rejouent.
function synthetiser(dossier, filtres, maintenant) {
  const lecture = lireDossier(dossier, filtres);
  const agregat = agreger(lecture);
  const vue = construireVue(agregat, filtres, maintenant || new Date());
  const source = fs.readFileSync(GABARIT, 'utf8').replace(/^\uFEFF/, '');
  const html = compiler(source, 'compteurs-synthese.twig').rendre({ v: vue }).contenu;
  return { html: html, csv: construireCsv(agregat), vue: vue, agregat: agregat };
}

function main(argv) {
  try {
    const o = analyserArguments(argv || process.argv.slice(2));
    const dossier = o.dossier || compteurs.resoudreDossierCompteurs();
    if (!dossier) { throw new Error('dossier des compteurs introuvable (ancrage non résolu)'); }
    const maintenant = new Date();
    const r = synthetiser(dossier, { depuis: o.depuis, jusqua: o.jusqua, contexte: o.contexte }, maintenant);
    const sortie = o.sortie || process.cwd();
    fs.mkdirSync(sortie, { recursive: true });
    const base = 'compteurs-synthese-' + date10(maintenant).replace(/-/g, '');
    const html = path.join(sortie, base + '.html');
    const csv = path.join(sortie, base + '.csv');
    fs.writeFileSync(html, r.html, 'utf8');
    fs.writeFileSync(csv, r.csv, 'utf8');
    const resultat = { ok: true, html: html, csv: csv, fichiers: r.agregat.lecture.lus,
      illisibles: r.agregat.lecture.illisibles, entetes: r.agregat.lecture.entetes };
    if (o.purger) { resultat.purges = purgerAnciens(dossier, maintenant, true).purges; }
    process.stdout.write(JSON.stringify(resultat) + '\n');
    return 0;
  } catch (e) {
    process.stdout.write(JSON.stringify({ ok: false, erreur: e.message }) + '\n');
    return 1;
  }
}

if (require.main === module) { process.exitCode = main(); }

module.exports = { analyserArguments, lireDossier, agreger, reglesAExaminer, construireVue, construireCsv,
  purgerAnciens, synthetiser, main, MOIS_CONSERVATION };
