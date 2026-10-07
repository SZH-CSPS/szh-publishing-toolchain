-- Livre seulement : pose en tête du chapitre le titre lu dans sa fiche <slug>.meta.yaml
-- (clé `title`, par langue), en <h1>, comme si le .md commençait par « # Titre ». Les
-- filtres suivants (niveaux, numéro de section, ancre) et le sommaire de
-- livre-assembler.py le voient comme un titre ordinaire.
--
-- Premier filtre de FILTRES_CHAPITRE : szh-niveaux.lua, szh-sections.lua et
-- szh-numerotation.lua s'appuient sur le premier titre de niveau 1.
--
-- Un chapitre dont le .md porte encore son « # Titre » (livre non migré par
-- livre-migrer-meta.py) garde ce titre ; la fiche n'est pas lue.
--
-- `title` est une table par langue (`fr:`, `de:`…) ou une chaîne. La langue est celle du
-- chapitre : `lang` de la fiche, sinon buch.yaml. Si cette langue est vide dans la table,
-- le filtre prend la première langue remplie et le signale.
--
-- Un « // » dans le titre est un retour à la ligne forcé (LineBreak dans le <h1>). L'ancre
-- se calcule sur le titre plat ; livre-assembler.py lit un <br> comme une espace.
--
-- Ne tourne que sur un chapitre (SZH_CHAPITRE posé par livre.mk) : les pièces liminaires
-- et la 4e de couverture n'ont pas de fiche.

-- Module commun. Sans lui le filtre ne peut pas travailler : la compilation s'arrête.
local commun
do
  local function dossier_ce_fichier()
    local source = debug.getinfo(1, 'S').source
    if source:sub(1, 1) == '@' then source = source:sub(2) end
    return source:match('^(.*[/\\])') or ''
  end
  local ok, module = pcall(dofile, dossier_ce_fichier() .. 'szh-commun.lua')
  if not ok or type(module) ~= 'table' then
    io.stderr:write('[livre-titre] szh-commun.lua introuvable ou fautif (' ..
      tostring(module) .. ') : ce filtre ne peut pas composer sans lui, arrêt.\n')
    os.exit(1, true)
    error('szh-commun.lua manquant', 0)
  end
  commun = module
end

local CHAPITRE = os.getenv('SZH_CHAPITRE') or ''

local texte = commun.texte

-- Même règle que szh_commun.titre_lignes() en Python : « A // B » -> {'A', 'B'}.
local function titre_lignes(s)
  local lignes = {}
  for l in (s .. ' // '):gmatch('(.-)%s*//%s*') do
    l = l:gsub('^%s+', ''):gsub('%s+$', '')
    if l ~= '' then lignes[#lignes + 1] = l end
  end
  return lignes
end

local function langue_de(meta)
  return commun.contexte(meta).lang
end

-- Le titre dans la langue du chapitre. Rend (titre, langue_utilisee).
local function titre_de(meta)
  local t = meta and meta.title
  if t == nil then return '' end
  local lang = langue_de(meta)
  -- Chaîne seule ou texte en ligne : pas de table de langues.
  local genre = pandoc.utils.type(t)
  if genre == 'Inlines' or genre == 'Blocks' or genre == 'string' then
    return texte(t), lang
  end
  local propre = texte(t[lang])
  if propre ~= '' then return propre, lang end
  for _, l in ipairs({ 'fr', 'de', 'it', 'en' }) do
    local autre = texte(t[l])
    if autre ~= '' then return autre, l end
  end
  return '', lang
end

function Pandoc(doc)
  if commun.contexte(doc.meta).produit ~= 'livre' or CHAPITRE == '' then return doc end

  local deja = false
  doc.blocks:walk({ Header = function(h) if h.level == 1 then deja = true end end })
  if deja then return doc end

  local titre, langue_titre = titre_de(doc.meta)
  if titre == '' then return doc end
  if langue_titre ~= langue_de(doc.meta) then
    local slug, lang = texte(doc.meta.slug), langue_de(doc.meta)
    commun.constat('livre', 'avertissement', 'titre-autre-langue',
      { string.format('chapitre « %s »', slug) },
      string.format('Le titre du chapitre est vide en %s dans sa fiche : celui de la langue « %s » est imprimé à la place.', lang, langue_titre),
      string.format('Der Kapiteltitel ist in der Fiche auf %s leer: stattdessen wird der Titel in « %s » gedruckt.', lang, langue_titre))
  end

  -- Le titre est lu par le lecteur markdown, comme un « # Titre » du .md : emphase,
  -- marques de langue et identifiant d'ancre en viennent. Toujours sur une seule ligne.
  local ligne = titre:gsub('%s*[\r\n]+%s*', ' ')
  local lignes = titre_lignes(ligne)
  local plat = table.concat(lignes, ' ')
  local avec_saut = #lignes > 1
  -- Le saut passe par un mot sans ponctuation, que le lecteur laisse intact.
  local JETON = 'SZHSAUTLIGNE'
  local source = avec_saut and table.concat(lignes, JETON) or ligne
  local ok, lu = pcall(pandoc.read, '# ' .. source, 'markdown')
  local h = ok and lu and lu.blocks[1]
  if not h or h.t ~= 'Header' then
    h = pandoc.Header(1, { pandoc.Str(source) })
  end
  if avec_saut then
    h.content = h.content:walk({
      Str = function(s)
        if not s.text:find(JETON, 1, true) then return nil end
        local sortie = pandoc.List()
        local rang = 1
        while true do
          local a, b = s.text:find(JETON, rang, true)
          if not a then break end
          if a > rang then sortie:insert(pandoc.Str(s.text:sub(rang, a - 1))) end
          sortie:insert(pandoc.LineBreak())
          rang = b + 1
        end
        if rang <= #s.text then sortie:insert(pandoc.Str(s.text:sub(rang))) end
        return sortie
      end })
    -- L'ancre vient du titre plat, sans le jeton.
    local okp, luplat = pcall(pandoc.read, '# ' .. plat, 'markdown')
    local hp = okp and luplat and luplat.blocks[1]
    h.identifier = (hp and hp.t == 'Header') and hp.identifier or ''
  end

  -- L'ancre peut déjà exister : le lecteur, qui a lu le .md sans ce titre, a pu donner le
  -- même identifiant à une section de même texte.
  local pris = {}
  doc.blocks:walk({ Header = function(x) if x.identifier ~= '' then pris[x.identifier] = true end end })
  if h.identifier == '' or pris[h.identifier] then
    local base = h.identifier ~= '' and h.identifier or 'chapitre'
    local id, n = base .. '-chapitre', 1
    while pris[id] do n = n + 1; id = base .. '-chapitre-' .. n end
    h.identifier = id
  end

  doc.blocks:insert(1, h)
  return doc
end
