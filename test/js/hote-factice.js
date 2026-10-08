// Active extension.js avec un faux « vscode », sur une revue ou un livre temporaire, et rend
// de quoi l'interroger : l'arbre, les panneaux ouverts, la table des commandes, les dialogues.
//
// Un seul appel d'activerHote() par processus : le crochet de Module._load et le cache de
// require ne se défont pas. `node --test` donne un processus par fichier, ce qui suffit.
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const LF = String.fromCharCode(10);

// Efface une racine jetable à la fin du processus. test.after(), appelé depuis l'intérieur
// d'un test, ne vaudrait que pour ce test : la fixture, partagée par les tests suivants,
// disparaîtrait sous eux. L'évènement 'exit' arrive aussi après la tâche de fond lancée par
// activerHote() (cache des auteur·e·s), qui recréerait sinon un fichier.
function nettoyerEnFinDeProcessus(racineJetable) {
  process.on('exit', () => {
    try { fs.rmSync(racineJetable, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
    catch (e) { /* débris de test, tant pis */ }
  });
}

// Interdit le réseau, avant tout require d'extension.js. La seule connexion https du
// cockpit passe par recupererHttps (lib/auteurs-ojs.js), que lib/mots-cles-edudoc.js
// réutilise : un appel réel qui échapperait aux caches échoue aussitôt, avec un message.
process.env.SZH_RESEAU_INTERDIT = '1';

// Détourne C:\ProgramData\SZH\config.json et state.json vers des fichiers vides : un test
// ne lit rien du poste. state.json porte la langue du lanceur, qui ferait passer la suite
// en allemand sur un poste allemand.
require('./poste-isole');

// L'état du compte (%LOCALAPPDATA%\SZH\etat-utilisateur.json) va dans un dossier jetable,
// sauf si le test en a déjà posé un sous le dossier temporaire. Le lanceur y lit et y écrit
// ses réglages.
if (String(process.env.LOCALAPPDATA || '').indexOf(os.tmpdir()) !== 0) {
  process.env.LOCALAPPDATA = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-compte-'));
}

// Une revue minimale mais complète : deux articles dont un sans fiche, un portrait à ses
// trois versions désigné par la fiche, une image insérée dans le texte, un Word en attente
// et le rapport de la dernière conversion.
function revueDEssai() {
  // Le numéro vit sous <racine jetable>\Revue\<nom> : racineArbre (kirby-contenu.js) ne
  // reconnaît la racine de l'arbre qu'à cette forme. Posé à plat, il ferait de os.tmpdir()
  // la racine, et la bibliothèque de fiches (_NewsUndActu\) s'y écrirait.
  const racineJetable = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-hote-'));
  nettoyerEnFinDeProcessus(racineJetable);
  const revue = path.join(racineJetable, 'Revue', 'essai-01');
  fs.mkdirSync(revue, { recursive: true });
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

  // La bibliographie détachée à l'import, voisine du .md. L'autre article n'en a pas.
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

// opts.sansDossier : une fenêtre sans dossier ouvert, comme au lancement de Pronto. La revue
// sert encore de dossier jetable aux caches. opts.onglets : les onglets déjà ouverts à
// l'activation (des `input`, comme poserOnglets).
function activerHote(revue, opts) {
  const sansDossier = !!(opts && opts.sansDossier);
  const ongletsInitiaux = (opts && opts.onglets) || [];
  const cockpit = path.join(__dirname, '..', '..', 'vscodium-extension', 'szh-cockpit');
  // Un cache d'auteur·e·s frais avant l'activation : l'extension moissonne OAI-PMH en tâche
  // de fond quand dateFetch a plus de trente jours. Il sert aussi de corpus au message
  // auteurs-connus.
  // Il est écrit en version 2 (lib/auteurs-ojs.js) : lireCache() migre un cache v1 en
  // remettant dateFetch à null, ce qui déclencherait le moissonnage. dateCorpus est frais
  // pour que l'activation ne balaie pas les vraies racines du poste.
  process.env.SZH_AUTEURS_CACHE = path.join(revue, 'auteurs.json');
  fs.writeFileSync(process.env.SZH_AUTEURS_CACHE, JSON.stringify({
    version: 2, dateFetch: new Date().toISOString(), dateCorpus: new Date().toISOString(), ror: {}, vus: {},
    auteurs: [
      { prenom: 'Robin', nom: 'Morand', datePublication: '2026-01-01T00:00:00Z' },
      { prenom: 'Anne', nom: 'Dupont', datePublication: '2025-06-01T00:00:00Z' }
    ]
  }, null, 2) + LF);
  // De même pour le vocabulaire edudoc.ch (lib/mots-cles-edudoc.js), périmé au-delà de sept
  // jours. Il sert aussi de corpus au message mots-cles-connus.
  process.env.SZH_MOTS_CLES_CACHE = path.join(revue, 'mots-cles.json');
  fs.writeFileSync(process.env.SZH_MOTS_CLES_CACHE, JSON.stringify({
    dateFetch: new Date().toISOString(),
    motsCles: [
      { de: 'Sonderpädagogik', fr: 'pédagogie spécialisée', manque: null },
      { de: 'Inklusion', fr: 'inclusion', manque: null }
    ]
  }, null, 2) + LF);
  const evenement = () => () => ({ dispose() {} });
  // Un événement qui garde ses abonnés, pour qu'un test puisse le déclencher (emettre).
  // `evenement()`, lui, jette le gestionnaire.
  const emetteur = () => {
    const abonnes = [];
    const brancher = (f) => { abonnes.push(f); return { dispose() {} }; };
    brancher.emettre = (e) => { for (const f of abonnes.slice()) { f(e); } };
    return brancher;
  };
  const finTache = emetteur();
  // La dernière TaskExecution rendue par executeTask(), par nom de tâche. lancerTache()
  // reconnaît la fin de sa tâche à cette référence (`e.execution === execution`) ;
  // finirTache() la réutilise. Vide tant que fetchTasks() ne rend rien (le défaut).
  const executionsParTache = {};
  // Le démarrage d'une tâche (onDidStartTask) et sa fin sans notification de processus
  // (onDidEndTask). Une compilation par Ctrl+S (triggerTaskOnSave) n'est vue du cockpit
  // que par ces événements globaux.
  const debutTache = emetteur();
  const finTacheBrute = emetteur();
  // Ctrl+S : le cockpit retient l'article enregistré pour le voile de « À corriger ».
  const enregistrement = emetteur();
  // Les événements du défilement synchronisé avec l'aperçu HTML, déclenchables par un test.
  const rangesVisibles = emetteur();
  const selectionEditeur = emetteur();
  // Les réglages écrits par update(), relus par get(). Une seule table, comme le niveau
  // Global de VS Code, le seul où le cockpit écrit.
  const configValeurs = {};
  const barres = [];
  const panneaux = [];
  const fermetures = [];   // ce que tabGroups.close a reçu, lot par lot
  const avertissements = [];
  const statuts = [];          // ce que setStatusBarMessage a affiché, dans l'ordre
  const erreurs = [];
  const motifsSurveilles = []; // les motifs passés à createFileSystemWatcher, dans l'ordre
  let arbre = null;
  let controleurDepot = null;   // dragAndDropController de la TreeView (.docx glissés dessus)
  // Ce que showWarningMessage rendra, dans l'ordre des appels : un geste peut enchaîner deux
  // dialogues. File vide : undefined, c'est-à-dire « Annuler ».
  const reponsesModales = [];
  // Le chemin que showSaveDialog rendra : null = « Annuler ».
  let cibleEnregistrement = null;
  // Les réponses des trois autres dialogues ; undefined (le défaut) = « Annuler ».
  let reponseQuickPick;
  let reponseInput;
  let reponseOuverture;
  // Les clés de contexte posées par `setContext` (menus, clauses `when`).
  const contexteVsCode = {};
  // Chaque appel de showWarningMessage avec ses boutons, pour vérifier les choix offerts.
  const modales = [];
  // La TreeView : reveal() est enregistré (resélection d'un article), et les événements de
  // chevron sont déclenchables depuis un test (accordéon des sections).
  const revelations = [];
  const expansions = emetteur();
  const replis = emetteur();
  // Le décorateur de fichiers (point de l'article ouvert), interrogeable par chemin, et
  // l'événement d'éditeur actif, déclenchable.
  let decorateur = null;
  // Le gestionnaire des liens vscodium:// enregistré par le cockpit.
  let gestionnaireUri = null;
  const editeurActif = emetteur();

  const ouvertures = [];
  // Ce que les WorkspaceEdit appliqués ont remplacé, dans l'ordre : { uri, texte }.
  const editions = [];
  // Ce que le cockpit ouvre avec l'application du système (lib/ouvrir-systeme.js) part dans
  // la même liste : jamais un vrai explorer.exe lancé par un test.
  require(path.join(cockpit, 'lib', 'ouvrir-systeme.js'))
    .poserLanceur((programme, args) => { ouvertures.push(args[0]); });
  // Le Bureau du système n'est pas lu par un test : jamais de PowerShell, le repli du profil.
  require(path.join(cockpit, 'lib', 'poste.js')).poserLecteurBureau(() => '');

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
      // Déclenchable : documentation-hote.js redit l'état de son bouton quand le panneau
      // redevient actif (p.onDidChangeViewState.emettre({ webviewPanel: { active: true } })).
      onDidChangeViewState: emetteur()
    };
    panneaux.push(p);
    return p;
  }

  const stub = {
    EventEmitter: class { constructor() { this.event = () => ({ dispose() {} }); } fire() {} },
    Uri: {
      // `with` sert à passer une copie en conflit sous le schéma szh-conflit, qui en fait
      // l'« original » du diff rapide.
      file: (p) => {
        const faire = (schema) => ({
          fsPath: p, scheme: schema, path: p,
          with: (parties) => faire((parties && parties.scheme) || schema),
          toString: () => schema + '://' + p
        });
        return faire('file');
      },
      // Relit le « schéma://reste » produit par toString() ci-dessus, sans décodage. Sert au
      // « text/uri-list » des .docx déposés sur l'arbre.
      parse: (s) => {
        const texte = String(s || '');
        const m = texte.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):\/\/(.*)$/);
        return m ? { fsPath: m[2], scheme: m[1] } : { fsPath: texte, scheme: '' };
      }
    },
    Position: class { constructor(l, c) { this.line = l; this.character = c; } },
    // Les deux formes de l'API : (Position, Position) et (ligne, colonne, ligne, colonne).
    Range: class {
      constructor(a, b, c, d) {
        if (typeof a === 'number') {
          this.start = new stub.Position(a, b); this.end = new stub.Position(c, d);
        } else { this.start = a; this.end = b; }
      }
    },
    Selection: class { constructor(a, b) { this.start = a; this.end = b; this.active = b; } },
    // Garde le texte du snippet tel quel (lib/formatting.js).
    SnippetString: class { constructor(v) { this.value = v; } },
    // Les remplacements sont retenus : applyEdit les verse dans `editions`, sans toucher au disque.
    WorkspaceEdit: class { constructor() { this.ops = []; } replace(uri, plage, texte) { this.ops.push({ uri, texte }); } insert() {} },
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
    // Les pièces d'une tâche construite à la main, comme le fait tacheMakeArticle()
    // (extension.js). Les autres tâches viennent de tasks.json, via fetchTasks().
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
      // Ce que le cockpit ouvre à l'extérieur (fichier, lien) est retenu dans `ouvertures`.
      openExternal: (u) => { ouvertures.push(u && u.fsPath ? u.fsPath : String(u)); return Promise.resolve(true); }
    },
    extensions: { getExtension: () => undefined },
    commands: {
      _table: {},
      registerCommand(id, fn) { stub.commands._table[id] = fn; return { dispose() {} }; },
      // Le journal des commandes jouées, celles de l'éditeur comprises (vscode.open…).
      // `setContext`, appelé à chaque rafraîchissement, en est exclu.
      _journal: [],
      executeCommand(id, ...a) {
        if (id === 'setContext') { contexteVsCode[a[0]] = a[1]; return Promise.resolve(); }
        stub.commands._journal.push({ id: id, args: a });
        if (stub.commands._table[id]) { return Promise.resolve(stub.commands._table[id](...a)); }
        // Les commandes natives de VS Code passent sans effet. Une commande `szh.*` absente
        // fait échouer le geste qui l'appelle.
        if (String(id).indexOf('szh.') === 0) {
          return Promise.reject(new Error('command not found: ' + id));
        }
        return Promise.resolve();
      },
      getCommands: () => Promise.resolve(Object.keys(stub.commands._table))
    },
    window: {
      // Le focus de la fenêtre : un test le retire pour simuler une autre fenêtre passée devant.
      state: { focused: true },
      activeTextEditor: undefined,
      visibleTextEditors: [],
      // Les onglets : `all` se remplace par un test (ongletsFactices) pour simuler un
      // aperçu déjà ouvert, et `close` retient ce qu'on lui demande de fermer.
      tabGroups: {
        all: ongletsInitiaux.length === 0 ? [] : [{ tabs: ongletsInitiaux.map((e) => ({ input: e })) }],
        close: (onglets) => { fermetures.push(onglets); return Promise.resolve(true); }
      },
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
      registerUriHandler: (g) => { gestionnaireUri = g; return { dispose() {} }; },
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
      // Les messages passagers de la barre d'état, souvent le seul signe qu'un geste a
      // abouti. Lisibles par `statutsDits`.
      setStatusBarMessage: (m) => { statuts.push(String(m)); return { dispose() {} }; },
      // Posé par le test (`repondreOuverture`) ; undefined = « Annuler ».
      showOpenDialog: () => Promise.resolve(reponseOuverture),
      // Le chemin que showSaveDialog rendra, posé par le test (`repondreEnregistrement`).
      // undefined = l'utilisateur a annulé, et c'est le défaut.
      showSaveDialog: () => Promise.resolve(cibleEnregistrement
        ? { fsPath: cibleEnregistrement } : undefined),
      withProgress: (o, f) => f({ report() {} }),
      onDidChangeActiveTextEditor: editeurActif,
      onDidChangeTextEditorVisibleRanges: rangesVisibles,
      onDidChangeTextEditorSelection: selectionEditeur,
      showTextDocument: () => Promise.resolve({ document: {}, selection: null, revealRange() {} }),
      // Posés par le test (`repondreQuickPick`/`repondreInput`) ; undefined = « Annuler ».
      showQuickPick: () => Promise.resolve(reponseQuickPick),
      showInputBox: () => Promise.resolve(reponseInput)
    },
    workspace: {
      workspaceFolders: sansDossier ? undefined
        : [{ uri: { fsPath: revue }, name: path.basename(revue), index: 0 }],
      getConfiguration: (section) => {
        const prefixe = section ? section + '.' : '';
        return {
          get: (cle, defaut) => {
            const cheminCle = prefixe + cle;
            return Object.prototype.hasOwnProperty.call(configValeurs, cheminCle)
              ? configValeurs[cheminCle] : defaut;
          },
          update: (cle, valeur) => { configValeurs[prefixe + cle] = valeur; return Promise.resolve(); },
          // Pas de couche de défauts : poserReglagesMaison, qui lit le défaut effectif de
          // chaque clé, trouve donc toutes les clés « à poser ».
          inspect: (cle) => ({
            key: prefixe + cle,
            defaultValue: undefined,
            globalValue: Object.prototype.hasOwnProperty.call(configValeurs, prefixe + cle)
              ? configValeurs[prefixe + cle] : undefined
          })
        };
      },
      // Les motifs sont retenus : surveiller un chemin absent ne lève rien, seule la liste
      // des motifs montre ce qui est surveillé.
      createFileSystemWatcher: (motif) => {
        motifsSurveilles.push(motif && motif.pattern !== undefined ? motif.pattern : String(motif));
        return {
          onDidCreate: evenement(), onDidChange: evenement(), onDidDelete: evenement(), dispose() {}
        };
      },
      onDidChangeWorkspaceFolders: evenement(),
      onDidChangeConfiguration: evenement(),
      onDidSaveTextDocument: enregistrement,
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
      applyEdit: (e) => { editions.push(...((e && e.ops) || [])); return Promise.resolve(true); },
      fs: { stat: () => Promise.resolve({}) },
      // Le contenu servi sous un schéma à nous : celui des copies en conflit, que le
      // fournisseur de diff rapide donne pour « original » du fichier du numéro.
      _contenus: {},
      registerTextDocumentContentProvider: (schema, fournisseur) => {
        stub.workspace._contenus[schema] = fournisseur;
        return { dispose() {} };
      }
    },
    // Le contrôle de source, créé par le cockpit tant qu'il existe une copie en conflit.
    // `vivant` dit s'il a été détruit.
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
    // Neutralise le dormeur WSL, qui garderait le processus en vie et réveillerait la distro.
    if (m && typeof m.demarrerDormeurWsl === 'function') {
      return Object.assign({}, m, {
        demarrerDormeurWsl: () => {}, arreterDormeurWsl: () => {},
        reveillerWsl: () => Promise.resolve()
      });
    }
    // Même neutralisation pour la façade lib/moteur.js, reconnue à ses trois exports.
    if (m && typeof m.demarrerDormeur === 'function' && typeof m.reveiller === 'function'
        && typeof m.executer === 'function') {
      return Object.assign({}, m, {
        demarrerDormeur: () => {}, arreterDormeur: () => {}, reveiller: () => Promise.resolve()
      });
    }
    return m;
  };

  const ext = require(path.join(cockpit, 'extension.js'));
  // Un globalState qui garde ses valeurs : les réglages de la maison et les réglages protégés
  // ne se posent qu'une fois, d'après ce qu'il porte.
  const memoire = {};
  // Le coffre (SecretStorage), qui garde ses valeurs et signale ses changements, et
  // l'environnement des terminaux.
  const coffre = {};
  const changementCoffre = emetteur();
  const variablesTerminal = {};
  const contexte = {
    subscriptions: [], extensionPath: cockpit,
    globalState: {
      get: (cle) => memoire[cle],
      update: (cle, valeur) => { memoire[cle] = valeur; return Promise.resolve(); }
    },
    secrets: {
      get: (cle) => Promise.resolve(coffre[cle]),
      store: (cle, valeur) => { coffre[cle] = valeur; changementCoffre.emettre({ key: cle }); return Promise.resolve(); },
      delete: (cle) => { delete coffre[cle]; changementCoffre.emettre({ key: cle }); return Promise.resolve(); },
      onDidChange: changementCoffre
    },
    environmentVariableCollection: {
      persistent: true,
      clear: () => { for (const k of Object.keys(variablesTerminal)) { delete variablesTerminal[k]; } },
      replace: (k, v) => { variablesTerminal[k] = v; }
    }
  };
  ext.activate(contexte);

  return {
    stub: stub,
    commandes: () => Object.keys(stub.commands._table),
    executer: (id, ...args) => stub.commands.executeCommand(id, ...args),
    // Ce qui a été joué depuis le dernier oubli, commandes de l'éditeur comprises.
    commandesJouees: () => stub.commands._journal.slice(),
    oublierCommandes: () => { stub.commands._journal.length = 0; },
    // L'éditeur de texte actif et les onglets ouverts.
    poserEditeurActif: (chemin) => {
      stub.window.activeTextEditor = chemin
        ? { document: { uri: stub.Uri.file(chemin), fileName: chemin, languageId: 'markdown' },
            selection: { active: { line: 0, character: 0 } }, viewColumn: 1 }
        : undefined;
    },
    poserOnglets: (entrees) => {
      stub.window.tabGroups.all = (entrees || []).length === 0
        ? [] : [{ tabs: entrees.map((e) => ({ input: e })) }];
    },
    poserFocus: (focus) => { stub.window.state = { focused: !!focus }; },
    desactiver: () => ext.deactivate(),
    fermetures: () => fermetures.slice(),
    oublierFermetures: () => { fermetures.length = 0; },
    arbre: () => arbre,
    gestionnaireUri: () => gestionnaireUri,
    // Le dragAndDropController de la TreeView, pour simuler un .docx glissé sur l'arbre.
    controleurDepot: () => controleurDepot,
    panneaux: panneaux,
    // Les chemins et liens passés à env.openExternal, dans l'ordre.
    ouvertures: () => ouvertures.slice(),
    editions: () => editions.slice(),
    dernierPanneau: () => panneaux[panneaux.length - 1] || null,
    // Les panneaux sont des singletons : rouvrir en révèle un, sans en créer. On le
    // retrouve donc par son type, et non par l'ordre de création.
    panneauDeType: (type) => panneaux.filter((x) => x.type === type).pop() || null,
    // Ce que showSaveDialog rendra au prochain appel ; null pour simuler « Annuler ».
    repondreEnregistrement: (chemin) => { cibleEnregistrement = chemin; },
    // Les trois autres dialogues : la valeur posée est rendue telle quelle (item, chaîne ou
    // tableau d'URIs). Sans valeur : undefined, c'est-à-dire « Annuler ».
    repondreQuickPick: (valeur) => { reponseQuickPick = valeur; },
    repondreInput: (valeur) => { reponseInput = valeur; },
    repondreOuverture: (uris) => { reponseOuverture = uris; },
    // Une copie des clés `setContext` posées jusqu'ici : { 'szh.verrouillee': true, … }.
    contexte: () => Object.assign({}, contexteVsCode),
    memoire: memoire,
    coffre: coffre,
    secrets: contexte.secrets,
    variablesTerminal: variablesTerminal,
    terminal: contexte.environmentVariableCollection,
    configuration: configValeurs,
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
    // Simule la fin d'une tâche comme VS Code la signale : onDidEndTaskProcess (code de
    // sortie), puis onDidEndTask. L'exécution est celle qu'executeTask() a rendue si le
    // cockpit a lancé la tâche lui-même, sinon une exécution synthétique (cas du Ctrl+S),
    // que le suiveur global reconnaît à son nom.
    finirTache: (nom, code) => {
      const execution = executionsParTache[nom] || { task: { name: nom, definition: { type: 'process' } } };
      finTache.emettre({ exitCode: code, execution: execution });
      finTacheBrute.emettre({ execution: execution });
    },
    // Démarrage d'une tâche (onDidStartTask), même repli que finirTache ci-dessus.
    demarrerTache: (nom) => debutTache.emettre({
      execution: executionsParTache[nom] || { task: { name: nom, definition: { type: 'process' } } }
    }),
    // Un document enregistré (onDidSaveTextDocument), comme au Ctrl+S.
    enregistrerDocument: (chemin) => enregistrement.emettre({ uri: { fsPath: chemin } }),
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

// Un livre minimal, pendant de revueDEssai() : buch.yaml, deux chapitres, un dépôt Word.
// Il sert à vérifier que le cockpit reconnaît un livre et lui montre ses propres sections.
function livreDEssai() {
  // Sous <racine jetable>\Books\<nom>, pour la même raison que dans revueDEssai().
  const racineJetable = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-livre-'));
  nettoyerEnFinDeProcessus(racineJetable);
  const livre = path.join(racineJetable, 'Books', 'essai-livre');
  fs.mkdirSync(livre, { recursive: true });
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

// Concatène extension.js et tous les lib/**/*.js, pour qu'un contrôle de source trouve une
// chaîne où qu'elle vive dans le cockpit.
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

// Laisse s'épuiser les micro-tâches du démarrage asynchrone, vérifie qu'aucune erreur ni
// aucun avertissement n'a été émis, puis vide les deux listes pour la suite du test.
async function demarrageSeTait(HOTE, ticks = 30) {
  for (let i = 0; i < ticks; i++) { await new Promise((r) => setImmediate(r)); }
  assert.ok(HOTE.erreurs.length === 0 && HOTE.avertissements.length === 0,
    'le démarrage n’est pas resté silencieux — erreurs : ' + JSON.stringify(HOTE.erreurs)
    + ', avertissements : ' + JSON.stringify(HOTE.avertissements));
  HOTE.erreurs.length = 0;
  HOTE.avertissements.length = 0;
}

module.exports = { revueDEssai, livreDEssai, activerHote, sourceExtensionEtLib, demarrageSeTait };
