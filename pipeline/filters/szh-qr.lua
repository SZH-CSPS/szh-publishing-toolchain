-- QR code vectoriel et cliquable, sous deux syntaxes markdown :
--
--   ::: {.qr-link tracked=false background=transparent color=#000000 size=25mm title="…"}
--   https://exemple.ch/x
--   :::
--
--   [Die Geschichte anhören](https://exemple.ch/x){.qr}
--   [Écouter](https://exemple.ch/x){.qr size="30mm"}
--
-- La forme bloc (`qr-link`) est la forme de référence du cahier des charges — réutilisable
-- N'IMPORTE OÙ dans un chapitre, y compris EMBARQUÉE dans un falc-header (voir
-- szh-livre-entete.lua, qui la traite lui-même avant que ce filtre ne s'exécute : un
-- qr-link consommé par un falc-header n'atteint donc jamais ce filtre-ci). La forme courte
-- `.qr` reste acceptée pour compatibilité, MÊMES options anglaises, `taille=` gardé en
-- repli SILENCIEUX pour `size=` (pas d'avertissement : c'est la même valeur, seul le nom de
-- la clé change, et le corpus réel écrit déjà `taille=` — un avertissement à chaque
-- compilation d'un livre existant n'apprendrait rien).
--
-- Toute la construction du <a> (résolution Shlink, palette, avertissements de contraste et
-- de quadri imprimeur) vit dans szh-qr-commun.lua, M.construire_qr — un seul endroit pour
-- les deux syntaxes ET pour szh-livre-entete.lua. Voir son en-tête pour le détail des
-- options et le patron du <a> VIDE (SVG en background-image, jamais en enfant : un <svg>
-- enfant du <a> casse le balisage PDF/UA du lien, mesuré au veraPDF le 23.09.2026 — une
-- zone cliquable par boîte interne, au lieu d'une seule).
--
-- « QR en bloc » (bloc `qr-link`, ou lien `.qr` seul dans son paragraphe) : rien à détecter
-- ici, la règle CSS (`display:block` sur .szh-qr) en fait un bloc, quelle que soit la
-- syntaxe d'origine.
--
-- Fonctionne identiquement dans l'aperçu (SZH_APERCU=1, lecteur commonmark_x+sourcepos) :
-- vérifié (23.09.2026) que ce lecteur ne place PAS le Link `.qr` lui-même dans un Span
-- « wrapper=1 » (seuls ses inlines enfants le sont, sans conséquence sur `lien.target`) ;
-- le Div `qr-link`, lui, peut être enveloppé dans un Div « wrapper=1 » (bloc imbriqué —
-- szh-sourcepos.lua ne défait PAS ces Div, à dessein, voir son en-tête), mais
-- `pandoc.utils.stringify(div.content)` traverse un tel Div sans s'en soucier : rien à
-- déballer pour lire l'URL.
--
-- Position dans la chaîne (FILTRES_CHAPITRE/_EPUB, pipeline/profils/livre.mk) : en tout
-- dernier, après szh-cesure.lua (et szh-notes.lua côté PDF), et après szh-livre-entete.lua.
-- Une fois le Link/Div changé en RawInline/RawBlock, aucun filtre suivant n'a de raison de
-- le regarder — le placer plus tôt exposerait un <a><svg>…</svg></a> brut aux passes de
-- typographie/coupure de mots, qui walkent Str/Link du document entier sans savoir qu'il
-- s'agit ici de balisage, pas de texte.
--
-- Lien court Shlink (pipeline/liens-courts.py) : si SZH_LIENS_COURTS pointe vers le
-- liens-courts.yaml du livre et que l'URL longue y figure, le href ET le contenu encodé du
-- QR deviennent le lien court — sauf `tracked=false`, qui garde toujours l'URL d'origine,
-- jamais passée par le cache. Sans variable, sans fichier, ou URL absente du cache : l'URL
-- longue traverse telle quelle (l'avertissement « lien court indisponible » est du ressort
-- de liens-courts.py à la compilation, pas de ce filtre, qui n'a pas accès au réseau).

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

local S = pandoc.utils.stringify

local function a_classe(el, nom)
  for _, c in ipairs(el.classes or {}) do
    if c == nom then return true end
  end
  return false
end

local function texte(v)
  if v == nil then return '' end
  local ok, r = pcall(S, v)
  if not ok then return '' end
  return (r:gsub('^%s+', ''):gsub('%s+$', ''))
end

-- Même repli que szh-livre-ecouter.lua avant lui : `lang:` déjà fusionné dans la fiche du
-- chapitre, pas de jeton de revue à consulter ici (voir szh-commun.lua, M.langue_de, pensé
-- pour un autre usage).
local function langue_de(meta)
  local l = texte(meta and meta.lang)
  if l == '' then return 'fr' end
  return (l:lower():match('^(%a%a)')) or 'fr'
end

local function avertir(slug, code, phrase_fr, phrase_de)
  io.stderr:write(table.concat({
    '[qr-avertissement] ' .. code, 'chapitre « ' .. slug .. ' »', phrase_fr, '[de] ' .. phrase_de,
  }, ' | ') .. '\n')
end

-- Un lien `.qr` : options identiques au bloc qr-link, en attributs du lien markdown.
local function traiter_lien_qr(lien, lang, slug)
  if not a_classe(lien, 'qr') then return nil end
  local attrs = lien.attributes or {}
  local taille = attrs['size']
  if taille == nil or taille == '' then taille = attrs['taille'] end -- repli silencieux, voir en-tête

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
    return nil -- repli : le lien reste un lien ordinaire, sans QR
  end
  return pandoc.RawInline('html', html)
end

-- Un bloc `qr-link` seul (pas embarqué dans un falc-header, déjà consommé avant ce filtre —
-- voir l'en-tête). Contenu : une seule URL, éventuellement dans un Para. Les autres blocs
-- (pas d'URL reconnaissable) traversent tels quels : ce n'est alors pas un qr-link valide,
-- rien à imprimer de plus sûr que le contenu écrit.
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
    -- Repli : un vrai lien texte, pour que « le lien doit rester navigable » reste vrai
    -- même sans QR (mêmes termes que szh-livre-entete.lua pour le même cas).
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
