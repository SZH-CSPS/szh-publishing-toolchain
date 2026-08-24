// Formulaire des métadonnées du numéro, et les réglages de couverture. Fragment partagé
// par la page « Méta-données du numéro » (metadata-issue) et par la vue « Articles »
// (articles) : les deux montrent le même formulaire, construit par le même code, et
// enregistré par le même chemin. Un champ ajouté dans la table CHAMPS ci-dessous apparaît
// donc dans les deux endroits sans seconde modification.
//
//   SZH.formulaireNumero(opts)  construit le formulaire dans opts.conteneur et le pilote
//
// Le HTML des deux pages ne porte plus aucun champ : tout est bâti ici en DOM, ce qui est
// la seule façon d'avoir un seul exemplaire du formulaire. Les libellés arrivent de l'hôte
// dans opts.txt.libelles, indexés par leur clé i18n.
//
// Protocole avec l'hôte, celui des deux pages qui portent ce fragment :
//   webview -> hôte : enregistrer { auto, modifies } ;
//                     couverture-deposer { nomFichier, donneesBase64 }
//   hôte -> webview : valeurs { valeurs, couverture } ;
//                     enregistre ; erreur { message } ; couverture { nom, description, apercu }

(function () {
  'use strict';

  // ---- La table des champs ----
  //
  // C'est la seule description du formulaire. `cle` est la clé d'ausgabe.yaml, `libelle`
  // la clé i18n de son intitulé, `genre` la façon de le saisir. Ajouter une rangée ici
  // ajoute le champ aux deux endroits qui montrent ce formulaire.
  var CHAMPS = [
    { cle: 'title', genre: 'texte', libelle: 'meta.title' },
    { cle: 'revue', genre: 'radio', libelle: 'meta.revue',
      options: [
        { valeur: 'zeitschrift', libelle: 'meta.revue.zeitschrift' },
        { valeur: 'revue', libelle: 'meta.revue.revue' }
      ] },
    { cle: 'volume', genre: 'texte', libelle: 'meta.volume' },
    { cle: 'numero', genre: 'texte', libelle: 'meta.numero' },
    { cle: 'date', genre: 'date', libelle: 'meta.date' },
    { cle: 'lang', genre: 'select', libelle: 'meta.langue',
      options: [
        { valeur: '', libelle: 'meta.langue.aucune' },
        { valeur: 'fr', libelle: 'meta.langue.fr' },
        { valeur: 'de', libelle: 'meta.langue.de' },
        { valeur: 'en', libelle: 'meta.langue.en' },
        { valeur: 'it', libelle: 'meta.langue.it' }
      ] },
    { cle: 'couleur', genre: 'couleurs', libelle: 'meta.couleur' },
    { cle: 'entete-condensee', genre: 'case', libelle: 'meta.entete.condensee' }
  ];

  // Miroir de normaliserRevue() (lib/yaml.js) et de derive_revue() côté Lua : accepte le
  // jeton comme l'ancien nom complet, et teste « zeitschrift » avant « revue ».
  function normaliserRevue(v) {
    var s = String(v === undefined || v === null ? '' : v).toLowerCase();
    if (s.indexOf('zeitschrift') !== -1) { return 'zeitschrift'; }
    if (s.indexOf('revue') !== -1) { return 'revue'; }
    return '';
  }

  function formulaireNumero(opts) {
    var conteneur = opts.conteneur;
    var api = opts.api;
    var TXT = opts.txt || {};
    var L = TXT.libelles || {};
    var etat = opts.etat || null;
    var modifies = {};                 // cle -> true : seuls les champs touchés partent
    var ctl = {};                      // cle -> élément ou accessoire de saisie
    var couleurs = TXT.couleurs || [];
    var couleurChoisie = '';
    var revueChoisie = '';
    var indiceDate = null;
    var zoneCouverture = null;
    var apercuEnGrand = null;          // modale d'agrandissement, construite au besoin
    // Formats et poids acceptés : ce sont ceux de lib/articles.js, envoyés par l'hôte, et
    // non une seconde liste écrite ici. Ils sont revérifiés côté hôte de toute façon.
    var EXTENSIONS = TXT.couvertureExtensions || [];
    var MAXI = Number(TXT.couvertureMax) || 0;

    function lib(cle) { return L[cle] === undefined ? '' : L[cle]; }
    function toucher(cle) {
      modifies[cle] = true;
      if (etat) { etat.textContent = ''; }
    }
    function aDesModifs() {
      for (var c in modifies) { if (modifies[c]) { return true; } }
      return false;
    }

    // ---- Construction ----

    var poser = SZH.poser;

    function champTexte(champ, type) {
      var bloc = poser(conteneur, 'div', 'szh-champ');
      poser(bloc, 'label', null, lib(champ.libelle)).setAttribute('for', 'num-' + champ.cle);
      var i = document.createElement('input');
      i.type = type;
      i.id = 'num-' + champ.cle;
      i.setAttribute('id', 'num-' + champ.cle);
      i.dataset.cle = champ.cle;
      i.addEventListener('input', function () { toucher(champ.cle); });
      bloc.appendChild(i);
      ctl[champ.cle] = i;
      if (champ.cle === 'date') {
        // Une date que le champ n'a pas su afficher — « 2026 » seul — ne doit pas être
        // écrasée en silence : on dit ce que le fichier porte.
        indiceDate = poser(bloc, 'p', 'szh-notif szh-notif--attention szh-notif--discret');
        indiceDate.hidden = true;
      }
    }

    function champSelect(champ) {
      var bloc = poser(conteneur, 'div', 'szh-champ');
      poser(bloc, 'label', null, lib(champ.libelle)).setAttribute('for', 'num-' + champ.cle);
      var s = document.createElement('select');
      s.id = 'num-' + champ.cle;
      s.setAttribute('id', 'num-' + champ.cle);
      s.dataset.cle = champ.cle;
      for (var i = 0; i < champ.options.length; i++) {
        var o = document.createElement('option');
        o.value = champ.options[i].valeur;
        o.textContent = lib(champ.options[i].libelle);
        s.appendChild(o);
      }
      s.addEventListener('input', function () { toucher(champ.cle); });
      bloc.appendChild(s);
      ctl[champ.cle] = s;
    }

    // La revue est un choix fermé : c'est le jeton canonique zeitschrift ou revue qui est
    // écrit dans ausgabe.yaml, l'ISSN et la langue par défaut en étant dérivés.
    function champRadio(champ) {
      var bloc = poser(conteneur, 'div', 'szh-champ');
      var titre = poser(bloc, 'label', null, lib(champ.libelle));
      titre.setAttribute('id', 'num-' + champ.cle + '-label');
      var groupe = poser(bloc, 'div', 'radios');
      groupe.dataset.cle = champ.cle;
      groupe.setAttribute('role', 'radiogroup');
      groupe.setAttribute('aria-labelledby', 'num-' + champ.cle + '-label');
      var radios = [];
      for (var i = 0; i < champ.options.length; i++) {
        (function (option) {
          var l = poser(groupe, 'label', 'radio');
          var r = document.createElement('input');
          r.type = 'radio';
          r.name = 'num-' + champ.cle;
          r.value = option.valeur;
          r.addEventListener('change', function () {
            if (!r.checked) { return; }
            revueChoisie = r.value;
            toucher(champ.cle);
          });
          l.appendChild(r);
          poser(l, 'span', null, lib(option.libelle));
          radios.push(r);
        }(champ.options[i]));
      }
      ctl[champ.cle] = { radios: radios };
    }

    function champCase(champ) {
      var l = poser(conteneur, 'label', 'case');
      var c = document.createElement('input');
      c.type = 'checkbox';
      c.dataset.cle = champ.cle;
      c.addEventListener('change', function () { toucher(champ.cle); });
      l.appendChild(c);
      poser(l, 'span', null, lib(champ.libelle));
      ctl[champ.cle] = c;
    }

    // Couleur annuelle : une pastille par teinte, la puce montre la couleur elle-même. Un
    // bouton n'émet ni « input » ni « change » : l'enregistrement automatique est donc
    // relancé à la main, sans quoi la couleur n'attendrait que la perte de focus.
    function champCouleurs(champ) {
      var bloc = poser(conteneur, 'div', 'szh-champ');
      poser(bloc, 'label', null, lib(champ.libelle));
      var zone = poser(bloc, 'div', 'pastilles');
      zone.dataset.cle = champ.cle;
      ctl[champ.cle] = { zone: zone };
      rendreCouleurs();
    }

    function majPastilles() {
      var zone = (ctl.couleur || {}).zone;
      if (!zone) { return; }
      var boutons = zone.querySelectorAll('.pastille');
      for (var i = 0; i < boutons.length; i++) {
        boutons[i].setAttribute('aria-pressed',
          boutons[i].dataset.hex === couleurChoisie ? 'true' : 'false');
      }
    }

    function rendreCouleurs() {
      var zone = (ctl.couleur || {}).zone;
      if (!zone) { return; }
      zone.textContent = '';
      var items = [{ hex: '', nom: TXT.couleurAucune || '' }].concat(couleurs);
      for (var i = 0; i < items.length; i++) {
        (function (c) {
          var b = document.createElement('button');
          b.type = 'button';
          b.className = 'pastille';
          b.dataset.hex = c.hex;
          b.setAttribute('aria-pressed', 'false');
          if (c.hex) {
            var puce = document.createElement('span');
            puce.className = 'puce';
            puce.style.background = c.hex;
            b.appendChild(puce);
          }
          b.appendChild(document.createTextNode(c.nom));
          b.addEventListener('click', function () {
            couleurChoisie = c.hex;
            majPastilles();
            toucher('couleur');
            autoEnr.programmer();
          });
          zone.appendChild(b);
        }(items[i]));
      }
      majPastilles();
    }

    // ---- Couverture ----
    //
    // couverture.jpg à la racine du numéro : c'est ce fichier que l'export OJS cherche, et
    // aucune interface ne le nommait — tous les numéros partaient donc sans couverture. On
    // la dépose, on la voit, on la remplace, ici, à côté du reste du numéro.
    function blocCouverture() {
      var bloc = poser(conteneur, 'div', 'szh-champ couverture');
      poser(bloc, 'label', null, TXT.couverture || '');
      zoneCouverture = { visuel: poser(bloc, 'div', 'visuel'), etat: null, nom: poser(bloc, 'p', 'couverture-nom') };
      var depot = poser(bloc, 'div', 'depot');
      var titre = poser(depot, 'span', 'depot-titre');
      titre.appendChild(SZH.icone('camera'));
      poser(titre, 'span', null, TXT.couvertureDeposer || '');
      var fichier = document.createElement('input');
      fichier.type = 'file';
      fichier.accept = EXTENSIONS.map(function (e) { return '.' + e; }).join(',');
      fichier.hidden = true;
      var choisir = document.createElement('button');
      choisir.type = 'button';
      choisir.className = 'szh-bouton';
      choisir.textContent = TXT.couvertureChoisir || '';
      choisir.addEventListener('click', function () { fichier.click(); });
      depot.appendChild(choisir);
      depot.appendChild(fichier);
      fichier.addEventListener('change', function () {
        if (fichier.files && fichier.files[0]) { envoyerCouverture(fichier.files[0]); }
        fichier.value = '';
      });
      depot.addEventListener('dragover', function (e) { e.preventDefault(); depot.classList.add('survol'); });
      depot.addEventListener('dragleave', function () { depot.classList.remove('survol'); });
      depot.addEventListener('drop', function (e) {
        e.preventDefault();
        depot.classList.remove('survol');
        var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (f) { envoyerCouverture(f); }
      });
      zoneCouverture.etat = poser(depot, 'span', 'media-etat');
      poserCouverture(null);
    }

    // Le format et le poids sont refusés ici ET par l'hôte : la webview le dit tout de
    // suite, l'hôte ne fait jamais confiance à ce qu'elle lui envoie.
    function envoyerCouverture(f) {
      var ext = (String(f.name || '').match(/\.([A-Za-z0-9]+)$/) || ['', ''])[1].toLowerCase();
      if (EXTENSIONS.indexOf(ext) === -1) {
        zoneCouverture.etat.textContent = '⚠ ' + (TXT.couvertureFormat || '');
        return;
      }
      if (MAXI > 0 && f.size > MAXI) {
        zoneCouverture.etat.textContent = '⚠ ' + (TXT.couverturePoids || '');
        return;
      }
      zoneCouverture.etat.textContent = '…';
      var lecteur = new FileReader();
      lecteur.onerror = function () { zoneCouverture.etat.textContent = '⚠ ' + (TXT.couvertureFormat || ''); };
      lecteur.onload = function () {
        var t = String(lecteur.result || '');
        var virgule = t.indexOf(',');
        if (virgule === -1) { zoneCouverture.etat.textContent = '⚠ ' + (TXT.couvertureFormat || ''); return; }
        api.postMessage({ type: 'couverture-deposer', nomFichier: f.name, donneesBase64: t.slice(virgule + 1) });
      };
      lecteur.readAsDataURL(f);
    }

    // L'aperçu est un bouton : cliquer agrandit. Sans couverture, la place le dit — c'est
    // exactement l'information qui manquait.
    function poserCouverture(info) {
      if (!zoneCouverture) { return; }
      zoneCouverture.visuel.textContent = '';
      if (!info || !info.nom) {
        zoneCouverture.visuel.appendChild(SZH.notif('attention', TXT.couvertureAbsente || ''));
        zoneCouverture.nom.textContent = '';
        return;
      }
      zoneCouverture.nom.textContent = info.nom + (info.description ? ' — ' + info.description : '');
      if (!info.apercu) {
        poser(zoneCouverture.visuel, 'p', 'absent', TXT.couvertureApercuAbsent || '');
        return;
      }
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'apercu';
      b.title = TXT.couvertureAgrandir || '';
      b.setAttribute('aria-label', TXT.couvertureAgrandir || '');
      var img = document.createElement('img');
      img.src = info.apercu;
      img.alt = info.nom;
      b.appendChild(img);
      b.addEventListener('click', function () { agrandir(info.apercu, info.nom); });
      zoneCouverture.visuel.appendChild(b);
    }

    // L'aperçu de la carte est petit par nécessité : c'est là qu'on juge une image, et il
    // faut pouvoir la voir en grand sans quitter le formulaire. Le voile, Échap et le retour
    // du focus viennent de SZH.modale.
    function agrandir(apercu, nom) {
      if (!apercuEnGrand) {
        var vue = {};
        apercuEnGrand = SZH.modale({
          construire: function (boite) {
            vue.img = document.createElement('img');
            boite.appendChild(vue.img);
            var pied = poser(boite, 'div', 'szh-modale-pied');
            vue.nom = poser(pied, 'span', 'modale-nom');
            poser(pied, 'span', 'szh-pousse');
            vue.fermer = document.createElement('button');
            vue.fermer.type = 'button';
            vue.fermer.className = 'szh-bouton szh-bouton--principal';
            vue.fermer.textContent = TXT.couvertureFermer || '';
            vue.fermer.addEventListener('click', function () { apercuEnGrand.fermer(); });
            pied.appendChild(vue.fermer);
          },
          surFermeture: function () { vue.img.removeAttribute('src'); },
          focus: function () { return vue.fermer; }
        });
        apercuEnGrand.vue = vue;
      }
      apercuEnGrand.vue.img.src = apercu;
      apercuEnGrand.vue.img.alt = nom || '';
      apercuEnGrand.vue.nom.textContent = nom || '';
      apercuEnGrand.ouvrir();
    }

    // ---- Remplissage et collecte ----

    function remplir(valeurs) {
      var v = valeurs || {};
      for (var i = 0; i < CHAMPS.length; i++) {
        var champ = CHAMPS[i];
        var brut = v[champ.cle] === undefined ? '' : String(v[champ.cle]);
        if (champ.genre === 'radio') {
          revueChoisie = normaliserRevue(brut);
          var radios = (ctl[champ.cle] || {}).radios || [];
          for (var r = 0; r < radios.length; r++) { radios[r].checked = (radios[r].value === revueChoisie); }
          continue;
        }
        if (champ.genre === 'couleurs') {
          couleurChoisie = brut;
          majPastilles();
          continue;
        }
        if (champ.genre === 'case') {
          // La valeur arrive déjà tranchée en « true » ou « false » par estVraiYaml
          // (lib/yaml.js) : aucune règle de vérité n'est dupliquée ici.
          ctl[champ.cle].checked = (brut === 'true');
          continue;
        }
        var e = ctl[champ.cle];
        e.value = brut;
        if (champ.cle === 'date' && indiceDate) {
          if (brut !== '' && e.value !== brut) {
            indiceDate.textContent = (TXT.indiceDate || '').split('{0}').join(brut);
            indiceDate.hidden = false;
          } else { indiceDate.hidden = true; }
        }
        // Une langue hors liste n'est pas un choix du <select> : on n'affiche pas une
        // valeur qui n'est pas celle du fichier.
        if (champ.genre === 'select' && e.value !== brut) { e.value = ''; }
      }
      modifies = {};
      if (etat) { etat.textContent = ''; }
    }

    // Seuls les champs touchés partent : ausgabe.yaml garde tout le reste, commentaires
    // compris, et deux personnes qui éditent deux clés ne s'écrasent pas.
    function envoyer(auto) {
      if (!aDesModifs()) {
        if (!auto && etat) { etat.textContent = TXT.rien || ''; }
        return;
      }
      var envoi = {};
      for (var i = 0; i < CHAMPS.length; i++) {
        var champ = CHAMPS[i];
        if (!modifies[champ.cle]) { continue; }
        if (champ.genre === 'radio') { envoi[champ.cle] = revueChoisie; }
        else if (champ.genre === 'couleurs') { envoi[champ.cle] = couleurChoisie; }
        else if (champ.genre === 'case') { envoi[champ.cle] = ctl[champ.cle].checked ? 'true' : 'false'; }
        else { envoi[champ.cle] = ctl[champ.cle].value; }
      }
      api.postMessage({ type: 'enregistrer', auto: !!auto, modifies: envoi });
    }

    // Enregistrement automatique, comme partout ailleurs : trois secondes après la
    // dernière frappe, au changement d'un choix, et quand le panneau perd le focus.
    var autoEnr = SZH.autoEnregistrement({
      estModifie: aDesModifs,
      enregistrer: envoyer
    });

    // Les messages que ce fragment connaît ; rend vrai quand il les a traités, pour que la
    // page n'ait rien à réimplémenter.
    function message(msg) {
      if (msg.type === 'valeurs') {
        remplir(msg.valeurs);
        // La couverture n'est redessinée que si le message la porte : un re-rendu de la vue
        // ne la renvoie pas, son aperçu pesant plusieurs mégaoctets en base64.
        if (zoneCouverture && msg.couverture !== undefined) { poserCouverture(msg.couverture); }
        return true;
      }
      if (msg.type === 'enregistre') {
        autoEnr.confirme();
        modifies = {};
        if (etat) { etat.textContent = TXT.enregistre || ''; }
        return true;
      }
      if (msg.type === 'erreur') {
        autoEnr.confirme();
        if (etat) { etat.textContent = '⚠ ' + (msg.message || ''); }
        return true;
      }
      if (msg.type === 'couverture') {
        if (zoneCouverture) {
          zoneCouverture.etat.textContent = msg.nom ? (TXT.couvertureEnregistree || '') : '';
          poserCouverture(msg);
        }
        return true;
      }
      return false;
    }

    // Le bouton « Enregistrer » reste, pour qui veut voir « ✓ » tout de suite.
    function enregistrement(bouton) {
      if (!bouton) { return; }
      bouton.addEventListener('click', function (e) {
        if (e && e.preventDefault) { e.preventDefault(); }
        autoEnr.annuler();
        envoyer(false);
      });
    }

    // ---- Montage ----
    for (var i = 0; i < CHAMPS.length; i++) {
      var champ = CHAMPS[i];
      if (champ.genre === 'texte') { champTexte(champ, 'text'); }
      else if (champ.genre === 'date') { champTexte(champ, 'date'); }
      else if (champ.genre === 'select') { champSelect(champ); }
      else if (champ.genre === 'radio') { champRadio(champ); }
      else if (champ.genre === 'case') { champCase(champ); }
      else if (champ.genre === 'couleurs') { champCouleurs(champ); }
    }
    if (opts.couverture) { blocCouverture(); }

    return {
      remplir: remplir, message: message, enregistrement: enregistrement,
      estModifie: aDesModifs, champs: CHAMPS
    };
  }

  SZH.formulaireNumero = formulaireNumero;
})();
