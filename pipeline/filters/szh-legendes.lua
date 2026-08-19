-- szh-legendes.lua — import (AX5/D28-D30, ravivé de attic/szh-import.lua ; élargi F6).
-- « Bake » les légendes dans le .md à l'import (ré-import assumé) :
--   * FIGURES : une image seule dans un Para + un paragraphe VOISIN légende (avant OU
--     après) -> l'image reçoit cette légende comme LÉGENDE (numéro « Figure N »
--     nettoyé), et le paragraphe est RETIRÉ. Au rendu, szh-figure.lua en fait un
--     <figure><figcaption>. Un voisin est une légende si :
--       - il est tout en gras (heuristique historique), OU
--       - docx-meta.py l'a identifié PAR STYLE (Abbildung Beschriftung, Caption… —
--         style que pandoc perd) : lignes « F<TAB>texte » de $SZH_META, OU
--       - il commence par « Figure N » / « Abbildung N » AVEC séparateur ( : . - ) —
--         séparateur exigé pour ne pas prendre « Figure 1 montre… » pour une légende.
--   * TABLEAUX : docx-tables.py a déjà baké le <caption> dans tables/table-NN.html
--     et consigné le texte des légendes prises (SZH_LEGENDES_TABLES) -> ici on
--     RETIRE simplement les paragraphes correspondants du .md (pas de doublon).
--     L'appariement se fait au TEXTE exact : le paragraphe n'a pas besoin d'être
--     gras (les légendes stylées « Tabelle Beschriftung » ne le sont pas).
--   * TEXTE ALTERNATIF (D104) : Word connaît DÉJÀ l'alt des images — l'auteur l'a
--     saisi dans « Texte de remplacement » et Word l'écrit dans wp:docPr/@descr.
--     Le lecteur docx de pandoc le met dans la DESCRIPTION de l'Image. Jusqu'ici
--     l'import l'ÉCRASAIT par la légende ; on le récupère désormais et on l'écrit
--     en {alt="…"} : le writer markdown produit `![Légende](media/x.png){alt="…"}`,
--     exactement le contrat de format lu par szh-numerotation.lua à la compilation.
--     Une image SANS légende voit aussi sa description passer en {alt="…"} : sinon
--     l'extension implicit_figures en ferait une LÉGENDE VISIBLE au rendu (un texte
--     alternatif affiché sous l'image — c'est le contraire de ce qu'on veut).
-- CONSERVATEUR : sans légende voisine claire, l'image/tableau reste tel quel.
-- Idempotent : sans voisin légende et sans sidecar, le document est renvoyé inchangé.

local utils = pandoc.utils

local function assainir(t)
  t = t:gsub('\194\160', ' '):gsub('\226\128\175', ' '):gsub('\226\128\137', ' ')
  t = t:gsub('\226\128\147', '-'):gsub('\226\128\148', '-'):gsub('\226\128\145', '-')
  return t
end
local function trim(t) return (t:gsub('^%s+', ''):gsub('%s+$', '')) end
local function s(x) return assainir(utils.stringify(x)) end
-- normalisation IDENTIQUE à docx-tables.py / docx-meta.py (appariement).
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

-- Nettoyage du numéro de figure en tête de légende : le numéro manuel du Word est
-- retiré ici, il est reposé à la compilation par szh-numerotation.lua (D31).
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

-- Motif STRICT « Figure N » + séparateur OBLIGATOIRE (voisin ni gras ni stylé) —
-- l'assainissement a déjà réduit – — ‑ à '-'.
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

-- Cas soudé (F6, observé 2x dans le corpus) : légende ET image dans le MÊME
-- paragraphe (« Abbildung 3: … !\[image\] »). Si le texte qui précède l'image
-- porte le motif STRICT de légende, on renvoie (texte, image) — l'image devient
-- un paragraphe propre avec la légende en alt.
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

-- ─── Texte alternatif venu de Word (D104) ─────────────────────────────────────
-- Descriptions AUTOMATIQUES de Word/Copilot, très présentes dans le corpus réel :
-- « Ein Bild, das Text, Person enthält.  Automatisch generierte Beschreibung ».
-- Ce n'est PAS du texte alternatif : c'est du remplissage machine, souvent faux,
-- jamais rédigé pour un lecteur. L'importer donnerait une fausse impression
-- d'accessibilité sur des dizaines d'articles — on le jette, l'image reste sans
-- alt (donc décorative au rendu) jusqu'à ce qu'un humain en écrive un.
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

-- Déplace la description de l'image (= le descr de Word) vers l'attribut alt, et
-- VIDE la description pour laisser la place à la légende. Renvoie 1 si un alt a
-- été posé. Le texte est normalisé : le contrat interdit le saut de ligne dans un
-- attribut, et Word met volontiers des retours à la ligne dans un descr.
-- Rejeté si : vide, automatique, ou identique à la légende (le dupliquer
-- n'apporterait rien et ferait annoncer deux fois la même phrase).
local function alt_depuis_word(img, legende)
  local descr = normaliser(s(img.caption))
  img.caption = pandoc.Inlines({})
  if descr == '' or alt_automatique(descr) then return 0 end
  if legende and descr:lower() == normaliser(legende):lower() then return 0 end
  img.attributes['alt'] = descr
  return 1
end

-- Un Para dont le SEUL contenu significatif est une image -> renvoie l'image.
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
  --    texte exact du sidecar — gras non requis : légendes stylées comprises)
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
        -- Image seule SANS légende : sa description est le descr de Word, pas une
        -- légende. La laisser là en ferait une <figcaption> visible au rendu
        -- (implicit_figures) — on la déplace en {alt="…"}, ou on la jette si elle
        -- est automatique.
        nalt = nalt + alt_depuis_word(img, nil)
        sortie:insert(pandoc.Para({ img }))
      end
    else
      sortie:insert(b)
    end
    ::continue::
  end

  -- 3) Balayage final : une description AUTOMATIQUE de Word survit partout où les
  --    règles ci-dessus ne passent pas — typiquement une vignette dans un lien
  --    (`[![descr](img)](url)`, rubrique « Actualités »), qui n'est pas un
  --    para_image. La jeter ici aussi : partout dans la chaîne, du remplissage
  --    machine vaut moins que rien (il serait annoncé comme le nom de l'image).
  --    No-op sur tout ce qui a déjà été traité au-dessus.
  --    (pandoc.Blocks() : `sortie` est une pandoc.List générique, sans :walk).
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
