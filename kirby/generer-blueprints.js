// Génère les blueprints Kirby (kirby/site/blueprints/{pages,files}/*.yml) depuis
// pipeline/kirby/champs-documentation.json. Voir kirby/LISEZMOI.md.
//
//   node kirby/generer-blueprints.js             écrit les fichiers
//   node kirby/generer-blueprints.js --verifier  n'écrit rien ; code 1 et liste des fichiers
//                                                qui diffèrent de ce que produit le JSON
'use strict';

const fs = require('fs');
const path = require('path');

const RACINE = path.resolve(__dirname, '..');
const CHEMIN_CONTRAT = path.join(RACINE, 'pipeline', 'kirby', 'champs-documentation.json');
// pages/ : un blueprint par type de fiche, par dossier de type et pour la page Actualités.
// files/ : un gabarit de fichier par champ `fichier`. Les clés de construireTous() portent
// le sous-dossier ('pages/…', 'files/…').
const DOSSIER_BLUEPRINTS = path.join(__dirname, 'site', 'blueprints');

const ENTETE =
  '# Généré par kirby/generer-blueprints.js depuis pipeline/kirby/champs-documentation.json' +
  ' — ne pas éditer\n\n';

function chargerContrat() {
  return JSON.parse(fs.readFileSync(CHEMIN_CONTRAT, 'utf8'));
}

// ---- Sérialiseur YAML minimal -----------------------------------------------------------
// Mappings imbriqués, séquences de chaînes, scalaires. Les chaînes sont toujours entre
// guillemets doubles. Les noms de champ doivent être en a-z0-9_ : on le vérifie pour ne pas
// écrire un blueprint invalide.

const CLE_SIMPLE = /^[a-z0-9_]+$/;

function estScalaire(v) {
  return typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';
}

function scalaireYaml(v) {
  if (typeof v === 'boolean' || typeof v === 'number') return String(v);
  // Échappe la barre inverse avant le guillemet.
  return '"' + String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

// `verifierCles` vaut pour les noms de champ. Les clés d'un mapping `options` sont des
// valeurs de liste (« CH », « interpellation-urgente ») et échappent à la règle a-z0-9_.
function serialiserMapping(obj, indent, verifierCles) {
  const pad = ' '.repeat(indent);
  const lignes = [];
  for (const [cle, valeur] of Object.entries(obj)) {
    if (verifierCles && !CLE_SIMPLE.test(cle)) throw new Error('clé YAML hors a-z0-9_ : ' + cle);
    if (valeur === null || valeur === undefined) {
      lignes.push(pad + cle + ': null');
    } else if (estScalaire(valeur)) {
      lignes.push(pad + cle + ': ' + scalaireYaml(valeur));
    } else if (Array.isArray(valeur)) {
      if (valeur.length === 0) { lignes.push(pad + cle + ': []'); continue; }
      lignes.push(pad + cle + ':');
      for (const item of valeur) {
        if (!estScalaire(item)) throw new Error('séquence non scalaire non gérée : ' + cle);
        lignes.push(pad + '  - ' + scalaireYaml(item));
      }
    } else {
      if (Object.keys(valeur).length === 0) { lignes.push(pad + cle + ': {}'); continue; }
      lignes.push(pad + cle + ':');
      const sousCles = cle === 'options' ? false : verifierCles;
      lignes.push(...serialiserMapping(valeur, indent + 2, sousCles));
    }
  }
  return lignes;
}

function serialiserDoc(arbre) {
  return ENTETE + serialiserMapping(arbre, 0, true).join('\n') + '\n';
}

// ---- Options d'une liste --------------------------------------------------------------

// Dans la liste `instrument`, un instrument `local: true` affiche ses cantons entre
// parenthèses (« Anzug (BS) »). La valeur enregistrée reste la valeur de liste seule.
function optionsPourListe(contrat, nomListe) {
  const items = contrat.listes[nomListe];
  if (!items) throw new Error('liste inconnue dans le JSON : ' + nomListe);
  const options = {};
  for (const it of items) {
    let fr = it.fr;
    let de = it.de;
    if (nomListe === 'instrument') {
      const info = contrat.instruments[it.jeton];
      if (info && info.local && info.cantons && info.cantons.length) {
        const suffixe = ' (' + info.cantons.join(', ') + ')';
        fr += suffixe;
        de += suffixe;
      }
    }
    options[it.jeton] = { fr, de };
  }
  return options;
}

// ---- Un champ du JSON -> un champ de blueprint -----------------------------------------
// `title`, le champ natif d'une page Kirby, est traité par champsVersMap().
function champVersYaml(contrat, champ) {
  const c = {};
  switch (champ.saisie) {
    case 'texte':
      c.type = 'text';
      break;
    case 'texte_long':
      c.type = 'textarea';
      break;
    case 'url':
      c.type = 'url';
      break;
    case 'date':
      // `display` (jetons dayjs) règle l'affichage dans le Panel, `format` (jetons PHP)
      // la valeur enregistrée.
      c.type = 'date';
      c.display = 'DD.MM.YYYY';
      c.format = 'Y-m-d';
      break;
    case 'date_partielle':
      // Kirby n'a pas de date partielle : un texte contraint par un motif.
      c.type = 'text';
      c.pattern = '^\\d{4}(-\\d{2}(-\\d{2})?)?$';
      break;
    case 'annee':
      c.type = 'text';
      c.pattern = '^\\d{4}$';
      break;
    case 'liste':
      // Options traduites : un objet par valeur, une clé par langue.
      c.type = 'select';
      c.options = optionsPourListe(contrat, champ.liste);
      break;
    case 'liste_multiple':
      // Séparateur ', ' : c'est le format « a, b » du contrat, que lisent
      // documentation-kirby.py et szh-ressource.lua (le défaut de Kirby est ',').
      c.type = 'multiselect';
      c.options = optionsPourListe(contrat, champ.liste);
      c.separator = ', ';
      break;
    case 'derive':
      // Champ caché : enregistré, mais ni affiché ni modifiable dans le Panel. Pronto le
      // calcule (`curia` depuis `categorie`) ; un hook doit le recalculer quand la
      // catégorie change dans le Panel (docs/A-FAIRE.md).
      c.type = 'hidden';
      break;
    case 'structure':
      // Les `fields` d'une structure s'écrivent comme ceux d'un blueprint.
      c.type = 'structure';
      c.fields = champsVersMap(contrat, champ.champs);
      break;
    case 'fichier':
      c.type = 'files';
      c.max = 1;
      // `store: id` : Pronto désigne le fichier par son nom dans le dossier de la fiche,
      // pas par un UUID Kirby (le défaut).
      c.store = 'id';
      // Le champ `files` n'a pas d'option `accept` : les extensions admises sont dans un
      // gabarit de fichier (blueprintFichier(), files/<clé>.yml), désigné par `uploads`.
      c.uploads = champ.cle;
      break;
    default:
      throw new Error('saisie inconnue dans le JSON : ' + champ.saisie);
  }
  // Un champ sans `traduire` est commun aux deux langues : Pronto le recopie dans les deux
  // fichiers, et `translate: false` le rend non modifiable hors de la langue par défaut.
  //
  // Une structure n'a pas de `translate` : il se règle sur chacun de ses sous-champs (seul
  // `libelle` du `suivi` d'une intervention est traduisible). La doc de Kirby ne dit pas que
  // `translate` est lu sur un sous-champ : à vérifier sur une vraie instance.
  if (champ.saisie !== 'structure' && !champ.traduire) {
    c.translate = false;
  }
  c.label = { fr: champ.libelle.fr, de: champ.libelle.de };
  if (champ.requis) c.required = true;
  if (champ.quand) c.when = champ.quand;
  return c;
}

// Un tableau `champs` du JSON -> le mapping `fields` d'un blueprint (ou d'un champ structure).
function champsVersMap(contrat, champs) {
  const map = {};
  for (const champ of champs) {
    if (champ.cle === 'title') {
      // Le `title` à la racine d'un blueprint nomme le gabarit dans le Panel. Le libellé du
      // champ Title natif se règle en le redéclarant dans `fields.title`, sans `type` (usage
      // courant de Kirby, à vérifier sur une vraie instance). `title` est toujours
      // traduisible, d'où l'absence de `translate`.
      const entree = { label: { fr: champ.libelle.fr, de: champ.libelle.de } };
      if (champ.requis) entree.required = true;
      if (champ.quand) entree.when = champ.quand;
      map.title = entree;
    } else {
      map[champ.cle] = champVersYaml(contrat, champ);
    }
  }
  return map;
}

// ---- Champs système (ausgabe, ordre) --------------------------------------------------
// Numéro et rang d'impression : propres à chaque fichier de langue (`translate: true`, le
// défaut de Kirby, écrit pour être lu), cachés, écrits par Pronto seul.
function champsSystemeVersMap(contrat) {
  const map = {};
  for (const [cle, def] of Object.entries(contrat.champsSysteme)) {
    if (cle.startsWith('_')) continue; // _lisezmoi est une note
    map[cle] = {
      type: 'hidden',
      translate: true,
      label: { fr: def.libelle.fr, de: def.libelle.de }
    };
  }
  return map;
}

// ---- Un type -> son blueprint -----------------------------------------------------------

function blueprintType(contrat, cleType) {
  const type = contrat.types[cleType];
  const doc = {};
  // Nom du gabarit dans le Panel ; le libellé du champ Title est dans fields.title.
  doc.title = { fr: type.libelle.fr, de: type.libelle.de };
  // Même ordre que dans le fichier .txt : Ausgabe et Ordre avant les champs du type.
  doc.fields = Object.assign({}, champsSystemeVersMap(contrat), champsVersMap(contrat, type.champs));
  return doc;
}

// ---- Le dossier d'un type : page parente des fiches ------------------------------------
// Une fiche vit sous _NewsUndActu\Fiches\<dossier du type>\<slug>\. Le dossier du type est
// une page Kirby, dont le blueprint liste les fiches du type.
//
// Le gabarit du dossier porte le nom du dossier (« buecher »), celui d'une fiche la clé du
// type (« livre ») : parent et enfant ont des gabarits distincts.
function nomGabaritDossier(type) {
  if (!/^[a-z]+$/.test(type.dossier)) {
    throw new Error('types[].dossier hors minuscules ASCII [a-z]+ : ' + JSON.stringify(type.dossier));
  }
  return type.dossier.toLowerCase();
}

function blueprintDossierType(contrat, cleType) {
  const type = contrat.types[cleType];
  const doc = {};
  doc.title = { fr: type.libelle.fr, de: type.libelle.de };
  doc.sections = {
    fiches: {
      type: 'pages',
      label: { fr: type.libelle.fr, de: type.libelle.de },
      template: cleType,
      // L'ordre vient du champ `Ordre` calculé par Pronto ; un tri manuel le casserait.
      sortable: false
    }
  };
  return doc;
}

// ---- La page Actualités (parent de la bibliothèque _NewsUndActu\Fiches\) -----------------
// Sans champ ; sa section liste les pages dossier, une par type. Les rubriques des numéros
// ne vont pas sur le site. Voir docs/FORMAT-DOCUMENTATION-KIRBY.md, « Le site Kirby ».
function blueprintActualites(contrat) {
  const doc = {};
  // Le JSON ne nomme pas cette page : à ajuster si le site la nomme autrement.
  doc.title = { fr: 'Actualité et ressources', de: 'News & Ressourcen' };

  // `templates` (pluriel) : une section à plusieurs gabarits, un par dossier de type, dans
  // l'ordre `ordreTypes`.
  doc.sections = {
    dossiers: {
      type: 'pages',
      label: { fr: 'Actualité et ressources', de: 'News & Ressourcen' },
      templates: contrat.ordreTypes.map((cleType) => nomGabaritDossier(contrat.types[cleType])),
      // L'ordre des dossiers est celui d'`ordreTypes`, pas un tri du Panel.
      sortable: false
    }
  };
  return doc;
}

// ---- Gabarits de fichier (champs `fichier`) -----------------------------------------------
//
// Un gabarit par clé de champ : `couverture` sert à `livre` et à `film`. Une même clé avec
// des extensions différentes selon le type est une erreur du contrat, qui arrête la
// génération.
function collecterChampsFichier(champs, acc) {
  for (const champ of champs) {
    if (champ.saisie === 'fichier') {
      const extensions = champ.extensions.slice();
      const existant = acc.get(champ.cle);
      if (existant && JSON.stringify(existant) !== JSON.stringify(extensions)) {
        throw new Error('extensions incohérentes pour le champ fichier "' + champ.cle +
          '" selon le type : ' + JSON.stringify(existant) + ' vs ' + JSON.stringify(extensions));
      }
      acc.set(champ.cle, extensions);
    } else if (champ.saisie === 'structure') {
      collecterChampsFichier(champ.champs, acc);
    }
  }
}

function collecterFichiers(contrat) {
  const acc = new Map();
  for (const type of Object.values(contrat.types)) {
    collecterChampsFichier(type.champs, acc);
  }
  return acc;
}

// Pas de champ `alt` : la couverture ou l'affiche est décorative, elle double le titre. Le
// site rend `alt=""`.
function blueprintFichier(extensions) {
  return { accept: { extension: extensions } };
}

// ---- Assemblage de tous les fichiers cibles ----------------------------------------------

// Rend { 'pages/horizon.yml': arbre, …, 'files/couverture.yml': arbre, … }, un arbre par
// fichier avant sérialisation. Le test parcourt ces arbres.
function construireTous(contrat) {
  const docs = {};
  for (const cleType of Object.keys(contrat.types)) {
    docs['pages/' + cleType + '.yml'] = blueprintType(contrat, cleType);
    const nomDossier = nomGabaritDossier(contrat.types[cleType]);
    docs['pages/' + nomDossier + '.yml'] = blueprintDossierType(contrat, cleType);
  }
  docs['pages/actualites.yml'] = blueprintActualites(contrat);
  for (const [cle, extensions] of collecterFichiers(contrat)) {
    docs['files/' + cle + '.yml'] = blueprintFichier(extensions);
  }
  return docs;
}

function genererContenus(contrat) {
  const docs = construireTous(contrat);
  const contenus = {};
  for (const [nomFichier, arbre] of Object.entries(docs)) {
    contenus[nomFichier] = serialiserDoc(arbre);
  }
  return contenus;
}

// ---- CLI -----------------------------------------------------------------------------

function main() {
  const verifier = process.argv.includes('--verifier');
  const contrat = chargerContrat();
  const contenus = genererContenus(contrat);

  if (!verifier) {
    for (const [nomRelatif, contenu] of Object.entries(contenus)) {
      const chemin = path.join(DOSSIER_BLUEPRINTS, nomRelatif);
      fs.mkdirSync(path.dirname(chemin), { recursive: true });
      fs.writeFileSync(chemin, contenu, 'utf8');
    }
    console.log(Object.keys(contenus).length + ' blueprint(s) écrit(s) dans ' +
      path.relative(RACINE, DOSSIER_BLUEPRINTS));
    return;
  }

  const divergents = [];
  for (const [nomRelatif, attendu] of Object.entries(contenus)) {
    const chemin = path.join(DOSSIER_BLUEPRINTS, nomRelatif);
    let surDisque = null;
    try { surDisque = fs.readFileSync(chemin, 'utf8'); } catch (e) { /* absent */ }
    if (surDisque !== attendu) divergents.push(nomRelatif);
  }
  if (divergents.length) {
    console.error('Blueprints à régénérer (node kirby/generer-blueprints.js) : ' +
      divergents.join(', '));
    process.exitCode = 1;
  } else {
    console.log('Tous les blueprints committés correspondent au JSON.');
  }
}

if (require.main === module) main();

module.exports = {
  CHEMIN_CONTRAT,
  DOSSIER_BLUEPRINTS,
  chargerContrat,
  construireTous,
  genererContenus,
  serialiserDoc
};
