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
# la planche ne doit jamais avoir sa propre idée de l'échelle). La couleur de CHARTE n'a
# plus de case à part : elle EST l'un de ces onze crans, celui que désigne
# apca.cran_de_charte, et c'est ce cran-là qui porte le badge dans la rampe.
CRANS = [cran for cran, _ in apca.CLARTES]
CIBLES = dict(apca.CLARTES)
# Les deux surfaces réelles contre lesquelles un FILET de couleur se juge : le papier de
# la maquette, et le zébrage des tableaux (lu dans couleurs.css, jamais recopié ici).
PAPIER = '#FFFFFF'
ZEBRE = None        # renseigné par main() depuis couleurs.css
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
    """Le Lc tel qu'il s'affiche PARTOUT dans la chaîne : entier signé, sans décimale
    (79,7 -> « +80 » ; −102,0 -> « −102 »). La règle vit dans apca.lc_affiche, pas ici :
    la planche ne doit pas avoir sa propre façon d'arrondir, sinon elle finirait par
    contredire couleurs.css et le vérificateur sur la même couleur."""
    return apca.lc_affiche(x, signe=True)


def _tete(cran, hexa):
    return ('<div class="case__haut"><span class="case__niveau">%s</span>'
            '<span class="case__hex">%s</span></div>' % (cran, hexa))


def _pied(lc_txt, role):
    return ('<div class="case__bas"><span class="case__lc">%s</span>'
            '<span class="case__role">%s</span></div>' % (lc_txt, role))


# Taille des échantillons. Elles ne sont pas décoratives : ce sont les tailles que le
# seuil du cran autorise, et c'est pour ça qu'elles sont affichées sur la case.
#   14 px : la taille RÉELLE du corps de la maquette (print.css, --body-size = 0,875rem),
#           et le plancher du niveau 90. L'échantillon montre ce que verra le lecteur.
#   18 px : le plancher du niveau 75. Un cran étiqueté « dès 18 px » ne peut PAS porter le
#           corps de la maquette, et encore moins le texte des tableaux (13,6 px) — c'est
#           exactement l'information que la version précédente de cette planche cachait,
#           en présentant ces crans comme du « texte courant ».
#   19 px gras : le plancher du « gros texte » d'APCA, celui à partir duquel le seuil tombe
#           à 60. Écrire plus gros flatterait le contraste.
# Chaque étiquette porte donc la taille, et l'échantillon est rendu À CETTE TAILLE : la
# planche ne peut pas annoncer un seuil et montrer un autre corps.
ETIQUETTE_TAILLE = {
    apca.USAGE_TEXTE_14: 'dès 14 px',
    apca.USAGE_TEXTE_18: 'dès 18 px',
    apca.USAGE_GROS_TITRE: 'gros titre',
}
# Taille de rendu de l'échantillon, par usage (doit s'accorder avec les classes CSS).
CLASSE_TAILLE = {
    apca.USAGE_TEXTE_14: ('case__texte', 'Texte'),
    apca.USAGE_TEXTE_18: ('case__texte case__texte--moyen', 'Texte'),
    apca.USAGE_GROS_TITRE: ('case__texte case__texte--gros', 'Titre'),
}


def usage_interface(hexa, papier, zebre):
    """Ce cran peut-il servir d'ÉLÉMENT D'INTERFACE (filet, bordure, puce, icône) ?

    Seuil APCA non textuel : |Lc| >= 30 contre la surface voisine. Deux surfaces réelles
    dans la chaîne, et elles ne donnent pas le même verdict — d'où les trois états, plutôt
    qu'un « oui/non » qui serait faux la moitié du temps :
      le papier blanc de la maquette, et le zébrage des tableaux, plus clair que le papier
      ne l'est pour un filet posé dessus (un cran peut passer sur l'un et pas sur l'autre :
      c'est exactement le cas du 300)."""
    sur_papier = abs(apca.lc(hexa, papier))
    sur_zebre = abs(apca.lc(hexa, zebre))
    seuil = apca.LC_NON_TEXTUEL
    if sur_papier >= seuil and sur_zebre >= seuil:
        return ('oui', 'partout', sur_papier)
    if sur_papier >= seuil:
        return ('partiel', 'sur papier seul', sur_papier)
    return ('non', 'trop pâle', sur_papier)


def _interface(hexa, papier, zebre):
    """Le rappel d'usage en interface, sous les étiquettes de texte. Le trait est tracé
    dans la couleur du cran SUR LE FOND DE LA PAGE (pas sur l'aplat) : c'est là qu'un
    filet vit réellement, donc c'est là qu'il doit se juger."""
    etat, libelle, valeur = usage_interface(hexa, papier, zebre)
    return ('<div class="case__ui case__ui--%s"><span class="case__trait" '
            'style="background:%s"></span><span class="case__uitxt">filet %s '
            '<span class="case__uilc">Lc&nbsp;%s</span></span></div>'
            % (etat, hexa, libelle, fr(valeur)))


def pastille(hexa, cran, charte=False):
    """Une case de la planche : le fond, et DESSUS le texte de la couleur qu'il doit
    porter. La preuve est visuelle — si c'est illisible à l'écran, la valeur mentait.

    Toutes les cases ont la MÊME forme ; ce qui change, c'est la taille de l'échantillon
    et ce qu'annonce l'étiquette, tous deux dictés par apca.CONTRAT :
      dès 14 px    : « Texte » à 14 px, la taille réelle du corps de la maquette. Ce sont
                     les SEULS crans utilisables en fond de tableau (13,6 px) ;
      dès 18 px    : « Texte » à 18 px. Le cran tient 75 mais pas 90 : il ne peut donc pas
                     porter le corps de la maquette. L'étiquette le dit par sa taille, et
                     l'échantillon est rendu à 18 px pour qu'on voie de quoi on parle ;
      gros titre   : « Titre » à 19 px gras — le plancher du « gros texte » d'APCA,
                     seul texte que le cran autorise ;
      sans texte   : « Titre » en gros lui aussi, dans la meilleure polarité, mais
                     l'étiquette dit « Pas pour les textes ». On montre le cas le
                     plus FAVORABLE échouer, ce qui est l'information utile ;
                     laisser la case muette n'en donnait aucune.
    Chaque case porte en plus son verdict d'usage en INTERFACE (filet, bordure, puce) :
    voir usage_interface().

    `charte` : ce cran ne calcule rien, il PORTE le hex de la charte. Il est alors cerclé
    d'un liseré foncé et surmonté d'un badge posé AU-DESSUS de la case. Toutes les cases
    réservent donc la même hauteur au-dessus d'elles (`.case`, marge haute) : sans cette
    gouttière, le badge d'une rampe repliée recouvrirait la rangée du dessus.

    Le badge garde les couleurs de la PAGE (encre nuit sur papier) et non celles de la
    case : c'est la seule étiquette de la planche qui doit rester lisible quel que soit le
    cran badgé, y compris un futur cran sombre."""
    texte_admis, garanti, usage = apca.CONTRAT[cran]
    badge = '<span class="case__badge">charte</span>' if charte else ''
    classe_charte = ' case--charte' if charte else ''
    ui = _interface(hexa, PAPIER, ZEBRE)

    # ── Cran sans texte (400) : même présentation que les autres — Robin l'a demandé, et
    #    ça se défend : voir l'échantillon buter contre son seuil est plus parlant qu'une
    #    case vide. Ce qui compte, c'est que l'étiquette ne mente pas : elle dit « Pas pour
    #    les textes », et l'échantillon est rendu dans la meilleure polarité, sans prétendre
    #    à un usage. La mention « au mieux » disparaît : elle alourdissait la lecture.
    if texte_admis is None:
        meilleure, meilleur_lc = apca.meilleure_polarite(hexa)
        return (
            '<div class="case case--sanstexte%s" style="--fond:%s;--encre-case:%s">'
            '%s%s<p class="case__texte case__texte--gros">Titre</p>%s%s</div>'
        ) % (classe_charte, hexa, meilleure, badge, _tete(cran, hexa),
             _pied('Lc&nbsp;%s' % fr(meilleur_lc), 'Pas pour les textes'), ui)

    # ── Crans porteurs de texte : l'échantillon est rendu à la TAILLE que le contrat
    #    autorise, et cette taille est écrite sur la case — c'est l'information utile.
    #    Le noir/blanc n'est PAS choisi par mesure ici : il est imposé par le contrat du
    #    cran (c'est tout l'intérêt d'une grille à clarté fixe).
    lc = apca.lc(texte_admis, hexa)
    classe_texte, echantillon = CLASSE_TAILLE[usage]
    role = '%s · %s' % ('texte blanc' if texte_admis == apca.BLANC else 'texte noir',
                        ETIQUETTE_TAILLE[usage])
    return (
        '<div class="case%s" style="--fond:%s;--encre-case:%s">'
        '%s%s<p class="%s">%s</p>%s%s</div>'
    ) % (classe_charte, hexa, texte_admis, badge, _tete(cran, hexa), classe_texte,
         echantillon, _pied('Lc&nbsp;%s' % fr(lc), role), ui)


def main():
    global ZEBRE
    css = io.open(CSS_COULEURS, encoding='utf-8').read()
    # Le zébrage vient du CSS : si Robin l'éclaircit, le verdict « filet » des cases suit.
    ZEBRE = resoudre(css, '--szh-zebre') or '#F2F2F2'
    lignes = []
    for cle, libelle in COULEURS:
        marque = resoudre(css, '--c-%s-marque' % cle)
        # Quel cran porte la charte : la RÈGLE vient d'apca (même calcul que le CSS), et le
        # fichier la CONFIRME. Si le cran désigné ne porte pas le hex de charte, la planche
        # se tait plutôt que de mentir — et test/apca-check.py, lui, échoue.
        cran_charte = apca.cran_de_charte(marque)
        if resoudre(css, '--c-%s-%s' % (cle, cran_charte)) != marque:
            cran_charte = None
        cases = []
        for cran in CRANS:
            hexa = resoudre(css, '--c-%s-%s' % (cle, cran))
            if hexa:
                cases.append(pastille(hexa, cran, charte=(cran == cran_charte)))
        # Les alias sont lus dans le CSS, pas récités : si quelqu'un repointe -clair vers
        # un autre cran, la planche doit le montrer. On retrouve le cran par son hex — et
        # comme la charte EST un cran, -normal y aboutit lui aussi : la planche montre donc
        # noir sur blanc que les deux noms mènent au même barreau.
        par_hex = {resoudre(css, '--c-%s-%s' % (cle, c)): c for c in CRANS}
        alias = []
        for nom in ('normal', 'clair', 'fonce'):
            hexa = resoudre(css, '--c-%s-%s' % (cle, nom))
            cible = par_hex.get(hexa, hexa or '?')
            if hexa == marque and cran_charte:
                cible = '%s (charte)' % cible
            alias.append('<code>-%s</code> → %s' % (nom, cible))
        lignes.append(
            '<section class="teinte">'
            '<header class="teinte__tete">'
            '<h2>%s</h2>'
            '<p class="teinte__marque"><span class="puce" style="background:%s"></span>%s</p>'
            '<p class="teinte__alias">%s</p>'
            '</header>'
            '<div class="rampe">%s</div>'
            '</section>' % (echapper(libelle), marque, marque, ' · '.join(alias),
                            ''.join(cases)))

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
.chapo { margin: 0 0 8px; color: var(--encre-cal); font-size: 16px; }
.chapo strong { color: var(--encre); font-weight: 600; }

.eyebrow {
  font-size: 11px; font-weight: 600; letter-spacing: .14em; text-transform: uppercase;
  color: var(--encre-cal); margin: 0 0 14px;
}

/* Légende des QUATRE niveaux d'APCA : la seule information à retenir avant de lire la
   planche. Ils étaient trois, et le premier était faux — « 75 = texte courant » sans dire
   à partir de quelle taille. Un seuil APCA ne vaut que pour un couple (taille, graisse) :
   la légende porte donc la taille sur chaque niveau, et le niveau qui s'applique VRAIMENT
   ici (90, parce que le corps est à 14 px et les tableaux à 13,6 px) est mis en avant. */
.seuils {
  display: flex; flex-wrap: wrap; gap: 0; margin: 32px 0 48px;
  border: 1px solid var(--filet); border-radius: 3px; background: var(--carte);
  box-shadow: var(--ombre); overflow: hidden;
}
.seuil { flex: 1 1 160px; padding: 16px 20px; border-right: 1px solid var(--filet); }
.seuil:last-child { border-right: 0; }
/* Le niveau réellement applicable à cette maquette : liseré haut en encre nuit. Une
   emphase discrète suffit — la légende doit rester une légende, pas un panneau. */
.seuil--notre { box-shadow: inset 0 3px 0 var(--nuit); }
.seuil--notre .seuil__val { font-weight: 600; }
.seuil__note strong { color: var(--encre); font-weight: 600; }
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

/* GOUTTIÈRE HAUTE : toutes les cases réservent la même hauteur au-dessus d'elles, pour
   que le badge « couleur de charte » puisse se poser SUR le bord supérieur sans jamais
   recouvrir la rangée du dessus quand la rampe se replie. Une seule case sur onze porte
   ce badge, mais la gouttière est commune : sinon les rampes ne s'aligneraient pas. */
.case {
  background: var(--fond); color: var(--encre-case);
  border-radius: 3px; padding: 10px 10px 9px; min-height: 150px;
  margin-top: 14px;
  display: flex; flex-direction: column; gap: 6px; position: relative;
  box-shadow: inset 0 0 0 1px rgba(0,0,0,.14);
}

/* Cran SANS TEXTE (400) : présenté comme les autres, avec son échantillon dans la
   meilleure polarité. Ce n'est pas une contradiction — l'étiquette dit « Pas pour les
   textes », et voir l'échantillon buter contre son seuil informe mieux qu'une case vide.
   Le pointillé du liseré dit « cran à part » sans rien cacher de la couleur. */
.case--sanstexte { box-shadow: inset 0 0 0 1px rgba(0,0,0,.28); }
.case--sanstexte .case__role { font-weight: 600; opacity: 1; }
.case--sanstexte .case__texte { opacity: .82; }

/* La charte est UN cran de la rampe : liseré foncé épais + badge posé au-dessus. Le
   liseré est doublé (anneau intérieur ET contour extérieur) pour rester visible aussi
   bien sur un cran très clair que sur un cran sombre. */
.case--charte {
  box-shadow: inset 0 0 0 3px var(--nuit), 0 0 0 1px var(--nuit);
}
.case__haut { display: flex; justify-content: space-between; align-items: baseline; gap: 6px; }
.case__niveau {
  font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: 14px; font-weight: 600;
  font-variant-numeric: tabular-nums; opacity: .85;
}
.case__hex {
  font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: 10px; opacity: .75;
}
/* 14 px : la taille RÉELLE du corps de la maquette (print.css, --body-size = 0,875rem),
   celle qu'annonce l'étiquette de la case. Ces deux nombres doivent rester d'accord —
   un échantillon rendu à une autre taille que celle affichée ferait mentir la planche.
   Hauteur FIXE et contenu aligné en bas : c'est ce qui fait tomber l'échantillon à la
   même hauteur dans les onze cases, qu'il soit à 14 px ou à 19 px gras. */
.case__texte {
  font-family: 'Source Serif 4', Georgia, serif; font-size: 14px; line-height: 1.25;
  margin: 0; color: var(--encre-case); overflow-wrap: anywhere;
  height: 26px; display: flex; align-items: flex-end;
}
/* 18 px : le plancher du niveau 75. Les crans 200 et 700 ne portent du texte qu'à PARTIR
   de cette taille — ils ne peuvent donc servir ni au corps de la maquette (14 px) ni au
   texte des tableaux (13,6 px). L'échantillon est rendu à 18 px précisément pour qu'on
   voie qu'il est plus gros que le corps : c'est la seule façon honnête de montrer un cran
   que la version précédente de cette planche présentait comme du « texte courant ».
   Même hauteur de bloc que les autres (la règle .case__texte ci-dessus) : seule la taille
   de la police change, l'alignement des cases est préservé. */
.case__texte--moyen { font-size: 18px; line-height: 1.15; }
/* « Gros titre » au sens de la légende ci-dessus : 19 px en gras. Les crans 300, 500 et
   600 ne portent QUE ce texte-là — l'échantillon montre donc la taille autorisée, pas
   celle du corps de texte. */
.case__texte--gros {
  font-family: 'Open Sans', system-ui, sans-serif; font-size: 19px; font-weight: 600;
  line-height: 1.15; letter-spacing: -.01em;
}
/* Hauteur FIXE aussi : l'étiquette de rôle tient sur une ou deux lignes selon le cran,
   et sans cette réserve la ligne de Lc se décalait d'une case à l'autre. */
.case__bas { display: flex; flex-direction: column; gap: 1px; min-height: 40px; }
.case__lc {
  font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: 11.5px; font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.case__role { font-size: 10px; letter-spacing: .02em; opacity: .8; }

/* USAGE EN INTERFACE (filet, bordure, puce, icône) : seuil non textuel de 30. Le trait
   est tracé dans la couleur du cran SUR LE FOND DE LA PAGE, jamais sur l'aplat — un
   filet vit sur le papier, c'est donc là qu'il doit se juger. Trois états, parce que le
   papier et le zébrage des tableaux ne donnent pas le même verdict (cran 300). */
.case__ui {
  display: flex; align-items: center; gap: 6px;
  margin: 4px -10px -9px; padding: 5px 10px 4px; margin-top: auto;
  background: var(--carte); color: var(--encre-cal);
  border-radius: 0 0 3px 3px;
}
.case__trait { flex: 0 0 18px; height: 3px; border-radius: 2px; }
.case__uitxt { font-size: 9.5px; letter-spacing: .02em; }
.case__uilc {
  font-family: 'IBM Plex Mono', ui-monospace, monospace; font-variant-numeric: tabular-nums;
  opacity: .75;
}
.case__ui--oui .case__uitxt { color: var(--encre); }
.case__ui--partiel .case__uitxt { color: var(--encre-cal); }
/* « non » : le trait serait invisible sur le papier — on le dit, et on barre le trait
   plutôt que de le montrer comme utilisable. */
.case__ui--non { opacity: .75; }
.case__ui--non .case__trait { position: relative; }
.case__ui--non .case__trait::after {
  content: ''; position: absolute; inset: -4px -1px; border-top: 1px solid var(--encre-cal);
  transform: rotate(-12deg); transform-origin: center;
}
/* Le badge est DANS la case (il ne dépasse plus au-dessus, sinon il chevaucherait la
   rangée précédente quand la rampe se replie sur les petits écrans). Il garde les couleurs
   de la PAGE — encre nuit sur papier — et non celles de la case : c'est la seule étiquette
   dont la lisibilité ne doit pas dépendre du cran badgé.
   Il n'a PAS de white-space:nowrap : « COULEUR DE CHARTE » mesure ~109 px et une colonne de
   la rampe en fait 92 px au plus large des points de rupture — le badge se replie donc sur
   deux lignes au lieu de déborder de la case. */
.case__badge {
  position: absolute; left: 0; right: 0; top: -15px;
  background: var(--nuit); color: var(--papier);
  font-size: 9px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase;
  text-align: center; padding: 2px 4px 3px; border-radius: 3px 3px 0 0;
  white-space: nowrap;
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

</style>

<div class="enveloppe">
  <p class="eyebrow">SZH / CSPS · Maquette de revue</p>
  <h1>Palette annuelle et contrastes</h1>
  <p class="chapo">Chaque numéro de la revue est repeint dans une couleur annuelle. Les six
  couleurs de charte se déclinent en <strong>onze crans de même teinte</strong>, calculés en
  OKLab pour ne pas délaver la couleur, puis mesurés avec <strong>APCA</strong> — le calcul de
  contraste du futur WCAG 3.</p>
  <p class="chapo"><strong>Un seuil de contraste ne vaut jamais seul : il dépend de la taille
  du texte.</strong> C'est la correction que porte cette version de la planche. Le niveau 75,
  longtemps présenté ici comme « le » seuil du texte courant, est en réalité le minimum
  d'APCA et ne s'ouvre qu'à partir de 18 px. Or le corps de cette maquette est à 14 px et le
  texte des tableaux à 13,6 px : le seuil qui s'applique à nous est <strong>90</strong>. Deux
  crans en ont changé d'étiquette sans changer de couleur, le 200 et le 700 — ils plafonnent
  à 80, ce qui est bon dès 18 px et insuffisant pour une cellule de tableau.</p>
  <p class="chapo">La lecture est directe : chaque case porte un échantillon dans la couleur de
  texte qu'elle admet et <em>à la taille qu'elle autorise</em> — « Texte » à 14 px, la taille
  réelle du corps, « Texte » à 18 px pour les crans qui ne descendent pas plus bas, ou
  « Titre » à 19 px gras, le plancher du gros texte. Si un échantillon vous paraît
  difficile à lire à l'écran, c'est que la mesure mentait, pas l'inverse. Un cran ne porte
  <strong>aucun texte</strong>, le 400 : c'est le point où ni le noir ni le blanc ne passent,
  inhérent à toute échelle saturée. Il est montré comme les autres, avec son étiquette
  « Pas pour les textes » — voir la couleur buter contre son seuil est plus parlant qu'une
  case vide.</p>
  <p class="chapo">Sous chaque case, un trait rappelle ce que la couleur vaut comme
  <strong>élément d'interface</strong> — filet, bordure, puce, icône — au seuil non textuel de
  30. Trois verdicts, parce que les deux surfaces réelles de la chaîne ne s'accordent pas : le
  papier blanc et le fond zébré des tableaux. Le cran 300 passe sur papier et pas sur zébrage ;
  les trois crans les plus clairs ne passent nulle part, leur trait est barré.</p>

  <div class="seuils">
    <div class="seuil seuil--notre"><div class="seuil__val">90</div>
      <div class="seuil__quoi">Texte dès 14&nbsp;px</div>
      <div class="seuil__note">le seuil de <strong>cette</strong> maquette : corps d'article
      (14&nbsp;px) et texte de tableau (13,6&nbsp;px).</div></div>
    <div class="seuil"><div class="seuil__val">75</div>
      <div class="seuil__quoi">Texte dès 18&nbsp;px</div>
      <div class="seuil__note">le minimum d'APCA, et seulement à cette taille. Ni le corps,
      ni les tableaux.</div></div>
    <div class="seuil"><div class="seuil__val">60</div>
      <div class="seuil__quoi">Gros texte</div>
      <div class="seuil__note">à partir de 24&nbsp;px, ou 19&nbsp;px en gras.</div></div>
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

</div>
"""

if __name__ == '__main__':
    sys.exit(main())
