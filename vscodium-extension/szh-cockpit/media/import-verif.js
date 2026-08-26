// Webview « Vérification de l'import » : les mêmes cartes que « Métadonnées des
// articles » (SZH.cartesArticles, media/_fiches.js), décorées d'un badge par champ et
// d'un compteur de champs vides, plus une section « Originaux des images » où déposer
// l'original d'une image importée, à nom conservé.
//
// Protocole avec l'hôte, en plus de photo-*, du DOI manuel et de l'enregistrement (voir
// _fiches.js) :
//   webview -> hôte : pret ; enregistrer { auto, articles } ;
//                     fermer { modifie, articles } ;
//                     remplacer-image { slug, relatif, nomFichier, donneesBase64 }
//   hôte -> webview : valeurs { articles, types, langue, accent } ; enregistre { auto, n } ;
//                     erreur { message } ; image-remplacee { slug, relatif, description } ;
//                     image-erreur { slug, relatif, message } ; image-annulee { slug, relatif }
(function () {
  'use strict';
  const TXT = __TXT__;
  const vscodeApi = acquireVsCodeApi();
  const etat = document.getElementById('etat');
  const conteneur = document.getElementById('cartes');
  const TAILLE_MAX_IMAGE = 50 * 1024 * 1024;
  const EXTENSIONS_IMAGE = ['png', 'jpg', 'jpeg', 'gif', 'svg'];

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
    // Le doi ne compte pas : il est calculé par l'hôte et affiché verrouillé, il n'y a
    // rien à compléter — seule l'échappatoire « Définir manuellement le DOI » en pose un.
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
    const vides = new Set(listeChampsVides(cartes.collecter(carte), carte.classList.contains('avec-it')));
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

  const cartes = SZH.cartesArticles({
    conteneur: conteneur,
    api: vscodeApi,
    txt: TXT,
    etat: etat,
    // Les badges « à compléter » sont posés dans les intitulés, y compris ceux des
    // traductions : les cacher au départ masquerait la moitié de ce que ce panneau
    // annonce dans sa tête de carte.
    traductionsVisibles: true,
    decor: {
      titre: function (h2, slug) {
        const nom = document.createElement('span');
        nom.className = 'nom-carte';
        nom.textContent = slug;
        h2.appendChild(nom);
        const compteur = document.createElement('span');
        compteur.className = 'compteur';
        h2.appendChild(compteur);
      },
      champ: function (label, champId) { label.appendChild(creerBadge(champId)); },
      motsCles: function (label, langues, noms) {
        for (const lg of langues) {
          const b = creerBadge('keywords.' + lg);
          b.classList.add('champ-' + lg);
          label.appendChild(document.createTextNode(' ' + noms[lg] + ' '));
          label.appendChild(b);
        }
      },
      finCarte: function (carte, article) {
        sectionImages(carte, article.slug, article.images || []);
        majBadges(carte);                          // état initial : détecté ou à compléter
      },
      carteChangee: majBadges,                     // les champs italiens (dé)comptent
      marque: majBadges
    }
  });

  // ---- Originaux des images ----
  //
  // Une rangée par image de media/. Le remplacement est fait par l'hôte, qui demande
  // confirmation et conserve le nom ; ici on lit le fichier déposé et on reflète l'état.
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

  // L'hôte répond sans renvoyer les valeurs quand l'enregistrement est automatique,
  // pour ne pas re-rendre la page sous les doigts.
  cartes.enregistrement(document.getElementById('enregistrer'));
  // « Fermer » : l'hôte décide, et demande confirmation si des modifications ne sont pas
  // enregistrées. On lui passe l'état modifié et les cartes concernées, pour qu'il puisse
  // enregistrer depuis sa propre boîte de dialogue.
  document.getElementById('fermer').addEventListener('click', function () {
    vscodeApi.postMessage({ type: 'fermer', modifie: cartes.estModifie(), articles: cartes.modifiees() });
  });

  cartes.traductions(document.getElementById('traductions'));

  let recu = false;
  window.addEventListener('message', function (e) {
    const msg = e.data || {};
    recu = true;
    if (cartes.message(msg)) { return; }
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
  SZH.annoncerPret(vscodeApi, function () { return recu; });
})();
