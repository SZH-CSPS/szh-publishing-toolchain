// Webview « Vérification de l'import », adaptée du formulaire « Métadonnées des
// articles » : même gabarit de carte et même modale photo, plus un badge d'état par
// champ, le compte des champs vides en tête de carte et une section « Originaux des
// images » où un dépôt fait remplacer l'image par l'hôte, à nom conservé.
(function () {
  'use strict';
  const TXT = __TXT__;
  const vscodeApi = acquireVsCodeApi();
  const etat = document.getElementById('etat');
  const conteneur = document.getElementById('cartes');
  const modifies = new Set();
  const motsClesParCarte = new WeakMap();
  let TYPES = [];
  let LANGUE_DEFAUT = 'fr';   // langue par défaut du numéro, dérivée de la revue
  const TAILLE_MAX_PHOTO = 20 * 1024 * 1024;
  const EXTENSIONS_PHOTO = ['png', 'jpg', 'jpeg', 'webp'];
  const TAILLE_MAX_IMAGE = 50 * 1024 * 1024;
  const EXTENSIONS_IMAGE = ['png', 'jpg', 'jpeg', 'gif', 'svg'];
  function marquer(carte, slug) {
    modifies.add(slug);
    carte.classList.add('modifie');
    etat.textContent = '';
    majBadges(carte);
  }

  // Identifiants des champs vides d'une carte, d'après ses valeurs et l'état de la case
  // « + Italien ». Fonction pure, sans DOM.
  function listeChampsVides(valeurs, avecIt) {
    const v = valeurs || {};
    const langues = avecIt ? ['fr', 'de', 'it'] : ['fr', 'de'];
    const plein = function (s) { return String(s === undefined || s === null ? '' : s).trim() !== ''; };
    const vides = [];
    if (!plein(v.type)) { vides.push('type'); }
    for (const cle of ['title', 'subtitle', 'resume']) {
      for (const lg of langues) {
        if (!plein((v[cle] || {})[lg])) { vides.push(cle + '.' + lg); }
      }
    }
    if (!plein(v.doi)) { vides.push('doi'); }
    for (const lg of langues) {
      const liste = (v.keywords || {})[lg];
      if (!Array.isArray(liste) || !liste.some(plein)) { vides.push('keywords.' + lg); }
    }
    const auteurs = Array.isArray(v.author) ? v.author : [];
    const champs = ['prenom', 'nom', 'fonction', 'affiliation', 'orcid', 'email'];
    const unAuteur = auteurs.some(function (a) {
      return a && champs.some(function (c) { return plein(a[c]); });
    });
    if (!unAuteur) { vides.push('auteurs'); }
    return vides;
  }

  function creerBadge(champId) {
    const b = document.createElement('span');
    b.className = 'badge';
    b.dataset.champ = champId;
    return b;
  }

  function majBadges(carte) {
    const vides = new Set(listeChampsVides(collecter(carte), carte.classList.contains('avec-it')));
    for (const b of carte.querySelectorAll('.badge')) {
      const vide = vides.has(b.dataset.champ);
      b.textContent = vide ? TXT.badgeAcompleter : TXT.badgeDetecte;
      b.classList.toggle('vide', vide);
    }
    const compteur = carte.querySelector('.compteur');
    if (compteur) {
      compteur.textContent = vides.size > 0 ? TXT.vides.split('{0}').join(vides.size) : TXT.videsZero;
      compteur.classList.toggle('vide', vides.size > 0);
    }
  }

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const CHEMIN_POUBELLE = 'M10 3h3v1h-1v9l-1 1H4l-1-1V4H2V3h3V2a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1zM9 2H6v1h3V2zM4 13h7V4H4v9zm2-8H5v7h1V5zm1 0h1v7H7V5zm2 0h1v7H9V5z';
  const CHEMIN_CAMERA = 'M6.2 2a1 1 0 0 0-.9.55L4.6 4H2.5A1.5 1.5 0 0 0 1 5.5v7A1.5 1.5 0 0 0 2.5 14h11a1.5 1.5 0 0 0 1.5-1.5v-7A1.5 1.5 0 0 0 13.5 4h-2.1l-.7-1.45a1 1 0 0 0-.9-.55H6.2zM8 6a3.25 3.25 0 1 0 0 6.5 3.25 3.25 0 0 0 0-6.5zm0 1.5a1.75 1.75 0 1 0 0 3.5 1.75 1.75 0 0 0 0-3.5z';
  function icone(chemin) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('width', '14');
    svg.setAttribute('height', '14');
    svg.setAttribute('fill', 'currentColor');
    svg.setAttribute('aria-hidden', 'true');
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('fill-rule', 'evenodd');
    p.setAttribute('clip-rule', 'evenodd');
    p.setAttribute('d', chemin);
    svg.appendChild(p);
    return svg;
  }

  function champTexte(carte, parent, slug, cle, langue, libelle, valeur, multiligne) {
    const l = document.createElement('label');
    l.textContent = libelle;
    l.appendChild(creerBadge(langue ? cle + '.' + langue : cle));
    const i = document.createElement(multiligne ? 'textarea' : 'input');
    if (multiligne) { i.rows = 3; } else { i.type = 'text'; }
    i.value = valeur || '';
    i.dataset.cle = cle;
    if (langue) { i.dataset.langue = langue; l.classList.add('champ-' + langue); i.classList.add('champ-' + langue); }
    i.addEventListener('input', function () { marquer(carte, slug); });
    parent.appendChild(l);
    parent.appendChild(i);
  }

  function majBoutonPhoto(rangee, bouton) {
    const b = bouton || rangee.querySelector('button.photo');
    if (!b) { return; }
    const photo = rangee.dataset.photo || '';
    b.classList.toggle('avec-photo', photo !== '');
    b.title = photo !== '' ? TXT.photoPresente.split('{0}').join(photo) : TXT.photoBouton;
  }

  function noteRangee(rangee, texte) {
    let note = rangee.nextElementSibling;
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
    const rangee = document.createElement('div');
    rangee.className = 'auteur';
    rangee.dataset.photo = (auteur && auteur.photo) || '';
    for (const [cle, indice] of [['prenom', TXT.aPrenom], ['nom', TXT.aNom], ['fonction', TXT.aFonction], ['affiliation', TXT.aAffiliation], ['orcid', TXT.aOrcid], ['email', TXT.aEmail]]) {
      const i = document.createElement('input');
      i.type = 'text';
      i.placeholder = indice;
      i.title = indice;
      i.value = (auteur && auteur[cle]) || '';
      i.dataset.cle = cle;
      i.addEventListener('input', function () { marquer(carte, slug); });
      rangee.appendChild(i);
    }
    const photo = document.createElement('button');
    photo.type = 'button';
    photo.className = 'photo';
    photo.appendChild(icone(CHEMIN_CAMERA));
    majBoutonPhoto(rangee, photo);
    photo.addEventListener('click', function () { ouvrirModale(carte, slug, rangee); });
    rangee.appendChild(photo);
    const retirer = document.createElement('button');
    retirer.type = 'button';
    retirer.className = 'retirer';
    retirer.appendChild(icone(CHEMIN_POUBELLE));
    retirer.title = TXT.retirerAuteur;
    retirer.addEventListener('click', function () { rangee.remove(); marquer(carte, slug); });
    rangee.appendChild(retirer);
    zone.appendChild(rangee);
  }

  // ---- Modale photo : un voile HTML dans la webview, alimenté par postMessage, les
  // aperçus étant des data: URI renvoyées par l'hôte.
  const VERSIONS = ['sans-fond', 'avec-fond', 'original'];   // ordre de repli
  let modale = null;   // éléments du DOM (construits une fois)
  let ctx = null;      // { carte, slug, rangee, index, base, versions, occupe }

  function uriPour(version) {
    if (!ctx || !ctx.versions) { return null; }
    if (version === 'original') { return ctx.versions.original || null; }
    if (version === 'avec-fond') { return ctx.versions.avecFond || null; }
    if (version === 'sans-fond') { return ctx.versions.sansFond || null; }
    return null;
  }
  function radioChoisie() {
    const r = modale.radios.querySelector('input:checked');
    return r ? r.value : 'sans-fond';
  }
  function poserRadio(version) {
    for (const r of modale.radios.querySelectorAll('input')) { r.checked = (r.value === version); }
  }
  function majRadios() {
    for (const r of modale.radios.querySelectorAll('input')) {
      r.disabled = !ctx || !uriPour(r.value);
    }
  }
  function majApercu() {
    const uri = uriPour(radioChoisie());
    if (uri) { modale.img.src = uri; modale.img.hidden = false; }
    else { modale.img.removeAttribute('src'); modale.img.hidden = true; }
    modale.valider.disabled = !uri || !ctx || !ctx.base || ctx.occupe;
  }
  function poserNote(texte, estErreur) {
    modale.note.textContent = texte || '';
    modale.note.classList.toggle('erreur', !!estErreur);
  }

  function construireModale() {
    const voile = document.createElement('div');
    voile.id = 'voile';
    voile.hidden = true;
    const boite = document.createElement('div');
    boite.className = 'modale';
    const titre = document.createElement('h3');
    boite.appendChild(titre);
    const zone = document.createElement('div');
    zone.className = 'zone-depot';
    const consigne = document.createElement('div');
    consigne.textContent = TXT.photoDeposer;
    zone.appendChild(consigne);
    const ou = document.createElement('div');
    ou.className = 'ou';
    ou.textContent = TXT.photoOu;
    zone.appendChild(ou);
    const choisir = document.createElement('button');
    choisir.type = 'button';
    choisir.textContent = TXT.photoChoisirFichier;
    zone.appendChild(choisir);
    const fichier = document.createElement('input');
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
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) { deposerFichier(f); }
    });
    boite.appendChild(zone);
    const radios = document.createElement('div');
    radios.className = 'radios';
    for (const [valeur, libelle] of [['original', TXT.vOriginal], ['avec-fond', TXT.vAvecFond], ['sans-fond', TXT.vSansFond]]) {
      const l = document.createElement('label');
      const r = document.createElement('input');
      r.type = 'radio';
      r.name = 'version-photo';
      r.value = valeur;
      r.addEventListener('change', majApercu);
      l.appendChild(r);
      l.appendChild(document.createTextNode(' ' + libelle));
      radios.appendChild(l);
    }
    boite.appendChild(radios);
    const apercu = document.createElement('div');
    apercu.className = 'apercu-photo';
    const img = document.createElement('img');
    img.alt = '';
    img.hidden = true;
    apercu.appendChild(img);
    boite.appendChild(apercu);
    const note = document.createElement('p');
    note.className = 'note-modale';
    boite.appendChild(note);
    const boutons = document.createElement('div');
    boutons.className = 'boutons-modale';
    const valider = document.createElement('button');
    valider.type = 'button';
    valider.className = 'principal';
    valider.textContent = TXT.valider;
    valider.disabled = true;
    valider.addEventListener('click', function () {
      if (!ctx || !ctx.base || ctx.occupe) { return; }
      vscodeApi.postMessage({ type: 'photo-choisir', slug: ctx.slug, index: ctx.index, base: ctx.base, version: radioChoisie() });
    });
    const annuler = document.createElement('button');
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
    const prenom = (rangee.querySelector('input[data-cle=prenom]') || { value: '' }).value.trim();
    const nom = (rangee.querySelector('input[data-cle=nom]') || { value: '' }).value.trim();
    if (prenom === '' && nom === '') { noteRangee(rangee, TXT.photoNomRequis); return; }
    if (!modale) { construireModale(); }
    const index = Array.prototype.indexOf.call(carte.querySelectorAll('.auteur'), rangee);
    ctx = { carte: carte, slug: slug, rangee: rangee, index: index, base: null, versions: null, occupe: false };
    modale.titre.textContent = TXT.photoTitre.split('{0}').join((prenom + ' ' + nom).trim());
    poserRadio('sans-fond');
    majRadios();
    poserNote('');
    majApercu();
    const photo = rangee.dataset.photo || '';
    if (photo !== '') {
      poserNote(TXT.chargement);
      vscodeApi.postMessage({ type: 'photo-ouvrir', slug: slug, index: index, photo: photo });
    }
    modale.voile.hidden = false;
  }

  function fermerModale() {
    if (modale) { modale.voile.hidden = true; }
    ctx = null;   // une réponse tardive de l'hôte sera ignorée (slug/index recontrôlés)
  }

  function deposerFichier(f) {
    if (!ctx || ctx.occupe) { return; }
    const ext = (String(f.name || '').match(/\.([A-Za-z0-9]+)$/) || ['', ''])[1].toLowerCase();
    if (EXTENSIONS_PHOTO.indexOf(ext) === -1) { poserNote(TXT.errFormat, true); return; }
    if (f.size > TAILLE_MAX_PHOTO) { poserNote(TXT.errTropVolumineux, true); return; }
    const prenom = (ctx.rangee.querySelector('input[data-cle=prenom]') || { value: '' }).value.trim();
    const nom = (ctx.rangee.querySelector('input[data-cle=nom]') || { value: '' }).value.trim();
    const lecteur = new FileReader();
    const contexte = ctx;
    lecteur.onload = function () {
      if (ctx !== contexte) { return; }            // modale refermée entre-temps
      const texte = String(lecteur.result || '');
      const virgule = texte.indexOf(',');
      if (virgule === -1) { poserNote(TXT.errFormat, true); return; }
      ctx.occupe = true;
      poserNote(TXT.traitement);
      majApercu();
      vscodeApi.postMessage({
        type: 'photo-deposer', slug: ctx.slug, index: ctx.index,
        prenom: prenom, nom: nom, nomFichier: f.name, donneesBase64: texte.slice(virgule + 1)
      });
    };
    lecteur.readAsDataURL(f);
  }

  // ---- Originaux des images : une rangée par image de media/. Le remplacement est fait
  // par l'hôte, qui demande confirmation et conserve le nom ; ici on lit le fichier
  // déposé et on reflète l'état de la rangée.
  function poserEtatImage(ligne, texte, estErreur) {
    const e = ligne.querySelector('.image-etat');
    if (!e) { return; }
    e.textContent = texte || '';
    e.classList.toggle('erreur', !!estErreur);
  }

  function envoyerImage(ligne, slug, relatif, f) {
    if (ligne.classList.contains('occupe')) { return; }
    const ext = (String(f.name || '').match(/\.([A-Za-z0-9]+)$/) || ['', ''])[1].toLowerCase();
    if (EXTENSIONS_IMAGE.indexOf(ext) === -1) { poserEtatImage(ligne, '⚠ ' + TXT.errImageFormat, true); return; }
    if (f.size > TAILLE_MAX_IMAGE) { poserEtatImage(ligne, '⚠ ' + TXT.errImageTropVolumineuse, true); return; }
    const lecteur = new FileReader();
    lecteur.onload = function () {
      const texte = String(lecteur.result || '');
      const virgule = texte.indexOf(',');
      if (virgule === -1) { poserEtatImage(ligne, '⚠ ' + TXT.errImageFormat, true); return; }
      ligne.classList.add('occupe');               // levée par la réponse de l'hôte
      poserEtatImage(ligne, '…');
      vscodeApi.postMessage({
        type: 'remplacer-image', slug: slug, relatif: relatif,
        nomFichier: f.name, donneesBase64: texte.slice(virgule + 1)
      });
    };
    lecteur.readAsDataURL(f);
  }

  function ligneImage(slug, zone, image) {
    const ligne = document.createElement('div');
    ligne.className = 'image-ligne';
    ligne.dataset.relatif = image.relatif;
    const infos = document.createElement('div');
    infos.className = 'image-infos';
    const nom = document.createElement('span');
    nom.className = 'image-nom';
    nom.textContent = image.relatif;
    infos.appendChild(nom);
    const desc = document.createElement('span');
    desc.className = 'image-desc';
    desc.textContent = image.description || '';
    infos.appendChild(desc);
    const etatImage = document.createElement('span');
    etatImage.className = 'image-etat';
    infos.appendChild(etatImage);
    ligne.appendChild(infos);
    const depot = document.createElement('div');
    depot.className = 'zone-image';
    const consigne = document.createElement('span');
    consigne.textContent = TXT.imageDeposer;
    depot.appendChild(consigne);
    const ou = document.createElement('span');
    ou.className = 'ou';
    ou.textContent = TXT.photoOu;
    depot.appendChild(ou);
    const choisir = document.createElement('button');
    choisir.type = 'button';
    choisir.textContent = TXT.photoChoisirFichier;
    depot.appendChild(choisir);
    const fichier = document.createElement('input');
    fichier.type = 'file';
    fichier.accept = '.png,.jpg,.jpeg,.gif,.svg';
    fichier.hidden = true;
    depot.appendChild(fichier);
    choisir.addEventListener('click', function () { fichier.click(); });
    fichier.addEventListener('change', function () {
      if (fichier.files && fichier.files[0]) { envoyerImage(ligne, slug, image.relatif, fichier.files[0]); }
      fichier.value = '';
    });
    depot.addEventListener('dragover', function (e) { e.preventDefault(); depot.classList.add('survol'); });
    depot.addEventListener('dragleave', function () { depot.classList.remove('survol'); });
    depot.addEventListener('drop', function (e) {
      e.preventDefault();
      depot.classList.remove('survol');
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) { envoyerImage(ligne, slug, image.relatif, f); }
    });
    ligne.appendChild(depot);
    zone.appendChild(ligne);
  }

  function sectionImages(carte, slug, images) {
    const h3 = document.createElement('h3');
    h3.textContent = TXT.sectionImages;
    carte.appendChild(h3);
    if (!Array.isArray(images) || images.length === 0) {
      const p = document.createElement('p');
      p.className = 'images-aucune';
      p.textContent = TXT.imagesAucune;
      carte.appendChild(p);
      return;
    }
    const note = document.createElement('p');
    note.className = 'images-note';
    note.textContent = TXT.imagesNote;
    carte.appendChild(note);
    const zone = document.createElement('div');
    zone.className = 'images';
    carte.appendChild(zone);
    for (const image of images) { ligneImage(slug, zone, image); }
  }

  // Rangée d'image visée par une réponse de l'hôte, slug et chemin relatif recontrôlés :
  // jamais de sélecteur construit sur une valeur libre.
  function trouverLigneImage(slug, relatif) {
    for (const ligne of conteneur.querySelectorAll('.image-ligne')) {
      const carte = ligne.closest('.carte');
      if (carte && carte.dataset.slug === slug && ligne.dataset.relatif === relatif) { return ligne; }
    }
    return null;
  }

  function rendre(articles) {
    if (ctx) { fermerModale(); }                   // re-rendu : la rangée visée n'existe plus
    conteneur.textContent = '';
    modifies.clear();
    for (const article of articles) {
      const carte = document.createElement('div');
      carte.className = 'carte';
      carte.dataset.slug = article.slug;
      const titre = document.createElement('h2');
      const nomCarte = document.createElement('span');
      nomCarte.className = 'nom-carte';
      nomCarte.textContent = article.slug;
      titre.appendChild(nomCarte);
      const compteur = document.createElement('span');
      compteur.className = 'compteur';
      titre.appendChild(compteur);
      carte.appendChild(titre);
      const v = article.valeurs || {};
      const avecIt = ['title', 'subtitle', 'resume'].some(function (c) { return v[c] && v[c].it; }) ||
        (v.keywords && v.keywords.it && v.keywords.it.length > 0);
      if (avecIt) { carte.classList.add('avec-it'); }
      const lType = document.createElement('label');
      lType.textContent = TXT.type;
      lType.appendChild(creerBadge('type'));
      carte.appendChild(lType);
      const selection = document.createElement('select');
      selection.dataset.cle = 'type';
      const optVide = document.createElement('option');
      optVide.value = '';
      optVide.textContent = TXT.typeAucun;
      selection.appendChild(optVide);
      let cible = selection, groupeCourant = null;
      for (const t of TYPES) {
        if (t.groupe) {
          if (t.groupe !== groupeCourant) {
            groupeCourant = t.groupe;
            cible = document.createElement('optgroup');
            cible.label = t.groupe;
            selection.appendChild(cible);
          }
        } else { cible = selection; groupeCourant = null; }
        const opt = document.createElement('option');
        opt.value = t.valeur;
        opt.textContent = t.libelle;
        cible.appendChild(opt);
      }
      selection.value = v.type || '';
      if (selection.value !== (v.type || '')) { selection.value = ''; }
      selection.addEventListener('input', function () { marquer(carte, article.slug); });
      carte.appendChild(selection);
      // La langue par défaut du numéro vient en premier, les autres en dessous. L'italien
      // est toujours construit, et révélé par le CSS.
      const ordre = ['fr', 'de', 'it'];
      const defaut = ordre.indexOf(LANGUE_DEFAUT) !== -1 ? LANGUE_DEFAUT : 'fr';
      const langues = [defaut].concat(ordre.filter(function (l) { return l !== defaut; }));
      const nomsLangues = { fr: 'FR', de: 'DE', it: 'IT' };
      for (const lg of langues) {
        champTexte(carte, carte, article.slug, 'title', lg, TXT.titreChamp.split('{0}').join(nomsLangues[lg]), (v.title || {})[lg]);
      }
      for (const lg of langues) {
        champTexte(carte, carte, article.slug, 'subtitle', lg, TXT.sousTitre.split('{0}').join(nomsLangues[lg]), (v.subtitle || {})[lg]);
      }
      for (const lg of langues) {
        champTexte(carte, carte, article.slug, 'resume', lg, TXT.resume.split('{0}').join(nomsLangues[lg]), (v.resume || {})[lg], true);
      }
      const lAuteurs = document.createElement('label');
      lAuteurs.textContent = TXT.auteurs;
      lAuteurs.appendChild(creerBadge('auteurs'));
      carte.appendChild(lAuteurs);
      const zone = document.createElement('div');
      zone.className = 'auteurs';
      carte.appendChild(zone);
      for (const a of (v.author || [])) { ligneAuteur(carte, article.slug, zone, a); }
      const ajouter = document.createElement('button');
      ajouter.type = 'button';
      ajouter.textContent = TXT.ajouterAuteur;
      ajouter.addEventListener('click', function () { ligneAuteur(carte, article.slug, zone, null); marquer(carte, article.slug); });
      carte.appendChild(ajouter);
      const notePhotos = document.createElement('p');
      notePhotos.className = 'photos-note';
      notePhotos.textContent = TXT.photosNote;
      carte.appendChild(notePhotos);
      champTexte(carte, carte, article.slug, 'doi', null, 'DOI', v.doi);
      // Mots-clés : le fragment partagé SZH.motsCles (media/_commun.js), la même grille
      // appariée que dans « Métadonnées des articles » et dans le panneau de traduction.
      // Un badge par langue reste posé sur l'intitulé, comme pour les autres champs.
      const lMots = document.createElement('label');
      lMots.textContent = TXT.motsClesTitre || '';
      for (const lg of langues) {
        const b = creerBadge('keywords.' + lg);
        b.classList.add('champ-' + lg);
        lMots.appendChild(document.createTextNode(' ' + nomsLangues[lg] + ' '));
        lMots.appendChild(b);
      }
      carte.appendChild(lMots);
      const coloMotsCles = function (avec) {
        return langues.filter(function (l) { return l !== 'it' || avec; })
          .map(function (l) { return { code: l, libelle: nomsLangues[l] }; });
      };
      const editeurMots = SZH.motsCles({
        langues: coloMotsCles(avecIt),
        listes: v.keywords || {},
        edition: true,
        textes: {
          motCle: TXT.motsCles, ajouter: TXT.motCleAjouter,
          retirer: TXT.motCleRetirer, aide: TXT.motsClesAide
        },
        onChange: function () { marquer(carte, article.slug); majBadges(carte); }
      });
      motsClesParCarte.set(carte, editeurMots);
      carte.appendChild(editeurMots.element);
      const caseIt = document.createElement('label');
      caseIt.className = 'case-it';
      const coche = document.createElement('input');
      coche.type = 'checkbox';
      coche.checked = avecIt;
      caseIt.appendChild(coche);
      caseIt.appendChild(document.createTextNode(TXT.italien));
      coche.addEventListener('change', function () {
        carte.classList.toggle('avec-it', coche.checked);
        editeurMots.reconstruire(coloMotsCles(coche.checked));
        majBadges(carte);                          // les champs IT (dé)comptent
      });
      carte.appendChild(caseIt);
      sectionImages(carte, article.slug, article.images || []);
      conteneur.appendChild(carte);
      majBadges(carte);                            // état initial : détecté / à compléter
    }
  }
  function collecter(carte) {
    const resultat = { type: '', doi: '', title: {}, subtitle: {}, resume: {}, keywords: {}, author: [] };
    const sel = carte.querySelector('select[data-cle=type]');
    if (sel) { resultat.type = sel.value; }
    for (const i of carte.querySelectorAll(':scope > input, :scope > textarea')) {
      const cle = i.dataset.cle;
      const langue = i.dataset.langue;
      if (cle === 'doi') { resultat.doi = i.value; }
      else if (cle === 'title' || cle === 'subtitle' || cle === 'resume') { resultat[cle][langue] = i.value; }
    }
    for (const rangee of carte.querySelectorAll('.auteur')) {
      const a = {};
      for (const i of rangee.querySelectorAll('input')) { a[i.dataset.cle] = i.value; }
      a.photo = rangee.dataset.photo || '';         // posé par la modale
      resultat.author.push(a);
    }
    const editeurMots = motsClesParCarte.get(carte);
    if (editeurMots) { resultat.keywords = editeurMots.collecter(); }
    return resultat;
  }
  function cartesModifiees() {
    const envoi = {};
    for (const carte of conteneur.querySelectorAll('.carte')) {
      if (modifies.has(carte.dataset.slug)) { envoi[carte.dataset.slug] = collecter(carte); }
    }
    return envoi;
  }
  function envoyer(auto) {
    if (modifies.size === 0) { if (!auto) { etat.textContent = TXT.rien; } return; }
    vscodeApi.postMessage({ type: 'enregistrer', auto: !!auto, articles: cartesModifiees() });
  }
  const autoEnr = SZH.autoEnregistrement({
    estModifie: function () { return modifies.size > 0; },
    enregistrer: envoyer
  });
  document.getElementById('enregistrer').addEventListener('click', function () {
    autoEnr.annuler();
    envoyer(false);
  });
  // « Fermer » : l'hôte décide, et demande confirmation si des modifications ne sont pas
  // enregistrées. On lui passe l'état modifié et les cartes concernées, pour qu'il puisse
  // enregistrer depuis sa propre boîte de dialogue.
  document.getElementById('fermer').addEventListener('click', function () {
    vscodeApi.postMessage({ type: 'fermer', modifie: modifies.size > 0, articles: cartesModifiees() });
  });
  window.addEventListener('message', function (e) {
    const msg = e.data || {};
    if (msg.type === 'valeurs') { TYPES = msg.types || []; LANGUE_DEFAUT = msg.langue || 'fr'; rendre(msg.articles || []); }
    if (msg.type === 'enregistre') {
      autoEnr.confirme();
      // L'hôte ne suit pas l'état « modifié » de ce dialogue, c'est « Fermer » qui le lui
      // envoie : on se contente ici de retirer les marques.
      if (msg.auto) {
        modifies.clear();
        for (const c of conteneur.querySelectorAll('.carte.modifie')) { c.classList.remove('modifie'); }
      }
      etat.textContent = TXT.enregistre.split('{0}').join(msg.n);
    }
    if (msg.type === 'erreur') { autoEnr.confirme(); etat.textContent = '⚠ ' + msg.message; }
    if (msg.type === 'photo-versions') {
      if (!ctx || msg.slug !== ctx.slug || msg.index !== ctx.index) { return; }
      ctx.occupe = false;
      ctx.base = msg.base || null;
      ctx.versions = msg.versions || {};
      let choix = msg.actuelle || 'sans-fond';
      if (!uriPour(choix)) { choix = VERSIONS.filter(uriPour)[0] || 'sans-fond'; }
      poserRadio(choix);
      majRadios();
      const notes = [];
      if (msg.infos && !msg.infos.visage) { notes.push(TXT.sansVisage); }
      else if (msg.infos && msg.infos.padding) { notes.push(TXT.padding); }
      poserNote(notes.join(' '));
      majApercu();
    }
    if (msg.type === 'photo-valeur') {
      if (!ctx || msg.slug !== ctx.slug || msg.index !== ctx.index) { return; }
      const rangee = ctx.rangee, carte = ctx.carte, slug = ctx.slug;
      rangee.dataset.photo = msg.photo || '';
      majBoutonPhoto(rangee);
      fermerModale();
      marquer(carte, slug);
    }
    if (msg.type === 'photo-erreur') {
      if (!ctx || msg.slug !== ctx.slug || msg.index !== ctx.index) { return; }
      ctx.occupe = false;
      poserNote(msg.message || '?', true);
      majApercu();
    }
    // La rangée visée est retrouvée par slug et chemin relatif ; une réponse pour une
    // rangée disparue est ignorée.
    if (msg.type === 'image-remplacee' || msg.type === 'image-erreur' || msg.type === 'image-annulee') {
      const ligne = trouverLigneImage(String(msg.slug || ''), String(msg.relatif || ''));
      if (!ligne) { return; }
      ligne.classList.remove('occupe');
      if (msg.type === 'image-remplacee') {
        const desc = ligne.querySelector('.image-desc');
        if (desc && msg.description) { desc.textContent = msg.description; }
        poserEtatImage(ligne, TXT.imageRemplacee, false);
      } else if (msg.type === 'image-erreur') {
        poserEtatImage(ligne, '⚠ ' + (msg.message || '?'), true);
      } else {
        poserEtatImage(ligne, '');                 // annulé : zone simplement réactivée
      }
    }
  });
  document.addEventListener('dragover', function (e) { e.preventDefault(); });
  document.addEventListener('drop', function (e) { e.preventDefault(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && ctx) { fermerModale(); } });
  vscodeApi.postMessage({ type: 'pret' });
})();
