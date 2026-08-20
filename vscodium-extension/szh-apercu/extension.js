// Aperçu automatique : à la fin de la tâche de build, ouvre le PDF de l'article
// actif en vue scindée à droite, sans voler le focus et seulement s'il n'est pas
// déjà ouvert (tomoki1207.pdf le recharge ensuite tout seul).
'use strict';

const vscode = require('vscode');
const path = require('path');
const fs = require('fs');

// ⚠ Doit rester identique au label de la tâche dans vscodium-user/tasks.json.
const NOM_TACHE_BUILD = 'Aperçu / Export PDF';
const VUE_PDF = 'pdf.preview'; // éditeur personnalisé de tomoki1207.pdf

function activate(context) {
  context.subscriptions.push(
    vscode.tasks.onDidEndTaskProcess((e) => {
      try {
        if (!e || !e.execution || e.execution.task.name !== NOM_TACHE_BUILD) { return; }
        if (e.exitCode !== 0) { return; } // build en échec : ne rien ouvrir
        // La colonne 2 n'a qu'un propriétaire : en mode html c'est la webview
        // du cockpit, donc cette extension ne s'active qu'en mode pdf.
        if (vscode.workspace.getConfiguration('szh').get('apercuMode', 'html') !== 'pdf') { return; }
        if (!vscode.workspace.getConfiguration('szh').get('apercuAuto', true)) { return; }
        ouvrirApercuArticleActif();
      } catch (err) {
        // silencieux : un incident d'affichage ne doit pas gêner la rédaction
      }
    })
  );
}

function ouvrirApercuArticleActif() {
  const editeur = vscode.window.activeTextEditor;
  if (!editeur) { return; }
  const doc = editeur.document;
  if (doc.languageId !== 'markdown') { return; }

  const ws = vscode.workspace.getWorkspaceFolder(doc.uri);
  if (!ws) { return; }

  // Seulement les articles, rangés un par dossier : articles/<slug>/<slug>.md,
  // soit exactement trois segments.
  const rel = path.relative(ws.uri.fsPath, doc.uri.fsPath);
  const parties = rel.split(path.sep);
  if (parties.length !== 3 || parties[0] !== 'articles') { return; }
  const slug = parties[1];
  if (parties[2] !== slug + '.md') { return; }   // le .md doit être homonyme du dossier
  const pdfPath = path.join(ws.uri.fsPath, 'out', slug, slug + '.pdf');
  if (!fs.existsSync(pdfPath)) { return; }
  const uri = vscode.Uri.file(pdfPath);

  // Déjà ouvert : l'aperçu se recharge seul, et ré-ouvrir à chaque enregistrement
  // automatique déplacerait l'onglet sous les yeux du rédacteur.
  for (const groupe of vscode.window.tabGroups.all) {
    for (const onglet of groupe.tabs) {
      const entree = onglet.input;
      if (entree && entree.uri && entree.uri.fsPath === uri.fsPath) { return; }
    }
  }

  vscode.commands.executeCommand('vscode.openWith', uri, VUE_PDF, {
    viewColumn: vscode.ViewColumn.Beside,
    preserveFocus: true
  });
}

function deactivate() {}

module.exports = { activate, deactivate };
