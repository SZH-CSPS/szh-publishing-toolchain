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
  if (champ === 'keywords') { return listeChamp(meta, champ, langue).join(', '); }
  return String(m[langue] || '').trim();
}

// Les mots-clés d'une langue, en LISTE et dans l'ordre du fichier.
function listeChamp(meta, champ, langue) {
  const m = (meta || {})[champ] || {};
  return (Array.isArray(m[langue]) ? m[langue] : [])
    .map(function (x) { return String(x).trim(); })
    .filter(function (x) { return x !== ''; });
}

// ---- Mots-clés appariés par position (D122) -----------------------------------------
//
// « diagnostic » ↔ « Diagnose » : le lien est la POSITION dans la liste, il n'y a
// rien d'autre dans le YAML pour le dire. Le parseur et le sérialiseur préservent
// l'ordre à l'identique, donc c'est fiable — à UNE condition : que les deux listes
// ne se décalent jamais.
//
// Le seul décalage possible venait d'un trou : une valeur vide disparaît à la
// sérialisation (serialiserMeta omet les chaînes vides), et tout ce qui suit remonte
// d'un cran — « Künstliche Intelligenz » se retrouverait en face de « trouble du
// spectre de l'autisme ». D'où cette marque : un mot-clé pas encore traduit s'écrit
// TO BE TRANSLATED plutôt que rien. La place est tenue, le manque est VISIBLE dans le
// fichier (et repérable d'un grep avant publication), et l'appariement ne peut plus
// glisser. Les formulaires l'affichent comme une case vide : on tape par-dessus.
const MARQUE_A_TRADUIRE = 'TO BE TRANSLATED';

function estATraduire(mot) {
  return String(mot === undefined || mot === null ? '' : mot).trim().toUpperCase() === MARQUE_A_TRADUIRE;
}

// [{ index, source, cible }] de longueur max(source, cible). La marque est rendue
// comme du vide : c'est un trou tenu, pas une traduction.
function pairesMotsCles(meta, source, langue) {
  const s = listeChamp(meta, 'keywords', source);
  const c = listeChamp(meta, 'keywords', langue);
  const paires = [];
  for (let i = 0; i < Math.max(s.length, c.length); i++) {
    paires.push({
      index: i,
      source: estATraduire(s[i]) ? '' : (s[i] || ''),
      cible: estATraduire(c[i]) ? '' : (c[i] || '')
    });
  }
  return paires;
}

// alignerMotsCles(liste, nAutre) -> la liste à ÉCRIRE dans la fiche : chaque case
// vide qui a un vis-à-vis reçoit la marque, pour que les positions restent face à
// face. Deux replis délibérés :
//   • si RIEN n'est traduit, on ne renvoie rien — inutile de remplir la fiche d'un
//     article que personne n'a commencé (la clé de langue reste absente) ;
//   • les cases vides AU-DELÀ de la liste d'en face sont retirées : elles ne font
//     face à rien, donc elles ne décalent rien.
// Symétrique : la même fonction sert dans les deux sens (source comme cible).
function alignerMotsCles(liste, nAutre) {
  const propres = (Array.isArray(liste) ? liste : [])
    .map((x) => String(x === undefined || x === null ? '' : x).replace(/[\r\n]+/g, ' ').trim())
    .map((x) => (estATraduire(x) ? '' : x));
  const longueur = Math.max(Number(nAutre) || 0, propres.length);
  const alignee = [];
  for (let i = 0; i < longueur; i++) { alignee.push(propres[i] || ''); }
  if (alignee.every((x) => x === '')) { return []; }
  while (alignee.length > (Number(nAutre) || 0) && alignee[alignee.length - 1] === '') { alignee.pop(); }
  return alignee.map((x) => (x === '' ? MARQUE_A_TRADUIRE : x));
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
      const ligne = {
        champ: champ, langue: langue, cle: cle,
        source: texteSource, cible: texteCible,
        rempli: texteCible !== '',
        statut: statutValide(st[cle]) || STATUT_DEFAUT
      };
      if (champ === 'keywords') {
        // « traduit » ne veut plus dire « la liste n'est pas vide » mais « chaque
        // mot-clé a son équivalent » : c'est ce qu'on vient vérifier d'un coup d'œil.
        // Une case portant la marque compte comme vide — c'est bien un manque.
        ligne.paires = pairesMotsCles(meta, source, langue);
        ligne.remplies = ligne.paires.filter(function (p) { return p.cible !== ''; }).length;
        ligne.total = ligne.paires.length;
        ligne.rempli = ligne.total > 0 && ligne.remplies === ligne.total;
      }
      lignes.push(ligne);
    }
  }
  return lignes;
}

// ---- Regroupement d'affichage (D122) ------------------------------------------------
//
// Le titre et le sous-titre sont UNE seule unité éditoriale : on ne traduit pas l'un
// sans l'autre, et deux états séparés pour deux lignes qui avancent ensemble ne
// disaient rien de plus. Ils partagent donc une carte et un état — écrit dans le
// sidecar sur CHACUNE de leurs clés (le format ne change pas), relu comme le moins
// avancé des deux (une fiche écrite par une version précédente reste lisible).
const GROUPES_TRADUCTION = [
  { cle: 'titre', champs: ['title', 'subtitle'] },
  { cle: 'resume', champs: ['resume'] },
  { cle: 'motscles', champs: ['keywords'] }
];

function statutLePlusBas(lignes) {
  let min = STATUTS.length - 1;
  for (const l of lignes) {
    const rang = STATUTS.indexOf(l.statut);
    if (rang !== -1 && rang < min) { min = rang; }
  }
  return STATUTS[min];
}

// groupesTraduction(lignes) -> [{ cle, langue, champs, lignes, statut, rempli }]
// dans l'ordre langue puis GROUPES_TRADUCTION. Un groupe dont aucun champ n'existe
// est absent (pas de carte « Sous-titre » là où il n'y en a pas).
function groupesTraduction(lignes) {
  const groupes = [];
  const langues = [];
  for (const l of (lignes || [])) { if (langues.indexOf(l.langue) === -1) { langues.push(l.langue); } }
  for (const langue of langues) {
    for (const g of GROUPES_TRADUCTION) {
      const membres = (lignes || []).filter(function (l) {
        return l.langue === langue && g.champs.indexOf(l.champ) !== -1;
      });
      if (membres.length === 0) { continue; }
      groupes.push({
        cle: g.cle + '.' + langue, groupe: g.cle, langue: langue,
        champs: membres.map(function (l) { return l.champ; }),
        lignes: membres,
        statut: statutLePlusBas(membres),
        rempli: membres.every(function (l) { return l.rempli; })
      });
    }
  }
  return groupes;
}

// Vue d'ensemble d'un article, comptée en UNITÉS D'AFFICHAGE (les groupes) : c'est
// ce que montre l'arbre. `statut` = celui du groupe le moins avancé.
function resumeTraduction(groupes) {
  const g = Array.isArray(groupes) ? groupes : [];
  const resume = { total: g.length, remplis: 0, finalises: 0, statut: STATUT_DEFAUT, melange: false };
  if (g.length === 0) { return resume; }
  let min = STATUTS.length - 1, max = 0;
  for (const groupe of g) {
    if (groupe.rempli) { resume.remplis++; }
    if (groupe.statut === 'finalise') { resume.finalises++; }
    const rang = STATUTS.indexOf(groupe.statut);
    if (rang < min) { min = rang; }
    if (rang > max) { max = rang; }
  }
  resume.statut = STATUTS[min];
  resume.melange = min !== max;
  return resume;
}

module.exports = {
  CHAMPS_TRADUISIBLES, STATUTS, STATUT_DEFAUT, ENTETE, GROUPES_TRADUCTION,
  MARQUE_A_TRADUIRE, estATraduire,
  cleChamp, statutValide, analyserTraduction, serialiserTraduction,
  texteChamp, listeChamp, valeurChamp, pairesMotsCles, alignerMotsCles,
  languesCibles, lignesTraduction, groupesTraduction, resumeTraduction
};
