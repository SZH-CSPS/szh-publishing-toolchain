// Suivi de traduction : modèle pur qui lit et écrit le sidecar
// articles/<slug>/<slug>.traduction.yaml et dérive les lignes « à traduire » de la fiche
// <slug>.meta.yaml.
//
// Deux fichiers à ne pas confondre. Le .meta.yaml porte les textes, source et
// traductions, et il est publié : pandoc et l'export OJS le lisent. Le .traduction.yaml
// ne porte que l'état de l'atelier, un statut par champ traduisible et un commentaire
// libre ; il n'est ni publié ni exporté, le Makefile l'ignore, et il part avec l'article.
//
// Le sidecar est régénéré à chaque enregistrement, statuts par défaut omis et clés
// inconnues restituées telles quelles :
//
//   statuts:
//     title.de: pret-traduction
//   commentaire: |
//     Vérifier « Beeinträchtigung ».
'use strict';

const { LANGUES_META, decouperValeurYaml } = require('./yaml');

// Les champs de la fiche qui existent par langue. Le corps de l'article n'en fait pas
// partie : sa traduction vit dans l'autre revue, pas dans ce dossier.
const CHAMPS_TRADUISIBLES = ['title', 'subtitle', 'resume', 'keywords'];

// Du moins au plus avancé : l'ordre sert à calculer l'état d'un article, celui du moins
// avancé de ses champs.
const STATUTS = ['pas-pret', 'pret-traduction', 'pret-relecture', 'finalise'];
const STATUT_DEFAUT = 'pas-pret';

const ENTETE = '# Suivi de traduction – état de travail interne au cockpit.\n' +
  '# Ni publié, ni exporté vers OJS : les traductions elles-mêmes vivent dans\n' +
  '# le fichier <article>.meta.yaml, à côté. Édité par le panneau « Traductions ».\n';

function cleChamp(champ, langue) { return champ + '.' + langue; }

function statutValide(valeur) {
  const v = String(valeur === undefined || valeur === null ? '' : valeur).trim();
  return STATUTS.indexOf(v) !== -1 ? v : null;
}

// -> { statuts:{ 'title.de': 'finalise' }, commentaire, _inconnues }. Une clé ou une
// valeur non reconnue est ignorée dans les statuts, restituée telle quelle au premier
// niveau.
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

// serialiserTraduction(valeurs) -> YAML, ou chaîne vide s'il n'y a rien à retenir :
// l'appelant n'a alors pas de fichier à créer.
function serialiserTraduction(valeurs) {
  const v = valeurs || {};
  const statuts = v.statuts || {};
  const lignes = [];
  const sous = [];
  // Ordre canonique, langue puis champ, indépendant de l'ordre d'arrivée des clés :
  // deux enregistrements du même état produisent le même fichier.
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

function texteChamp(meta, champ, langue) {
  const m = (meta || {})[champ] || {};
  if (champ === 'keywords') { return listeChamp(meta, champ, langue).join(', '); }
  return String(m[langue] || '').trim();
}

function listeChamp(meta, champ, langue) {
  const m = (meta || {})[champ] || {};
  return (Array.isArray(m[langue]) ? m[langue] : [])
    .map(function (x) { return String(x).trim(); })
    .filter(function (x) { return x !== ''; });
}

// « diagnostic » ↔ « Diagnose » : le seul lien entre les deux listes est la position, et
// un trou suffirait à les décaler, serialiserMeta omettant les chaînes vides. Un mot-clé
// pas encore traduit s'écrit donc avec cette marque plutôt que vide : la place est tenue
// et le manque reste visible dans le fichier. Les formulaires l'affichent comme une case
// vide.
const MARQUE_A_TRADUIRE = 'TO BE TRANSLATED';

function estATraduire(mot) {
  return String(mot === undefined || mot === null ? '' : mot).trim().toUpperCase() === MARQUE_A_TRADUIRE;
}

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

// La liste à écrire dans la fiche : chaque case vide qui a un vis-à-vis reçoit la marque,
// pour que les positions restent face à face. Si rien n'est traduit, la clé de langue
// reste absente ; les cases vides au-delà de la liste d'en face sont retirées.
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

// Valeur à ranger dans la fiche : tableau pour les mots-clés, chaîne sinon. Le nettoyage
// fin reste celui de nettoyerCarte côté hôte, un seul assainisseur pour les deux
// formulaires.
function valeurChamp(champ, texte) {
  const t = String(texte === undefined || texte === null ? '' : texte);
  if (champ === 'keywords') {
    return t.split(',').map(function (s) { return s.trim(); }).filter(function (s) { return s !== ''; });
  }
  return t.trim();
}

// Langues cibles : toutes sauf celle du numéro. Le français et l'allemand sont toujours
// de la partie, une revue existant dans chacun ; l'italien n'apparaît que si l'article en
// porte déjà.
function languesCibles(meta, source) {
  return LANGUES_META.filter(function (l) {
    if (l === source) { return false; }
    if (l === 'fr' || l === 'de') { return true; }
    return CHAMPS_TRADUISIBLES.some(function (c) { return texteChamp(meta, c, l) !== ''; });
  });
}

// Une ligne par champ et langue cible. Un champ vide des deux côtés est absent : des
// champs fantômes fausseraient le compteur de l'arbre.
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
        // « traduit » veut dire que chaque mot-clé a son équivalent, pas que la liste est
        // non vide ; une case portant la marque compte comme vide.
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

// Le titre et le sous-titre forment une seule unité éditoriale : ils partagent une carte
// et un état, écrit dans le sidecar sur chacune de leurs clés pour ne pas changer le
// format, et relu comme le moins avancé des deux.
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
