// Export OJS natif : toute la revue en un seul fichier XML « native » PKP — numéro,
// rubriques, couverture, articles et galleys encodés en base64 — importable par
// Outils > Importer/Exporter > Native XML. La structure, l'ordre des éléments et les
// tics de sérialisation sont calqués sur un export natif réel de l'OJS cible.
'use strict';

const fs = require('fs');
const path = require('path');
const { analyserAusgabe, analyserMeta, langueDefaut } = require('./yaml');
const { estATraduire, MARQUE_A_TRADUIRE } = require('./traduction');
const { imagesSansAlternative, listerImages } = require('./references');
const { TEXTES_COCKPIT } = require('./i18n');

// ---- Constantes OJS, à ajuster selon la configuration de l'OJS cible ----
//
// À l'import, OJS rattache chaque article à sa rubrique par la `ref` ; les libellés et
// seq ne servent que si la rubrique doit être créée, et les id internes portent
// advice="ignore", OJS les remplaçant toujours.
const SECTIONS_OJS = {
  ED: { seq: 1, idInterne: 16, sansResume: 1, abbrev: { de: 'ED', fr: 'ED' }, titre: { de: 'Editorial', fr: 'Éditorial' } },
  DT: { seq: 3, idInterne: 5, sansResume: 0, abbrev: { de: 'DT', fr: 'DT' }, titre: { de: 'Schwerpunkt', fr: 'Dossier thématique' } },
  VA: { seq: 4, idInterne: 8, sansResume: 0, abbrev: { de: 'VA', fr: 'VA' }, titre: { de: 'Varia', fr: 'Varia' } },
  TL: { seq: 5, idInterne: 15, sansResume: 1, abbrev: { de: 'TL', fr: 'TL' }, titre: { de: 'Freie Tribüne', fr: 'Tribune libre' } },
  DC: { seq: 6, idInterne: 14, sansResume: 1, abbrev: { de: 'DK', fr: 'DC' }, titre: { de: 'Dokumentation', fr: 'Documentation' } }
};
const SECTION_PAR_TYPE = {
  editorial: 'ED', article: 'DT', interview: 'DT',
  varia: 'VA', 'tribune-libre': 'TL', documentation: 'DC'
};
const GENRE_FICHIER = "Texte de l'article";
const TELEVERSEUR = 'redaction';
const GROUPE_AUTEUR = 'Auteur';
const URL_LICENCE = 'https://creativecommons.org/licenses/by/4.0';
const PAYS_AUTEUR = 'CH';
const FORMATS_GALLEY = [
  { etiquette: 'PDF', ext: 'pdf' },
  { etiquette: 'HTML', ext: 'html' },
  { etiquette: 'DOCX', ext: 'docx' }
];
const NOMS_COUVERTURE = ['couverture.jpg', 'couverture.jpeg', 'couverture.png'];
// Légende que Ctrl+Alt+F et « Insérer dans le texte » posent en attendant la vraie, dans
// les deux langues du cockpit : la reconnaître, c'est pouvoir dire qu'elle a été oubliée.
const LEGENDES_PAR_DEFAUT = new Set(Object.keys(TEXTES_COCKPIT)
  .map((l) => String(TEXTES_COCKPIT[l]['fmt.figure.legende'] || '').trim().toLowerCase())
  .filter((v) => v !== ''));

// Tic d'OJS : chaque conteneur redéclare l'espace de noms xsi et le schéma.
const XSI = ' xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"';
const SCHEMA = ' xsi:schemaLocation="http://pkp.sfu.ca native.xsd"';

// ---- Aides -------------------------------------------------------------------------

function echapperXml(valeur) {
  return String(valeur === undefined || valeur === null ? '' : valeur)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function echapperHtml(valeur) {
  return String(valeur === undefined || valeur === null ? '' : valeur)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formaterDateIso(d) {
  const p2 = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
}

function formaterHorodatage(d) {
  const p2 = (n) => String(n).padStart(2, '0');
  return '' + d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate()) +
    '-' + p2(d.getHours()) + p2(d.getMinutes()) + p2(d.getSeconds());
}

function localesNonVides(map) {
  return Object.keys(map || {})
    .filter((l) => String(map[l] || '').trim() !== '')
    .sort();
}

// Langues à écrire pour une rubrique. À l'import, OJS apparie chaque rubrique aux
// rubriques existantes titre par titre et langue par langue : un titre dans une langue que
// la revue cible n'emploie pas ne correspond à rien et provoque « … est identique à une
// rubrique existante dans la revue, mais un autre titre de cette rubrique ne correspond à
// aucun autre titre de rubrique existante ». On n'écrit donc que la langue du numéro ; les
// autres restent dans SECTIONS_OJS pour l'autre revue. Repli sur tout ce qui existe si la
// langue du numéro manque à la table, `abbrev` et `title` étant requis par le schéma.
function localesRubrique(map, locale) {
  const toutes = localesNonVides(map);
  return toutes.indexOf(locale) !== -1 ? [locale] : toutes;
}

function morceauNomFichier(valeur) {
  return String(valeur === undefined || valeur === null ? '' : valeur).trim()
    .replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || '0';
}

// Même filtre que la variable SLUGS du Makefile : le tri ASCII des slugs, préfixés 01-,
// 02-…, donne l'ordre éditorial du numéro.
function listerSlugs(racine) {
  const dossier = path.join(racine, 'articles');
  let entrees = [];
  try { entrees = fs.readdirSync(dossier, { withFileTypes: true }); }
  catch (e) { return []; }
  return entrees
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(dossier, e.name, e.name + '.md')))
    .map((e) => e.name)
    .sort();
}

// ---- Collecte et garde-fous ----------------------------------------------------------

function collecter(racine, avertissements) {
  let brut;
  try { brut = fs.readFileSync(path.join(racine, 'ausgabe.yaml'), 'utf8'); }
  catch (e) { throw new Error('ausgabe.yaml introuvable — « ' + racine + ' » n\'est pas un dossier de revue.'); }
  const valeurs = analyserAusgabe(brut);

  const numero = {
    locale: langueDefaut(valeurs),                 // jeton de revue, puis lang:, puis fr
    titre: String(valeurs.title || '').trim(),
    volume: String(valeurs.volume || '').trim(),
    numero: String(valeurs.numero || '').trim(),
    annee: (String(valeurs.date || '').match(/\d{4}/) || [''])[0],
    datePublication: (String(valeurs.date || '').trim().match(/^(\d{4}-\d{2}-\d{2})$/) || [])[1] || '',
    couverture: null
  };
  if (!numero.volume) { avertissements.push('ausgabe.yaml : volume absent.'); }
  if (!numero.numero) { avertissements.push('ausgabe.yaml : numero absent.'); }
  if (!numero.annee) { avertissements.push('ausgabe.yaml : aucune année (4 chiffres) dans date.'); }
  if (!numero.datePublication) {
    avertissements.push('ausgabe.yaml : date n\'est pas une date complète AAAA-MM-JJ — date_published omise (à saisir dans OJS).');
  }
  for (const nom of NOMS_COUVERTURE) {
    if (fs.existsSync(path.join(racine, nom))) { numero.couverture = nom; break; }
  }
  if (!numero.couverture) {
    avertissements.push('Aucune couverture (' + NOMS_COUVERTURE.join(', ') + ') à la racine — <covers> omis.');
  }

  const slugs = listerSlugs(racine);
  if (slugs.length === 0) {
    throw new Error('Aucun article (articles/<slug>/<slug>.md) dans ' + racine + '.');
  }

  const bloquants = [];
  const articles = [];
  for (const slug of slugs) {
    const prefixe = 'articles/' + slug + ' : ';
    const cheminMeta = path.join(racine, 'articles', slug, slug + '.meta.yaml');
    let meta = null;
    try { meta = analyserMeta(fs.readFileSync(cheminMeta, 'utf8')); }
    catch (e) { bloquants.push(prefixe + slug + '.meta.yaml introuvable (formulaire « Métadonnées » jamais enregistré ?).'); }

    const article = { slug: slug, meta: meta, section: '', fichiers: [] };
    if (meta) {
      const ref = SECTION_PAR_TYPE[String(meta.type || '').trim()];
      if (!ref) {
        bloquants.push(prefixe + (meta.type ? 'type « ' + meta.type + ' » sans rubrique OJS.' : 'type d\'article absent.'));
      }
      article.section = ref || '';
      if (localesNonVides(meta.title).length === 0) { bloquants.push(prefixe + 'aucun titre (title) dans aucune langue.'); }
      // Auteurs exploitables : au moins un prénom ou un nom. Une simple affiliation ne
      // fait pas un auteur OJS, givenname étant requis par le schéma.
      article.auteurs = (meta.author || []).filter((a) => (a.prenom || '').trim() !== '' || (a.nom || '').trim() !== '');
      if (article.auteurs.length === 0) { bloquants.push(prefixe + 'aucun auteur.'); }
      if (localesNonVides(meta.subtitle).length === 0) { avertissements.push(prefixe + 'sous-titre absent.'); }
      if (localesNonVides(meta.resume).length === 0) { avertissements.push(prefixe + 'résumé absent.'); }
      if (Object.keys(meta.keywords || {}).every((l) => !(meta.keywords[l] || []).length)) {
        avertissements.push(prefixe + 'mots-clés absents.');
      }
      // La marque « TO BE TRANSLATED » tient la place d'un mot-clé non traduit : utile en
      // atelier, désastreuse une fois publiée, et c'est ici le dernier moment pour la
      // signaler.
      for (const l of Object.keys(meta.keywords || {})) {
        const n = (meta.keywords[l] || []).filter((m) => estATraduire(m)).length;
        if (n > 0) {
          avertissements.push(prefixe + n + ' mot(s)-clé(s) ' + l.toUpperCase() +
            ' non traduits (marqués « ' + MARQUE_A_TRADUIRE + " ») — ils partiraient tels quels dans OJS.");
        }
      }
      if (!String(meta.doi || '').trim()) { avertissements.push(prefixe + 'DOI absent.'); }
      const sansEmail = article.auteurs.filter((a) => !String(a.email || '').trim()).length;
      if (sansEmail > 0) {
        avertissements.push(prefixe + sansEmail + ' auteur(s) sans email (contact vide dans OJS).');
      }
    }

    // Accessibilité des images, dernier moment où elle se répare : une image sans texte
    // alternatif ET sans légende part en image décorative, ce que personne n'a forcément
    // décidé. Le formulaire des médias a une case pour le dire explicitement.
    try {
      const texteMd = fs.readFileSync(path.join(racine, 'articles', slug, slug + '.md'), 'utf8');
      const manquantes = imagesSansAlternative(texteMd);
      if (manquantes.length > 0) {
        const noms = manquantes.map((i) => i.relatif || i.cible || '?').join(', ');
        avertissements.push(prefixe + manquantes.length + ' image(s) sans texte alternatif ni légende, ' +
          'et non déclarées décoratives : ' + noms +
          ' — elles partiraient en images décoratives. À reprendre dans le formulaire des médias.');
      }
      // « Légende » est le texte que Ctrl+Alt+F et le bouton « Insérer » posent en attendant
      // la vraie légende : publié tel quel, il s'imprime sous la figure. Les deux langues
      // sont comparées, l'article ayant pu être monté sur un poste en allemand.
      const oubliees = listerImages(texteMd)
        .filter((i) => LEGENDES_PAR_DEFAUT.has(i.legende.trim().toLowerCase()));
      if (oubliees.length > 0) {
        avertissements.push(prefixe + oubliees.length + ' figure(s) portent encore la légende posée par ' +
          'défaut à l’insertion : ' + oubliees.map((i) => i.relatif || i.cible || '?').join(', ') +
          ' — elle s’imprimerait telle quelle sous la figure.');
      }
    } catch (e) { /* .md illisible : les galleys manquants le diront déjà */ }

    for (const format of FORMATS_GALLEY) {
      const chemin = path.join(racine, 'out', slug, slug + '.' + format.ext);
      if (!fs.existsSync(chemin)) {
        bloquants.push(prefixe + 'out/' + slug + '/' + slug + '.' + format.ext + ' manquant — lancer « Tout exporter »' +
          (format.ext === 'docx' ? ' puis la cible make docx.' : '.'));
      }
      article.fichiers.push({ etiquette: format.etiquette, ext: format.ext, chemin: chemin });
    }
    articles.push(article);
  }
  if (bloquants.length > 0) {
    throw new Error('Export OJS impossible :\n- ' + bloquants.join('\n- '));
  }
  return { numero: numero, articles: articles };
}

// ---- Génération -----------------------------------------------------------------------

// -> { chemin, avertissements: string[] }. Écrit
// native-<AAAAMMJJ-HHMMSS>-<volume>-<numero>.xml à la racine de la revue, en écriture
// atomique. Lève une Error listant tous les manques bloquants avant d'écrire quoi que ce
// soit. options.maintenant fixe l'horodatage, ce dont se servent les tests.
function genererExportOjs(racine, options) {
  options = options || {};
  const maintenant = options.maintenant instanceof Date ? options.maintenant : new Date();
  const aujourdHui = formaterDateIso(maintenant);
  const avertissements = [];
  const collecte = collecter(racine, avertissements);
  const numero = collecte.numero;
  const articles = collecte.articles;

  // Un seul compteur global, donc des id uniques dans tout le fichier. OJS les
  // ré-attribue tous à l'import ; seuls comptent les renvois internes, qui pointent vers
  // l'avant et sont donc alloués avant l'écriture.
  let prochainId = 1;
  const allouer = () => prochainId++;
  const idNumero = allouer();
  const parSection = {};                           // seq de publication PAR rubrique (1, 2, …)
  for (const a of articles) {
    a.idArticle = allouer();
    for (const f of a.fichiers) { f.idSubmission = allouer(); f.idFichier = allouer(); }
    a.idPublication = allouer();
    for (const auteur of a.auteurs) { auteur.idAuteur = allouer(); }
    a.galleys = a.fichiers.slice().sort((x, y) => x.etiquette < y.etiquette ? -1 : 1)
      .map((f) => ({ id: allouer(), etiquette: f.etiquette, refSubmission: f.idSubmission }));
    parSection[a.section] = (parSection[a.section] || 0) + 1;
    a.seq = parSection[a.section];
  }

  // Écriture par morceaux : seuls le plus gros asset encodé en base64 et le tampon
  // tiennent la mémoire en même temps.
  const nomSortie = 'native-' + formaterHorodatage(maintenant) + '-' +
    morceauNomFichier(numero.volume) + '-' + morceauNomFichier(numero.numero) + '.xml';
  const chemin = path.join(racine, nomSortie);
  const tmp = path.join(racine, '~$' + nomSortie); // préfixe ignoré par OneDrive, comme le PDF du Makefile
  const fd = fs.openSync(tmp, 'w');
  const tampon = [];
  let enAttente = 0;
  const vider = () => {
    if (tampon.length > 0) { fs.writeSync(fd, tampon.join('')); tampon.length = 0; enAttente = 0; }
  };
  const w = (texte) => {
    tampon.push(texte);
    enAttente += texte.length;
    if (enAttente >= 1 << 20) { vider(); }
  };
  const ligne = (retrait, balise, attributs, texte) => {
    w(' '.repeat(retrait) + '<' + balise + attributs + '>' + echapperXml(texte) + '</' + balise + '>\n');
  };

  try {
    w('<?xml version="1.0" encoding="utf-8"?>\n');
    w('<issue xmlns="http://pkp.sfu.ca"' + XSI +
      ' published="1" current="1" access_status="1" url_path=""' + SCHEMA + '>\n');
    ligne(2, 'id', ' type="internal" advice="ignore"', idNumero);
    // <description> omise : le chapô du numéro ne vit pas dans ausgabe.yaml.
    w('  <issue_identification>\n');
    if (numero.volume) { ligne(4, 'volume', '', numero.volume); }
    if (numero.numero) { ligne(4, 'number', '', numero.numero); }
    if (numero.annee) { ligne(4, 'year', '', numero.annee); }
    if (numero.titre) { ligne(4, 'title', ' locale="' + numero.locale + '"', numero.titre); }
    w('  </issue_identification>\n');
    if (numero.datePublication) { ligne(2, 'date_published', '', numero.datePublication); }
    ligne(2, 'last_modified', '', numero.datePublication || aujourdHui);

    const refs = Object.keys(parSection).sort((a, b) => SECTIONS_OJS[a].seq - SECTIONS_OJS[b].seq);
    w('  <sections>\n');
    for (const ref of refs) {
      const s = SECTIONS_OJS[ref];
      w('    <section ref="' + ref + '" seq="' + s.seq + '" editor_restricted="0" meta_indexed="1"' +
        ' meta_reviewed="0" abstracts_not_required="' + s.sansResume + '" hide_title="0" hide_author="0"' +
        ' abstract_word_count="0">\n');
      ligne(6, 'id', ' type="internal" advice="ignore"', s.idInterne);
      for (const l of localesRubrique(s.abbrev, numero.locale)) { ligne(6, 'abbrev', ' locale="' + l + '"', s.abbrev[l]); }
      for (const l of localesRubrique(s.titre, numero.locale)) { ligne(6, 'title', ' locale="' + l + '"', s.titre[l]); }
      w('    </section>\n');
    }
    w('  </sections>\n');

    if (numero.couverture) {
      const cheminCouverture = path.join(racine, numero.couverture);
      w('  <covers>\n');
      w('    <cover locale="' + numero.locale + '">\n');
      ligne(6, 'cover_image', '', numero.couverture);
      ligne(6, 'cover_image_alt_text', '', numero.titre || 'Couverture');
      w('      <embed encoding="base64">');
      w(fs.readFileSync(cheminCouverture).toString('base64'));  // une seule ligne, comme la référence
      w('</embed>\n');
      w('    </cover>\n');
      w('  </covers>\n');
    }

    w('  <issue_galleys' + XSI + SCHEMA + '/>\n');
    w('  <articles' + XSI + SCHEMA + '>\n');

    for (const a of articles) {
      const meta = a.meta;
      const loc = ' locale="' + numero.locale + '"';
      w('    <article' + XSI + loc + ' date_submitted="' + aujourdHui + '" status="3"' +
        ' submission_progress="" current_publication_id="' + a.idPublication + '" stage="production">\n');
      ligne(6, 'id', ' type="internal" advice="ignore"', a.idArticle);

      for (const f of a.fichiers) {
        const octets = fs.readFileSync(f.chemin);
        w('      <submission_file' + XSI + ' id="' + f.idSubmission + '" created_at="' + aujourdHui + '"' +
          ' file_id="' + f.idFichier + '" stage="proof" updated_at="' + aujourdHui + '" viewable="false"' +
          ' genre="' + echapperXml(GENRE_FICHIER) + '" uploader="' + TELEVERSEUR + '"' + SCHEMA + '>\n');
        ligne(8, 'name', loc, a.slug + '.' + f.ext);
        w('        <file id="' + f.idFichier + '" filesize="' + octets.length + '" extension="' + f.ext + '">\n');
        w('          <embed encoding="base64">');
        w(octets.toString('base64'));              // une seule ligne, comme la référence
        w('</embed>\n');
        w('        </file>\n');
        w('      </submission_file>\n');
        vider();                                   // le base64 ne s'accumule pas dans le tampon
      }

      w('      <publication' + XSI + ' version="1" status="3"' +
        ' primary_contact_id="' + a.auteurs[0].idAuteur + '" url_path="" seq="' + a.seq + '"' +
        ' access_status="0"' + (numero.datePublication ? ' date_published="' + numero.datePublication + '"' : '') +
        ' section_ref="' + a.section + '"' + SCHEMA + '>\n');
      ligne(8, 'id', ' type="internal" advice="ignore"', a.idPublication);
      if (String(meta.doi || '').trim()) { ligne(8, 'id', ' type="doi" advice="update"', String(meta.doi).trim()); }
      for (const l of localesNonVides(meta.title)) { ligne(8, 'title', ' locale="' + l + '"', meta.title[l].trim()); }
      for (const l of localesNonVides(meta.subtitle)) { ligne(8, 'subtitle', ' locale="' + l + '"', meta.subtitle[l].trim()); }
      // Le résumé est une valeur HTML : texte échappé pour le HTML, puis l'ensemble pour
      // le XML. Ce double échappement est celui de la référence.
      for (const l of localesNonVides(meta.resume)) {
        ligne(8, 'abstract', ' locale="' + l + '"', '<p>' + echapperHtml(meta.resume[l].trim()) + '</p>');
      }
      ligne(8, 'licenseUrl', '', URL_LICENCE);
      const nomsAuteurs = a.auteurs
        .map((x) => ((x.prenom || '').trim() + ' ' + (x.nom || '').trim()).trim())
        .join(', ');
      ligne(8, 'copyrightHolder', loc, nomsAuteurs);
      if (numero.annee) { ligne(8, 'copyrightYear', '', numero.annee); }
      for (const l of Object.keys(meta.keywords || {}).sort()) {
        const mots = (meta.keywords[l] || []).map((m) => String(m).trim()).filter((m) => m !== '');
        if (mots.length === 0) { continue; }
        w('        <keywords locale="' + l + '">\n');
        for (const mot of mots) {
          w('          <keyword>\n');
          ligne(12, 'name', '', mot);
          w('          </keyword>\n');
        }
        w('        </keywords>\n');
      }

      w('        <authors' + XSI + SCHEMA + '>\n');
      a.auteurs.forEach((auteur, i) => {
        const prenom = (auteur.prenom || '').trim();
        const nom = (auteur.nom || '').trim();
        w('          <author include_in_browse="true" user_group_ref="' + echapperXml(GROUPE_AUTEUR) + '"' +
          ' seq="' + i + '" id="' + auteur.idAuteur + '">\n');
        // givenname est requis par le schéma : un auteur sans prénom y met son nom
        // entier, comme le fait la référence pour « Edition SZH/CSPS ».
        ligne(12, 'givenname', loc, prenom || nom);
        if (prenom && nom) { ligne(12, 'familyname', loc, nom); }
        if ((auteur.affiliation || '').trim()) {
          w('            <affiliation>\n');
          ligne(14, 'name', loc, auteur.affiliation.trim());
          w('            </affiliation>\n');
        }
        ligne(12, 'country', '', PAYS_AUTEUR);
        if (String(auteur.email || '').trim()) { ligne(12, 'email', '', String(auteur.email).trim()); }
        w('          </author>\n');
      });
      w('        </authors>\n');

      for (const g of a.galleys) {
        w('        <article_galley' + XSI + loc + ' approved="false"' + SCHEMA + '>\n');
        ligne(10, 'id', ' type="internal" advice="ignore"', g.id);
        ligne(10, 'name', loc, g.etiquette);
        ligne(10, 'seq', '', 0);
        w('          <submission_file_ref id="' + g.refSubmission + '"/>\n');
        w('        </article_galley>\n');
      }
      // <citations> et <pages> omis : la chaîne n'en a pas de source fiable.
      w('      </publication>\n');
      w('    </article>\n');
    }

    w('  </articles>\n');
    w('</issue>\n');
    vider();
    fs.closeSync(fd);
    fs.renameSync(tmp, chemin);
  } catch (e) {
    try { fs.closeSync(fd); } catch (e2) { /* déjà fermé */ }
    try { fs.unlinkSync(tmp); } catch (e2) { /* jamais écrit */ }
    throw e;
  }
  return { chemin: chemin, avertissements: avertissements };
}

module.exports = { genererExportOjs };

if (require.main === module) {
  const racine = process.argv[2];
  if (!racine) {
    console.error('Usage : node lib/export-ojs.js <cheminRevue>');
    process.exit(2);
  }
  try {
    const resultat = genererExportOjs(racine);
    console.log(resultat.chemin);
    for (const a of resultat.avertissements) { console.log('avertissement : ' + a); }
  } catch (e) {
    console.error(String((e && e.message) || e));
    process.exit(1);
  }
}
