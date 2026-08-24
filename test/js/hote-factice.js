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
  const barres = [];
  const panneaux = [];
  const avertissements = [];
  const erreurs = [];
  let arbre = null;
  let reponseModale = undefined;   // ce que showWarningMessage rendra au prochain appel

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
      file: (p) => ({ fsPath: p, scheme: 'file', path: p, toString: () => 'file://' + p }),
      parse: (s) => ({ fsPath: s, scheme: 'file' })
    },
    Position: class { constructor(l, c) { this.line = l; this.character = c; } },
    Range: class { constructor(a, b) { this.start = a; this.end = b; } },
    Selection: class { constructor(a, b) { this.start = a; this.end = b; this.active = b; } },
    WorkspaceEdit: class { replace() {} insert() {} },
    TreeItem: class { constructor(l, c) { this.label = l; this.collapsibleState = c; } },
    ThemeIcon: class { constructor(i) { this.id = i; } },
    ThemeColor: class { constructor(i) { this.id = i; } },
    RelativePattern: class { constructor(b, m) { this.base = b; this.pattern = m; } },
    TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
    StatusBarAlignment: { Left: 1, Right: 2 },
    ViewColumn: { One: 1, Two: 2 },
    ConfigurationTarget: { Global: 1, Workspace: 2 },
    QuickPickItemKind: { Separator: -1, Default: 0 },
    ProgressLocation: { Notification: 15 },
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
        return { title: '', dispose() {}, onDidChangeSelection: evenement(), reveal: () => Promise.resolve() };
      },
      createStatusBarItem: () => {
        const b = { visible: false, text: '', tooltip: '', command: '',
                    show() { b.visible = true; }, hide() { b.visible = false; }, dispose() {} };
        barres.push(b);
        return b;
      },
      createWebviewPanel: (type, titre) => fauxPanneau(type, titre),
      showWarningMessage: (m) => { avertissements.push(m); const r = reponseModale; reponseModale = undefined; return Promise.resolve(r); },
      showInformationMessage: () => Promise.resolve(undefined),
      showErrorMessage: (m) => { erreurs.push(m); return Promise.resolve(undefined); },
      setStatusBarMessage: () => ({ dispose() {} }),
      showOpenDialog: () => Promise.resolve(undefined),
      withProgress: (o, f) => f({ report() {} }),
      onDidChangeActiveTextEditor: evenement(),
      onDidChangeTextEditorVisibleRanges: evenement(),
      onDidChangeTextEditorSelection: evenement(),
      showTextDocument: () => Promise.resolve({ document: {}, selection: null, revealRange() {} }),
      showQuickPick: () => Promise.resolve(undefined),
      showInputBox: () => Promise.resolve(undefined)
    },
    workspace: {
      workspaceFolders: [{ uri: { fsPath: revue }, name: path.basename(revue), index: 0 }],
      getConfiguration: () => ({ get: (c, d) => d, update: () => Promise.resolve() }),
      createFileSystemWatcher: () => ({
        onDidCreate: evenement(), onDidChange: evenement(), onDidDelete: evenement(), dispose() {}
      }),
      onDidChangeWorkspaceFolders: evenement(),
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
      fs: { stat: () => Promise.resolve({}) }
    },
    tasks: {
      onDidStartTask: evenement(), onDidEndTaskProcess: finTache,
      fetchTasks: () => Promise.resolve([]), executeTask: () => Promise.resolve({})
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
  const contexte = {
    subscriptions: [], extensionPath: cockpit,
    globalState: { get: () => undefined, update: () => Promise.resolve() }
  };
  ext.activate(contexte);

  return {
    stub: stub,
    commandes: () => Object.keys(stub.commands._table),
    executer: (id, ...args) => stub.commands.executeCommand(id, ...args),
    arbre: () => arbre,
    panneaux: panneaux,
    dernierPanneau: () => panneaux[panneaux.length - 1] || null,
    // Les panneaux sont des singletons : rouvrir en révèle un, sans en créer. On le
    // retrouve donc par son type, et non par l'ordre de création.
    panneauDeType: (type) => panneaux.filter((x) => x.type === type).pop() || null,
    avertissements: avertissements,
    erreurs: erreurs,
    // Les articles de la barre d'état, dans l'ordre de création : un test lit leur texte.
    barres: barres,
    barreQuiDit: (fragment) => barres.filter(
      (b) => b.visible && String(b.text).indexOf(fragment) !== -1).pop() || null,
    // Simule la fin d'une tâche de la chaîne, comme VS Code la signale.
    finirTache: (nom, code) => finTache.emettre({
      exitCode: code, execution: { task: { name: nom, definition: { type: 'process' } } }
    }),
    repondreModale: (v) => { reponseModale = v; }
  };
}

module.exports = { revueDEssai, activerHote };
