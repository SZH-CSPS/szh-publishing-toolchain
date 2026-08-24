#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Compare la numérotation des figures et des tableaux de deux versions linguistiques
du même article, et signale un écart.

    python3 pipeline/verifier-numerotation.py <A.html> <B.html>

Appelé par `make -f <toolkit>/pipeline/Makefile verifier-numerotation A=… B=…`.

**Pourquoi ce contrôle existe.** `filters/szh-numerotation.lua` ne consomme un numéro que
pour un objet légendé : « sans légende, aucun numéro consommé ». C'est un choix défendable
— « Tableau 3 » désigne le 3ᵉ tableau *légendé* — mais il a une conséquence qui ne se voit
pas : « Tableau 2 » peut être le troisième tableau du texte, et si la version traduite
ajoute ou retire une légende, les numérotations française et allemande du **même** article
divergent. Un renvoi « voir Tableau 2 » désigne alors deux objets différents selon la
langue dans laquelle on lit. Rien, jusqu'ici, ne le disait.

**Pourquoi une comparaison et non un changement de règle.** Rendre la numérotation
indépendante des légendes déplacerait tous les numéros de tous les articles déjà publiés,
et les renvois écrits par les auteurs avec eux. La règle reste ; c'est la divergence entre
deux langues qu'on interdit.

**Pourquoi deux chemins passés à la main.** Les deux langues d'un article ne vivent pas
dans le même dossier : la Revue et la Zeitschrift sont deux numéros distincts, et deux
revues distinctes côté OJS. Aucune clé de la fiche ne relie un article à sa traduction —
le `.traduction.yaml` ne suit que l'état des champs de la fiche, jamais le corps. C'est
donc la rédaction qui désigne la paire.
"""

import html
import os
import re
import sys

# Libellés posés par szh-numerotation.lua, dans les quatre langues qu'il connaît.
LIBELLES_FIGURE = ('Figure', 'Abbildung', 'Figura')
LIBELLES_TABLEAU = ('Tableau', 'Tabelle', 'Tabella', 'Table')


def _texte_utile(chemin):
    """Le HTML sans ses <style> ni ses <script> : print.css y parle de « table > caption »."""
    with open(chemin, encoding='utf-8') as f:
        brut = f.read()
    return re.sub(r'(?is)<(script|style)\b.*?</\1>', ' ', brut)


def compter(chemin):
    d = _texte_utile(chemin)
    numeros = [html.unescape(m) for m in
               re.findall(r'class="szh-numero"[^>]*>\s*([A-Za-zÀ-ÿ]+)', d)]
    figures = sum(1 for n in numeros if n in LIBELLES_FIGURE)
    tableaux = sum(1 for n in numeros if n in LIBELLES_TABLEAU)
    # Un objet non légendé ne consomme pas de numéro : c'est lui la cause d'un écart, et
    # c'est donc lui qu'il faut montrer à côté du compte.
    tableaux_total = len(re.findall(r'<table\b', d))
    # Médias : les <img> plus les images décoratives, que szh-numerotation.lua rend en
    # fond CSS (span.szh-decor) parce qu'un <img alt=""> casserait PDF/UA-1.
    medias_total = len(re.findall(r'<img\b', d)) + len(re.findall(r'szh-decor-\d+', d))
    return {
        'figures': figures,
        'tableaux': tableaux,
        'tableaux_total': tableaux_total,
        'tableaux_sans_legende': max(0, tableaux_total - tableaux),
        'medias_total': medias_total,
        'medias_sans_numero': max(0, medias_total - figures),
    }


def _ligne(nom, c):
    return ('  %-34s figures numérotées %-3d tableaux numérotés %-3d '
            '(tableaux sans légende %d, médias sans numéro %d)'
            % (nom, c['figures'], c['tableaux'],
               c['tableaux_sans_legende'], c['medias_sans_numero']))


def main(argv):
    if len(argv) != 3:
        print('[numerotation] ✗ Deux fichiers HTML attendus : A et B.')
        print('[numerotation]   Exemple : make -f <toolkit>/pipeline/Makefile '
              'verifier-numerotation A=out/mon-article/mon-article.html '
              'B="../Zeitschrift 2026-03/out/mein-artikel/mein-artikel.html"')
        print('[numerotation] [de] ✗ Zwei HTML-Dateien erwartet: A und B.')
        return 2
    for chemin in argv[1:]:
        if not os.path.isfile(chemin):
            print('[numerotation] ✗ Fichier introuvable : %s' % chemin)
            print('[numerotation]   À faire : compiler l\'article de cette langue d\'abord '
                  '(make all dans son dossier de numéro).')
            print('[numerotation] [de] ✗ Datei nicht gefunden: %s' % chemin)
            print('[numerotation] [de]   Zu tun: den Artikel dieser Sprache zuerst '
                  'kompilieren (make all in seinem Ausgabeordner).')
            return 2

    a, b = (compter(c) for c in argv[1:])
    nom_a, nom_b = (os.path.basename(c) for c in argv[1:])
    print('[numerotation] Comparaison des deux langues d\'un même article :')
    print(_ligne(nom_a, a))
    print(_ligne(nom_b, b))

    ecarts = []
    if a['figures'] != b['figures']:
        ecarts.append(('figures', a['figures'], b['figures']))
    if a['tableaux'] != b['tableaux']:
        ecarts.append(('tableaux', a['tableaux'], b['tableaux']))

    if not ecarts:
        print('[numerotation] ✓ Les deux langues numérotent le même nombre de figures '
              'et de tableaux : un renvoi « voir Figure 2 » désigne le même objet des '
              'deux côtés.')
        print('[numerotation] [de] ✓ Beide Sprachen nummerieren gleich viele Abbildungen '
              'und Tabellen: ein Verweis « siehe Abbildung 2 » bezeichnet auf beiden '
              'Seiten dasselbe Objekt.')
        return 0

    for quoi, na, nb in ecarts:
        print('[numerotation] ✗ %s : %d dans %s, %d dans %s.'
              % (quoi, na, nom_a, nb, nom_b))
    print('[numerotation]   Un renvoi « voir Figure 2 » ne désigne donc pas le même objet '
          'selon la langue. Cause habituelle : une légende présente d\'un côté et absente '
          'de l\'autre — un objet sans légende ne consomme aucun numéro.')
    print('[numerotation]   À faire : légender des deux côtés les mêmes objets, ou retirer '
          'la légende des deux côtés. Les comptes « sans légende » ci-dessus disent où '
          'chercher.')
    for quoi, na, nb in ecarts:
        libelle = 'Abbildungen' if quoi == 'figures' else 'Tabellen'
        print('[numerotation] [de] ✗ %s: %d in %s, %d in %s.'
              % (libelle, na, nom_a, nb, nom_b))
    print('[numerotation] [de]   Ein Verweis « siehe Abbildung 2 » bezeichnet je nach '
          'Sprache also nicht dasselbe Objekt. Übliche Ursache: eine Legende auf der einen '
          'Seite vorhanden, auf der anderen nicht — ein Objekt ohne Legende verbraucht '
          'keine Nummer.')
    print('[numerotation] [de]   Zu tun: auf beiden Seiten dieselben Objekte mit einer '
          'Legende versehen, oder die Legende auf beiden Seiten entfernen. Die Zahlen '
          '« ohne Legende » oben sagen, wo zu suchen ist.')
    return 1


if __name__ == '__main__':
    sys.exit(main(sys.argv))
