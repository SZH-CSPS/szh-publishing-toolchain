// Active extension.js avec un faux « vscode », sur une revue temporaire, et rend de quoi
// l'interroger : le fournisseur d'arbre, les panneaux ouverts, la table des commandes.
//
// Pourquoi ce filet. Deux pannes ont traversé les contrôles de source sans être vues :
// une fonction supprimée par erreur avec ses voisines, qui laissait le formulaire des
// métadonnées inouvrable, et une commande posée après le `return` de la méthode qui la
// portait, qui laissait un onglet de la barre latérale sans effet. Les deux se voient en
// une ligne dès qu'on active l'extension pour de vrai.
//
// Un seul appel d'activerHote() par processus : le crochet de Module._load et le cache de
// require ne se défont pas. `node --test` donne un processus par fichier, ce qui suffit.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const LF = String.fromCharCode(10);

// Garde-fou anti-réseau. Posée dès que ce fichier est chargé — avant tout require de
// extension.js — pour couvrir le crochet Module._load ci-dessous autant que les caches
// écrits plus bas. lib/auteurs-ojs.js (recupererHttps) est le SEUL endroit de tout le
// cockpit qui ouvre une vraie connexion https ; lib/mots-cles-edudoc.js le réutilise tel
// quel plutôt que d'en écrire un second. Une seule variable, respectée à cet unique
// endroit, couvre donc les deux moissonneurs — et n'importe quel futur module qui s'y
// brancherait. Si un test laisse passer un appel réel malgré un cache qu'on croyait frais
// (nouvelle migration de format, oubli d'un `recuperer` factice…), l'appel échoue tout de
// suite avec un message clair, au lieu de partir en silence interroger ojs.szh.ch ou
// edudoc.ch — la panne qui a motivé ce garde-fou (voir plus bas, cache des auteur·e·s).
process.env.SZH_RESEAU_INTERDIT = '1';

// Les deux fichiers du poste — C:\ProgramData\SZH\config.json et state.json — sont
// détournés vers des fichiers vides, pour la même raison que le garde-fou anti-réseau
// juste au-dessus : un test ne doit rien lire de la machine qui l'exécute. Le second est
// arrivé avec la cascade de langue (lib/i18n.js) : state.json porte la langue du dernier
// lanceur ouvert, et sans ce détour la suite entière basculait en allemand sur un poste
// allemand — mille assertions comparées à des textes français. Le premier ferait de même
// le jour où un rédacteur cache les tâches de la vue « Articles », choix qui vit dans
// config.json. Posés seulement s'ils ne le sont pas déjà : plusieurs contrôles pointent
// SZH_CONFIG_OJS vers leur propre fichier, et c'est le leur qui doit gagner.
const POSTE_ESSAI = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-poste-'));
for (const [variable, nom] of [['SZH_CONFIG_OJS', 'config.json'], ['SZH_ETAT_POSTE', 'state.json']]) {
  if (process.env[variable]) { continue; }
  const chemin = path.join(POSTE_ESSAI, nom);
  fs.writeFileSync(chemin, '{}' + LF);
  process.env[variable] = chemin;
}

// Une revue minimale mais complète : deux articles dont un sans fiche, un portrait à ses
// trois versions désigné par la fiche, une image insérée dans le texte, un Word en attente
// et le rapport de la dernière conversion.
function revueDEssai() {
  const revue = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-hote-'));
  fs.writeFileSync(path.join(revue, 'ausgabe.yaml'),
    ['revue: "Revue suisse de pedagogie specialisee"', 'title: "Essai"', 'lang: fr',
     'volume: "16"', 'numero: "1"', 'couleur: bleuacier', ''].join(LF));

  const slug = '01-essai';
  const dossier = path.join(revue, 'articles', slug);
  fs.mkdirSync(path.join(dossier, 'media'), { recursive: true });
  fs.writeFileSync(path.join(dossier, slug + '.md'),
    ['Un paragraphe.', '', '![Une legende](media/a.png){alt="desc"}', ''].join(LF));
  fs.writeFileSync(path.join(dossier, 'media', 'a.png'), Buffer.alloc(64));
  fs.writeFileSync(path.join(dossier, slug + '.meta.yaml'),
    ['type: article', 'doi: "10.57161/x"', 'title:', '  fr: "Titre"', 'author:',
     '- prenom: "Anne"', '  nom: "Dupont"',
     '  photo: "portraits/anne-dupont.sans-fond.png"', ''].join(LF));
  const portraits = path.join(dossier, 'portraits');
  fs.mkdirSync(portraits, { recursive: true });
  for (const n of ['anne-dupont.original.jpg', 'anne-dupont.avec-fond.png', 'anne-dupont.sans-fond.png']) {
    fs.writeFileSync(path.join(portraits, n), Buffer.alloc(128));
  }

  // La bibliographie détachée à l'import : un fichier voisin du .md, comme la fiche et les
  // tâches. L'autre article n'en a pas — un article sans bibliographie ne doit rien montrer.
  fs.writeFileSync(path.join(dossier, slug + '.biblio.md'),
    ['Dupont, A. (2024). *Un titre*. SZH.', '', 'Muller, B. (2023). Un autre titre. CSPS.',
     ''].join(LF));

  const tables = path.join(dossier, 'tables');
  fs.mkdirSync(tables, { recursive: true });
  fs.copyFileSync(
    path.join(__dirname, '..', 'articles', 'contenu-long', 'tables', 'table-01.html'),
    path.join(tables, 'table-01.html'));

  const autre = path.join(revue, 'articles', '02-sans-fiche');
  fs.mkdirSync(autre, { recursive: true });
  fs.writeFileSync(path.join(autre, '02-sans-fiche.md'), 'Texte.' + LF);

  const word = path.join(revue, 'articles-word');
  fs.mkdirSync(word, { recursive: true });
  fs.writeFileSync(path.join(word, '9_Essai.docx'), Buffer.alloc(32));
  fs.writeFileSync(path.join(word, '.import.log'),
    ['[import] converti : 3_Scolariser.docx -> articles/03-scolariser/03-scolariser.md',
     '[import] déjà converti (ignoré) : 1_Edito.docx -> articles/01-edito/01-edito.md existe',
     '[import] ⚠ échec sur : 7_Varia.docx (le fichier reste dans articles-word/)',
     '[import] terminé : 1 converti(s), 1 ignoré(s), 1 échec(s).', ''].join(LF));
  return revue;
}

function activerHote(revue) {
  const cockpit = path.join(__dirname, '..', '..', 'vscodium-extension', 'szh-cockpit');
  // Un cache d'auteur·e·s FRAIS avant l'activation : l'extension rafraîchit la liste
  // OAI-PMH en tâche de fond quand dateFetch a plus de trente jours, et aucun test ne doit
  // faire de réseau. Le fichier sert aussi de corpus au message auteurs-connus.
  //
  // Écrit directement en FORME v2 (lib/auteurs-ojs.js) : un cache v1 se ferait migrer par
  // lireCache(), qui remet dateFetch à null — « périmé », donc moissonné pour de vrai. C'est
  // exactement ce qui s'est produit (25.08.2026 -> 31.08.2026) : les 19 tests qui passent par
  // cet hôte factice interrogeaient réellement ojs.szh.ch, en silence, à chaque exécution.
  process.env.SZH_AUTEURS_CACHE = path.join(revue, 'auteurs.json');
  fs.writeFileSync(process.env.SZH_AUTEURS_CACHE, JSON.stringify({
    version: 2, dateFetch: new Date().toISOString(), dateCorpus: null, ror: {}, vus: {},
    auteurs: [
      { prenom: 'Robin', nom: 'Morand', datePublication: '2026-01-01T00:00:00Z' },
      { prenom: 'Anne', nom: 'Dupont', datePublication: '2025-06-01T00:00:00Z' }
    ]
  }, null, 2) + LF);
  // Même précaution pour le vocabulaire edudoc.ch (lib/mots-cles-edudoc.js) : un cache
  // FRAIS avant l'activation, sans quoi rafraichirMotsClesConnusEnFond (extension.js) le
  // jugerait périmé (plus de sept jours) et ferait un vrai appel réseau. Le fichier sert
  // aussi de corpus au message mots-cles-connus.
  process.env.SZH_MOTS_CLES_CACHE = path.join(revue, 'mots-cles.json');
  fs.writeFileSync(process.env.SZH_MOTS_CLES_CACHE, JSON.stringify({
    dateFetch: new Date().toISOString(),
    motsCles: [
      { de: 'Sonderpädagogik', fr: 'pédagogie spécialisée', manque: null },
      { de: 'Inklusion', fr: 'inclusion', manque: null }
    ]
  }, null, 2) + LF);
  const evenement = () => () => ({ dispose() {} });
  // Un événement dont on garde les abonnés, pour pouvoir le déclencher depuis un test.
  // `evenement()` jette le gestionnaire : suffisant pour la plupart, pas pour la fin d'une
  // tâche, qui est le seul endroit où le cockpit apprend ce que la chaîne a relevé.
  const emetteur = () => {
    const abonnes = [];
    const brancher = (f) => { abonnes.push(f); return { dispose() {} }; };
    brancher.emettre = (e) => { for (const f of abonnes.slice()) { f(e); } };
    return brancher;
  };
  const finTache = emetteur();
  // La dernière TaskExecution rendue par executeTask(), par nom de tâche : lancerTache()
  // (extension.js) n'accepte la fin de SA tâche que sur `e.execution === execution`, la
  // même référence que celle rendue par vscode.tasks.executeTask(). Sans elle, finirTache()
  // ne pouvait faire aboutir que le SUIVEUR global (onDidStartTask/onDidEndTaskProcess,
  // qui ne compare que le nom) — jamais l'attente propre de lancerTache(), ce qui interdit
  // de tester une compilation du cockpit qui va à son terme. Vide tant que fetchTasks()
  // ne rend rien (le défaut) : finirTache() retombe alors sur la forme d'avant.
  const executionsParTache = {};
  // Le démarrage d'une tâche (onDidStartTask), et sa fin SANS notification de processus
  // (onDidEndTask) : le chemin le plus fréquent (Ctrl+S, triggerTaskOnSave) ne passe par
  // aucune fonction du cockpit, seulement par ces deux événements globaux. Même repli que
  // finTache quand le cockpit n'a pas lui-même lancé la tâche nommée.
  const debutTache = emetteur();
  const finTacheBrute = emetteur();
  // Les deux événements du défilement synchronisé aperçu HTML (pousserDefilementVersApercu,
  // pousserSurlignageVersApercu, extension.js) : réels et non jetés, pour qu'un test puisse
  // simuler un geste dans l'éditeur SANS ouvrir une vraie fenêtre.
  const rangesVisibles = emetteur();
  const selectionEditeur = emetteur();
  // Les réglages « szh.* » écrits par update() : un faux getConfiguration() qui les
  // oublierait rendrait basculerApercu invérifiable — son .update() ne se verrait jamais
  // au .get() suivant. Une seule table pour tout l'hôte, comme le ferait VS Code au niveau
  // Global (aucun cockpit n'écrit à un autre niveau).
  const configValeurs = {};
  const barres = [];
  const panneaux = [];
  const avertissements = [];
  const statuts = [];          // ce que setStatusBarMessage a affiché, dans l'ordre
  const erreurs = [];
  const motifsSurveilles = []; // les motifs passés à createFileSystemWatcher, dans l'ordre
  let arbre = null;
  let controleurDepot = null;   // dragAndDropController de la TreeView (.docx glissés dessus)
  // Ce que showWarningMessage rendra, dans l'ordre des appels : une file, et non une seule
  // valeur, parce qu'un geste peut désormais en enchaîner deux — le dialogue de
  // remplacement renvoie vers celui de « poser à côté », et le test doit répondre aux deux.
  // File vide -> undefined, c'est-à-dire « Annuler », comme avant.
  const reponsesModales = [];
  // Le chemin que showSaveDialog rendra : null = « Annuler ».
  let cibleEnregistrement = null;
  // L'appel entier, pour les contrôles qui portent sur les ISSUES OFFERTES et pas seulement
  // sur la question posée : un bouton perdu ne change rien à la question.
  const modales = [];
  // La TreeView : reveal() est enregistré (resélection d'un article), et les événements de
  // chevron sont déclenchables depuis un test (accordéon des sections).
  const revelations = [];
  const expansions = emetteur();
  const replis = emetteur();
  // Le décorateur de fichiers (point de l'article ouvert), interrogeable par chemin, et
  // l'événement d'éditeur actif, déclenchable.
  let decorateur = null;
  const editeurActif = emetteur();

  function fauxPanneau(type, titre) {
    const p = {
      type: type, title: titre, html: null, messages: [], _recepteur: null,
      webview: {
        set html(v) { p.html = v; },
        get html() { return p.html; },
        postMessage(m) { p.messages.push(m); return Promise.resolve(true); },
        onDidReceiveMessage(f) { p._recepteur = f; return { dispose() {} }; },
        asWebviewUri: (u) => u, cspSource: ''
      },
      reveal() {}, dispose() { if (p.onDispose) { p.onDispose(); } },
      onDidDispose(f) { p.onDispose = f; return { dispose() {} }; },
      onDidChangeViewState: evenement()
    };
    panneaux.push(p);
    return p;
  }

  const stub = {
    EventEmitter: class { constructor() { this.event = () => ({ dispose() {} }); } fire() {} },
    Uri: {
      // `with` comme dans l'API : le cockpit s'en sert pour rhabiller le chemin d'une copie
      // en conflit sous son propre schéma (szh-conflit), ce qui en fait l'« original » du
      // fichier du numéro aux yeux du diff rapide.
      file: (p) => {
        const faire = (schema) => ({
          fsPath: p, scheme: schema, path: p,
          with: (parties) => faire((parties && parties.scheme) || schema),
          toString: () => schema + '://' + p
        });
        return faire('file');
      },
      // Reprend le « schéma://reste » que Uri.file(p).toString() produit ci-dessus, sans
      // rien décoder (rien n'est encodé au départ) : controleurDepotVue (extension.js) lit
      // un « text/uri-list » déposé sur l'arbre et en tire ses .docx par ce chemin.
      parse: (s) => {
        const texte = String(s || '');
        const m = texte.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):\/\/(.*)$/);
        return m ? { fsPath: m[2], scheme: m[1] } : { fsPath: texte, scheme: '' };
      }
    },
    Position: class { constructor(l, c) { this.line = l; this.character = c; } },
    // Les deux formes de l'API réelle : (Position, Position) et (ligne, colonne, ligne,
    // colonne) — revelerLigneSource (extension.js) emploie la seconde.
    Range: class {
      constructor(a, b, c, d) {
        if (typeof a === 'number') {
          this.start = new stub.Position(a, b); this.end = new stub.Position(c, d);
        } else { this.start = a; this.end = b; }
      }
    },
    Selection: class { constructor(a, b) { this.start = a; this.end = b; this.active = b; } },
    WorkspaceEdit: class { replace() {} insert() {} },
    TreeItem: class { constructor(l, c) { this.label = l; this.collapsibleState = c; } },
    ThemeIcon: class { constructor(i, couleur) { this.id = i; this.color = couleur; } },
    ThemeColor: class { constructor(i) { this.id = i; } },
    RelativePattern: class { constructor(b, m) { this.base = b; this.pattern = m; } },
    TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
    StatusBarAlignment: { Left: 1, Right: 2 },
    ViewColumn: { One: 1, Two: 2 },
    TextEditorRevealType: { Default: 0, InCenter: 1, InCenterIfOutsideViewport: 2, AtTop: 3 },
    ConfigurationTarget: { Global: 1, Workspace: 2 },
    QuickPickItemKind: { Separator: -1, Default: 0 },
    ProgressLocation: { Notification: 15 },
    // Les pièces d'une tâche construite à la main. tacheMakeArticle() (extension.js) est le
    // seul endroit du cockpit qui en fabrique une : partout ailleurs on reprend une tâche
    // déjà déclarée dans tasks.json, via fetchTasks(). Elles manquaient ici, si bien que
    // « Exporter cet article » levait « vscode.ProcessExecution is not a constructor » dès
    // sa première ligne — envelopperCommande avalait l'exception, et le geste ne faisait
    // simplement rien. Aucun contrôle ne pouvait le voir : ce chemin n'était pas jouable.
    // Les champs retenus sont ceux que le harnais lit (`name`, `definition`) et ceux que le
    // cockpit relit après coup ; le reste est gardé tel quel, sans interprétation.
    ProcessExecution: class {
      constructor(processus, args, options) {
        this.process = processus;
        this.args = args || [];
        this.options = options;
      }
    },
    Task: class {
      constructor(definition, cible, nom, source, execution, problemes) {
        this.definition = definition;
        this.scope = cible;
        this.name = nom;
        this.source = source;
        this.execution = execution;
        this.problemMatchers = problemes || [];
        this.presentationOptions = {};
      }
    },
    TaskScope: { Global: 1, Workspace: 2 },
    TaskRevealKind: { Always: 1, Silent: 2, Never: 3 },
    TaskPanelKind: { Shared: 1, Dedicated: 2, New: 3 },
    env: {
      language: 'fr', clipboard: { writeText: () => Promise.resolve() },
      openExternal: () => Promise.resolve(true)
    },
    extensions: { getExtension: () => undefined },
    commands: {
      _table: {},
      registerCommand(id, fn) { stub.commands._table[id] = fn; return { dispose() {} }; },
      executeCommand(id, ...a) {
        if (id === 'setContext') { return Promise.resolve(); }
        if (stub.commands._table[id]) { return Promise.resolve(stub.commands._table[id](...a)); }
        return Promise.resolve();
      },
      getCommands: () => Promise.resolve(Object.keys(stub.commands._table))
    },
    window: {
      activeTextEditor: undefined,
      visibleTextEditors: [],
      tabGroups: { all: [], close: () => Promise.resolve(true) },
      createTreeView: (id, opts) => {
        arbre = (opts || {}).treeDataProvider || null;
        controleurDepot = (opts || {}).dragAndDropController || null;
        return {
          title: '', visible: true, dispose() {},
          onDidChangeSelection: evenement(),
          onDidExpandElement: expansions,
          onDidCollapseElement: replis,
          reveal: (element, options) => {
            revelations.push({ element: element, options: options });
            return Promise.resolve();
          }
        };
      },
      registerFileDecorationProvider: (p) => { decorateur = p; return { dispose() {} }; },
      createStatusBarItem: () => {
        const b = { visible: false, text: '', tooltip: '', command: '',
                    show() { b.visible = true; }, hide() { b.visible = false; }, dispose() {} };
        barres.push(b);
        return b;
      },
      createWebviewPanel: (type, titre) => fauxPanneau(type, titre),
      showWarningMessage: (m, ...reste) => {
        avertissements.push(m);
        const options = (reste[0] && typeof reste[0] === 'object') ? reste[0] : null;
        modales.push({
          message: m, options: options,
          boutons: (options ? reste.slice(1) : reste).map(String)
        });
        return Promise.resolve(reponsesModales.length > 0 ? reponsesModales.shift() : undefined);
      },
      showInformationMessage: () => Promise.resolve(undefined),
      showErrorMessage: (m) => { erreurs.push(m); return Promise.resolve(undefined); },
      // Les messages passagers de la barre d'état : c'est souvent le SEUL signe qu'un geste
      // est allé jusqu'au bout, la plupart écrivant par WorkspaceEdit que ce harnais ne
      // rejoue pas. Retenus dans l'ordre, lisibles par `statutsDits`.
      setStatusBarMessage: (m) => { statuts.push(String(m)); return { dispose() {} }; },
      showOpenDialog: () => Promise.resolve(undefined),
      // Le chemin que showSaveDialog rendra, posé par le test (`repondreEnregistrement`).
      // undefined = l'utilisateur a annulé, et c'est le défaut.
      showSaveDialog: () => Promise.resolve(cibleEnregistrement
        ? { fsPath: cibleEnregistrement } : undefined),
      withProgress: (o, f) => f({ report() {} }),
      onDidChangeActiveTextEditor: editeurActif,
      onDidChangeTextEditorVisibleRanges: rangesVisibles,
      onDidChangeTextEditorSelection: selectionEditeur,
      showTextDocument: () => Promise.resolve({ document: {}, selection: null, revealRange() {} }),
      showQuickPick: () => Promise.resolve(undefined),
      showInputBox: () => Promise.resolve(undefined)
    },
    workspace: {
      workspaceFolders: [{ uri: { fsPath: revue }, name: path.basename(revue), index: 0 }],
      // Persiste ce qu'update() écrit : sans ça, basculerApercu (szh.apercuMode) ne se
      // vérifie pas, son .update() ne changeant jamais ce que le .get() suivant rend.
      getConfiguration: (section) => {
        const prefixe = section ? section + '.' : '';
        return {
          get: (cle, defaut) => {
            const cheminCle = prefixe + cle;
            return Object.prototype.hasOwnProperty.call(configValeurs, cheminCle)
              ? configValeurs[cheminCle] : defaut;
          },
          update: (cle, valeur) => { configValeurs[prefixe + cle] = valeur; return Promise.resolve(); },
          // La sonde des réglages de la maison (poserReglagesMaison) lit le défaut EFFECTIF
          // de chaque clé pour savoir laquelle la contribution n'a pas prise. Ce harnais n'a
          // pas de couche de défauts : il rend ce qui a été écrit, et undefined sinon —
          // toutes les clés paraissent donc « à poser », ce qui est le cas le plus complet.
          inspect: (cle) => ({
            key: prefixe + cle,
            defaultValue: undefined,
            globalValue: Object.prototype.hasOwnProperty.call(configValeurs, prefixe + cle)
              ? configValeurs[prefixe + cle] : undefined
          })
        };
      },
      // Les motifs sont RETENUS : surveiller un chemin qui n'existe pas ne lève rien, et un
      // arbre qui ne se rafraîchit jamais ressemble à un arbre à jour. Seule la liste des
      // motifs demandés distingue les deux.
      createFileSystemWatcher: (motif) => {
        motifsSurveilles.push(motif && motif.pattern !== undefined ? motif.pattern : String(motif));
        return {
          onDidCreate: evenement(), onDidChange: evenement(), onDidDelete: evenement(), dispose() {}
        };
      },
      onDidChangeWorkspaceFolders: evenement(),
      onDidChangeConfiguration: evenement(),
      onDidSaveTextDocument: evenement(),
      openTextDocument: (p) => {
        const chemin = typeof p === 'string' ? p : p.fsPath;
        const texte = fs.readFileSync(chemin, 'utf8');
        const lignes = texte.split(LF);
        return Promise.resolve({
          uri: stub.Uri.file(chemin), lineCount: lignes.length,
          getText: () => texte,
          lineAt: (i) => ({ text: lignes[i], range: { end: new stub.Position(i, lignes[i].length) } }),
          save: () => Promise.resolve(true), positionAt: () => new stub.Position(0, 0)
        });
      },
      applyEdit: () => Promise.resolve(true),
      fs: { stat: () => Promise.resolve({}) },
      // Le contenu servi sous un schéma à nous : celui des copies en conflit, que le
      // fournisseur de diff rapide donne pour « original » du fichier du numéro.
      _contenus: {},
      registerTextDocumentContentProvider: (schema, fournisseur) => {
        stub.workspace._contenus[schema] = fournisseur;
        return { dispose() {} };
      }
    },
    // Le contrôle de source. Le cockpit n'en crée un que s'il existe une copie en conflit, et
    // le détruit dès qu'il n'en reste plus : un test lit donc `vivant` autant que le contenu
    // du groupe.
    scm: {
      _controles: [],
      createSourceControl(id, label, rootUri) {
        const sc = {
          id: id, label: label, rootUri: rootUri, count: 0,
          quickDiffProvider: null, groupes: [], vivant: true,
          createResourceGroup(idGroupe, libelle) {
            const groupe = { id: idGroupe, label: libelle, resourceStates: [], dispose() {} };
            sc.groupes.push(groupe);
            return groupe;
          },
          dispose() { sc.vivant = false; }
        };
        stub.scm._controles.push(sc);
        return sc;
      }
    },
    tasks: {
      onDidStartTask: debutTache, onDidEndTaskProcess: finTache, onDidEndTask: finTacheBrute,
      fetchTasks: () => Promise.resolve([]),
      executeTask: (tache) => {
        const execution = { task: tache };
        if (tache && tache.name) { executionsParTache[tache.name] = execution; }
        return Promise.resolve(execution);
      }
    },
    languages: { registerHoverProvider: () => ({ dispose() {} }) }
  };

  const orig = Module._load;
  Module._load = function (r, p, i) {
    if (r === 'vscode') { return stub; }
    const m = orig(r, p, i);
    // Le dormeur WSL garderait le processus en vie, et réveillerait la distro pour rien.
    if (m && typeof m.demarrerDormeurWsl === 'function') {
      return Object.assign({}, m, {
        demarrerDormeurWsl: () => {}, arreterDormeurWsl: () => {},
        reveillerWsl: () => Promise.resolve()
      });
    }
    return m;
  };

  const ext = require(path.join(cockpit, 'extension.js'));
  // Un globalState qui SE SOUVIENT : deux mécanismes n'agissent qu'une fois par valeur
  // voulue (les réglages de la maison, les réglages protégés) et se règlent sur ce qu'il
  // porte. Un état qui oublie tout les ferait rejouer à chaque activation, et le contrôle
  // du « une seule fois » n'aurait rien à mesurer.
  const memoire = {};
  const contexte = {
    subscriptions: [], extensionPath: cockpit,
    globalState: {
      get: (cle) => memoire[cle],
      update: (cle, valeur) => { memoire[cle] = valeur; return Promise.resolve(); }
    }
  };
  ext.activate(contexte);

  return {
    stub: stub,
    commandes: () => Object.keys(stub.commands._table),
    executer: (id, ...args) => stub.commands.executeCommand(id, ...args),
    arbre: () => arbre,
    // Le dragAndDropController posé sur la TreeView (controleurDepotVue, extension.js) :
    // de quoi simuler un .docx glissé sur l'arbre, sans passer par un vrai DataTransfer.
    controleurDepot: () => controleurDepot,
    panneaux: panneaux,
    dernierPanneau: () => panneaux[panneaux.length - 1] || null,
    // Les panneaux sont des singletons : rouvrir en révèle un, sans en créer. On le
    // retrouve donc par son type, et non par l'ordre de création.
    panneauDeType: (type) => panneaux.filter((x) => x.type === type).pop() || null,
    // Ce que showSaveDialog rendra au prochain appel ; null pour simuler « Annuler ».
    repondreEnregistrement: (chemin) => { cibleEnregistrement = chemin; },
    memoire: memoire,
    avertissements: avertissements,
    erreurs: erreurs,
    motifsSurveilles: () => motifsSurveilles.slice(),
    // Les contrôles de source encore en vie, et le fournisseur de contenu d'un schéma :
    // de quoi éprouver la résolution des copies en conflit.
    sourceControls: () => stub.scm._controles.filter((c) => c.vivant),
    fournisseurContenu: (schema) => stub.workspace._contenus[schema],
    // Les articles de la barre d'état, dans l'ordre de création : un test lit leur texte.
    barres: barres,
    barreQuiDit: (fragment) => barres.filter(
      (b) => b.visible && String(b.text).indexOf(fragment) !== -1).pop() || null,
    // Simule la fin d'une tâche de la chaîne, comme VS Code la signale. Reprend la
    // TaskExecution qu'executeTask() a rendue pour ce nom, si le cockpit a bien lancé LUI-
    // MÊME cette tâche (fetchTasks() la lui aura fait trouver) : c'est cette même référence
    // que lancerTache() attend pour résoudre. Sinon (le défaut, fetchTasks() vide — Ctrl+S
    // et triggerTaskOnSave, hors du cockpit), une exécution synthétique, comme avant : le
    // suiveur global (onDidStartTask/onDidEndTaskProcess) ne regarde que le nom.
    // Une tâche normale émet les deux événements de fin, dans cet ordre : onDidEndTaskProcess
    // (le code de sortie), puis onDidEndTask (VS Code le déclenche pour toute fin de tâche,
    // processus ou non). Sans le second, aucun test ne peut éprouver un gestionnaire qui
    // écoute onDidEndTask sur le chemin le plus fréquent d'une compilation qui va à son terme.
    finirTache: (nom, code) => {
      const execution = executionsParTache[nom] || { task: { name: nom, definition: { type: 'process' } } };
      finTache.emettre({ exitCode: code, execution: execution });
      finTacheBrute.emettre({ execution: execution });
    },
    // Démarrage d'une tâche (onDidStartTask), même repli que finirTache ci-dessus.
    demarrerTache: (nom) => debutTache.emettre({
      execution: executionsParTache[nom] || { task: { name: nom, definition: { type: 'process' } } }
    }),
    // Fin d'une tâche sans notification de processus (onDidEndTask seul) : la tâche a été
    // interrompue, ou son exécutable n'a jamais démarré.
    finirTacheSansProcessus: (nom) => finTacheBrute.emettre({
      execution: executionsParTache[nom] || { task: { name: nom, definition: { type: 'process' } } }
    }),
    // Une réponse par appel à venir, dans l'ordre : appeler deux fois enfile deux réponses.
    repondreModale: (v) => { reponsesModales.push(v); },
    // Les dialogues posés, avec leurs boutons : `modales.pop()` donne le dernier.
    modales: modales,
    // Les messages de la barre d'état, dans l'ordre ; `statutsDits(f)` filtre.
    statuts: statuts,
    statutsDits: (fragment) => statuts.filter((m) => m.indexOf(fragment) !== -1),
    // Les reveal() de la TreeView, dans l'ordre ; et les gestes de chevron, simulés.
    revelations: revelations,
    deplierElement: (element) => expansions.emettre({ element: element }),
    replierElement: (element) => replis.emettre({ element: element }),
    // La décoration que porterait ce chemin (point de l'article ouvert), ou undefined.
    decorationDe: (chemin) => decorateur
      ? decorateur.provideFileDecoration(stub.Uri.file(chemin)) : undefined,
    // Change l'éditeur actif comme VS Code le signalerait ; null = plus d'éditeur actif
    // (le focus est sur un aperçu ou un panneau).
    activerEditeur: (chemin) => {
      stub.window.activeTextEditor = chemin
        ? { document: { uri: stub.Uri.file(chemin) } } : undefined;
      editeurActif.emettre(stub.window.activeTextEditor);
    },
    // Le défilement de l'éditeur (pousserDefilementVersApercu) : `editeur` doit être celui
    // que editeurArticleCourant() retrouverait (voir fauxEditeur() ci-dessous, ou un objet
    // similaire construit dans le test).
    changerRangesVisibles: (editeur, ligne0Based) => rangesVisibles.emettre({
      textEditor: editeur, visibleRanges: [{ start: { line: ligne0Based }, end: { line: ligne0Based } }]
    }),
    // Le curseur dans l'éditeur (pousserSurlignageVersApercu) : la position lue est celle
    // d'`editeur.selection.active`, pas celle de l'événement — même contrat que VS Code.
    changerSelectionEditeur: (editeur) => selectionEditeur.emettre({ textEditor: editeur })
  };
}

// Un LIVRE minimal, le pendant de revueDEssai() : buch.yaml, deux chapitres, un dépôt Word.
// Il sert à éprouver que le cockpit reconnaît un livre et lui montre SES sections — pas
// celles d'un numéro. C'est la seule différence qui compte ici ; tout le reste de la
// mécanique (médias, tableaux, verrous) est indifférent au profil, et ses tests le disent
// déjà pour la revue.
function livreDEssai() {
  const livre = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-livre-'));
  fs.writeFileSync(path.join(livre, 'buch.yaml'),
    ['titre: "Essai de livre"', 'ouvrage: monographie', 'lang: fr', 'maquette: normal',
     'format: standard', 'annee: 2026', 'ordre-chapitres: []', ''].join(LF));

  for (const slug of ['01-ouverture', '02-suite']) {
    const dossier = path.join(livre, 'chapitres', slug);
    fs.mkdirSync(path.join(dossier, 'media'), { recursive: true });
    fs.writeFileSync(path.join(dossier, slug + '.md'),
      ['# Un titre de chapitre', '', 'Un paragraphe.', ''].join(LF));
  }
  fs.mkdirSync(path.join(livre, 'chapitres-word'), { recursive: true });
  return livre;
}

// Concatène extension.js et tous les lib/**/*.js. Préalable au découpage d'extension.js :
// un contrat qui cherche aujourd'hui une chaîne dans extension.js doit continuer de la
// trouver le jour où elle aura migré vers un module de lib/ — sans quoi chaque migration
// casserait silencieusement un contrôle qui n'a plus rien à voir avec le découpage lui-même.
function sourceExtensionEtLib(cockpit) {
  const morceaux = [fs.readFileSync(path.join(cockpit, 'extension.js'), 'utf8')];
  const empiler = (base) => {
    for (const e of fs.readdirSync(base, { withFileTypes: true })) {
      const p = path.join(base, e.name);
      if (e.isDirectory()) { empiler(p); }
      else if (e.name.endsWith('.js')) { morceaux.push(fs.readFileSync(p, 'utf8')); }
    }
  };
  empiler(path.join(cockpit, 'lib'));
  return morceaux.join('\n');
}

module.exports = { revueDEssai, livreDEssai, activerHote, sourceExtensionEtLib };
