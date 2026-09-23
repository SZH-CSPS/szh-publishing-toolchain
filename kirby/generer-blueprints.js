// Génère les blueprints Kirby (kirby/site/blueprints/{pages,files}/*.yml) depuis le contrat
// unique pipeline/kirby/champs-documentation.json. Zéro dépendance. Voir kirby/LISEZMOI.md.
//
//   node kirby/generer-blueprints.js             régénère et écrit les fichiers
//   node kirby/generer-blueprints.js --verifier   n'écrit rien ; code 1 si un fichier committé
//                                                  diffère de ce que produit le JSON (le nomme)
'use strict';

const fs = require('fs');
const path = require('path');

const RACINE = path.resolve(__dirname, '..');
const CHEMIN_CONTRAT = path.join(RACINE, 'pipeline', 'kirby', 'champs-documentation.json');
// Racine des deux familles de blueprint : kirby/site/blueprints/pages/ (une page par type de
// fiche + documentation.yml) et kirby/site/blueprints/files/ (un gabarit de fichier par champ
// `fichier`, référencé depuis un champ `files` via `uploads:`). Les clés de construireTous()
// portent le sous-dossier ('pages/…', 'files/…').
const DOSSIER_BLUEPRINTS = path.join(__dirname, 'site', 'blueprints');

const ENTETE =
  '# Généré par kirby/generer-blueprints.js depuis pipeline/kirby/champs-documentation.json' +
  ' — ne pas éditer\n\n';

function chargerContrat() {
  return JSON.parse(fs.readFileSync(CHEMIN_CONTRAT, 'utf8'));
}

// ---- Sérialiseur YAML minimal -----------------------------------------------------------
// Juste assez pour nos arbres : mappings imbriqués, séquences de chaînes, scalaires
// (chaîne/bool/nombre). Les chaînes sont toujours entre guillemets doubles : plus simple et
// plus stable qu'un choix au cas par cas, et les blueprints n'ont pas besoin d'un YAML
// « joli ». Les clés de mapping sont déjà en a-z0-9_ par contrat du JSON (voir sa
// `_lisezmoi`) ; on le revérifie ici pour ne jamais écrire un blueprint invalide en silence.

const CLE_SIMPLE = /^[a-z0-9_]+$/;

function estScalaire(v) {
  return typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';
}

function scalaireYaml(v) {
  if (typeof v === 'boolean' || typeof v === 'number') return String(v);
  // Guillemets doubles : on échappe backslash puis guillemet, dans cet ordre.
  return '"' + String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

// `verifierCles` ne s'applique qu'aux noms de CHAMP (fields, structure.fields) : les clés
// d'un mapping `options` sont des jetons de liste (ex. cantons "CH"/"AG", instruments à
// tiret comme "interpellation-urgente"), pas des noms de champ — la règle a-z0-9_ du
// contrat JSON (voir sa `_lisezmoi`) ne les concerne pas.
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

// Pour la liste `instrument` (catégorie d'une intervention), les instruments `local: true`
// portent leurs cantons d'observation entre parenthèses dans le libellé de saisie
// (« Anzug (BS) ») — décision de Robin, TODO_KirbyCMS.md §2. La valeur stockée reste le
// jeton, jamais ce libellé composé.
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
//
// `title` est un cas à part, traité par l'appelant (champsVersMap) : c'est le champ Title
// natif d'une page Kirby, jamais un champ ordinaire.
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
      // Vérifié sur getkirby.com/docs/reference/panel/fields/date (23.09.2026) :
      // `display` (jetons dayjs) pilote l'affichage dans le Panel, `format` (jetons PHP)
      // pilote la valeur enregistrée dans le fichier de contenu.
      c.type = 'date';
      c.display = 'DD.MM.YYYY';
      c.format = 'Y-m-d';
      break;
    case 'date_partielle':
      // Pas de champ « date partielle » chez Kirby : un texte contraint par un motif,
      // comme le prescrit docs/FORMAT-DOCUMENTATION-KIRBY.md.
      c.type = 'text';
      c.pattern = '^\\d{4}(-\\d{2}(-\\d{2})?)?$';
      break;
    case 'annee':
      c.type = 'text';
      c.pattern = '^\\d{4}$';
      break;
    case 'liste':
      // Format des options traduites vérifié sur
      // getkirby.com/docs/reference/panel/fields/select (23.09.2026) : un objet par jeton,
      // avec une clé par langue.
      c.type = 'select';
      c.options = optionsPourListe(contrat, champ.liste);
      break;
    case 'liste_multiple':
      // Vérifié sur getkirby.com/docs/reference/panel/fields/multiselect (23.09.2026) :
      // mêmes options traduites qu'un champ select (un objet par jeton, une clé par
      // langue) ; stocke les jetons choisis en liste séparée par `separator` (par défaut
      // ','). On fixe explicitement ', ' (virgule + espace) pour ne pas dépendre du défaut
      // Kirby et matcher exactement la convention « jeton1, jeton2 » du contrat JSON
      // (champs-documentation.json, `_saisies`) que lisent documentation-kirby.py (valeur
      // transportée telle quelle en attribut) et szh-ressource.lua (jetons éclatés sur la
      // virgule).
      c.type = 'multiselect';
      c.options = optionsPourListe(contrat, champ.liste);
      c.separator = ', ';
      break;
    case 'derive':
      // Champ `hidden` : vérifié sur getkirby.com/docs/reference/panel/fields/hidden
      // (23.09.2026) — stocké dans le fichier de contenu, jamais affiché ni modifiable
      // dans le Panel. Exactement ce qu'il faut : `curia` est écrit par Pronto à chaque
      // enregistrement (champs-documentation.json, champ `depuis`/`table`) et ne se
      // saisit jamais (TODO_KirbyCMS.md §4 : un hook devra le recalculer si `categorie`
      // change dans le Panel, puisque le Panel ne peut pas l'éditer lui-même).
      c.type = 'hidden';
      break;
    case 'structure':
      // `fields` d'un champ structure est un mapping nom -> config, syntaxe identique au
      // `fields` racine d'un blueprint (vérifié sur
      // getkirby.com/docs/reference/panel/fields/structure, 23.09.2026).
      c.type = 'structure';
      c.fields = champsVersMap(contrat, champ.champs);
      break;
    case 'fichier':
      c.type = 'files';
      c.max = 1;
      // `store: id` (et non `uuid`, le défaut Kirby) : le contenu écrit par Pronto référence
      // le fichier par son nom relatif au dossier de la fiche (docs/FORMAT-DOCUMENTATION-
      // KIRBY.md, saisie `fichier`), pas par un UUID Kirby.
      c.store = 'id';
      // Le champ `files` n'a pas d'option `accept` (liste complète vérifiée sur
      // getkirby.com/docs/reference/panel/fields/files, 23.09.2026 : default, disabled,
      // empty, help, image, info, label, layout, link, max, min, multiple, query, required,
      // search, size, store, text, translate, uploads, when, width — `accept` n'y est pas).
      // La restriction par extension passe par un gabarit de fichier séparé, référencé ici
      // via `uploads:` (confirmé dans cette même liste) ; le gabarit lui-même — avec son
      // `accept: extension: […]`, syntaxe vérifiée sur
      // getkirby.com/docs/reference/panel/blueprints/file — est construit par
      // blueprintFichier() plus bas et écrit dans kirby/site/blueprints/files/.
      c.uploads = champ.cle;
      break;
    default:
      throw new Error('saisie inconnue dans le JSON : ' + champ.saisie);
  }
  // Traductibilité (docs/FORMAT-DOCUMENTATION-KIRBY.md : « Champs traduisibles (traduire:true
  // du JSON) … propres à chaque fichier de langue. Tous les autres champs … sont COMMUNS » —
  // Pronto les recopie dans les deux fichiers de langue à l'enregistrement). `translate`
  // (vérifié sur getkirby.com/docs/reference/panel/fields/text, 23.09.2026 : propriété de
  // base de tout champ, défaut true, false « disables the field in non-default languages »)
  // verrouille dans le Panel ce que Pronto tient déjà : un champ commun ne s'édite que dans
  // la langue par défaut du site, jamais divergent entre les deux fichiers.
  //
  // Exception : un champ `structure` lui-même n'a pas de `translate` ici — sa traductibilité
  // se règle sous-champ par sous-champ (récursion dans `fields`, juste au-dessus). INCERTITUDE
  // : la doc du champ structure ne documente `translate` qu'au niveau du champ ENTIER
  // (« the field will be disabled in non-default languages ») ; qu'il soit aussi lu par
  // Kirby sur un sous-champ de `fields` n'est confirmé nulle part noir sur blanc — on part du
  // principe que oui, puisque `translate` est une propriété de base commune à tout champ, à
  // vérifier sur une vraie instance (cas réel : `suivi` d'une intervention, où seul le
  // sous-champ `libelle` est traduisible, voir champsSysteme plus loin pour un autre biais).
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
      // Le champ Title natif d'une page Kirby. INCERTITUDE tranchée par la doc (vérifiée
      // 23.09.2026, getkirby.com/docs/reference/panel/blueprints/page) : le `title:` à la
      // racine d'un blueprint est le nom du GABARIT dans le sélecteur de modèle du Panel
      // (« shown in the panel dropdown when creating new pages »), pas le libellé du champ
      // Title lui-même. Pour changer ce libellé sans changer le champ natif, on le redéclare
      // dans `fields.title` SANS `type:` (pratique Kirby usuelle pour ce champ précis ; pas
      // trouvée noir sur blanc dans la doc récupérée — à confirmer sur une vraie instance).
      // Pas de `translate` ici : `title` porte toujours `traduire: true` dans le JSON (c'est
      // un champ traduisible par construction, voir champVersYaml), donc la valeur par
      // défaut de Kirby (true) est déjà la bonne.
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
//
// docs/FORMAT-DOCUMENTATION-KIRBY.md : « Champs système (champsSysteme), propres à chaque
// fichier de langue, jamais saisis : Ausgabe = id du numéro de cette langue … ; Ordre = rang
// d'impression … ». C'est l'INVERSE du sort par défaut de champVersYaml() ci-dessus : ces deux
// champs ne sont PAS recopiés d'une langue à l'autre par Pronto (une fiche appartient à un
// numéro par langue, donc à un rang par langue) — `translate` reste donc à sa valeur par
// défaut Kirby (true), explicitée ici pour ne pas dépendre d'un défaut qu'on ne lirait pas au
// même endroit que la règle inverse. `hidden` (même raisonnement que `derive` plus haut) :
// jamais saisi dans le Panel, Pronto seul les écrit et les recalcule.
function champsSystemeVersMap(contrat) {
  const map = {};
  for (const [cle, def] of Object.entries(contrat.champsSysteme)) {
    if (cle.startsWith('_')) continue; // _lisezmoi : une note, pas un champ
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
  // Nom du gabarit dans le Panel (voir la note ci-dessus sur `title` à la racine) — pas le
  // libellé du champ Title, réglé séparément dans fields.title.label.
  doc.title = { fr: type.libelle.fr, de: type.libelle.de };
  // Ordre d'écriture d'un fichier .txt (docs/FORMAT-DOCUMENTATION-KIRBY.md) : Title, Uuid,
  // Ausgabe, Ordre, puis les champs du JSON — Uuid est le mécanisme natif de Kirby (pas un
  // champ de blueprint, voir kirby/LISEZMOI.md) ; Ausgabe et Ordre sont donc placés avant les
  // champs propres au type.
  doc.fields = Object.assign({}, champsSystemeVersMap(contrat), champsVersMap(contrat, type.champs));
  return doc;
}

// ---- Le dossier d'un type (types[].dossier, ex. buecher\) : page parente des fiches --------
//
// Depuis 8e89548 (docs/FORMAT-DOCUMENTATION-KIRBY.md, « Une fiche ») : une fiche vit sous
// `_NewsUndActu\Fiches\<dossier du type>\<slug>\`, un sous-dossier PAR TYPE
// (rundschau/forschung/vorstoesse/buecher/filme/revueblick/weiterbildung). Ce sous-dossier est
// lui-même une page Kirby, entre la bibliothèque (actualites.yml) et les fiches : elle a donc
// son propre blueprint, une section `pages` listant les fiches de CE type.
//
// Nom de gabarit / de fichier : le dossier en minuscules (« buecher », jamais « livre »).
// Deux noms distincts sont nécessaires — le dossier ET les fiches qu'il contient sont deux
// pages Kirby différentes (parent/enfant), donc deux gabarits différents ; réutiliser la clé
// de type (« livre ») pour le dossier aurait fait porter le même nom de gabarit aux deux
// niveaux, ambigu pour Kirby comme pour quiconque lit `content/`. `types[].dossier` est déjà
// un mot allemand en ASCII posé pour être un segment d'adresse (JSON, `_dossiers`) : la
// minuscule est la seule transformation nécessaire pour en faire un nom de gabarit valide.
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
      // Même raisonnement que pour actualites.yml plus bas : Pronto calcule déjà l'ordre
      // d'impression dans le champ `Ordre` de chaque fiche (TODO_KirbyCMS.md §3), un tri
      // manuel dans le Panel le romprait au prochain aller-retour.
      sortable: false
    }
  };
  return doc;
}

// ---- La page Actualités (parent de la bibliothèque _NewsUndActu\Fiches\) -----------------
//
// Avant la bibliothèque partagée, cette page était la Documentation d'UN numéro, et portait
// aussi les rubriques de texte libre. Ce n'est plus le cas (docs/FORMAT-DOCUMENTATION-
// KIRBY.md, section « Le numéro ») : « Les rubriques ne partent jamais sur Kirby » — elles
// restent dans documentation.<lang>.txt DU NUMÉRO (hors de tout blueprint généré ici). Et
// depuis 8e89548, les fiches ne sont plus des enfants directs de cette bibliothèque : un
// niveau intermédiaire s'est ajouté, le dossier de chaque type (blueprintDossierType
// ci-dessus). D'où : pas de blueprint de rubriques (rien à générer pour elles côté Kirby),
// cette page n'a toujours pas de `fields`, et sa section unique liste maintenant les SEPT
// PAGES DOSSIER (une par type) au lieu des fiches directement comme avant 8e89548.
function blueprintActualites(contrat) {
  const doc = {};
  // Pas de libellé dans le JSON pour cette page elle-même : nom repris de l'intitulé de la
  // fonctionnalité dans TODO_KirbyCMS.md (« Actualité et ressources » / « News & Ressourcen »,
  // §5 : « content/actualites/ »). À ajuster si ce nom change côté site.
  doc.title = { fr: 'Actualité et ressources', de: 'News & Ressourcen' };

  // `templates:` (pluriel) plutôt que `template:` : une section `pages` accepte une liste de
  // gabarits (getkirby.com/docs/reference/panel/sections/pages, 23.09.2026 — « template » au
  // singulier pour un seul, « templates » au pluriel pour plusieurs) ; il en faut sept ici,
  // un par dossier de type, dans l'ordre `ordreTypes`.
  doc.sections = {
    dossiers: {
      type: 'pages',
      label: { fr: 'Actualité et ressources', de: 'News & Ressourcen' },
      templates: contrat.ordreTypes.map((cleType) => nomGabaritDossier(contrat.types[cleType])),
      // Même raison qu'avant 8e89548 (Pronto calcule l'ordre, TODO_KirbyCMS.md §3) ; les
      // pages dossier elles-mêmes n'ont de toute façon pas d'ordre à respecter entre elles
      // (l'ordre d'impression est celui d'`ordreTypes`, pas un tri du Panel).
      sortable: false
    }
  };
  return doc;
}

// ---- Gabarits de fichier (champs `fichier`) -----------------------------------------------
//
// Un gabarit par CLÉ de champ (pas par type) : `couverture` est la même clé pour `livre` et
// `film`, donc le même gabarit de fichier — pas de doublon. Si deux types utilisaient un jour
// la même clé avec des extensions différentes, ce serait une incohérence du contrat JSON
// lui-même : on la fait échouer bruyamment plutôt que de choisir un des deux en silence.
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

// Décorative (TODO_KirbyCMS.md §10 : couverture d'un livre, affiche d'un film — l'image
// double le titre, déjà lu par un lecteur d'écran ; parti du PDF, PDF/UA). Donc pas de champ
// `alt` ici : rien à saisir, le site doit rendre `alt=""` de lui-même.
function blueprintFichier(extensions) {
  return { accept: { extension: extensions } };
}

// ---- Assemblage de tous les fichiers cibles ----------------------------------------------

// Retourne { 'pages/horizon.yml': arbre, …, 'pages/actualites.yml': arbre,
// 'files/couverture.yml': arbre, … } — un arbre par fichier, avant sérialisation (utilisé tel
// quel par le test pour parcourir les noms de champs).
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
