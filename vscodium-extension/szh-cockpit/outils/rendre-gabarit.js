'use strict';

// Rend un gabarit Twig avec le moteur du cockpit (lib/gabarits.js), pour que les scripts
// PowerShell (Get-SzhCourriel, windows/szh-common.ps1) utilisent le même moteur. Le script
// reçoit le chemin et les variables, et appelle compiler(...).rendre(...).
//
// Lancé par VSCodium en mode Node (ELECTRON_RUN_AS_NODE=1), par Invoke-SzhNodeCockpit
// (windows/szh-shell.ps1).
//
// Entrée : un JSON sur stdin, pas en argument (accents, guillemets et retours à la ligne
// passent mal sur une ligne de commande Windows) :
//   { "chemin": "<chemin du .twig>", "variables": { ... } }
// Sortie : un JSON sur stdout, seul sur ce flux :
//   { "ok": true, "blocs": { ... } }
//   { "ok": false, "erreur": "<message>" }
// Code de sortie : 0 si ok, 1 sinon.
//
// Rapport du nettoyeur de manuscrit (rapport-manuscrit.twig) : quand `variables.rapport`
// porte le JSON brut du nettoyeur (pipeline/manuscrit-nettoyer.py), il est d'abord
// transformé en `variables.vue` (alertes groupées et plafonnées, images jugées par
// lib/qualite-image.js), ce que le moteur de gabarits ne sait pas faire.

const fs = require('fs');
const path = require('path');
const { compiler } = require(path.join(__dirname, '..', 'lib', 'gabarits.js'));
const { qualiteImage } = require(path.join(__dirname, '..', 'lib', 'qualite-image.js'));

// Retire un BOM de tête, sur le .twig comme sur l'entrée : lue depuis un pipe de Windows
// PowerShell, l'entrée stdin commence par un BOM.
function sansBom(texte) {
  if (texte.charCodeAt(0) === 0xfeff) { return texte.slice(1); }
  return texte;
}

// Lecture bloquante de stdin : le script ne fait qu'un aller-retour.
function lireEntree() {
  return sansBom(fs.readFileSync(0, 'utf8'));
}

// ---- Vue du rapport du nettoyeur de manuscrit --------------------------------------------
// Ce que rapport-manuscrit.twig ne peut pas faire (le moteur n'a ni arithmétique ni
// indexation par crochets, voir lib/gabarits.js) : plafonner les occurrences, grouper par
// famille puis par règle, juger les images. Fonction pure, testée par
// test/js/manuscrit-rapport.test.js.

const MAX_OCCURRENCES_PAR_REGLE = 10;
const RANG_SEVERITE = { error: 3, warning: 2, suggestion: 1 };

function rangSeverite(s) { return RANG_SEVERITE[s] || 0; }

// Bornes de longueur du résumé, copiées de pipeline/manuscrit_regles.py
// (RESUME_MIN_REVUE, RESUME_MAX_REVUE, RESUME_MAX_ZEITSCHRIFT) : l'alerte
// Forme.LongueurResume.* ne donne la fourchette (`suggested`) que si le résumé en sort, et
// le rapport l'affiche dans tous les cas. À tenir égales aux constantes Python.
const RESUME_MIN_REVUE = 400;
const RESUME_MAX_REVUE = 600;
const RESUME_MAX_ZEITSCHRIFT = 700;

// Le nom de fichier sans son chemin WSL ou Windows.
function nomFichier(chemin) {
  const s = String(chemin || '');
  const i = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'));
  return i === -1 ? s : s.slice(i + 1);
}

// Identité d'une alerte : ses huit champs, dans l'ordre. Sert à savoir, par
// `annotation.renvoyees_au_rapport` et `non_ancrees`, si une occurrence a été posée dans le
// .docx (révision ou commentaire) ou seulement renvoyée au rapport.
function cleAlerte(a) {
  return JSON.stringify([a.rule, a.severity, a.action, a.para, a.span, a.found, a.suggested, a.message]);
}

// Clés des alertes non posées dans le .docx, d'après `annotation`
// (pipeline/manuscrit_annoter.py). Sans annotation (--sans-annotation), l'ensemble est vide.
function alertesNonPosees(annotation) {
  const ens = new Set();
  if (!annotation) { return ens; }
  for (const a of (annotation.renvoyees_au_rapport || [])) { ens.add(cleAlerte(a)); }
  for (const a of (annotation.non_ancrees || [])) { ens.add(cleAlerte(a)); }
  return ens;
}

// Familles puis règles, triées par sévérité, puis nombre d'occurrences, puis ordre
// alphabétique (pour un résultat stable). Chaque règle affiche au plus dix occurrences ;
// `reste` compte les autres.
function construireAlertes(alertesBrutes, annotation) {
  const liste = (alertesBrutes && alertesBrutes.liste) || [];
  const nonPosees = alertesNonPosees(annotation);
  const parRegle = new Map();
  for (const a of liste) {
    const regle = a.rule || '(sans règle)';
    if (!parRegle.has(regle)) {
      parRegle.set(regle, {
        regle, famille: regle.split('.')[0] || regle, severite: a.severity,
        total: 0, occurrences: []
      });
    }
    const groupe = parRegle.get(regle);
    groupe.total++;
    if (rangSeverite(a.severity) > rangSeverite(groupe.severite)) { groupe.severite = a.severity; }
    if (groupe.occurrences.length < MAX_OCCURRENCES_PAR_REGLE) {
      groupe.occurrences.push({
        severity: a.severity, action: a.action, para: a.para, span: a.span,
        found: a.found || '', suggested: a.suggested || '', message: a.message || '',
        posee: annotation ? !nonPosees.has(cleAlerte(a)) : false
      });
    }
  }
  const regles = Array.from(parRegle.values()).map((g) =>
    Object.assign(g, { reste: g.total - g.occurrences.length }));
  regles.sort((x, y) => (rangSeverite(y.severite) - rangSeverite(x.severite))
    || (y.total - x.total) || x.regle.localeCompare(y.regle));

  const parFamille = new Map();
  for (const g of regles) {
    if (!parFamille.has(g.famille)) {
      parFamille.set(g.famille, { famille: g.famille, total: 0, severite: g.severite, regles: [] });
    }
    const f = parFamille.get(g.famille);
    f.total += g.total;
    if (rangSeverite(g.severite) > rangSeverite(f.severite)) { f.severite = g.severite; }
    f.regles.push(g);
  }
  const familles = Array.from(parFamille.values());
  familles.sort((x, y) => (rangSeverite(y.severite) - rangSeverite(x.severite))
    || (y.total - x.total) || x.famille.localeCompare(y.famille));
  return familles;
}

// Le verdict de qualité d'image vient de lib/qualite-image.js ; le nettoyeur ne rapporte
// que les dimensions. Toutes les images d'un manuscrit sont des figures (les portraits
// passent par le gestionnaire de médias).
function construireImages(compteurs) {
  const details = (compteurs && compteurs.images && compteurs.images.details) || [];
  return details.map((im) => {
    const verdict = qualiteImage('figure', { largeur: im.largeur_px, hauteur: im.hauteur_px }, im.nom);
    return {
      nom: im.nom || '', source: im.source, largeur_px: im.largeur_px || 0, hauteur_px: im.hauteur_px || 0,
      alt_absent: !!im.alt_absent, niveau: verdict.niveau, mesure: verdict.mesure,
      min: verdict.min, conseille: verdict.conseille
    };
  });
}

// L'en-tête reconnue, ou null quand le rapport n'en a pas (`entete` vaut null en cas A,
// sans ré-analyse). Un champ absent se lit sur sa valeur vide, pas sur
// `indices_consommes`.
function construireEntete(decisions, produit, alertesBrutes) {
  const brut = decisions && decisions.entete;
  if (!brut) { return null; }
  const d = brut.donnees || {};
  const auteurs = Array.isArray(d.auteurs) ? d.auteurs : [];
  const motsCles = Array.isArray(d.mots_cles) ? d.mots_cles : [];
  const resume = d.resume || '';

  const liste = (alertesBrutes && alertesBrutes.liste) || [];
  const regleResume = 'Forme.LongueurResume.' + (produit === 'zeitschrift' ? 'Zeitschrift' : 'Revue');
  const alerteResume = liste.find((a) => a.rule === regleResume);
  const fourchetteResume = alerteResume ? alerteResume.suggested
    : (produit === 'zeitschrift' ? ('höchstens ' + RESUME_MAX_ZEITSCHRIFT + ' Zeichen')
      : ('entre ' + RESUME_MIN_REVUE + ' et ' + RESUME_MAX_REVUE + ' signes'));

  return {
    titre: d.titre || '', sous_titre: d.sous_titre || '',
    auteurs: auteurs.map((a) => ({
      prenom: a.prenom || '', nom: a.nom || '', fonction: a.fonction || '',
      institution: a.institution || '', email: a.email || ''
    })),
    resume, resume_signes: resume.length, fourchette_resume: fourchetteResume,
    resume_hors_fourchette: !!alerteResume,
    langue_resume: d.langue_resume || '', resumes_autres: d.resumes_autres || {},
    mots_cles: motsCles, doi: d.doi || '', ligne_revue: d.ligne_revue || '',
    titre_absent: !d.titre, auteurs_absents: auteurs.length === 0,
    resume_absent: !resume, mots_cles_absents: motsCles.length === 0, doi_absent: !d.doi
  };
}

// Titres retenus : niveau_retenu > 0 (0 compte comme vide, comme dans lib/gabarits.js).
// Le filtre ne dépend pas des codes de décision de manuscrit_modele.py.
function construireTitres(decisions) {
  const t = (decisions && decisions.titres) || {};
  const stats = t.stats || {};
  const trace = t.trace || [];
  const retenus = trace
    .filter((e) => e.portee === 'paragraphe' && e.niveau_retenu)
    .map((e) => ({
      source: e.source, niveau: e.niveau_retenu, style: e.style || '',
      depuis_liste: e.decision === 'promue_liste', motif: e.motif || ''
    }))
    .sort((a, b) => (a.source || 0) - (b.source || 0));
  const retrogrades = trace
    .filter((e) => e.portee === 'paragraphe' && /retrograd/.test(e.decision || ''))
    .map((e) => ({ source: e.source, style: e.style || '', motif: e.motif || '' }));
  return {
    stats,
    retenus, retrogrades,
    signal_inhabituel: !!stats.signal_nombre_inhabituel,
    total_retenus: stats.total_titres_retenus || 0,
    rabattus_niveau3: stats.groupes_rabattus_niveau3 || 0,
    rejet_contrainte: !!stats.rejet_contrainte_niveaux
  };
}

// Paragraphes de corps entièrement en gras, laissés tels quels et non retenus comme titres :
// des intertitres possiblement manqués, que la relecture tranche.
function construireGrasNonPromus(decisions) {
  const trace = (decisions && decisions.formatage && decisions.formatage.trace) || [];
  return trace
    .filter((e) => Array.isArray(e.signalements) && e.signalements.some((s) => /gras/i.test(s)))
    .map((e) => ({ source: e.source, motif: e.motif || '', dans_tableau: !!e.dans_tableau }));
}

// Lignes stderr de szh-typographie.lua :
//   [typo-avertissement] <code> | <contexte> | <phrase fr> | [de] <phrase de>
// On n'en garde que la phrase dans la langue du produit.
function construireAvertissementsTypo(avertissements, produit) {
  const langueAllemande = produit === 'zeitschrift';
  return (avertissements || []).map((ligne) => {
    const parties = String(ligne || '').split(' | ');
    if (parties.length < 4) { return String(ligne || ''); }
    if (!langueAllemande) { return parties[2]; }
    return parties[3].replace(/^\[de\]\s*/, '');
  });
}

// Constats de lecture du manuscrit (`[import-avertissement]`, recueillis par la CLI) : une
// entrée {code, champs, fr, de} chacune. Seule la phrase de la langue du produit est gardée,
// sans doublon.
function construireAvertissementsImport(liste, produit) {
  const vues = new Set();
  const phrases = [];
  for (const a of (liste || [])) {
    const phrase = String((produit === 'zeitschrift' ? a.de : a.fr) || '');
    if (phrase && !vues.has(phrase)) { vues.add(phrase); phrases.push(phrase); }
  }
  return phrases;
}

// Bibliographie (pipeline/manuscrit_biblio.py) : lit `rapport.bibliographie.stats`
// (references, citations, citees_absentes, doi_normalises, doi_retrouves, crossref{…}),
// ou null si absent.
function construireBibliographie(rapport) {
  const brut = rapport && rapport.bibliographie;
  if (!brut || !brut.stats) { return null; }
  return { stats: brut.stats };
}

function construireVueRapportManuscrit(rapport) {
  const r = rapport || {};
  if (r.refus) {
    return {
      refus: true, entree: nomFichier(r.entree), message: r.message || '',
      code_refus: r.code_refus || ''
    };
  }

  const produit = r.produit || 'revue';
  const decisions = r.decisions || {};
  const compteurs = r.compteurs || {};
  const typo = decisions.typographie || {};
  const ecriture = decisions.ecriture || null;
  const annotation = r.annotation || null;

  const alertesFamilles = construireAlertes(r.alertes, annotation);
  const alertesRenvoyeesCount = annotation
    ? alertesNonPosees(annotation).size
    : ((r.alertes && r.alertes.total) || 0);

  const maintenant = new Date();
  const deuxChiffres = (n) => String(n).padStart(2, '0');
  const date = deuxChiffres(maintenant.getDate()) + '.' + deuxChiffres(maintenant.getMonth() + 1)
    + '.' + maintenant.getFullYear();

  return {
    refus: false,
    entree: nomFichier(r.entree), produit, gabarit: r.gabarit || '', date,
    analyse_seule: !!r.analyse_seule, sans_typo: !!r.sans_typo,

    compteurs: {
      signes_total: compteurs.signes_total || 0,
      signes_bibliographie: compteurs.signes_bibliographie || 0,
      nb_references: compteurs.nb_references || 0,
      commentaires_perdus: compteurs.commentaires || 0,
      note_commentaires: compteurs.note_commentaires || '',
      images_total: (compteurs.images && compteurs.images.total) || 0,
      images_sans_alt: (compteurs.images && compteurs.images.sans_alt) || 0,
      notes_ecrites: (ecriture && ecriture.stats && ecriture.stats.notes_ecrites) || 0,
      typographie_appliquee: typo.statut === 'appliquee',
      revisions_posees: (annotation && annotation.revisions) || 0,
      commentaires_poses: (annotation && annotation.commentaires) || 0,
      alertes_renvoyees: alertesRenvoyeesCount
    },

    entete: construireEntete(decisions, produit, r.alertes),
    alertes_familles: alertesFamilles,
    titres: construireTitres(decisions),
    gras_non_promus: construireGrasNonPromus(decisions),
    images: construireImages(compteurs),
    bibliographie: construireBibliographie(r),

    typographie_abandons: (typo.abandons || []).map((a) => ({ source: a.source, motif: a.motif || '' })),
    typographie_avertissements: construireAvertissementsTypo(typo.avertissements, produit),
    avertissements_import: construireAvertissementsImport(r.avertissements_import, produit)
  };
}

function main() {
  let entree;
  try {
    entree = JSON.parse(lireEntree());
  } catch (e) {
    process.stdout.write(JSON.stringify({ ok: false, erreur: 'entrée JSON invalide : ' + e.message }) + '\n');
    process.exitCode = 1;
    return;
  }

  const chemin = String((entree && entree.chemin) || '');
  const variables = (entree && entree.variables) || {};
  try {
    if (variables.rapport) { variables.vue = construireVueRapportManuscrit(variables.rapport); }
    const source = sansBom(fs.readFileSync(chemin, 'utf8'));
    const blocs = compiler(source, path.basename(chemin)).rendre(variables);
    process.stdout.write(JSON.stringify({ ok: true, blocs }) + '\n');
  } catch (e) {
    process.stdout.write(JSON.stringify({ ok: false, erreur: e.message }) + '\n');
    process.exitCode = 1;
  }
}

// Exécutable directement, et requérable par test/js/manuscrit-rapport.test.js sans lire
// stdin (une lecture bloquante resterait accrochée dans un test).
if (require.main === module) { main(); }

module.exports = { construireVueRapportManuscrit, main };
