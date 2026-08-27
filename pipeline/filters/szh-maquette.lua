-- Calcule les variables de template de la maquette (couverture et en-tête courant) à
-- partir des clés d'ausgabe.yaml et de <slug>.meta.yaml : étiquette de dossier, nom et
-- ISSN de la revue, ligne « Vol. X · N/année », résumés, licence, titre du bloc auteurs,
-- et par auteur `orcid-url` et `photo-rang`. Aucune clé n'est inventée côté fichiers.
-- Le titre du DOSSIER (ausgabe.yaml `title`) est écrasé dans Meta par le `title` de
-- l'article, pandoc gardant le dernier fichier à clé égale : il est donc relu dans
-- ausgabe.yaml via la variable d'environnement SZH_AUSGABE, posée par le Makefile.
--
-- L'année de la ligne « N/année » vient de `date:` si elle y est, sinon du nom du dossier
-- du numéro (« 2027-03 ») : `date:` est la date de publication, vide jusqu'à la parution,
-- et une couverture sans année serait pire qu'une année reprise du dossier.
--
-- Licence : `licence:` de <slug>.meta.yaml, jeton fermé. Absente ou illisible, c'est
-- CC-BY 4.0, la licence de la revue — une fiche d'avant ce champ sort donc exactement
-- comme avant. « droits-reserves » n'a pas d'adresse : la couverture imprime alors la
-- mention sans lien, et aucune URL n'est inventée.
--
-- Langue de composition : celle de l'ARTICLE (`lang:` de <slug>.meta.yaml) prime sur le
-- jeton de revue et sur le `lang:` du numéro. Un article allemand d'un numéro français se
-- compose donc en allemand — césure, libellés « Abbildung », /Lang du PDF, lecteur
-- d'écran. Fiche sans `lang:` : repli sur la langue du numéro, et un avertissement qui
-- nomme l'article.
--
-- Et rien ne s'imprime dans une autre langue que celle-là : title, subtitle et resume
-- vides dans la langue de l'article arrêtent la compilation au lieu de laisser passer le
-- texte français sous `lang="de"`. Même règle pour la marque « TO BE TRANSLATED », qui
-- tient la place d'un mot-clé non traduit et deviendrait une puce de la couverture.

local utils = pandoc.utils

local function S(v)
  if v == nil then return '' end
  return (utils.stringify(v):gsub('^%s+', ''):gsub('%s+$', ''))
end

-- Analyse un scalaire YAML « nu / "..." / '...' » (miroir de decouperValeurYaml).
local function parse_scalar(reste)
  reste = reste:gsub('%s+$', '')
  local q = reste:sub(1, 1)
  if q == '"' then
    local fin = 2
    while fin <= #reste do
      local c = reste:sub(fin, fin)
      if c == '\\' then fin = fin + 2
      elseif c == '"' then break
      else fin = fin + 1 end
    end
    return reste:sub(2, fin - 1):gsub('\\(["\\])', '%1')
  elseif q == "'" then
    local m = reste:match("^'(.-)'%s*$")
    if m then return (m:gsub("''", "'")) end
  end
  -- nu : coupe au commentaire « espace(s) + # »
  local pos = reste:find('%s+#')
  if reste:sub(1, 1) == '#' then return '' end
  if pos then reste = reste:sub(1, pos - 1) end
  return (reste:gsub('^%s+', ''):gsub('%s+$', ''))
end

-- Valeur d'une clé scalaire de premier niveau d'un YAML plat, hors pandoc, ou ''. Sert
-- à ausgabe.yaml (titre du dossier, langue du numéro) et à la fiche de l'article : la
-- fusion de pandoc, elle, ne dit pas de quel fichier une clé vient.
local function lire_cle(chemin, cle)
  if not chemin or chemin == '' then return '' end
  local fh = io.open(chemin, 'r')
  if not fh then return '' end
  local valeur = ''
  for ligne in fh:lines() do
    local m = ligne:match('^' .. cle .. ':%s*(.*)$')
    if m then valeur = parse_scalar(m); break end
  end
  fh:close()
  return valeur
end

-- Année portée par la couverture. `date:` d'ausgabe.yaml est la date de PUBLICATION du
-- numéro : elle reste vide jusqu'à la parution, alors que la couverture doit porter son
-- année dès le premier PDF. Repli sur le nom du dossier du numéro, qui suit la convention
-- « 2027-03 » — SZH_AUSGABE pointe l'ausgabe.yaml de ce dossier. Une date complète saisie
-- passe devant : c'est elle qui fait foi.
local function annee_numero(date_val)
  local annee = date_val:match('%d%d%d%d')
  if annee then return annee end
  local ausgabe = os.getenv('SZH_AUSGABE') or ''
  local racine = ausgabe:gsub('[/\\][^/\\]*$', '')        -- retire « /ausgabe.yaml »
  local nom = racine:match('([^/\\]+)$') or ''
  return nom:match('^(%d%d%d%d)%-%d') or ''
end

-- Slug de l'article, tiré du fichier d'entrée : le Makefile compile depuis le dossier de
-- l'article, la fiche est donc <slug>.meta.yaml dans le répertoire courant. Sert aussi à
-- nommer l'article dans les messages.
local function slug_article()
  local fichiers = (PANDOC_STATE and PANDOC_STATE.input_files) or {}
  local chemin = fichiers[1]
  if type(chemin) ~= 'string' then return '' end
  return (chemin:gsub('.*[/\\]', ''):gsub('%.md$', ''))
end

-- Les trois langues de la revue. L'anglais n'en est pas : ni libellé de résumé, ni
-- mention de licence, ni titre de bloc auteurs n'existent pour lui.
local LANGUES = { fr = true, de = true, it = true }

-- Langue déclarée par la fiche, en jeton court, ou '' si la clé est absente. La valeur
-- n'est pas validée ici : une langue inconnue doit être nommée dans le message d'erreur.
local function langue_fiche(slug)
  if slug == '' then return '' end
  return lire_cle(slug .. '.meta.yaml', 'lang'):lower():sub(1, 2)
end

-- DOI calculé de l'article, lu dans le fichier DÉRIVÉ dois-calcules.yaml que le cockpit
-- dépose à côté d'ausgabe.yaml (repéré par SZH_AUSGABE, comme annee_numero). Le CALCUL
-- lui-même vit dans le cockpit — le rang de l'article parmi les porteurs du numéro,
-- lib/articles.js, un seul endroit — et le pipeline ne fait que lire la valeur déposée :
-- un second calcul ici finirait par diverger du premier. Lecture hors pandoc, ligne à
-- ligne, la clé comparée en TEXTE et non passée à lire_cle : un slug porte des tirets,
-- qui sont des quantificateurs dans un motif Lua. Fichier absent ou slug absent -> '' —
-- les dépôts montés à la main et les tests n'ont pas ce fichier, et un article sans DOI
-- n'y a pas de ligne : la couverture sort alors sans bandeau, comme avant, jamais en
-- échec.
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

-- revue -> { nom, issn, lang }. Accepte le jeton canonique (zeitschrift/revue) et le
-- nom complet de l'ancien ausgabe.yaml. Valeur inconnue -> champ libre, sans langue :
-- c'est l'appelant qui enchaîne les replis, la langue de l'article passant devant tout.
local function derive_revue(revue_val)
  local v = revue_val:lower()
  if v:find('zeitschrift') then
    return 'Schweizerische Zeitschrift für Heilpädagogik', '2813-4907', 'de'
  elseif v:find('revue') then
    return 'Revue suisse de pédagogie spécialisée', '2813-4915', 'fr'
  end
  return revue_val, '', ''
end

-- Libellés localisés des types hors dossier, repris de LIBELLES_TYPES de l'extension.
local LIBELLES = {
  ['varia']         = { fr = 'Varia',         de = 'Varia',         it = 'Varia' },
  ['documentation'] = { fr = 'Documentation', de = 'Dokumentation', it = 'Documentazione' },
  ['tribune-libre'] = { fr = 'Tribune libre', de = 'Freie Tribüne', it = 'Tribuna libera' },
}
local TYPES_DOSSIER = { article = true, editorial = true, interview = true }

local LABELS_RESUME = { de = 'Zusammenfassung', fr = 'Résumé', it = 'Riassunto' }
local ORDRE_LANGUES = { 'de', 'fr', 'it' }

-- Bloc des auteur·e·s : titre localisé. Un seul libellé, quel que soit le nombre de
-- personnes — l'accord en nombre d'avant obligeait à deux formules par langue pour un
-- titre que personne ne lit comme une phrase.
local TITRES_AUTEURS = { fr = 'Autrices et auteurs', de = 'Autor:innen',
                         it = 'Autrici e autori' }

-- Licences d'article : miroir de LICENCES_ARTICLE de lib/yaml.js, gardé par
-- test/js/licence.test.js. `nom` est le sigle imprimé, le même dans les trois langues ;
-- une entrée sans `url` n'a pas de lien, et n'en recevra pas.
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

-- Mention de licence de la couverture, localisée. Le sigle est inséré tel quel dans la
-- phrase Creative Commons ; « droits réservés » n'est pas une licence Creative Commons et
-- a donc sa propre phrase, sans sigle et sans lien.
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

-- Mention et adresse de licence de l'article. Le jeton est lu dans sa fiche, hors pandoc,
-- comme la langue : la fusion de pandoc ne dirait pas de quel fichier la clé vient, et
-- une licence posée dans ausgabe.yaml s'appliquerait à tout le numéro sans qu'on l'ait
-- décidé. Rend la mention puis l'adresse, celle-ci vide quand il n'y en a pas.
local function licence_article(slug, lang)
  local cle = ''
  if slug ~= '' then cle = lire_cle(slug .. '.meta.yaml', 'licence'):lower() end
  local entree = LICENCES[cle] or LICENCES[LICENCE_DEFAUT]
  if entree.url == '' then
    return MENTION_RESERVE[lang] or MENTION_RESERVE.fr, ''
  end
  return string.format(MENTION_CC[lang] or MENTION_CC.fr, entree.nom), entree.url
end

-- Réglage « condenser l'en-tête » (ausgabe.yaml), normalisé ici et non laissé à
-- `$if(entete-condensee)$` : pour pandoc, toute chaîne non vide est vraie, donc un
-- `entete-condensee: "false"` — le sérialiseur du cockpit cite ses valeurs — activerait
-- l'option. Seule une liste fermée de valeurs vraies est reconnue, tout le reste vaut
-- « pas condensé ».
local VRAIS = { ['true'] = true, ['1'] = true, ['oui'] = true, ['ja'] = true,
                ['yes'] = true, ['si'] = true }
local function est_vrai(v)
  if v == nil then return false end
  -- Un booléen YAML arrive en booléen Lua nu : le tester en premier, l'indexer (v.t)
  -- lèverait une erreur.
  if type(v) == 'boolean' then return v end
  return VRAIS[S(v):lower()] == true
end

-- ─── Messages destinés au rédacteur ─────────────────────────────────────────
-- Le panneau de compilation est lu par des rédacteurs, pas par des développeurs : chaque
-- message nomme l'article, le champ, la langue attendue et le geste qui corrige. Deux
-- langues, celles du cockpit ; l'allemand en orthographe suisse.
--
-- Les deux langues partent sur la MÊME ligne, l'allemande introduite par « [de] », et le
-- cockpit jette celle qu'il n'affiche pas. Ce filtre n'a donc plus de langue à choisir :
-- il n'écrivait qu'une langue, celle du numéro, et le cockpit devait reconnaître ses
-- phrases françaises et allemandes pour pouvoir les redire dans la sienne. Une
-- reformulation cassait la remontée, sans un mot.
local LA_LANGUE = {
  fr = { fr = 'le français', de = "l'allemand", it = "l'italien" },
  de = { fr = 'Französisch', de = 'Deutsch',    it = 'Italienisch' },
}
local EN_LANGUE = {
  fr = { fr = 'en français',      de = 'en allemand',   it = 'en italien' },
  de = { fr = 'auf Französisch',  de = 'auf Deutsch',   it = 'auf Italienisch' },
}
local NOM_CHAMP = {
  fr = { title = 'le titre', subtitle = 'le sous-titre', resume = 'le résumé' },
  de = { title = 'den Titel', subtitle = 'den Untertitel', resume = 'die Zusammenfassung' },
}
local MARQUE = 'TO BE TRANSLATED'

local MESSAGES = {
  fr = {
    sans_langue = function(slug, lang_num)
      return 'Article « ' .. slug .. " » : aucune langue déclarée dans " .. slug ..
        '.meta.yaml — composition ' .. EN_LANGUE.fr[lang_num] ..
        ", la langue du numéro. Ouvrez « Métadonnées de l'article » et fixez la langue de l'article."
    end,
    langue_inconnue = function(slug, brut)
      return 'Article « ' .. slug .. ' » : langue « ' .. brut ..
        " » inconnue dans " .. slug .. '.meta.yaml. Langues de la revue : fr, de, it.' ..
        " Ouvrez « Métadonnées de l'article » et choisissez-en une."
    end,
    champ_vide = function(slug, lang, cle)
      return 'Article « ' .. slug .. ' » : la langue déclarée est ' .. LA_LANGUE.fr[lang] ..
        ', mais ' .. cle .. '.' .. lang .. ' est vide. Ouvrez « Métadonnées de ' ..
        "l'article » et renseignez " .. NOM_CHAMP.fr[cle] .. ' ' .. EN_LANGUE.fr[lang] ..
        ", ou changez la langue de l'article."
    end,
    marque_motcle = function(slug, lang, rang)
      return 'Article « ' .. slug .. ' » : le mot-clé n° ' .. rang .. ' de keywords.' ..
        lang .. ' est resté sur la marque « ' .. MARQUE ..
        " ». Ouvrez « Métadonnées de l'article » et traduisez-le " .. EN_LANGUE.fr[lang] ..
        ', ou retirez la rangée entière — cette marque s\'imprimerait sur la couverture.'
    end,
    marque_champ = function(slug, lang, cle)
      return 'Article « ' .. slug .. ' » : ' .. cle .. '.' .. lang ..
        ' est resté sur la marque « ' .. MARQUE .. " ». Ouvrez « Métadonnées de l'article » " ..
        'et renseignez ' .. NOM_CHAMP.fr[cle] .. ' ' .. EN_LANGUE.fr[lang] .. '.'
    end,
  },
  de = {
    sans_langue = function(slug, lang_num)
      return 'Artikel « ' .. slug .. ' »: keine Sprache in ' .. slug ..
        '.meta.yaml erklärt — Satz ' .. EN_LANGUE.de[lang_num] ..
        ', der Sprache der Ausgabe. Öffnen Sie « Metadaten der Artikel » und legen Sie die Sprache des Artikels fest.'
    end,
    langue_inconnue = function(slug, brut)
      return 'Artikel « ' .. slug .. ' »: Sprache « ' .. brut .. ' » in ' .. slug ..
        '.meta.yaml unbekannt. Sprachen der Zeitschrift: fr, de, it.' ..
        ' Öffnen Sie « Metadaten der Artikel » und wählen Sie eine davon.'
    end,
    champ_vide = function(slug, lang, cle)
      return 'Artikel « ' .. slug .. ' »: die erklärte Sprache ist ' .. LA_LANGUE.de[lang] ..
        ', aber ' .. cle .. '.' .. lang .. ' ist leer. Öffnen Sie « Metadaten der Artikel » ' ..
        'und erfassen Sie ' .. NOM_CHAMP.de[cle] .. ' ' .. EN_LANGUE.de[lang] ..
        ', oder ändern Sie die Sprache des Artikels.'
    end,
    marque_motcle = function(slug, lang, rang)
      return 'Artikel « ' .. slug .. ' »: das Schlagwort Nr. ' .. rang .. ' von keywords.' ..
        lang .. ' steht noch auf der Marke « ' .. MARQUE ..
        ' ». Öffnen Sie « Metadaten der Artikel » und erfassen Sie es ' .. EN_LANGUE.de[lang] ..
        ', oder entfernen Sie die ganze Zeile — diese Marke würde auf der Titelseite erscheinen.'
    end,
    marque_champ = function(slug, lang, cle)
      return 'Artikel « ' .. slug .. ' »: ' .. cle .. '.' .. lang ..
        ' steht noch auf der Marke « ' .. MARQUE .. ' ». Öffnen Sie « Metadaten der Artikel » ' ..
        'und erfassen Sie ' .. NOM_CHAMP.de[cle] .. ' ' .. EN_LANGUE.de[lang] .. '.'
    end,
  },
}

-- Une ligne de constat, dans le format que le cockpit lit déjà pour l'import :
--
--   [meta-<ton>] <code> | <champ> | … | <phrase fr> | [de] <Satz de>
--
-- Le préfixe porte le TON — « blocage » quand la compilation s'arrête, « avertissement »
-- quand elle continue — et le deuxième champ un CODE stable. L'interface s'ancre sur ces
-- deux-là ; la prose n'est qu'un repli d'affichage, et se reformule sans rien casser.
-- « meta » est la famille : les métadonnées et la langue de l'article, telles que la vue
-- des contrôles les nomme déjà.
--
-- Les champs sont nommés (« article « … » », « champ « title » », « langue « de » »,
-- « motcle 3 ») : le cockpit y prend les substitutions de sa propre phrase, sans avoir à
-- compter des positions. Aucun ne contient de « | ».
local function chp_article(slug) return 'article « ' .. slug .. ' »' end
local function chp_langue(l)     return 'langue « ' .. l .. ' »' end
local function chp_champ(cle)    return 'champ « ' .. cle .. ' »' end
local function chp_motcle(rang)  return 'motcle ' .. rang end

local function ligne_constat(ton, code, champs, fr, de)
  local morceaux = { '[meta-' .. ton .. '] ' .. code }
  for _, c in ipairs(champs) do morceaux[#morceaux + 1] = c end
  morceaux[#morceaux + 1] = fr
  morceaux[#morceaux + 1] = '[de] ' .. de
  return table.concat(morceaux, ' | ')
end

local function avertir(code, champs, fr, de)
  io.stderr:write(ligne_constat('avertissement', code, champs, fr, de) .. '\n')
  io.stderr:flush()
end

-- Arrêt de la compilation. Le message part d'abord seul : `error()` seul l'enrobe d'un
-- « Error running filter » et d'une pile d'appels, illisibles dans le panneau. os.exit(1)
-- rend un code non nul et n'écrit aucun fichier de sortie ; l'`error` qui suit ne sert
-- que si un pandoc futur cessait d'honorer os.exit.
local function bloquer(code, champs, fr, de)
  io.stderr:write(ligne_constat('blocage', code, champs, fr, de) .. '\n')
  io.stderr:flush()
  os.exit(1, true)
  error(code, 0)
end

-- Champ localisé, dans la langue de l'article et dans elle seule. L'ancien repli
-- « première langue non vide » imprimait le titre français sous `lang="de"`, sans un mot
-- et au mépris de PDF/UA. Trois cas :
--   rempli dans la langue de l'article        -> la valeur ;
--   vide partout et champ facultatif          -> '' (le champ n'existe pas, c'est permis) ;
--   rempli dans une autre langue seulement,
--   ou champ obligatoire                      -> arrêt, message nommant le geste.
-- Facultatifs : subtitle et resume, qu'un éditorial ou une brève n'ont pas toujours.
-- Obligatoire : title, un article sans titre n'étant pas publiable — l'export OJS le
-- refuse déjà.
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

-- La marque tient la place d'un mot-clé non traduit : utile en atelier, désastreuse
-- imprimée. szh-maquette ne la connaissait pas et la recopiait en puce de couverture.
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
  local revue_val = S(meta.revue)
  local nom, issn, revue_lang = derive_revue(revue_val)
  local slug = slug_article()

  -- Langue du NUMÉRO : le jeton de revue, puis le `lang:` d'ausgabe.yaml. Ce `lang:` est
  -- relu dans le fichier et non dans `meta.lang`, que la fiche de l'article vient
  -- peut-être d'écraser — pandoc garde le dernier --metadata-file à clé égale.
  local lang_ausgabe = lire_cle(os.getenv('SZH_AUSGABE'), 'lang')
  if lang_ausgabe == '' then lang_ausgabe = S(meta.lang) end
  lang_ausgabe = lang_ausgabe:lower():sub(1, 2)
  local lang_num = revue_lang ~= '' and revue_lang
                   or (LANGUES[lang_ausgabe] and lang_ausgabe or 'fr')

  -- Langue de l'ARTICLE : elle prime sur tout. Absente, on retombe sur le numéro et on
  -- le dit — casser les articles existants serait pire que composer comme avant.
  local lang_art = langue_fiche(slug)
  local lang
  if lang_art == '' then
    if slug ~= '' then
      avertir('sans-langue', { chp_article(slug) },
        MESSAGES.fr.sans_langue(slug, lang_num), MESSAGES.de.sans_langue(slug, lang_num))
    end
    lang = lang_num
  elseif not LANGUES[lang_art] then
    bloquer('langue-inconnue', { chp_article(slug), chp_langue(lang_art) },
      MESSAGES.fr.langue_inconnue(slug, lang_art), MESSAGES.de.langue_inconnue(slug, lang_art))
  else
    lang = lang_art
  end

  verifier_marque(meta, slug)

  local type_art = S(meta.type)
  local dossier = lire_cle(os.getenv('SZH_AUSGABE'), 'title')

  -- Étiquette de dossier.
  local etiquette
  if TYPES_DOSSIER[type_art] then
    etiquette = dossier
  elseif LIBELLES[type_art] then
    etiquette = LIBELLES[type_art][lang] or LIBELLES[type_art].fr
  else
    etiquette = dossier   -- type absent/inconnu : dégradation propre
  end

  -- Ligne « Vol. X · N/année » (parties manquantes omises).
  local volume = S(meta.volume)
  local numero = S(meta.numero)
  local annee = annee_numero(S(meta.date))
  local droite = ''
  if numero ~= '' and annee ~= '' then droite = numero .. '/' .. annee
  elseif numero ~= '' then droite = numero
  elseif annee ~= '' then droite = annee end
  local vol_ligne = ''
  if volume ~= '' then vol_ligne = 'Vol. ' .. volume end
  if droite ~= '' then vol_ligne = (vol_ligne ~= '' and vol_ligne .. ' · ' or '') .. droite end

  -- Résumés (de/fr/it présents), langue de composition en premier.
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
      for _, mot in ipairs(km[l]) do
        table.insert(mots, pandoc.MetaString(S(mot)))
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
  meta['vol-ligne']        = pandoc.MetaString(vol_ligne)
  local titre = champ_localise(meta.title, lang, 'title', true, slug)
  meta['titre-affiche']    = pandoc.MetaString(titre)
  meta['sous-titre-affiche'] = pandoc.MetaString(
    champ_localise(meta.subtitle, lang, 'subtitle', false, slug))
  meta['resumes']          = pandoc.MetaList(resumes)
  local licence_texte, licence_url = licence_article(slug, lang)
  meta['licence-texte']    = pandoc.MetaString(licence_texte)
  -- Clé remise à nil quand il n'y a pas d'adresse : le gabarit teste `$if(licence-url)$`
  -- et imprime alors la mention sans lien ni flèche, plutôt qu'une URL inventée.
  meta['licence-url']      = licence_url ~= '' and pandoc.MetaString(licence_url) or nil
  -- Clé remise à nil quand elle est fausse : le template teste `$if(entete-condensee)$`,
  -- et une valeur présente mais fausse doit être indistinguable d'une clé absente.
  meta['entete-condensee'] = est_vrai(meta['entete-condensee']) or nil

  -- Bandeau DOI de la couverture ($if(doi)$ du template). Le meta.yaml ne porte plus de
  -- `doi:` que lorsqu'il a été défini À LA MAIN dans le cockpit (l'échappatoire « Définir
  -- manuellement le DOI ») : ce doi-là est déjà dans meta et gagne naturellement. Sinon,
  -- le DOI courant se lit dans le fichier dérivé du cockpit — voir doi_calcule_du_numero.
  -- Rien de trouvé : pas de bandeau, et jamais un blocage.
  if S(meta.doi) == '' then
    local doi_depose = doi_calcule_du_numero(slug)
    if doi_depose ~= '' then meta['doi'] = pandoc.MetaString(doi_depose) end
  end

  -- Métadonnées de document tirées du meta.yaml : <title> et <meta> HTML, /Title,
  -- /Author et /Lang du PDF (requis par PDF/UA). `pagetitle` évite l'avertissement
  -- pandoc « nonempty <title> » et le repli sur le slug.
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

        -- Variables dérivées par auteur pour le bloc « À propos » : les templates
        -- pandoc ne manipulent pas les chaînes, on mute donc la MetaMap de l'auteur,
        -- relue par le template via $author.…$.
        -- ORCID : identifiant nu (0000-0002-…) ou URL complète -> URL canonique
        -- https://orcid.org/<ID>, X final en majuscule. URL sans identifiant
        -- reconnaissable : reprise telle quelle ; autre valeur : pas de lien.
        local orcid = S(a.orcid)
        if orcid ~= '' then
          local id = orcid:match('(%d%d%d%d%-%d%d%d%d%-%d%d%d%d%-%d%d%d[%dxX])')
          if id then
            a['orcid-url'] = pandoc.MetaString('https://orcid.org/' .. id:upper())
          elseif orcid:match('^https?://') then
            a['orcid-url'] = pandoc.MetaString(orcid)
          end
        end
        -- Rang du portrait : il nomme la règle CSS que le gabarit écrit pour cette
        -- photo. Aucun texte alternatif n'est fabriqué ici, et le portrait n'est pas
        -- un <img> — pourquoi, c'est écrit dans print.css § 8.
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
  -- Titre du bloc auteurs, localisé.
  if #noms > 0 then
    meta['auteurs-titre'] = pandoc.MetaString(TITRES_AUTEURS[lang] or TITRES_AUTEURS.fr)
  end
  return meta
end
