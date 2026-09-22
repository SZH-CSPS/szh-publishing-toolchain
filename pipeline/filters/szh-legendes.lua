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
--   * bloc Figure : quand la légende Word porte le STYLE de légende, le lecteur docx ne
--     rend pas deux paragraphes voisins mais un seul bloc `Figure`, légende comprise. On
--     l'aplatit ici en la forme unique du .md — un Para d'image, description = légende,
--     descr de Word en {alt="…"}. Voir ci-dessous pourquoi ce n'est pas cosmétique.
-- Conservateur : sans légende voisine claire, l'image ou le tableau reste tel quel.
--
-- POURQUOI APLATIR LES `Figure` N'EST PAS UN DÉTAIL.
--
-- Le writer markdown ne sait écrire une Figure en `![légende](img){…}` que si la légende
-- du bloc et la description de l'image sont IDENTIQUES. Sur une figure venue de Word
-- elles ne le sont jamais : la description est l'alt de l'auteur, la légende est la
-- phrase « Figure 1 : … ». Le writer renonce alors au markdown et écrit du HTML brut
--     <figure><img src=… alt=…><figcaption><p>…</p></figcaption></figure>
-- au milieu du .md. Rien ne l'annonce. Le rédacteur ne peut plus toucher à la légende
-- dans l'éditeur, szh-numerotation.lua ne numérote pas ce qu'il ne reconnaît pas, et le
-- numéro manuel « Figure 1 : » de Word reste figé. Constaté sur pandoc 3.5, celui de la
-- machine de production ; pandoc 3.9 écrit le markdown attendu — un import dépendait donc
-- silencieusement de la version installée. L'aplatissement rend le résultat identique
-- partout.

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

-- Un ensemble d'inlines est-il entièrement en gras (hors espaces) ?
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

-- ─── Bloc Figure du lecteur docx -> la forme unique du .md ───────────────────
-- Rend (image, légende) d'une Figure réductible : un seul bloc, une seule image, rien
-- d'autre que des blancs autour. Une Figure qui contient deux images ou du texte n'est
-- pas réductible — on la laisse telle quelle plutôt que d'en perdre une partie.
-- L'identifiant de la Figure passe sur l'image : c'est lui que visent les renvois
-- internes du Word, et le .md ne garde plus d'autre endroit où le poser.
local function figure_a_plat(f)
  if #f.content ~= 1 then return nil end
  local seul = f.content[1]
  if seul.t ~= 'Plain' and seul.t ~= 'Para' then return nil end
  local img = nil
  for _, x in ipairs(seul.content) do
    if x.t == 'Image' then
      if img then return nil end
      img = x
    elseif x.t ~= 'Space' and x.t ~= 'SoftBreak' then
      return nil
    end
  end
  if not img then return nil end
  if f.identifier and f.identifier ~= '' and img.identifier == '' then
    img.identifier = f.identifier
  end
  -- Le numéro manuel du Word part ici, szh-numerotation.lua le repose à la compilation.
  return img, trim(nettoyer_figure(trim(s(f.caption.long))))
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

-- Légendes de figure détectées par style par docx-meta.py (lignes F de $SZH_META).
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

-- ─── Blocs figure du gabarit « Pronto » ──────────────────────────────────────
-- Le lecteur du gabarit (pipeline/pronto-lire.py) écrit une ligne FI par bloc figure :
--   FI<TAB>nom1|nom2<TAB>légende<TAB>texte alternatif<TAB>crédit<TAB>source
-- Les quatre valeurs sont celles que l'autrice ou l'auteur a TAPÉES dans le document, sous
-- les étiquettes « Légende : », « Texte alternatif : », « Crédit : », « Source : » ; les
-- paragraphes qui les portaient ont déjà quitté le corps (lignes P, szh-meta.lua, qui tourne
-- avant ce filtre). Sans cette reprise, ils s'imprimeraient tels quels au milieu de l'article
-- et le texte alternatif serait perdu — mesuré sur le gabarit réel avant le branchement.
--
-- PLUSIEURS noms de fichier par bloc, et non un rang : Word range une image vectorielle
-- derrière un aperçu PNG, le lecteur voit le PNG et pandoc écrit le SVG (voir
-- images_de_paragraphe() de pronto_docx.py). On apparie donc sur le nom, en acceptant toutes
-- les variantes — un rang se décalerait au premier paragraphe d'image de plus.
local function charger_blocs_pronto()
  local par_nom = {}
  local chemin = os.getenv('SZH_META')
  if not chemin or chemin == '' then return par_nom end
  local f = io.open(chemin, 'r')
  if not f then return par_nom end
  for ligne in f:lines() do
    local reste = ligne:match('^FI\t(.*)$')
    if reste then
      local champs = {}
      for champ in (reste .. '\t'):gmatch('([^\t]*)\t') do champs[#champs + 1] = champ end
      local bloc = { legende = trim(champs[2] or ''), alt = trim(champs[3] or ''),
                     credit = trim(champs[4] or ''), source = trim(champs[5] or '') }
      for nom in (champs[1] or ''):gmatch('[^|]+') do par_nom[nom] = bloc end
    end
  end
  f:close()
  return par_nom
end

-- Nom de fichier seul d'un src d'image : les chemins du .md sont relatifs (media/…, ./media/…)
-- et le lecteur, lui, ne connaît que le nom sous media/.
local function base_fichier(chemin)
  return (tostring(chemin):gsub('[?#].*$', ''):gsub('^.*[/\\]', ''))
end

-- Pose les quatre champs d'un bloc Pronto sur son image. Renvoie (nfig, nalt) à ajouter aux
-- compteurs. Le contrat d'attributs est celui de szh-numerotation.lua :
--   ![légende](media/x.png){alt="…" copyright="…" source="…"}
local function poser_bloc_pronto(img, bloc)
  local nfig, nalt = 0, 0
  if bloc.alt ~= '' then
    img.caption = pandoc.Inlines({})        -- le descr de Word cède à ce qui a été tapé
    img.attributes['alt'] = bloc.alt
    nalt = 1
  else
    -- Rien de tapé sous « Texte alternatif : » : le descr de Word, s'il existe et n'est pas
    -- une description automatique, vaut mieux que rien.
    nalt = alt_depuis_word(img, bloc.legende)
  end
  if bloc.credit ~= '' then img.attributes['copyright'] = bloc.credit end
  if bloc.source ~= '' then img.attributes['source'] = bloc.source end
  local legende = trim(nettoyer_figure(bloc.legende))
  if legende ~= '' then
    img.caption = pandoc.Inlines({ pandoc.Str(legende) })
    nfig = 1
  end
  return nfig, nalt
end

function Pandoc(doc)
  local legT = charger_legendes_table()
  local legF = charger_legendes_figures()
  local blocsP = charger_blocs_pronto()
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
    -- Figure déjà formée par le lecteur docx (légende stylée dans le Word) : on
    -- l'aplatit avant tout le reste. Avec légende, elle est complète et ne doit surtout
    -- pas repasser par la règle du voisinage, qui lui en collerait une autre ; sans
    -- légende, elle redevient une image seule et suit le chemin ordinaire.
    if b.t == 'Figure' then
      local imgf, capf = figure_a_plat(b)
      if imgf then
        if capf and capf ~= '' then
          nalt = nalt + alt_depuis_word(imgf, capf)
          imgf.caption = pandoc.Inlines({ pandoc.Str(capf) })
          sortie:insert(pandoc.Para({ imgf }))
          nfig = nfig + 1
          goto continue
        end
        b = pandoc.Para({ imgf })
      end
    end
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
    -- Bloc du gabarit : tout est écrit, il n'y a rien à deviner. La règle du voisinage est
    -- court-circuitée EXPRÈS — un paragraphe de corps tout en gras juste au-dessus de la
    -- figure lui volerait sa légende alors que l'autrice ou l'auteur en a tapé une.
    if img and blocsP[base_fichier(img.src)] then
      local dfig, dalt = poser_bloc_pronto(img, blocsP[base_fichier(img.src)])
      nfig, nalt = nfig + dfig, nalt + dalt
      sortie:insert(pandoc.Para({ img }))
      goto continue
    end
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
