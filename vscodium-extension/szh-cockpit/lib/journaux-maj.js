// Les journaux de mise à jour du poste : les dix derniers update-*.log, leur verdict et leur
// fin.
'use strict';

const fs = require('fs');
const path = require('path');
const { basePoste } = require('./poste');

const COMBIEN = 10;
const LIGNES_VERDICT = 40;
const LIGNES_FIN = 200;

// SZH_JOURNAUX_MAJ : l'instance de dev lit les journaux du poste, sa propre base n'en reçoit jamais.
function dossierJournaux() {
  return String(process.env.SZH_JOURNAUX_MAJ || '').trim() || path.join(basePoste(), 'logs');
}

// Les lignes d'un fichier comme Get-Content les rend : sans BOM, et sans la ligne vide qui
// suit le dernier retour à la ligne.
function lignesDe(texte) {
  const lignes = String(texte).replace(/^﻿/, '').split(/\r\n|\r|\n/);
  if (lignes.length && lignes[lignes.length - 1] === '') { lignes.pop(); }
  return lignes;
}

// Une mise à jour finie écrit la fin de sa transcription ; elle a réussi si sa fin porte la
// coche. Le pied de page de Stop-Transcript est traduit par la langue de Windows : on reconnaît
// sa forme (astérisques, titre, ligne portant l'horodatage à 14 chiffres, astérisques), pas son texte.
const PIED_TRANSCRIPT = /\*{5,}\n[^\n]+\n[^\n]*\d{14}[^\n]*\n\*{5,}\s*$/;

function verdictJournal(chemin) {
  let texte;
  try { texte = fs.readFileSync(chemin, 'utf8'); } catch (e) { return 'inconnu'; }
  const fin = lignesDe(texte).slice(-LIGNES_VERDICT).join('\n');
  if (!PIED_TRANSCRIPT.test(fin)) { return 'inconnu'; }
  return fin.indexOf('✓') !== -1 ? 'ok' : 'echec';
}

// La date vient du nom (update-yyyyMMdd-HHmmss.log), en heure locale ; à défaut, de la date
// du fichier, comme dans le socle.
function dateDuNom(nom) {
  const m = /^update-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.log$/i.exec(nom);
  if (!m) { return null; }
  const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  return d.getMonth() === +m[2] - 1 && d.getDate() === +m[3] ? d : null;
}

// Les plus récents d'abord ; un dossier absent rend une liste vide.
function journauxMaj(combien) {
  const n = combien === undefined ? COMBIEN : Math.max(0, combien);
  const dossier = dossierJournaux();
  let entrees = [];
  try { entrees = fs.readdirSync(dossier, { withFileTypes: true }); } catch (e) { return []; }
  const liste = [];
  for (const e of entrees) {
    if (!e.isFile() || !/^update-.*\.log$/i.test(e.name)) { continue; }
    const chemin = path.join(dossier, e.name);
    let stat;
    try { stat = fs.statSync(chemin); } catch (err) { continue; }
    liste.push({ chemin, nom: e.name, date: dateDuNom(e.name) || stat.mtime, taille: stat.size,
      verdict: verdictJournal(chemin) });
  }
  liste.sort((a, b) => b.date - a.date);
  return liste.slice(0, n);
}

// La fin d'un journal : ses dernières lignes, et leur nombre quand le fichier en a davantage.
function finJournal(chemin, combien) {
  const n = combien || LIGNES_FIN;
  const lignes = lignesDe(fs.readFileSync(chemin, 'utf8'));
  const tronque = lignes.length > n;
  return { texte: lignes.slice(-n).join('\n'), lignes: tronque ? n : 0, total: lignes.length };
}

module.exports = { journauxMaj, verdictJournal, finJournal, dossierJournaux, dateDuNom, COMBIEN, LIGNES_FIN };
