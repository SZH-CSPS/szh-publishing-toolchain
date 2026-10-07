// Ouvre un fichier ou un dossier avec l'application associée par le système. L'appelant
// passe son module vscode, utilisé hors Windows seulement.
'use strict';

const path = require('path');
const { spawn } = require('child_process');
const { dossierWindows } = require('./poste');

// Sous Windows, le chemin brut va à explorer.exe : le file:// de vscode.env.openExternal
// encode le « : » du lecteur et les accents, et ShellExecute le refuse alors (« fichier
// introuvable », 0x2). -> { programme, args } ou null hors Windows.
function commande(chemin, plateforme, windir) {
  if (plateforme !== 'win32') { return null; }
  return { programme: path.join(windir || 'C:\\Windows', 'explorer.exe'), args: [String(chemin)] };
}

function lancerDetache(programme, args) {
  const p = spawn(programme, args, { detached: true, stdio: 'ignore' });
  p.on('error', () => { /* rien à ouvrir : le geste n'a pas d'autre effet */ });
  p.unref();
}

// Les tests posent leur propre lanceur ; null remet le vrai.
let lanceur = lancerDetache;
function poserLanceur(f) { lanceur = f || lancerDetache; }

// `vscode` : le module de l'appelant, pour openExternal hors Windows. -> Promise<boolean>
function ouvrirAvecSysteme(chemin, vscode) {
  const c = commande(chemin, process.platform, dossierWindows());
  if (!c) { return Promise.resolve(vscode ? vscode.env.openExternal(vscode.Uri.file(chemin)) : false); }
  try { lanceur(c.programme, c.args); return Promise.resolve(true); }
  catch (e) { return Promise.resolve(false); }
}

module.exports = { commande, ouvrirAvecSysteme, poserLanceur };
