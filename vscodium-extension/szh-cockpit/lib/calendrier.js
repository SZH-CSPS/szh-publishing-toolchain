// Le calendrier de l'Accueil : lit calendrier.csv et rend les événements de la semaine en
// cours. Le format du fichier est décrit en tête du fichier lui-même.
'use strict';

const fs = require('fs');
const path = require('path');

const FICHIER = path.join(__dirname, '..', 'calendrier.csv');
const COLONNES = ['date', 'annee', 'type', 'fr', 'de'];
const TYPES = ['csps', 'int', 'ch', 'fun'];
const JOURS = { dimanche: 0, lundi: 1, mardi: 2, mercredi: 3, jeudi: 4, vendredi: 5, samedi: 6 };

const RE_FIXE = /^(\d{1,2})\.(\d{1,2})$/;
const RE_MOBILE = /^(1er|[2-5]e|dernier) (lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche) (\d{1,2})$/;

// Découpe une ligne aux points-virgules. Un champ entre guillemets droits peut contenir un
// point-virgule ; deux guillemets y valent un guillemet.
function champs(ligne) {
  const sortie = [];
  let i = 0;
  while (i <= ligne.length) {
    if (ligne[i] === '"') {
      let v = '';
      i++;
      while (i < ligne.length) {
        if (ligne[i] === '"' && ligne[i + 1] === '"') { v += '"'; i += 2; }
        else if (ligne[i] === '"') { i++; break; }
        else { v += ligne[i]; i++; }
      }
      const fin = ligne.indexOf(';', i);
      sortie.push(v);
      i = fin === -1 ? ligne.length + 1 : fin + 1;
    } else {
      const fin = ligne.indexOf(';', i);
      sortie.push(ligne.slice(i, fin === -1 ? ligne.length : fin).trim());
      i = fin === -1 ? ligne.length + 1 : fin + 1;
    }
  }
  return sortie;
}

// La règle de date d'une ligne : { mois, jour } ou { mois, rang, jourSemaine }, le rang
// valant -1 pour « dernier ». Rend null si la date est mal écrite.
function regleDate(texte) {
  const t = String(texte || '').trim().toLowerCase();
  let m = RE_FIXE.exec(t);
  if (m) {
    const jour = Number(m[1]);
    const mois = Number(m[2]);
    if (mois < 1 || mois > 12 || jour < 1 || jour > new Date(2024, mois, 0).getDate()) { return null; }
    return { mois, jour };
  }
  m = RE_MOBILE.exec(t);
  if (m) {
    const mois = Number(m[3]);
    if (mois < 1 || mois > 12) { return null; }
    const rang = m[1] === 'dernier' ? -1 : Number(m[1].replace(/\D/g, ''));
    return { mois, rang, jourSemaine: JOURS[m[2]] };
  }
  return null;
}

// Le jour où tombe la règle une année donnée, à minuit heure locale ; null si ce jour
// n'existe pas cette année-là (29.02 d'une année non bissextile).
function dateDans(regle, annee) {
  if (regle.jour) {
    const d = new Date(annee, regle.mois - 1, regle.jour);
    return d.getMonth() === regle.mois - 1 ? d : null;
  }
  if (regle.rang === -1) {
    const d = new Date(annee, regle.mois, 0);
    d.setDate(d.getDate() - ((d.getDay() - regle.jourSemaine + 7) % 7));
    return d;
  }
  const d = new Date(annee, regle.mois - 1, 1);
  d.setDate(1 + ((regle.jourSemaine - d.getDay() + 7) % 7) + 7 * (regle.rang - 1));
  return d.getMonth() === regle.mois - 1 ? d : null;
}

// Lit le texte d'un calendrier. Rend { entrees, erreurs } : une erreur porte le numéro de
// ligne et son motif, et la ligne fautive est écartée.
function analyser(texte) {
  const entrees = [];
  const erreurs = [];
  let entete = false;
  String(texte || '').replace(/^﻿/, '').split(/\r?\n/).forEach((brute, i) => {
    const ligne = brute.trim();
    if (!ligne || ligne.startsWith('#')) { return; }
    const c = champs(ligne);
    if (!entete) {
      entete = true;
      if (c.map((x) => x.toLowerCase()).join(';') !== COLONNES.join(';')) {
        erreurs.push({ ligne: i + 1, motif: 'en-tête attendu : ' + COLONNES.join(';') });
      }
      return;
    }
    const erreur = (motif) => erreurs.push({ ligne: i + 1, motif });
    if (c.length !== COLONNES.length) { erreur(COLONNES.length + ' colonnes attendues, ' + c.length + ' lues'); return; }
    const [date, annee, type, fr, de] = c;
    const regle = regleDate(date);
    if (!regle) { erreur('date illisible : ' + date); return; }
    if (annee && !/^\d{4}$/.test(annee)) { erreur('année illisible : ' + annee); return; }
    if (TYPES.indexOf(type) === -1) { erreur('type inconnu : ' + type); return; }
    if (!fr || !de) { erreur('texte manquant en ' + (!fr ? 'fr' : 'de')); return; }
    if (!annee && (fr + de).includes('{ans}')) { erreur('{ans} sans année'); return; }
    entrees.push({ regle, annee: annee ? Number(annee) : null, type, textes: { fr, de } });
  });
  if (!entete) { erreurs.push({ ligne: 0, motif: 'fichier vide' }); }
  return { entrees, erreurs };
}

function lire(fichier) {
  let texte;
  try { texte = fs.readFileSync(fichier || FICHIER, 'utf8'); }
  catch (e) { return { entrees: [], erreurs: [{ ligne: 0, motif: e.message }] }; }
  return analyser(texte);
}

function lundiDe(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

// Les événements de la semaine (lundi à dimanche) qui contient `maintenant`, dans l'ordre
// des jours puis du fichier : [{ date: 'JJ.MM', aujourdhui, type, texte }]. Un texte manquant
// dans la langue demandée se rend en français.
function semaine(entrees, maintenant, langue) {
  const lundi = lundiDe(maintenant);
  const dimanche = new Date(lundi.getFullYear(), lundi.getMonth(), lundi.getDate() + 6);
  const jour = (d) => d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
  const aujourdhui = jour(maintenant);
  const annees = lundi.getFullYear() === dimanche.getFullYear()
    ? [lundi.getFullYear()] : [lundi.getFullYear(), dimanche.getFullYear()];
  const trouves = [];
  entrees.forEach((e, rang) => {
    for (const an of annees) {
      const d = dateDans(e.regle, an);
      if (!d || d < lundi || d > dimanche) { continue; }
      const brut = e.textes[langue] || e.textes.fr;
      const texte = e.annee === null ? brut : brut.split('{ans}').join(String(an - e.annee));
      const p2 = (n) => String(n).padStart(2, '0');
      trouves.push({ cle: jour(d), rang, date: p2(d.getDate()) + '.' + p2(d.getMonth() + 1),
        aujourdhui: jour(d) === aujourdhui, type: e.type, texte });
    }
  });
  trouves.sort((a, b) => a.cle - b.cle || a.rang - b.rang);
  return trouves.map(({ date, aujourdhui: auj, type, texte }) => ({ date, aujourdhui: auj, type, texte }));
}

module.exports = { FICHIER, COLONNES, TYPES, analyser, lire, regleDate, dateDans, lundiDe, semaine };
