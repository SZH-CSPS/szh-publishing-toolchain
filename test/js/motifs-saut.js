'use strict';
// Source UNIQUE des motifs de saut (t.skip) admis par runner. Avant ce module, la table
// MOTIFS/ADMIS ne vivait que dans verifier-tap.js : gardes.js (qui ÉCRIT les motifs via ses
// assistants `sauter.*`) n'avait aucun moyen de savoir si le texte qu'il composait serait
// un jour reconnu par la porte qui le RELIT. Une famille ajoutée d'un côté sans l'autre est
// exactement le genre d'écart qui a coûté trois poses du tag à la 1.2.0 (motif « corpus »
// mal formulé, refusé par une porte qui ne citait la formule admise nulle part ailleurs).
//
// L'ordre de MOTIFS compte : verifier-tap.js retient la première famille dont un fragment
// apparaît dans le motif lu. Les fragments sont des sous-chaînes LITTÉRALES, jamais des
// regex : un `.` ou une parenthèse dans un motif réel (un chemin Windows, par exemple) ne
// doit jamais se lire comme une syntaxe.

const MOTIFS = {
  pliage: ['pliage des accents'],
  powershell: ['powershell.exe indisponible'],
  python: ['Python 3'],
  wsl: ['wsl.exe', 'dans la distro'],
  pandoc: ['pandoc introuvable', 'pandoc ou python3 introuvable'],
  horsWindows: ['chemins Windows'],
  corpus: ['corpus hors dépôt absent', 'aucun .docx dans'],
  eleve: ['processus élevé'],
  // courriel-support.test.js rend un gabarit par VSCodium-en-Node : aucun runner d'intégration
  // continue n'a d'installation VSCodium.
  vscodium: ['VSCodium introuvable', 'pas Windows'],
  // Aucun runner d'intégration continue n'a d'installation en C:\ProgramData\SZH, donc les
  // contrôles d'isolement n'y ont rien à mesurer. La base d'auteurs moissonnée d'OJS
  // (C:\ProgramData\SZHuteurs.json) en fait partie : c'est le banc des noms qui la lit.
  production: ['installation de production absente', 'base OJS du poste absente'],
  // Vale : présent sur ubuntu (job `contrats` de ci.yml l'installe et pose
  // SZH_VALE_OBLIGATOIRE=1) ; absent sur windows-latest et sur un poste qui ne l'a pas encore
  // dans son image WSL.
  vale: ['vale absent']
};

const ADMIS = {
  // Pas de PowerShell, pas de WSL dans le job `contrats` ; vale y est installé et
  // SZH_VALE_OBLIGATOIRE=1 y transforme donc son absence en échec — vale n'est PAS dans
  // cette liste. pandoc (famille distincte de wsl) reste admis : un test qui teste
  // spécifiquement l'ABSENCE de pandoc (plutôt que son résultat) peut légitimement sauter
  // même là où il est installé. python est exigé (SZH_PYTHON_OBLIGATOIRE).
  ubuntu: ['powershell', 'horsWindows', 'wsl', 'pandoc', 'corpus', 'vscodium', 'production'],
  // PowerShell exigé (SZH_PS_OBLIGATOIRE) ; le runner tourne élevé, donc l'ACL ne bloque
  // rien ; ni pandoc ni vale n'y sont installés (le job `contrats-windows` n'installe que
  // Node).
  windows: ['wsl', 'pandoc', 'corpus', 'eleve', 'python', 'vscodium', 'production', 'vale'],
  // Un poste complet : ne restent que les accents du pandoc 3.9 de Windows et le corpus
  // hors dépôt.
  poste: ['pliage', 'corpus', 'eleve', 'vale']
};

module.exports = { MOTIFS, ADMIS };
