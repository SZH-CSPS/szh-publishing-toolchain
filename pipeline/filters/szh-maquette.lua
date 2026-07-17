-- szh-maquette.lua — dérive les métadonnées de la maquette (couverture + en-tête
-- courant) à partir des clés EXISTANTES des sérialiseurs de l'extension
-- (ausgabe.yaml + <slug>.meta.yaml). Aucune clé inventée côté fichiers ; ce filtre
-- ne fait que CALCULER des variables de template (pas de JS au rendu).
--
-- Décisions couvertes :
--   D71 — étiquette de dossier selon le type d'article.
--   D74 — `revue` (choix fermé) -> nom + ISSN + langue par défaut.
--
-- Le titre du DOSSIER (ausgabe.yaml `title`) est écrasé dans Meta par le `title`
-- (map de/fr/it) de l'article : Pandoc, à clé égale, garde le dernier fichier.
-- On le relit donc dans ausgabe.yaml via la variable d'environnement SZH_AUSGABE
-- (posée par le Makefile) — la seule clé en collision.

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

-- D74 : revue -> { nom, issn, lang }. Accepte le jeton canonique (zeitschrift/revue)
-- ET le nom complet (rétrocompat de l'ancien ausgabe.yaml). Inconnu -> champ libre.
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

-- D71 : libellés localisés des types HORS dossier (repris de LIBELLES_TYPES de
-- l'extension ; de/it PREMIER JET à valider par Robin).
local LIBELLES = {
  ['varia']         = { fr = 'Varia',         de = 'Varia',         it = 'Varia' },
  ['documentation'] = { fr = 'Documentation', de = 'Dokumentation', it = 'Documentazione' },
  ['tribune-libre'] = { fr = 'Tribune libre', de = 'Freie Tribüne', it = 'Tribuna libera' },
}
local TYPES_DOSSIER = { article = true, editorial = true, interview = true }

local LABELS_RESUME = { de = 'Zusammenfassung', fr = 'Résumé', it = 'Riassunto' }
local ORDRE_LANGUES = { 'de', 'fr', 'it' }

-- Mention de licence CC-BY 4.0, localisée (couverture).
local LICENCES = {
  de = 'Dieser Artikel steht unter der Lizenz Creative Commons CC-BY 4.0',
  fr = 'Cet article est sous licence Creative Commons CC-BY 4.0',
  it = 'Questo articolo è pubblicato sotto licenza Creative Commons CC-BY 4.0',
}

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
  -- Langue de composition : la revue (D74) prime, sinon la langue du numéro.
  local lang = revue_lang ~= '' and revue_lang or (meta_lang ~= '' and meta_lang or 'fr')

  local type_art = S(meta.type)
  local dossier = lire_titre_dossier()

  -- Étiquette de dossier (D71).
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
  meta['annee']            = pandoc.MetaString(annee)
  meta['titre-affiche']    = pandoc.MetaString(choisir(meta.title, lang))
  meta['sous-titre-affiche'] = pandoc.MetaString(choisir(meta.subtitle, lang))
  meta['resumes']          = pandoc.MetaList(resumes)
  meta['licence-texte']    = pandoc.MetaString(LICENCES[lang] or LICENCES.fr)

  -- Métadonnées de document tirées du meta.yaml de l'article : <title> + <meta>
  -- HTML ET /Title, /Author, /Lang du PDF (requis pour PDF/UA). `pagetitle` évite
  -- l'avertissement pandoc « nonempty <title> » + le repli sur le slug.
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
      else
        nm = S(a)
      end
      if nm ~= '' then table.insert(noms, pandoc.MetaString(nm)) end
    end
  end
  meta['auteurs-noms'] = pandoc.MetaList(noms)
  return meta
end
