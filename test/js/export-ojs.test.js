// L'export OJS natif, éprouvé sur un numéro monté depuis revue-template/.
//
//   node --test "test/js/*.test.js"
//
// Pourquoi ce fichier. lib/export-ojs.js est le seul module qui décide de ce que reçoit
// OJS, et rien ne le chargeait : ni les intitulés de rubrique, ni la date de publication,
// ni l'ORCID, ni les références n'avaient de témoin. Trois de ces quatre choses étaient
// fausses ou absentes sans que rien ne le dise — un import réussit en rangeant l'article
// dans une rubrique inventée.
//
// Deux familles de contrôle : la référence, où l'XML entier est comparé caractère par
// caractère à ce qu'on attend ; et le refus, où un manque doit arrêter l'export avec un
// message qui dit quoi faire, plutôt que partir avec une valeur fausse.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Langue des messages fixée : elle vient de l'environnement hors de l'éditeur, et les
// contrôles la changent eux-mêmes quand ils veulent lire l'allemand.
process.env.SZH_LANGUE = 'fr';

const RACINE = path.resolve(__dirname, '..', '..');
const COCKPIT = path.join(RACINE, 'vscodium-extension', 'szh-cockpit');
const { ouvrir, libellesHote } = require('./dom-minimal');
const yaml = require(path.join(COCKPIT, 'lib', 'yaml.js'));
const i18n = require(path.join(COCKPIT, 'lib', 'i18n.js'));

// Ce que l'hôte envoie au panneau des réglages : même forme que donneesOjs() dans
// extension.js, dont les listes viennent d'ici et de lib/yaml.js.
function messagePanneau() {
  const revues = {};
  for (const loc of ojs.LOCALES_REVUE) { revues[loc] = i18n.T('ojs.revue.' + loc); }
  return {
    config: ojs.configOjs(),
    locales: ojs.LOCALES_REVUE,
    revues: revues,
    clesDefaut: ojs.RUBRIQUES_DEFAUT.map((r) => r.cle),
    champs: ojs.CHAMPS_REVUE.map((c) => ({
      cle: c.cle, requis: c.requis, libelle: i18n.T(c.libelle), ou: i18n.T(c.ou)
    })),
    typesArticle: yaml.TYPES_ARTICLE.map((t) => ({
      valeur: t, libelle: (yaml.LIBELLES_TYPES[t] || {}).fr || t
    }))
  };
}

// Le config.json du poste n'est jamais touché : SZH_CONFIG_OJS détourne la lecture et
// l'écriture vers un fichier temporaire, que chaque contrôle pose ou retire.
const CONFIG_ESSAI = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'szh-ojs-cfg-')), 'config.json');
process.env.SZH_CONFIG_OJS = CONFIG_ESSAI;
const ojs = require(path.join(COCKPIT, 'lib', 'export-ojs.js'));

const LF = '\n';
const MAINTENANT = new Date(2026, 7, 21, 9, 30, 0);   // 21 août 2026, 09:30:00

// ---- Montage d'un numéro d'essai ----------------------------------------------------

// Le texte d'un article : deux appels de citation et une liste de références, celle que
// l'export doit relire au dernier moment.
const TEXTE_ARTICLE = [
  '# Titre',
  '',
  'Un paragraphe, avec un appel (Shaw et al., 2023) et un autre (Zielinski, 2021).',
  '',
  '## Références',
  '',
  'Shaw, A., Bertrand, C., & Muller, D. (2023). *Enseigner autrement*. Editions SZH/CSPS.',
  '',
  'Zielinski, M. (2021). Adapter le curriculum. *Revue suisse de pédagogie spécialisée*,',
  '11(2), 14-22. https://doi.org/10.57161/r2021-02-03',
  ''
].join(LF);

function fiche(lignes) { return lignes.concat(['']).join(LF); }

// Un article du dossier : deux auteurs dont un seul porte un ORCID, un DOI, un résumé et
// des mots-clés dans les deux langues.
function ficheArticle(langue, doi) {
  return fiche([
    'type: article',
    'lang: ' + langue,
    'doi: "' + doi + '"',
    'title:',
    '  fr: "Observation et adaptation"',
    '  de: "Beobachtung und Anpassung"',
    'subtitle:',
    '  fr: "Un sous-titre"',
    '  de: "Ein Untertitel"',
    'resume:',
    '  fr: "Un résumé français."',
    '  de: "Eine deutsche Zusammenfassung."',
    'keywords:',
    '  fr:',
    '  - "observation"',
    '  de:',
    '  - "Beobachtung"',
    'author:',
    '- prenom: "Anne"',
    '  nom: "Dupont"',
    '  affiliation: "HEP Vaud"',
    '  orcid: "0000-0002-1825-0097"',
    '  email: "anne.dupont@example.ch"',
    '- prenom: "Bruno"',
    '  nom: "Meyer"',
    '  affiliation: "SZH/CSPS"'
  ]);
}

function ficheEditorial(langue, doi) {
  return fiche([
    'type: editorial',
    'lang: ' + langue,
    'doi: "' + doi + '"',
    'title:',
    '  fr: "Éditorial"',
    '  de: "Editorial"',
    'author:',
    '- prenom: "Claire"',
    '  nom: "Rossi"'
  ]);
}

// opts.produit  'revue' | 'zeitschrift'
// opts.ausgabe  clés d'ausgabe.yaml à changer (date, volume…)
// opts.articles [{ slug, fiche, texte }] ; par défaut l'éditorial puis l'article
//
// Le numéro part du vrai revue-template/ausgabe.yaml, et non d'une copie : c'est le
// gabarit livré aux rédactions qui est éprouvé, avec ses commentaires et ses défauts.
function monter(opts) {
  opts = opts || {};
  const produit = opts.produit || 'revue';
  const langue = produit === 'zeitschrift' ? 'de' : 'fr';
  const lettre = produit === 'zeitschrift' ? 'z' : 'r';
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-ojs-'));
  const gabarit = fs.readFileSync(path.join(RACINE, 'revue-template', 'ausgabe.yaml'), 'utf8');
  const valeurs = Object.assign({ revue: produit, lang: langue }, opts.ausgabe || {});
  fs.writeFileSync(path.join(racine, 'ausgabe.yaml'), yaml.serialiserAusgabe(gabarit, valeurs));
  fs.writeFileSync(path.join(racine, 'couverture.jpg'), Buffer.from('JPEG'));

  const articles = opts.articles || [
    { slug: '01-edito', fiche: ficheEditorial(langue, '10.57161/' + lettre + '2026-02-00'), texte: '# Edito' + LF + LF + 'Un mot.' + LF },
    { slug: '02-observation', fiche: ficheArticle(langue, '10.57161/' + lettre + '2026-02-01'), texte: TEXTE_ARTICLE }
  ];
  for (const a of articles) {
    const dossier = path.join(racine, 'articles', a.slug);
    fs.mkdirSync(dossier, { recursive: true });
    fs.writeFileSync(path.join(dossier, a.slug + '.md'), a.texte);
    if (a.fiche !== null) { fs.writeFileSync(path.join(dossier, a.slug + '.meta.yaml'), a.fiche); }
    // La bibliographie détachée à l'import : c'est elle qui fait foi pour <citations>.
    if (a.biblio) { fs.writeFileSync(path.join(dossier, a.slug + '.biblio.md'), a.biblio); }
    const sortie = path.join(racine, 'out', a.slug);
    fs.mkdirSync(sortie, { recursive: true });
    // Des galleys minuscules mais réels : leur taille entre dans l'XML, elle doit donc
    // être prévisible.
    for (const ext of ['pdf', 'html', 'docx']) {
      fs.writeFileSync(path.join(sortie, a.slug + '.' + ext), Buffer.from(a.slug + ':' + ext));
    }
  }
  return racine;
}

// L'XML produit, base64 des pièces jointes retiré : ce qui est comparé, c'est la
// structure et les valeurs, pas le contenu des fichiers.
function exporter(racine, config) {
  const resultat = ojs.genererExportOjs(racine, { maintenant: MAINTENANT, config: config });
  const xml = fs.readFileSync(resultat.chemin, 'utf8')
    .replace(/(<embed encoding="base64">)[^<]*/g, '$1');
  return { xml: xml, chemin: resultat.chemin, avertissements: resultat.avertissements };
}

function refuse(racine, config) {
  try {
    ojs.genererExportOjs(racine, { maintenant: MAINTENANT, config: config });
  } catch (e) {
    return e;
  }
  assert.fail('l’export a réussi alors qu’il devait être refusé');
}

// Configuration complète des deux revues : les défauts, plus ce qui manque côté allemand,
// pour que les contrôles qui ne portent pas sur la configuration puissent aboutir.
function configComplete() {
  return {
    revues: {
      fr: { genreFichier: "Texte de l'article", groupeAuteur: 'Auteur', televerseur: 'redaction', paysAuteur: '' },
      de: { genreFichier: 'Artikeltext', groupeAuteur: 'Autor/in', televerseur: 'redaktion', paysAuteur: '' }
    }
  };
}

// ---- La référence : l'XML d'un numéro de la Revue, caractère par caractère -----------

const REFERENCE_REVUE = [
  '<?xml version="1.0" encoding="utf-8"?>',
  '<issue xmlns="http://pkp.sfu.ca" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" published="1" current="1" access_status="1" url_path="" xsi:schemaLocation="http://pkp.sfu.ca native.xsd">',
  '  <id type="internal" advice="ignore">1</id>',
  '  <issue_identification>',
  '    <volume>44</volume>',
  '    <number>2</number>',
  '    <year>2026</year>',
  '    <title locale="fr">Dossier — numéro d&#39;exemple</title>',
  '  </issue_identification>',
  '  <date_published>2026-09-08</date_published>',
  '  <last_modified>2026-09-08</last_modified>',
  '  <sections>',
  '    <section ref="ED" seq="1" editor_restricted="0" meta_indexed="1" meta_reviewed="0" abstracts_not_required="1" hide_title="0" hide_author="0" abstract_word_count="0">',
  '      <id type="internal" advice="ignore">16</id>',
  '      <abbrev locale="fr">ED</abbrev>',
  '      <title locale="fr">Éditorial</title>',
  '    </section>',
  '    <section ref="DT" seq="3" editor_restricted="0" meta_indexed="1" meta_reviewed="0" abstracts_not_required="0" hide_title="0" hide_author="0" abstract_word_count="0">',
  '      <id type="internal" advice="ignore">5</id>',
  '      <abbrev locale="fr">DT</abbrev>',
  '      <title locale="fr">Dossier thématique</title>',
  '    </section>',
  '  </sections>',
  '  <covers>',
  '    <cover locale="fr">',
  '      <cover_image>couverture.jpg</cover_image>',
  '      <cover_image_alt_text>Dossier — numéro d&#39;exemple</cover_image_alt_text>',
  '      <embed encoding="base64"></embed>',
  '    </cover>',
  '  </covers>',
  '  <issue_galleys xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://pkp.sfu.ca native.xsd"/>',
  '  <articles xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://pkp.sfu.ca native.xsd">',
  '    <article xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" locale="fr" date_submitted="2026-08-21" status="3" submission_progress="" current_publication_id="9" stage="production">',
  '      <id type="internal" advice="ignore">2</id>',
  '      <submission_file xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" id="3" created_at="2026-08-21" file_id="4" stage="proof" updated_at="2026-08-21" viewable="false" genre="Texte de l&#39;article" uploader="redaction" xsi:schemaLocation="http://pkp.sfu.ca native.xsd">',
  '        <name locale="fr">01-edito.docx</name>',
  '        <file id="4" filesize="13" extension="docx">',
  '          <embed encoding="base64"></embed>',
  '        </file>',
  '      </submission_file>',
  '      <submission_file xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" id="5" created_at="2026-08-21" file_id="6" stage="proof" updated_at="2026-08-21" viewable="false" genre="Texte de l&#39;article" uploader="redaction" xsi:schemaLocation="http://pkp.sfu.ca native.xsd">',
  '        <name locale="fr">01-edito.html</name>',
  '        <file id="6" filesize="13" extension="html">',
  '          <embed encoding="base64"></embed>',
  '        </file>',
  '      </submission_file>',
  '      <submission_file xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" id="7" created_at="2026-08-21" file_id="8" stage="proof" updated_at="2026-08-21" viewable="false" genre="Texte de l&#39;article" uploader="redaction" xsi:schemaLocation="http://pkp.sfu.ca native.xsd">',
  '        <name locale="fr">01-edito.pdf</name>',
  '        <file id="8" filesize="12" extension="pdf">',
  '          <embed encoding="base64"></embed>',
  '        </file>',
  '      </submission_file>',
  '      <publication xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" version="1" status="3" primary_contact_id="10" url_path="" seq="1" access_status="0" date_published="2026-09-08" section_ref="ED" xsi:schemaLocation="http://pkp.sfu.ca native.xsd">',
  '        <id type="internal" advice="ignore">9</id>',
  '        <id type="doi" advice="update">10.57161/r2026-02-00</id>',
  '        <title locale="de">Editorial</title>',
  '        <title locale="fr">Éditorial</title>',
  '        <licenseUrl>https://creativecommons.org/licenses/by/4.0</licenseUrl>',
  '        <copyrightHolder locale="fr">Claire Rossi</copyrightHolder>',
  '        <copyrightYear>2026</copyrightYear>',
  '        <authors xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://pkp.sfu.ca native.xsd">',
  '          <author include_in_browse="true" user_group_ref="Auteur" seq="0" id="10">',
  '            <givenname locale="fr">Claire</givenname>',
  '            <familyname locale="fr">Rossi</familyname>',
  '          </author>',
  '        </authors>',
  '        <article_galley xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" locale="fr" approved="false" xsi:schemaLocation="http://pkp.sfu.ca native.xsd">',
  '          <id type="internal" advice="ignore">11</id>',
  '          <name locale="fr">DOCX</name>',
  '          <seq>0</seq>',
  '          <submission_file_ref id="3"/>',
  '        </article_galley>',
  '        <article_galley xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" locale="fr" approved="false" xsi:schemaLocation="http://pkp.sfu.ca native.xsd">',
  '          <id type="internal" advice="ignore">12</id>',
  '          <name locale="fr">HTML</name>',
  '          <seq>0</seq>',
  '          <submission_file_ref id="5"/>',
  '        </article_galley>',
  '        <article_galley xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" locale="fr" approved="false" xsi:schemaLocation="http://pkp.sfu.ca native.xsd">',
  '          <id type="internal" advice="ignore">13</id>',
  '          <name locale="fr">PDF</name>',
  '          <seq>0</seq>',
  '          <submission_file_ref id="7"/>',
  '        </article_galley>',
  '      </publication>',
  '    </article>',
  '    <article xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" locale="fr" date_submitted="2026-08-21" status="3" submission_progress="" current_publication_id="21" stage="production">',
  '      <id type="internal" advice="ignore">14</id>',
  '      <submission_file xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" id="15" created_at="2026-08-21" file_id="16" stage="proof" updated_at="2026-08-21" viewable="false" genre="Texte de l&#39;article" uploader="redaction" xsi:schemaLocation="http://pkp.sfu.ca native.xsd">',
  '        <name locale="fr">02-observation.docx</name>',
  '        <file id="16" filesize="19" extension="docx">',
  '          <embed encoding="base64"></embed>',
  '        </file>',
  '      </submission_file>',
  '      <submission_file xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" id="17" created_at="2026-08-21" file_id="18" stage="proof" updated_at="2026-08-21" viewable="false" genre="Texte de l&#39;article" uploader="redaction" xsi:schemaLocation="http://pkp.sfu.ca native.xsd">',
  '        <name locale="fr">02-observation.html</name>',
  '        <file id="18" filesize="19" extension="html">',
  '          <embed encoding="base64"></embed>',
  '        </file>',
  '      </submission_file>',
  '      <submission_file xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" id="19" created_at="2026-08-21" file_id="20" stage="proof" updated_at="2026-08-21" viewable="false" genre="Texte de l&#39;article" uploader="redaction" xsi:schemaLocation="http://pkp.sfu.ca native.xsd">',
  '        <name locale="fr">02-observation.pdf</name>',
  '        <file id="20" filesize="18" extension="pdf">',
  '          <embed encoding="base64"></embed>',
  '        </file>',
  '      </submission_file>',
  '      <publication xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" version="1" status="3" primary_contact_id="22" url_path="" seq="1" access_status="0" date_published="2026-09-08" section_ref="DT" xsi:schemaLocation="http://pkp.sfu.ca native.xsd">',
  '        <id type="internal" advice="ignore">21</id>',
  '        <id type="doi" advice="update">10.57161/r2026-02-01</id>',
  '        <title locale="de">Beobachtung und Anpassung</title>',
  '        <title locale="fr">Observation et adaptation</title>',
  '        <subtitle locale="de">Ein Untertitel</subtitle>',
  '        <subtitle locale="fr">Un sous-titre</subtitle>',
  '        <abstract locale="de">&lt;p&gt;Eine deutsche Zusammenfassung.&lt;/p&gt;</abstract>',
  '        <abstract locale="fr">&lt;p&gt;Un résumé français.&lt;/p&gt;</abstract>',
  '        <licenseUrl>https://creativecommons.org/licenses/by/4.0</licenseUrl>',
  '        <copyrightHolder locale="fr">Anne Dupont, Bruno Meyer</copyrightHolder>',
  '        <copyrightYear>2026</copyrightYear>',
  '        <keywords locale="de">',
  '          <keyword>',
  '            <name>Beobachtung</name>',
  '          </keyword>',
  '        </keywords>',
  '        <keywords locale="fr">',
  '          <keyword>',
  '            <name>observation</name>',
  '          </keyword>',
  '        </keywords>',
  '        <authors xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://pkp.sfu.ca native.xsd">',
  '          <author include_in_browse="true" user_group_ref="Auteur" seq="0" id="22">',
  '            <givenname locale="fr">Anne</givenname>',
  '            <familyname locale="fr">Dupont</familyname>',
  '            <affiliation>',
  '              <name locale="fr">HEP Vaud</name>',
  '            </affiliation>',
  '            <email>anne.dupont@example.ch</email>',
  '            <orcid>https://orcid.org/0000-0002-1825-0097</orcid>',
  '          </author>',
  '          <author include_in_browse="true" user_group_ref="Auteur" seq="1" id="23">',
  '            <givenname locale="fr">Bruno</givenname>',
  '            <familyname locale="fr">Meyer</familyname>',
  '            <affiliation>',
  '              <name locale="fr">SZH/CSPS</name>',
  '            </affiliation>',
  '          </author>',
  '        </authors>',
  '        <article_galley xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" locale="fr" approved="false" xsi:schemaLocation="http://pkp.sfu.ca native.xsd">',
  '          <id type="internal" advice="ignore">24</id>',
  '          <name locale="fr">DOCX</name>',
  '          <seq>0</seq>',
  '          <submission_file_ref id="15"/>',
  '        </article_galley>',
  '        <article_galley xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" locale="fr" approved="false" xsi:schemaLocation="http://pkp.sfu.ca native.xsd">',
  '          <id type="internal" advice="ignore">25</id>',
  '          <name locale="fr">HTML</name>',
  '          <seq>0</seq>',
  '          <submission_file_ref id="17"/>',
  '        </article_galley>',
  '        <article_galley xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" locale="fr" approved="false" xsi:schemaLocation="http://pkp.sfu.ca native.xsd">',
  '          <id type="internal" advice="ignore">26</id>',
  '          <name locale="fr">PDF</name>',
  '          <seq>0</seq>',
  '          <submission_file_ref id="19"/>',
  '        </article_galley>',
  '        <citations>',
  '          <citation>Shaw, A., Bertrand, C., &amp; Muller, D. (2023). Enseigner autrement. Editions SZH/CSPS.</citation>',
  '          <citation>Zielinski, M. (2021). Adapter le curriculum. Revue suisse de pédagogie spécialisée, 11(2), 14-22. https://doi.org/10.57161/r2021-02-03</citation>',
  '        </citations>',
  '      </publication>',
  '    </article>',
  '  </articles>',
  '</issue>',
  ''
].join(LF);

// Les rubriques de la Zeitschrift ne partagent avec celles de la Revue que la clé
// interne : c'est tout ce bloc qui était faux six fois.
const REFERENCE_SECTIONS_ZEITSCHRIFT = [
  '  <sections>',
  '    <section ref="Ed" seq="1" editor_restricted="0" meta_indexed="1" meta_reviewed="0" abstracts_not_required="1" hide_title="0" hide_author="0" abstract_word_count="0">',
  '      <id type="internal" advice="ignore">16</id>',
  '      <abbrev locale="de">Ed</abbrev>',
  '      <title locale="de">Editorial</title>',
  '    </section>',
  '    <section ref="TS" seq="3" editor_restricted="0" meta_indexed="1" meta_reviewed="0" abstracts_not_required="0" hide_title="0" hide_author="0" abstract_word_count="0">',
  '      <id type="internal" advice="ignore">5</id>',
  '      <abbrev locale="de">TS</abbrev>',
  '      <title locale="de">Themenschwerpunkt</title>',
  '    </section>',
  '  </sections>'
].join(LF);

// ---- Les rubriques réelles des deux revues ------------------------------------------

// Relevées sur l'instance, rubrique par rubrique, dans l'ordre de la base. Deux pièges
// qu'aucune règle ne devine : « Ed » en allemand mais « ED » en français, et « Tribune
// Libre » avec une majuscule côté français quand la revue allemande écrit « Tribune
// libre » — le libellé de cette rubrique est français des deux côtés.
const RUBRIQUES_RELEVEES = [
  { cle: 'ED', fr: ['ED', 'Éditorial'], de: ['Ed', 'Editorial'] },
  { cle: 'ART', fr: ['ART', 'Articles'], de: ['ART', 'Artikel'] },
  { cle: 'DT', fr: ['DT', 'Dossier thématique'], de: ['TS', 'Themenschwerpunkt'] },
  { cle: 'VA', fr: ['VA', 'Varia'], de: ['FB', 'Freie Beiträge'] },
  { cle: 'TL', fr: ['TL', 'Tribune Libre'], de: ['TL', 'Tribune libre'] },
  { cle: 'DC', fr: ['DC', 'Documentation'], de: ['DK', 'Dokumentation'] },
  // Absentes de ListSets : l'abréviation n'a pas pu être relevée, elle reste vide.
  { cle: 'PODCAST', fr: ['', ''], de: ['SZH-Podcast', 'SZH-Podcast'] },
  { cle: 'LS', fr: ['', ''], de: ['LS', 'Leichte Sprache'] },
  { cle: 'AN', fr: ['', 'Annonces'], de: ['', 'Inserate'] }
];

test('rubriques OJS : la table du code est celle de l’instance, rubrique par rubrique', () => {
  const table = {};
  for (const r of ojs.RUBRIQUES_DEFAUT) { table[r.cle] = r; }
  assert.deepStrictEqual(Object.keys(table).sort(), RUBRIQUES_RELEVEEES_CLES().sort(),
    'la table du code et le relevé ne portent pas les mêmes rubriques');
  for (const attendu of RUBRIQUES_RELEVEES) {
    const r = table[attendu.cle];
    for (const loc of ['fr', 'de']) {
      assert.strictEqual(r.abbrev[loc], attendu[loc][0],
        'abréviation ' + loc.toUpperCase() + ' de la rubrique ' + attendu.cle);
      assert.strictEqual(r.titre[loc], attendu[loc][1],
        'titre ' + loc.toUpperCase() + ' de la rubrique ' + attendu.cle);
    }
  }
  // Le trou en 2 est « ART », rétro-catalogue de migration : les seq suivent la base.
  assert.deepStrictEqual(ojs.RUBRIQUES_DEFAUT.slice(0, 6).map((r) => r.seq), [1, 2, 3, 4, 5, 6]);
});

function RUBRIQUES_RELEVEEES_CLES() { return RUBRIQUES_RELEVEES.map((r) => r.cle); }

// ---- La référence -------------------------------------------------------------------

test('export OJS : un numéro de la Revue, caractère par caractère', () => {
  const racine = monter({ produit: 'revue', ausgabe: { date: '2026-09-08' } });
  const sortie = exporter(racine, configComplete());
  assert.strictEqual(path.basename(sortie.chemin), 'native-20260821-093000-44-2.xml');
  assert.strictEqual(sortie.xml, REFERENCE_REVUE);
});

test('export OJS : les rubriques d’un numéro de la Zeitschrift portent les intitulés allemands', () => {
  const racine = monter({ produit: 'zeitschrift', ausgabe: { date: '2026-09-08' } });
  const sortie = exporter(racine, configComplete());
  assert.ok(sortie.xml.indexOf(REFERENCE_SECTIONS_ZEITSCHRIFT) !== -1,
    'bloc <sections> inattendu :\n' + sortie.xml.slice(sortie.xml.indexOf('  <sections>'),
      sortie.xml.indexOf('</sections>') + 12));
  // section_ref est résolu par OJS sur la seule abréviation : la clé interne « DT » n'y a
  // rien à faire, c'est « TS » qui range l'article dans le Themenschwerpunkt.
  assert.ok(sortie.xml.indexOf('section_ref="TS"') !== -1, 'section_ref allemand absent');
  assert.strictEqual(sortie.xml.indexOf('section_ref="DT"'), -1, 'la clé interne part dans le XML');
  // Genre, groupe et compte sont ceux de la Zeitschrift, pas ceux de la Revue.
  assert.ok(sortie.xml.indexOf('genre="Artikeltext" uploader="redaktion"') !== -1);
  assert.ok(sortie.xml.indexOf('user_group_ref="Autor/in"') !== -1);
  assert.strictEqual(sortie.xml.indexOf('Auteur'), -1, 'groupe d’auteur français dans la Zeitschrift');
});

// ---- La date de publication ---------------------------------------------------------

test('date de publication : le gabarit n’en livre aucune, et l’export l’exige', () => {
  const gabarit = fs.readFileSync(path.join(RACINE, 'revue-template', 'ausgabe.yaml'), 'utf8');
  // Le gabarit ne porte plus de date d'exemple : plausible, elle partirait telle quelle
  // dans un numéro qui n'est pas le sien et désarmerait le refus ci-dessous. La date de
  // publication ne s'invente pas à la création — voir test/js/date-numero.test.js.
  assert.strictEqual(String(yaml.analyserAusgabe(gabarit).date || ''), '',
    'revue-template/ausgabe.yaml : date de publication d’exemple revenue');
  // Monté sur le gabarit tel quel, le numéro est donc refusé.
  const e = refuse(monter({}), configComplete());
  assert.match(e.message, /AAAA-MM-JJ/);
  assert.match(e.message, /Métadonnées du numéro/);
  // Saisie, la date part dans l'XML aux deux endroits où OJS la lit.
  const date = '2026-09-08';
  const sortie = exporter(monter({ ausgabe: { date: date } }), configComplete());
  assert.ok(sortie.xml.indexOf('<date_published>' + date + '</date_published>') !== -1,
    'date du numéro absente');
  assert.ok(sortie.xml.indexOf('date_published="' + date + '"') !== -1,
    'date absente des publications');
});

test('date de publication : une année seule arrête l’export et dit où la saisir', () => {
  const racine = monter({ ausgabe: { date: '2026' } });
  const e = refuse(racine, configComplete());
  assert.match(e.message, /2026/);
  assert.match(e.message, /AAAA-MM-JJ/);
  assert.match(e.message, /Métadonnées du numéro/);
  // Rien n'a été écrit : un export refusé ne laisse pas de fichier à moitié fait.
  assert.deepStrictEqual(fs.readdirSync(racine).filter((f) => f.indexOf('.xml') !== -1), []);
});

// ---- La configuration ---------------------------------------------------------------

test('configuration : un champ obligatoire vide arrête l’export, en français et en allemand', () => {
  const racine = monter({ produit: 'zeitschrift' });
  // Aucune configuration de poste : le côté allemand n'a jamais été relevé.
  const fr = refuse(racine, {});
  assert.ok(fr.szhConfigOjs === true, 'l’erreur ne mène pas au panneau de configuration');
  assert.match(fr.message, /Schweizerische Zeitschrift für Heilpädagogik/);
  assert.match(fr.message, /Genre de fichier/);
  assert.match(fr.message, /Composants de la soumission/);
  assert.match(fr.message, /Groupe d’auteur/);
  assert.match(fr.message, /Rôles/);
  assert.match(fr.message, /Compte de téléversement/);
  assert.match(fr.message, /Réglages SZH/);

  process.env.SZH_LANGUE = 'de';
  try {
    const de = refuse(racine, {});
    assert.match(de.message, /Dateigattung/);
    assert.match(de.message, /Bestandteile der Einreichung/);
    assert.match(de.message, /Autorengruppe/);
    assert.match(de.message, /Rollen/);
    assert.match(de.message, /Konto für den Upload/);
    assert.match(de.message, /SZH-Einstellungen/);
    assert.strictEqual(de.message.indexOf('ß'), -1, 'eszett dans un message allemand');
  } finally { process.env.SZH_LANGUE = 'fr'; }
});

test('configuration : une rubrique sans abréviation dans la revue visée arrête l’export', () => {
  // « Annonces / Inserate » existe dans tous les sommaires mais son abréviation n'a
  // jamais pu être relevée : y ranger un article doit s'arrêter là.
  const config = Object.assign(configComplete(), { types: { documentation: 'AN' } });
  const racine = monter({
    articles: [{ slug: '01-annonce', fiche: fiche(['type: documentation', 'lang: fr',
      'title:', '  fr: "Annonce"', 'author:', '- nom: "SZH/CSPS"']), texte: 'Texte.' + LF }]
  });
  const e = refuse(racine, config);
  assert.ok(e.szhConfigOjs === true);
  assert.match(e.message, /Abréviation de la rubrique « Annonces »/);
  assert.match(e.message, /Rubriques/);
});

test('configuration : ce que le panneau enregistre est ce que l’export emploie', () => {
  // Le trajet complet : le panneau envoie sa table, l'hôte l'écrit dans le config.json du
  // poste, et l'export la relit. Une rubrique ajoutée avec son intitulé exact, désignée
  // par un type d'article, doit se retrouver dans le XML.
  const depuisPanneau = {
    revues: {
      fr: { genreFichier: 'Volltext', groupeAuteur: 'Auteur', televerseur: 'redaction', paysAuteur: 'CH' },
      de: { genreFichier: 'Artikeltext', groupeAuteur: 'Autor/in', televerseur: 'redaktion', paysAuteur: 'CH' }
    },
    rubriques: [{ cle: 'AN', abbrev: { fr: 'ANN', de: 'INS' }, titre: { fr: 'Annonces', de: 'Inserate' } }],
    types: { documentation: 'AN' }
  };
  try {
    assert.strictEqual(ojs.ecrireConfigOjs(depuisPanneau), null, 'écriture refusée');
    const relu = ojs.configOjs();
    assert.strictEqual(relu.revues.fr.genreFichier, 'Volltext');
    assert.strictEqual(relu.revues.fr.paysAuteur, 'CH');
    // Les rubriques non citées survivent : la table n'est pas remplacée, elle est fusionnée.
    assert.strictEqual(relu.rubriques.length, ojs.RUBRIQUES_DEFAUT.length);
    assert.strictEqual(relu.types.documentation, 'AN');

    const racine = monter({
      ausgabe: { date: '2026-09-08' },
      articles: [{ slug: '01-annonce', fiche: fiche(['type: documentation', 'lang: fr',
        'title:', '  fr: "Annonce"', 'author:', '- nom: "SZH/CSPS"']), texte: 'Texte.' + LF }]
    });
    // Sans options.config : c'est bien le fichier du poste qui est lu.
    const resultat = ojs.genererExportOjs(racine, { maintenant: MAINTENANT });
    const xml = fs.readFileSync(resultat.chemin, 'utf8');
    assert.ok(xml.indexOf('<abbrev locale="fr">ANN</abbrev>') !== -1, 'abréviation ajoutée absente');
    assert.ok(xml.indexOf('<title locale="fr">Annonces</title>') !== -1, 'titre ajouté absent');
    assert.ok(xml.indexOf('section_ref="ANN"') !== -1, 'l’article n’est pas rangé dans la rubrique ajoutée');
    assert.ok(xml.indexOf('genre="Volltext"') !== -1, 'genre du poste non employé');
    assert.ok(xml.indexOf('<country>CH</country>') !== -1, 'pays du poste non employé');
  } finally {
    try { fs.unlinkSync(CONFIG_ESSAI); } catch (e) { /* jamais écrit */ }
  }
});

test('configuration : un champ vidé dans le panneau ne retombe pas sur le défaut', () => {
  const config = { revues: { fr: { genreFichier: '', groupeAuteur: 'Auteur', televerseur: 'redaction' } } };
  const e = refuse(monter({}), config);
  assert.match(e.message, /Genre de fichier/);
  assert.match(e.message, /Revue suisse de pédagogie spécialisée/);
});

// ---- ORCID, DOI, références ---------------------------------------------------------

test('ORCID : présent pour qui en a un, jamais de balise vide', () => {
  const sortie = exporter(monter({ ausgabe: { date: '2026-09-08' } }), configComplete());
  assert.strictEqual((sortie.xml.match(/<orcid>/g) || []).length, 1,
    'un seul auteur porte un ORCID');
  assert.ok(sortie.xml.indexOf('<orcid>https://orcid.org/0000-0002-1825-0097</orcid>') !== -1);
  assert.strictEqual(sortie.xml.indexOf('<orcid></orcid>'), -1, 'balise ORCID vide');
  // L'identifiant nu de la fiche devient l'URL canonique, comme dans le PDF.
  assert.strictEqual(ojs.orcidCanonique('0000-0002-1825-009x'), 'https://orcid.org/0000-0002-1825-009X');
  assert.strictEqual(ojs.orcidCanonique('https://orcid.org/0000-0002-1825-0097'),
    'https://orcid.org/0000-0002-1825-0097');
  assert.strictEqual(ojs.orcidCanonique('à saisir'), '', 'une valeur illisible doit rester vide');
});

test('ORCID : une valeur illisible est signalée, pas envoyée', () => {
  const racine = monter({
    ausgabe: { date: '2026-09-08' },
    articles: [{ slug: '01-edito', fiche: fiche(['type: editorial', 'lang: fr',
      'doi: "10.57161/r2026-02-00"', 'title:', '  fr: "Éditorial"',
      'author:', '- prenom: "Claire"', '  nom: "Rossi"', '  orcid: "0000-0002"']),
      texte: 'Un mot.' + LF }]
  });
  const sortie = exporter(racine, configComplete());
  assert.strictEqual(sortie.xml.indexOf('<orcid>'), -1);
  assert.ok(sortie.avertissements.some((a) => a.indexOf('ORCID') !== -1 && a.indexOf('0000-0002') !== -1),
    'ORCID illisible non signalé : ' + sortie.avertissements.join(' | '));
});

test('DOI : un article sans DOI est refusé, sauf dans une rubrique qui n’en reçoit pas', () => {
  const sansDoi = ['type: article', 'lang: fr', 'title:', '  fr: "Sans DOI"',
    'resume:', '  fr: "Un résumé."', 'author:', '- nom: "SZH/CSPS"'];
  const e = refuse(monter({
    ausgabe: { date: '2026-09-08' },
    articles: [{ slug: '01-sans-doi', fiche: fiche(sansDoi), texte: 'Texte.' + LF }]
  }), configComplete());
  assert.match(e.message, /DOI absent/);
  assert.match(e.message, /Crossref/);

  // La Documentation ne reçoit pas de DOI : l'export passe, avec un simple avertissement.
  const doc = ['type: documentation', 'lang: fr', 'title:', '  fr: "Documentation"',
    'author:', '- nom: "SZH/CSPS"'];
  const sortie = exporter(monter({
    ausgabe: { date: '2026-09-08' },
    articles: [{ slug: '01-doc', fiche: fiche(doc), texte: 'Texte.' + LF }]
  }), configComplete());
  assert.ok(sortie.xml.indexOf('section_ref="DC"') !== -1);
  assert.strictEqual(sortie.xml.indexOf('type="doi"'), -1);
  assert.ok(sortie.avertissements.some((a) => a.indexOf('normal pour cette rubrique') !== -1));
});

test('DOI : une forme inattendue pour la revue est signalée', () => {
  // La lettre distingue les deux revues : un « z » dans la Revue passerait inaperçu.
  const racine = monter({
    produit: 'revue', ausgabe: { date: '2026-09-08' },
    articles: [{ slug: '01-edito', fiche: ficheEditorial('fr', '10.57161/z2026-02-00'),
      texte: 'Un mot.' + LF }]
  });
  const sortie = exporter(racine, configComplete());
  assert.ok(sortie.avertissements.some((a) => a.indexOf('10.57161/z2026-02-00') !== -1
    && a.indexOf('10.57161/r2026-03-05') !== -1),
    'DOI de la mauvaise revue non signalé : ' + sortie.avertissements.join(' | '));
});

// Le fichier de bibliographie que l'import détache : les références seules, sans titre.
// C'est la source de <citations> depuis que la chaîne ne devine plus où la liste commence.
const BIBLIO_DETACHEE = [
  'Shaw, A., Bertrand, C., & Muller, D. (2023). *Enseigner autrement*. Editions SZH/CSPS.',
  '',
  'Zielinski, M. (2021). Adapter le curriculum. *Revue suisse de pédagogie spécialisée*,',
  '11(2), 14-22. https://doi.org/10.57161/r2021-02-03',
  ''
].join(LF);

test('références : les <citations> viennent du fichier de bibliographie', () => {
  const racine = monter({
    ausgabe: { date: '2026-09-08' },
    articles: [{ slug: '02-observation', fiche: ficheArticle('fr', '10.57161/r2026-02-01'),
      // Le corps ne porte plus la liste : il porte la référence que la compilation résout.
      texte: ['# Titre', '', 'Un appel (Shaw et al., 2023) et un autre (Zielinski, 2021).',
        '', '::: {.szh-biblio src="02-observation.biblio.md"}', ':::', ''].join(LF),
      biblio: BIBLIO_DETACHEE }]
  });
  const sortie = exporter(racine, configComplete());
  const bloc = sortie.xml.slice(sortie.xml.indexOf('<citations>'), sortie.xml.indexOf('</citations>'));
  const lignes = bloc.split(LF).filter((l) => l.indexOf('<citation>') !== -1);
  assert.strictEqual(lignes.length, 2, 'deux références attendues :\n' + bloc);
  // Une entrée coupée sur deux lignes reste une seule référence.
  assert.ok(lignes[1].indexOf('11(2), 14-22') !== -1, 'suite de référence perdue : ' + lignes[1]);
  // Texte brut : ni italiques ni lien markdown, et l'esperluette est échappée pour le XML.
  assert.strictEqual(bloc.indexOf('*'), -1, 'italiques du markdown laissées dans la référence');
  assert.ok(lignes[0].indexOf('&amp;') !== -1, 'esperluette non échappée');
  assert.ok(lignes[0].indexOf('Enseigner autrement') !== -1);
  // Le fichier suffit : rien à deviner, donc rien à signaler.
  assert.ok(!sortie.avertissements.some((a) => a.indexOf('encore dans le texte') !== -1),
    'un article à bibliographie détachée ne doit rien avoir à signaler : '
    + sortie.avertissements.join(' | '));
});

test('références : sans fichier, le corps sert de repli et l’export le dit', () => {
  // Un article importé avant que la bibliographie devienne un fichier : la liste est encore
  // dans le .md, sous son titre. On l'envoie quand même — mieux vaut des références devinées
  // que pas de références — mais le rédacteur doit savoir qu'un réimport les fiabilise.
  const sortie = exporter(monter({ ausgabe: { date: '2026-09-08' } }), configComplete());
  const bloc = sortie.xml.slice(sortie.xml.indexOf('<citations>'), sortie.xml.indexOf('</citations>'));
  assert.strictEqual(bloc.split(LF).filter((l) => l.indexOf('<citation>') !== -1).length, 2);
  assert.ok(sortie.avertissements.some((a) => a.indexOf('encore dans le texte') !== -1),
    'le repli sur le corps n’est pas signalé : ' + sortie.avertissements.join(' | '));
});

test('références : un article sans liste de références n’a pas de <citations> vide', () => {
  const racine = monter({
    ausgabe: { date: '2026-09-08' },
    articles: [{ slug: '01-observation', fiche: ficheArticle('fr', '10.57161/r2026-02-01'),
      texte: '# Titre' + LF + LF + 'Un paragraphe sans bibliographie.' + LF }]
  });
  const sortie = exporter(racine, configComplete());
  assert.strictEqual(sortie.xml.indexOf('<citations>'), -1);
  assert.ok(sortie.avertissements.some((a) => a.indexOf('<citations> omis') !== -1),
    'absence de références non signalée : ' + sortie.avertissements.join(' | '));
});

// ---- La langue de l'article ----------------------------------------------------------

test('langue de l’article : le titre est exigé dans la langue déclarée', () => {
  const sansTitreAllemand = ['type: article', 'lang: de', 'doi: "10.57161/r2026-02-01"',
    'title:', '  fr: "Titre français"', 'resume:', '  fr: "Un résumé."',
    'author:', '- nom: "SZH/CSPS"'];
  const e = refuse(monter({
    ausgabe: { date: '2026-09-08' },
    articles: [{ slug: '01-observation', fiche: fiche(sansTitreAllemand), texte: 'Texte.' + LF }]
  }), configComplete());
  assert.match(e.message, /le titre manque en DE/);
  assert.match(e.message, /le résumé manque en DE/);
});

test('langue de l’article : une langue autre que celle de la revue est signalée', () => {
  const autreLangue = ['type: editorial', 'lang: de', 'doi: "10.57161/r2026-02-00"',
    'title:', '  de: "Editorial"', 'author:', '- nom: "SZH/CSPS"'];
  const sortie = exporter(monter({
    ausgabe: { date: '2026-09-08' },
    articles: [{ slug: '01-edito', fiche: fiche(autreLangue), texte: 'Un mot.' + LF }]
  }), configComplete());
  // La soumission garde la locale de la revue : une revue OJS n'en a qu'une, et une
  // soumission déclarée dans une autre serait refusée à l'import.
  assert.ok(sortie.xml.indexOf('<article xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" locale="fr"') !== -1);
  assert.ok(sortie.avertissements.some((a) => a.indexOf('(DE)') !== -1 && a.indexOf('(FR)') !== -1),
    'divergence de langue non signalée : ' + sortie.avertissements.join(' | '));
});

// ---- Les libellés du panneau --------------------------------------------------------

// Le panneau réellement exécuté : sans cela, une erreur au rendu laisserait le bloc vide
// sous un titre, et rien ne le dirait — c'est le défaut que webviews.test.js garde ailleurs.
test('panneau des réglages : la table des rubriques et les champs par revue sont rendus', () => {
  const page = ouvrir({
    racine: RACINE, page: 'settings', cssPartage: ['_design.css'],
    txt: libellesHote(RACINE, ['REGL_LIBELLES'])
  });
  assert.deepStrictEqual(page.messages.map((m) => m.type), ['pret'], 'la page ne s’annonce pas');
  page.envoyer({ type: 'valeurs', valeurs: { langue: 'fr' }, ojs: messagePanneau() });
  const bloc = page.parId.ojs;
  const nRubriques = ojs.RUBRIQUES_DEFAUT.length;
  assert.strictEqual(bloc.querySelectorAll('[data-champ]').length,
    ojs.CHAMPS_REVUE.length * ojs.LOCALES_REVUE.length, 'champs par revue absents');
  assert.strictEqual(bloc.querySelectorAll('[data-rubrique-cle]').length, nRubriques);
  assert.strictEqual(bloc.querySelectorAll('[data-rubrique-abbrev]').length,
    nRubriques * ojs.LOCALES_REVUE.length);
  assert.strictEqual(bloc.querySelectorAll('[data-rubrique-titre]').length,
    nRubriques * ojs.LOCALES_REVUE.length);
  assert.strictEqual(bloc.querySelectorAll('select').length, yaml.TYPES_ARTICLE.length,
    'un choix de rubrique par type d’article');
  // Les intitulés exacts sont éditables, y compris les deux qui se lisent de travers.
  const valeurs = bloc.querySelectorAll('input').map((e) => e.value);
  for (const attendu of ['Themenschwerpunkt', 'Tribune Libre', 'Tribune libre', 'Freie Beiträge',
    'Inserate', 'Ed', 'ED']) {
    assert.ok(valeurs.indexOf(attendu) !== -1, 'intitulé absent du panneau : ' + attendu);
  }
  // Une case vide se voit : c'est une valeur à relever, pas une valeur.
  assert.ok(bloc.querySelectorAll('input.vide').length >= 4, 'champs vides non marqués');
});

test('panneau des réglages : chaque libellé de l’export OJS existe dans les deux langues', () => {
  const cles = [];
  for (const champ of ojs.CHAMPS_REVUE) { cles.push(champ.libelle, champ.ou); }
  for (const loc of ojs.LOCALES_REVUE) { cles.push('ojs.revue.' + loc); }
  cles.push('ojs.titre', 'ojs.intro', 'ojs.revues', 'ojs.vide', 'ojs.rubriques',
    'ojs.rubriques.aide', 'ojs.col.cle', 'ojs.col.abbrev', 'ojs.col.titre', 'ojs.col.resume',
    'ojs.col.doi', 'ojs.ajouter', 'ojs.cle.nouvelle', 'ojs.types', 'ojs.types.aide',
    'ojs.err.ecriture', 'exportOjs.configurer');
  for (const cle of cles) {
    for (const langue of ['fr', 'de']) {
      const texte = i18n.TEXTES_COCKPIT[langue][cle];
      assert.ok(texte && texte !== cle, 'libellé ' + langue + ' absent : ' + cle);
    }
    assert.strictEqual(i18n.TEXTES_COCKPIT.de[cle].indexOf('ß'), -1, 'eszett dans : ' + cle);
  }
});
