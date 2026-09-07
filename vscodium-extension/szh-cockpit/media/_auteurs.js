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
//
// Autocomplétion, commune aux trois vues aussi :
//   hôte -> webview : auteurs-connus { auteurs: [{ prenom, nom, fonction, affiliation,
//                     ror, orcid, email }] } — les auteur·e·s déjà connus, moissonnés sur
//                     OJS (lib/auteurs-ojs.js) et relevés dans les numéros du poste
//                     (lib/auteurs-corpus.js). Sans liste reçue, rien ne s'affiche.
//
// À la frappe dans nom ou prénom (deux caractères et plus), la modale propose des
// suggestions filtrées sans tenir compte de la casse ni des accents, en deux groupes
// séparés d'un filet : d'abord les noms de famille qui commencent par la saisie, triés par
// nom, puis les prénoms, triés par prénom. C'est l'ordre dans lequel on cherche quelqu'un —
// par son nom de famille, presque toujours. La part trouvée est mise en gras.
//
// « Commence par » se juge au début de chaque mot, pas de la seule chaîne : sinon « wilde »
// ne trouverait pas « Wood de Wilde » et « arx » pas « von Arx », deux graphies courantes
// chez nos auteur·e·s.
//
// Choisir une suggestion écrase toujours nom et prénom, mais ne remplit les autres champs
// que s'ils sont vides : une correction déjà tapée n'est jamais effacée.

(function () {
  'use strict';

  // Le nom d'abord, à gauche : c'est par lui qu'on cherche et qu'on désigne quelqu'un.
  // `ror` prend une ligne entière — une URL n'entre pas dans une demi-largeur.
  var CHAMPS = [['nom', 'aNom'], ['prenom', 'aPrenom'], ['fonction', 'aFonction'],
    ['affiliation', 'aAffiliation'], ['ror', 'aRor'], ['orcid', 'aOrcid'], ['email', 'aEmail']];
  var CHAMPS_LARGES = ['ror'];
  // Les champs qu'une suggestion ne remplit que s'ils sont vides (règle du bandeau).
  var ENRICHIS = ['fonction', 'affiliation', 'ror', 'orcid', 'email'];
  // Les deux champs où l'on tape pour chercher.
  var CHAMPS_CHERCHES = ['nom', 'prenom'];
  var SUGG_MAX = 10;                 // au-delà, ce n'est plus un menu mais une liste
  var SUGG_MAX_NOMS = 7;             // pour que le second groupe se voie toujours
  var VERSIONS = [['sans-fond', 'vSansFond'], ['avec-fond', 'vAvecFond'], ['original', 'vOriginal']];
  // Plus de plafond littéral ici : SZH.LIMITES.photo (media/_commun.js), alimenté par
  // l'hôte (message « valeurs »/« charger », limites.photoMax/photoExtensions), lu au
  // moment du dépôt — jamais mis en cache, pour rester à jour si l'hôte change d'avis.

  function auteurs(opts) {
    var api = opts.api;
    var TXT = opts.txt || {};
    var persister = opts.persister || function (ctx, auteur, fini) { fini(null); };
    var surSaisie = opts.surSaisie || function () {};
    var surApercu = opts.surApercu || null;

    var modale = null;      // les champs et boutons, construits une fois, remplis à chaque ouverture
    var modaleCtl = null;   // le contrôleur SZH.modale (voile, clic à côté, Échap, retour du focus)
    var ctx = null;         // contexte en cours d'édition
    var attente = null;     // fonction qui reprend la sauvegarde après photo-valeur
    var connus = [];        // auteur·e·s publiés (message auteurs-connus), pour suggérer

    // Casse, accents, positions et séparateurs de mot : le même moteur que _fiches.js pour
    // les mots-clés edudoc.ch, partagé depuis _commun.js. Les deux divergences qui les
    // séparaient — plier() sans repli des espaces de bord, séparateur de mot sans virgule
    // ni point-virgule — sont tranchées vers le comportement le plus large (voir le
    // commentaire de SZH.plier) : sans effet ici, un nom ne portant ni l'un ni l'autre.
    var plier = SZH.plier;
    var plierAvecIndex = SZH.plierAvecIndex;
    var debutsDeMot = SZH.debutsDeMot;
    var chercherDebut = SZH.chercherDebut;

    function poserConnus(liste) {
      connus = [];
      for (var i = 0; i < (liste || []).length; i++) {
        var a = liste[i] || {};
        var prenom = String(a.prenom || '').replace(/\s+/g, ' ').trim();
        var nom = String(a.nom || '').replace(/\s+/g, ' ').trim();
        if (prenom === '' && nom === '') { continue; }
        var pNom = plierAvecIndex(nom);
        var pPrenom = plierAvecIndex(prenom);
        var e = {
          prenom: prenom, nom: nom,
          pNom: pNom, pPrenom: pPrenom,
          dNom: debutsDeMot(pNom.plie), dPrenom: debutsDeMot(pPrenom.plie)
        };
        // Les champs d'enrichissement voyagent tels quels : la modale n'en fait rien
        // d'autre que remplir du vide quand on choisit la suggestion.
        for (var k = 0; k < ENRICHIS.length; k++) {
          e[ENRICHIS[k]] = String(a[ENRICHIS[k]] || '').replace(/\s+/g, ' ').trim();
        }
        connus.push(e);
      }
    }

    // texte() est SZH.poser (_commun.js) : même geste créer/classer/remplir/insérer,
    // partagé avec documentation.js et medias-article.js.
    var texte = SZH.poser;
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
      var ligne2 = joindre([a.email, a.orcid, a.ror], ' · ');
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

    // La lecture et le découpage base64 viennent de SZH.lireBase64 (_commun.js), communs
    // aux cinq pages qui déposent un fichier.
    function deposerFichier(f) {
      if (!ctx || ctx.occupe) { return; }
      var prenom = modale.champs.prenom.value.trim();
      var nom = modale.champs.nom.value.trim();
      // Le nom d'abord : il nomme le fichier déposé, et l'hôte ne peut pas l'inventer.
      if (prenom === '' && nom === '') { poserNote(TXT.photoNomRequis, true); return; }
      var courant = ctx;
      SZH.lireBase64(f, {
        extensions: SZH.LIMITES.photo.extensions, maxi: SZH.LIMITES.photo.maxi,
        msgFormat: TXT.photoErrFormat, msgPoids: TXT.photoErrTropVolumineux,
        surErreur: function (message) { if (ctx === courant) { poserNote(message, true); } },
        surDonnees: function (fichier, base64) {
          if (ctx !== courant) { return; }          // modale refermée entre-temps
          occuper(true);
          poserNote(TXT.traitement);
          api.postMessage({
            type: SZH.MSG.PHOTO_DEPOSER, slug: ctx.slug, index: ctx.index,
            prenom: prenom, nom: nom, nomFichier: fichier.name, donneesBase64: base64
          });
        }
      });
    }

    // ---- Modale ----
    // Le voile, le clic à côté, Échap et le retour du focus sont ceux de SZH.modale
    // (_commun.js) — cette modale n'en construit plus sa propre copie.
    function construireModale() {
      modaleCtl = SZH.modale({
        classeBoite: 'modale modale-auteur',
        construire: construireCorpsModale,
        surOuverture: remplirModale,
        surFermeture: function () {
          modale.fermerSuggestions();
          ctx = null;                                // une réponse tardive sera ignorée
          attente = null;
        },
        focus: function () { return modale.champs.nom; }
      });
    }

    function construireCorpsModale(boite) {
      var titre = texte(boite, 'h3');

      var grille = texte(boite, 'div', 'auteur-grille');
      var champs = {};
      var blocs = {};
      for (var i = 0; i < CHAMPS.length; i++) {
        var cle = CHAMPS[i][0];
        var bloc = texte(grille, 'div', 'szh-champ' +
          (CHAMPS_LARGES.indexOf(cle) === -1 ? '' : ' szh-champ--large'));
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
        blocs[cle] = bloc;
      }

      // ---- Autocomplétion prénom/nom, depuis la liste des auteur·e·s publiés ----
      //
      // Une seule boîte de suggestions, rattachée au bloc du champ où l'on tape. Elle ne
      // remplit que prénom et nom — OAI-PMH n'expose rien d'autre — et ne s'affiche que si
      // l'hôte a envoyé une liste : sans elle, aucune UI parasite.
      var boiteSugg = document.createElement('div');
      boiteSugg.className = 'szh-sugg';
      boiteSugg.hidden = true;
      boiteSugg.setAttribute('role', 'listbox');
      boiteSugg.setAttribute('aria-label', TXT.auteurSuggestions || '');
      var suggEtat = { champ: null, items: [], actif: -1 };

      function fermerSuggestions() {
        boiteSugg.hidden = true;
        boiteSugg.textContent = '';
        boiteSugg.remove();
        suggEtat = { champ: null, items: [], actif: -1 };
      }
      function choisirSuggestion(a) {
        champs.nom.value = a.nom;
        champs.prenom.value = a.prenom;
        // Le reste ne remplit que du vide : on suggère une personne déjà publiée, mais elle
        // a pu changer de poste ou d'institution depuis, et ce que le rédacteur vient de
        // taper vaut mieux que ce que dit l'archive. Une correction n'est jamais effacée.
        for (var i = 0; i < ENRICHIS.length; i++) {
          var cle = ENRICHIS[i];
          if (champs[cle] && champs[cle].value.trim() === '' && a[cle]) {
            champs[cle].value = a[cle];
          }
        }
        fermerSuggestions();
        // Une sélection est une saisie : la page doit savoir qu'elle porte du non-enregistré.
        if (ctx && !ctx.saisi) { ctx.saisi = true; surSaisie(ctx.fiche); }
      }
      function poserActifSuggestion(n) {
        var total = suggEtat.items.length;
        if (total === 0) { return; }
        var idx = ((n % total) + total) % total;   // les flèches bouclent aux extrémités
        for (var k = 0; k < total; k++) {
          suggEtat.items[k].element.classList.toggle('actif', k === idx);
          suggEtat.items[k].element.setAttribute('aria-selected', k === idx ? 'true' : 'false');
        }
        suggEtat.actif = idx;
      }
      // Partagée avec _fiches.js depuis _commun.js.
      var poserAvecGras = SZH.poserAvecGras;

      // Une saisie de plusieurs mots — « robin mor » — cherche à travers le prénom ET le
      // nom : chaque mot doit commencer un mot de l'un ou de l'autre. Elle ne se range dans
      // aucun des deux groupes, qui n'ont plus de sens là ; elle rend une liste unique.
      function chercherMots(a, mots) {
        var zNom = [];
        var zPrenom = [];
        for (var i = 0; i < mots.length; i++) {
          var d = chercherDebut(a.pNom, a.dNom, mots[i]);
          if (d !== -1) { zNom.push([d, mots[i].length]); continue; }
          d = chercherDebut(a.pPrenom, a.dPrenom, mots[i]);
          if (d === -1) { return null; }           // un mot sans place : ce n'est pas la bonne personne
          zPrenom.push([d, mots[i].length]);
        }
        var ordre = function (x, y) { return x[0] - y[0]; };
        return { auteur: a, zNom: zNom.sort(ordre), zPrenom: zPrenom.sort(ordre) };
      }

      // Les deux groupes, dans l'ordre où on les lit — ou un seul, pour une saisie de
      // plusieurs mots.
      function trierTrouves(saisie) {
        var noms = [];
        var prenoms = [];
        var mots = saisie.split(' ').filter(function (m) { return m !== ''; });
        if (mots.length > 1) {
          for (var j = 0; j < connus.length; j++) {
            var t = chercherMots(connus[j], mots);
            if (t) { noms.push(t); }
          }
          noms.sort(function (x, y) {
            var c = plier(x.auteur.nom).localeCompare(plier(y.auteur.nom));
            return c !== 0 ? c : plier(x.auteur.prenom).localeCompare(plier(y.auteur.prenom));
          });
          return { noms: noms.slice(0, SUGG_MAX), prenoms: [] };
        }
        for (var k = 0; k < connus.length; k++) {
          var a = connus[k];
          var d = chercherDebut(a.pNom, a.dNom, saisie);
          if (d !== -1) {
            noms.push({ auteur: a, zNom: [[d, saisie.length]], zPrenom: [] });
            continue;
          }
          d = chercherDebut(a.pPrenom, a.dPrenom, saisie);
          if (d !== -1) { prenoms.push({ auteur: a, zNom: [], zPrenom: [[d, saisie.length]] }); }
        }
        var par = function (premier, second) {
          return function (x, y) {
            var c = plier(x.auteur[premier]).localeCompare(plier(y.auteur[premier]));
            return c !== 0 ? c : plier(x.auteur[second]).localeCompare(plier(y.auteur[second]));
          };
        };
        noms.sort(par('nom', 'prenom'));
        prenoms.sort(par('prenom', 'nom'));
        // Les noms de famille passent devant, mais on leur laisse une borne quand un second
        // groupe existe : sinon un préfixe courant remplirait la liste et le filet — donc
        // la recherche par prénom — ne se verrait jamais.
        var plafondNoms = prenoms.length > 0 ? SUGG_MAX_NOMS : SUGG_MAX;
        noms = noms.slice(0, plafondNoms);
        return { noms: noms, prenoms: prenoms.slice(0, SUGG_MAX - noms.length) };
      }

      function majSuggestions(champ, cle) {
        var saisie = plier(champ.value).trim();
        if (!ctx || connus.length === 0 || saisie.length < 2) { fermerSuggestions(); return; }
        var groupes = trierTrouves(saisie);
        if (groupes.noms.length === 0 && groupes.prenoms.length === 0) { fermerSuggestions(); return; }
        fermerSuggestions();
        suggEtat = { champ: champ, items: [], actif: -1 };
        var poser = function (t) {
          var a = t.auteur;
          var b = document.createElement('button');
          b.type = 'button';
          b.className = 'szh-sugg-item';
          b.setAttribute('role', 'option');
          b.setAttribute('aria-selected', 'false');
          // Toujours « Prénom Nom » à l'affichage, quel que soit le groupe : c'est ainsi
          // qu'on lit un nom, et la mise en gras dit déjà sur quoi la trouvaille a porté.
          poserAvecGras(b, a.pPrenom, t.zPrenom);
          if (a.prenom !== '' && a.nom !== '') { b.appendChild(document.createTextNode(' ')); }
          poserAvecGras(b, a.pNom, t.zNom);
          // mousedown neutralisé : le clic ne doit pas d'abord voler le focus du champ.
          b.addEventListener('mousedown', function (e) { e.preventDefault(); });
          b.addEventListener('click', function () { choisirSuggestion(a); });
          boiteSugg.appendChild(b);
          suggEtat.items.push({ element: b, auteur: a });
        };
        for (var m = 0; m < groupes.noms.length; m++) { poser(groupes.noms[m]); }
        // Le filet ne sépare que deux groupes réellement présents, et n'entre jamais dans
        // les items : les flèches ne doivent pas s'y arrêter.
        if (groupes.noms.length > 0 && groupes.prenoms.length > 0) {
          var filet = texte(boiteSugg, 'div', 'szh-sugg-filet');
          filet.setAttribute('role', 'presentation');
        }
        for (var p = 0; p < groupes.prenoms.length; p++) { poser(groupes.prenoms[p]); }
        blocs[cle].appendChild(boiteSugg);
        boiteSugg.hidden = false;
      }
      function clavierSuggestions(e, champ) {
        if (boiteSugg.hidden || suggEtat.champ !== champ) { return; }
        if (e.key === 'ArrowDown') { e.preventDefault(); poserActifSuggestion(suggEtat.actif + 1); return; }
        if (e.key === 'ArrowUp') { e.preventDefault(); poserActifSuggestion(suggEtat.actif - 1); return; }
        if (e.key === 'Enter') {
          if (suggEtat.actif >= 0 && suggEtat.items[suggEtat.actif]) {
            e.preventDefault();
            choisirSuggestion(suggEtat.items[suggEtat.actif].auteur);
          }
          return;
        }
        if (e.key === 'Escape') {
          // Seule la liste se ferme — la propagation est coupée, sinon le gestionnaire de
          // la page fermerait la modale entière du même geste.
          e.preventDefault();
          if (e.stopPropagation) { e.stopPropagation(); }
          fermerSuggestions();
        }
      }
      for (var s = 0; s < CHAMPS_CHERCHES.length; s++) {
        (function (cleSugg) {
          var champSugg = champs[cleSugg];
          champSugg.addEventListener('input', function () { majSuggestions(champSugg, cleSugg); });
          champSugg.addEventListener('keydown', function (e) { clavierSuggestions(e, champSugg); });
          champSugg.addEventListener('blur', function () { fermerSuggestions(); });
        })(CHAMPS_CHERCHES[s]);
      }

      texte(boite, 'p', 'szh-section', TXT.auteurPhoto || '');
      var zone = texte(boite, 'div', 'szh-depot');
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

      modale = {
        titre: titre, champs: champs, zone: zone, radios: radios,
        cadre: cadre, img: img, note: note, enregistrer: enregistrer,
        fermerSuggestions: fermerSuggestions
      };
    }

    // Remplit la modale pour l'auteur·e visé : appelé par SZH.modale à chaque ouverture,
    // une fois le corps construit (la première fois) ou non (les suivantes).
    function remplirModale() {
      var a = (ctx.fiche.auteur) || {};
      for (var i = 0; i < CHAMPS.length; i++) {
        modale.champs[CHAMPS[i][0]].value = String(a[CHAMPS[i][0]] || '');
      }
      modale.titre.textContent = (TXT.auteurTitre || '{0}')
        .split('{0}').join(nomComplet(a) || (TXT.auteurSansNom || ''));
      poserVersion('sans-fond');
      majVersions();
      majApercuPhoto();
      poserNote('');
      modale.fermerSuggestions();                  // pas de liste héritée de l'édition d'avant
      occuper(false);
    }

    function ouvrir(contexte) {
      ctx = {
        slug: contexte.slug, index: contexte.index, fiche: contexte,
        base: null, versions: null, occupe: false
      };
      if (!modaleCtl) { construireModale(); }
      modaleCtl.ouvrir();
      // La photo déjà retenue : l'hôte dit quelles versions existent, et laquelle sert.
      var a = contexte.auteur || {};
      if (String(a.photo || '') !== '') {
        poserNote(TXT.chargement);
        api.postMessage({ type: SZH.MSG.PHOTO_OUVRIR, slug: ctx.slug, index: ctx.index, photo: a.photo });
      }
    }

    function fermer() {
      if (!modaleCtl) { return; }
      modaleCtl.fermer();
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
          type: SZH.MSG.PHOTO_CHOISIR, slug: ctx.slug, index: ctx.index,
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
      // La liste des auteur·e·s publiés : gardée pour l'autocomplétion, même reçue avant
      // la construction de la modale ou pendant une édition.
      if (msg.type === SZH.MSG.AUTEURS_CONNUS) {
        poserConnus(msg.auteurs);
        return true;
      }
      if (msg.type !== SZH.MSG.PHOTO_VERSIONS && msg.type !== SZH.MSG.PHOTO_VALEUR && msg.type !== SZH.MSG.PHOTO_ERREUR) {
        return false;
      }
      if (!ctx || msg.slug !== ctx.slug || msg.index !== ctx.index) { return true; }
      if (msg.type === SZH.MSG.PHOTO_VERSIONS) {
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
      if (msg.type === SZH.MSG.PHOTO_VALEUR) {
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

    // Échap ferme désormais par SZH.modale, qui écoute tant que le voile est visible.

    return { apercu: apercu, ouvrir: ouvrir, message: message, fermer: fermer };
  }

  SZH.auteurs = auteurs;
})();
