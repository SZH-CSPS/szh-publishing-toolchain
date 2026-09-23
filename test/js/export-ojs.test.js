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
const { revueDEssai, activerHote } = require('./hote-factice');
const yaml = require(path.join(COCKPIT, 'lib', 'yaml.js'));
const i18n = require(path.join(COCKPIT, 'lib', 'i18n.js'));

// Ce que l'hôte envoie RÉELLEMENT au panneau des réglages (extension.js:donneesOjs),
// plutôt qu'une copie recopiée à la main qui divergerait dans le dos de ce test le jour
// où donneesOjs() change : un hôte factice activé (une seule fois, mémoïsé — le crochet
// Module._load ne se défait pas, voir hote-factice.js), la commande qui ouvre le
// panneau, puis le message qu'il a réellement posté sur son canal.
let _panneauOjs = null;
function messagePanneau() {
  if (_panneauOjs) { return _panneauOjs; }
  const HOTE = activerHote(revueDEssai());
  HOTE.executer('szh.reglages');
  const panneau = HOTE.panneauDeType('szhReglages');
  // onDidReceiveMessage n'est déclenché qu'à réception du « pret » envoyé par la page ;
  // sa seule branche pour ce message pose le postMessage sans jamais attendre — l'appel
  // est donc déjà résolu au retour, sans qu'il faille en attendre la promesse ici.
  panneau._recepteur({ type: 'pret' });
  const valeurs = panneau.messages.find((m) => m.type === 'valeurs');
  _panneauOjs = valeurs.ojs;
  return _panneauOjs;
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

// Un article du dossier : deux auteurs dont un seul porte un ORCID, un résumé et des
// mots-clés dans les deux langues.
//
// `doi` est FACULTATIF, et absent par défaut : le DOI ne se saisit plus dans la fiche, il se
// calcule d'après la place de l'article dans le numéro. Un doi posé dans la fiche est un DOI
// MANUEL (l'échappatoire du formulaire) : il part à la place du calculé, et la divergence se
// dit. Les contrôles qui en posent un sont ceux de cette échappatoire, et eux seuls.
function ficheArticle(langue, doi) {
  return fiche([
    'type: article',
    'lang: ' + langue
  ].concat(doi ? ['doi: "' + doi + '"'] : []).concat([
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
  ]));
}

function ficheEditorial(langue, doi) {
  return fiche([
    'type: editorial',
    'lang: ' + langue
  ].concat(doi ? ['doi: "' + doi + '"'] : []).concat([
    'title:',
    '  fr: "Éditorial"',
    '  de: "Editorial"',
    'author:',
    '- prenom: "Claire"',
    '  nom: "Rossi"'
  ]));
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
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-ojs-'));
  const gabarit = fs.readFileSync(path.join(RACINE, 'revue-template', 'ausgabe.yaml'), 'utf8');
  const valeurs = Object.assign({ revue: produit, lang: langue }, opts.ausgabe || {});
  fs.writeFileSync(path.join(racine, 'ausgabe.yaml'), yaml.serialiserAusgabe(gabarit, valeurs));
  fs.writeFileSync(path.join(racine, 'couverture.jpg'), Buffer.from('JPEG'));

  // Aucun DOI dans les fiches : celui qui part est calculé du rang, et la référence ci-dessous
  // le prouve — le numéro d'essai est le 2 de 2026, l'éditorial ouvre donc à « 00 ».
  const articles = opts.articles || [
    { slug: '01-edito', fiche: ficheEditorial(langue), texte: '# Edito' + LF + LF + 'Un mot.' + LF },
    { slug: '02-observation', fiche: ficheArticle(langue), texte: TEXTE_ARTICLE }
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
//
// `pagination` est facultatif (undefined équivaut à l'option absente, voir
// intervallesPages()) : les contrôles déjà en place, écrits avant que l'option existe,
// continuent de l'appeler sur deux arguments sans rien changer à leur comportement.
function exporter(racine, config, pagination) {
  const resultat = ojs.genererExportOjs(racine, { maintenant: MAINTENANT, config: config, pagination: pagination });
  const xml = fs.readFileSync(resultat.chemin, 'utf8')
    .replace(/(<embed encoding="base64">)[^<]*/g, '$1');
  return { xml: xml, chemin: resultat.chemin, avertissements: resultat.avertissements };
}

function refuse(racine, config, pagination) {
  try {
    ojs.genererExportOjs(racine, { maintenant: MAINTENANT, config: config, pagination: pagination });
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
  '    <title locale="fr">Dossier – numéro d’exemple</title>',
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
  '      <cover_image_alt_text>Dossier – numéro d’exemple</cover_image_alt_text>',
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
  // Rien, sur le disque, ne porte les deux DOI de la référence : ni les fiches, ni les
  // métadonnées du numéro. Les <id type="doi"> qui suivent ne peuvent donc venir que du
  // calcul, et la référence prouve le calcul au lieu de recopier une saisie.
  for (const slug of ['01-edito', '02-observation']) {
    const f = fs.readFileSync(path.join(racine, 'articles', slug, slug + '.meta.yaml'), 'utf8');
    assert.strictEqual(f.indexOf('10.57161'), -1, 'la fiche de ' + slug + ' porte un DOI');
  }
  assert.strictEqual(fs.readFileSync(path.join(racine, 'ausgabe.yaml'), 'utf8').indexOf('10.57161'), -1);
  const sortie = exporter(racine, configComplete());
  // Le nom du fichier porte le volume et le nombre du numéro, tels qu'ils sont saisis : le
  // « 2 » y reste « 2 », alors que le DOI le complète à deux chiffres.
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

// Les points bloquants partaient concaténés dans le message d'une seule notification, avec
// des puces et des retours à la ligne que VSCodium écrase : le plus grave de l'application
// était son message le moins lisible. L'erreur les porte donc aussi en liste, pour que
// l'hôte les pose un par un dans « À corriger », chacun avec son bouton.
test('refus : l’erreur porte les points bloquants un par un, pas seulement en prose', () => {
  const racine = monter({ produit: 'revue' });
  const e = refuse(racine, {});
  assert.ok(Array.isArray(e.szhBloquants), 'l’erreur ne porte pas la liste des bloquants');
  assert.ok(e.szhBloquants.length >= 2,
    'un seul point listé : la liste n’est pas celle qui a servi au message');
  // Chaque point est une phrase à lui, sans puce ni retour à la ligne : c'est ce qui permet
  // d'en faire une carte.
  for (const point of e.szhBloquants) {
    assert.ok(point && point.length > 0, 'point vide dans la liste');
    assert.ok(point.indexOf('\n') === -1, 'un point porte encore un retour à la ligne : ' + point);
    assert.ok(point.indexOf('- ') !== 0, 'un point porte encore sa puce : ' + point);
  }
  // Et le message reste ce qu'il était : la notification n'est pas le seul chemin, mais
  // elle continue de dire pourquoi l'export n'est pas parti.
  for (const point of e.szhBloquants) {
    assert.ok(e.message.indexOf(point) !== -1,
      'un point de la liste manque au message : les deux chemins divergent');
  }
});

// ---- Les refus élémentaires : galley manquant, locale, type, numéro vide, couverture --

test('refus : un galley DOCX non produit nomme le fichier attendu, avec le message propre au Word', () => {
  const racine = monter({ ausgabe: { date: '2026-09-08' } });
  fs.unlinkSync(path.join(racine, 'out', '02-observation', '02-observation.docx'));
  const e = refuse(racine, configComplete());
  assert.match(e.message, /articles\/02-observation/, 'l’article en cause n’est pas nommé');
  assert.match(e.message, /out\/02-observation\/02-observation\.docx/, 'le fichier attendu n’est pas nommé');
  assert.match(e.message, /version Word/, 'le message n’est pas celui, spécifique, du DOCX manquant');
});

test('refus : un galley HTML ou PDF non produit nomme le fichier, avec le message générique', () => {
  const racine = monter({ ausgabe: { date: '2026-09-08' } });
  fs.unlinkSync(path.join(racine, 'out', '01-edito', '01-edito.html'));
  const e = refuse(racine, configComplete());
  assert.match(e.message, /articles\/01-edito/, 'l’article en cause n’est pas nommé');
  assert.match(e.message, /out\/01-edito\/01-edito\.html/, 'le fichier attendu n’est pas nommé');
  assert.match(e.message, /n’a pas encore été produit/, 'le message générique n’est pas celui attendu');
  assert.match(e.message, /Recompiler toute la revue/, 'le geste de retour n’est pas nommé');
});

test('refus : une locale hors des deux revues nomme la locale saisie et les deux connues', () => {
  const racine = monter({ ausgabe: { revue: '', lang: 'it', date: '2026-09-08' } });
  const e = refuse(racine, configComplete());
  // Espace insécable normale (U+00A0, pas une espace ordinaire) de part et d’autre du
  // guillemet : la typographie maison, pas une négligence — voir lib/i18n.js.
  assert.match(e.message, /« it »/, 'la locale saisie n’est pas nommée');
  assert.match(e.message, /fr, de/, 'les deux locales connues ne sont pas listées');
  assert.match(e.message, /Métadonnées du numéro/, 'le geste de retour n’est pas nommé');
});

test('refus : un type d’article inconnu du cockpit nomme le type et l’article', () => {
  // Le slug ne porte pas le mot « mystere » : la présence du type dans le message doit
  // venir de la VALEUR du type, pas d’un nom de dossier qui la contiendrait par coïncidence.
  const racine = monter({
    ausgabe: { date: '2026-09-08' },
    articles: [{ slug: '01-brouillon', fiche: fiche(['type: mystere', 'lang: fr',
      'title:', '  fr: "Sans rubrique"', 'author:', '- nom: "SZH/CSPS"']), texte: 'Texte.' + LF }]
  });
  const e = refuse(racine, configComplete());
  assert.match(e.message, /articles\/01-brouillon/, 'l’article en cause n’est pas nommé');
  assert.match(e.message, /mystere/, 'le type inconnu n’est pas nommé');
});

test('refus : une fiche sans type d’article le dit, distinct d’un type inconnu', () => {
  const racine = monter({
    ausgabe: { date: '2026-09-08' },
    articles: [{ slug: '01-sans-type', fiche: fiche(['lang: fr',
      'title:', '  fr: "Sans type"', 'author:', '- nom: "SZH/CSPS"']), texte: 'Texte.' + LF }]
  });
  const e = refuse(racine, configComplete());
  assert.match(e.message, /articles\/01-sans-type/, 'l’article en cause n’est pas nommé');
  assert.ok(e.message.indexOf('type d’article absent') !== -1,
    'le message n’est pas celui, distinct, du type absent : ' + e.message);
});

test('refus : un numéro sans aucun article le dit, et n’écrit rien', () => {
  const racine = monter({ ausgabe: { date: '2026-09-08' }, articles: [] });
  const e = refuse(racine, configComplete());
  assert.match(e.message, /aucun article/, 'l’absence totale d’article n’est pas dite');
  assert.deepStrictEqual(fs.readdirSync(racine).filter((f) => f.indexOf('.xml') !== -1), []);
});

test('avertissement : couverture absente, les trois noms acceptés sont nommés et <covers> est omis', () => {
  const racine = monter({ ausgabe: { date: '2026-09-08' } });
  fs.unlinkSync(path.join(racine, 'couverture.jpg'));
  const sortie = exporter(racine, configComplete());
  assert.ok(sortie.avertissements.some(
    (a) => a.indexOf('couverture.jpg, couverture.jpeg, couverture.png') !== -1),
    'avertissement de couverture absente non trouvé : ' + sortie.avertissements.join(' | '));
  assert.strictEqual(sortie.xml.indexOf('<covers>'), -1, '<covers> aurait dû être omis');
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
  assert.match(e.message, /Abréviation de la rubrique « Annonces »/);
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

// ---- ROR -------------------------------------------------------------------

test('ROR : canonique reconnaît les identifiants réels et les formes tordues', () => {
  // Quatre identifiants réels relevés sur ojs.szh.ch, sous différentes formes
  assert.strictEqual(ojs.rorCanonique('01swzsf04'), 'https://ror.org/01swzsf04');
  assert.strictEqual(ojs.rorCanonique('https://ror.org/01swzsf04'), 'https://ror.org/01swzsf04');
  assert.strictEqual(ojs.rorCanonique('http://ror.org/01swzsf04'), 'https://ror.org/01swzsf04');
  // ror.org/<id> contient un identifiant valide, donc il est reconnu
  assert.strictEqual(ojs.rorCanonique('ror.org/01swzsf04'), 'https://ror.org/01swzsf04');

  assert.strictEqual(ojs.rorCanonique('00w9q2c06'), 'https://ror.org/00w9q2c06');
  assert.strictEqual(ojs.rorCanonique('https://ror.org/00w9q2c06'), 'https://ror.org/00w9q2c06');

  assert.strictEqual(ojs.rorCanonique('04nd0xd48'), 'https://ror.org/04nd0xd48');
  assert.strictEqual(ojs.rorCanonique('027h8t796'), 'https://ror.org/027h8t796');

  // Formes tordues
  assert.strictEqual(ojs.rorCanonique('https://ror.org/'), '');
  assert.strictEqual(ojs.rorCanonique('12345'), '');
  assert.strictEqual(ojs.rorCanonique('https://orcid.org/0000-0002-1825-0097'), '');
  assert.strictEqual(ojs.rorCanonique(''), '');
  assert.strictEqual(ojs.rorCanonique(null), '');

  // Les minuscules et majuscules donnent le même résultat
  assert.strictEqual(ojs.rorCanonique('00W9Q2C06'), 'https://ror.org/00w9q2c06');
});


test('ROR : un auteur avec ror + affiliation émet rorAffiliation bien formé', () => {
  const racine = monter({
    ausgabe: { date: '2026-09-08' },
    articles: [{ slug: '01-edito', fiche: fiche(['type: editorial', 'lang: fr',
      'doi: "10.57161/r2026-02-00"', 'title:', '  fr: "Éditorial"',
      'author:', '- prenom: "Anne"', '  nom: "Dupont"',
      '  affiliation: "Université de Genève"', '  ror: "01swzsf04"']),
      texte: 'Un mot.' + LF }]
  });
  const sortie = exporter(racine, configComplete());
  assert.ok(sortie.xml.indexOf('<rorAffiliation>') !== -1, 'balise rorAffiliation absente');
  assert.ok(sortie.xml.indexOf('<ror>https://ror.org/01swzsf04</ror>') !== -1, 'ror canonique absent');
  assert.ok(sortie.xml.indexOf('Université de Genève') !== -1, 'affiliation absente');
  // Vérifier la position : après familyname, avant email/country
  const bloc = sortie.xml.slice(
    sortie.xml.indexOf('<familyname'),
    sortie.xml.indexOf('</author>')
  );
  assert.ok(bloc.indexOf('<familyname') !== -1);
  assert.ok(bloc.indexOf('<rorAffiliation>') > bloc.indexOf('<familyname'));
});

test('ROR : un auteur avec affiliation seule émet affiliation inchangé', () => {
  const racine = monter({
    ausgabe: { date: '2026-09-08' },
    articles: [{ slug: '01-edito', fiche: fiche(['type: editorial', 'lang: fr',
      'doi: "10.57161/r2026-02-00"', 'title:', '  fr: "Éditorial"',
      'author:', '- prenom: "Bruno"', '  nom: "Meyer"',
      '  affiliation: "SZH/CSPS"']),
      texte: 'Un mot.' + LF }]
  });
  const sortie = exporter(racine, configComplete());
  assert.ok(sortie.xml.indexOf('<affiliation>') !== -1, 'balise affiliation absente');
  assert.ok(sortie.xml.indexOf('<rorAffiliation>') === -1, 'rorAffiliation ne doit pas être émis');
  assert.ok(sortie.xml.indexOf('SZH/CSPS') !== -1, 'affiliation absente');
});

test("ROR : un ror reconnaissable sans affiliation n'émet rien et signale l'avertissement", () => {
  const racine = monter({
    ausgabe: { date: '2026-09-08' },
    articles: [{ slug: '01-edito', fiche: fiche(['type: editorial', 'lang: fr',
      'doi: "10.57161/r2026-02-00"', 'title:', '  fr: "Éditorial"',
      'author:', '- prenom: "Claire"', '  nom: "Rossi"', '  ror: "00w9q2c06"']),
      texte: 'Un mot.' + LF }]
  });
  const sortie = exporter(racine, configComplete());
  assert.strictEqual(sortie.xml.indexOf('<rorAffiliation>'), -1, 'rorAffiliation ne doit pas être émis');
  assert.strictEqual(sortie.xml.indexOf('<affiliation>'), -1, 'affiliation ne doit pas être émise');
  assert.ok(sortie.avertissements.some((a) => a.indexOf('01-edito') !== -1 && a.indexOf('ROR renseigné sans affiliation') !== -1),
    'avertissement ROR sans nom non signalé : ' + sortie.avertissements.join(' | '));
});

test("ROR : un ror tordu ne part pas et signale l'avertissement", () => {
  const racine = monter({
    ausgabe: { date: '2026-09-08' },
    articles: [{ slug: '01-edito', fiche: fiche(['type: editorial', 'lang: fr',
      'doi: "10.57161/r2026-02-00"', 'title:', '  fr: "Éditorial"',
      'author:', '- prenom: "Claire"', '  nom: "Rossi"',
      '  affiliation: "CSPS"', '  ror: "12345"']),
      texte: 'Un mot.' + LF }]
  });
  const sortie = exporter(racine, configComplete());
  assert.strictEqual(sortie.xml.indexOf('<rorAffiliation>'), -1, 'rorAffiliation ne doit pas être émis');
  assert.ok(sortie.xml.indexOf('<affiliation>') !== -1, 'affiliation seule attendue');
  assert.ok(sortie.xml.indexOf('CSPS') !== -1, 'affiliation absente');
  assert.ok(sortie.avertissements.some((a) => a.indexOf('01-edito') !== -1 && a.indexOf('ROR illisible') !== -1),
    'avertissement ROR tordu non signalé : ' + sortie.avertissements.join(' | '));
});

test("ROR : une fiche d'avant (sans ror) se relit, se réécrit et ne perd rien", () => {
  // Fiche sans clé ror : analyserMeta la crée avec ror: '', et serialiserMeta la réécrit bien
  const ficheMeta = fiche([
    'type: article',
    'lang: fr',
    'title:',
    '  fr: "Test"',
    'author:',
    '- prenom: "Anne"',
    '  nom: "Dupont"',
    '  affiliation: "HEP Vaud"',
    '  orcid: "0000-0002-1825-0097"'
  ]);

  const parsee = yaml.analyserMeta(ficheMeta);
  assert.strictEqual(parsee.author.length, 1, 'auteur non parsé');
  assert.strictEqual(parsee.author[0].prenom, 'Anne');
  assert.strictEqual(parsee.author[0].affiliation, 'HEP Vaud');
  assert.strictEqual(parsee.author[0].ror, '', 'ror pas initialisé');
  assert.strictEqual(parsee.author[0].orcid, '0000-0002-1825-0097');

  const reecrite = yaml.serialiserMeta(parsee);
  assert.ok(reecrite.indexOf('Anne') !== -1, 'prénom perdu');
  assert.ok(reecrite.indexOf('HEP Vaud') !== -1, 'affiliation perdue');
  assert.ok(reecrite.indexOf('0000-0002-1825-0097') !== -1, 'ORCID perdu');
  // La clé ror ne s'écrit pas si elle est vide
  assert.strictEqual(reecrite.indexOf('ror:'), -1, 'ror vide écrit quand même');
});

test('DOI : une fiche sans DOI n’est plus un manque, et la rubrique sans DOI n’en reçoit aucun', () => {
  // Le DOI ne se saisit plus : il est le rang de l'article dans le numéro. Une fiche vide
  // n'arrête donc plus rien — c'est devenu le cas normal.
  const sansDoi = ['type: article', 'lang: fr', 'title:', '  fr: "Sans DOI"',
    'resume:', '  fr: "Un résumé."', 'author:', '- nom: "SZH/CSPS"'];
  const seul = exporter(monter({
    ausgabe: { date: '2026-09-08' },
    articles: [{ slug: '01-sans-doi', fiche: fiche(sansDoi), texte: 'Texte.' + LF }]
  }), configComplete());
  assert.ok(seul.xml.indexOf('<id type="doi" advice="update">10.57161/r2026-02-00</id>') !== -1,
    'le DOI calculé n’est pas parti : ' + seul.xml.slice(seul.xml.indexOf('<publication'), 400));
  // Et il n'est signalé nulle part : un calcul qui aboutit n'a rien à dire.
  assert.ok(!seul.avertissements.some((a) => a.indexOf('DOI') !== -1),
    'un DOI calculé sans divergence ne doit rien signaler : ' + seul.avertissements.join(' | '));

  // La Documentation ne reçoit pas de DOI : l'export passe, avec un simple avertissement.
  const doc = ['type: documentation', 'lang: fr', 'title:', '  fr: "Documentation"',
    'author:', '- nom: "SZH/CSPS"'];
  const sortie = exporter(monter({
    ausgabe: { date: '2026-09-08' },
    articles: [{ slug: '01-doc', fiche: fiche(doc), texte: 'Texte.' + LF }]
  }), configComplete());
  assert.ok(sortie.xml.indexOf('section_ref="DC"') !== -1);
  assert.strictEqual(sortie.xml.indexOf('type="doi"'), -1, 'un DOI a été inventé');
  assert.ok(sortie.avertissements.some((a) => a.indexOf('normal pour cette rubrique') !== -1));
});

test('DOI : un numéro sans nombre ne fabrique aucun DOI, et le refus dit où le saisir', () => {
  // Un DOI à trous — « …-00-01 » pour un numéro sans nombre — aurait l'air juste et
  // désignerait un numéro qui n'existe pas. L'export s'arrête donc, comme il s'arrêtait sur
  // un DOI absent, et le message renvoie au seul endroit où cela se saisit.
  const racine = monter({ ausgabe: { date: '2026-09-08', numero: '' } });
  const e = refuse(racine, configComplete());
  assert.match(e.message, /date de publication et le numéro/);
  assert.match(e.message, /Métadonnées du numéro/);
  // Rien n'a été écrit : un export refusé ne laisse pas de fichier à moitié fait.
  assert.deepStrictEqual(fs.readdirSync(racine).filter((f) => f.indexOf('.xml') !== -1), []);

  // Une date absente arrête déjà l'export ; c'est bien le DOI qui parle du nombre manquant.
  process.env.SZH_LANGUE = 'de';
  try {
    const de = refuse(monter({ ausgabe: { date: '2026-09-08', numero: '' } }), configComplete());
    assert.match(de.message, /Publikationsdatum und die Nummer/);
    assert.match(de.message, /Metadaten der Ausgabe/);
    assert.strictEqual(de.message.indexOf('ß'), -1, 'eszett dans un message allemand');
  } finally { process.env.SZH_LANGUE = 'fr'; }

  // Un numéro fait de rubriques sans DOI n'a rien à calculer : il part comme avant.
  const doc = ['type: documentation', 'lang: fr', 'title:', '  fr: "Documentation"',
    'author:', '- nom: "SZH/CSPS"'];
  const sortie = exporter(monter({
    ausgabe: { date: '2026-09-08', numero: '' },
    articles: [{ slug: '01-doc', fiche: fiche(doc), texte: 'Texte.' + LF }]
  }), configComplete());
  assert.strictEqual(sortie.xml.indexOf('type="doi"'), -1);
});

// ---- Mots-clés : le qualificatif de provenance edudoc masqué, et son doublon fondu ----
//
// La saisie des mots-clés passe désormais par une liste fermée qui insère la forme
// canonique d'edudoc, qualificatif compris (« prévention (na) », « inclusion (SZH) »). Ce
// qualificatif ne doit jamais atteindre la page publique d'ojs.szh.ch — la règle et la
// liste fermée vivent dans lib/mots-cles-edudoc.js (sansQualificatifDeProvenance,
// QUALIFICATIFS_PROVENANCE), partagées avec pipeline/filters/szh-maquette.lua pour le PDF et
// le HTML ; voir test/js/mots-cles-provenance.test.js pour la fonction elle-même et l'accord
// des deux listes. Ici, on prouve que l'export OJS réel — le seul consommateur de ce module
// dans ce fichier — applique bien la règle sur l'XML qui part vers l'instance.
test('mots-clés OJS : le qualificatif de provenance est masqué, une parenthèse de sens survit', () => {
  const racine = monter({
    ausgabe: { date: '2026-09-08' },
    articles: [{ slug: '01-edito', fiche: fiche([
      'type: editorial', 'lang: fr', 'title:', '  fr: "Éditorial"',
      'keywords:',
      '  fr:',
      '  - "inclusion (SZH)"',
      '  - "diagnostic (résultat)"',
      'author:', '- nom: "SZH/CSPS"'
    ]), texte: 'Un mot.' + LF }]
  });
  const sortie = exporter(racine, configComplete());
  const bloc = sortie.xml.slice(sortie.xml.indexOf('<keywords locale="fr">'),
    sortie.xml.indexOf('</keywords>') + '</keywords>'.length);
  assert.ok(bloc.indexOf('<name>inclusion</name>') !== -1,
    'le qualificatif (SZH) n’a pas été masqué : ' + bloc);
  assert.strictEqual(bloc.indexOf('(SZH)'), -1, 'le qualificatif (SZH) est resté dans l’export : ' + bloc);
  assert.ok(bloc.indexOf('<name>diagnostic (résultat)</name>') !== -1,
    'une parenthèse de sens a été effacée à tort : ' + bloc);
});

test('mots-clés OJS : un mot-clé et sa forme qualifiée ne font plus qu’un, après masquage', () => {
  const racine = monter({
    ausgabe: { date: '2026-09-08' },
    articles: [{ slug: '01-edito', fiche: fiche([
      'type: editorial', 'lang: fr', 'title:', '  fr: "Éditorial"',
      'keywords:',
      '  fr:',
      '  - "prévention"',
      '  - "prévention (na)"',
      'author:', '- nom: "SZH/CSPS"'
    ]), texte: 'Un mot.' + LF }]
  });
  const sortie = exporter(racine, configComplete());
  const bloc = sortie.xml.slice(sortie.xml.indexOf('<keywords locale="fr">'),
    sortie.xml.indexOf('</keywords>') + '</keywords>'.length);
  assert.strictEqual((bloc.match(/<keyword>/g) || []).length, 1,
    'prévention et prévention (na) auraient dû fondre en un seul <keyword> : ' + bloc);
  assert.ok(bloc.indexOf('<name>prévention</name>') !== -1, bloc);
});

test('mots-clés OJS : un mot-clé sans qualificatif traverse inchangé', () => {
  const racine = monter({
    ausgabe: { date: '2026-09-08' },
    articles: [{ slug: '01-edito', fiche: fiche([
      'type: editorial', 'lang: fr', 'title:', '  fr: "Éditorial"',
      'keywords:',
      '  fr:',
      '  - "pédagogie spécialisée"',
      'author:', '- nom: "SZH/CSPS"'
    ]), texte: 'Un mot.' + LF }]
  });
  const sortie = exporter(racine, configComplete());
  assert.ok(sortie.xml.indexOf('<name>pédagogie spécialisée</name>') !== -1, sortie.xml);
});

// Cas dégénéré signalé après coup : un mot-clé réduit à son seul qualificatif de provenance
// (« (na) » tapé seul) devenait une chaîne vide après masquage, mais la garde qui filtre les
// entrées vides testait la valeur BRUTE, avant masquage — un <keyword><name></name></keyword>
// vide partait donc dans le XML d'import OJS. Personne ne tape « (na) » seul et aucun
// descripteur du thésaurus n'a cette forme, mais la saisie manuelle reste ouverte, et un
// élément vide est le genre de chose qu'un validateur de bibliothèque refuse sans dire
// pourquoi.
test('mots-clés OJS : un mot-clé réduit à rien par le masquage n’écrit aucun <keyword> vide', () => {
  const racine = monter({
    ausgabe: { date: '2026-09-08' },
    articles: [{ slug: '01-edito', fiche: fiche([
      'type: editorial', 'lang: fr', 'title:', '  fr: "Éditorial"',
      'keywords:',
      '  fr:',
      '  - "(na)"',
      '  - "accessibilité"',
      'author:', '- nom: "SZH/CSPS"'
    ]), texte: 'Un mot.' + LF }]
  });
  const sortie = exporter(racine, configComplete());
  const bloc = sortie.xml.slice(sortie.xml.indexOf('<keywords locale="fr">'),
    sortie.xml.indexOf('</keywords>') + '</keywords>'.length);
  assert.strictEqual(bloc.indexOf('<name></name>'), -1, 'un <name> vide est parti dans le XML : ' + bloc);
  assert.strictEqual((bloc.match(/<keyword>/g) || []).length, 1,
    'seul « accessibilité » aurait dû rester : ' + bloc);
  assert.ok(bloc.indexOf('<name>accessibilité</name>') !== -1, bloc);
});

test('DOI : le DOI manuel de la fiche part à la place du calculé, et l’écart se dit', () => {
  // Le corpus réel porte des DOI déposés, de la forme de la maison : « 10.57161/r2024-01-01 ».
  // Un doi resté dans la fiche est un DOI MANUEL — c'est le sens de l'échappatoire « Définir
  // manuellement le DOI » — et c'est LUI qui part. Mais jamais en silence : l'écart se dit,
  // avec les deux valeurs et le geste qui les départage.
  const historique = () => monter({
    produit: 'revue', ausgabe: { date: '2026-09-08' },
    articles: [{ slug: '01-edito', fiche: ficheEditorial('fr', '10.57161/r2024-01-01'),
      texte: 'Un mot.' + LF }]
  });
  const sortie = exporter(historique(), configComplete());
  assert.ok(sortie.xml.indexOf('<id type="doi" advice="update">10.57161/r2024-01-01</id>') !== -1,
    'le DOI manuel de la fiche n’est pas parti');
  assert.strictEqual(sortie.xml.indexOf('10.57161/r2026-02-00'), -1,
    'le calculé est parti quand même');
  const dit = sortie.avertissements.filter((a) => a.indexOf('10.57161/r2024-01-01') !== -1);
  assert.strictEqual(dit.length, 1, 'divergence non signalée : ' + sortie.avertissements.join(' | '));
  assert.ok(dit[0].indexOf('01-edito') !== -1, 'l’article n’est pas nommé : ' + dit[0]);
  assert.ok(dit[0].indexOf('10.57161/r2026-02-00') !== -1, 'le DOI calculé n’est pas dit : ' + dit[0]);
  assert.match(dit[0], /défini à la main/, 'l’origine manuelle n’est pas dite');
  assert.match(dit[0], /déjà paru/, 'la cause « DOI déjà déposé » n’est pas dite');
  assert.match(dit[0], /Définir manuellement le DOI/, 'le geste de retour n’est pas nommé');

  process.env.SZH_LANGUE = 'de';
  try {
    const de = exporter(historique(), configComplete()).avertissements
      .filter((a) => a.indexOf('10.57161/r2024-01-01') !== -1);
    assert.strictEqual(de.length, 1, 'divergence non signalée en allemand');
    assert.ok(de[0].indexOf('10.57161/r2026-02-00') !== -1);
    assert.match(de[0], /erschienen/);
    assert.match(de[0], /von Hand/);
    assert.strictEqual(de[0].indexOf('ß'), -1, 'eszett dans un message allemand');
  } finally { process.env.SZH_LANGUE = 'fr'; }
});

test('DOI : une forme étrangère à la revue part aussi, mais se dit autrement', () => {
  // La lettre distingue les deux revues : un « z » dans la Revue n'a jamais pu être déposé
  // tel quel, c'est très probablement une saisie de travers. Le DOI manuel part quand même
  // — l'échappatoire appartient à qui sait ce qu'il fait — mais le diagnostic n'est pas
  // celui d'un DOI historique, parce qu'il n'appelle pas le même geste.
  const racine = monter({
    produit: 'revue', ausgabe: { date: '2026-09-08' },
    articles: [{ slug: '01-edito', fiche: ficheEditorial('fr', '10.57161/z2026-02-00'),
      texte: 'Un mot.' + LF }]
  });
  const sortie = exporter(racine, configComplete());
  assert.ok(sortie.xml.indexOf('<id type="doi" advice="update">10.57161/z2026-02-00</id>') !== -1,
    'le DOI manuel n’est pas parti');
  assert.strictEqual(sortie.xml.indexOf('10.57161/r2026-02-00</id>'), -1,
    'le calculé est parti quand même');
  const dit = sortie.avertissements.filter((a) => a.indexOf('10.57161/z2026-02-00') !== -1);
  assert.strictEqual(dit.length, 1, 'DOI de la mauvaise revue non signalé : '
    + sortie.avertissements.join(' | '));
  assert.ok(dit[0].indexOf('10.57161/r2026-02-00') !== -1, 'le DOI calculé n’est pas dit');
  assert.match(dit[0], /lettre de revue/);
  assert.ok(dit[0].indexOf('déjà paru') === -1, 'un DOI impossible ne se dit pas « déjà paru »');
});

test('DOI : un DOI manuel égal au calculé part sans un mot', () => {
  // La case cochée puis laissée sur son point de départ : rien ne diverge, rien à dire.
  const racine = monter({
    produit: 'revue', ausgabe: { date: '2026-09-08' },
    articles: [{ slug: '01-edito', fiche: ficheEditorial('fr', '10.57161/r2026-02-00'),
      texte: 'Un mot.' + LF }]
  });
  const sortie = exporter(racine, configComplete());
  assert.ok(sortie.xml.indexOf('<id type="doi" advice="update">10.57161/r2026-02-00</id>') !== -1);
  assert.ok(!sortie.avertissements.some((a) => a.indexOf('DOI') !== -1),
    'un DOI manuel identique au calculé ne doit rien signaler : '
    + sortie.avertissements.join(' | '));
});

test('DOI : un article qui n’en reçoit pas, mais dont la fiche en porte un, le dit', () => {
  // Le cas qui se glisserait sans bruit : la rubrique change, l'article perd son DOI, et
  // celui de sa fiche reste. Il ne part pas — et cela ne se devine pas.
  const doc = ['type: documentation', 'lang: fr', 'doi: "10.57161/r2024-01-07"',
    'title:', '  fr: "Documentation"', 'author:', '- nom: "SZH/CSPS"'];
  const sortie = exporter(monter({
    ausgabe: { date: '2026-09-08' },
    articles: [{ slug: '01-doc', fiche: fiche(doc), texte: 'Texte.' + LF }]
  }), configComplete());
  assert.strictEqual(sortie.xml.indexOf('type="doi"'), -1, 'un DOI est parti quand même');
  assert.ok(sortie.avertissements.some((a) => a.indexOf('01-doc') !== -1
    && a.indexOf('10.57161/r2024-01-07') !== -1),
    'le DOI resté dans la fiche n’est pas signalé : ' + sortie.avertissements.join(' | '));
});

test('DOI : deux articles avec le même DOI manuel refusent l’export', () => {
  // Un DOI recopié d'un article à l'autre — le cas qu'un .meta.yaml dupliqué à la main
  // laisse passer en silence sans ce contrôle : les deux articles reçoivent le même
  // identifiant, et OJS ne saurait lequel des deux dépôts garder.
  const doiCommun = '10.57161/r2024-01-05';
  const racine = monter({
    produit: 'revue', ausgabe: { date: '2026-09-08' },
    articles: [
      { slug: '01-edito', fiche: ficheEditorial('fr', doiCommun), texte: 'Un mot.' + LF },
      { slug: '02-observation', fiche: ficheArticle('fr', doiCommun), texte: TEXTE_ARTICLE }
    ]
  });
  const e = refuse(racine, configComplete());
  assert.match(e.message, /10\.57161\/r2024-01-05/, 'le DOI en cause n’est pas nommé');
  assert.match(e.message, /01-edito/, 'le premier article n’est pas nommé');
  assert.match(e.message, /02-observation/, 'le second article n’est pas nommé');
  // Rien n'a été écrit : un export refusé ne laisse pas de fichier à moitié fait.
  assert.deepStrictEqual(fs.readdirSync(racine).filter((f) => f.indexOf('.xml') !== -1), []);

  process.env.SZH_LANGUE = 'de';
  try {
    const de = refuse(racine, configComplete());
    assert.match(de.message, /10\.57161\/r2024-01-05/);
    assert.match(de.message, /01-edito/);
    assert.match(de.message, /02-observation/);
    assert.strictEqual(de.message.indexOf('ß'), -1, 'eszett dans un message allemand');
  } finally { process.env.SZH_LANGUE = 'fr'; }
});

test('DOI : sans doublon, l’export est inchangé — aucun DOI calculé ne coïncide jamais', () => {
  // Les DOI calculés sont le rang de chaque article parmi les porteurs : deux rangs
  // distincts ne peuvent jamais donner la même valeur. Ce contrôle affirme que le nouveau
  // garde-fou ne se déclenche pas sur le cas ordinaire, déjà prouvé caractère par caractère
  // par la référence plus haut.
  const sortie = exporter(monter({ ausgabe: { date: '2026-09-08' } }), configComplete());
  assert.ok(!sortie.avertissements.some((a) => a.indexOf('même DOI') !== -1),
    'un avertissement de doublon est apparu sans qu’il y ait de doublon : '
    + sortie.avertissements.join(' | '));
  assert.ok(sortie.xml.indexOf('<id type="doi" advice="update">10.57161/r2026-02-00</id>') !== -1);
  assert.ok(sortie.xml.indexOf('<id type="doi" advice="update">10.57161/r2026-02-01</id>') !== -1);
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
    articles: [{ slug: '02-observation', fiche: ficheArticle('fr'),
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
    articles: [{ slug: '01-observation', fiche: ficheArticle('fr'),
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

// ---- Pagination continue d'un numéro -------------------------------------------------
//
// options.pagination est le JSON déjà analysé de `pipeline/pagination.py etat` (voir
// pipeline/pagination.py) : ce module ne le lit jamais lui-même, il le reçoit tout fait.

function paginationEssai(articles, opts) {
  opts = opts || {};
  return {
    schema: 'szh-pagination/1',
    articles: articles,
    total: articles.reduce((s, a) => s + (a.pages || 0), 0),
    perimes: opts.perimes || [],
    inconnus: opts.inconnus || [],
    enregistre: opts.enregistre !== undefined ? opts.enregistre : true
  };
}

test('pagination : sans options.pagination, l’export part comme avant, aucun <pages>', () => {
  // Le cas qui protège les numéros déjà publiés à l’ancienne : l’option absente ne doit
  // changer ni l’écriture ni le refus.
  const sortie = exporter(monter({ ausgabe: { date: '2026-09-08' } }), configComplete());
  assert.strictEqual(sortie.xml.indexOf('<pages>'), -1,
    '<pages> écrit alors qu’aucune pagination n’a été fournie');
});

test('pagination : à jour, chaque article porte son propre intervalle', () => {
  const racine = monter({ ausgabe: { date: '2026-09-08' } });
  const pagination = paginationEssai([
    { slug: '01-edito', depart: 4, pages: 1, pdf: true },
    { slug: '02-observation', depart: 1, pages: 3, pdf: true }
  ]);
  const sortie = exporter(racine, configComplete(), pagination);
  const idxArt2 = sortie.xml.indexOf('<article ', sortie.xml.indexOf('<article ') + 1);
  const blocEdito = sortie.xml.slice(0, idxArt2);
  const blocObservation = sortie.xml.slice(idxArt2);
  // Une seule page : le nombre nu, sans tiret.
  assert.ok(blocEdito.indexOf('<pages>4</pages>') !== -1,
    'intervalle d’une page absent de 01-edito : ' + blocEdito);
  assert.strictEqual(blocEdito.indexOf('<pages>1-3</pages>'), -1,
    'l’intervalle du voisin s’est glissé dans 01-edito');
  // Trois pages : trait d'union ASCII (U+002D), jamais un tiret demi-cadratin.
  assert.ok(blocObservation.indexOf('<pages>1-3</pages>') !== -1,
    'intervalle de trois pages absent de 02-observation : ' + blocObservation);
  assert.strictEqual(blocObservation.indexOf('<pages>4</pages>'), -1,
    'l’intervalle du voisin s’est glissé dans 02-observation');
});

test('pagination : la position de <pages> suit le schéma étendu d’OJS 3.5, pas la citation la plus proche',
  () => {
    // 02-observation (fiche par défaut) porte des références ; 01-edito (éditorial) n’en
    // porte aucune : les deux cas de position tiennent dans le même numéro.
    const racine = monter({ ausgabe: { date: '2026-09-08' } });
    const pagination = paginationEssai([
      { slug: '01-edito', depart: 4, pages: 1, pdf: true },
      { slug: '02-observation', depart: 1, pages: 3, pdf: true }
    ]);
    const sortie = exporter(racine, configComplete(), pagination);
    const idxArt2 = sortie.xml.indexOf('<article ', sortie.xml.indexOf('<article ') + 1);
    const blocEdito = sortie.xml.slice(0, idxArt2);
    const blocObservation = sortie.xml.slice(idxArt2);

    // Avec références : </citations> < <pages> < </publication>.
    const idxCitations = blocObservation.indexOf('</citations>');
    const idxPagesObs = blocObservation.indexOf('<pages>');
    const idxPubObs = blocObservation.indexOf('</publication>');
    assert.ok(idxCitations !== -1 && idxPagesObs !== -1 && idxPubObs !== -1,
      'un des trois repères manque dans 02-observation');
    assert.ok(idxCitations < idxPagesObs && idxPagesObs < idxPubObs,
      'ordre incorrect (citations=' + idxCitations + ', pages=' + idxPagesObs +
      ', publication=' + idxPubObs + ')');

    // Sans référence : pas de <citations>, <pages> suit le dernier </article_galley>.
    assert.strictEqual(blocEdito.indexOf('<citations>'), -1,
      '01-edito ne devrait porter aucune référence');
    const idxDernierGalley = blocEdito.lastIndexOf('</article_galley>');
    const idxPagesEdito = blocEdito.indexOf('<pages>');
    const idxPubEdito = blocEdito.indexOf('</publication>');
    assert.ok(idxDernierGalley !== -1 && idxPagesEdito !== -1 && idxPubEdito !== -1,
      'un des trois repères manque dans 01-edito');
    assert.ok(idxDernierGalley < idxPagesEdito && idxPagesEdito < idxPubEdito,
      'ordre incorrect (galley=' + idxDernierGalley + ', pages=' + idxPagesEdito +
      ', publication=' + idxPubEdito + ')');
  });

test('pagination : périmée, l’export refuse et n’écrit aucun fichier', () => {
  // La porte : un folio qui ne suit plus le sommaire (article allongé, inséré, déplacé…)
  // enverrait à OJS un <pages> qui ne concorde plus avec le PDF réellement publié.
  const racine = monter({ ausgabe: { date: '2026-09-08' } });
  const pagination = paginationEssai([
    { slug: '01-edito', depart: 1, pages: 1, pdf: true },
    { slug: '02-observation', depart: 2, pages: 3, pdf: true }
  ], { perimes: ['02-observation'] });
  const e = refuse(racine, configComplete(), pagination);
  assert.ok(Array.isArray(e.szhBloquants), 'l’erreur ne porte pas la liste des bloquants');
  assert.ok(e.szhBloquants.some((p) => p.indexOf('02-observation') !== -1),
    'le point bloquant ne nomme pas l’article périmé : ' + e.szhBloquants.join(' | '));
  assert.deepStrictEqual(fs.readdirSync(racine).filter((f) => f.indexOf('.xml') !== -1), [],
    'un fichier est parti malgré la pagination périmée');
});

test('pagination : enregistre à faux, même avec perimes vide, n’écrit ni <pages> ni ne refuse', () => {
  // `enregistre: false` dit que le numéro n’a jamais été paginé : un tel numéro part
  // exactement comme avant, quel que soit le contenu de `perimes`.
  const racine = monter({ ausgabe: { date: '2026-09-08' } });
  const pagination = paginationEssai([
    { slug: '01-edito', depart: 1, pages: 1, pdf: true },
    { slug: '02-observation', depart: 2, pages: 3, pdf: true }
  ], { enregistre: false, perimes: [] });
  const sortie = exporter(racine, configComplete(), pagination);
  assert.strictEqual(sortie.xml.indexOf('<pages>'), -1,
    '<pages> écrit alors que le numéro n’a jamais été paginé (enregistre: false)');
});

// ---- Les libellés du panneau --------------------------------------------------------

// Le panneau réellement exécuté : sans cela, une erreur au rendu laisserait le bloc vide
// sous un titre, et rien ne le dirait — c'est le défaut que webviews.test.js garde ailleurs.
test('panneau des réglages : la table des rubriques et les champs par revue sont rendus', () => {
  const page = ouvrir({
    racine: RACINE, page: 'settings', cssPartage: ['_design.css'], jsPartage: ['_messages.js'],
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
