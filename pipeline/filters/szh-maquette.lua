-- Calcule les variables de template de la maquette (couverture et en-tête courant) à
-- partir des clés d'ausgabe.yaml et de <slug>.meta.yaml : étiquette de dossier, nom et
-- ISSN de la revue, ligne « Vol. X · N/année », résumés, licence, titre du bloc auteurs,
-- et par auteur `orcid-url` et `photo-alt`. Aucune clé n'est inventée côté fichiers.
-- Le titre du DOSSIER (ausgabe.yaml `title`) est écrasé dans Meta par le `title` de
-- l'article, pandoc gardant le dernier fichier à clé égale : il est donc relu dans
-- ausgabe.yaml via la variable d'environnement SZH_AUSGABE, posée par le Makefile.

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

-- Titre du dossier depuis ausgabe.yaml (SZH_AUSGABE), sinon ''.
local function lire_titre_dossier()
  local chemin = os.getenv('SZH_AUSGABE')
  if not chemin or chemin == '' then return '' end
  local fh = io.open(chemin, 'r')
  if not fh then return '' end
  local titre = ''
  for ligne in fh:lines() do
    local m = ligne:match('^title:%s*(.*)$')
    if m then titre = parse_scalar(m); break end
  end
  fh:close()
  return titre
end

-- revue -> { nom, issn, lang }. Accepte le jeton canonique (zeitschrift/revue) et le
-- nom complet de l'ancien ausgabe.yaml. Valeur inconnue -> champ libre.
local function derive_revue(revue_val, meta_lang)
  local v = revue_val:lower()
  if v:find('zeitschrift') then
    return 'Schweizerische Zeitschrift für Heilpädagogik', '2813-4907', 'de'
  elseif v:find('revue') then
    return 'Revue suisse de pédagogie spécialisée', '2813-4915', 'fr'
  end
  local lang = (meta_lang ~= '' and meta_lang) or 'fr'
  return revue_val, '', lang
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

-- Bloc « À propos des auteur·e·s » : titre localisé accordé en nombre, et préfixe du
-- texte alternatif du portrait (PDF/UA-1 exige un alt sur toute image).
local TITRES_AUTEURS = {
  un   = { fr = "À propos de l'auteur·e",  de = 'Zur Autorin / zum Autor',
           it = "Sull'autrice / sull'autore" },
  plus = { fr = 'À propos des auteur·e·s', de = 'Zu den Autorinnen und Autoren',
           it = 'Sulle autrici e sugli autori' },
}
local ALT_PORTRAIT = { fr = 'Portrait de ', de = 'Porträt von ', it = 'Ritratto di ' }

-- Élision française : « Portrait d'Alice », pas « Portrait de Alice ». Voyelles ASCII
-- + Y, et voyelles majuscules accentuées (comparaison sur les 2 octets UTF-8). H exclu
-- volontairement : les prénoms germaniques à h aspiré dominent.
local VOYELLES_ACCENTUEES = {
  ['À']=true, ['Â']=true, ['Ä']=true, ['É']=true, ['È']=true, ['Ê']=true,
  ['Ë']=true, ['Î']=true, ['Ï']=true, ['Ô']=true, ['Ö']=true, ['Û']=true, ['Ü']=true,
}
local function elision_fr(nom)
  if nom:match('^[AEIOUYaeiouy]') then return true end
  return VOYELLES_ACCENTUEES[nom:sub(1, 2)] == true
end

-- Mention de licence CC-BY 4.0, localisée (couverture).
local LICENCES = {
  de = 'Dieser Artikel steht unter der Lizenz Creative Commons CC-BY 4.0',
  fr = 'Cet article est sous licence Creative Commons CC-BY 4.0',
  it = 'Questo articolo è pubblicato sotto licenza Creative Commons CC-BY 4.0',
}

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

-- Choisit map[lang] sinon la première langue non vide (ordre : lang, de, fr, it).
local function choisir(map, lang)
  if map == nil then return '' end
  local ordre = { lang, 'de', 'fr', 'it' }
  for _, l in ipairs(ordre) do
    local val = map[l]
    if val ~= nil then
      local s = S(val)
      if s ~= '' then return s end
    end
  end
  return ''
end

function Meta(meta)
  local revue_val = S(meta.revue)
  local meta_lang = S(meta.lang)
  local nom, issn, revue_lang = derive_revue(revue_val, meta_lang)
  -- Langue de composition : la revue prime, sinon la langue du numéro.
  local lang = revue_lang ~= '' and revue_lang or (meta_lang ~= '' and meta_lang or 'fr')

  local type_art = S(meta.type)
  local dossier = lire_titre_dossier()

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
  local annee = S(meta.date):match('%d%d%d%d') or ''
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
  meta['titre-affiche']    = pandoc.MetaString(choisir(meta.title, lang))
  meta['sous-titre-affiche'] = pandoc.MetaString(choisir(meta.subtitle, lang))
  meta['resumes']          = pandoc.MetaList(resumes)
  meta['licence-texte']    = pandoc.MetaString(LICENCES[lang] or LICENCES.fr)
  -- Clé remise à nil quand elle est fausse : le template teste `$if(entete-condensee)$`,
  -- et une valeur présente mais fausse doit être indistinguable d'une clé absente.
  meta['entete-condensee'] = est_vrai(meta['entete-condensee']) or nil

  -- Métadonnées de document tirées du meta.yaml : <title> et <meta> HTML, /Title,
  -- /Author et /Lang du PDF (requis par PDF/UA). `pagetitle` évite l'avertissement
  -- pandoc « nonempty <title> » et le repli sur le slug.
  local titre = choisir(meta.title, lang)
  meta['pagetitle'] = pandoc.MetaString(titre)
  meta['lang'] = pandoc.MetaString(lang)
  meta['description'] = pandoc.MetaString(choisir(meta.resume, lang))
  local noms = {}
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
        local complet = p
        if n ~= '' then complet = (p ~= '' and (p .. ' ') or '') .. n end
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
        -- Texte alternatif du portrait (requis par PDF/UA-1), élision en français.
        if S(a.photo) ~= '' then
          local prefixe = ALT_PORTRAIT[lang] or ALT_PORTRAIT.fr
          if prefixe == ALT_PORTRAIT.fr and elision_fr(complet) then
            prefixe = "Portrait d'"
          end
          a['photo-alt'] = pandoc.MetaString(prefixe .. complet)
        end
      else
        nm = S(a)
      end
      if nm ~= '' then table.insert(noms, pandoc.MetaString(nm)) end
    end
  end
  meta['auteurs-noms'] = pandoc.MetaList(noms)
  -- Titre du bloc auteurs, localisé et accordé en nombre.
  if #noms > 0 then
    local forme = (#noms == 1) and TITRES_AUTEURS.un or TITRES_AUTEURS.plus
    meta['auteurs-titre'] = pandoc.MetaString(forme[lang] or forme.fr)
  end
  return meta
end
