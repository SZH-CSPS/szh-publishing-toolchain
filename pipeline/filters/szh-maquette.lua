-- Calcule les variables de gabarit de la couverture et de l'en-tête courant, à partir
-- d'ausgabe.yaml et de <slug>.meta.yaml : étiquette de dossier, nom et ISSN de la revue,
-- ligne « Vol. X · Nᵒ N/année », résumés, licence, titre du bloc auteurs, et par auteur
-- `orcid-url`, `initiales` et `photo-rang`.
--
-- Pandoc fusionne les métadonnées en gardant le dernier fichier : le `title` de l'article
-- écrase celui du dossier. Le titre du dossier est donc relu dans le fichier que nomme
-- SZH_AUSGABE (posée par le Makefile).
--
-- Langue de composition : celle de l'article (`lang:` de <slug>.meta.yaml), sinon celle du
-- numéro avec un avertissement. Title, subtitle et resume s'impriment dans cette langue
-- seulement : s'ils n'y sont remplis que dans une autre langue, la compilation s'arrête.
-- Elle s'arrête aussi sur la marque « TO BE TRANSLATED ».

local utils = pandoc.utils

-- Module commun. Sans lui le filtre ne peut pas travailler : la compilation s'arrête.
local commun
do
  -- debug.getinfo donne le chemin de ce fichier ; PANDOC_SCRIPT_FILE donnerait celui du
  -- script passé à pandoc, qui peut être un autre.
  local function dossier_ce_fichier()
    local source = debug.getinfo(1, 'S').source
    if source:sub(1, 1) == '@' then source = source:sub(2) end
    return source:match('^(.*[/\\])') or ''
  end
  local ok, module = pcall(dofile, dossier_ce_fichier() .. 'szh-commun.lua')
  if not ok or type(module) ~= 'table' then
    io.stderr:write('[maquette] szh-commun.lua introuvable ou fautif (' ..
      tostring(module) .. ') : ce filtre ne peut pas composer sans lui, arrêt.\n')
    os.exit(1, true)
    error('szh-commun.lua manquant', 0)
  end
  commun = module
end

local function S(v)
  if v == nil then return '' end
  return (utils.stringify(v):gsub('^%s+', ''):gsub('%s+$', ''))
end

-- Lecture directe d'un fichier YAML : la fusion de pandoc ne dit pas de quel fichier une
-- clé vient.
local parse_scalar = commun.parse_scalar
local lire_cle = commun.lire_cle

-- Année de la couverture : celle de `date:` si elle est saisie, sinon celle du nom du
-- dossier du numéro (« 2027-03 »). `date:` est la date de publication, vide jusqu'à la
-- parution, alors que la couverture porte son année dès le premier PDF.
local function annee_numero(date_val)
  local annee = date_val:match('%d%d%d%d')
  if annee then return annee end
  local ausgabe = os.getenv('SZH_AUSGABE') or ''
  local racine = ausgabe:gsub('[/\\][^/\\]*$', '')        -- retire « /ausgabe.yaml »
  local nom = racine:match('([^/\\]+)$') or ''
  return nom:match('^(%d%d%d%d)%-%d') or ''
end

-- ─── Tri alphabétique des mots-clés ──────────────────────────────────────────
-- table.sort compare des octets : en UTF-8, une lettre accentuée commence par 0xC3 ou
-- 0xC5, plus grand que toute lettre ASCII, et « École » se rangerait après « Zurich ».
-- Le tri range donc chaque lettre accentuée avec sa lettre de base (ordre du
-- dictionnaire, ö avec o). PLIAGE_ACCENTS remplace chaque séquence UTF-8 à deux octets
-- par sa lettre nue, minuscules et majuscules, car string.lower ne touche que l'ASCII.
-- Sur certains pandoc Windows natifs, string.lower altère aussi les octets non ASCII
-- (page de code active) et le pliage ne reconnaît plus rien ; les tests le détectent et
-- sautent les cas concernés.
local PLIAGE_ACCENTS = {
  ['\195\128']='a', ['\195\160']='a', ['\195\130']='a', ['\195\162']='a',
  ['\195\132']='a', ['\195\164']='a',
  ['\195\137']='e', ['\195\169']='e', ['\195\136']='e', ['\195\168']='e',
  ['\195\138']='e', ['\195\170']='e', ['\195\139']='e', ['\195\171']='e',
  ['\195\142']='i', ['\195\174']='i', ['\195\143']='i', ['\195\175']='i',
  ['\195\148']='o', ['\195\180']='o', ['\195\150']='o', ['\195\182']='o',
  ['\195\153']='u', ['\195\185']='u', ['\195\155']='u', ['\195\187']='u',
  ['\195\156']='u', ['\195\188']='u',
  ['\195\135']='c', ['\195\167']='c',
  ['\195\134']='ae', ['\195\166']='ae',
  ['\197\146']='oe', ['\197\147']='oe',
  ['\195\159']='ss',
}

-- Clé de tri d'un mot-clé : casse abaissée, diacritiques pliés. À clé égale, motcle_avant
-- départage par la chaîne d'origine, sans quoi table.sort peut échouer (« invalid order
-- function »).
local function cle_tri_motcle(s)
  return (s:lower():gsub('[\195\197][\128-\191]', PLIAGE_ACCENTS))
end

local function motcle_avant(a, b)
  local ca, cb = cle_tri_motcle(a), cle_tri_motcle(b)
  if ca ~= cb then return ca < cb end
  return a < b
end

-- ─── Qualificatif de provenance du thésaurus edudoc ─────────────────────────
-- Un descripteur edudoc porte parfois un qualificatif final qui dit seulement d'où il vient
-- dans le thésaurus : « Barrierefreiheit (szh) », « plan d'études (na) ». Le .meta.yaml et
-- le CSV Edudoc gardent cette forme complète ; le PDF et le HTML l'impriment sans le
-- qualificatif.
--
-- Même liste que QUALIFICATIFS_PROVENANCE de lib/mots-cles-edudoc.js, qui fait le même
-- travail pour la page OJS ; test/js/mots-cles-provenance.test.js vérifie que les deux
-- restent identiques.
--
-- Seuls ces cinq jetons sont retirés, comparés en entier et sans tenir compte de la casse.
-- Toute autre parenthèse porte du sens et reste : « diagnostic (processus) »,
-- « procédure d'évaluation standardisée (PES) ».
local QUALIFICATIFS_PROVENANCE = { na = true, ce = true, szh = true, csps = true, spc = true }

-- Rend le libellé sans son qualificatif de provenance final. Un libellé dont la parenthèse
-- finale n'est pas exactement l'un des cinq jetons ressort inchangé.
local function sans_qualificatif_provenance(texte)
  local contenu = texte:match('%(([^()]*)%)%s*$')
  if contenu then
    local nu = contenu:match('^%s*(.-)%s*$'):lower()
    if QUALIFICATIFS_PROVENANCE[nu] then
      return (texte:gsub('%s*%([^()]*%)%s*$', ''))
    end
  end
  return texte
end

-- DOI de l'article, lu dans dois-calcules.yaml, que le cockpit dépose à côté
-- d'ausgabe.yaml. Le DOI se calcule dans le cockpit seul (lib/articles.js) ; le filtre lit
-- la valeur. La clé se compare en texte et ne passe pas par lire_cle : un slug porte des
-- tirets, qui sont des quantificateurs dans un motif Lua. Fichier ou ligne absents : '',
-- et la couverture sort sans bandeau DOI.
local function doi_calcule_du_numero(slug)
  if slug == '' then return '' end
  local ausgabe = os.getenv('SZH_AUSGABE') or ''
  if ausgabe == '' then return '' end
  local racine = ausgabe:gsub('[/\\][^/\\]*$', '')
  if racine == ausgabe then return '' end          -- pas de dossier : rien à chercher
  local fh = io.open(racine .. '/dois-calcules.yaml', 'r')
  if not fh then return '' end
  local valeur = ''
  for ligne in fh:lines() do
    local cle, reste = ligne:match('^([^#%s][^:]*):%s*(.*)$')
    if cle == slug then valeur = parse_scalar(reste); break end
  end
  fh:close()
  return valeur
end

-- Nom et ISSN de la revue. `revue:` peut être le jeton (zeitschrift, revue) ou le nom
-- complet. Valeur inconnue : reprise telle quelle, sans ISSN.
local function derive_revue(revue_val, produit)
  if produit == 'zeitschrift' then
    return 'Schweizerische Zeitschrift für Heilpädagogik', '2813-4907'
  elseif revue_val:lower():find('revue') then
    return 'Revue suisse de pédagogie spécialisée', '2813-4915'
  end
  return revue_val, ''
end

-- Libellés des types hors dossier, les mêmes que LIBELLES_TYPES du cockpit.
local LIBELLES = {
  ['varia']         = { fr = 'Varia',         de = 'Varia',         it = 'Varia' },
  ['documentation'] = { fr = 'Documentation', de = 'Dokumentation', it = 'Documentazione' },
  ['tribune-libre'] = { fr = 'Tribune libre', de = 'Freie Tribüne', it = 'Tribuna libera' },
}
local TYPES_DOSSIER = { article = true, editorial = true, interview = true }

local LABELS_RESUME = { de = 'Zusammenfassung', fr = 'Résumé', it = 'Riassunto' }

-- U+00A0, l'espace insécable.
local NBSP = '\194\160'
-- U+2011, le trait d'union insécable.
local TIRET_INSEC = '\226\128\145'

-- Initiales d'un prénom, pour la ligne d'auteurs de la couverture : « Jérôme » -> « J. »,
-- « Jean-Baptiste » -> « J.-B. », « Marie Christine » -> « M. C. ». Le bloc « À propos »
-- garde le prénom entier.
-- Le séparateur devient insécable (U+2011 ou espace insécable) : avec un trait d'union
-- ordinaire, le navigateur peut couper « J.- » / « B. » en fin de ligne (règle UAX #14,
-- qu'aucun réglage `hyphens` n'empêche). test/polices-check.py vérifie que les polices
-- livrées portent U+2011. Le nom garde son trait d'union ordinaire.
-- Le découpage se fait en caractères : « Élodie » commence sur deux octets.
local function initiales_prenom(prenom)
  local sortie = {}
  local i = 1
  while true do
    local a, b = prenom:find('[^%-%s]+', i)
    if not a then break end
    local morceau = prenom:sub(a, b)
    local suivant = utf8.offset(morceau, 2)
    table.insert(sortie, (suivant and morceau:sub(1, suivant - 1) or morceau) .. '.')
    -- Le séparateur ne s'écrit que s'il reste un morceau derrière : pas de tiret pendu.
    local c, d = prenom:find('[%-%s]+', b + 1)
    if c == b + 1 and prenom:find('[^%-%s]', d + 1) then
      table.insert(sortie, prenom:sub(c, d):find('%-') and TIRET_INSEC or NBSP)
    end
    i = b + 1
  end
  return table.concat(sortie)
end

-- Abréviation de « numéro » devant le rang du numéro : « Vol. 17 · Nᵒ02/2027 » en
-- français, « Jg. 17 · Nr. 02/2027 » en allemand. Langue hors des trois : pas
-- d'abréviation.
--
-- `sup` : le « o » français est un vrai <sup>. Les polices livrées n'ont pas U+1D52, et
-- U+00BA ne se distingue pas du signe degré. La ligne se compose donc en inlines (pandoc
-- échappe une MetaString). Les boîtes qui la portent sont en capitales : print.css rend sa
-- casse à l'exposant.
--
-- `espace` : aucune en français. L'allemand et l'italien gardent l'insécable, car
-- « Nr.02 » se lirait comme un nombre décimal.
local ABREV_NUMERO = {
  fr = { texte = 'N',   sup = 'o', espace = ''   },
  de = { texte = 'Nr.',            espace = NBSP },
  it = { texte = 'N.',             espace = NBSP },
}
local ORDRE_LANGUES = { 'de', 'fr', 'it' }

-- Abréviation de « volume » sur la couverture. En allemand, le volume d'une revue est un
-- *Jahrgang* (« Jg. »). Langue hors des trois : « Vol. ».
local ABREV_VOLUME = {
  fr = 'Vol. ',
  de = 'Jg. ',
  it = 'Vol. ',
}

-- Titre du bloc des auteurs, le même quel que soit leur nombre.
local TITRES_AUTEURS = { fr = 'Autrices et auteurs', de = 'Autor:innen',
                         it = 'Autrici e autori' }

-- Licences d'article : même liste que LICENCES_ARTICLE de lib/yaml.js, vérifiée par
-- test/js/licence.test.js. `nom` est le sigle imprimé ; une entrée sans `url` s'imprime
-- sans lien. Licence absente ou inconnue : LICENCE_DEFAUT.
local LICENCE_DEFAUT = 'cc-by-4.0'
local LICENCES = {
  ['cc-by-4.0']       = { nom = 'CC-BY 4.0',       url = 'https://creativecommons.org/licenses/by/4.0/' },
  ['cc-by-sa-4.0']    = { nom = 'CC-BY-SA 4.0',    url = 'https://creativecommons.org/licenses/by-sa/4.0/' },
  ['cc-by-nd-4.0']    = { nom = 'CC-BY-ND 4.0',    url = 'https://creativecommons.org/licenses/by-nd/4.0/' },
  ['cc-by-nc-4.0']    = { nom = 'CC-BY-NC 4.0',    url = 'https://creativecommons.org/licenses/by-nc/4.0/' },
  ['cc-by-nc-sa-4.0'] = { nom = 'CC-BY-NC-SA 4.0', url = 'https://creativecommons.org/licenses/by-nc-sa/4.0/' },
  ['cc-by-nc-nd-4.0'] = { nom = 'CC-BY-NC-ND 4.0', url = 'https://creativecommons.org/licenses/by-nc-nd/4.0/' },
  ['droits-reserves'] = { nom = '',                url = '' },
}

-- Mention de licence de la couverture. « Droits réservés » a sa propre phrase, sans sigle
-- ni lien.
local MENTION_CC = {
  de = 'Dieser Artikel steht unter der Lizenz Creative Commons %s',
  fr = 'Cet article est sous licence Creative Commons %s',
  it = 'Questo articolo è pubblicato sotto licenza Creative Commons %s',
}
local MENTION_RESERVE = {
  de = 'Alle Rechte vorbehalten',
  fr = 'Tous droits réservés',
  it = 'Tutti i diritti riservati',
}

-- Rend la mention de licence de l'article, puis son adresse ('' sans lien). Le jeton se
-- lit dans la fiche de l'article seule : une `licence:` posée dans ausgabe.yaml ne doit
-- pas s'appliquer à tout le numéro.
local function licence_article(slug, lang)
  local cle = ''
  if slug ~= '' then cle = lire_cle(slug .. '.meta.yaml', 'licence'):lower() end
  local entree = LICENCES[cle] or LICENCES[LICENCE_DEFAUT]
  if entree.url == '' then
    return MENTION_RESERVE[lang] or MENTION_RESERVE.fr, ''
  end
  return string.format(MENTION_CC[lang] or MENTION_CC.fr, entree.nom), entree.url
end

-- Valeur d'une clé booléenne présente (par exemple `entete-condensee`). Pour
-- `$if(...)$`, toute chaîne non vide est vraie, et le cockpit écrit ses valeurs entre
-- guillemets : `"false"` serait vrai. Seule la liste VRAIS vaut vrai.
local VRAIS = { ['true'] = true, ['1'] = true, ['oui'] = true, ['ja'] = true,
                ['yes'] = true, ['si'] = true }
local function est_vrai(v)
  if v == nil then return false end
  -- Un booléen YAML arrive en booléen Lua, que S() ne sait pas lire.
  if type(v) == 'boolean' then return v end
  return VRAIS[S(v):lower()] == true
end

-- ─── Messages destinés au rédacteur ─────────────────────────────────────────
-- Chaque message nomme l'article, le champ, la langue attendue et ce qu'il faut faire pour
-- corriger. Le français et l'allemand (orthographe suisse) partent sur la même ligne,
-- l'allemand après « [de] » ; le cockpit affiche celle de son interface.
local LA_LANGUE = {
  fr = { fr = 'le français', de = "l’allemand", it = "l’italien" },
  de = { fr = 'Französisch', de = 'Deutsch',    it = 'Italienisch' },
}
local EN_LANGUE = commun.EN_LANGUE
local NOM_CHAMP = {
  fr = { title = 'le titre', subtitle = 'le sous-titre', resume = 'le résumé' },
  de = { title = 'den Titel', subtitle = 'den Untertitel', resume = 'die Zusammenfassung' },
}
local MARQUE = 'TO BE TRANSLATED'

local MESSAGES = {
  fr = {
    champ_vide = function(slug, lang, cle)
      return 'Article « ' .. slug .. ' » : la langue déclarée est ' .. LA_LANGUE.fr[lang] ..
        ', mais ' .. cle .. '.' .. lang .. ' est vide. Ouvrez « Métadonnées de ' ..
        "l’article » et renseignez " .. NOM_CHAMP.fr[cle] .. ' ' .. EN_LANGUE.fr[lang] ..
        ", ou changez la langue de l’article."
    end,
    marque_motcle = function(slug, lang, rang)
      return 'Article « ' .. slug .. ' » : le mot-clé n° ' .. rang .. ' de keywords.' ..
        lang .. ' est resté sur la marque « ' .. MARQUE ..
        " ». Ouvrez « Métadonnées de l’article » et traduisez-le " .. EN_LANGUE.fr[lang] ..
        ', ou retirez la rangée entière – cette marque s’imprimerait sur la couverture.'
    end,
    marque_champ = function(slug, lang, cle)
      return 'Article « ' .. slug .. ' » : ' .. cle .. '.' .. lang ..
        ' est resté sur la marque « ' .. MARQUE .. " ». Ouvrez « Métadonnées de l’article » " ..
        'et renseignez ' .. NOM_CHAMP.fr[cle] .. ' ' .. EN_LANGUE.fr[lang] .. '.'
    end,
  },
  de = {
    champ_vide = function(slug, lang, cle)
      return 'Artikel «' .. slug .. '»: die erklärte Sprache ist ' .. LA_LANGUE.de[lang] ..
        ', aber ' .. cle .. '.' .. lang .. ' ist leer. Öffnen Sie «Metadaten der Artikel» ' ..
        'und erfassen Sie ' .. NOM_CHAMP.de[cle] .. ' ' .. EN_LANGUE.de[lang] ..
        ', oder ändern Sie die Sprache des Artikels.'
    end,
    marque_motcle = function(slug, lang, rang)
      return 'Artikel «' .. slug .. '»: das Schlagwort Nr. ' .. rang .. ' von keywords.' ..
        lang .. ' steht noch auf der Marke «' .. MARQUE ..
        '». Öffnen Sie «Metadaten der Artikel» und erfassen Sie es ' .. EN_LANGUE.de[lang] ..
        ', oder entfernen Sie die ganze Zeile – diese Marke würde auf der Titelseite erscheinen.'
    end,
    marque_champ = function(slug, lang, cle)
      return 'Artikel «' .. slug .. '»: ' .. cle .. '.' .. lang ..
        ' steht noch auf der Marke «' .. MARQUE .. '». Öffnen Sie «Metadaten der Artikel» ' ..
        'und erfassen Sie ' .. NOM_CHAMP.de[cle] .. ' ' .. EN_LANGUE.de[lang] .. '.'
    end,
  },
}

-- Format d'une ligne de message, lu par le cockpit :
--
--   [meta-<ton>] <code> | <champ> | … | <phrase fr> | [de] <Satz de>
--
-- Le ton vaut « blocage » (la compilation s'arrête) ou « avertissement ». Le cockpit se
-- fie au ton et au code ; les phrases peuvent se reformuler sans rien casser.
-- Les champs sont nommés (« article « … » », « champ « title » », « langue « de » »,
-- « motcle 3 ») pour que le cockpit les retrouve sans compter les positions. Aucun ne
-- contient de « | ».
local function chp_article(slug) return 'article « ' .. slug .. ' »' end
local function chp_langue(l)     return 'langue « ' .. l .. ' »' end
local function chp_champ(cle)    return 'champ « ' .. cle .. ' »' end
local function chp_motcle(rang)  return 'motcle ' .. rang end

-- Écrit le message et arrête la compilation sans fichier de sortie (szh-commun.lua).
local function bloquer(code, champs, fr, de) commun.bloquer('meta', code, champs, fr, de) end

-- Valeur d'un champ localisé dans la langue de l'article, et dans elle seule (un texte
-- d'une autre langue sous ce `lang` fausserait la lecture d'écran) :
--   rempli dans la langue de l'article        -> la valeur ;
--   vide partout et champ facultatif          -> '' ;
--   rempli dans une autre langue seulement,
--   ou champ obligatoire vide                 -> arrêt de la compilation.
-- title est obligatoire ; subtitle et resume sont facultatifs.
local function champ_localise(map, lang, cle, obligatoire, slug)
  local valeur, ailleurs = '', false
  if map ~= nil then
    for _, l in ipairs({ 'de', 'fr', 'it' }) do
      local brut = (map[l] ~= nil) and S(map[l]) or ''
      if brut ~= '' then
        if l == lang then valeur = brut else ailleurs = true end
      end
    end
  end
  if valeur ~= '' then return valeur end
  if obligatoire or ailleurs then
    bloquer('champ-vide', { chp_article(slug), chp_champ(cle), chp_langue(lang) },
      MESSAGES.fr.champ_vide(slug, lang, cle), MESSAGES.de.champ_vide(slug, lang, cle))
  end
  return ''
end

local function est_marque(texte)
  return (texte:gsub('^%s+', ''):gsub('%s+$', '')):upper() == MARQUE
end

-- Arrête la compilation si la marque « TO BE TRANSLATED », qui tient la place d'un texte
-- non traduit, reste dans un mot-clé, un titre, un sous-titre ou un résumé.
local function verifier_marque(meta, slug)
  local km = meta.keywords
  if km ~= nil then
    for _, l in ipairs({ 'de', 'fr', 'it' }) do
      if km[l] ~= nil then
        for rang, mot in ipairs(km[l]) do
          if est_marque(S(mot)) then
            bloquer('marque-motcle', { chp_article(slug), chp_motcle(rang), chp_langue(l) },
              MESSAGES.fr.marque_motcle(slug, l, rang), MESSAGES.de.marque_motcle(slug, l, rang))
          end
        end
      end
    end
  end
  for _, cle in ipairs({ 'title', 'subtitle', 'resume' }) do
    local map = meta[cle]
    if map ~= nil then
      for _, l in ipairs({ 'de', 'fr', 'it' }) do
        if map[l] ~= nil and est_marque(S(map[l])) then
          bloquer('marque-champ', { chp_article(slug), chp_champ(cle), chp_langue(l) },
            MESSAGES.fr.marque_champ(slug, l, cle), MESSAGES.de.marque_champ(slug, l, cle))
        end
      end
    end
  end
end

function Meta(meta)
  -- Langue de l'article et produit, posés par szh-contexte.lua, ou calculés ici si le
  -- filtre tourne seul.
  local contexte = commun.contexte(meta, true)
  local lang = contexte.lang
  local nom, issn = derive_revue(S(meta.revue), contexte.produit)
  local slug = commun.slug_article()

  verifier_marque(meta, slug)

  local type_art = S(meta.type)
  local dossier = lire_cle(os.getenv('SZH_AUSGABE'), 'title')

  local etiquette
  if TYPES_DOSSIER[type_art] then
    etiquette = dossier
  elseif LIBELLES[type_art] then
    etiquette = LIBELLES[type_art][lang] or LIBELLES[type_art].fr
  else
    etiquette = dossier   -- type absent ou inconnu
  end

  -- Ligne « Vol. X · Nᵒ N/année », sans les parties manquantes (voir ABREV_NUMERO). Sans
  -- `numero:`, la ligne porte l'année seule, sans abréviation.
  local volume = S(meta.volume)
  local numero = S(meta.numero)
  local annee = annee_numero(S(meta.date))
  local droite = {}
  if numero ~= '' then
    local abrev = ABREV_NUMERO[lang]
    if abrev then
      table.insert(droite, pandoc.Str(abrev.texte))
      if abrev.sup then
        table.insert(droite, pandoc.Superscript({ pandoc.Str(abrev.sup) }))
      end
      if abrev.espace ~= '' then table.insert(droite, pandoc.Str(abrev.espace)) end
    end
    table.insert(droite, pandoc.Str(annee ~= '' and (numero .. '/' .. annee) or numero))
  elseif annee ~= '' then
    table.insert(droite, pandoc.Str(annee))
  end
  local vol_ligne = {}
  if volume ~= '' then
    table.insert(vol_ligne, pandoc.Str((ABREV_VOLUME[lang] or 'Vol. ') .. volume))
  end
  if #droite > 0 then
    if #vol_ligne > 0 then table.insert(vol_ligne, pandoc.Str(' · ')) end
    for _, el in ipairs(droite) do table.insert(vol_ligne, el) end
  end

  -- Résumés présents, celui de la langue de composition en premier.
  local resumes = {}
  local vus = {}
  local function ajouter(l)
    if vus[l] then return end
    vus[l] = true
    local map_resume = meta.resume
    local texte = ''
    if map_resume ~= nil and map_resume[l] ~= nil then texte = S(map_resume[l]) end
    if texte == '' then return end
    local mots = {}
    local km = meta.keywords
    if km ~= nil and km[l] ~= nil then
      -- Mots-clés triés par ordre alphabétique, chaque langue pour elle-même.
      local textes = {}
      local vus_motcles = {}
      for _, mot in ipairs(km[l]) do
        -- Le qualificatif se retire avant le tri : c'est la forme affichée qui se trie.
        local brut = S(mot)
        local affiche = sans_qualificatif_provenance(brut)
        -- Un mot-clé que le retrait du qualificatif vide (« (na) » seul) disparaît. Un
        -- mot-clé déjà vide passe tel quel.
        if not (brut ~= '' and affiche == '') then
          -- Dédoublonnage sur la clé de tri, après le retrait : « prévention » et
          -- « prévention (na) » ne s'impriment qu'une fois. Le premier rencontré reste.
          local cle = cle_tri_motcle(affiche)
          if not vus_motcles[cle] then
            vus_motcles[cle] = true
            table.insert(textes, affiche)
          end
        end
      end
      table.sort(textes, motcle_avant)
      for _, texte in ipairs(textes) do
        table.insert(mots, pandoc.MetaString(texte))
      end
    end
    table.insert(resumes, pandoc.MetaMap({
      lang    = pandoc.MetaString(l),
      label   = pandoc.MetaString(LABELS_RESUME[l] or ''),
      texte   = pandoc.MetaString(texte),
      motscles = pandoc.MetaList(mots),
    }))
  end
  ajouter(lang)
  for _, l in ipairs(ORDRE_LANGUES) do ajouter(l) end

  meta['revue-nom']        = pandoc.MetaString(nom)
  meta['issn']             = pandoc.MetaString(issn)
  meta['etiquette-dossier'] = pandoc.MetaString(etiquette)
  meta['vol-ligne']        = pandoc.MetaInlines(vol_ligne)
  local titre = champ_localise(meta.title, lang, 'title', true, slug)
  meta['titre-affiche']    = pandoc.MetaString(titre)
  meta['sous-titre-affiche'] = pandoc.MetaString(
    champ_localise(meta.subtitle, lang, 'subtitle', false, slug))
  meta['resumes']          = pandoc.MetaList(resumes)
  local licence_texte, licence_url = licence_article(slug, lang)
  meta['licence-texte']    = pandoc.MetaString(licence_texte)
  -- Sans adresse, la clé reste absente : le gabarit imprime la mention sans lien.
  meta['licence-url']      = licence_url ~= '' and pandoc.MetaString(licence_url) or nil
  -- En-tête condensé par défaut : une clé absente vaut vrai, une clé présente est lue par
  -- est_vrai. Le test sur nil vient en premier, sinon une clé absente vaudrait faux.
  if meta['entete-condensee'] == nil then
    meta['entete-condensee'] = true
  else
    meta['entete-condensee'] = est_vrai(meta['entete-condensee']) or nil
  end

  -- Bandeau DOI de la couverture. Un `doi:` du .meta.yaml (DOI défini à la main dans le
  -- cockpit) l'emporte ; sinon le DOI vient de doi_calcule_du_numero. Sans DOI, pas de
  -- bandeau.
  if S(meta.doi) == '' then
    local doi_depose = doi_calcule_du_numero(slug)
    if doi_depose ~= '' then meta['doi'] = pandoc.MetaString(doi_depose) end
  end

  -- Métadonnées du document : <title> et <meta> HTML, /Title, /Author et /Lang du PDF
  -- (requis par PDF/UA). Sans `pagetitle`, pandoc avertit et prend le slug pour titre.
  meta['pagetitle'] = pandoc.MetaString(titre)
  meta['lang'] = pandoc.MetaString(lang)
  meta['description'] = pandoc.MetaString(
    champ_localise(meta.resume, lang, 'resume', false, slug))
  local noms = {}
  local rang_photo = 0
  local auteurs = meta.author or meta.auteurs
  if auteurs ~= nil then
    for _, a in ipairs(auteurs) do
      local nm
      if type(a) == 'table' and (a.nom ~= nil or a.prenom ~= nil) then
        local n = S(a.nom)
        local p = S(a.prenom)
        nm = n
        if p ~= '' then nm = (n ~= '' and (n .. ', ' .. p) or p) end

        -- Les gabarits pandoc ne transforment pas les chaînes : les valeurs dérivées
        -- s'ajoutent à la MetaMap de l'auteur, lue par le gabarit via $author.…$.
        -- ORCID : identifiant nu ou URL -> https://orcid.org/<ID>, X final en majuscule.
        -- URL sans identifiant reconnaissable : reprise telle quelle ; autre valeur : pas
        -- de lien.
        local orcid = S(a.orcid)
        if orcid ~= '' then
          local id = orcid:match('(%d%d%d%d%-%d%d%d%d%-%d%d%d%d%-%d%d%d[%dxX])')
          if id then
            a['orcid-url'] = pandoc.MetaString('https://orcid.org/' .. id:upper())
          elseif orcid:match('^https?://') then
            a['orcid-url'] = pandoc.MetaString(orcid)
          end
        end
        -- Sans prénom, la clé reste absente et le gabarit n'imprime que le nom.
        if p ~= '' then
          local init = initiales_prenom(p)
          if init ~= '' then a['initiales'] = pandoc.MetaString(init) end
        end
        -- Rang du portrait : il nomme la règle CSS que le gabarit écrit pour cette
        -- photo. Le portrait est un fond CSS et non un <img> (voir print.css).
        if S(a.photo) ~= '' then
          rang_photo = rang_photo + 1
          a['photo-rang'] = pandoc.MetaString(tostring(rang_photo))
        end
      else
        nm = S(a)
      end
      if nm ~= '' then table.insert(noms, pandoc.MetaString(nm)) end
    end
  end
  meta['auteurs-noms'] = pandoc.MetaList(noms)
  if #noms > 0 then
    meta['auteurs-titre'] = pandoc.MetaString(TITRES_AUTEURS[lang] or TITRES_AUTEURS.fr)
  end
  return meta
end
