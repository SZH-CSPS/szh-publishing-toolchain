'use strict';
// Les motifs de saut (t.skip) admis par runner. gardes.js écrit les motifs par ses
// assistants `sauter.*`, verifier-tap.js les relit : les deux lisent cette table, pour qu'une
// famille ajoutée d'un côté soit connue de l'autre.
//
// L'ordre de MOTIFS compte : verifier-tap.js retient la première famille dont un fragment
// apparaît dans le motif lu. Les fragments sont des sous-chaînes littérales, pas des regex :
// un `.` ou une parenthèse dans un motif réel (un chemin Windows) ne doit pas se lire comme
// une syntaxe.

const MOTIFS = {
  pliage: ['pliage des accents'],
  powershell: ['powershell.exe indisponible'],
  python: ['Python 3'],
  wsl: ['wsl.exe', 'dans la distro'],
  pandoc: ['pandoc introuvable', 'pandoc ou python3 introuvable'],
  horsWindows: ['chemins Windows'],
  corpus: ['corpus hors dépôt absent', 'aucun .docx dans'],
  eleve: ['processus élevé'],
  // courriel-support.test.js rend un gabarit par VSCodium-en-Node : aucun runner de CI n'a
  // VSCodium.
  vscodium: ['VSCodium introuvable', 'pas Windows'],
  // Aucun runner de CI n'a d'installation dans C:\ProgramData\SZH : les contrôles
  // d'isolement n'y ont rien à mesurer. La base d'auteurs moissonnée d'OJS
  // (C:\ProgramData\SZH\auteurs.json), lue par le banc des noms, en fait partie.
  production: ['installation de production absente', 'base OJS du poste absente'],
  // Vale : installé sur ubuntu (le job `contrats` de ci.yml pose aussi
  // SZH_VALE_OBLIGATOIRE=1) ; absent sur windows-latest et sur un poste dont l'image WSL ne
  // l'a pas encore.
  vale: ['vale absent'],
  // Un correctif de image/patches/ n'atteint le WeasyPrint de la WSL qu'à la reconstruction
  // de l'image : d'ici là, le poste compile avec un WeasyPrint qui ne l'a pas.
  correctifWeasyprint: ['correctif WeasyPrint absent']
};

const ADMIS = {
  // Ni PowerShell ni WSL dans le job `contrats`. vale y est installé et
  // SZH_VALE_OBLIGATOIRE=1 fait de son absence un échec : il n'est pas dans cette liste.
  // pandoc reste admis : un test qui vérifie l'absence de pandoc peut sauter même là où il
  // est installé. python est exigé (SZH_PYTHON_OBLIGATOIRE).
  ubuntu: ['powershell', 'horsWindows', 'wsl', 'pandoc', 'corpus', 'vscodium', 'production'],
  // PowerShell exigé (SZH_PS_OBLIGATOIRE) ; le runner tourne élevé, l'ACL ne bloque donc
  // rien ; ni pandoc ni vale ne sont installés (le job `contrats-windows` n'installe que
  // Node).
  windows: ['wsl', 'pandoc', 'corpus', 'eleve', 'python', 'vscodium', 'production', 'vale'],
  // Un poste complet : ne restent que les accents du pandoc 3.9 de Windows et le corpus
  // hors dépôt.
  poste: ['pliage', 'corpus', 'eleve', 'vale', 'correctifWeasyprint']
};

module.exports = { MOTIFS, ADMIS };
