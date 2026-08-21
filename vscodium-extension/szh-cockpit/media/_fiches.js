// Cartes de métadonnées d'article et modale photo, partagées par « Métadonnées des
// articles » et « Vérification de l'import ». Posé après _commun.js, et seulement sur ces
// deux pages : les autres webviews n'en ont pas l'usage.
//
//   SZH.cartesArticles(opts)  construit et pilote les cartes d'un conteneur, la modale
//                             photo et l'enregistrement
//   SZH.icone(chemin)         une icône SVG de 14 px

(function () {
  'use strict';

  // ---- Icônes ----

  var SVG_NS = 'http://www.w3.org/2000/svg';
  var CHEMIN_POUBELLE = 'M10 3h3v1h-1v9l-1 1H4l-1-1V4H2V3h3V2a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1zM9 2H6v1h3V2zM4 13h7V4H4v9zm2-8H5v7h1V5zm1 0h1v7H7V5zm2 0h1v7H9V5z';
  var CHEMIN_CAMERA = 'M6.2 2a1 1 0 0 0-.9.55L4.6 4H2.5A1.5 1.5 0 0 0 1 5.5v7A1.5 1.5 0 0 0 2.5 14h11a1.5 1.5 0 0 0 1.5-1.5v-7A1.5 1.5 0 0 0 13.5 4h-2.1l-.7-1.45a1 1 0 0 0-.9-.55H6.2zM8 6a3.25 3.25 0 1 0 0 6.5 3.25 3.25 0 0 0 0-6.5zm0 1.5a1.75 1.75 0 1 0 0 3.5 1.75 1.75 0 0 0 0-3.5z';

  function icone(chemin) {
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('width', '14');
    svg.setAttribute('height', '14');
    svg.setAttribute('fill', 'currentColor');
    svg.setAttribute('aria-hidden', 'true');
    var p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('fill-rule', 'evenodd');
    p.setAttribute('clip-rule', 'evenodd');
    p.setAttribute('d', chemin);
    svg.appendChild(p);
    return svg;
  }

  // ---- Cartes de métadonnées d'article ----
  //
  // La carte (type, titres, sous-titres, résumés, auteurs, DOI, mots-clés) et la modale
  // photo, partagées par « Métadonnées des articles » et « Vérification de l'import ».
  // Les deux pages ne diffèrent que par des décorations : la seconde pose un badge sur
  // chaque intitulé et un compteur de champs vides. D'où `decor`, dont tous les crochets
  // sont facultatifs :
  //
  //   titre(h2, slug)                 remplit l'en-tête de la carte
  //   champ(label, champId)           décore l'intitulé d'un champ
  //   motsCles(label, langues, noms)  décore l'intitulé du bloc de mots-clés
  //   apresAuteurs(carte)             insère quelque chose après la liste d'auteurs
  //   finCarte(carte, article)        carte construite et insérée
  //   carteChangee(carte)             la colonne italienne vient d'être basculée
  //   marque(carte, slug)             une carte vient d'être marquée modifiée
  //
  // `surChangement()` est appelé quand l'ensemble des cartes modifiées change, y compris
  // au re-rendu qui le vide.
  //
  // Protocole avec l'hôte, pour la partie photo :
  //   webview -> hôte : photo-ouvrir { slug, index, photo } ;
  //                     photo-deposer { slug, index, prenom, nom, nomFichier, donneesBase64 } ;
  //                     photo-choisir { slug, index, base, version }
  //   hôte -> webview : photo-versions { slug, index, base, versions, actuelle, infos } ;
  //                     photo-valeur { slug, index, photo } ; photo-erreur { slug, index, message }
  function cartesArticles(opts) {
    var conteneur = opts.conteneur;
    var api = opts.api;
    var TXT = opts.txt;
    var etat = opts.etat;
    var decor = opts.decor || {};
    var surChangement = opts.surChangement || function () {};
    var appeler = function (nom, a, b, c) { if (decor[nom]) { decor[nom](a, b, c); } };

    var TAILLE_MAX_PHOTO = 20 * 1024 * 1024;
    var EXTENSIONS_PHOTO = ['png', 'jpg', 'jpeg', 'webp'];
    var VERSIONS = ['sans-fond', 'avec-fond', 'original'];   // ordre de repli

    var modifies = new Set();
    var motsClesParCarte = new WeakMap();
    var TYPES = [];
    var LANGUE_DEFAUT = 'fr';

    function marquer(carte, slug) {
      modifies.add(slug);
      carte.classList.add('modifie');
      if (etat) { etat.textContent = ''; }
      surChangement();
      appeler('marque', carte, slug);
    }

    function champTexte(carte, parent, slug, cle, langue, libelle, valeur, multiligne) {
      var l = document.createElement('label');
      l.textContent = libelle;
      appeler('champ', l, langue ? cle + '.' + langue : cle);
      var i = document.createElement(multiligne ? 'textarea' : 'input');
      if (multiligne) { i.rows = 3; } else { i.type = 'text'; }
      i.value = valeur || '';
      i.dataset.cle = cle;
      if (langue) { i.dataset.langue = langue; l.classList.add('champ-' + langue); i.classList.add('champ-' + langue); }
      i.addEventListener('input', function () { marquer(carte, slug); });
      parent.appendChild(l);
      parent.appendChild(i);
    }

    function majBoutonPhoto(rangee, bouton) {
      var b = bouton || rangee.querySelector('button.photo');
      if (!b) { return; }
      var photo = rangee.dataset.photo || '';
      b.classList.toggle('avec-photo', photo !== '');
      b.title = photo !== '' ? TXT.photoPresente.split('{0}').join(photo) : TXT.photoBouton;
    }

    // Note éphémère sous une rangée d'auteur, pour ce qui n'a pas sa place dans la modale.
    function noteRangee(rangee, texte) {
      var note = rangee.nextElementSibling;
      if (!note || !note.classList || !note.classList.contains('note-auteur')) {
        note = document.createElement('div');
        note.className = 'note-auteur';
        rangee.parentNode.insertBefore(note, rangee.nextSibling);
      }
      note.textContent = texte;
      if (note._minuteur) { clearTimeout(note._minuteur); }
      note._minuteur = setTimeout(function () { note.remove(); }, 5000);
    }

    function ligneAuteur(carte, slug, zone, auteur) {
      var rangee = document.createElement('div');
      rangee.className = 'auteur';
      rangee.dataset.photo = (auteur && auteur.photo) || '';
      var champs = [['prenom', TXT.aPrenom], ['nom', TXT.aNom], ['fonction', TXT.aFonction],
        ['affiliation', TXT.aAffiliation], ['orcid', TXT.aOrcid], ['email', TXT.aEmail]];
      for (var k = 0; k < champs.length; k++) {
        var i = document.createElement('input');
        i.type = 'text';
        i.placeholder = champs[k][1];
        i.title = champs[k][1];
        i.value = (auteur && auteur[champs[k][0]]) || '';
        i.dataset.cle = champs[k][0];
        i.addEventListener('input', function () { marquer(carte, slug); });
        rangee.appendChild(i);
      }
      var photo = document.createElement('button');
      photo.type = 'button';
      photo.className = 'photo';
      photo.appendChild(icone(CHEMIN_CAMERA));
      majBoutonPhoto(rangee, photo);
      photo.addEventListener('click', function () { ouvrirModale(carte, slug, rangee); });
      rangee.appendChild(photo);
      var retirer = document.createElement('button');
      retirer.type = 'button';
      retirer.className = 'retirer';
      retirer.appendChild(icone(CHEMIN_POUBELLE));
      retirer.title = TXT.retirerAuteur;
      retirer.addEventListener('click', function () { rangee.remove(); marquer(carte, slug); });
      rangee.appendChild(retirer);
      zone.appendChild(rangee);
    }

    // ---- Modale photo ----
    //
    // Un voile dans la webview, alimenté par postMessage : les aperçus sont des data: URI
    // renvoyées par l'hôte, qui seul touche au disque et à la distro.
    var modale = null;   // éléments du DOM, construits une fois
    var ctx = null;      // { carte, slug, rangee, index, base, versions, occupe }

    function uriPour(version) {
      if (!ctx || !ctx.versions) { return null; }
      if (version === 'original') { return ctx.versions.original || null; }
      if (version === 'avec-fond') { return ctx.versions.avecFond || null; }
      if (version === 'sans-fond') { return ctx.versions.sansFond || null; }
      return null;
    }
    function radioChoisie() {
      var r = modale.radios.querySelector('input:checked');
      return r ? r.value : 'sans-fond';
    }
    function poserRadio(version) {
      var rs = modale.radios.querySelectorAll('input');
      for (var i = 0; i < rs.length; i++) { rs[i].checked = (rs[i].value === version); }
    }
    function majRadios() {
      var rs = modale.radios.querySelectorAll('input');
      for (var i = 0; i < rs.length; i++) { rs[i].disabled = !ctx || !uriPour(rs[i].value); }
    }
    function majApercu() {
      var uri = uriPour(radioChoisie());
      if (uri) { modale.img.src = uri; modale.img.hidden = false; }
      else { modale.img.removeAttribute('src'); modale.img.hidden = true; }
      modale.valider.disabled = !uri || !ctx || !ctx.base || ctx.occupe;
    }
    function poserNote(texte, estErreur) {
      modale.note.textContent = texte || '';
      modale.note.classList.toggle('erreur', !!estErreur);
    }

    function construireModale() {
      var voile = document.createElement('div');
      voile.id = 'voile';
      voile.hidden = true;
      var boite = document.createElement('div');
      boite.className = 'modale';
      var titre = document.createElement('h3');
      boite.appendChild(titre);
      var zone = document.createElement('div');
      zone.className = 'zone-depot';
      var consigne = document.createElement('div');
      consigne.textContent = TXT.photoDeposer;
      zone.appendChild(consigne);
      var ou = document.createElement('div');
      ou.className = 'ou';
      ou.textContent = TXT.photoOu;
      zone.appendChild(ou);
      var choisir = document.createElement('button');
      choisir.type = 'button';
      choisir.textContent = TXT.photoChoisirFichier;
      zone.appendChild(choisir);
      var fichier = document.createElement('input');
      fichier.type = 'file';
      fichier.accept = 'image/*';
      fichier.hidden = true;
      zone.appendChild(fichier);
      choisir.addEventListener('click', function () { fichier.click(); });
      fichier.addEventListener('change', function () {
        if (fichier.files && fichier.files[0]) { deposerFichier(fichier.files[0]); }
        fichier.value = '';
      });
      zone.addEventListener('dragover', function (e) { e.preventDefault(); zone.classList.add('survol'); });
      zone.addEventListener('dragleave', function () { zone.classList.remove('survol'); });
      zone.addEventListener('drop', function (e) {
        e.preventDefault();
        zone.classList.remove('survol');
        var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (f) { deposerFichier(f); }
      });
      boite.appendChild(zone);
      var radios = document.createElement('div');
      radios.className = 'radios';
      var versions = [['original', TXT.vOriginal], ['avec-fond', TXT.vAvecFond], ['sans-fond', TXT.vSansFond]];
      for (var k = 0; k < versions.length; k++) {
        var l = document.createElement('label');
        var r = document.createElement('input');
        r.type = 'radio';
        r.name = 'version-photo';
        r.value = versions[k][0];
        r.addEventListener('change', majApercu);
        l.appendChild(r);
        l.appendChild(document.createTextNode(' ' + versions[k][1]));
        radios.appendChild(l);
      }
      boite.appendChild(radios);
      var apercu = document.createElement('div');
      apercu.className = 'apercu-photo';
      var img = document.createElement('img');
      img.alt = '';
      img.hidden = true;
      apercu.appendChild(img);
      boite.appendChild(apercu);
      var note = document.createElement('p');
      note.className = 'note-modale';
      boite.appendChild(note);
      var boutons = document.createElement('div');
      boutons.className = 'boutons-modale';
      var valider = document.createElement('button');
      valider.type = 'button';
      valider.className = 'principal';
      valider.textContent = TXT.valider;
      valider.disabled = true;
      valider.addEventListener('click', function () {
        if (!ctx || !ctx.base || ctx.occupe) { return; }
        api.postMessage({ type: 'photo-choisir', slug: ctx.slug, index: ctx.index, base: ctx.base, version: radioChoisie() });
      });
      var annuler = document.createElement('button');
      annuler.type = 'button';
      annuler.textContent = TXT.annuler;
      annuler.addEventListener('click', fermerModale);
      boutons.appendChild(valider);
      boutons.appendChild(annuler);
      boite.appendChild(boutons);
      voile.appendChild(boite);
      voile.addEventListener('click', function (e) { if (e.target === voile) { fermerModale(); } });
      document.body.appendChild(voile);
      modale = { voile: voile, titre: titre, zone: zone, radios: radios, img: img, note: note, valider: valider };
    }

    function ouvrirModale(carte, slug, rangee) {
      var prenom = (rangee.querySelector('input[data-cle=prenom]') || { value: '' }).value.trim();
      var nom = (rangee.querySelector('input[data-cle=nom]') || { value: '' }).value.trim();
      if (prenom === '' && nom === '') { noteRangee(rangee, TXT.photoNomRequis); return; }
      if (!modale) { construireModale(); }
      var index = Array.prototype.indexOf.call(carte.querySelectorAll('.auteur'), rangee);
      ctx = { carte: carte, slug: slug, rangee: rangee, index: index, base: null, versions: null, occupe: false };
      modale.titre.textContent = TXT.photoTitre.split('{0}').join((prenom + ' ' + nom).trim());
      poserRadio('sans-fond');
      majRadios();
      poserNote('');
      majApercu();
      var photo = rangee.dataset.photo || '';
      if (photo !== '') {
        poserNote(TXT.chargement);
        api.postMessage({ type: 'photo-ouvrir', slug: slug, index: index, photo: photo });
      }
      modale.voile.hidden = false;
    }

    function fermerModale() {
      if (modale) { modale.voile.hidden = true; }
      ctx = null;   // une réponse tardive de l'hôte sera ignorée : slug et index recontrôlés
    }

    function deposerFichier(f) {
      if (!ctx || ctx.occupe) { return; }
      var ext = (String(f.name || '').match(/\.([A-Za-z0-9]+)$/) || ['', ''])[1].toLowerCase();
      if (EXTENSIONS_PHOTO.indexOf(ext) === -1) { poserNote(TXT.errFormat, true); return; }
      if (f.size > TAILLE_MAX_PHOTO) { poserNote(TXT.errTropVolumineux, true); return; }
      var prenom = (ctx.rangee.querySelector('input[data-cle=prenom]') || { value: '' }).value.trim();
      var nom = (ctx.rangee.querySelector('input[data-cle=nom]') || { value: '' }).value.trim();
      var lecteur = new FileReader();
      var contexte = ctx;
      lecteur.onload = function () {
        if (ctx !== contexte) { return; }            // modale refermée entre-temps
        var texte = String(lecteur.result || '');
        var virgule = texte.indexOf(',');
        if (virgule === -1) { poserNote(TXT.errFormat, true); return; }
        ctx.occupe = true;
        poserNote(TXT.traitement);
        majApercu();
        api.postMessage({
          type: 'photo-deposer', slug: ctx.slug, index: ctx.index,
          prenom: prenom, nom: nom, nomFichier: f.name, donneesBase64: texte.slice(virgule + 1)
        });
      };
      lecteur.readAsDataURL(f);
    }

    // ---- Construction des cartes ----

    function rendre(articles, types, langueDefaut) {
      if (types) { TYPES = types; }
      if (langueDefaut) { LANGUE_DEFAUT = langueDefaut; }
      if (ctx) { fermerModale(); }                   // re-rendu : la rangée visée disparaît
      conteneur.textContent = '';
      modifies.clear();
      surChangement();
      for (var n = 0; n < articles.length; n++) {
        var carte = construireCarte(articles[n]);
        conteneur.appendChild(carte);
        appeler('finCarte', carte, articles[n]);
      }
    }

    function construireCarte(article) {
      var slug = article.slug;
      var carte = document.createElement('div');
      carte.className = 'carte';
      carte.dataset.slug = slug;
      var titre = document.createElement('h2');
      if (decor.titre) { decor.titre(titre, slug); } else { titre.textContent = slug; }
      carte.appendChild(titre);
      var v = article.valeurs || {};
      var avecIt = ['title', 'subtitle', 'resume'].some(function (c) { return v[c] && v[c].it; }) ||
        (v.keywords && v.keywords.it && v.keywords.it.length > 0);
      if (avecIt) { carte.classList.add('avec-it'); }

      var lType = document.createElement('label');
      lType.textContent = TXT.type;
      appeler('champ', lType, 'type');
      carte.appendChild(lType);
      var selection = document.createElement('select');
      selection.dataset.cle = 'type';
      var optVide = document.createElement('option');
      optVide.value = '';
      optVide.textContent = TXT.typeAucun;
      selection.appendChild(optVide);
      var cible = selection, groupeCourant = null;
      for (var t = 0; t < TYPES.length; t++) {
        var type = TYPES[t];
        if (type.groupe) {
          if (type.groupe !== groupeCourant) {
            groupeCourant = type.groupe;
            cible = document.createElement('optgroup');
            cible.label = type.groupe;
            selection.appendChild(cible);
          }
        } else { cible = selection; groupeCourant = null; }
        var opt = document.createElement('option');
        opt.value = type.valeur;
        opt.textContent = type.libelle;
        cible.appendChild(opt);
      }
      selection.value = v.type || '';
      if (selection.value !== (v.type || '')) { selection.value = ''; }
      selection.addEventListener('input', function () { marquer(carte, slug); });
      carte.appendChild(selection);

      // La langue par défaut du numéro vient en premier, les autres en dessous. L'italien
      // est toujours construit, et révélé par le CSS.
      var ordre = ['fr', 'de', 'it'];
      var defaut = ordre.indexOf(LANGUE_DEFAUT) !== -1 ? LANGUE_DEFAUT : 'fr';
      var langues = [defaut].concat(ordre.filter(function (l) { return l !== defaut; }));
      var noms = { fr: 'FR', de: 'DE', it: 'IT' };
      var textes = [['title', TXT.titreChamp, false], ['subtitle', TXT.sousTitre, false],
        ['resume', TXT.resume, true]];
      for (var c = 0; c < textes.length; c++) {
        for (var g = 0; g < langues.length; g++) {
          var lg = langues[g];
          champTexte(carte, carte, slug, textes[c][0], lg,
            textes[c][1].split('{0}').join(noms[lg]), (v[textes[c][0]] || {})[lg], textes[c][2]);
        }
      }

      var lAuteurs = document.createElement('label');
      lAuteurs.textContent = TXT.auteurs;
      appeler('champ', lAuteurs, 'auteurs');
      carte.appendChild(lAuteurs);
      var zone = document.createElement('div');
      zone.className = 'auteurs';
      carte.appendChild(zone);
      var auteurs = v.author || [];
      for (var a = 0; a < auteurs.length; a++) { ligneAuteur(carte, slug, zone, auteurs[a]); }
      var ajouter = document.createElement('button');
      ajouter.type = 'button';
      ajouter.textContent = TXT.ajouterAuteur;
      ajouter.addEventListener('click', function () { ligneAuteur(carte, slug, zone, null); marquer(carte, slug); });
      carte.appendChild(ajouter);
      appeler('apresAuteurs', carte);

      champTexte(carte, carte, slug, 'doi', null, 'DOI', v.doi);

      // Mots-clés : on ajoute et on retire une rangée entière, jamais un mot dans une
      // seule langue, la position seule appariant « diagnostic » et « Diagnose ».
      var lMots = document.createElement('label');
      lMots.textContent = TXT.motsClesTitre || '';
      appeler('motsCles', lMots, langues, noms);
      carte.appendChild(lMots);
      var colonnes = function (avec) {
        return langues.filter(function (l) { return l !== 'it' || avec; })
          .map(function (l) { return { code: l, libelle: noms[l] }; });
      };
      // SZH.motsCles : la grille vit dans _commun.js, un autre IIFE. L'appeler sans le
      // préfixe levait une ReferenceError au premier bloc de mots-clés — donc à chaque
      // carte, donc sur les deux formulaires, qui s'ouvraient vides sans un mot.
      var editeurMots = SZH.motsCles({
        langues: colonnes(avecIt),
        listes: v.keywords || {},
        edition: true,
        textes: {
          motCle: TXT.motsCles, ajouter: TXT.motCleAjouter,
          retirer: TXT.motCleRetirer, aide: TXT.motsClesAide
        },
        onChange: function () { marquer(carte, slug); }
      });
      motsClesParCarte.set(carte, editeurMots);
      carte.appendChild(editeurMots.element);

      var caseIt = document.createElement('label');
      caseIt.className = 'case-it';
      var coche = document.createElement('input');
      coche.type = 'checkbox';
      coche.checked = avecIt;
      caseIt.appendChild(coche);
      caseIt.appendChild(document.createTextNode(TXT.italien));
      coche.addEventListener('change', function () {
        carte.classList.toggle('avec-it', coche.checked);
        // La colonne italienne apparaît ou disparaît ; le fragment garde ses valeurs, qui
        // vivent dans son modèle et non dans le DOM.
        editeurMots.reconstruire(colonnes(coche.checked));
        appeler('carteChangee', carte);
      });
      carte.appendChild(caseIt);
      return carte;
    }

    function collecter(carte) {
      var resultat = { type: '', doi: '', title: {}, subtitle: {}, resume: {}, keywords: {}, author: [] };
      var sel = carte.querySelector('select[data-cle=type]');
      if (sel) { resultat.type = sel.value; }
      for (var i of carte.querySelectorAll(':scope > input, :scope > textarea')) {
        var cle = i.dataset.cle;
        var langue = i.dataset.langue;
        if (cle === 'doi') { resultat.doi = i.value; }
        else if (cle === 'title' || cle === 'subtitle' || cle === 'resume') { resultat[cle][langue] = i.value; }
      }
      for (var rangee of carte.querySelectorAll('.auteur')) {
        var auteur = {};
        for (var champ of rangee.querySelectorAll('input')) { auteur[champ.dataset.cle] = champ.value; }
        auteur.photo = rangee.dataset.photo || '';    // posé par la modale
        resultat.author.push(auteur);
      }
      var editeurMots = motsClesParCarte.get(carte);
      if (editeurMots) { resultat.keywords = editeurMots.collecter(); }
      return resultat;
    }

    function modifiees() {
      var envoi = {};
      for (var carte of conteneur.querySelectorAll('.carte')) {
        if (modifies.has(carte.dataset.slug)) { envoi[carte.dataset.slug] = collecter(carte); }
      }
      return envoi;
    }

    function oublier() {
      modifies.clear();
      surChangement();
      for (var carte of conteneur.querySelectorAll('.carte.modifie')) { carte.classList.remove('modifie'); }
    }

    // Traite les réponses de l'hôte qui concernent l'enregistrement et la photo. Rend
    // true si le message a été consommé, pour que la page n'ait pas à les connaître.
    function message(msg) {
      if (msg.type === 'enregistre') {
        if (minuteurEnr) { minuteurEnr.confirme(); }
        // Les marques ne sont retirées qu'après un enregistrement automatique : après un
        // enregistrement demandé, l'hôte renvoie les valeurs et la page se re-rend.
        if (msg.auto) { oublier(); }
        if (etat) { etat.textContent = TXT.enregistre.split('{0}').join(msg.n); }
        return true;
      }
      if (msg.type === 'erreur') {
        if (minuteurEnr) { minuteurEnr.confirme(); }
        if (etat) { etat.textContent = '⚠ ' + msg.message; }
        return true;
      }
      if (msg.type !== 'photo-versions' && msg.type !== 'photo-valeur' && msg.type !== 'photo-erreur') {
        return false;
      }
      if (!ctx || msg.slug !== ctx.slug || msg.index !== ctx.index) { return true; }
      if (msg.type === 'photo-versions') {
        ctx.occupe = false;
        ctx.base = msg.base || null;
        ctx.versions = msg.versions || {};
        var choix = msg.actuelle || 'sans-fond';
        if (!uriPour(choix)) { choix = VERSIONS.filter(uriPour)[0] || 'sans-fond'; }
        poserRadio(choix);
        majRadios();
        var notes = [];
        if (msg.infos && !msg.infos.visage) { notes.push(TXT.sansVisage); }
        else if (msg.infos && msg.infos.recadre) { notes.push(TXT.recadre); }
        poserNote(notes.join(' '));
        majApercu();
      } else if (msg.type === 'photo-valeur') {
        var rangee = ctx.rangee, carte = ctx.carte, slug = ctx.slug;
        rangee.dataset.photo = msg.photo || '';
        majBoutonPhoto(rangee);
        fermerModale();
        marquer(carte, slug);
      } else if (msg.type === 'photo-erreur') {
        ctx.occupe = false;
        poserNote(msg.message || '?', true);
        majApercu();
      }
      return true;
    }

    // Un fichier lâché à côté d'une zone de dépôt ne doit pas remplacer la page.
    document.addEventListener('dragover', function (e) { e.preventDefault(); });
    document.addEventListener('drop', function (e) { e.preventDefault(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && ctx) { fermerModale(); } });

    // Branche l'enregistrement : le bouton, le minuteur d'enregistrement automatique et
    // le message envoyé à l'hôte. La page rend la main au minuteur en appelant
    // `confirme()` à la réponse de l'hôte, qu'elle soit un succès ou une erreur.
    var minuteurEnr = null;
    function enregistrement(bouton) {
      function envoyer(auto) {
        if (modifies.size === 0) {
          if (!auto && etat) { etat.textContent = TXT.rien; }
          return;
        }
        api.postMessage({ type: 'enregistrer', auto: !!auto, articles: modifiees() });
      }
      minuteurEnr = SZH.autoEnregistrement({
        estModifie: function () { return modifies.size > 0; },
        enregistrer: envoyer
      });
      if (bouton) {
        bouton.addEventListener('click', function () { minuteurEnr.annuler(); envoyer(false); });
      }
      return minuteurEnr;
    }

    return {
      rendre: rendre,
      collecter: collecter,
      modifiees: modifiees,
      oublier: oublier,
      marquer: marquer,
      message: message,
      enregistrement: enregistrement,
      fermerModale: fermerModale,
      estModifie: function () { return modifies.size > 0; }
    };
  }

  SZH.icone = icone;
  SZH.cartesArticles = cartesArticles;
})();
