// « Moisson mensuelle » et « Données FNS », dans les Paramètres de l'Accueil : lit l'état
// partagé dans _Moissons, estime la durée, lance moisson.py dans le moteur, relaie ses
// événements à la page et gère Arrêter. La passe continue si le panneau se ferme, pas si
// l'éditeur se ferme.
'use strict';

const vscode = require('vscode');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { T } = require('./i18n');
const { MSG } = require('./messages');
const moisson = require('./moisson');
const moteur = require('./moteur');
const propositions = require('./propositions');
const archivage = require('./archivage');
const inventaire = require('./inventaire');
const kirby = require('./kirby-contenu');

const URL_FNS = 'https://data.snf.ch';
const QUEUE_ERREURS = 600;

let ctx = {
  envoyer: () => {},
  racineMoissons: () => inventaire.baseRevuesPour(archivage.lireEmplacementRevues()),
  // La racine de test (Revues-TESTING) moissonne hors ligne, pour ne pas solliciter les sources.
  racineTest: () => archivage.lireEmplacementRevues() === archivage.EMPLACEMENT_TEST,
  poste: () => { try { return os.hostname(); } catch (e) { return ''; } },
  compte: () => { try { return os.userInfo().username; } catch (e) { return process.env.USERNAME || ''; } },
  // Lancé par -e, car le chemin OneDrive contient des espaces.
  executer: (argv) => moteur.executer(argv, { stdio: ['ignore', 'pipe', 'pipe'], sansShell: true }),
  versMoteur: (chemin) => moteur.versMoteur(chemin),
  script: () => moteur.toolkitMoteur('moissonneurs', 'moisson.py'),
  dossierArret: () => path.join(os.tmpdir(), 'pronto-moisson'),
  maintenant: () => new Date(),
  choisirFichier: async () => {
    const choix = await vscode.window.showOpenDialog({ canSelectFiles: true, canSelectFolders: false, canSelectMany: false,
      defaultUri: vscode.Uri.file(path.join(os.homedir(), 'Downloads')), filters: { CSV: ['csv'] } });
    return choix && choix[0] ? choix[0].fsPath : null;
  },
  ouvrirLien: (url) => vscode.env.openExternal(vscode.Uri.parse(url)),
  ouvrirPropositions: () => vscode.commands.executeCommand('szh.ouvrirActualite', 'propositions'),
  // Après une passe : la vue Propositions, les réglages et les résumés relisent les lots.
  apresPasse: () => {}
};
function configurer(n) { ctx = Object.assign({}, ctx, n); }

let preparation = null;   // { genre, etat: 'estimation' | 'confirmation', duree_s, horsLigne, fichier }
let passe = null;         // l'état de moisson.appliquer, plus proc, arret (le fichier), arretDemande, erreurs
let dernierBilan = null;
let budgets = {};         // par racine : { moissonneur: budget du mois }, tiré d'`estimer`
let budgetsDemandes = new Set();
let derniereFin = Promise.resolve();

// ---- Chemins --------------------------------------------------------------------------------

function racineNewsUndActu() { return path.join(ctx.racineMoissons(), kirby.NOM_BIBLIOTHEQUE); }
function cheminMoissons() { return propositions.cheminMoissons(ctx.racineMoissons()); }
function argsCommuns() {
  const a = ['--racine', ctx.versMoteur(racineNewsUndActu()), '--poste', ctx.poste(), '--compte', ctx.compte(),
    '--declencheur', 'cockpit', '--evenements', 'json'];
  return ctx.racineTest() ? a.concat(['--racine-test']) : a;
}
function argvMoisson(commande, args) { return ['python3', '-B', ctx.script(), commande].concat(args); }
// Demande d'arrêt : un fichier du poste passé par --arret, que moisson.py et le moissonneur
// lisent avant chaque requête. Le cockpit crée ce fichier plutôt que de tuer wsl.exe.
function nouveauFichierArret() { return path.join(ctx.dossierArret(), Date.now() + '-' + process.pid + '.arret'); }

// ---- Libellés -------------------------------------------------------------------------------

function libelle(m) {
  const v = T('doc.prop.moissonneur.' + m);
  return v === 'doc.prop.moissonneur.' + m ? m : v;
}
const p2 = (n) => String(n).padStart(2, '0');
function heure(d) { return d ? T('moisson.heure', [p2(d.getHours()), p2(d.getMinutes())]) : '?'; }
function jour(d) { return d ? p2(d.getDate()) + '.' + p2(d.getMonth() + 1) + '.' + d.getFullYear() : ''; }
function duree(s) {
  const n = Math.max(0, Math.ceil(Number(s) || 0));
  if (n < 60) { return T('moisson.duree.s', [n]); }
  const min = Math.ceil(n / 60);
  if (min < 60) { return T('moisson.duree.min', [min]); }
  return T('moisson.duree.h', [Math.floor(min / 60), p2(min % 60)]);
}
function nPropositions(n) {
  return T(n === 1 ? 'moisson.propositions.un' : 'moisson.propositions.plus', [n]);
}

function textes() {
  const t = (c) => T('moisson.' + c);
  const f = (c) => T('moisson.fns.' + c);
  return {
    section: T('accueil.regl.moiss.titre'), titre: t('titre'), aide: t('aide'), lancer: t('lancer'), lancerTest: t('lancerTest'), arreter: t('arreter'),
    confirmer: t('confirmer'), annuler: t('annuler'), estimation: t('estimation'), creneau: t('creneau'),
    arretDemande: t('arretDemande'), arretApres: t('arretApres'), voirPropositions: t('voirPropositions'),
    avertissements: t('avertissements'),
    fnsTitre: f('titre'), fnsAide: f('aide'), fnsLien: f('lien'), fnsRobots: f('robots'),
    fnsTelechargements: f('telechargements'), fnsFrequence: f('frequence'), fnsImporter: f('importer')
  };
}

// ---- L'état partagé, lu sur le disque --------------------------------------------------------

function lireBudgets() { return budgets[racineNewsUndActu()] || {}; }

function etatPartage() {
  const moissons = cheminMoissons();
  const maintenant = ctx.maintenant();
  if (!fs.existsSync(moissons)) { return { disponible: false, moissonneurs: [], creneau: null, raison: T('moisson.raison.racine') }; }
  const mois = moisson.moisDe(maintenant);
  const connus = lireBudgets();
  const moissonneurs = moisson.dossiersMoissonneurs(moissons).map((m) => {
    const somme = moisson.sommeMois(moissons, m, mois);
    const budget = Number.isInteger(connus[m]) ? connus[m] : null;
    // Le bilan des passes dit aussi le poste ; à défaut, etat.json.
    const d = moisson.dernierePasse(moissons, m) || moisson.derniereExecution(moissons, m);
    return { id: m, libelle: libelle(m), socle: moisson.soclePresent(moissons, m), somme: somme, budget: budget,
      epuise: moisson.epuise(budget, somme), derniere: d && d.date ? jour(d.date) : '', poste: d && d.poste ? d.poste : '', lot: d ? d.lot : '',
      propositions: d ? d.propositions : 0 };
  });
  const moi = moisson.clePoste(ctx.poste(), ctx.compte());
  const vivantes = moisson.annoncesVivantes(moissons, maintenant);
  const a = vivantes[0];
  const creneau = a ? { texte: a.cle === moi
    ? T('moisson.creneau.moi', [heure(a.debut), heure(a.expire)])
    : T('moisson.creneau.autre', [a.poste, a.compte, heure(a.debut), heure(a.echeance)]), moi: a.cle === moi } : null;
  const avecSocle = moissonneurs.filter((x) => x.socle);
  let raison = '';
  if (avecSocle.length === 0) { raison = T('moisson.raison.socle'); }
  else if (creneau) { raison = creneau.texte; }
  else if (!ctx.racineTest() && avecSocle.every((x) => x.epuise)) { raison = T('moisson.raison.budget'); }
  return { disponible: true, moissonneurs: moissonneurs, creneau: creneau, raison: raison };
}

// Sans socle de la recherche, moisson.py refuse un import : il n'aurait pas où noter son état.
function etatFns(partage) {
  const dernier = moisson.dernierImportFns(cheminMoissons());
  const prochaine = moisson.prochaineFns(dernier ? dernier.date : ctx.maintenant());
  const res = { prochaine: T('moisson.fns.prochaine.' + prochaine.mois, [prochaine.annee]), dernier: '',
    raison: partage.moissonneurs.some((m) => m.id === 'recherche' && m.socle) ? '' : T('moisson.raison.socle') };
  if (dernier) {
    res.dernier = T('moisson.fns.dernier', [jour(dernier.date), dernier.poste || '?',
      dernier.fichierDate ? jour(dernier.fichierDate) : '?', dernier.nouvelles === null ? '?' : dernier.nouvelles]);
  } else { res.dernier = T('moisson.fns.jamais'); }
  return res;
}

function vuePasse() {
  if (!passe) { return null; }
  const p = passe;
  const lignes = p.ordre.map((m) => {
    const l = p.lignes[m];
    const compte = l.budget === null || l.budget === undefined
      ? T('moisson.requetes', [l.requetes]) : T('moisson.requetesSur', [l.requetes, l.budget]);
    let detail = compte;
    if (l.reste_s !== null && l.reste_s !== undefined && !l.fin) { detail += ' · ' + T('moisson.reste', [duree(l.reste_s)]); }
    return { id: m, libelle: libelle(m), etape: l.etape, fraction: l.fin ? 1 : (Number(l.fraction) || 0), detail: detail,
      attente: l.attente ? T('moisson.attente', [l.attente.etape, duree(l.attente.secondes),
        l.attente.motif ? ' (' + l.attente.motif + ')' : '']) : '',
      lot: l.lot ? T('moisson.lot', [path.basename(l.lot.chemin), nPropositions(l.lot.propositions)]) : '' };
  });
  const c = p.courant ? p.lignes[p.courant] : null;
  const statut = p.phase === 'creneau' ? T('moisson.creneau')
    : c ? libelle(p.courant) + (c.etape ? ' · ' + c.etape : '') : '';
  return { genre: p.genre, phase: p.phase, statut: statut, lignes: lignes, arretDemande: p.arretDemande,
    // Avant `debut`, la passe attend encore le créneau : Arrêter ne s'offre qu'ensuite.
    peutArreter: p.phase === 'en-cours' && !p.arretDemande,
    avertissements: p.avertissements.slice(-3).map((a) => (a.moissonneur ? libelle(a.moissonneur) + ' · ' : '') + a.message) };
}

// Pendant une passe, l'état vient des événements ; _Moissons n'est relu qu'au début et à la fin.
let partageFige = null;
function etat() {
  const partage = passe && partageFige ? partageFige : etatPartage();
  const test = ctx.racineTest();
  return {
    type: MSG.ACCUEIL_MOISSON_ETAT, textes: textes(), test: test, disponible: partage.disponible,
    moissonneurs: partage.moissonneurs.map((m) => ({ libelle: m.libelle,
      ligne: (m.derniere ? (m.lot ? T('moisson.derniere', [m.derniere, m.lot, nPropositions(m.propositions)])
        : T('moisson.derniereSansLot', [m.derniere])) + (m.poste ? ' ' + T('moisson.depuisPoste', [m.poste]) : '')
        : T('moisson.jamais')) + ' ' + (m.budget === null ? T('moisson.mois', [m.somme])
        : T('moisson.moisSur', [m.somme, m.budget])) + (m.socle ? '' : ' ' + T('moisson.sansSocle')) })),
    creneau: partage.creneau ? partage.creneau.texte : '',
    raison: passe ? '' : partage.raison,
    preparation: preparation ? { genre: preparation.genre, etat: preparation.etat, texte: textePreparation() } : null,
    passe: vuePasse(), bilan: dernierBilan, fns: partage.disponible ? etatFns(partage) : null
  };
}
function envoyerEtat() { ctx.envoyer(etat()); }

function textePreparation() {
  const p = preparation;
  if (p.etat === 'estimation') { return T('moisson.estimation'); }
  const morceaux = [T('moisson.fermeture')];
  if (p.genre === 'import-fns') {
    morceaux.push(T('moisson.fns.confirmation', [p.fichierAffiche]));
  } else if (p.horsLigne) {
    morceaux.push(T('moisson.dureeHorsLigne', [duree(p.duree_s)]));
  } else {
    morceaux.push(p.duree_s === null ? T('moisson.dureeInconnue') : T('moisson.duree', [duree(p.duree_s)]));
  }
  return morceaux.join(' ');
}

// ---- Le moteur --------------------------------------------------------------------------------

// Une commande courte : rend { code, sortie, erreurs } et ne rejette jamais.
function commande(argv) {
  return new Promise((resolve) => {
    let sortie = '';
    let erreurs = '';
    let proc;
    try { proc = ctx.executer(argv); } catch (e) { resolve({ code: null, sortie: '', erreurs: String(e && e.message) }); return; }
    if (proc.stdout) { proc.stdout.setEncoding('utf8'); proc.stdout.on('data', (d) => { sortie += d; }); }
    if (proc.stderr) { proc.stderr.setEncoding('utf8'); proc.stderr.on('data', (d) => { erreurs += d; }); }
    proc.on('error', (e) => resolve({ code: null, sortie: sortie, erreurs: erreurs + String(e && e.message) }));
    proc.on('close', (code) => resolve({ code: code, sortie: sortie, erreurs: erreurs }));
  });
}

// `estimer` de chaque moissonneur qui a un socle : le budget du mois et la durée prévue.
async function estimer(moissonneurs) {
  const res = {};
  for (const m of moissonneurs) {
    const r = await commande(argvMoisson('estimer', [m].concat(argsCommuns())));
    const e = moisson.lireEstimation(r.sortie);
    if (e) { res[m] = e; }
  }
  const b = Object.assign({}, lireBudgets());
  for (const m of Object.keys(res)) { if (Number.isInteger(res[m].budget)) { b[m] = res[m].budget; } }
  budgets[racineNewsUndActu()] = b;
  return res;
}

// Le budget du mois de chaque moissonneur, une fois par racine et par session, sans bloquer la page.
function demanderBudgets() {
  const cle = racineNewsUndActu();
  if (budgetsDemandes.has(cle) || passe || preparation) { return; }
  const avecSocle = (() => { try { return etatPartage().moissonneurs.filter((m) => m.socle).map((m) => m.id); } catch (e) { return []; } })();
  if (avecSocle.length === 0) { return; }
  budgetsDemandes.add(cle);
  estimer(avecSocle).then(envoyerEtat, () => {});
}

async function preparerMensuelle() {
  if (passe || preparation) { return; }
  const partage = etatPartage();
  dernierBilan = null;
  if (partage.raison) { dernierBilan = { ok: false, texte: partage.raison, genre: 'mensuelle' }; return; }
  const avecSocle = partage.moissonneurs.filter((m) => m.socle);
  preparation = { genre: 'mensuelle', etat: 'estimation' };
  envoyerEtat();
  const estimations = await estimer(avecSocle.map((m) => m.id));
  const sommes = {};
  for (const m of avecSocle) { sommes[m.id] = m.somme; }
  const horsLigne = ctx.racineTest();
  preparation = { genre: 'mensuelle', etat: 'confirmation', horsLigne: horsLigne,
    duree_s: Object.keys(estimations).length === avecSocle.length ? moisson.dureeEstimee(estimations, sommes, horsLigne) : null };
}

// Le fichier doit être sur un disque du poste (pas de chemin UNC) pour que le moteur le lise.
function fichierLisible(chemin) { return /^[A-Za-z]:[\\/]/.test(String(chemin || '')); }

async function preparerFns() {
  if (passe || preparation) { return; }
  dernierBilan = null;
  const partage = etatPartage();
  if (!partage.disponible) { dernierBilan = { ok: false, texte: partage.raison, genre: 'import-fns' }; return; }
  if (partage.creneau) { dernierBilan = { ok: false, texte: partage.creneau.texte, genre: 'import-fns' }; return; }
  const chemin = await ctx.choisirFichier();
  if (!chemin) { return; }
  if (!fichierLisible(chemin)) { dernierBilan = { ok: false, texte: T('moisson.fns.cheminRefuse', [chemin]), genre: 'import-fns' }; return; }
  preparation = { genre: 'import-fns', etat: 'confirmation', fichier: chemin, fichierAffiche: path.win32.basename(chemin) };
}

// La passe : stdout ligne à ligne, chaque événement appliqué puis l'état renvoyé.
function lancer() {
  if (passe || !preparation || preparation.etat !== 'confirmation') { return Promise.resolve(); }
  const prep = preparation;
  preparation = null;
  dernierBilan = null;
  const arret = nouveauFichierArret();
  const fin = ['--arret', ctx.versMoteur(arret)];
  const argv = prep.genre === 'import-fns'
    ? argvMoisson('import-fns', ['--fichier', ctx.versMoteur(prep.fichier)].concat(argsCommuns(), fin))
    : argvMoisson('mensuelle', argsCommuns().concat(prep.horsLigne ? ['--hors-ligne'] : [], fin));
  partageFige = etatPartage();
  passe = Object.assign(moisson.nouvellePasse(prep.genre), { arret: arret, arretDemande: false, erreurs: '', proc: null });
  envoyerEtat();
  return new Promise((resolve) => {
    const p = passe;
    let reste = '';
    let resteErr = '';
    let fini = false;
    const finir = (code) => {
      if (fini) { return; }
      fini = true;
      if (reste.trim()) { traiterLigne(p, reste); }
      dernierBilan = Object.assign(bilan(p, code), { genre: p.genre });
      passe = null;
      partageFige = null;
      try { fs.rmSync(p.arret, { force: true }); } catch (e) { /* déjà parti */ }
      try { ctx.apresPasse(); } catch (e) { /* la page relira à la prochaine ouverture */ }
      resolve();
    };
    try { p.proc = ctx.executer(argv); } catch (e) { p.erreurs = String(e && e.message); finir(null); return; }
    p.proc.stdout.setEncoding('utf8');
    p.proc.stdout.on('data', (d) => {
      const lignes = (reste + d).split(/\r?\n/);
      reste = lignes.pop();
      let change = false;
      for (const l of lignes) { change = traiterLigne(p, l) || change; }
      if (change) { envoyerEtat(); }
    });
    p.proc.stderr.setEncoding('utf8');
    p.proc.stderr.on('data', (d) => {
      const lignes = (resteErr + d).split(/\r?\n/);
      resteErr = lignes.pop();
      for (const l of lignes) {
        p.erreurs = (p.erreurs + l + '\n').slice(-QUEUE_ERREURS);
      }
    });
    p.proc.on('error', (e) => { p.erreurs += String(e && e.message); finir(null); });
    p.proc.on('close', (code) => finir(code));
  });
}

function traiterLigne(p, texte) {
  if (!texte.trim()) { return false; }
  let e;
  try { e = JSON.parse(texte); } catch (err) { return false; }
  return moisson.appliquer(p, e);
}

// Le bilan d'une passe finie, en phrases de l'interface.
function bilan(p, code) {
  if (p.refus) {
    const r = p.refus.raison;
    let texte;
    if (r === 'deja-en-cours' && p.creneauRefuse) {
      texte = T('moisson.refus.deja-en-cours', [p.creneauRefuse.poste, p.creneauRefuse.compte, heure(p.creneauRefuse.debut)]);
    } else {
      const cle = 'moisson.refus.' + r;
      texte = T(cle) === cle ? T('moisson.refus.autre', [r]) : T(cle);
      // Le détail de moisson.py, en français, dit la colonne manquante ou le chemin introuvable.
      if (p.refus.detail) { texte += ' ' + p.refus.detail; }
    }
    return { ok: false, texte: texte, lots: [], details: [] };
  }
  const lots = p.ordre.filter((m) => p.lignes[m].lot).map((m) => {
    const l = p.lignes[m].lot;
    return T('moisson.lotDepose', [libelle(m), path.basename(l.chemin), nPropositions(l.propositions)]);
  });
  const details = [];
  for (const m of p.ordre) {
    const f = p.lignes[m].fin;
    if (!f) { continue; }
    if (f.plantage) { details.push(T('moisson.plantage', [libelle(m)])); }
    if (f.code === 2) { details.push(T('moisson.configuration', [libelle(m)])); }
    if (f.interrompu) { details.push(T('moisson.interrompu.' + f.interrompu, [libelle(m)])); }
    if (f.echecs.length) { details.push(T('moisson.echecs', [libelle(m), f.echecs.join(', ')])); }
  }
  for (const a of p.avertissements.slice(-3)) { details.push('⚠ ' + (a.moissonneur ? libelle(a.moissonneur) + ' · ' : '') + a.message); }
  if (!p.fin) {
    const queue = p.erreurs.trim();
    return { ok: false, texte: T('moisson.sansBilan', [code === null || code === undefined ? '?' : code])
      + (queue ? ' ' + queue.split('\n').slice(-3).join(' ') : ''), lots: lots, details: details };
  }
  const c = p.fin.code;
  const cle = 'moisson.code.' + c;
  return { ok: c === 0, ton: c === 0 ? 'ok' : (c === 1 || c === 3 ? 'attention' : 'danger'),
    texte: (T(cle) === cle ? T('moisson.code.5') : T(cle)) + ' ' + T('moisson.dureeFin', [duree(p.fin.duree_s)]),
    lots: lots, details: details, lien: lots.length > 0 };
}

// Arrêter : le fichier de demande, après `debut` seulement.
function demanderArret() {
  if (!passe || passe.phase !== 'en-cours' || passe.arretDemande) { return; }
  try {
    fs.mkdirSync(path.dirname(passe.arret), { recursive: true });
    fs.writeFileSync(passe.arret, new Date().toISOString() + '\n');
    passe.arretDemande = true;
  } catch (e) { passe.erreurs += String(e && e.message) + '\n'; }
}

// Rend vrai quand le message est celui de cette zone.
async function surMessage(msg) {
  if (msg.type === MSG.ACCUEIL_MOISSON_PREPARER) {
    await preparerMensuelle().catch(() => { preparation = null; });
    envoyerEtat();
    return true;
  }
  if (msg.type === MSG.ACCUEIL_FNS_CHOISIR) {
    await preparerFns().catch(() => { preparation = null; });
    envoyerEtat();
    return true;
  }
  if (msg.type === MSG.ACCUEIL_MOISSON_LANCER) {
    derniereFin = lancer().then(envoyerEtat, envoyerEtat);
    return true;
  }
  if (msg.type === MSG.ACCUEIL_MOISSON_ANNULER) {
    if (preparation && preparation.etat === 'confirmation') { preparation = null; }
    envoyerEtat();
    return true;
  }
  if (msg.type === MSG.ACCUEIL_MOISSON_ARRETER) { demanderArret(); envoyerEtat(); return true; }
  if (msg.type === MSG.ACCUEIL_FNS_LIEN) { await ctx.ouvrirLien(URL_FNS); return true; }
  if (msg.type === MSG.ACCUEIL_MOISSON_PROPOSITIONS) { await ctx.ouvrirPropositions(); return true; }
  return false;
}

// L'onglet Paramètres s'ouvre : l'état, et le budget du mois s'il n'est pas encore connu.
function surOnglet() { envoyerEtat(); demanderBudgets(); }

function finPasse() { return derniereFin; }

// À la désactivation de l'extension, la demande d'arrêt est posée si possible ; wsl.exe
// s'arrête avec l'éditeur.
function arreter() { demanderArret(); }

module.exports = { configurer, surMessage, surOnglet, envoyerEtat, etat, finPasse, arreter, URL_FNS };
