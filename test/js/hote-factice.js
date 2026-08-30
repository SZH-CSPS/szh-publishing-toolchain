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
  // Un cache d'auteur·e·s FRAIS avant l'activation : l'extension rafraîchit la liste
  // OAI-PMH en tâche de fond quand dateFetch a plus de trente jours, et aucun test ne doit
  // faire de réseau. Le fichier sert aussi de corpus au message auteurs-connus.
  process.env.SZH_AUTEURS_CACHE = path.join(revue, 'auteurs.json');
  fs.writeFileSync(process.env.SZH_AUTEURS_CACHE, JSON.stringify({
    version: 1, dateFetch: new Date().toISOString(),
    auteurs: [
      { prenom: 'Robin', nom: 'Morand', datePublication: '2026-01-01T00:00:00Z' },
      { prenom: 'Anne', nom: 'Dupont', datePublication: '2025-06-01T00:00:00Z' }
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
  const barres = [];
  const panneaux = [];
  const avertissements = [];
  const statuts = [];          // ce que setStatusBarMessage a affiché, dans l'ordre
  const erreurs = [];
  const motifsSurveilles = []; // les motifs passés à createFileSystemWatcher, dans l'ordre
  let arbre = null;
  // Ce que showWarningMessage rendra, dans l'ordre des appels : une file, et non une seule
  // valeur, parce qu'un geste peut désormais en enchaîner deux — le dialogue de
  // remplacement renvoie vers celui de « poser à côté », et le test doit répondre aux deux.
  // File vide -> undefined, c'est-à-dire « Annuler », comme avant.
  const reponsesModales = [];
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
      parse: (s) => ({ fsPath: s, scheme: 'file' })
    },
    Position: class { constructor(l, c) { this.line = l; this.character = c; } },
    Range: class { constructor(a, b) { this.start = a; this.end = b; } },
    Selection: class { constructor(a, b) { this.start = a; this.end = b; this.active = b; } },
    WorkspaceEdit: class { replace() {} insert() {} },
    TreeItem: class { constructor(l, c) { this.label = l; this.collapsibleState = c; } },
    ThemeIcon: class { constructor(i, couleur) { this.id = i; this.color = couleur; } },
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
      withProgress: (o, f) => f({ report() {} }),
      onDidChangeActiveTextEditor: editeurActif,
      onDidChangeTextEditorVisibleRanges: evenement(),
      onDidChangeTextEditorSelection: evenement(),
      showTextDocument: () => Promise.resolve({ document: {}, selection: null, revealRange() {} }),
      showQuickPick: () => Promise.resolve(undefined),
      showInputBox: () => Promise.resolve(undefined)
    },
    workspace: {
      workspaceFolders: [{ uri: { fsPath: revue }, name: path.basename(revue), index: 0 }],
      getConfiguration: () => ({ get: (c, d) => d, update: () => Promise.resolve() }),
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
    motifsSurveilles: () => motifsSurveilles.slice(),
    // Les contrôles de source encore en vie, et le fournisseur de contenu d'un schéma :
    // de quoi éprouver la résolution des copies en conflit.
    sourceControls: () => stub.scm._controles.filter((c) => c.vivant),
    fournisseurContenu: (schema) => stub.workspace._contenus[schema],
    // Les articles de la barre d'état, dans l'ordre de création : un test lit leur texte.
    barres: barres,
    barreQuiDit: (fragment) => barres.filter(
      (b) => b.visible && String(b.text).indexOf(fragment) !== -1).pop() || null,
    // Simule la fin d'une tâche de la chaîne, comme VS Code la signale.
    finirTache: (nom, code) => finTache.emettre({
      exitCode: code, execution: { task: { name: nom, definition: { type: 'process' } } }
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
    }
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

module.exports = { revueDEssai, livreDEssai, activerHote };
