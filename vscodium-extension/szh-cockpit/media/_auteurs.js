// Auteur·e·s : la fiche affichée et la modale qui l'édite, partagées par « Métadonnées des
// articles », « Vérification de l'import » et « Gérer les médias ».
//
//   SZH.auteurs(opts)  ->  { apercu(parent, ctx), ouvrir(ctx), message(msg) }
//
// Un seul endroit décrit un·e auteur·e, et un seul endroit l'édite. Les trois vues
// n'apportent que le contexte (quel article, quel rang) et l'endroit où le résultat est
// écrit — le formulaire de métadonnées le garde dans sa carte jusqu'à son enregistrement,
// le gestionnaire des médias l'envoie tout de suite à l'hôte. Sans ce partage, la moindre
// retouche demandait deux corrections, dans deux fichiers, avec deux occasions d'oublier.
//
// opts = {
//   api          l'objet d'acquireVsCodeApi, pour la partie photo
//   txt          les libellés de l'hôte
//   persister    persister(ctx, auteur, fini) : écrit, puis appelle fini(message ou null)
//   surSaisie    surSaisie(ctx) : la première frappe dans la modale, pour que la page
//                sache qu'elle porte du non-enregistré
//   surApercu    surApercu(uri, nom) : agrandir la photo, là où la vue sait le faire
// }
//
// ctx = { slug, index, auteur, apercu, element, surRetirer } — `apercu` est la vignette en
// data: URI que l'hôte a jointe, `element` la fiche affichée, à refaire après une édition,
// `surRetirer` n'est fourni que là où retirer un·e auteur·e a un sens.
//
// Protocole photo, inchangé et commun aux trois vues :
//   webview -> hôte : photo-ouvrir { slug, index, photo } ;
//                     photo-deposer { slug, index, prenom, nom, nomFichier, donneesBase64 } ;
//                     photo-choisir { slug, index, base, version }
//   hôte -> webview : photo-versions { slug, index, base, versions, actuelle, infos } ;
//                     photo-valeur { slug, index, photo } ; photo-erreur { slug, index, message }

(function () {
  'use strict';

  var CHAMPS = [['prenom', 'aPrenom'], ['nom', 'aNom'], ['fonction', 'aFonction'],
    ['affiliation', 'aAffiliation'], ['orcid', 'aOrcid'], ['email', 'aEmail']];
  var VERSIONS = [['sans-fond', 'vSansFond'], ['avec-fond', 'vAvecFond'], ['original', 'vOriginal']];
  var TAILLE_MAX_PHOTO = 20 * 1024 * 1024;
  var EXTENSIONS_PHOTO = ['png', 'jpg', 'jpeg', 'webp'];

  function auteurs(opts) {
    var api = opts.api;
    var TXT = opts.txt || {};
    var persister = opts.persister || function (ctx, auteur, fini) { fini(null); };
    var surSaisie = opts.surSaisie || function () {};
    var surApercu = opts.surApercu || null;

    var modale = null;      // construite une fois, remplie à chaque ouverture
    var ctx = null;         // contexte en cours d'édition
    var attente = null;     // fonction qui reprend la sauvegarde après photo-valeur

    function texte(parent, balise, cls, contenu) {
      var e = document.createElement(balise);
      if (cls) { e.className = cls; }
      if (contenu !== undefined && contenu !== null) { e.textContent = contenu; }
      parent.appendChild(e);
      return e;
    }
    function nomComplet(a) {
      return ((a && a.prenom ? String(a.prenom) : '') + ' ' +
        (a && a.nom ? String(a.nom) : '')).trim();
    }
    // Les lignes vides ne s'affichent pas : une fiche à moitié remplie ne doit pas laisser
    // des séparateurs orphelins.
    function joindre(morceaux, separateur) {
      var utiles = [];
      for (var i = 0; i < morceaux.length; i++) {
        var m = String(morceaux[i] === undefined || morceaux[i] === null ? '' : morceaux[i]).trim();
        if (m !== '') { utiles.push(m); }
      }
      return utiles.join(separateur);
    }

    // ---- Fiche affichée ----
    //
    // Statique : rien à saisir ici. Une carte d'article portait six champs par auteur·e,
    // soit trente-six cases pour six personnes, où l'on ne lisait plus rien.
    function apercu(parent, contexte) {
      var d = texte(parent, 'div', 'auteur-fiche');
      contexte.element = d;
      var portrait = texte(d, 'div', 'auteur-portrait');
      var chemin = String((contexte.auteur || {}).photo || '');
      if (contexte.apercu) {
        var img = document.createElement('img');
        img.src = contexte.apercu;
        img.alt = nomComplet(contexte.auteur) || (TXT.auteurSansNom || '');
        // Agrandir, là où la vue sait le faire : c'est le panneau des médias qui juge une
        // image, et une pastille de trois rem n'y suffit pas.
        if (surApercu) {
          var loupe = document.createElement('button');
          loupe.type = 'button';
          loupe.className = 'auteur-loupe';
          loupe.title = TXT.auteurAgrandir || '';
          loupe.setAttribute('aria-label', TXT.auteurAgrandir || '');
          loupe.appendChild(img);
          loupe.addEventListener('click', function () {
            surApercu(contexte.apercu, chemin || nomComplet(contexte.auteur));
          });
          portrait.appendChild(loupe);
        } else {
          portrait.appendChild(img);
        }
      } else {
        portrait.appendChild(SZH.icone('camera'));
        portrait.classList.add(chemin === '' ? 'sans-photo' : 'photo-cachee');
        portrait.title = chemin === ''
          ? (TXT.auteurSansPhoto || '')
          : (TXT.auteurPhotoCachee || '').split('{0}').join(chemin);
      }
      var corps = texte(d, 'div', 'auteur-corps');
      texte(corps, 'p', 'auteur-nom', nomComplet(contexte.auteur) || (TXT.auteurSansNom || ''));
      var a = contexte.auteur || {};
      var ligne1 = joindre([a.fonction, a.affiliation], ' · ');
      var ligne2 = joindre([a.email, a.orcid], ' · ');
      if (ligne1 !== '') { texte(corps, 'p', 'auteur-detail', ligne1); }
      if (ligne2 !== '') { texte(corps, 'p', 'auteur-detail', ligne2); }
      var boutons = texte(d, 'div', 'auteur-boutons');
      var editer = document.createElement('button');
      editer.type = 'button';
      editer.className = 'szh-bouton';
      editer.textContent = TXT.auteurEditer || '';
      editer.addEventListener('click', function () { ouvrir(contexte); });
      boutons.appendChild(editer);
      contexte.boutonEditer = editer;               // là où le focus revient après l'édition
      if (contexte.surRetirer) {
        var retirer = document.createElement('button');
        retirer.type = 'button';
        retirer.className = 'szh-ico szh-ico--danger';
        retirer.title = TXT.retirerAuteur || '';
        retirer.setAttribute('aria-label', TXT.retirerAuteur || '');
        retirer.appendChild(SZH.icone('poubelle'));
        retirer.addEventListener('click', function () { contexte.surRetirer(contexte); });
        boutons.appendChild(retirer);
      }
      return d;
    }

    // ---- Photo, dans la modale ----
    function uriPour(version) {
      if (!ctx || !ctx.versions) { return null; }
      if (version === 'original') { return ctx.versions.original || null; }
      if (version === 'avec-fond') { return ctx.versions.avecFond || null; }
      if (version === 'sans-fond') { return ctx.versions.sansFond || null; }
      return null;
    }
    function versionChoisie() {
      var r = modale.radios.querySelector('input:checked');
      return r ? r.value : 'sans-fond';
    }
    function poserVersion(version) {
      var rs = modale.radios.querySelectorAll('input');
      for (var i = 0; i < rs.length; i++) { rs[i].checked = (rs[i].value === version); }
    }
    function majVersions() {
      var rs = modale.radios.querySelectorAll('input');
      var aucune = true;
      for (var i = 0; i < rs.length; i++) {
        var dispo = !!(ctx && uriPour(rs[i].value));
        rs[i].disabled = !dispo;
        if (dispo) { aucune = false; }
      }
      // Aucune version sur le disque : ni choix ni cadre d'aperçu, qui ne montreraient
      // qu'un damier vide et trois boutons éteints.
      modale.radios.hidden = aucune;
      modale.cadre.hidden = aucune;
    }
    function majApercuPhoto() {
      var uri = uriPour(versionChoisie());
      if (uri) { modale.img.src = uri; modale.img.hidden = false; }
      else { modale.img.removeAttribute('src'); modale.img.hidden = true; }
    }
    function poserNote(message, estErreur) {
      modale.note.textContent = message || '';
      modale.note.classList.toggle('erreur', !!estErreur);
    }
    function occuper(occupe) {
      if (!modale) { return; }
      modale.enregistrer.disabled = occupe;
      modale.zone.classList.toggle('occupe', occupe);
      if (ctx) { ctx.occupe = occupe; }
    }

    function deposerFichier(f) {
      if (!ctx || ctx.occupe) { return; }
      var ext = (String(f.name || '').match(/\.([A-Za-z0-9]+)$/) || ['', ''])[1].toLowerCase();
      if (EXTENSIONS_PHOTO.indexOf(ext) === -1) { poserNote(TXT.photoErrFormat, true); return; }
      if (f.size > TAILLE_MAX_PHOTO) { poserNote(TXT.photoErrTropVolumineux, true); return; }
      var prenom = modale.champs.prenom.value.trim();
      var nom = modale.champs.nom.value.trim();
      // Le nom d'abord : il nomme le fichier déposé, et l'hôte ne peut pas l'inventer.
      if (prenom === '' && nom === '') { poserNote(TXT.photoNomRequis, true); return; }
      var lecteur = new FileReader();
      var courant = ctx;
      lecteur.onload = function () {
        if (ctx !== courant) { return; }            // modale refermée entre-temps
        var t = String(lecteur.result || '');
        var virgule = t.indexOf(',');
        if (virgule === -1) { poserNote(TXT.photoErrFormat, true); return; }
        occuper(true);
        poserNote(TXT.traitement);
        api.postMessage({
          type: 'photo-deposer', slug: ctx.slug, index: ctx.index,
          prenom: prenom, nom: nom, nomFichier: f.name, donneesBase64: t.slice(virgule + 1)
        });
      };
      lecteur.readAsDataURL(f);
    }

    // ---- Modale ----
    function construireModale() {
      var voile = texte(document.body, 'div', 'voile-auteur');
      voile.hidden = true;
      var boite = texte(voile, 'div', 'modale modale-auteur');
      var titre = texte(boite, 'h3');

      var grille = texte(boite, 'div', 'auteur-grille');
      var champs = {};
      for (var i = 0; i < CHAMPS.length; i++) {
        var cle = CHAMPS[i][0];
        var bloc = texte(grille, 'div', 'szh-champ');
        var l = texte(bloc, 'label', null, TXT[CHAMPS[i][1]] || cle);
        l.setAttribute('for', 'auteur-' + cle);
        var champ = document.createElement('input');
        champ.type = 'text';
        champ.id = 'auteur-' + cle;
        champ.maxLength = cle === 'email' ? 200 : 300;
        champ.addEventListener('input', function () {
          if (ctx && !ctx.saisi) { ctx.saisi = true; surSaisie(ctx.fiche); }
        });
        bloc.appendChild(champ);
        champs[cle] = champ;
      }

      texte(boite, 'p', 'szh-section', TXT.auteurPhoto || '');
      var zone = texte(boite, 'div', 'zone-depot');
      texte(zone, 'div', null, TXT.photoDeposer || '');
      texte(zone, 'div', 'ou', TXT.photoOu || '');
      var choisir = document.createElement('button');
      choisir.type = 'button';
      choisir.className = 'szh-bouton';
      choisir.textContent = TXT.photoChoisirFichier || '';
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

      var radios = texte(boite, 'div', 'radios');
      for (var k = 0; k < VERSIONS.length; k++) {
        var lv = texte(radios, 'label');
        var r = document.createElement('input');
        r.type = 'radio';
        r.name = 'version-photo';
        r.value = VERSIONS[k][0];
        r.addEventListener('change', majApercuPhoto);
        lv.appendChild(r);
        lv.appendChild(document.createTextNode(' ' + (TXT[VERSIONS[k][1]] || VERSIONS[k][0])));
      }
      var cadre = texte(boite, 'div', 'apercu-photo');
      cadre.hidden = true;
      var img = document.createElement('img');
      img.hidden = true;
      img.alt = '';
      cadre.appendChild(img);
      var note = texte(boite, 'p', 'note-modale');

      var boutons = texte(boite, 'div', 'boutons-modale');
      var enregistrer = document.createElement('button');
      enregistrer.type = 'button';
      enregistrer.className = 'szh-bouton szh-bouton--principal';
      enregistrer.textContent = TXT.enregistrerBouton || '';
      enregistrer.addEventListener('click', valider);
      var annuler = document.createElement('button');
      annuler.type = 'button';
      annuler.className = 'szh-bouton';
      annuler.textContent = TXT.annuler || '';
      annuler.addEventListener('click', fermer);
      boutons.appendChild(enregistrer);
      boutons.appendChild(annuler);

      voile.addEventListener('click', function (e) { if (e.target === voile) { fermer(); } });
      modale = {
        voile: voile, titre: titre, champs: champs, zone: zone, radios: radios,
        cadre: cadre, img: img, note: note, enregistrer: enregistrer, retour: null
      };
    }

    function ouvrir(contexte) {
      if (!modale) { construireModale(); }
      modale.retour = document.activeElement || null;
      ctx = {
        slug: contexte.slug, index: contexte.index, fiche: contexte,
        base: null, versions: null, occupe: false
      };
      var a = contexte.auteur || {};
      for (var i = 0; i < CHAMPS.length; i++) {
        modale.champs[CHAMPS[i][0]].value = String(a[CHAMPS[i][0]] || '');
      }
      modale.titre.textContent = (TXT.auteurTitre || '{0}')
        .split('{0}').join(nomComplet(a) || (TXT.auteurSansNom || ''));
      poserVersion('sans-fond');
      majVersions();
      majApercuPhoto();
      poserNote('');
      occuper(false);
      modale.voile.hidden = false;
      // La photo déjà retenue : l'hôte dit quelles versions existent, et laquelle sert.
      if (String(a.photo || '') !== '') {
        poserNote(TXT.chargement);
        api.postMessage({ type: 'photo-ouvrir', slug: ctx.slug, index: ctx.index, photo: a.photo });
      }
      try { modale.champs.prenom.focus(); } catch (e) { /* pas focalisable */ }
    }

    function fermer() {
      if (!modale) { return; }
      modale.voile.hidden = true;
      ctx = null;                                  // une réponse tardive sera ignorée
      attente = null;
      // Le bouton mémorisé peut avoir été détaché par le re-rendu que la page vient de
      // faire : lui redonner le focus ne ferait rien, et le focus tomberait sur <body>. La
      // page focalise alors elle-même la fiche refaite.
      var retour = modale.retour;
      modale.retour = null;
      if (retour && retour.isConnected !== false) {
        try { retour.focus(); } catch (e) { /* élément disparu */ }
      }
    }

    // Lit les champs, arrête la version de photo à retenir, puis laisse la page écrire.
    function valider() {
      if (!ctx || ctx.occupe) { return; }
      var auteur = {};
      for (var i = 0; i < CHAMPS.length; i++) {
        auteur[CHAMPS[i][0]] = modale.champs[CHAMPS[i][0]].value.replace(/[\r\n]+/g, ' ').trim();
      }
      if (auteur.prenom === '' && auteur.nom === '') { poserNote(TXT.auteurNomRequis, true); return; }
      auteur.photo = String((ctx.fiche.auteur || {}).photo || '');
      // Une base connue veut dire qu'une photo est sur le disque : le chemin de la version
      // choisie est demandé à l'hôte, qui le vérifie, avant d'écrire la fiche.
      if (ctx.base && uriPour(versionChoisie())) {
        ctx.fiche.apercu = uriPour(versionChoisie());
        occuper(true);
        attente = function (chemin) {
          auteur.photo = chemin;
          ecrire(auteur);
        };
        api.postMessage({
          type: 'photo-choisir', slug: ctx.slug, index: ctx.index,
          base: ctx.base, version: versionChoisie()
        });
        return;
      }
      ecrire(auteur);
    }

    function ecrire(auteur) {
      var courant = ctx;
      occuper(true);
      persister(courant.fiche, auteur, function (message) {
        if (ctx !== courant) { return; }            // modale refermée entre-temps
        occuper(false);
        if (message) { poserNote(message, true); return; }
        fermer();
      });
    }

    // ---- Réponses de l'hôte ----
    function message(msg) {
      if (msg.type !== 'photo-versions' && msg.type !== 'photo-valeur' && msg.type !== 'photo-erreur') {
        return false;
      }
      if (!ctx || msg.slug !== ctx.slug || msg.index !== ctx.index) { return true; }
      if (msg.type === 'photo-versions') {
        occuper(false);
        ctx.base = msg.base || null;
        ctx.versions = msg.versions || {};
        var choix = msg.actuelle || 'sans-fond';
        if (!uriPour(choix)) {
          choix = ['sans-fond', 'avec-fond', 'original'].filter(uriPour)[0] || 'sans-fond';
        }
        poserVersion(choix);
        majVersions();
        majApercuPhoto();
        var notes = [];
        if (msg.infos && !msg.infos.visage) { notes.push(TXT.sansVisage); }
        else if (msg.infos && msg.infos.recadre) { notes.push(TXT.recadre); }
        poserNote(notes.join(' '));
        return true;
      }
      if (msg.type === 'photo-valeur') {
        var suite = attente;
        attente = null;
        if (suite) { suite(String(msg.photo || '')); }
        return true;
      }
      occuper(false);
      attente = null;
      poserNote(msg.message || '?', true);
      return true;
    }

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && ctx) { fermer(); }
    });

    return { apercu: apercu, ouvrir: ouvrir, message: message, fermer: fermer };
  }

  SZH.auteurs = auteurs;
})();
