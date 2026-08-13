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
NIVEAUX = ['50', '100', '200', '500', '700', '800', '900']
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
    """Nombre à la française : 90.1 -> « 90,1 »."""
    return ('%+.1f' % x).replace('.', ',')


def pastille(hexa, niveau, marque):
    """Une case de la planche : le fond, et DESSUS le texte de la couleur qu'il doit
    porter. La preuve est visuelle — si c'est illisible à l'écran, la valeur mentait."""
    texte, lc = apca.meilleure_polarite(hexa)
    sombre = (texte == apca.BLANC)
    seuil = 75 if niveau != '500' else 60
    classe = 'case' + (' case--marque' if niveau == '500' else '')
    role = ('texte blanc' if sombre else 'texte noir')
    note = 'gros titres' if abs(lc) < 75 else 'texte courant'
    return (
        '<div class="%s" style="--fond:%s;--encre-case:%s">'
        '<div class="case__haut"><span class="case__niveau">%s</span>'
        '<span class="case__hex">%s</span></div>'
        '<p class="case__texte">Zusammenfassung / Résumé</p>'
        '<div class="case__bas"><span class="case__lc">Lc&nbsp;%s</span>'
        '<span class="case__role">%s · %s</span></div>'
        '%s</div>'
    ) % (classe, hexa, texte, niveau, hexa, fr(lc), role, note,
         ('<span class="case__marque">couleur de marque</span>' if niveau == '500' else ''))


def main():
    css = io.open(CSS_COULEURS, encoding='utf-8').read()
    lignes = []
    for cle, libelle in COULEURS:
        cases = []
        marque = resoudre(css, '--c-%s-500' % cle)
        for niveau in NIVEAUX:
            hexa = resoudre(css, '--c-%s-%s' % (cle, niveau))
            if hexa:
                cases.append(pastille(hexa, niveau, marque))
        alias = []
        for nom, cible in (('normal', '500'), ('clair', '100'), ('fonce', '800')):
            alias.append('<code>-%s</code> → %s' % (nom, cible))
        lignes.append(
            '<section class="teinte">'
            '<header class="teinte__tete">'
            '<h2>%s</h2>'
            '<p class="teinte__marque"><span class="puce" style="background:%s"></span>%s</p>'
            '<p class="teinte__alias">%s</p>'
            '</header>'
            '<div class="rampe">%s</div>'
            '</section>' % (echapper(libelle), marque, marque, ' · '.join(alias), ''.join(cases)))

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


MODELE = """<title>Palette annuelle SZH</title>
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

/* La rampe : 7 niveaux, un ordre réel (du plus clair au plus sombre) — d'où
   l'affichage des numéros, qui portent une information et non une décoration. */
.rampe { display: grid; grid-template-columns: repeat(7, 1fr); gap: 8px; }
@media (max-width: 900px) { .rampe { grid-template-columns: repeat(4, 1fr); } }
@media (max-width: 560px) { .rampe { grid-template-columns: repeat(2, 1fr); } }

.case {
  background: var(--fond); color: var(--encre-case);
  border-radius: 3px; padding: 11px 12px 10px; min-height: 132px;
  display: flex; flex-direction: column; gap: 6px; position: relative;
  box-shadow: inset 0 0 0 1px rgba(0,0,0,.14);
}
.case--marque { box-shadow: inset 0 0 0 2px var(--nuit); }
.case__haut { display: flex; justify-content: space-between; align-items: baseline; gap: 6px; }
.case__niveau {
  font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: 15px; font-weight: 600;
  font-variant-numeric: tabular-nums; opacity: .85;
}
.case__hex {
  font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: 11px; opacity: .75;
}
.case__texte {
  font-family: 'Source Serif 4', Georgia, serif; font-size: 15px; line-height: 1.3;
  margin: auto 0 0; color: var(--encre-case);
}
.case__bas { display: flex; flex-direction: column; gap: 1px; }
.case__lc {
  font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: 12px; font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.case__role { font-size: 10.5px; letter-spacing: .02em; opacity: .8; }
.case__marque {
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
  couleurs de marque se déclinent en <strong>sept niveaux de même teinte</strong>, calculés en
  OKLab pour ne pas délaver la couleur, puis mesurés avec <strong>APCA</strong> — le calcul de
  contraste du futur WCAG 3.</p>
  <p class="chapo">La lecture est directe : chaque case porte le texte de la couleur qu'elle
  doit recevoir. Si un échantillon vous paraît difficile à lire à l'écran, c'est que la mesure
  mentait, pas l'inverse.</p>

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
