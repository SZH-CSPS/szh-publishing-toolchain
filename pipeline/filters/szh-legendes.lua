-- Import : « bake » les légendes dans le .md.
--   * figures : une image seule dans un Para, avec un paragraphe voisin légende (avant ou
--     après), reçoit cette légende ; le paragraphe est retiré et szh-figure.lua en fera un
--     <figure><figcaption>. Un voisin est une légende s'il est tout en gras, si
--     docx-meta.py l'a identifié par style (lignes « F<TAB>texte » de SZH_META), ou s'il
--     commence par « Figure N » suivi d'un séparateur — exigé pour ne pas prendre
--     « Figure 1 montre… » pour une légende.
--   * tableaux : docx-tables.py a déjà baké le <caption> et consigné le texte des légendes
--     prises (SZH_LEGENDES_TABLES) ; on retire ici les paragraphes correspondants du .md,
--     par appariement au texte exact, gras non requis.
--   * texte alternatif : Word range l'alt de l'auteur dans wp:docPr/@descr, que le lecteur
--     docx met dans la description de l'Image. On le déplace en {alt="…"}, contrat lu par
--     szh-numerotation.lua. Une image sans légende y passe aussi, sinon implicit_figures
--     en ferait une légende visible au rendu.
-- Conservateur : sans légende voisine claire, l'image ou le tableau reste tel quel.

local utils = pandoc.utils

local function assainir(t)
  t = t:gsub('\194\160', ' '):gsub('\226\128\175', ' '):gsub('\226\128\137', ' ')
  t = t:gsub('\226\128\147', '-'):gsub('\226\128\148', '-'):gsub('\226\128\145', '-')
  return t
end
local function trim(t) return (t:gsub('^%s+', ''):gsub('%s+$', '')) end
local function s(x) return assainir(utils.stringify(x)) end
-- Normalisation à garder identique à docx-tables.py et docx-meta.py (appariement).
local function normaliser(t)
  return (assainir(t):gsub('%s+', ' '):gsub('^%s+', ''):gsub('%s+$', ''))
end

-- Un ensemble d'inlines est-il ENTIÈREMENT en gras (hors espaces) ?
local function tout_gras(inls)
  local reel = 0
  for _, i in ipairs(inls) do
    if i.t ~= 'Space' and i.t ~= 'SoftBreak' then
      if i.t ~= 'Strong' then return false end
      reel = reel + 1
    end
  end
  return reel > 0
end

-- Nettoyage du numéro de figure en tête de légende : le numéro manuel du Word part
-- ici, szh-numerotation.lua le repose à la compilation.
local MOTS_FIGURE = { '^[Ff]igure%s+%d+[a-z]?%s*[:%.%-–—]?%s*',
                      '^[FfAa]bb?%.%s*%d+[a-z]?%s*[:%.%-–—]?%s*',
                      '^[Aa]bbildung%s+%d+[a-z]?%s*[:%.%-–—]?%s*',
                      '^[Ii]llustration%s+%d+[a-z]?%s*[:%.%-–—]?%s*',
                      '^[Gg]rafik%s+%d+[a-z]?%s*[:%.%-–—]?%s*' }
local function nettoyer_figure(txt)
  for _, m in ipairs(MOTS_FIGURE) do
    if txt:match(m) then return trim(txt:gsub(m, '', 1)) end
  end
  return txt
end

-- Motif strict « Figure N » + séparateur obligatoire, pour un voisin ni gras ni
-- stylé — l'assainissement a déjà réduit – — ‑ à '-'.
local MOTS_FIGURE_STRICTS = { '^[Ff]igure%s+%d+[a-z]?%s*[:%.%-]',
                              '^[FfAa]bb?%.%s*%d+[a-z]?%s*[:%.%-]',
                              '^[Aa]bbildung%s+%d+[a-z]?%s*[:%.%-]',
                              '^[Ii]llustration%s+%d+[a-z]?%s*[:%.%-]',
                              '^[Gg]rafik%s+%d+[a-z]?%s*[:%.%-]' }
local function motif_figure_strict(txt)
  local n = 0
  for _ in txt:gmatch('%S+') do n = n + 1 end
  if n > 50 then return false end
  for _, m in ipairs(MOTS_FIGURE_STRICTS) do
    if txt:match(m) then return true end
  end
  return false
end

-- Cas soudé : légende et image dans le même paragraphe (« Abbildung 3: … !\[image\] »).
-- Si le texte qui précède l'image porte le motif strict de légende, on renvoie
-- (texte, image) et l'image devient un paragraphe propre.
local function para_legende_et_image(b)
  if b.t ~= 'Para' then return nil end
  local img, texte = nil, {}
  for _, x in ipairs(b.content) do
    if x.t == 'Image' then
      if img then return nil end             -- plusieurs images : ne pas toucher
      img = x
    elseif img then
      return nil                             -- du texte APRÈS l'image : autre chose
    else
      texte[#texte + 1] = x
    end
  end
  if not img or #texte == 0 then return nil end
  local brut = trim(s(pandoc.Plain(texte)))
  if brut == '' or not motif_figure_strict(brut) then return nil end
  return brut, img
end

-- ─── Texte alternatif venu de Word ───────────────────────────────────────────
-- Les descriptions automatiques de Word et de Copilot (« Automatisch generierte
-- Beschreibung ») ne sont pas du texte alternatif : les importer donnerait une fausse
-- impression d'accessibilité. On les jette, l'image reste sans alt — donc décorative
-- au rendu — jusqu'à ce qu'un humain en écrive un.
local MARQUEURS_AUTO = {
  'automatisch generierte beschreibung',
  'automatisch erstellte beschreibung',
  'ki%-generierte inhalte',
  'description g[eé]n[eé]r[eé]e automatiquement',
  'contenu g[eé]n[eé]r[eé] par',
  'automatically generated description',
  'ai%-generated content',
}
local function alt_automatique(txt)
  local bas = txt:lower()
  for _, m in ipairs(MARQUEURS_AUTO) do
    if bas:find(m) then return true end
  end
  return false
end

-- Déplace la description de l'image (le descr de Word) vers l'attribut alt et vide la
-- description pour laisser la place à la légende. Renvoie 1 si un alt a été posé. Le
-- texte est normalisé : un attribut n'admet pas de saut de ligne, et Word en met
-- volontiers. Rejeté si vide, automatique, ou identique à la légende.
local function alt_depuis_word(img, legende)
  local descr = normaliser(s(img.caption))
  img.caption = pandoc.Inlines({})
  if descr == '' or alt_automatique(descr) then return 0 end
  if legende and descr:lower() == normaliser(legende):lower() then return 0 end
  img.attributes['alt'] = descr
  return 1
end

-- Un Para dont le seul contenu significatif est une image -> renvoie l'image.
local function para_image(b)
  if b.t ~= 'Para' then return nil end
  local img = nil
  for _, x in ipairs(b.content) do
    if x.t == 'Image' then
      if img then return nil end             -- plusieurs images : ne pas toucher
      img = x
    elseif x.t ~= 'Space' and x.t ~= 'SoftBreak' then
      return nil
    end
  end
  return img
end

local function charger_legendes_table()
  local ens = {}
  local chemin = os.getenv('SZH_LEGENDES_TABLES')
  if not chemin or chemin == '' then return ens end
  local f = io.open(chemin, 'r')
  if not f then return ens end
  for ligne in f:lines() do
    local clef = normaliser(ligne)
    if clef ~= '' then ens[clef] = true end
  end
  f:close()
  return ens
end

-- Légendes de figure détectées PAR STYLE par docx-meta.py (lignes F de $SZH_META).
local function charger_legendes_figures()
  local ens = {}
  local chemin = os.getenv('SZH_META')
  if not chemin or chemin == '' then return ens end
  local f = io.open(chemin, 'r')
  if not f then return ens end
  for ligne in f:lines() do
    local texte = ligne:match('^F\t(.*)$')
    if texte then
      local clef = normaliser(texte)
      if clef ~= '' then ens[clef] = true end
    end
  end
  f:close()
  return ens
end

function Pandoc(doc)
  local legT = charger_legendes_table()
  local legF = charger_legendes_figures()
  local nfig, ntab, nalt = 0, 0, 0

  -- 1) retirer les paragraphes déjà bakés en <caption> de tableau (appariement au
  --    texte exact du sidecar, gras non requis)
  local blocs = pandoc.List()
  for _, b in ipairs(doc.blocks) do
    if b.t == 'Para' and next(legT) ~= nil and legT[normaliser(s(b))] then
      ntab = ntab + 1                         -- retiré du .md
    else
      blocs:insert(b)
    end
  end

  -- 2) figures : image seule + légende voisine (avant, puis après)
  local consommes = {}
  local sortie = pandoc.List()
  for idx, b in ipairs(blocs) do
    if consommes[idx] then goto continue end
    -- cas soudé : « Légende : … [image] » dans un seul paragraphe
    local cap_soude, img_soude = para_legende_et_image(b)
    if cap_soude then
      local propre = trim(nettoyer_figure(cap_soude))
      if propre ~= '' then
        nalt = nalt + alt_depuis_word(img_soude, propre)
        img_soude.caption = pandoc.Inlines({ pandoc.Str(propre) })
        sortie:insert(pandoc.Para({ img_soude }))
        nfig = nfig + 1
        goto continue
      end
    end
    local img = para_image(b)
    if img then
      local cap, capidx = nil, nil
      for _, j in ipairs({ idx - 1, idx + 1 }) do
        local v = blocs[j]
        if v and v.t == 'Para' and not consommes[j] and not para_image(v) then
          local texte = s(v)
          if tout_gras(v.content) or legF[normaliser(texte)]
             or motif_figure_strict(trim(texte)) then
            cap = trim(nettoyer_figure(trim(texte)))
            capidx = j
            break
          end
        end
      end
      if cap and cap ~= '' then
        consommes[capidx] = true
        if capidx == idx - 1 then sortie:remove(#sortie) end
        nalt = nalt + alt_depuis_word(img, cap)             -- descr Word -> {alt="…"}
        img.caption = pandoc.Inlines({ pandoc.Str(cap) })   -- description = légende
        sortie:insert(pandoc.Para({ img }))
        nfig = nfig + 1
      else
        -- Image seule sans légende : sa description est le descr de Word, pas une
        -- légende. La laisser là en ferait une <figcaption> visible au rendu
        -- (implicit_figures) ; on la déplace en {alt="…"}, ou on la jette si elle
        -- est automatique.
        nalt = nalt + alt_depuis_word(img, nil)
        sortie:insert(pandoc.Para({ img }))
      end
    else
      sortie:insert(b)
    end
    ::continue::
  end

  -- 3) Balayage final : une description automatique de Word survit là où les règles
  --    ci-dessus ne passent pas, typiquement une vignette dans un lien
  --    (`[![descr](img)](url)`), qui n'est pas un para_image. On la jette ici aussi.
  --    No-op sur ce qui a déjà été traité au-dessus.
  --    (pandoc.Blocks() : `sortie` est une pandoc.List générique, sans :walk.)
  doc.blocks = pandoc.Blocks(sortie):walk({
    Image = function(img)
      local descr = trim(s(img.caption))
      if descr ~= '' and alt_automatique(descr) then
        img.caption = pandoc.Inlines({})
        return img
      end
      return nil
    end,
  })
  io.stderr:write(string.format(
    '[import] %d figure(s) légendée(s), %d tableau(x) légendé(s), '
    .. '%d texte(s) alternatif(s) repris de Word\n', nfig, ntab, nalt))
  return doc
end
