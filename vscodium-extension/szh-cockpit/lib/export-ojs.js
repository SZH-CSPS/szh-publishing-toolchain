// SZH cockpit — export OJS natif (F7) : toute la revue -> UN fichier XML « native »
// PKP (numéro + rubriques + couverture + articles + galleys PDF/HTML/DOCX encodés
// en base64), importable en un clic dans OJS (Outils > Importer/Exporter > Native XML).
// Structure, ordre des éléments/attributs et « tics » de sérialisation (xmlns:xsi +
// xsi:schemaLocation redéclarés sur chaque conteneur, base64 sur UNE seule ligne)
// calqués sur un export natif RÉEL de l'OJS cible (native-20260819-…-issues-5.xml).
// Zéro dépendance : fs/path Node + lib/yaml.js. Aucune dépendance à vscode ni i18n.
'use strict';

const fs = require('fs');
const path = require('path');
const { analyserAusgabe, analyserMeta, langueDefaut } = require('./yaml');

// ---- Constantes OJS — à ajuster selon la config OJS cible ---------------------------
//
// Valeurs relevées dans l'export natif de référence (journal fr) et complétées pour
// le journal de. À l'import, OJS rattache chaque article à la rubrique par sa `ref`
// (abbrev) ; les libellés/seq ne servent que si la rubrique doit être créée, et les
// « id internes » sont advice="ignore" (OJS les remplace toujours).
const SECTIONS_OJS = {
  ED: { seq: 1, idInterne: 16, sansResume: 1, abbrev: { de: 'ED', fr: 'ED' }, titre: { de: 'Editorial', fr: 'Éditorial' } },
  DT: { seq: 3, idInterne: 5, sansResume: 0, abbrev: { de: 'DT', fr: 'DT' }, titre: { de: 'Schwerpunkt', fr: 'Dossier thématique' } },
  VA: { seq: 4, idInterne: 8, sansResume: 0, abbrev: { de: 'VA', fr: 'VA' }, titre: { de: 'Varia', fr: 'Varia' } },
  TL: { seq: 5, idInterne: 15, sansResume: 1, abbrev: { de: 'TL', fr: 'TL' }, titre: { de: 'Freie Tribüne', fr: 'Tribune libre' } },
  DC: { seq: 6, idInterne: 14, sansResume: 1, abbrev: { de: 'DK', fr: 'DC' }, titre: { de: 'Dokumentation', fr: 'Documentation' } }
};
// Type d'article (D71) -> rubrique OJS. `interview` rejoint le dossier thématique.
const SECTION_PAR_TYPE = {
  editorial: 'ED', article: 'DT', interview: 'DT',
  varia: 'VA', 'tribune-libre': 'TL', documentation: 'DC'
};
// Genre de fichier, téléverseur et groupe d'auteurs TELS QUE NOMMÉS dans l'OJS cible
// (rattachés par nom à l'import — journal de : vérifier « Artikeltext »/« Autor/in »).
const GENRE_FICHIER = "Texte de l'article";
const TELEVERSEUR = 'redaction';
const GROUPE_AUTEUR = 'Auteur';
const URL_LICENCE = 'https://creativecommons.org/licenses/by/4.0';
const PAYS_AUTEUR = 'CH';
// Les trois galleys par article (D21 + règle docx du Makefile), dans l'ordre où la
// référence liste les submission_file. Les <article_galley>, eux, sortent triés par
// étiquette (DOCX, HTML, PDF), comme dans la référence.
const FORMATS_GALLEY = [
  { etiquette: 'PDF', ext: 'pdf' },
  { etiquette: 'HTML', ext: 'html' },
  { etiquette: 'DOCX', ext: 'docx' }
];
// Couverture du numéro : premier de ces fichiers trouvé à la racine de la revue.
const NOMS_COUVERTURE = ['couverture.jpg', 'couverture.jpeg', 'couverture.png'];

// « Tic » d'OJS : chaque conteneur redéclare l'espace de noms xsi et le schéma.
const XSI = ' xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"';
const SCHEMA = ' xsi:schemaLocation="http://pkp.sfu.ca native.xsd"';

// ---- Aides -------------------------------------------------------------------------

// Échappement XML systématique (texte ET valeurs d'attribut).
function echapperXml(valeur) {
  return String(valeur === undefined || valeur === null ? '' : valeur)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Échappement HTML d'un texte brut (nœud texte : & < > suffisent) — pour la couche
// HTML du résumé, AVANT l'échappement XML du tout.
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

// Locales non vides d'une map { locale: texte }, triées (de, fr, it) — même ordre
// que les éléments multilingues de la référence (abbrev/title de rubrique, abstract).
function localesNonVides(map) {
  return Object.keys(map || {})
    .filter((l) => String(map[l] || '').trim() !== '')
    .sort();
}

// Morceau de nom de fichier sûr (volume/numéro dans le nom du XML).
function morceauNomFichier(valeur) {
  return String(valeur === undefined || valeur === null ? '' : valeur).trim()
    .replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || '0';
}

// articles/<slug>/<slug>.md — même filtre que SLUGS du Makefile ; le tri ASCII des
// slugs (préfixes 01-, 02-…) EST l'ordre éditorial du numéro.
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

// Lit le numéro et tous les articles, vérifie ce qui est BLOQUANT (type, titre,
// auteur, produits out/) et collectionne les manques tolérables en avertissements.
function collecter(racine, avertissements) {
  let brut;
  try { brut = fs.readFileSync(path.join(racine, 'ausgabe.yaml'), 'utf8'); }
  catch (e) { throw new Error('ausgabe.yaml introuvable — « ' + racine + ' » n\'est pas un dossier de revue.'); }
  const valeurs = analyserAusgabe(brut);

  const numero = {
    locale: langueDefaut(valeurs),                 // D74 : jeton de revue, puis lang:, puis fr
    titre: String(valeurs.title || '').trim(),
    volume: String(valeurs.volume || '').trim(),
    numero: String(valeurs.numero || '').trim(),
    annee: (String(valeurs.date || '').match(/\d{4}/) || [''])[0],
    // date_published seulement si `date:` est une date ISO complète AAAA-MM-JJ.
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
      // Auteurs exploitables : au moins un prénom ou un nom (une simple affiliation
      // ne fait pas un auteur OJS — givenname est obligatoire dans le schéma).
      article.auteurs = (meta.author || []).filter((a) => (a.prenom || '').trim() !== '' || (a.nom || '').trim() !== '');
      if (article.auteurs.length === 0) { bloquants.push(prefixe + 'aucun auteur.'); }
      if (localesNonVides(meta.subtitle).length === 0) { avertissements.push(prefixe + 'sous-titre absent.'); }
      if (localesNonVides(meta.resume).length === 0) { avertissements.push(prefixe + 'résumé absent.'); }
      if (Object.keys(meta.keywords || {}).every((l) => !(meta.keywords[l] || []).length)) {
        avertissements.push(prefixe + 'mots-clés absents.');
      }
      if (!String(meta.doi || '').trim()) { avertissements.push(prefixe + 'DOI absent.'); }
      const sansEmail = article.auteurs.filter((a) => !String(a.email || '').trim()).length;
      if (sansEmail > 0) {
        avertissements.push(prefixe + sansEmail + ' auteur(s) sans email (contact vide dans OJS).');
      }
    }

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

// genererExportOjs(racine, options?) -> { chemin, avertissements: string[] }
// Écrit native-<AAAAMMJJ-HHMMSS>-<volume>-<numero>.xml à la racine de la revue
// (écriture atomique : temporaire « ~$… » puis rename). Lève une Error listant TOUS
// les manques bloquants avant d'écrire quoi que ce soit.
// options.maintenant (Date) : horodatage de référence, injectable pour les tests.
function genererExportOjs(racine, options) {
  options = options || {};
  const maintenant = options.maintenant instanceof Date ? options.maintenant : new Date();
  const aujourdHui = formaterDateIso(maintenant);
  const avertissements = [];
  const collecte = collecter(racine, avertissements);
  const numero = collecte.numero;
  const articles = collecte.articles;

  // IDs internes : UN compteur global -> ids croissants et uniques dans tout le
  // fichier (submission_file jamais égal à son file, refs cohérentes). OJS les
  // ré-attribue tous à l'import (advice="ignore") ; seuls comptent les renvois
  // internes : current_publication_id -> publication, submission_file_ref ->
  // submission_file. Alloués AVANT l'écriture (renvois vers l'avant).
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

  // Écriture par morceaux : petit tampon vidé vers le descripteur au fil de l'eau —
  // seuls le plus gros asset (base64) et le tampon vivent en mémoire en même temps.
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
  // Ligne d'élément texte : indentation, échappement, balise fermée sur la ligne.
  const ligne = (retrait, balise, attributs, texte) => {
    w(' '.repeat(retrait) + '<' + balise + attributs + '>' + echapperXml(texte) + '</' + balise + '>\n');
  };

  try {
    w('<?xml version="1.0" encoding="utf-8"?>\n');
    w('<issue xmlns="http://pkp.sfu.ca"' + XSI +
      ' published="1" current="1" access_status="1" url_path=""' + SCHEMA + '>\n');
    ligne(2, 'id', ' type="internal" advice="ignore"', idNumero);
    // <description> : omise (le chapô du numéro ne vit pas dans ausgabe.yaml).
    w('  <issue_identification>\n');
    if (numero.volume) { ligne(4, 'volume', '', numero.volume); }
    if (numero.numero) { ligne(4, 'number', '', numero.numero); }
    if (numero.annee) { ligne(4, 'year', '', numero.annee); }
    if (numero.titre) { ligne(4, 'title', ' locale="' + numero.locale + '"', numero.titre); }
    w('  </issue_identification>\n');
    if (numero.datePublication) { ligne(2, 'date_published', '', numero.datePublication); }
    ligne(2, 'last_modified', '', numero.datePublication || aujourdHui);

    // Rubriques : uniquement celles utilisées par les articles présents, dans
    // l'ordre de leur seq OJS.
    const refs = Object.keys(parSection).sort((a, b) => SECTIONS_OJS[a].seq - SECTIONS_OJS[b].seq);
    w('  <sections>\n');
    for (const ref of refs) {
      const s = SECTIONS_OJS[ref];
      w('    <section ref="' + ref + '" seq="' + s.seq + '" editor_restricted="0" meta_indexed="1"' +
        ' meta_reviewed="0" abstracts_not_required="' + s.sansResume + '" hide_title="0" hide_author="0"' +
        ' abstract_word_count="0">\n');
      ligne(6, 'id', ' type="internal" advice="ignore"', s.idInterne);
      for (const l of localesNonVides(s.abbrev)) { ligne(6, 'abbrev', ' locale="' + l + '"', s.abbrev[l]); }
      for (const l of localesNonVides(s.titre)) { ligne(6, 'title', ' locale="' + l + '"', s.titre[l]); }
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

      // Un <submission_file> par produit compilé, contenu encodé en base64.
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
      // Résumé : valeur HTML (<p>…</p>) dont le texte est d'abord rendu sûr pour le
      // HTML, puis le tout échappé pour le XML — double échappement voulu, comme
      // dans la référence (&lt;p&gt;… &amp;nbsp; …&lt;/p&gt;).
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
        // givenname est obligatoire dans le schéma : un auteur sans prénom y met
        // son nom entier (même astuce que « Edition SZH/CSPS » dans la référence).
        ligne(12, 'givenname', loc, prenom || nom);
        if (prenom && nom) { ligne(12, 'familyname', loc, nom); }
        if ((auteur.affiliation || '').trim()) {
          w('            <affiliation>\n');
          ligne(14, 'name', loc, auteur.affiliation.trim());
          w('            </affiliation>\n');
        }
        ligne(12, 'country', '', PAYS_AUTEUR);
        // email : champ pas encore posé par le formulaire (vague ultérieure) —
        // émis dès qu'il existera dans le meta.yaml.
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
      // <citations> et <pages> : omis en v1 (pas de source fiable côté toolchain).
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

// Essai en ligne de commande : node lib/export-ojs.js <cheminRevue>
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
