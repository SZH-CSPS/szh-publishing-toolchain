-- QR code vectoriel et cliquable, sous deux syntaxes markdown :
--
--   ::: {.qr-link tracked=false background=transparent color=#000000 size=25mm title="…"}
--   https://exemple.ch/x
--   :::
--
--   [Die Geschichte anhören](https://exemple.ch/x){.qr}
--   [Écouter](https://exemple.ch/x){.qr size="30mm"}
--
-- Les deux formes acceptent les mêmes options. Le lien `.qr` accepte aussi `taille=` à la
-- place de `size=`, sans avertissement, car des livres existants l'écrivent ainsi. Un
-- qr-link placé dans un falc-header est traité avant, par szh-livre-entete.lua.
--
-- Le <a> est construit par szh-qr-commun.lua (M.construire_qr), qui décrit les options.
-- Un QR seul dans son paragraphe s'affiche en bloc par le CSS (.szh-qr).
--
-- Dans l'aperçu (lecteur commonmark_x), un Div qr-link peut être enveloppé dans un Div
-- « wrapper=1 » ; stringify le traverse, l'URL se lit pareil.
--
-- S'exécute en dernier dans la chaîne (pipeline/filtres.mk) : le HTML brut qu'il produit
-- ne doit pas passer par la typographie ni la césure.
--
-- Lien court : si le cache de SZH_LIENS_COURTS (écrit par pipeline/liens-courts.py) connaît
-- l'URL, le lien et le QR portent l'URL courte, sauf avec `tracked=false`. Sinon, l'URL
-- d'origine est gardée.

local function dossier_ce_fichier()
  local source = debug.getinfo(1, 'S').source
  if source:sub(1, 1) == '@' then source = source:sub(2) end
  return source:match('^(.*[/\\])') or ''
end

local DOSSIER = dossier_ce_fichier()
local ok_charge, commun_qr = pcall(dofile, DOSSIER .. 'szh-qr-commun.lua')
if not ok_charge or type(commun_qr) ~= 'table' or type(commun_qr.svg_qr) ~= 'function' then
  io.stderr:write('[szh-qr] module szh-qr-commun.lua introuvable ou invalide\n')
  io.stderr:write('[szh-qr] [de] Modul szh-qr-commun.lua nicht gefunden oder ungültig\n')
  os.exit(1, true)
end

local ok_commun, commun = pcall(dofile, DOSSIER .. 'szh-commun.lua')
if not ok_commun or type(commun) ~= 'table' then
  io.stderr:write('[szh-qr] module szh-commun.lua introuvable ou invalide\n')
  io.stderr:write('[szh-qr] [de] Modul szh-commun.lua nicht gefunden oder ungültig\n')
  os.exit(1, true)
end

local S = pandoc.utils.stringify

local a_classe = commun.a_classe

local texte = commun.texte

-- Langue du document, selon szh-contexte.lua.
local function langue_de(meta)
  return commun.contexte(meta).lang
end

local function avertir(slug, code, phrase_fr, phrase_de)
  commun.constat('qr', 'avertissement', code, { 'chapitre « ' .. slug .. ' »' }, phrase_fr, phrase_de)
end

-- Lien `.qr` -> <a> QR. Si le QR ne peut pas être construit, le lien reste ordinaire.
local function traiter_lien_qr(lien, lang, slug)
  if not a_classe(lien, 'qr') then return nil end
  local attrs = lien.attributes or {}
  local taille = attrs['size']
  if taille == nil or taille == '' then taille = attrs['taille'] end

  local html, erreur = commun_qr.construire_qr(lien.target, {
    tracked = commun_qr.analyser_bool(attrs['tracked'], true),
    background = attrs['background'],
    color = attrs['color'],
    size = taille,
    title = attrs['title'],
    lang = lang,
    avertir = function(code, fr, de) avertir(slug, code, fr, de) end,
  })
  if not html then
    io.stderr:write('[szh-qr] QR impossible pour « ' .. lien.target .. ' » : ' .. tostring(erreur) .. '\n')
    io.stderr:write('[szh-qr] [de] QR nicht möglich für « ' .. lien.target .. ' »: ' .. tostring(erreur) .. '\n')
    return nil
  end
  return pandoc.RawInline('html', html)
end

-- Bloc `qr-link` -> <a> QR. Son contenu est une URL. Vide : il disparaît, avec un
-- avertissement. Si le QR ne peut pas être construit : un lien texte vers l'URL.
local function traiter_div_qr_link(div, lang, slug)
  if not a_classe(div, 'qr-link') then return nil end
  local url = texte(S(div.content))
  if url == '' then
    avertir(slug, 'qr-link-vide',
      "Un bloc qr-link est vide : sans URL, rien ne s'imprime.",
      'Ein qr-link-Block ist leer: ohne URL wird nichts gedruckt.')
    return {}
  end

  local attrs = div.attributes or {}
  local html, erreur = commun_qr.construire_qr(url, {
    tracked = commun_qr.analyser_bool(attrs['tracked'], true),
    background = attrs['background'],
    color = attrs['color'],
    size = attrs['size'],
    title = attrs['title'],
    lang = lang,
    avertir = function(code, fr, de) avertir(slug, code, fr, de) end,
  })
  if not html then
    io.stderr:write('[szh-qr] QR impossible pour « ' .. url .. ' » : ' .. tostring(erreur) .. '\n')
    io.stderr:write('[szh-qr] [de] QR nicht möglich für « ' .. url .. ' »: ' .. tostring(erreur) .. '\n')
    return pandoc.Para({ pandoc.Link({ pandoc.Str(url) }, url) })
  end
  return pandoc.RawBlock('html', html)
end

local function slug_document()
  return os.getenv('SZH_CHAPITRE_SLUG') or os.getenv('SZH_SLUG') or '?'
end

function Pandoc(doc)
  local lang = langue_de(doc.meta)
  local slug = texte(doc.meta and doc.meta.slug)
  if slug == '' then slug = slug_document() end
  return doc:walk({
    Link = function(el) return traiter_lien_qr(el, lang, slug) end,
    Div = function(el) return traiter_div_qr_link(el, lang, slug) end,
  })
end
