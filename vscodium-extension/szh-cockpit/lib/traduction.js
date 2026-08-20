// SZH cockpit — suivi de traduction (D113). Modèle PUR, sans dépendance : lecture
// et écriture du sidecar articles/<slug>/<slug>.traduction.yaml, et dérivation des
// lignes « à traduire » depuis la fiche <slug>.meta.yaml.
//
// PARTAGE DES RÔLES, à ne pas confondre :
//   <slug>.meta.yaml       les TEXTES, source et traductions (title/subtitle/resume/
//                          keywords par langue). Publiés : consommés par pandoc
//                          (--metadata-file) et par l'export OJS (lib/export-ojs.js).
//   <slug>.traduction.yaml l'ÉTAT DE L'ATELIER : un statut par champ traduisible et
//                          un commentaire libre. Jamais publié, jamais exporté,
//                          invisible du Makefile (qui ne connaît que *.meta.yaml),
//                          supprimé avec l'article (rm de articles/<slug>/).
//
// Format du sidecar — régénéré à chaque enregistrement, statuts par défaut OMIS
// (absent = « pas prêt »), clés de haut niveau inconnues restituées telles quelles
// (même prudence que D49) :
//
//   # Suivi de traduction — …
//   statuts:
//     title.de: pret-traduction
//     resume.de: finalise
//   commentaire: |
//     Vérifier « Beeinträchtigung ».
'use strict';

const { LANGUES_META, decouperValeurYaml } = require('./yaml');

// Les quatre champs de la fiche qui existent PAR LANGUE (D51). Le corps de
// l'article n'en fait pas partie : il n'a pas de variante par langue dans le
// dossier de revue (le texte traduit vit dans l'autre revue, pas ici).
const CHAMPS_TRADUISIBLES = ['title', 'subtitle', 'resume', 'keywords'];

// Les quatre états, DU MOINS AU PLUS AVANCÉ — l'ordre est significatif : il donne
// l'état d'un article (le moins avancé de ses champs) et le sens de « faire avancer ».
const STATUTS = ['pas-pret', 'pret-traduction', 'pret-relecture', 'finalise'];
const STATUT_DEFAUT = 'pas-pret';

const ENTETE = '# Suivi de traduction — état de travail interne au cockpit.\n' +
  '# Ni publié, ni exporté vers OJS : les traductions elles-mêmes vivent dans\n' +
  '# le fichier <article>.meta.yaml, à côté. Édité par le panneau « Traductions ».\n';

function cleChamp(champ, langue) { return champ + '.' + langue; }

function statutValide(valeur) {
  const v = String(valeur === undefined || valeur === null ? '' : valeur).trim();
  return STATUTS.indexOf(v) !== -1 ? v : null;
}

// analyserTraduction(texte) -> { statuts:{ 'title.de': 'finalise' }, commentaire, _inconnues }
// Best effort, comme analyserMeta : une clé ou une valeur non reconnue est ignorée
// (statuts) ou restituée telle quelle (haut niveau).
function analyserTraduction(texte) {
  const valeurs = { statuts: {}, commentaire: '', _inconnues: [] };
  if (!texte) { return valeurs; }
  const lignes = String(texte).split(/\r?\n/);
  let i = 0;
  while (i < lignes.length) {
    const m = lignes[i].match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!m) {
      if (lignes[i].trim() !== '' && lignes[i].trim().charAt(0) !== '#') { valeurs._inconnues.push(lignes[i]); }
      i++;
      continue;
    }
    const cle = m[1];
    const reste = m[2];
    if (cle === 'statuts') {
      i++;
      while (i < lignes.length && /^\s+\S/.test(lignes[i])) {
        const mm = lignes[i].match(/^\s+([A-Za-z0-9_-]+)\.([A-Za-z-]+):\s*(.*)$/);
        if (mm && CHAMPS_TRADUISIBLES.indexOf(mm[1]) !== -1 && LANGUES_META.indexOf(mm[2]) !== -1) {
          const s = statutValide(decouperValeurYaml(mm[3]).valeur);
          if (s) { valeurs.statuts[cleChamp(mm[1], mm[2])] = s; }
        }
        i++;
      }
      continue;
    }
    if (cle === 'commentaire') {
      const net = reste.trim();
      if (net.charAt(0) === '|') {
        // Bloc littéral : les lignes indentées de 2 espaces (les lignes vides en
        // font partie), désindentées ; les vides de fin sont retirées.
        i++;
        const bloc = [];
        while (i < lignes.length && (lignes[i].trim() === '' || /^ {2}/.test(lignes[i]))) {
          bloc.push(lignes[i].replace(/^ {2}/, ''));
          i++;
        }
        while (bloc.length > 0 && bloc[bloc.length - 1].trim() === '') { bloc.pop(); }
        valeurs.commentaire = bloc.join('\n');
      } else {
        valeurs.commentaire = decouperValeurYaml(reste).valeur;
        i++;
      }
      continue;
    }
    valeurs._inconnues.push(lignes[i]);
    i++;
    while (i < lignes.length && (/^\s+\S/.test(lignes[i]) || /^\s*-\s/.test(lignes[i]))) {
      valeurs._inconnues.push(lignes[i]);
      i++;
    }
  }
  return valeurs;
}

// serialiserTraduction(valeurs) -> YAML, ou '' s'il n'y a RIEN à retenir (aucun
// statut hors défaut, aucun commentaire, aucune clé inconnue) : l'appelant n'a
// alors pas de fichier à créer.
function serialiserTraduction(valeurs) {
  const v = valeurs || {};
  const statuts = v.statuts || {};
  const lignes = [];
  const sous = [];
  // Ordre canonique (langue, puis champ) — indépendant de l'ordre d'arrivée des
  // clés : deux enregistrements du même état produisent le même fichier.
  for (const langue of LANGUES_META) {
    for (const champ of CHAMPS_TRADUISIBLES) {
      const cle = cleChamp(champ, langue);
      const s = statutValide(statuts[cle]);
      if (!s || s === STATUT_DEFAUT) { continue; }   // absent = pas prêt
      sous.push('  ' + cle + ': ' + s);
    }
  }
  if (sous.length > 0) {
    lignes.push('statuts:');
    for (const s of sous) { lignes.push(s); }
  }
  const commentaire = String(v.commentaire === undefined || v.commentaire === null ? '' : v.commentaire)
    .replace(/\r\n?/g, '\n').replace(/\s+$/, '');
  if (commentaire !== '') {
    lignes.push('commentaire: |');
    for (const l of commentaire.split('\n')) { lignes.push(l === '' ? '' : '  ' + l); }
  }
  for (const brute of (Array.isArray(v._inconnues) ? v._inconnues : [])) { lignes.push(brute); }
  return lignes.length > 0 ? ENTETE + lignes.join('\n') + '\n' : '';
}

// Texte d'un champ de fiche dans une langue, sous forme de CHAÎNE (les mots-clés
// sont joints par « , », comme dans le formulaire de métadonnées).
function texteChamp(meta, champ, langue) {
  const m = (meta || {})[champ] || {};
  if (champ === 'keywords') {
    return (Array.isArray(m[langue]) ? m[langue] : []).map(function (x) { return String(x).trim(); })
      .filter(function (x) { return x !== ''; }).join(', ');
  }
  return String(m[langue] || '').trim();
}

// Réciproque : la valeur à ranger dans la fiche pour ce champ (tableau pour les
// mots-clés, chaîne sinon). Le nettoyage FIN (bornes, retours à la ligne) reste
// celui de nettoyerCarte côté hôte — un seul assainisseur pour les deux formulaires.
function valeurChamp(champ, texte) {
  const t = String(texte === undefined || texte === null ? '' : texte);
  if (champ === 'keywords') {
    return t.split(',').map(function (s) { return s.trim(); }).filter(function (s) { return s !== ''; });
  }
  return t.trim();
}

// Langues CIBLES d'un article : toutes sauf la langue du numéro. FR et DE sont
// toujours de la partie (les deux revues) ; l'italien n'apparaît que si l'article
// en porte déjà quelque part — même règle que la case « + Italien » des fiches.
function languesCibles(meta, source) {
  return LANGUES_META.filter(function (l) {
    if (l === source) { return false; }
    if (l === 'fr' || l === 'de') { return true; }
    return CHAMPS_TRADUISIBLES.some(function (c) { return texteChamp(meta, c, l) !== ''; });
  });
}

// Les lignes du suivi : une par (champ, langue cible). Un champ VIDE DES DEUX CÔTÉS
// est absent — on ne traduit pas un sous-titre qui n'existe pas, et une liste de
// champs fantômes rendrait le « 2/4 » de l'arbre faux.
function lignesTraduction(meta, statuts, source) {
  const st = statuts || {};
  const lignes = [];
  for (const langue of languesCibles(meta, source)) {
    for (const champ of CHAMPS_TRADUISIBLES) {
      const texteSource = texteChamp(meta, champ, source);
      const texteCible = texteChamp(meta, champ, langue);
      if (texteSource === '' && texteCible === '') { continue; }
      const cle = cleChamp(champ, langue);
      lignes.push({
        champ: champ, langue: langue, cle: cle,
        source: texteSource, cible: texteCible,
        rempli: texteCible !== '',
        statut: statutValide(st[cle]) || STATUT_DEFAUT
      });
    }
  }
  return lignes;
}

// Vue d'ensemble d'un article : combien de champs, combien de traduits, et l'état
// d'avancement = le statut du champ le MOINS avancé (`melange` dit s'ils diffèrent).
function resumeTraduction(lignes) {
  const l = Array.isArray(lignes) ? lignes : [];
  const resume = { total: l.length, remplis: 0, finalises: 0, statut: STATUT_DEFAUT, melange: false };
  if (l.length === 0) { return resume; }
  let min = STATUTS.length - 1, max = 0;
  for (const ligne of l) {
    if (ligne.rempli) { resume.remplis++; }
    if (ligne.statut === 'finalise') { resume.finalises++; }
    const rang = STATUTS.indexOf(ligne.statut);
    if (rang < min) { min = rang; }
    if (rang > max) { max = rang; }
  }
  resume.statut = STATUTS[min];
  resume.melange = min !== max;
  return resume;
}

module.exports = {
  CHAMPS_TRADUISIBLES, STATUTS, STATUT_DEFAUT, ENTETE,
  cleChamp, statutValide, analyserTraduction, serialiserTraduction,
  texteChamp, valeurChamp, languesCibles, lignesTraduction, resumeTraduction
};
