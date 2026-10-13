// Trois jeux cachés dans l'Accueil. Cinq clics de suite sur un même bouton de produit ouvrent
// le jeu de ce produit : Revue, un casse-briques ; Zeitschrift, un serpent ; Book, un pong.
// Le jeu s'affiche dans une modale ; Échap ou un clic à côté le ferme.
var SZH_JEUX = (function () {
  'use strict';
  var TXT = __TXT_JEUX__;
  var CLICS = 5;
  var ECART = 1200;          // ms au plus entre deux clics de la série
  var JEU_DE = { revue: 'casse', zeitschrift: 'serpent', livre: 'pong' };
  // Le rouge du CSPS : la couleur de charte (700) et ses crans, repris de --c-rouge-* dans
  // pipeline/styles/couleurs.css. test/js/surprises.test.js vérifie qu'ils concordent.
  var ROUGE = { 100: '#FFDFDD', 200: '#FFC3BF', 300: '#FFA5A1', 400: '#F88480', 500: '#E95D5F', 600: '#DB3641',
    700: '#D31932', 800: '#9F001F', 900: '#810017' };
  // Les crans employés selon le thème : sur fond sombre, les rouges foncés disparaîtraient.
  // Chaque cran tient Lc 30 sur la surface du jeu, mesuré par test/js/surprises.test.js.
  var TEINTES = {
    clair: { briques: [900, 800, 700, 600, 500], balle: 700, tete: 800, corps: 600, ligne: 500 },
    sombre: { briques: [100, 200, 300, 400, 500], balle: 400, tete: 200, corps: 400, ligne: 500 }
  };
  var L = 480;
  var H = 360;

  function remplir(modele, valeurs) {
    return String(modele).replace(/\{(\d+)\}/g, function (m, i) { return String(valeurs[Number(i)]); });
  }
  function borner(v, min, max) { return Math.max(min, Math.min(max, v)); }

  // ---- La série de clics ----
  // Rend le jeu à ouvrir quand le même bouton vient d'être cliqué CLICS fois, sinon null.
  var serie = { cle: '', n: 0, t: 0 };
  function compterClic(nom, valeur, t) {
    var cle = nom + '|' + valeur;
    if (cle === serie.cle && t - serie.t <= ECART) { serie.n++; }
    else { serie = { cle: cle, n: 1, t: 0 }; }
    serie.t = t;
    if (serie.n < CLICS) { return null; }
    serie = { cle: '', n: 0, t: 0 };
    return JEU_DE[valeur] || null;
  }
  function instant(ev) { return typeof ev.timeStamp === 'number' && ev.timeStamp > 0 ? ev.timeStamp : Date.now(); }

  // Les clics qui prolongent la série après l'ouverture tombent sur le voile de la modale, qui
  // refermerait le jeu : tant qu'ils se suivent à moins d'ECART, ils sont arrêtés à la phase
  // de capture, avant d'atteindre le voile.
  var graceJusqua = -1;
  document.addEventListener('click', function (ev) {
    var c = ev.target;
    if (!jeu || !c || !c.classList || !c.classList.contains('szh-modale')) { return; }
    var t = instant(ev);
    if (t > graceJusqua) { return; }
    graceJusqua = t + ECART;
    ev.stopPropagation();
    ev.preventDefault();
  }, true);

  // Le clic sur l'étiquette se répercute sur le bouton radio : seul celui-ci est compté. Un jeu
  // ouvert ne compte plus rien.
  document.addEventListener('click', function (ev) {
    var c = ev.target;
    if (jeu || !c || c.type !== 'radio' || String(c.name || '').indexOf('produit-') !== 0) { return; }
    var t = instant(ev);
    var nom = compterClic(c.name, c.value, t);
    if (nom) {
      graceJusqua = t + ECART;
      ouvrir(nom);
    }
  });

  // ---- Casse-briques ----
  function casse() {
    var COLS = 8;
    var RANGS = 5;
    var MARGE = 16;
    var ESP = 6;
    var BL = (L - 2 * MARGE - (COLS - 1) * ESP) / COLS;
    var BH = 16;
    var raq = { x: L / 2 - 35, l: 70, h: 10, y: H - 24 };
    var balle;
    var briques;
    var vies;
    var score;
    var etat;
    var dir = 0;

    function poserBalle() { balle = { x: raq.x + raq.l / 2, y: raq.y - 7, vx: 0, vy: 0, r: 6 }; }
    function partie() {
      briques = [];
      for (var r = 0; r < RANGS; r++) {
        for (var c = 0; c < COLS; c++) { briques.push({ x: MARGE + c * (BL + ESP), y: 40 + r * (BH + ESP), rang: r }); }
      }
      vies = 3; score = 0; etat = 'pret';
      poserBalle();
    }
    function lancer() {
      var angle = (Math.random() * 0.8 - 0.4) - Math.PI / 2;
      balle.vx = 280 * Math.cos(angle); balle.vy = 280 * Math.sin(angle);
      etat = 'jeu';
    }
    partie();

    return {
      touche: function (k, bas) {
        if (k === 'ArrowLeft') { dir = bas ? -1 : (dir === -1 ? 0 : dir); return true; }
        if (k === 'ArrowRight') { dir = bas ? 1 : (dir === 1 ? 0 : dir); return true; }
        if (k === ' ' && bas) {
          if (etat === 'perdu' || etat === 'gagne') { partie(); } else if (etat === 'pret') { lancer(); }
          return true;
        }
        return false;
      },
      souris: function (x) { raq.x = borner(x - raq.l / 2, 0, L - raq.l); },
      etape: function (dt) {
        raq.x = borner(raq.x + dir * 380 * dt, 0, L - raq.l);
        if (etat !== 'jeu') { if (etat === 'pret') { poserBalle(); } return; }
        balle.x += balle.vx * dt; balle.y += balle.vy * dt;
        if (balle.x < balle.r) { balle.x = balle.r; balle.vx = Math.abs(balle.vx); }
        if (balle.x > L - balle.r) { balle.x = L - balle.r; balle.vx = -Math.abs(balle.vx); }
        if (balle.y < balle.r) { balle.y = balle.r; balle.vy = Math.abs(balle.vy); }
        // La raquette renvoie la balle selon l'endroit touché : le bord donne un angle vif.
        if (balle.vy > 0 && balle.y + balle.r >= raq.y && balle.y < raq.y + raq.h &&
            balle.x >= raq.x - balle.r && balle.x <= raq.x + raq.l + balle.r) {
          var pos = borner((balle.x - (raq.x + raq.l / 2)) / (raq.l / 2), -1, 1);
          var v = Math.min(Math.sqrt(balle.vx * balle.vx + balle.vy * balle.vy) * 1.02, 480);
          var a = pos * 1.05 - Math.PI / 2;
          balle.vx = v * Math.cos(a); balle.vy = v * Math.sin(a);
          balle.y = raq.y - balle.r;
        }
        for (var i = 0; i < briques.length; i++) {
          var b = briques[i];
          if (balle.x + balle.r < b.x || balle.x - balle.r > b.x + BL || balle.y + balle.r < b.y || balle.y - balle.r > b.y + BH) { continue; }
          var dx = Math.min(balle.x + balle.r - b.x, b.x + BL - (balle.x - balle.r));
          var dy = Math.min(balle.y + balle.r - b.y, b.y + BH - (balle.y - balle.r));
          if (dx < dy) { balle.vx = -balle.vx; } else { balle.vy = -balle.vy; }
          briques.splice(i, 1);
          score += 10 * (RANGS - b.rang);
          break;
        }
        if (!briques.length) { etat = 'gagne'; }
        if (balle.y > H + balle.r) {
          vies--;
          etat = vies > 0 ? 'pret' : 'perdu';
          poserBalle();
        }
      },
      dessiner: function (g, c) {
        briques.forEach(function (b) {
          g.fillStyle = c.rouge[c.teintes.briques[b.rang]];
          g.fillRect(b.x, b.y, BL, BH);
        });
        g.fillStyle = c.encre;
        g.fillRect(raq.x, raq.y, raq.l, raq.h);
        g.fillStyle = c.rouge[c.teintes.balle];
        g.beginPath(); g.arc(balle.x, balle.y, balle.r, 0, Math.PI * 2); g.fill();
      },
      etat: function () { return etat; },
      bilan: function () { return remplir(TXT.score, [score]) + ' · ' + remplir(TXT.vies, [vies]); }
    };
  }

  // ---- Serpent ----
  function serpent() {
    var C = 20;
    var NX = L / C;
    var NY = H / C;
    var corps;
    var dir;
    var suivante;
    var pomme;
    var score;
    var etat;
    var cumul;
    var pas;

    function libre(x, y) { return !corps.some(function (p) { return p.x === x && p.y === y; }); }
    function semer() {
      var x;
      var y;
      do { x = Math.floor(Math.random() * NX); y = Math.floor(Math.random() * NY); } while (!libre(x, y));
      pomme = { x: x, y: y };
    }
    function partie() {
      corps = [{ x: 6, y: 9 }, { x: 5, y: 9 }, { x: 4, y: 9 }];
      dir = { x: 1, y: 0 }; suivante = dir;
      score = 0; etat = 'pret'; cumul = 0; pas = 0.13;
      semer();
    }
    partie();
    var DIRS = { ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 }, ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 } };

    return {
      touche: function (k, bas) {
        if (!bas) { return !!DIRS[k] || k === ' '; }
        if (DIRS[k]) {
          // Pas de demi-tour sur soi-même.
          if (DIRS[k].x !== -dir.x || DIRS[k].y !== -dir.y) { suivante = DIRS[k]; }
          if (etat === 'pret') { etat = 'jeu'; }
          return true;
        }
        if (k === ' ') {
          if (etat === 'perdu') { partie(); } else if (etat === 'pret') { etat = 'jeu'; }
          return true;
        }
        return false;
      },
      souris: function () {},
      etape: function (dt) {
        if (etat !== 'jeu') { return; }
        cumul += dt;
        while (cumul >= pas && etat === 'jeu') {
          cumul -= pas;
          dir = suivante;
          var t = { x: corps[0].x + dir.x, y: corps[0].y + dir.y };
          if (t.x < 0 || t.y < 0 || t.x >= NX || t.y >= NY || !libre(t.x, t.y)) { etat = 'perdu'; return; }
          corps.unshift(t);
          if (t.x === pomme.x && t.y === pomme.y) {
            score++;
            pas = Math.max(0.06, pas - 0.004);
            semer();
          } else {
            corps.pop();
          }
        }
      },
      dessiner: function (g, c) {
        g.fillStyle = c.encre;
        g.beginPath(); g.arc(pomme.x * C + C / 2, pomme.y * C + C / 2, C / 2 - 3, 0, Math.PI * 2); g.fill();
        corps.forEach(function (p, i) {
          g.fillStyle = c.rouge[i === 0 ? c.teintes.tete : c.teintes.corps];
          g.fillRect(p.x * C + 1, p.y * C + 1, C - 2, C - 2);
        });
      },
      etat: function () { return etat; },
      bilan: function () { return remplir(TXT.score, [score]); }
    };
  }

  // ---- Pong ----
  function pong() {
    var BUT = 5;
    var RL = 10;
    var RH = 60;
    var moi = { x: 16, y: H / 2 - RH / 2 };
    var lui = { x: L - 16 - RL, y: H / 2 - RH / 2 };
    var balle;
    var points;
    var etat;
    var dir = 0;
    var service = 1;

    function centrer() { balle = { x: L / 2, y: H / 2, vx: 0, vy: 0, r: 6 }; }
    function partie() { points = [0, 0]; etat = 'pret'; centrer(); }
    function servir() {
      var a = Math.random() * 0.8 - 0.4;
      balle.vx = 260 * Math.cos(a) * service; balle.vy = 260 * Math.sin(a);
      etat = 'jeu';
    }
    function renvoi(r, cote) {
      var pos = borner((balle.y - (r.y + RH / 2)) / (RH / 2), -1, 1);
      var v = Math.min(Math.sqrt(balle.vx * balle.vx + balle.vy * balle.vy) * 1.05, 560);
      balle.vx = cote * v * Math.cos(pos * 0.9); balle.vy = v * Math.sin(pos * 0.9);
    }
    partie();

    return {
      touche: function (k, bas) {
        if (k === 'ArrowUp') { dir = bas ? -1 : (dir === -1 ? 0 : dir); return true; }
        if (k === 'ArrowDown') { dir = bas ? 1 : (dir === 1 ? 0 : dir); return true; }
        if (k === ' ' && bas) {
          if (etat === 'perdu' || etat === 'gagne') { partie(); } else if (etat === 'pret') { servir(); }
          return true;
        }
        return false;
      },
      souris: function (x, y) { moi.y = borner(y - RH / 2, 0, H - RH); },
      etape: function (dt) {
        moi.y = borner(moi.y + dir * 340 * dt, 0, H - RH);
        // L'adversaire suit la balle, moins vite qu'elle ne peut aller.
        var cible = (etat === 'jeu' && balle.vx > 0 ? balle.y : H / 2) - RH / 2;
        lui.y = borner(lui.y + borner(cible - lui.y, -230 * dt, 230 * dt), 0, H - RH);
        if (etat !== 'jeu') { return; }
        balle.x += balle.vx * dt; balle.y += balle.vy * dt;
        if (balle.y < balle.r) { balle.y = balle.r; balle.vy = Math.abs(balle.vy); }
        if (balle.y > H - balle.r) { balle.y = H - balle.r; balle.vy = -Math.abs(balle.vy); }
        if (balle.vx < 0 && balle.x - balle.r <= moi.x + RL && balle.x > moi.x && balle.y >= moi.y - balle.r && balle.y <= moi.y + RH + balle.r) {
          balle.x = moi.x + RL + balle.r; renvoi(moi, 1);
        }
        if (balle.vx > 0 && balle.x + balle.r >= lui.x && balle.x < lui.x + RL && balle.y >= lui.y - balle.r && balle.y <= lui.y + RH + balle.r) {
          balle.x = lui.x - balle.r; renvoi(lui, -1);
        }
        if (balle.x < -balle.r || balle.x > L + balle.r) {
          var gagnant = balle.x < 0 ? 1 : 0;
          points[gagnant]++;
          service = gagnant === 0 ? 1 : -1;
          centrer();
          etat = points[0] >= BUT ? 'gagne' : (points[1] >= BUT ? 'perdu' : 'pret');
        }
      },
      dessiner: function (g, c) {
        g.fillStyle = c.rouge[c.teintes.ligne];
        for (var y = 6; y < H; y += 20) { g.fillRect(L / 2 - 1, y, 2, 10); }
        g.fillStyle = c.encre;
        g.fillRect(moi.x, moi.y, RL, RH);
        g.fillRect(lui.x, lui.y, RL, RH);
        g.fillStyle = c.rouge[c.teintes.balle];
        g.beginPath(); g.arc(balle.x, balle.y, balle.r, 0, Math.PI * 2); g.fill();
      },
      etat: function () { return etat; },
      bilan: function () { return remplir(TXT.pongScore, [points[0], points[1]]); }
    };
  }

  var FABRIQUES = { casse: casse, serpent: serpent, pong: pong };
  var AIDES = { casse: TXT.aideCasse, serpent: TXT.aideSerpent, pong: TXT.aidePong };

  // ---- La modale et la boucle d'animation ----
  var boite = null;
  var titre;
  var etatTexte;
  var toile;
  var aide;
  var jeu = null;
  var image = 0;
  var avant = 0;

  // L'encre suit le thème de l'éditeur ; une encre claire signale un thème sombre.
  function couleurs() {
    var encre = getComputedStyle(toile).color || '#888';
    var m = /(\d+)\D+(\d+)\D+(\d+)/.exec(encre);
    var sombre = !!m && (Number(m[1]) + Number(m[2]) + Number(m[3])) / 3 > 128;
    return { encre: encre, rouge: ROUGE, teintes: TEINTES[sombre ? 'sombre' : 'clair'] };
  }

  // Le texte d'état est aussi annoncé aux lecteurs d'écran : il ne change qu'avec le jeu.
  function majEtat() {
    var e = jeu.etat();
    var t = jeu.bilan() + (e === 'pret' ? ' · ' + TXT.pret : e === 'perdu' ? ' · ' + TXT.perdu : e === 'gagne' ? ' · ' + TXT.gagne : '');
    if (etatTexte.textContent !== t) { etatTexte.textContent = t; }
  }

  function boucle(t) {
    if (!jeu) { return; }
    var dt = avant ? Math.min((t - avant) / 1000, 1 / 30) : 0;
    avant = t;
    jeu.etape(dt);
    var g = toile.getContext('2d');
    var c = couleurs();
    g.clearRect(0, 0, L, H);
    jeu.dessiner(g, c);
    var e = jeu.etat();
    if (e !== 'jeu') {
      g.fillStyle = c.encre;
      g.font = 'bold 18px ' + (getComputedStyle(toile).fontFamily || 'sans-serif');
      g.textAlign = 'center';
      g.fillText(e === 'perdu' ? TXT.perdu : e === 'gagne' ? TXT.gagne : TXT.pret, L / 2, H / 2 + 60);
    }
    majEtat();
    image = requestAnimationFrame(boucle);
  }

  function arreter() {
    jeu = null;
    if (image) { cancelAnimationFrame(image); image = 0; }
  }

  var modale = SZH.modale({
    classeBoite: 'jeu-boite',
    construire: function (b) {
      boite = b;
      b.style.borderTop = '4px solid ' + ROUGE[700];
      var tete = SZH.poser(b, 'div', 'jeu-tete');
      titre = SZH.poser(tete, 'h2', '');
      etatTexte = SZH.poser(tete, 'span', 'jeu-etat');
      etatTexte.setAttribute('aria-live', 'polite');
      toile = SZH.poser(b, 'canvas', '');
      toile.width = L;
      toile.height = H;
      toile.setAttribute('tabindex', '0');
      toile.addEventListener('keydown', function (ev) { if (jeu && jeu.touche(ev.key, true)) { ev.preventDefault(); } });
      toile.addEventListener('keyup', function (ev) { if (jeu) { jeu.touche(ev.key, false); } });
      toile.addEventListener('mousemove', function (ev) {
        if (!jeu || !toile.getBoundingClientRect) { return; }
        var r = toile.getBoundingClientRect();
        jeu.souris((ev.clientX - r.left) * L / r.width, (ev.clientY - r.top) * H / r.height);
      });
      toile.addEventListener('click', function () { if (jeu) { jeu.touche(' ', true); } });
      aide = SZH.poser(b, 'p', 'jeu-aide');
      var pied = SZH.poser(b, 'div', 'jeu-pied');
      pied.appendChild(SZH.bouton(TXT.fermer, function () { modale.fermer(); }));
    },
    surFermeture: arreter,
    focus: function () { return toile; }
  });

  function ouvrir(nom) {
    if (!FABRIQUES[nom]) { return; }
    arreter();
    modale.ouvrir();
    titre.textContent = TXT[nom];
    toile.setAttribute('aria-label', TXT[nom]);
    aide.textContent = AIDES[nom];
    jeu = FABRIQUES[nom]();
    majEtat();
    avant = 0;
    if (toile.getContext && typeof requestAnimationFrame === 'function') { image = requestAnimationFrame(boucle); }
  }

  return { ouvrir: ouvrir, compterClic: compterClic, fabriques: FABRIQUES, dimensions: { L: L, H: H }, rouge: ROUGE, teintes: TEINTES };
}());
