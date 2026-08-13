#!/usr/bin/env python3
# palette-html.py — génère docs/palette.html : la planche de la palette annuelle,
# avec les contrastes APCA mesurés. À relancer après TOUTE modification de
# pipeline/styles/couleurs.css :
#
#     python3 test/palette-html.py
#
# POURQUOI une page GÉNÉRÉE et non écrite à la main : la planche doit montrer les
# valeurs RÉELLES du pipeline. Une page écrite à la main se désynchroniserait à la
# première retouche de teinte, et une planche fausse est pire que pas de planche.
# Les Lc affichés sont calculés par pipeline/apca.py — le même module que le rendu.
#
# La page est AUTONOME (polices de la maquette embarquées en base64, aucun réseau) :
# même posture que le HTML d'article produit par le pipeline (--embed-resources).
#
# Le <meta charset="utf-8"> du modèle n'est PAS décoratif : la page s'ouvre en file://,
# sans en-tête HTTP Content-Type, donc à défaut de déclaration le navigateur retombe sur
# l'encodage de la machine (windows-1252 sous Windows) et tous les accents deviennent du
# mojibake — « clarté » lu « clartÃ© ». Il doit rester la PREMIÈRE ligne du document.
# stdlib uniquement.

import base64
import io
import os
import re
import sys

RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(RACINE, 'pipeline'))
import apca  # noqa: E402

CSS_COULEURS = os.path.join(RACINE, 'pipeline', 'styles', 'couleurs.css')
DOSSIER_FONTS = os.path.join(RACINE, 'pipeline', 'fonts')
SORTIE = os.path.join(RACINE, 'docs', 'palette.html')

# Ordre et libellés des couleurs (même ordre que le sélecteur du cockpit).
COULEURS = [
    ('rouge', 'Rouge'), ('capucine', 'Capucine'), ('moutarde', 'Moutarde'),
    ('poireau', 'Poireau'), ('bleuacier', 'Bleu acier'), ('mountbatten', 'Mountbatten'),
]
# Les 11 crans de la grille à clarté fixe, dans l'ordre (apca.CLARTES est la source :
# la planche ne doit jamais avoir sa propre idée de l'échelle). La couleur de MARQUE
# n'est pas dans cette liste — elle est hors grille et se présente à part.
CRANS = [cran for cran, _ in apca.CLARTES]
# Police de la maquette -> rôle dans la planche.
FONTS = [
    ('Source Serif 4', 400, 'SourceSerif4-Regular.ttf'),
    ('Open Sans', 400, 'OpenSans-SemiCondensed-Regular.ttf'),
    ('Open Sans', 600, 'OpenSans-SemiCondensed-SemiBold.ttf'),
    ('IBM Plex Mono', 400, 'IBMPlexMono-Regular.ttf'),
]


def resoudre(css, nom, sauts=8):
    """Valeur hex d'une variable CSS, en suivant les renvois var(--autre)."""
    for _ in range(sauts):
        m = re.search(re.escape(nom) + r'\s*:\s*([^;\n]+);', css)
        if not m:
            return None
        valeur = m.group(1).strip()
        m_hex = re.match(r'(#[0-9A-Fa-f]{3,6})$', valeur)
        if m_hex:
            return m_hex.group(1).upper()
        m_var = re.match(r'var\(\s*(--[\w-]+)\s*\)$', valeur)
        if not m_var:
            return None
        nom = m_var.group(1)
    return None


def polices_embarquees():
    blocs = []
    for famille, graisse, fichier in FONTS:
        chemin = os.path.join(DOSSIER_FONTS, fichier)
        with open(chemin, 'rb') as f:
            b64 = base64.b64encode(f.read()).decode('ascii')
        blocs.append(
            "@font-face{font-family:'%s';font-weight:%d;font-style:normal;font-display:swap;"
            "src:url(data:font/ttf;base64,%s) format('truetype')}" % (famille, graisse, b64))
    return '\n'.join(blocs)


def echapper(t):
    return t.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')


def fr(x):
    """Contraste à la française, signe compris : 90.1 -> « +90,1 »."""
    return ('%+.1f' % x).replace('.', ',')


def nombre(x, decimales):
    """Nombre à la française, SANS signe : 0.555 -> « 0,555 » (les clartés OKLab)."""
    return ('%.*f' % (decimales, x)).replace('.', ',')


def _tete(cran, hexa):
    return ('<div class="case__haut"><span class="case__niveau">%s</span>'
            '<span class="case__hex">%s</span></div>' % (cran, hexa))


def _pied(lc_txt, role):
    return ('<div class="case__bas"><span class="case__lc">%s</span>'
            '<span class="case__role">%s</span></div>' % (lc_txt, role))


def pastille(hexa, cran):
    """Une case de la planche : le fond, et DESSUS le texte de la couleur qu'il doit
    porter. La preuve est visuelle — si c'est illisible à l'écran, la valeur mentait.

    Trois états, dictés par apca.CONTRAT, et la case CHANGE DE FORME selon l'état :
      texte courant : un échantillon de texte courant, à la taille du corps ;
      gros titres   : un échantillon en gros seulement (19 px gras = le seuil de la
                      légende), parce que c'est le seul texte que le cran autorise ;
      aucun texte   : PAS d'échantillon. La couleur devient un aplat muet et toutes les
                      étiquettes sortent de l'aplat, sur le fond de la page. Afficher un
                      faux texte lisible ici — ou même y poser le numéro du cran —
                      reviendrait à mentir sur ce que le cran permet."""
    texte_admis, garanti, usage = apca.CONTRAT[cran]

    # ── Cran DÉCORATIF (400) : aucun texte, ni noir ni blanc.
    if texte_admis is None:
        _, meilleur = apca.meilleure_polarite(hexa)
        return (
            '<div class="case case--deco">'
            '%s'
            '<div class="case__aplat" style="background:%s"></div>'
            '%s</div>'
        ) % (_tete(cran, hexa),
             hexa,
             _pied('Lc&nbsp;%s au mieux' % fr(meilleur), 'aucun texte · décoratif'))

    # ── Crans porteurs de texte : on met le texte que le contrat autorise, à la taille
    #    qu'il autorise. Le noir/blanc n'est PAS choisi par mesure ici : il est imposé
    #    par le contrat du cran (c'est tout l'intérêt d'une grille à clarté fixe).
    lc = apca.lc(texte_admis, hexa)
    gros = (usage != 'texte courant')
    role = '%s · %s' % ('texte blanc' if texte_admis == apca.BLANC else 'texte noir',
                        'gros titres' if gros else 'texte courant')
    if gros:
        echantillon = '<p class="case__texte case__texte--gros">Titre</p>'
    else:
        echantillon = '<p class="case__texte">Zusammenfassung / Résumé</p>'
    return (
        '<div class="case" style="--fond:%s;--encre-case:%s">%s%s%s</div>'
    ) % (hexa, texte_admis, _tete(cran, hexa), echantillon,
         _pied('Lc&nbsp;%s' % fr(lc), role))


def case_marque(hexa):
    """La couleur de MARQUE, hors grille. Même principe que les autres cases (elle porte
    le texte qu'elle peut porter, et seulement en gros titre : aucune des six n'atteint 75
    dans une polarité ou dans l'autre), mais présentée à part et badgée « hors grille » :
    son hex est imposé par la charte, il ne tombe sur aucun cran."""
    texte, lc = apca.meilleure_polarite(hexa)
    role = '%s · gros titres' % ('texte blanc' if texte == apca.BLANC else 'texte noir')
    return (
        '<div class="case case--marque" style="--fond:%s;--encre-case:%s">'
        '<div class="case__haut"><span class="case__niveau">marque</span>'
        '<span class="case__hex">%s</span></div>'
        '<p class="case__texte case__texte--gros">Titre</p>'
        '%s'
        '<span class="case__badge">hors grille</span></div>'
    ) % (hexa, texte, hexa, _pied('Lc&nbsp;%s' % fr(lc), role))


def main():
    css = io.open(CSS_COULEURS, encoding='utf-8').read()
    lignes = []
    for cle, libelle in COULEURS:
        cases = []
        marque = resoudre(css, '--c-%s-marque' % cle)
        for cran in CRANS:
            hexa = resoudre(css, '--c-%s-%s' % (cle, cran))
            if hexa:
                cases.append(pastille(hexa, cran))
        # Les alias sont lus dans le CSS, pas récités : si quelqu'un repointe -clair vers
        # un autre cran, la planche doit le montrer. On retrouve le cran par son hex.
        par_hex = {resoudre(css, '--c-%s-%s' % (cle, c)): c for c in CRANS}
        alias = []
        for nom in ('normal', 'clair', 'fonce'):
            hexa = resoudre(css, '--c-%s-%s' % (cle, nom))
            cible = 'marque' if hexa == marque else par_hex.get(hexa, hexa or '?')
            alias.append('<code>-%s</code> → %s' % (nom, cible))
        # La marque, hors grille : sa clarté OKLab et le cran dont elle est la plus proche.
        # C'est le chiffre qui explique pourquoi elle ne peut PAS être un cran.
        clarte = apca.srgb_vers_oklab(apca.vers_rgb(marque))[0]
        proche = min(apca.CLARTES, key=lambda c: abs(c[1] - clarte))[0]
        # Cas de la capucine : sa clarté est si proche du cran 500 que le cran CALCULÉ
        # retombe sur le hex de marque, au 1/255 près. Écrire « tout près n'est pas égal »
        # serait faux ici — la planche doit dire la coïncidence, pas la masquer.
        if resoudre(css, '--c-%s-%s' % (cle, proche)) == marque:
            nuance = ('Ici la coïncidence est totale : le cran %s calculé retombe sur ce '
                      'hex, à l\'arrondi près. C\'est propre à cette teinte, et c\'est '
                      'précisément le piège de l\'ancienne convention « la marque = 500 » — '
                      'vraie pour quatre teintes sur six, fausse pour les deux autres.'
                      % proche)
        else:
            nuance = ('Mais « tout près » n\'est pas « égal » : le cran %s ci-dessus est '
                      'calculé, et il diffère de ce hex.' % proche)
        lignes.append(
            '<section class="teinte">'
            '<header class="teinte__tete">'
            '<h2>%s</h2>'
            '<p class="teinte__marque"><span class="puce" style="background:%s"></span>%s</p>'
            '<p class="teinte__alias">%s</p>'
            '</header>'
            '<div class="rampe">%s</div>'
            '<div class="horsgrille">%s'
            '<p class="horsgrille__note">La couleur de marque <strong>ne tombe sur aucun '
            'cran</strong> : son hex est imposé par la charte, sa clarté tombe où elle '
            'tombe. Ici elle vaut <strong>%s</strong>, le cran le plus proche étant le %s '
            '(%s). %s C\'est pourquoi la marque porte son propre jeton, '
            '<code>--c-%s-marque</code> — le seul hex du fichier qui ne se recalcule pas.</p>'
            '</div>'
            '</section>' % (echapper(libelle), marque, marque, ' · '.join(alias),
                            ''.join(cases), case_marque(marque),
                            nombre(clarte, 3), proche,
                            nombre(dict(apca.CLARTES)[proche], 2), nuance, cle))

    neutres = []
    for var, role in (('--szh-gris-clair', 'fond « gris » des en-têtes et de la ligne de total'),
                      ('--szh-zebre', 'zébrage, une ligne ou une colonne sur deux')):
        hexa = resoudre(css, var)
        if not hexa:
            continue
        lc = apca.lc(apca.NOIR, hexa)
        neutres.append(
            '<tr><td><code>%s</code></td><td class="cellule-couleur">'
            '<span class="puce" style="background:%s"></span>%s</td>'
            '<td class="num">Lc %s</td><td>%s</td></tr>'
            % (var, hexa, hexa, fr(lc), echapper(role)))

    html = MODELE % {
        'polices': polices_embarquees(),
        'teintes': '\n'.join(lignes),
        'neutres': '\n'.join(neutres),
    }
    os.makedirs(os.path.dirname(SORTIE), exist_ok=True)
    io.open(SORTIE, 'w', encoding='utf-8').write(html)
    print('Écrit : %s (%.0f Ko)' % (SORTIE, os.path.getsize(SORTIE) / 1024.0))
    return 0


MODELE = """<meta charset="utf-8">
<title>Palette annuelle SZH</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
%(polices)s

/* Palette de la PAGE (à ne pas confondre avec la palette présentée) : papier froid,
   encre bleu nuit — le #252B46 permanent de la couverture (D70) sert de seul accent
   structurel, pour que la planche ne concurrence jamais les couleurs montrées. */
:root {
  --papier:    #F6F7FA;
  --carte:     #FFFFFF;
  --encre:     #1C2030;
  --encre-cal: #5C6478;
  --filet:     #DCE0EA;
  --nuit:      #252B46;
  --ombre:     0 1px 2px rgba(28,32,48,.06), 0 8px 24px rgba(28,32,48,.05);
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --papier: #151925; --carte: #1D2231; --encre: #E6E9F1; --encre-cal: #98A0B4;
    --filet: #293043; --nuit: #C6CCE4;
    --ombre: 0 1px 2px rgba(0,0,0,.4), 0 8px 24px rgba(0,0,0,.3);
  }
}
:root[data-theme="dark"] {
  --papier: #151925; --carte: #1D2231; --encre: #E6E9F1; --encre-cal: #98A0B4;
  --filet: #293043; --nuit: #C6CCE4;
  --ombre: 0 1px 2px rgba(0,0,0,.4), 0 8px 24px rgba(0,0,0,.3);
}

* { box-sizing: border-box; }
body {
  margin: 0; background: var(--papier); color: var(--encre);
  font-family: 'Open Sans', system-ui, sans-serif; font-size: 15px; line-height: 1.55;
  -webkit-font-smoothing: antialiased;
}
.enveloppe { max-width: 1120px; margin: 0 auto; padding: 56px 24px 96px; }

h1 {
  font-family: 'Source Serif 4', Georgia, serif; font-weight: 400;
  font-size: clamp(30px, 4.5vw, 46px); line-height: 1.1; letter-spacing: -.01em;
  margin: 0 0 12px; text-wrap: balance;
}
.chapo { max-width: 62ch; margin: 0 0 8px; color: var(--encre-cal); font-size: 16px; }
.chapo strong { color: var(--encre); font-weight: 600; }

.eyebrow {
  font-size: 11px; font-weight: 600; letter-spacing: .14em; text-transform: uppercase;
  color: var(--encre-cal); margin: 0 0 14px;
}

/* Légende des trois seuils : la seule information à retenir avant de lire la planche. */
.seuils {
  display: flex; flex-wrap: wrap; gap: 0; margin: 32px 0 48px;
  border: 1px solid var(--filet); border-radius: 3px; background: var(--carte);
  box-shadow: var(--ombre); overflow: hidden;
}
.seuil { flex: 1 1 200px; padding: 16px 20px; border-right: 1px solid var(--filet); }
.seuil:last-child { border-right: 0; }
.seuil__val {
  font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: 21px;
  font-variant-numeric: tabular-nums; color: var(--nuit);
}
.seuil__quoi { font-weight: 600; }
.seuil__note { color: var(--encre-cal); font-size: 13px; }

.teinte { margin: 0 0 44px; }
.teinte__tete {
  display: flex; align-items: baseline; flex-wrap: wrap; gap: 8px 20px;
  padding-bottom: 10px; margin-bottom: 14px; border-bottom: 1px solid var(--filet);
}
.teinte__tete h2 {
  font-family: 'Source Serif 4', Georgia, serif; font-weight: 400; font-size: 25px;
  margin: 0; letter-spacing: -.01em;
}
.teinte__marque, .teinte__alias { margin: 0; color: var(--encre-cal); font-size: 13px; }
.teinte__marque {
  font-family: 'IBM Plex Mono', ui-monospace, monospace;
  display: inline-flex; align-items: center; gap: 8px;
}
.teinte__alias { margin-left: auto; }
.teinte__alias code, .neutres code {
  font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: 12px;
}
.puce {
  width: 12px; height: 12px; border-radius: 2px; display: inline-block;
  box-shadow: inset 0 0 0 1px rgba(0,0,0,.18);
}

/* La rampe : 11 crans à clarté fixe, dans l'ordre (du plus clair au plus sombre) — d'où
   l'affichage des numéros, qui portent une information et non une décoration. Un numéro
   EST une clarté : la colonne n de deux teintes différentes est aussi claire des deux
   côtés, et c'est précisément ce que la planche doit rendre évident à l'œil. */
.rampe { display: grid; grid-template-columns: repeat(11, minmax(0, 1fr)); gap: 6px; }
@media (max-width: 1100px) { .rampe { grid-template-columns: repeat(6, minmax(0, 1fr)); } }
@media (max-width: 760px)  { .rampe { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
@media (max-width: 520px)  { .rampe { grid-template-columns: repeat(2, minmax(0, 1fr)); } }

.case {
  background: var(--fond); color: var(--encre-case);
  border-radius: 3px; padding: 10px 10px 9px; min-height: 150px;
  display: flex; flex-direction: column; gap: 6px; position: relative;
  box-shadow: inset 0 0 0 1px rgba(0,0,0,.14);
}

/* Cran DÉCORATIF (400) : la case ne porte AUCUN texte sur la couleur — ni échantillon,
   ni même son propre numéro. La couleur est réduite à un aplat muet et les étiquettes
   passent sur le fond de la page. Poser un texte lisible ici, sous prétexte de montrer
   la case, contredirait ce que le cran interdit. */
.case--deco {
  background: var(--carte); color: var(--encre);
  box-shadow: inset 0 0 0 1px var(--filet);
}
.case__aplat {
  flex: 1 1 auto; min-height: 54px; border-radius: 2px; margin: 2px 0;
  box-shadow: inset 0 0 0 1px rgba(0,0,0,.14);
}
.case--deco .case__role { font-weight: 600; opacity: 1; color: var(--encre-cal); }

/* La marque : hors grille, donc hors rampe. Encadrée et badgée. */
.horsgrille {
  display: flex; flex-wrap: wrap; align-items: stretch; gap: 16px; margin-top: 18px;
  padding-top: 16px; border-top: 1px dashed var(--filet);
}
.horsgrille .case { flex: 0 0 200px; max-width: 200px; }
.horsgrille__note {
  flex: 1 1 300px; margin: 0; align-self: center;
  color: var(--encre-cal); font-size: 13px;
}
.horsgrille__note strong { color: var(--encre); font-weight: 600; }
.horsgrille__note code {
  font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: 12px;
}
.case--marque { box-shadow: inset 0 0 0 2px var(--nuit); }
.case__haut { display: flex; justify-content: space-between; align-items: baseline; gap: 6px; }
.case__niveau {
  font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: 14px; font-weight: 600;
  font-variant-numeric: tabular-nums; opacity: .85;
}
.case__hex {
  font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: 10px; opacity: .75;
}
.case__texte {
  font-family: 'Source Serif 4', Georgia, serif; font-size: 13px; line-height: 1.25;
  margin: auto 0 0; color: var(--encre-case); overflow-wrap: anywhere;
}
/* « Gros titre » au sens de la légende ci-dessus : 19 px en gras. Les crans 300, 500 et
   600 ne portent QUE ce texte-là — l'échantillon montre donc la taille autorisée, pas
   celle du corps de texte. */
.case__texte--gros {
  font-family: 'Open Sans', system-ui, sans-serif; font-size: 19px; font-weight: 600;
  line-height: 1.15; letter-spacing: -.01em;
}
.case__bas { display: flex; flex-direction: column; gap: 1px; }
.case__lc {
  font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: 11.5px; font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.case__role { font-size: 10px; letter-spacing: .02em; opacity: .8; }
.case__badge {
  position: absolute; top: -9px; left: 10px; background: var(--nuit); color: var(--papier);
  font-size: 9px; font-weight: 600; letter-spacing: .1em; text-transform: uppercase;
  padding: 2px 6px; border-radius: 2px;
}

.neutres { margin: 56px 0 0; }
.tableau-enveloppe { overflow-x: auto; }
table { border-collapse: collapse; width: 100%%; font-size: 14px; }
th, td { text-align: left; padding: 9px 14px 9px 0; border-bottom: 1px solid var(--filet); }
th {
  font-size: 11px; font-weight: 600; letter-spacing: .1em; text-transform: uppercase;
  color: var(--encre-cal);
}
td.num {
  font-family: 'IBM Plex Mono', ui-monospace, monospace; font-variant-numeric: tabular-nums;
}
.cellule-couleur {
  font-family: 'IBM Plex Mono', ui-monospace, monospace;
  display: flex; align-items: center; gap: 8px;
}

.pied {
  margin: 64px 0 0; padding-top: 20px; border-top: 1px solid var(--filet);
  color: var(--encre-cal); font-size: 13px; max-width: 74ch;
}
.pied code {
  font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: 12px;
  background: var(--carte); border: 1px solid var(--filet); border-radius: 2px;
  padding: 1px 5px;
}
</style>

<div class="enveloppe">
  <p class="eyebrow">SZH / CSPS · Maquette de revue</p>
  <h1>Palette annuelle et contrastes</h1>
  <p class="chapo">Chaque numéro de la revue est repeint dans une couleur annuelle. Les six
  couleurs de marque se déclinent en <strong>onze crans de même teinte</strong>, calculés en
  OKLab pour ne pas délaver la couleur, puis mesurés avec <strong>APCA</strong> — le calcul de
  contraste du futur WCAG 3.</p>
  <p class="chapo">Un <strong>cran est une clarté</strong>, pas une cible de contraste : le 200
  du rouge et le 200 du poireau sont aussi clairs l'un que l'autre. Comparez les colonnes
  verticalement d'une teinte à l'autre — c'est tout l'intérêt de la grille, et ce que l'ancienne
  échelle (où chaque niveau visait un contraste, donc une clarté différente selon la teinte) ne
  permettait pas.</p>
  <p class="chapo">La lecture est directe : chaque case porte le texte de la couleur qu'elle
  doit recevoir, <em>à la taille qu'elle autorise</em>. Si un échantillon vous paraît difficile
  à lire à l'écran, c'est que la mesure mentait, pas l'inverse. Deux cases font exception, et
  elles le disent : le <strong>cran 400 ne porte aucun texte</strong> (aplat muet — c'est le
  point où ni le noir ni le blanc ne passent, inhérent à toute échelle saturée), et la
  <strong>couleur de marque est hors grille</strong>, présentée sous chaque rampe.</p>

  <div class="seuils">
    <div class="seuil"><div class="seuil__val">75</div>
      <div class="seuil__quoi">Texte courant</div>
      <div class="seuil__note">corps d'article, cellules et en-têtes de tableau. 90 = confortable.</div></div>
    <div class="seuil"><div class="seuil__val">60</div>
      <div class="seuil__quoi">Gros titre</div>
      <div class="seuil__note">à partir de 24 px, ou 19 px en gras.</div></div>
    <div class="seuil"><div class="seuil__val">30</div>
      <div class="seuil__quoi">Filet, bordure</div>
      <div class="seuil__note">tout élément qui n'est pas du texte mais porte du sens.</div></div>
  </div>

%(teintes)s

  <section class="neutres">
    <p class="eyebrow">Teintes neutres</p>
    <h2 style="font-family:'Source Serif 4',Georgia,serif;font-weight:400;font-size:25px;margin:0 0 6px">Indépendantes de la couleur annuelle</h2>
    <p class="chapo">Elles servent les tableaux quelle que soit la couleur du numéro, et portent
    toujours du texte noir.</p>
    <div class="tableau-enveloppe">
      <table>
        <thead><tr><th>Jeton</th><th>Valeur</th><th>Texte noir</th><th>Rôle</th></tr></thead>
        <tbody>
%(neutres)s
        </tbody>
      </table>
    </div>
  </section>

  <p class="pied">Planche <strong>générée</strong> à partir de
  <code>pipeline/styles/couleurs.css</code> : les valeurs affichées sont exactement celles que
  le pipeline applique. Les contrastes sont calculés par <code>pipeline/apca.py</code>, le même
  module que le rendu. Après toute modification des teintes, régénérez cette page avec
  <code>python3 test/palette-html.py</code> et vérifiez l'ensemble des paires réelles avec
  <code>python3 test/apca-check.py</code>. Les polices de la maquette (Source Serif 4, Open Sans
  SemiCondensed, IBM Plex Mono) sont embarquées : la page est autonome, sans accès réseau.</p>
</div>
"""

if __name__ == '__main__':
    sys.exit(main())
