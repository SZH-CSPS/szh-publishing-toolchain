'use strict';

// Rend UN gabarit Twig avec le moteur du cockpit (lib/gabarits.js), pour que le lanceur
// PowerShell (Get-SzhCourriel, windows/szh-common.ps1 ; Invoke-SzhManuscrit,
// windows/open-produit.ps1) se serve du MÊME moteur que le cockpit au lieu d'en porter un
// second écrit à la main. Ne connaît rien aux courriels : chemin et variables lui arrivent
// tout faits, il ne fait qu'appeler compiler(...).rendre(...).
//
// Lancé par VSCodium-en-Node (ELECTRON_RUN_AS_NODE=1) -- voir Get-SzhCourriel pour le
// patron d'appel, calqué sur Invoke-SzhSecretariat (windows/open-produit.ps1).
//
// Entrée : un JSON sur STDIN, jamais en argument -- un corps de courriel porte des accents,
// des guillemets et des retours à la ligne qu'une ligne de commande Windows digère mal :
//   { "chemin": "<chemin du .twig>", "variables": { ... } }
// Sortie : un JSON sur STDOUT, rien d'autre sur ce flux :
//   { "ok": true, "blocs": { ... } }
//   { "ok": false, "erreur": "<message>" }
// Code de sortie : 0 si ok, 1 sinon.
//
// Cas particulier du rapport du nettoyeur de manuscrit (rapport-manuscrit.twig) : le
// moteur de gabarits (lib/gabarits.js, hors de portée de ce fichier) ne sait ni trancher
// (pas d'arithmétique, pas d'indexation par crochets) ni juger la qualité d'une image
// (lib/qualite-image.js, la seule vérité sur « trop petit », partagée avec le reste du
// produit). `variables.rapport`, quand il est fourni, porte le JSON BRUT du nettoyeur
// (pipeline/manuscrit-nettoyer.py) ; ce fichier le transforme en `variables.vue` -- une
// vue déjà groupée, plafonnée et jugée -- AVANT de rendre, avec la même fonction que ce
// que prouvent les tests (module.exports). Les autres appelants (courriels, exports) ne
// passent jamais `variables.rapport` : ce cas particulier ne les touche pas.

const fs = require('fs');
const path = require('path');
const { compiler } = require(path.join(__dirname, '..', 'lib', 'gabarits.js'));
const { qualiteImage } = require(path.join(__dirname, '..', 'lib', 'qualite-image.js'));

// Un BOM en tête d'un texte UTF-8 ne doit jamais entrer dans le rendu -- ni dans un bloc,
// ni dans une comparaison. Sert autant au .twig lu ci-dessous qu'à l'entrée reçue sur
// STDIN : VSCodium-en-Node en pose un en tête de ce que reçoit fs.readFileSync(0, 'utf8')
// quand l'appelant est un pipe de Windows PowerShell -- constaté sur ce poste, pas une
// hypothèse.
function sansBom(texte) {
  if (texte.charCodeAt(0) === 0xfeff) { return texte.slice(1); }
  return texte;
}

// Lecture bloquante de stdin : ce script ne fait qu'un aller-retour, jamais de flux long.
function lireEntree() {
  return sansBom(fs.readFileSync(0, 'utf8'));
}

// ---- Vue du rapport du nettoyeur de manuscrit --------------------------------------------
// Tout ce que rapport-manuscrit.twig ne peut pas faire lui-même (le moteur n'a ni
// arithmétique ni indexation par crochets, §-en-tête de lib/gabarits.js) : plafonner une
// liste d'occurrences, grouper par famille puis par règle, juger une image. Une seule
// fonction pure, testée directement (test/js/manuscrit-rapport.test.js) sans passer par un
// sous-processus à chaque cas.

const MAX_OCCURRENCES_PAR_REGLE = 10;
const RANG_SEVERITE = { error: 3, warning: 2, suggestion: 1 };

function rangSeverite(s) { return RANG_SEVERITE[s] || 0; }

// Bornes de longueur du résumé (Forme.LongueurResume.*) : pipeline/manuscrit_regles.py,
// RESUME_MIN_REVUE/RESUME_MAX_REVUE/RESUME_MAX_ZEITSCHRIFT. Une alerte ne porte la
// fourchette que quand le résumé la dépasse (§ »suggested« de la règle) -- pour l'afficher
// aussi dans le cas normal, sans dupliquer le SEUIL DE DÉTECTION (aucune décision reprise
// ici, juste les trois nombres déjà publiés au rédacteur dans les lignes directrices), donc
// ⚠ à resynchroniser si ces trois constantes bougent côté Python.
const RESUME_MIN_REVUE = 400;
const RESUME_MAX_REVUE = 600;
const RESUME_MAX_ZEITSCHRIFT = 700;

// Le nom de fichier seul, jamais le chemin WSL/Windows qui le précède -- une relectrice ne
// lit ni /mnt/c/... ni un chemin de poste.
function nomFichier(chemin) {
  const s = String(chemin || '');
  const i = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'));
  return i === -1 ? s : s.slice(i + 1);
}

// Identité d'une alerte : les huit champs du contrat (§7 de l'architecture), dans l'ordre --
// sert à retrouver, dans `annotation.renvoyees_au_rapport`/`non_ancrees`, si CETTE occurrence
// a été postée en révision/commentaire dans le .docx ou seulement renvoyée ici.
function cleAlerte(a) {
  return JSON.stringify([a.rule, a.severity, a.action, a.para, a.span, a.found, a.suggested, a.message]);
}

// `annotation` (pipeline/manuscrit_annoter.py, §7 ter) n'est pas encore branché dans la CLI
// (19.09.2026) : ce cas rend un ensemble vide, et toute occurrence ressort simplement « pas
// prouvée postée » -- jamais une supposition dans un sens ou dans l'autre.
function alertesNonPosees(annotation) {
  const ens = new Set();
  if (!annotation) { return ens; }
  for (const a of (annotation.renvoyees_au_rapport || [])) { ens.add(cleAlerte(a)); }
  for (const a of (annotation.non_ancrees || [])) { ens.add(cleAlerte(a)); }
  return ens;
}

// Familles puis règles, dans cet ordre : sévérité la plus grave d'abord, puis le plus
// d'occurrences, puis l'ordre alphabétique pour un résultat stable. Chaque règle plafonne
// ses occurrences affichées à dix (§10 du contrat : « deux cents signalements rendent
// l'outil détestable ») ; `reste` porte ce qui dépasse, jamais recalculé dans le gabarit.
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

// Le verdict de qualité d'image vient d'UN SEUL endroit (lib/qualite-image.js, §7 de
// l'architecture) : le nettoyeur ne rapporte que des pixels, jamais un jugement. `figure`
// est la seule famille possible ici -- un manuscrit n'a pas de portrait d'auteur·ice, ceux-là
// viennent du gestionnaire de médias, ailleurs dans le cockpit.
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

// L'en-tête reconnue (§5.5 de l'architecture) : absente en cas A (pas de ré-analyse, la
// clé `entete` du rapport vaut alors `null`) et en cas de champ non trouvé -- ce dernier se
// lit sur la VALEUR (vide), jamais sur un indice supposé, pour rester correct même si
// `indices_consommes` change de forme un jour.
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
    : (produit === 'zeitschrift' ? ('jusqu’à ' + RESUME_MAX_ZEITSCHRIFT + ' signes')
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

// Titres retenus (niveau_retenu > 0 -- estVide de lib/gabarits.js traite 0 comme vide, la
// même convention sert ici) : jamais une liste de codes de décision recopiée à la main,
// pour rester correct même si manuscrit_modele.py en gagne une nouvelle.
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

// Un paragraphe de corps entièrement gras, conservé (§5.2 : « signalé sans être touché »),
// non retenu comme titre -- le seul signal qui distingue un intertitre manqué d'un simple
// gras de corps, faute de texte de paragraphe dans le contrat (voir le rapport de chantier).
function construireGrasNonPromus(decisions) {
  const trace = (decisions && decisions.formatage && decisions.formatage.trace) || [];
  return trace
    .filter((e) => Array.isArray(e.signalements) && e.signalements.some((s) => /gras/i.test(s)))
    .map((e) => ({ source: e.source, motif: e.motif || '', dans_tableau: !!e.dans_tableau }));
}

// [typo-avertissement] <code> | <contexte> | <phrase fr> | [de] <phrase de> -- une ligne
// stderr brute (szh-typographie.lua, §6). On n'en garde que la phrase de la langue du
// produit, jamais l'étiquette technique qui la précède.
function construireAvertissementsTypo(avertissements, produit) {
  const langueAllemande = produit === 'zeitschrift';
  return (avertissements || []).map((ligne) => {
    const parties = String(ligne || '').split(' | ');
    if (parties.length < 4) { return String(ligne || ''); }
    if (!langueAllemande) { return parties[2]; }
    return parties[3].replace(/^\[de\]\s*/, '');
  });
}

// Bibliographie (pipeline/manuscrit_biblio.py, §7 bis) : pas encore branchée dans la CLI
// (19.09.2026) -- `rapport.bibliographie` n'existe pas aujourd'hui sur aucun manuscrit
// réel. Cette fonction lit la forme documentée par le brief (stats : references, citations,
// citees_absentes, doi_normalises, doi_retrouves, crossref{…}) SI elle apparaît un jour,
// sans jamais supposer qu'elle est là.
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
    typographie_avertissements: construireAvertissementsTypo(typo.avertissements, produit)
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

// require.main === module : ce script reste directement exécutable (VSCodium-en-Node, un
// aller-retour JSON sur stdin/stdout, comportement inchangé) et redevient aussi un module
// require()-able pour test/js/manuscrit-rapport.test.js, qui exerce construireVueRapportManuscrit
// sans relancer un sous-processus à chaque cas -- une lecture bloquante de stdin dans un
// process de test resterait accrochée sans jamais rendre la main.
if (require.main === module) { main(); }

module.exports = { construireVueRapportManuscrit, main };
