// L'écrivain des compteurs d'usage (docs/RAPPORTS-ERREUR.md, « Les compteurs ne sont pas des
// rapports »). Un fichier CSV par événement dans `_Systeme\compteurs`, fait de mesures
// nommées et d'entiers : jamais un nom de fichier, un slug, un titre, un nom, un e-mail, un
// chemin ni un message d'exception. La finalité est la qualité du logiciel (quelle règle du
// nettoyeur crie pour rien, quel avertissement de l'import revient partout), jamais
// l'évaluation d'une personne : la date est locale et SANS heure, et rien ne relie un fichier
// à un compte Windows.
//
// Ce module réutilise lib/rapport-erreur.js (ancrage résolu passivement, dossier `_Systeme`,
// file d'attente hors ligne, lecture tolérante de config.json) et ne le recopie pas.
// Dépendances : fs/path/os/crypto, comme lui ; il se charge hors de l'éditeur. Aucune
// fonction d'écriture ne lève : un compteur raté est une perte silencieuse, jamais une
// panne de l'interface.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const rapport = require('./rapport-erreur');

// L'en-tête exact, une seule fois : le lanceur PowerShell écrit la même ligne, l'outil de
// synthèse refuse (et compte) tout fichier qui en porte une autre.
const ENTETE_COMPTEURS = 'date;poste;contexte;version_toolkit;version_rootfs;source;passage;mesure;valeur';
const COLONNES = ENTETE_COMPTEURS.split(';');
const SOURCES = Object.freeze(['nettoyeur', 'import']);
const DEVENIRS = Object.freeze(['revision', 'commentaire', 'rapport']);
const SOUS_DOSSIER = 'compteurs';
const NOM_JOURNAL = '.szh-journal.log';

const RE_MESURE = /^[a-z0-9_.:-]{1,96}$/;
const RE_ID_REGLE = /^[A-Z][A-Za-z0-9]*(\.[A-Z][A-Za-z0-9]*)+$/;
const RE_CODE_IMPORT = /^[a-z][a-z0-9-]{1,40}$/;
const RE_PASSAGE = /^[0-9a-f]{12}$/;
const RE_DATE = /^\d{4}-\d{2}-\d{2}$/;
const RE_POSTE = /^[A-Z0-9-]{1,63}$/;
const MAX_ID_REGLE = 64;

// Les seules mesures que chaque source a le droit d'écrire (le contrat en donne la liste). Une
// mesure qui a la bonne forme mais n'est pas ici est écartée : la forme `[a-z0-9_.:-]` laisserait
// passer un slug ou un nom de fichier mis en minuscules. Les suffixes libres (`issue.refus:`,
// `titres.`) ont leur propre motif, plus étroit que la forme générale.
const MESURES_NETTOYEUR = Object.freeze(['issue.ok', 'issue.alertes', 'issue.plantage', 'issue.interrompu',
  'produit.revue', 'produit.zeitschrift', 'cas.a', 'cas.b', 'format.entree.odt', 'format.sortie.odt',
  'langue.desaccord', 'signes', 'signes_biblio', 'paragraphes', 'references', 'notes', 'images',
  'images_sans_alt', 'duree_ms', 'plafond_commentaires_atteint', 'perte_mots', 'ecartes',
  'vale.indisponible', 'typo.repli', 'annotation.restauree', 'reseau.crossref.panne',
  'reseau.ror.panne', 'reseau.orcid.panne', 'doi.proposes', 'ror.proposes', 'orcid.proposes',
  'orcid.candidats', 'entete.auteurs', 'entete.champs_vides', 'entete.ordre_incertain']);
const MOTIFS_NETTOYEUR = Object.freeze([/^issue\.refus:[a-z0-9_-]{1,48}$/, /^titres\.[a-z0-9_]{1,40}$/]);
const MESURES_IMPORT = Object.freeze(['auteurs', 'auteurs_orcid', 'auteurs_ror', 'langue_deduite']);

function mesureAutorisee(mesure, source) {
  if (!source) { return true; }
  if (mesure.indexOf('regle:') === 0) { return source === 'nettoyeur'; }
  if (source === 'nettoyeur') {
    return MESURES_NETTOYEUR.indexOf(mesure) !== -1 || MOTIFS_NETTOYEUR.some((re) => re.test(mesure));
  }
  if (source === 'import') { return MESURES_IMPORT.indexOf(mesure) !== -1 || mesure.indexOf('import.code:') === 0; }
  return false;
}

// ---------------------------------------------------------------------------------------
// 1. Contexte de la ligne : poste, contexte, versions, date
// ---------------------------------------------------------------------------------------

function aleatoireHex(n) { return crypto.randomBytes(Math.ceil(n / 2)).toString('hex').slice(0, n); }

// Le nom de la machine, en majuscules, réduit à [A-Z0-9-] (le nom d'un fichier partagé).
function posteCompteurs() {
  let nom = '';
  try { nom = os.hostname() || ''; } catch (e) { nom = ''; }
  const propre = String(nom).toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 63);
  return propre || 'POSTE';
}

// `dev` si la CLI du nettoyeur est pilotée à la main (SZH_MANUSCRIT_CLI), si le cockpit tourne
// sous l'instance de développement (SZH_CODIUM_PROFIL, posée par outils-dev/pronto-dev.ps1 pour
// ce seul processus), si le toolkit installé est une jonction vers un dépôt, ou si
// config.json porte "compteurs": "dev". Sinon `prod`.
function contexteCompteurs() {
  if (String(process.env.SZH_MANUSCRIT_CLI || '').trim()) { return 'dev'; }
  if (String(process.env.SZH_CODIUM_PROFIL || '').trim()) { return 'dev'; }
  try {
    const toolkit = path.join(rapport.racineProgramData(), 'toolkit');
    if (fs.lstatSync(toolkit).isSymbolicLink()) { return 'dev'; }
  } catch (e) { /* pas de toolkit lisible : on ne devine pas */ }
  const cfg = rapport.lireJsonTolerant(rapport.cheminConfigPoste());
  if (String(cfg.compteurs || '').trim().toLowerCase() === 'dev') { return 'dev'; }
  return 'prod';
}

// Un numéro de version n'a jamais de `;`, d'espace ni de saut de ligne : on ne garde que ce
// qu'une version peut porter.
function jetonVersion(v) {
  return String(v === undefined || v === null ? '' : v).replace(/[^A-Za-z0-9._+-]/g, '').slice(0, 40);
}

function versionToolkitCompteurs() { return jetonVersion(rapport.versionToolkit()); }

// La version du disque de la machine virtuelle, telle que l'inventaire la lit : l'état par
// compte d'abord, l'état du poste en repli. Vide si elle n'est pas lisible.
function versionRootfsCompteurs() {
  try {
    const pose = jetonVersion(rapport.lireEtatUtilisateur().rootfs);
    if (pose) { return pose; }
    return jetonVersion(rapport.lireJsonTolerant(rapport.cheminStatePoste()).rootfs);
  } catch (e) { return ''; }
}

// ---------------------------------------------------------------------------------------
// 2. Validation — pure. Tout ce qui ne suit pas le contrat est écarté, jamais réécrit,
//    sauf un Id de règle inconnu (devenu `Autre`).
// ---------------------------------------------------------------------------------------

// Rend la mesure telle qu'elle sera écrite, ou null si elle doit être écartée. Avec `source`, la
// mesure doit aussi figurer dans la liste de cette source.
function normaliserMesure(brut, source) {
  const s = String(brut === undefined || brut === null ? '' : brut);
  const r = normaliserForme(s);
  return (r !== null && mesureAutorisee(r, source)) ? r : null;
}

function normaliserForme(s) {
  if (s.indexOf('regle:') === 0) {
    const i = s.lastIndexOf(':');
    if (i <= 5) { return null; }
    const devenir = s.slice(i + 1);
    if (DEVENIRS.indexOf(devenir) === -1) { return null; }
    const id = s.slice(6, i);
    const sain = id.length <= MAX_ID_REGLE && RE_ID_REGLE.test(id) ? id : 'Autre';
    return 'regle:' + sain + ':' + devenir;
  }
  if (!RE_MESURE.test(s)) { return null; }
  if (s.indexOf('import.code:') === 0 && !RE_CODE_IMPORT.test(s.slice('import.code:'.length))) { return null; }
  return s;
}

// Un entier positif ou nul, sous forme de nombre ou de chaîne de chiffres ; le reste (décimale,
// négatif, texte, booléen) est écarté.
function valeurEntiere(v) {
  if (typeof v === 'number') { return Number.isSafeInteger(v) && v >= 0 ? v : null; }
  if (typeof v === 'string' && /^\d{1,15}$/.test(v)) { return Number(v); }
  return null;
}

// `mesures` : un objet { nom: valeur } ou une liste de [nom, valeur]. Les noms qui deviennent
// identiques (plusieurs Id inconnus -> `Autre`) s'additionnent. -> { lignes: [[nom, n]], rejetees }.
function assainirMesures(mesures, source) {
  let paires = [];
  if (Array.isArray(mesures)) { paires = mesures; }
  else if (mesures && typeof mesures === 'object') { paires = Object.keys(mesures).map((k) => [k, mesures[k]]); }
  const somme = new Map();
  let rejetees = 0;
  for (const p of paires) {
    const nom = Array.isArray(p) ? normaliserMesure(p[0], source) : null;
    const val = Array.isArray(p) ? valeurEntiere(p[1]) : null;
    if (nom === null || val === null) { rejetees++; continue; }
    somme.set(nom, (somme.get(nom) || 0) + val);
  }
  return { lignes: Array.from(somme.entries()), rejetees: rejetees };
}

function dateLocale(maintenant) { return rapport.formaterJourLocal(maintenant || new Date()); }

// Le nom du fichier : <AAAAMMJJ>-<POSTE>-<source>-<6hex>.csv
function nomFichierCompteurs(date, poste, source, hex) {
  return date.replace(/-/g, '') + '-' + poste + '-' + source + '-' + hex + '.csv';
}

// Le contenu d'un fichier : BOM, en-tête exact, une ligne par mesure, CRLF partout (la
// dernière ligne comprise). `ctx` : date, poste, contexte, versionToolkit, versionRootfs, source,
// passage. Lève si `ctx` est hors contrat : l'appelant (ecrireCompteurs) le rattrape.
function construireCsv(ctx, lignes) {
  if (!RE_DATE.test(ctx.date)) { throw new Error('date'); }
  if (!RE_POSTE.test(ctx.poste)) { throw new Error('poste'); }
  if (ctx.contexte !== 'prod' && ctx.contexte !== 'dev') { throw new Error('contexte'); }
  if (SOURCES.indexOf(ctx.source) === -1) { throw new Error('source'); }
  if (!RE_PASSAGE.test(ctx.passage)) { throw new Error('passage'); }
  const tete = [ctx.date, ctx.poste, ctx.contexte, jetonVersion(ctx.versionToolkit),
    jetonVersion(ctx.versionRootfs), ctx.source, ctx.passage];
  const corps = lignes.map((l) => tete.concat([l[0], String(l[1])]).join(';'));
  return '\uFEFF' + [ENTETE_COMPTEURS].concat(corps).join('\r\n') + '\r\n';
}

// ---------------------------------------------------------------------------------------
// 3. Lecture — pour l'outil de synthèse. Tolérante : un fichier qui ne suit pas le contrat
//    est compté, jamais une exception.
// ---------------------------------------------------------------------------------------

// -> { ok, lignes: [{date, poste, contexte, version_toolkit, version_rootfs, source, passage,
//      mesure, valeur}], invalides }. `ok` est faux si l'en-tête n'est pas exactement le nôtre.
function analyserCsvCompteurs(texte) {
  const brut = String(texte === undefined || texte === null ? '' : texte).replace(/^\uFEFF/, '');
  const lignes = brut.split(/\r\n|\n|\r/).filter((l) => l !== '');
  if (lignes.length === 0 || lignes[0] !== ENTETE_COMPTEURS) { return { ok: false, lignes: [], invalides: 0 }; }
  const sortie = [];
  let invalides = 0;
  for (const l of lignes.slice(1)) {
    const c = l.split(';');
    const val = c.length === COLONNES.length && /^\d{1,15}$/.test(c[8]) ? Number(c[8]) : null;
    if (val === null || !RE_DATE.test(c[0])) { invalides++; continue; }
    const o = {};
    COLONNES.forEach((nom, i) => { o[nom] = c[i]; });
    o.valeur = val;
    sortie.push(o);
  }
  return { ok: true, lignes: sortie, invalides: invalides };
}

// ---------------------------------------------------------------------------------------
// 4. Écriture — atomique, file d'attente, garde de banc. Ne lève jamais.
// ---------------------------------------------------------------------------------------

// Ni SZH_LANCEUR_SIMULE=1 ni SZH_RESEAU_INTERDIT ne doivent écrire dans un vrai dossier du
// poste ; SZH_COMPTEURS (un dossier jetable choisi par le test) lève la garde.
function ecritureEviteeParHarnais() {
  if (String(process.env.SZH_COMPTEURS || '').trim()) { return false; }
  return process.env.SZH_LANCEUR_SIMULE === '1' || !!process.env.SZH_RESEAU_INTERDIT;
}

// Le dossier des compteurs : SZH_COMPTEURS tel quel, sinon `_Systeme\compteurs` sous l'ancrage
// (jamais sous la racine active : `_Systeme` ne suit pas Revues-TESTING). null si rien n'aboutit.
function resoudreDossierCompteurs(ancrage) {
  const surcharge = String(process.env.SZH_COMPTEURS || '').trim();
  if (surcharge) { return surcharge; }
  const a = ancrage || rapport.resoudreAncrage();
  if (!a || !a.trouve) { return null; }
  return rapport.dossierSystemeDepuisAncrage(a.chemin, SOUS_DOSSIER);
}

// Écrit `contenu` dans `<dossier>\~$<nom>.<pid>` puis renomme en `<nom>`. Le temporaire est
// supprimé dans un finally, même si l'écriture ou le renommage échoue (le dossier est
// synchronisé : un orphelin s'y répliquerait sur tous les postes). Lève en cas d'échec.
function ecrireFichierAtomique(dossier, nom, contenu) {
  fs.mkdirSync(dossier, { recursive: true });
  const cible = path.join(dossier, nom);
  const tmp = path.join(dossier, '~$' + nom + '.' + process.pid);
  try {
    fs.writeFileSync(tmp, contenu, 'utf8');
    fs.renameSync(tmp, cible);
  } finally {
    try { if (fs.existsSync(tmp)) { fs.unlinkSync(tmp); } } catch (e) { /* déjà renommé */ }
  }
  return cible;
}

// Un fichier jamais réécrit : si le nom existe déjà (6 hex : quasi impossible), on retire un
// autre jeton.
function choisirNom(dossier, date, poste, source, hexImpose) {
  for (let i = 0; i < 8; i++) {
    const nom = nomFichierCompteurs(date, poste, source, (i === 0 && hexImpose) ? hexImpose : aleatoireHex(6));
    if (!fs.existsSync(path.join(dossier, nom))) { return nom; }
  }
  return null;
}

// `champs` : { source: 'nettoyeur'|'import', mesures: {nom: entier}|[[nom, entier]],
//   passage?: 12 hex (le SHA-256 tronqué du fichier d'entrée pour le nettoyeur ; tiré au hasard
//   sinon), maintenant?: Date, hex?: 6 hex (tests) }.
// Rend TOUJOURS { ecrit, enAttente, motif, fichier, lignes } :
//   motif  null sur un succès, sinon 'harnais-test' | 'source-inconnue' | 'vide' | 'mal-forme' |
//          'ecriture-impossible' | 'exception-interne'.
function ecrireCompteurs(champs) {
  const sortie = { ecrit: false, enAttente: false, motif: null, fichier: null, lignes: 0 };
  try {
    const c = champs || {};
    if (ecritureEviteeParHarnais()) { sortie.motif = 'harnais-test'; return sortie; }
    if (SOURCES.indexOf(c.source) === -1) { sortie.motif = 'source-inconnue'; return sortie; }
    const { lignes } = assainirMesures(c.mesures, c.source);
    if (lignes.length === 0) { sortie.motif = 'vide'; return sortie; }
    sortie.lignes = lignes.length;

    const poste = posteCompteurs();
    const date = dateLocale(c.maintenant);
    const passage = RE_PASSAGE.test(String(c.passage || '')) ? String(c.passage) : aleatoireHex(12);
    let texte;
    try {
      texte = construireCsv({
        date: date, poste: poste, contexte: contexteCompteurs(),
        versionToolkit: versionToolkitCompteurs(), versionRootfs: versionRootfsCompteurs(),
        source: c.source, passage: passage
      }, lignes);
    } catch (e) { sortie.motif = 'mal-forme'; return sortie; }

    const dossier = resoudreDossierCompteurs();
    if (dossier) {
      try {
        const nom = choisirNom(dossier, date, poste, c.source, c.hex);
        if (nom) {
          sortie.fichier = ecrireFichierAtomique(dossier, nom, texte);
          sortie.ecrit = true;
          console.log('[compteurs] ' + c.source + ' : ' + lignes.length + ' mesure(s) écrite(s).');
          return sortie;
        }
      } catch (e) { /* dossier injoignable : file d'attente */ }
    }

    try {
      const file = rapport.cheminDossierCompteursAttente();
      const nom = choisirNom(file, date, poste, c.source, c.hex);
      if (!nom) { sortie.motif = 'ecriture-impossible'; return sortie; }
      sortie.fichier = ecrireFichierAtomique(file, nom, texte);
      rapport.purgerDossierAttente(file, '.csv', rapport.PLAFONDS_ATTENTE_COMPTEURS);
      sortie.enAttente = true;
      console.log('[compteurs] ' + c.source + ' : mis en attente.');
      return sortie;
    } catch (e2) {
      sortie.motif = 'ecriture-impossible';
      return sortie;
    }
  } catch (e) {
    sortie.motif = 'exception-interne';
    return sortie;
  }
}

// Vide la file d'attente vers le dossier partagé (au démarrage du cockpit ; le lanceur fait de
// même de son côté). Un fichier qui ne part pas reste en place. Ne lève jamais.
function viderFileCompteurs() {
  const vide = { deplaces: 0, restes: 0 };
  try {
    if (ecritureEviteeParHarnais()) { return vide; }
    const dossier = resoudreDossierCompteurs();
    if (!dossier) { return vide; }
    const file = rapport.cheminDossierCompteursAttente();
    const fichiers = rapport.purgerDossierAttente(file, '.csv', rapport.PLAFONDS_ATTENTE_COMPTEURS);
    let deplaces = 0;
    for (const f of fichiers) {
      try {
        ecrireFichierAtomique(dossier, f.nom, fs.readFileSync(f.chemin));
        fs.unlinkSync(f.chemin);
        deplaces++;
      } catch (e) { /* toujours injoignable : on laisse en place */ }
    }
    if (fichiers.length > 0) { console.log('[compteurs] file d’attente : ' + deplaces + '/' + fichiers.length + ' déplacé(s).'); }
    return { deplaces: deplaces, restes: fichiers.length - deplaces };
  } catch (e) { return vide; }
}

// ---------------------------------------------------------------------------------------
// 5. Les compteurs de l'import (source `import`), écrits par le cockpit
// ---------------------------------------------------------------------------------------
//
// Jamais à chaque compilation : l'import rejoue à chaque Ctrl+S tant qu'un Word attend, et
// compterait `word-redepose` à chaque fois. Un fichier naît d'une conversion réussie
// (`[import] converti`), d'un réimport réussi, et de rien d'autre.

// Les avertissements propres à un article convertis dans la tâche : ceux qui PRÉCÈDENT la ligne
// « [import] converti ». Seul le code — le second jeton — est lu ; tout le reste de la ligne
// (nom de fichier, slug, phrase) est libre et n'est jamais regardé. Les deux refus qui ne
// créent rien (`word-redepose`, `origine-inconnue`) et un échec de conversion remettent
// le compte à zéro : ils ne sont pas ceux d'un article converti.
// -> [{ cible, codes: [code…] }] ; `cible` ne sert qu'à retrouver la fiche, jamais écrite.
const CODES_SANS_CONVERSION = ['word-redepose', 'origine-inconnue'];

function evenementsImportDepuisJournal(texte) {
  const evenements = [];
  let codes = [];
  for (const ligne of String(texte === undefined || texte === null ? '' : texte).split(/\r?\n/)) {
    let m = /^\[import-avertissement\]\s+(\S+)/.exec(ligne);
    if (m) {
      if (CODES_SANS_CONVERSION.indexOf(m[1]) === -1 && RE_CODE_IMPORT.test(m[1])) { codes.push(m[1]); }
      continue;
    }
    m = /^\[import\] converti : .*? -> (\S+)/.exec(ligne);
    if (m) { evenements.push({ cible: m[1], codes: codes }); codes = []; continue; }
    if (/^\[import\] ⚠ échec sur : /.test(ligne)) { codes = []; }
  }
  return evenements;
}

// Les auteurs d'une fiche <slug>.meta.yaml : combien, et combien portent un ORCID ou un ROR.
// Regex sur le YAML à plat (la fiche est toujours écrite ainsi), sans lib/yaml.js.
function compterAuteursMeta(texte) {
  const lignes = String(texte === undefined || texte === null ? '' : texte).split(/\r?\n/);
  let i = lignes.findIndex((l) => /^author\s*:/.test(l));
  const r = { auteurs: 0, auteurs_orcid: 0, auteurs_ror: 0 };
  if (i === -1) { return r; }
  let indent = -1;
  let orcid = false;
  let ror = false;
  const clore = () => { if (orcid) { r.auteurs_orcid++; } if (ror) { r.auteurs_ror++; } orcid = false; ror = false; };
  for (i = i + 1; i < lignes.length; i++) {
    const l = lignes[i];
    if (l.trim() === '') { continue; }
    if (/^\S/.test(l) && !/^-/.test(l)) { break; }
    const tiret = /^(\s*)-\s/.exec(l);
    if (tiret && (indent === -1 || tiret[1].length === indent)) {
      if (indent === -1) { indent = tiret[1].length; } else { clore(); }
      r.auteurs++;
    }
    const champ = /^\s*(?:-\s+)?(orcid|ror)\s*:\s*(.*?)\s*$/.exec(l);
    if (champ && r.auteurs > 0) {
      const v = champ[2].replace(/^["']|["']$/g, '').trim();
      if (v !== '') { if (champ[1] === 'orcid') { orcid = true; } else { ror = true; } }
    }
  }
  clore();
  return r;
}

// La fiche de l'article converti : d'abord à l'endroit que dit le journal, puis sous un nom
// préfixé d'un rang (« 03-slug »), que l'import peut poser juste après.
function trouverFicheMeta(racine, cible) {
  if (!racine || !cible || cible.indexOf('..') !== -1) { return null; }
  const md = path.join(racine, cible);
  const direct = md.replace(/\.md$/i, '.meta.yaml');
  if (fs.existsSync(direct)) { return direct; }
  try {
    const slug = path.basename(path.dirname(md));
    const unites = path.dirname(path.dirname(md));
    for (const nom of fs.readdirSync(unites)) {
      if (nom !== slug && !(nom.endsWith('-' + slug) && /^\d+-/.test(nom))) { continue; }
      const p = path.join(unites, nom, nom + '.meta.yaml');
      if (fs.existsSync(p)) { return p; }
    }
  } catch (e) { /* dossier illisible */ }
  return null;
}

function mesuresImport(codes, auteurs) {
  const m = {};
  if (auteurs) {
    m.auteurs = auteurs.auteurs;
    m.auteurs_orcid = auteurs.auteurs_orcid;
    m.auteurs_ror = auteurs.auteurs_ror;
  }
  for (const code of codes) { m['import.code:' + code] = (m['import.code:' + code] || 0) + 1; }
  if (codes.indexOf('langue-deduite') !== -1) { m.langue_deduite = 1; }
  return m;
}

// Le dernier journal déjà compté, par racine : relireJournal() peut relire le même fichier
// (il n'a pas changé) sans qu'un article soit compté deux fois.
const derniersJournaux = new Map();

// À la fin d'une tâche : un fichier `import` par article converti dans CETTE tâche, aucun
// sinon. -> { ecrits, evenements }. Ne lève jamais.
function enregistrerImportDepuisJournal(racine, options) {
  const vide = { ecrits: 0, evenements: 0 };
  try {
    if (!racine) { return vide; }
    const chemin = path.join(racine, (options && options.nomJournal) || NOM_JOURNAL);
    let st;
    try { st = fs.statSync(chemin); } catch (e) { return vide; }
    const signature = st.mtimeMs + ':' + st.size;
    if (derniersJournaux.get(racine) === signature) { return vide; }
    derniersJournaux.set(racine, signature);
    const evenements = evenementsImportDepuisJournal(fs.readFileSync(chemin, 'utf8'));
    let ecrits = 0;
    for (const ev of evenements) {
      let auteurs = { auteurs: 0, auteurs_orcid: 0, auteurs_ror: 0 };
      const fiche = trouverFicheMeta(racine, ev.cible);
      if (fiche) { try { auteurs = compterAuteursMeta(fs.readFileSync(fiche, 'utf8')); } catch (e) { /* fiche illisible */ } }
      if (ecrireCompteurs({ source: 'import', mesures: mesuresImport(ev.codes, auteurs) }).ecrit) { ecrits++; }
    }
    return { ecrits: ecrits, evenements: evenements.length };
  } catch (e) { return vide; }
}

// Fin d'un réimport réussi : le réimport ne passe pas par le journal, il répond une ligne JSON
// dont seuls les codes d'avertissement sont connus. La fiche garde ses auteurs : ils ne sont
// pas recomptés (ce serait compter deux fois le même article). Sans avertissement, rien.
function enregistrerReimport(json) {
  try {
    const liste = json && json.resultat === 'reussi' && Array.isArray(json.avertissements) ? json.avertissements : [];
    const codes = liste.map(String).filter((c) => RE_CODE_IMPORT.test(c));
    if (codes.length === 0) { return { ecrit: false }; }
    return { ecrit: ecrireCompteurs({ source: 'import', mesures: mesuresImport(codes, null) }).ecrit };
  } catch (e) { return { ecrit: false }; }
}

module.exports = {
  ENTETE_COMPTEURS, COLONNES, SOURCES, DEVENIRS, SOUS_DOSSIER,
  posteCompteurs, contexteCompteurs, versionToolkitCompteurs, versionRootfsCompteurs,
  MESURES_NETTOYEUR, MESURES_IMPORT, normaliserMesure, valeurEntiere, assainirMesures, nomFichierCompteurs, construireCsv,
  analyserCsvCompteurs,
  ecritureEviteeParHarnais, resoudreDossierCompteurs, ecrireFichierAtomique,
  ecrireCompteurs, viderFileCompteurs,
  evenementsImportDepuisJournal, compterAuteursMeta, trouverFicheMeta,
  enregistrerImportDepuisJournal, enregistrerReimport
};
