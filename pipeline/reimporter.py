#!/usr/bin/env python3
# reimporter.py — remplace le corps d'un article par celui d'un Word corrigé, sans perdre
# le travail de la rédaction. Invoqué depuis le dossier de la revue :
#
#   python3 reimporter.py --article <slug>            # le Word est celui de `source:`
#   python3 reimporter.py --word "<nom>.docx"         # l'article est celui de `source:`
#   python3 reimporter.py --article <slug> --word "<nom>.docx"     # appariement forcé
#   python3 reimporter.py --annuler --article <slug>  # revenir à l'état d'avant
#   python3 reimporter.py --reprise                   # remettre d'aplomb un réimport tué
#   python3 reimporter.py --empreintes --dossier . --slug <slug> [--word <nom>]
#
# Le dernier mode n'est pas pour un humain : import-docx.sh l'appelle en fin d'import pour
# noter ce que la conversion a produit (voir « Empreintes » plus bas).
#
# CE QUE LE WORD POSSÈDE, ET RIEN D'AUTRE
#
#   <slug>.md         le corps
#   <slug>.biblio.md  la bibliographie détachée à l'import — mêmes conditions qu'un tableau
#   media/            les images du corps, nommées d'après leur ordre de citation
#   tables/           les tableaux — sous conditions, c'est tout le sujet de ce script
#
# Tout le reste du dossier de l'article est recopié tel quel : la fiche <slug>.meta.yaml,
# le suivi de traduction, les tâches, portraits/, et tout fichier qu'une version future y
# rangerait. La règle est une liste blanche de ce qui est remplacé, non une liste de ce qui
# survit : un sidecar inventé demain survivra sans qu'on y pense.
#
# LES TABLEAUX : TROIS ÉTATS, PAS DEUX
#
# Un tableau vit deux vies. L'auteur le corrige dans son Word ; la rédaction le retravaille
# dans l'éditeur de tableaux (préréglage, fusions, légende, description pour les lecteurs
# d'écran). Comparer le fichier vivant au nouveau ne dit pas laquelle des deux a bougé.
# D'où les empreintes : à chaque import, on note le SHA-256 de ce que la conversion a
# produit. Trois comparaisons deviennent alors possibles, et la décision est claire :
#
#   * le Word livre le même tableau qu'à l'import (empreinte retrouvée) -> l'auteur n'y a
#     pas touché : la version de la rédaction est GARDÉE, quel qu'ait été son travail. Si
#     le tableau a changé de rang (l'auteur en a inséré un avant), il suit son rang.
#   * le Word livre un tableau différent, et la rédaction n'avait pas touché celui-là ->
#     la version du Word REMPLACE l'ancienne. Personne ne perd rien.
#   * le Word livre un tableau différent ET la rédaction avait retravaillé le sien -> la
#     version du Word gagne, et le conflit est NOMMÉ au rédacteur, avec le chemin où
#     retrouver la sienne. Pourquoi le Word gagne : le corps et le tableau viennent du même
#     document. Garder l'ancien tableau publierait une donnée que l'auteur vient de
#     corriger, sous un texte qui parle de la nouvelle — et le ferait en silence, ce qui
#     est exactement le défaut que cette fonction existe pour réparer. Rien n'est détruit :
#     l'ancien dossier entier attend dans .szh-avant-reimport/.
#   * article importé avant les empreintes -> on ne peut pas savoir. Tout tableau qui
#     diffère est traité comme un conflit, et un message le dit une fois pour l'article.
#
# LA BIBLIOGRAPHIE : LE MÊME MODÈLE, SUR UN SEUL FICHIER
#
# Depuis que l'import détache la bibliographie dans <slug>.biblio.md, elle vit les deux
# mêmes vies qu'un tableau : l'auteur corrige ses références dans son Word, et la rédaction
# peut les corriger ici — l'arborescence du cockpit ouvre ce fichier d'un clic. Les trois
# états sont donc les mêmes, sur un fichier au lieu d'une série :
#
#   * le Word livre les mêmes références qu'à l'import -> la version d'ici est GARDÉE ;
#   * le Word livre autre chose, personne n'avait touché -> le Word REMPLACE ;
#   * les deux ont bougé -> le Word gagne (le corps et les références viennent du même
#     document), et le conflit est NOMMÉ, avec le chemin de l'ancienne version.
#
# Et deux cas propres à un fichier unique : le Word qui n'en détache plus (ses références
# ne portent plus le style ; la liste reste dans son corps, et le fichier d'ici s'en va),
# et l'article importé quand la chaîne détachait déjà sans noter l'empreinte — on ne peut
# alors pas savoir, et un message le dit plutôt que d'accuser la rédaction à tort.
#
# ⚠ La bibliographie compte AUSSI dans « rien à faire » : sans cela, un Word dont seules
# les références changent était jugé sans effet, consommé, et la correction de l'auteur
# était jetée en silence — mesuré. C'est le défaut même que ce script existe pour empêcher.
#
# LES IMAGES : ELLES VOYAGENT AVEC LE CORPS
#
# import-medias.py les nomme <slug>-fig-NN d'après leur ordre de première citation dans le
# texte. Une image insérée en tête décale toute la numérotation : mélanger l'ancien jeu et
# le nouveau produirait des figures qui ne correspondent plus à leurs légendes. media/ est
# donc remplacé en entier. Ce qui pourrait se perdre — une image que la rédaction avait
# déposée à la main, une que l'auteur a retirée — est compté et nommé, et l'ancien media/
# attend dans .szh-avant-reimport/. Les portraits ne sont pas concernés : ils vivent dans
# portraits/, appartiennent au formulaire des auteur·e·s, et ne sont pas touchés.
#
# LA FICHE : ELLE SURVIT, MAIS CE QUE LE WORD DISAIT EST DÉPOSÉ À CÔTÉ
#
# La fiche est saisie à la main et ne doit pas être écrasée. Mais l'auteur a peut-être
# corrigé son titre ou son résumé dans le Word. La fiche que ce Word aurait produite est
# donc écrite dans le rebut sous fiche-du-word.meta.yaml, et les champs qui diffèrent sont
# nommés. À la rédaction de recopier ce qu'elle veut, dans son formulaire.
#
# RÉVERSIBILITÉ ET INTERRUPTION
#
# Le dossier de l'article n'est jamais modifié sur place : il est déplacé — pas copié —
# dans .szh-avant-reimport/<slug>/<horodatage>/article-avant/, avec le Word consommé, un
# journal et un LISEZ-MOI. `--annuler` remet cet état en place, et met de côté celui qu'il
# remplace : on peut donc annuler l'annulation. Ces dossiers occupent de la place, surtout
# à cause des images ; le LISEZ-MOI dit qu'on peut les supprimer à la main.
#
# La bascule est faite de deux renommages voisins dans articles/ (atomiques, même système
# de fichiers) : l'ancien dossier prend le nom .szh-bascule-<slug>, puis le nouveau prend
# sa place. Tuer le script n'importe où ne laisse jamais un article à moitié remplacé :
# tout ce qui précède la bascule se passe dans articles/.szh-reimport-<slug>/, invisible du
# Makefile comme du cockpit (le point de tête écarte le dossier des jokers), et un reste de
# chantier est reconnu et repris au lancement suivant, ou par `--reprise`, que la cible
# `import` du Makefile appelle à chaque compilation : un article laissé sous
# .szh-bascule-<slug> serait invisible du numéro, et se publierait sans lui sans un mot.
#
# SORTIE
#
# Une ligne JSON sur stdout, comme portraits.py et docx-meta.py, et rien d'autre sur
# stdout : c'est le contrat du cockpit. Les messages destinés au rédacteur vont sur stderr
# et dans articles-word/.import.log, français puis allemand, avec un code stable en
# deuxième champ. Code de sortie : 0 réussi, 3 rien à faire, 4 refusé, 1 échec, 2 appel
# mal formé.
#
# stdlib uniquement, comme les autres maillons : pas de PyYAML dans la WSL.

import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import time

NOM_EMPREINTES = '.szh-import.empreintes'
DOSSIER_REBUT = '.szh-avant-reimport'
PREFIXE_TEMP = '.szh-reimport-'          # chantier, dans articles/
PREFIXE_BASCULE = '.szh-bascule-'        # ancien dossier, le temps de deux renommages
DOSSIER_WORD = 'articles-word'
NOM_JOURNAL = '.import.log'

PREFIXE_INFO = '[reimport]'
PREFIXE_AVERT = '[import-avertissement]'

# Le fichier de la bibliographie détachée. Nommé ici une fois pour toutes, comme
# szh-biblio-detacher.lua le nomme à l'import et lib/citations.js à l'édition.
def nom_biblio(slug):
    return slug + '.biblio.md'


# Ce que le Word possède dans le dossier de l'article. Tout le reste survit.
def possede_par_le_word(slug):
    return {slug + '.md', nom_biblio(slug), 'media', 'tables', NOM_EMPREINTES}

EXTENSIONS_IMAGE = ('.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.bmp',
                    '.tif', '.tiff', '.emf', '.wmf')

# Les issues, et le code de sortie du processus. Ce code est AUSSI dans la ligne JSON
# (champ `code`) : un appelant qui teste $? et un appelant qui lit le JSON doivent
# conclure la même chose, et un contrôle du banc le mesure sur les cinq issues.
#
#   0 reussi   le corps vient du Word corrigé
#   3 rien     un Word a été examiné, il ne changeait rien ; il est consommé
#   4 refuse   il n'y avait rien à faire de ce Word ou de cet article, et RIEN n'a été
#              touché. Ce n'est pas une panne : à ne jamais peindre en rouge.
#   1 echec    la conversion ou le système de fichiers a lâché ; l'article est intact
#   2 —        appel mal formé (pas de ligne JSON : c'est un bug d'appelant)
#
# ⚠ `--article <slug>` sur un article dont aucun Word n'attend rend 4 (`reimport-sans-word`)
# et non 3. La distinction est voulue : « rien » veut dire qu'un document a été lu et
# n'apportait rien ; « refusé » qu'il n'y avait aucun document à lire. Le geste attendu du
# rédacteur diffère — dans un cas il n'a rien à faire, dans l'autre il doit déposer le Word
# corrigé — et c'est le message qui le dit.
CODES = {0: 'reussi', 3: 'rien', 4: 'refuse', 1: 'echec'}


# ---------------------------------------------------------------------------------
# Messages

class Voix(object):
    """Dit au rédacteur, sur stderr et dans le journal d'import. Garde la liste des codes
    d'avertissement pour la ligne JSON."""

    def __init__(self, journal):
        self.journal = journal
        self.avertissements = []
        self.lignes = []

    def _poser(self, ligne):
        self.lignes.append(ligne)
        print(ligne, file=sys.stderr, flush=True)
        if not self.journal:
            return
        try:
            with open(self.journal, 'a', encoding='utf-8', newline='\n') as f:
                f.write(ligne + '\n')
        except OSError:
            pass                          # un journal illisible ne casse pas le réimport

    def dire(self, fr, de):
        # Les deux langues sont exigées par la signature : un message à moitié traduit ne
        # doit pas pouvoir sortir d'ici.
        self._poser(PREFIXE_INFO + ' ' + fr + ' [de] ' + de)

    def avertir(self, code, champs, fr, de):
        self.avertissements.append(code)
        self._poser(' | '.join([PREFIXE_AVERT + ' ' + code] + list(champs)
                               + [fr, '[de] ' + de]))


# ---------------------------------------------------------------------------------
# Empreintes : ce que l'import a produit, pour que le réimport sache ce que personne
# n'a retouché. Format tabulé, LF, comme les autres fichiers d'instructions.

ENTETE_EMPREINTES = (
    "# Ce que l'import a produit, et son empreinte. Écrit par la conversion, lu par\n"
    "# « Réimporter cet article » : c'est ce qui lui permet de distinguer un tableau ou\n"
    "# une bibliographie retravaillés par la rédaction de ce que le Word avait livré. Le\n"
    "# modifier ou le supprimer ne casse rien : le réimport devient seulement prudent,\n"
    "# et nomme comme ambigu ce qu'il ne peut plus trancher.\n")


def sha(chemin):
    h = hashlib.sha256()
    with open(chemin, 'rb') as f:
        for bloc in iter(lambda: f.read(65536), b''):
            h.update(bloc)
    return h.hexdigest()


def lister_tables(dossier):
    """{numéro: nom} des tables/table-NN.html d'un dossier d'article."""
    trouvees = {}
    base = os.path.join(dossier, 'tables')
    try:
        noms = sorted(os.listdir(base))
    except OSError:
        return trouvees
    for nom in noms:
        m = re.match(r'^table-(\d+)\.html$', nom)
        if m and os.path.isfile(os.path.join(base, nom)):
            trouvees[int(m.group(1))] = nom
    return trouvees


def lister_images(dossier):
    """{chemin relatif à l'article: sha} des images de media/, récursif."""
    trouvees = {}
    base = os.path.join(dossier, 'media')
    for racine, _, fichiers in os.walk(base):
        for nom in sorted(fichiers):
            if not nom.lower().endswith(EXTENSIONS_IMAGE) or nom.startswith('~$'):
                continue
            complet = os.path.join(racine, nom)
            rel = os.path.relpath(complet, dossier).replace(os.sep, '/')
            trouvees[rel] = sha(complet)
    return trouvees


def ecrire_empreintes(dossier, slug, nom_word, tableaux=None, biblio=None):
    """Note ce que le Word a livré. Rend le nombre de lignes écrites.

    `tableaux` ({rang: sha}) sert au réimport : ce qui est INSTALLÉ à un rang peut être la
    version que la rédaction avait retravaillée, mais l'empreinte doit décrire ce que le
    Word livrait. Sans cette distinction, un tableau gardé passerait au réimport suivant
    pour une modification de l'auteur, et chaque réimport rouvrirait le même faux conflit.

    `biblio` dit la même chose de <slug>.biblio.md, et la même subtilité s'y applique :
    l'empreinte du fichier livré par le Word, '' si ce Word n'en détachait pas, None pour
    mesurer le fichier installé — c'est le cas de l'import, où il n'y a rien d'autre.
    """
    lignes = []
    if nom_word:
        lignes.append('word\t%s' % nom_word)
    lignes.append('date\t%s' % time.strftime('%Y-%m-%dT%H:%M:%S'))
    corps = os.path.join(dossier, slug + '.md')
    if os.path.isfile(corps):
        lignes.append('corps\t%s\t%s' % (sha(corps), slug + '.md'))
    refs = os.path.join(dossier, nom_biblio(slug))
    if biblio is None and os.path.isfile(refs):
        biblio = sha(refs)
    if biblio:
        lignes.append('biblio\t%s\t%s' % (biblio, nom_biblio(slug)))
    presentes = lister_tables(dossier)
    for num in sorted(set(presentes) | set(tableaux or {})):
        if tableaux and num in tableaux:
            empreinte = tableaux[num]
        else:
            empreinte = sha(os.path.join(dossier, 'tables', presentes[num]))
        lignes.append('tableau\t%s\ttables/table-%02d.html' % (empreinte, num))
    for rel, empreinte in sorted(lister_images(dossier).items()):
        lignes.append('image\t%s\t%s' % (empreinte, rel))
    with open(os.path.join(dossier, NOM_EMPREINTES), 'w',
              encoding='utf-8', newline='\n') as f:
        f.write(ENTETE_EMPREINTES)
        f.write('\n'.join(lignes) + '\n')
    return len(lignes)


def lire_empreintes(dossier):
    """{'tableau': {num: sha}, 'image': {rel: sha}, 'corps': sha|None, 'biblio': sha|None,
    'word': nom|None}. Absent ou illisible -> tout vide, et l'appelant se montre prudent."""
    vu = {'tableau': {}, 'image': {}, 'corps': None, 'biblio': None, 'word': None,
          'present': False}
    chemin = os.path.join(dossier, NOM_EMPREINTES)
    try:
        with open(chemin, encoding='utf-8') as f:
            contenu = f.read()
    except OSError:
        return vu
    vu['present'] = True
    for ligne in contenu.splitlines():
        if not ligne or ligne.startswith('#'):
            continue
        champs = ligne.split('\t')
        if champs[0] == 'word' and len(champs) >= 2:
            vu['word'] = champs[1]
        elif champs[0] == 'corps' and len(champs) >= 2:
            vu['corps'] = champs[1]
        elif champs[0] == 'biblio' and len(champs) >= 2:
            vu['biblio'] = champs[1]
        elif champs[0] == 'tableau' and len(champs) >= 3:
            m = re.search(r'table-(\d+)\.html$', champs[2])
            if m:
                vu['tableau'][int(m.group(1))] = champs[1]
        elif champs[0] == 'image' and len(champs) >= 3:
            vu['image'][champs[2]] = champs[1]
    return vu


# ---------------------------------------------------------------------------------
# Fiches : lecture du champ `source:` et comparaison bloc à bloc, sans PyYAML.

def lire_source(chemin_fiche):
    """Valeur du champ `source:` d'une fiche, sans ses guillemets. '' si absent."""
    # utf-8-sig : d'anciennes fiches portent un BOM, le codec le retire.
    try:
        with open(chemin_fiche, encoding='utf-8-sig') as f:
            contenu = f.read()
    except OSError:
        return ''
    for ligne in contenu.splitlines():
        if ligne.startswith('source:'):
            v = ligne[len('source:'):].strip()
            if len(v) >= 2 and v[0] == '"' and v[-1] == '"':
                v = v[1:-1].replace('\\"', '"').replace('\\\\', '\\')
            return v
    return ''


def blocs_fiche(chemin):
    """{clé de premier niveau: texte du bloc}. Une clé commence en colonne 0 ; ses lignes
    indentées et ses tirets lui appartiennent. Assez fin pour dire quels champs diffèrent,
    et sans dépendance.

    Les lignes `photo:` des auteur·e·s sont écartées : leur valeur est décidée par le
    détourage, non par l'auteur, et elles feraient diverger la liste des auteurs à chaque
    fois sans rien dire de son contenu."""
    blocs = {}
    try:
        with open(chemin, encoding='utf-8-sig') as f:
            contenu = f.read()
    except OSError:
        return blocs
    cle = None
    for ligne in contenu.splitlines():
        if not ligne.strip():
            continue
        if re.match(r'^[\s-]*photo:', ligne):
            continue
        if ligne[0] not in ' -':
            m = re.match(r'^([A-Za-z_][A-Za-z0-9_-]*):(.*)$', ligne)
            if m:
                cle = m.group(1)
                blocs[cle] = blocs.get(cle, '') + m.group(2).strip() + '\n'
                continue
        if cle:
            blocs[cle] = blocs.get(cle, '') + ligne.strip() + '\n'
    return blocs


def champs_divergents(fiche_vivante, fiche_du_word):
    """Champs que le Word remplit autrement que la fiche. Un champ dont le Word ne dit
    rien n'est pas un écart : il n'y aurait rien à recopier. `source` est écarté, il est
    égal par construction et ne dit rien du contenu."""
    a, b = blocs_fiche(fiche_vivante), blocs_fiche(fiche_du_word)
    return [cle for cle in sorted(b)
            if cle != 'source' and b[cle].strip() and b[cle] != a.get(cle, '')]


# ---------------------------------------------------------------------------------
# Appariement article <-> Word

def articles_de_la_revue(revue):
    """[(slug, chemin fiche, source)] pour tout article ayant un corps."""
    trouves = []
    base = os.path.join(revue, 'articles')
    try:
        noms = sorted(os.listdir(base))
    except OSError:
        return trouves
    for nom in noms:
        dossier = os.path.join(base, nom)
        if not os.path.isdir(dossier) or nom.startswith('.'):
            continue
        if not os.path.isfile(os.path.join(dossier, nom + '.md')):
            continue
        fiche = os.path.join(dossier, nom + '.meta.yaml')
        trouves.append((nom, fiche, lire_source(fiche)))
    return trouves


def trouver_word(revue, nom):
    """Le .docx en attente, désigné par un nom ou par un chemin. Comparaison insensible à
    la casse, comme le nocaseglob de la cible `import`."""
    if os.sep in nom or '/' in nom:
        return nom if os.path.isfile(nom) else None
    direct = os.path.join(revue, DOSSIER_WORD, nom)
    if os.path.isfile(direct):
        return direct
    base = os.path.join(revue, DOSSIER_WORD)
    try:
        for present in sorted(os.listdir(base)):
            if present.lower() == nom.lower() and os.path.isfile(os.path.join(base, present)):
                return os.path.join(base, present)
    except OSError:
        pass
    return None


# ---------------------------------------------------------------------------------
# Rebut : l'état d'avant, daté, et son mode d'emploi.

LISEZ_MOI = """\
Ce dossier garde l'état d'avant chaque « Réimporter cet article ».

Un sous-dossier par article, un sous-sous-dossier par réimport, daté :

  <article>/<date>/article-avant/          le dossier de l'article, entier, tel qu'il
                                           était juste avant le remplacement
  <article>/<date>/fiche-du-word.meta.yaml ce que le Word corrigé disait des
                                           métadonnées, s'il en disait autre chose que
                                           la fiche. Rien n'en a été recopié : la fiche
                                           appartient au formulaire du cockpit.
  <article>/<date>/portraits-du-word/      les photos d'auteur·e·s que le Word portait.
                                           Elles ne sont pas réinstallées : les portraits
                                           du dossier de l'article ont pu être retouchés.
  <article>/<date>/<nom>.docx              le Word consommé par ce réimport
  <article>/<date>/journal.txt             ce que le réimport a fait et signalé

REVENIR EN ARRIÈRE

Dans le cockpit : « Annuler le réimport » sur l'article. En ligne de commande, depuis le
dossier de la revue :

  python3 <toolkit>/pipeline/reimporter.py --annuler --article <article>

L'état remplacé est lui-même mis de côté : on peut annuler l'annulation.

Ces dossiers ne servent qu'à cela. Ils occupent de la place, en particulier les images :
on peut les supprimer à la main quand le numéro est publié.

[de] DIESER ORDNER BEWAHRT DEN ZUSTAND VOR JEDEM « Artikel neu importieren ».

Ein Unterordner pro Artikel, darin ein datierter Ordner pro Neuimport:
article-avant/ ist der vollständige Artikelordner, wie er unmittelbar vor dem Austausch
war; fiche-du-word.meta.yaml enthält, was die korrigierte Word-Datei über die Metadaten
sagte (nichts davon wurde übernommen: die Metadaten gehören dem Formular des Cockpits);
portraits-du-word/ enthält die Autorenfotos aus der Word-Datei (sie werden nicht neu
installiert, die vorhandenen konnten bearbeitet sein); dazu die verbrauchte Word-Datei und
ein Protokoll.

Zurück zum vorherigen Zustand: im Cockpit « Neuimport widerrufen », oder im
Revue-Ordner:

  python3 <toolkit>/pipeline/reimporter.py --annuler --article <artikel>

Der ersetzte Zustand wird ebenfalls beiseitegelegt: der Widerruf ist widerrufbar.

Diese Ordner dienen nur dazu. Sie brauchen Platz, vor allem wegen der Bilder, und können
nach der Veröffentlichung der Ausgabe von Hand gelöscht werden.
"""


def horodatage():
    return time.strftime('%Y-%m-%d_%H-%M-%S')


def creer_rebut(revue, slug, suffixe=''):
    base = os.path.join(revue, DOSSIER_REBUT)
    os.makedirs(base, exist_ok=True)
    try:
        with open(os.path.join(base, 'LISEZ-MOI.txt'), 'w',
                  encoding='utf-8', newline='\r\n') as f:
            f.write(LISEZ_MOI)
    except OSError:
        pass                              # le mode d'emploi n'est pas la sauvegarde
    # Un réimport par seconde au plus : le suffixe -2, -3 lève l'égalité si besoin.
    souche = os.path.join(base, slug, horodatage() + suffixe)
    chemin, n = souche, 1
    while os.path.exists(chemin):
        n += 1
        chemin = '%s-%d' % (souche, n)
    os.makedirs(chemin)
    return chemin


def rebuts_de(revue, slug):
    """Les rebuts de cet article, du plus récent au plus ancien."""
    base = os.path.join(revue, DOSSIER_REBUT, slug)
    try:
        noms = os.listdir(base)
    except OSError:
        return []
    return [os.path.join(base, n) for n in sorted(noms, reverse=True)
            if os.path.isdir(os.path.join(base, n))]


# ---------------------------------------------------------------------------------
# Reprise d'un chantier interrompu. Trois restes possibles, et un seul est grave :
# le dossier de l'article déplacé sous .szh-bascule-<slug> et pas encore remplacé.

def reprendre_tout(revue, voix):
    """Balaie articles/ des restes d'un réimport interrompu. Sans article à nommer : quand
    le kill est tombé dans la fenêtre de la bascule, articles/<slug> n'existe plus et
    l'article est introuvable — c'est justement là qu'il faut secourir. Rend le nombre
    d'articles remis d'aplomb."""
    articles = os.path.join(revue, 'articles')
    try:
        restes = sorted(os.listdir(articles))
    except OSError:
        return 0
    repris = 0
    for nom in restes:
        if not nom.startswith(PREFIXE_BASCULE) \
                or not os.path.isdir(os.path.join(articles, nom)):
            continue
        slug = nom[len(PREFIXE_BASCULE):]
        try:
            repris += 1 if reprendre(revue, slug, voix) else 0
        except OSError as exc:
            # Le seul endroit où un échec laisse l'article introuvable : il doit se lire
            # comme une phrase, pas comme une trace Python.
            voix.avertir(
                'reimport-reprise-impossible',
                ['article « %s »' % slug, 'dossier « articles/%s »' % nom,
                 'détail : %s' % exc],
                "Un réimport de cet article s'était interrompu, et son dossier n'a pas pu "
                "être remis en place : l'article est absent du numéro, mais rien n'est "
                "perdu — tout est dans le dossier indiqué. Fermez ce qui pourrait le "
                "tenir ouvert (Word, l'explorateur, la synchronisation), puis relancez la "
                "compilation ; ou renommez ce dossier à la main sous le nom de l'article.",
                'Ein Neuimport dieses Artikels wurde unterbrochen, und sein Ordner konnte '
                'nicht zurückgesetzt werden: der Artikel fehlt in der Ausgabe, doch '
                'nichts ist verloren — alles liegt im genannten Ordner. Schliessen Sie, '
                'was ihn offen halten könnte (Word, Explorer, Synchronisierung), und '
                'kompilieren Sie erneut; oder benennen Sie den Ordner von Hand auf den '
                'Namen des Artikels um.')
    for nom in restes:
        if nom.startswith(PREFIXE_TEMP) and os.path.isdir(os.path.join(articles, nom)):
            shutil.rmtree(os.path.join(articles, nom), ignore_errors=True)
    return repris


def reprendre(revue, slug, voix):
    articles = os.path.join(revue, 'articles')
    bascule = os.path.join(articles, PREFIXE_BASCULE + slug)
    vivant = os.path.join(articles, slug)
    temp = os.path.join(articles, PREFIXE_TEMP + slug)
    repris = False
    if os.path.isdir(bascule):
        if not os.path.exists(vivant):
            os.rename(bascule, vivant)
            voix.avertir(
                'reimport-reprise', ['article « %s »' % slug],
                "Un réimport de cet article s'était interrompu en pleine bascule : "
                "l'article a été remis dans l'état d'avant, et rien n'a été perdu. "
                "Relancez le réimport si vous le voulez toujours.",
                'Ein Neuimport dieses Artikels wurde mitten im Austausch unterbrochen: '
                'der Artikel wurde in den vorherigen Zustand zurückgesetzt, nichts ist '
                'verloren. Starten Sie den Neuimport erneut, wenn Sie ihn noch wollen.')
        else:
            cible = os.path.join(creer_rebut(revue, slug, '-reprise'), 'article-avant')
            shutil.move(bascule, cible)
            voix.avertir(
                'reimport-reprise', ['article « %s »' % slug, 'dossier « %s »' % cible],
                "Un réimport de cet article s'était interrompu juste après le "
                "remplacement : le nouveau texte est en place, et l'état d'avant a été "
                "rangé de côté.",
                'Ein Neuimport dieses Artikels wurde unmittelbar nach dem Austausch '
                'unterbrochen: der neue Text steht, der vorherige Zustand wurde zur '
                'Seite gelegt.')
        repris = True
    if os.path.isdir(temp):
        shutil.rmtree(temp, ignore_errors=True)
    return repris


# ---------------------------------------------------------------------------------
# La fusion des tableaux. Voir l'en-tête du fichier pour le raisonnement.

def fusionner_tables(vivant, temp, empreintes, voix, slug):
    """Décide, tableau par tableau, ce que temp/tables doit contenir. Modifie temp en
    place, et rend le compte de chaque issue avec les empreintes de ce que le Word a
    livré — ce sont celles-là qu'il faut noter, non celles de l'installé."""
    bilan = {'gardes': 0, 'remplaces': 0, 'deplaces': 0, 'retires': 0, 'conflits': 0,
             'nouveaux': 0}
    tables_vivantes = lister_tables(vivant)
    tables_neuves = lister_tables(temp)
    if not tables_vivantes and not tables_neuves:
        return bilan, {}

    dossier_neuf = os.path.join(temp, 'tables')
    sha_vivantes = {n: sha(os.path.join(vivant, 'tables', nom))
                    for n, nom in tables_vivantes.items()}
    sha_neuves = {n: sha(os.path.join(dossier_neuf, nom))
                  for n, nom in tables_neuves.items()}
    emp = empreintes['tableau']

    if tables_vivantes and not empreintes['present']:
        voix.avertir(
            'tableaux-origine-inconnue',
            ['article « %s »' % slug, '%d tableau(x)' % len(tables_vivantes)],
            "Cet article a été importé avant que la chaîne ne note l'état des tableaux "
            "à la conversion : impossible de savoir lesquels ont été retravaillés ici. "
            "Tout tableau que le Word corrigé livre autrement est donc signalé, et "
            "l'ancien reste accessible dans le dossier de sauvegarde.",
            'Dieser Artikel wurde importiert, bevor die Kette den Zustand der Tabellen '
            'bei der Konvertierung notierte: es ist nicht feststellbar, welche hier '
            'bearbeitet wurden. Jede Tabelle, die die korrigierte Word-Datei anders '
            'liefert, wird daher gemeldet, und die alte bleibt im Sicherungsordner '
            'zugänglich.')

    # Chaque tableau vivant ne peut servir qu'une fois : un tableau dupliqué dans le Word
    # ne doit pas faire réapparaître deux fois la même version retravaillée.
    pris = set()
    garder = {}                           # rang neuf -> rang vivant à réinstaller
    for k in sorted(sha_neuves):
        rangs = [j for j, s in emp.items()
                 if s == sha_neuves[k] and j in tables_vivantes and j not in pris]
        if not rangs:
            continue
        j = k if k in rangs else rangs[0]
        pris.add(j)
        garder[k] = j

    for k in sorted(sha_neuves):
        cible = os.path.join(dossier_neuf, tables_neuves[k])
        if k in garder:
            j = garder[k]
            source = os.path.join(vivant, 'tables', tables_vivantes[j])
            shutil.copyfile(source, cible)
            if j != k:
                bilan['deplaces'] += 1
                voix.dire(
                    'article « %s » : le tableau %d de la rédaction devient le tableau %d '
                    '— le Word corrigé en a inséré ou retiré un avant lui, son contenu '
                    'est inchangé.' % (slug, j, k),
                    'Artikel « %s »: Tabelle %d der Redaktion wird Tabelle %d — die '
                    'korrigierte Word-Datei hat davor eine eingefügt oder entfernt, der '
                    'Inhalt bleibt gleich.' % (slug, j, k))
            else:
                bilan['gardes'] += 1
            continue
        # Le Word livre autre chose à ce rang.
        if k not in sha_vivantes or k in pris:
            # Rien à ce rang avant, ou bien ce qui y était a suivi son contenu à un autre
            # rang : dans les deux cas personne ne perd rien ici.
            bilan['nouveaux'] += 1
            continue
        if sha_vivantes[k] == sha_neuves[k]:
            bilan['gardes'] += 1
            continue
        travaille = (not empreintes['present']) or emp.get(k) != sha_vivantes[k]
        if travaille:
            bilan['conflits'] += 1
        else:
            bilan['remplaces'] += 1

    restants = sorted(j for j in tables_vivantes
                      if j not in pris and j not in sha_neuves)
    bilan['retires'] = len(restants)
    return bilan, sha_neuves


# ---------------------------------------------------------------------------------
# La bibliographie détachée. Même modèle que les tableaux, sur un fichier unique : voir
# l'en-tête du fichier pour le raisonnement, il est le même mot pour mot.

def fusionner_biblio(vivant, temp, empreintes, slug):
    """Décide ce que temp/<slug>.biblio.md doit contenir, et rend (bilan, empreinte de ce
    que le Word a livré). L'empreinte rendue est celle du WORD, jamais celle de l'installé :
    une bibliographie gardée passerait sinon au réimport suivant pour une correction de
    l'auteur, et le même faux conflit se rouvrirait indéfiniment.

    Ne dit rien lui-même : les messages sont posés par l'appelant, après le partage entre
    « rien à faire » et un vrai remplacement."""
    bilan = {'gardee': 0, 'remplacee': 0, 'conflit': 0, 'retiree': 0, 'nouvelle': 0,
             'inconnue': 0}
    ancien = os.path.join(vivant, nom_biblio(slug))
    neuf = os.path.join(temp, nom_biblio(slug))
    sha_ancien = sha(ancien) if os.path.isfile(ancien) else None
    sha_neuf = sha(neuf) if os.path.isfile(neuf) else None
    if sha_ancien is None:
        # Rien à arbitrer : soit le Word en apporte une, soit il n'y en a nulle part.
        bilan['nouvelle'] = 1 if sha_neuf else 0
        return bilan, (sha_neuf or '')
    # L'article a un fichier de bibliographie ; l'empreinte dit-elle d'où il vient ?
    emp = empreintes['biblio'] if empreintes['present'] else None
    retravaillee = emp is None or emp != sha_ancien
    bilan['inconnue'] = 1 if emp is None else 0
    if sha_neuf is None:
        # Les références de ce Word ne portent plus le style de bibliographie : sa liste
        # est restée dans son corps, et le fichier d'ici n'a plus de raison d'être. Il ne
        # revient donc pas — le corps qui le référençait n'est plus là non plus.
        bilan['retiree'] = 1
        bilan['conflit'] = 1 if retravaillee else 0
        return bilan, ''
    if sha_neuf == sha_ancien:
        return bilan, sha_neuf            # les deux disent la même chose : rien à décider
    if emp == sha_neuf:
        # Le Word livre ce qu'il livrait à l'import : l'auteur n'a pas touché ses
        # références, et c'est la version d'ici qui est gardée, quel qu'ait été son travail.
        shutil.copyfile(ancien, neuf)
        bilan['gardee'] = 1
        return bilan, sha_neuf
    if retravaillee:
        bilan['conflit'] = 1
    else:
        bilan['remplacee'] = 1
    return bilan, sha_neuf


# ---------------------------------------------------------------------------------

def copier_preserves(vivant, temp, slug):
    """Recopie dans le chantier tout ce que le Word ne possède pas. Rend la liste des
    noms recopiés, pour le journal."""
    reserves = possede_par_le_word(slug)
    copies = []
    for nom in sorted(os.listdir(vivant)):
        if nom in reserves or nom.startswith(PREFIXE_TEMP):
            continue
        source, cible = os.path.join(vivant, nom), os.path.join(temp, nom)
        if os.path.exists(cible):
            continue                      # déjà déposé par la conversion : on n'écrase pas
        if os.path.isdir(source):
            shutil.copytree(source, cible)
        else:
            shutil.copy2(source, cible)
        copies.append(nom)
    return copies


def memes_octets(a, b):
    if os.path.isfile(a) != os.path.isfile(b):
        return False
    if not os.path.isfile(a):
        return True
    return sha(a) == sha(b)


def rien_a_faire(vivant, temp, slug):
    """Vrai si le corps, la bibliographie, les tableaux et les images sortiraient
    identiques.

    ⚠ La bibliographie en fait partie, et ce n'est pas un détail : mesuré, un Word dont
    SEULES les références changeaient était jugé « rien à faire », son fichier consommé, et
    la correction de l'auteur jetée sans un mot. C'est le remplacement qui la rapporte."""
    if not memes_octets(os.path.join(vivant, slug + '.md'),
                        os.path.join(temp, slug + '.md')):
        return False
    if not memes_octets(os.path.join(vivant, nom_biblio(slug)),
                        os.path.join(temp, nom_biblio(slug))):
        return False
    tv, tn = lister_tables(vivant), lister_tables(temp)
    if sorted(tv) != sorted(tn):
        return False
    for num in tv:
        if not memes_octets(os.path.join(vivant, 'tables', tv[num]),
                            os.path.join(temp, 'tables', tn[num])):
            return False
    return lister_images(vivant) == lister_images(temp)


def pause_eventuelle(etape):
    """Point d'attente pour éprouver une interruption : SZH_REIMPORT_PAUSE=<étape> donne
    le temps d'envoyer un kill -9 à l'endroit voulu. Sans la variable, aucune attente."""
    if os.environ.get('SZH_REIMPORT_PAUSE') != etape:
        return
    delai = float(os.environ.get('SZH_REIMPORT_PAUSE_S') or 5)
    print('%s attente de %g s avant « %s » (SZH_REIMPORT_PAUSE)'
          % (PREFIXE_INFO, delai, etape), file=sys.stderr, flush=True)
    time.sleep(delai)


# ---------------------------------------------------------------------------------
# Le réimport

def reimporter(revue, slug, chemin_docx, pipeline, voix, resultat):
    articles = os.path.join(revue, 'articles')
    vivant = os.path.join(articles, slug)
    temp = os.path.join(articles, PREFIXE_TEMP + slug)
    nom_word = os.path.basename(chemin_docx)
    empreintes = lire_empreintes(vivant)

    shutil.rmtree(temp, ignore_errors=True)
    os.makedirs(temp)

    # La conversion, dans le chantier. Même chaîne que l'import d'un Word neuf : rien
    # n'est dupliqué ici, seul le dossier de destination change.
    env = dict(os.environ)
    env['SZH_IMPORT_DIR'] = os.path.relpath(temp, revue)
    env['PYTHONIOENCODING'] = 'utf-8'
    # Les portraits du Word ne seront pas réinstallés : les détourer coûterait des minutes
    # pour rien. Ils sont quand même rangés, donc déposés dans le rebut.
    env['SZH_SANS_DETOURAGE'] = '1'
    if voix.journal:
        env['SZH_IMPORT_LOG'] = os.path.abspath(voix.journal)
    fini = subprocess.run(
        ['bash', os.path.join(pipeline, 'import-docx.sh'),
         os.path.abspath(chemin_docx), slug, os.path.abspath(pipeline)],
        cwd=revue, env=env, stdout=subprocess.PIPE, text=True, errors='replace')
    for ligne in (fini.stdout or '').splitlines():
        if ligne.strip():
            print(ligne, file=sys.stderr, flush=True)
    if fini.returncode != 0 or not os.path.isfile(os.path.join(temp, slug + '.md')):
        shutil.rmtree(temp, ignore_errors=True)
        voix.avertir(
            'reimport-echec', ['article « %s »' % slug, 'fichier « %s »' % nom_word],
            "La conversion du Word corrigé a échoué : l'article n'a pas été touché et son "
            "fichier reste en attente. Vérifiez que le document s'ouvre dans Word, puis "
            "recommencez.",
            'Die Konvertierung der korrigierten Word-Datei ist fehlgeschlagen: der '
            'Artikel wurde nicht angetastet, die Datei bleibt in der Warteschlange. '
            'Prüfen Sie, ob sich das Dokument in Word öffnet, und versuchen Sie es erneut.')
        return 1

    rebut = creer_rebut(revue, slug)
    resultat['rebut'] = os.path.relpath(rebut, revue).replace(os.sep, '/')

    # 1. La fiche que ce Word aurait produite : mise de côté, jamais installée.
    fiche_word = os.path.join(temp, slug + '.meta.yaml')
    ecarts = []
    if os.path.isfile(fiche_word):
        depot = os.path.join(rebut, 'fiche-du-word.meta.yaml')
        shutil.move(fiche_word, depot)
        ecarts = champs_divergents(os.path.join(vivant, slug + '.meta.yaml'), depot)
    resultat['fiche_differente'] = ecarts
    if ecarts:
        voix.avertir(
            'fiche-du-word-differente',
            ['article « %s »' % slug, 'champs : %s' % ', '.join(ecarts),
             'fichier « %s »' % (resultat['rebut'] + '/fiche-du-word.meta.yaml')],
            "Le Word corrigé ne dit pas la même chose que la fiche de l'article sur ces "
            "champs. La fiche n'a pas été touchée — elle est saisie ici et elle vous "
            "appartient. Ce que le Word disait est déposé dans le fichier indiqué : "
            "ouvrez-le, et recopiez dans « Métadonnées des articles » ce qui doit "
            "changer.",
            'Die korrigierte Word-Datei sagt bei diesen Feldern etwas anderes als die '
            'Metadaten des Artikels. Die Metadaten wurden nicht angetastet — sie werden '
            'hier erfasst und gehören Ihnen. Was die Word-Datei sagte, liegt in der '
            'genannten Datei: öffnen Sie sie und übertragen Sie unter « Metadaten der '
            'Artikel », was sich ändern soll.')

    # 2. Les portraits du Word : rangés de côté, jamais réinstallés.
    portraits_word = os.path.join(temp, 'portraits')
    if os.path.isdir(portraits_word) and os.listdir(portraits_word):
        shutil.move(portraits_word, os.path.join(rebut, 'portraits-du-word'))
    else:
        shutil.rmtree(portraits_word, ignore_errors=True)

    # 3. Les tableaux, puis la bibliographie : deux fichiers du Word que la rédaction
    # retravaille aussi, donc deux décisions à trois états.
    bilan, empreintes_du_word = fusionner_tables(vivant, temp, empreintes, voix, slug)
    resultat['tableaux'] = bilan
    bilan_biblio, biblio_du_word = fusionner_biblio(vivant, temp, empreintes, slug)
    resultat['biblio'] = bilan_biblio

    # 4. Les images. media/ voyage avec le corps ; ce qui n'y revient pas est nommé.
    images_avant = lister_images(vivant)
    images_apres = lister_images(temp)
    shas_apres = set(images_apres.values())
    perdues = sorted(os.path.basename(rel) for rel, s in images_avant.items()
                     if s not in shas_apres)
    resultat['images'] = {'avant': len(images_avant), 'apres': len(images_apres),
                          'non_reimportees': len(perdues)}

    # 5. Rien à faire ? Le Word est quand même consommé : il a été examiné.
    if rien_a_faire(vivant, temp, slug):
        shutil.rmtree(temp, ignore_errors=True)
        shutil.move(chemin_docx, os.path.join(rebut, nom_word))
        voix.dire(
            'article « %s » : le Word « %s » ne change ni le texte, ni la bibliographie, '
            'ni les tableaux, ni les images. Rien n\'a été remplacé, et ce fichier ne sera '
            'plus signalé comme en attente.' % (slug, nom_word),
            'Artikel « %s »: die Word-Datei « %s » ändert weder Text noch '
            'Literaturverzeichnis noch Tabellen noch Bilder. Es wurde nichts ersetzt, und '
            'diese Datei wird nicht mehr als wartend gemeldet.' % (slug, nom_word))
        return 3

    gardes = bilan['gardes'] + bilan['deplaces']
    if gardes:
        voix.dire(
            'article « %s » : %d tableau(x) gardés tels que la rédaction les avait '
            'laissés — le Word corrigé les livre inchangés. Les avertissements de '
            'conversion qui les nomment portent sur la version du Word, non sur celle '
            'qui est en place.' % (slug, gardes),
            'Artikel « %s »: %d Tabelle(n) unverändert übernommen, so wie die Redaktion '
            'sie hinterlassen hat — die korrigierte Word-Datei liefert sie gleich. Die '
            'Konvertierungshinweise zu diesen Tabellen betreffen die Word-Fassung, nicht '
            'die eingesetzte.' % (slug, gardes))
    if perdues:
        montre = ', '.join(perdues[:6]) + ('…' if len(perdues) > 6 else '')
        voix.avertir(
            'image-non-reimportee',
            ['article « %s »' % slug, '%d image(s) : %s' % (len(perdues), montre),
             'dossier « %s »' % (resultat['rebut'] + '/article-avant/media')],
            "Ces images étaient dans l'article et le Word corrigé ne les rapporte pas : "
            "l'auteur les a retirées, ou elles avaient été déposées ici à la main. Elles "
            "ne sont plus dans l'article ; elles attendent dans le dossier indiqué. "
            "Redéposez-les par « Images de l'article » si elles doivent revenir.",
            'Diese Bilder waren im Artikel, und die korrigierte Word-Datei bringt sie '
            'nicht mit: die Autorin oder der Autor hat sie entfernt, oder sie wurden hier '
            'von Hand hinzugefügt. Sie sind nicht mehr im Artikel; sie liegen im '
            'genannten Ordner. Fügen Sie sie über « Bilder des Artikels » wieder ein, '
            'wenn sie zurück sollen.')
    corps_vivant = os.path.join(vivant, slug + '.md')
    if empreintes['corps'] and os.path.isfile(corps_vivant) \
            and sha(corps_vivant) != empreintes['corps']:
        voix.avertir(
            'corps-retravaille',
            ['article « %s »' % slug,
             'fichier « %s »' % (resultat['rebut'] + '/article-avant/' + slug + '.md')],
            "Le texte de cet article avait été retouché ici depuis son import — dans "
            "l'éditeur, hors du Word. Ces retouches ne sont plus dans l'article : c'est "
            "le texte du Word corrigé qui est en place. L'ancien texte est dans le "
            "fichier indiqué, à comparer si des corrections doivent revenir.",
            'Der Text dieses Artikels war hier seit dem Import bearbeitet worden — im '
            'Editor, aussserhalb von Word. Diese Änderungen sind nicht mehr im Artikel: '
            'eingesetzt ist der Text der korrigierten Word-Datei. Der alte Text liegt in '
            'der genannten Datei und kann verglichen werden.')
    if bilan['conflits']:
        voix.avertir(
            'tableau-conflit',
            ['article « %s »' % slug, '%d tableau(x)' % bilan['conflits'],
             'dossier « %s »' % (resultat['rebut'] + '/article-avant/tables')],
            "Ces tableaux avaient été retravaillés ici, et le Word corrigé en livre une "
            "autre version. C'est la version du Word qui est en place, parce que le texte "
            "corrigé parle d'elle. Le travail de mise en forme n'est pas perdu : les "
            "fichiers d'avant sont dans le dossier indiqué. Ouvrez l'éditeur de tableaux "
            "pour refaire le préréglage, les fusions et la description.",
            'Diese Tabellen wurden hier bearbeitet, und die korrigierte Word-Datei '
            'liefert eine andere Fassung. Eingesetzt ist die Fassung aus Word, denn der '
            'korrigierte Text bezieht sich auf sie. Die Gestaltungsarbeit ist nicht '
            'verloren: die vorherigen Dateien liegen im genannten Ordner. Öffnen Sie den '
            'Tabelleneditor, um Voreinstellung, Verbindungen und Beschreibung neu zu '
            'setzen.')
    if bilan['retires']:
        voix.dire(
            'article « %s » : %d tableau(x) de moins — le Word corrigé ne les porte plus.'
            % (slug, bilan['retires']),
            'Artikel « %s »: %d Tabelle(n) weniger — die korrigierte Word-Datei enthält '
            'sie nicht mehr.' % (slug, bilan['retires']))

    # La bibliographie, dans le même ordre que les tableaux : d'abord ce qu'on ne peut pas
    # savoir, ensuite ce qui a été décidé.
    biblio_avant = resultat['rebut'] + '/article-avant/' + nom_biblio(slug)
    if bilan_biblio['conflit'] and bilan_biblio['inconnue']:
        voix.avertir(
            'biblio-origine-inconnue', ['article « %s »' % slug],
            "Cet article a été importé avant que la chaîne ne note l'état de la "
            "bibliographie à la conversion : impossible de savoir si celle qui est ici a "
            "été corrigée depuis. Une bibliographie que le Word corrigé livre autrement "
            "est donc signalée par prudence, et l'ancienne reste accessible dans le "
            "dossier de sauvegarde.",
            'Dieser Artikel wurde importiert, bevor die Kette den Zustand des '
            'Literaturverzeichnisses bei der Konvertierung notierte: es ist nicht '
            'feststellbar, ob das hier vorliegende seither bearbeitet wurde. Ein '
            'Literaturverzeichnis, das die korrigierte Word-Datei anders liefert, wird '
            'daher vorsorglich gemeldet, und das alte bleibt im Sicherungsordner '
            'zugänglich.')
    if bilan_biblio['retiree'] and bilan_biblio['conflit']:
        voix.avertir(
            'biblio-retiree',
            ['article « %s »' % slug, 'fichier « %s »' % biblio_avant],
            "Les références de ce Word ne portent plus le style de bibliographie : sa "
            "liste est restée dans le texte, et l'article n'a plus de bibliographie à "
            "part — celle qui était ici, corrigée depuis l'import, s'en va avec. Rien "
            "n'est perdu : elle est dans le fichier indiqué. Pour retrouver une "
            "bibliographie à part, celle que l'export vers la plateforme attend, donnez "
            "aux références le style de bibliographie dans le Word, puis réimportez.",
            'Die Einträge dieser Word-Datei tragen die Formatvorlage für '
            'Literaturverzeichnisse nicht mehr: die Liste blieb im Text, und der Artikel '
            'hat kein eigenes Literaturverzeichnis mehr — das hier vorliegende, seit dem '
            'Import bearbeitete, geht mit. Nichts ist verloren: es liegt in der genannten '
            'Datei. Für ein eigenes Literaturverzeichnis, das der Export auf die Plattform '
            'erwartet, geben Sie den Einträgen im Word die Formatvorlage für '
            'Literaturverzeichnisse und importieren Sie neu.')
    elif bilan_biblio['retiree']:
        voix.dire(
            'article « %s » : le Word corrigé ne détache plus de bibliographie — ses '
            'références ne portent plus le style, leur liste reste dans le texte. Le '
            'fichier de bibliographie de l\'article s\'en va avec.' % slug,
            'Artikel « %s »: die korrigierte Word-Datei lagert kein Literaturverzeichnis '
            'mehr aus — die Einträge tragen die Formatvorlage nicht mehr, ihre Liste bleibt '
            'im Text. Die Literaturverzeichnis-Datei des Artikels geht mit.' % slug)
    elif bilan_biblio['conflit']:
        voix.avertir(
            'biblio-conflit',
            ['article « %s »' % slug, 'fichier « %s »' % biblio_avant],
            "La bibliographie de cet article avait été corrigée ici, et le Word corrigé en "
            "livre une autre version. C'est celle du Word qui est en place, parce que le "
            "texte corrigé cite ses références. Le travail n'est pas perdu : la version "
            "d'avant est dans le fichier indiqué. Ouvrez-la à côté de la nouvelle, et "
            "recopiez ce qui doit revenir.",
            'Das Literaturverzeichnis dieses Artikels wurde hier bearbeitet, und die '
            'korrigierte Word-Datei liefert eine andere Fassung. Eingesetzt ist die Fassung '
            'aus Word, denn der korrigierte Text verweist auf ihre Einträge. Die Arbeit ist '
            'nicht verloren: die vorherige Fassung liegt in der genannten Datei. Öffnen Sie '
            'sie neben der neuen und übertragen Sie, was zurück soll.')
    elif bilan_biblio['gardee']:
        voix.dire(
            'article « %s » : la bibliographie est gardée telle qu\'elle est ici — le Word '
            'corrigé livre les mêmes références qu\'à l\'import.' % slug,
            'Artikel « %s »: das Literaturverzeichnis bleibt, wie es hier steht — die '
            'korrigierte Word-Datei liefert dieselben Einträge wie beim Import.' % slug)
    elif bilan_biblio['nouvelle']:
        # Ferme la boucle du « réimportez l'article pour la mettre à part » que la
        # compilation dit d'un article dont la liste est encore dans le texte.
        voix.dire(
            'article « %s » : la bibliographie est maintenant un fichier à part, et '
            'l\'export vers la plateforme la portera.' % slug,
            'Artikel « %s »: das Literaturverzeichnis ist nun eine eigene Datei, und der '
            'Export auf die Plattform nimmt es mit.' % slug)

    # 6. Tout ce que le Word ne possède pas revient, puis les empreintes du nouvel état.
    resultat['preserves'] = copier_preserves(vivant, temp, slug)
    ecrire_empreintes(temp, slug, nom_word, empreintes_du_word, biblio_du_word)

    # 7. La bascule : deux renommages voisins. Entre les deux, articles/<slug> n'existe
    # pas pendant quelques microsecondes ; interrompu là, le dossier entier est sous
    # .szh-bascule-<slug> et reprendre() le remet en place.
    bascule = os.path.join(articles, PREFIXE_BASCULE + slug)
    shutil.rmtree(bascule, ignore_errors=True)
    os.rename(vivant, bascule)
    pause_eventuelle('bascule')
    os.rename(temp, vivant)

    # 8. Hors du chemin critique : l'état d'avant et le Word rejoignent le rebut.
    shutil.move(bascule, os.path.join(rebut, 'article-avant'))
    shutil.move(chemin_docx, os.path.join(rebut, nom_word))

    voix.dire(
        'article « %s » : le texte vient maintenant du Word corrigé « %s ». La fiche, les '
        'tâches, le suivi de traduction et les portraits sont inchangés. L\'état d\'avant '
        'est gardé dans « %s » — « Annuler le réimport » y revient.'
        % (slug, nom_word, resultat['rebut']),
        'Artikel « %s »: der Text stammt nun aus der korrigierten Word-Datei « %s ». '
        'Metadaten, Aufgaben, Übersetzungsstand und Porträts sind unverändert. Der '
        'vorherige Zustand liegt in « %s » — « Neuimport widerrufen » stellt ihn wieder '
        'her.' % (slug, nom_word, resultat['rebut']))
    return 0


# ---------------------------------------------------------------------------------
# L'annulation

def annuler(revue, slug, voix, resultat):
    articles = os.path.join(revue, 'articles')
    vivant = os.path.join(articles, slug)
    source = None
    for rebut in rebuts_de(revue, slug):
        candidat = os.path.join(rebut, 'article-avant')
        if os.path.isdir(candidat):
            source = candidat
            break
    if not source:
        voix.avertir(
            'annuler-sans-etat', ['article « %s »' % slug],
            "Aucun état d'avant n'est gardé pour cet article : il n'a pas été réimporté, "
            "ou la sauvegarde a été supprimée. Rien n'a été touché.",
            'Für diesen Artikel ist kein früherer Zustand gespeichert: er wurde nicht neu '
            'importiert, oder die Sicherung wurde gelöscht. Es wurde nichts angetastet.')
        return 4
    repris_de = os.path.relpath(os.path.dirname(source), revue).replace(os.sep, '/')

    # L'état remplacé est mis de côté à son tour : annuler s'annule. C'est ce dossier-là
    # que l'on annonce : le journal du réimport défait reste intact dans le précédent.
    remplace = os.path.join(creer_rebut(revue, slug, '-annule'), 'article-avant')
    resultat['rebut'] = os.path.relpath(os.path.dirname(remplace), revue).replace(os.sep, '/')
    resultat['repris_de'] = repris_de
    bascule = os.path.join(articles, PREFIXE_BASCULE + slug)
    shutil.rmtree(bascule, ignore_errors=True)
    if os.path.isdir(vivant):
        os.rename(vivant, bascule)
    pause_eventuelle('bascule')
    shutil.move(source, vivant)
    if os.path.isdir(bascule):
        shutil.move(bascule, remplace)
    voix.dire(
        'article « %s » : l\'état d\'avant le réimport est de retour, repris de « %s ». Ce '
        'qui vient d\'être remplacé est gardé dans « %s ».'
        % (slug, repris_de, resultat['rebut']),
        'Artikel « %s »: der Zustand vor dem Neuimport ist wieder da, übernommen aus '
        '« %s ». Das eben Ersetzte liegt in « %s ».'
        % (slug, repris_de, resultat['rebut']))
    return 0


# ---------------------------------------------------------------------------------

def usage():
    print('usage : reimporter.py --article <slug> | --word <nom.docx> '
          '[--revue <dossier>] [--pipeline <dossier>] [--journal <fichier>]\n'
          '        reimporter.py --annuler --article <slug>\n'
          '        reimporter.py --reprise            (remet d\'aplomb un réimport tué)\n'
          '        reimporter.py --empreintes --dossier <d> --slug <s> [--word <nom>]',
          file=sys.stderr)


def principal(argv):
    opts = {'revue': '.', 'article': '', 'word': '', 'journal': None,
            'pipeline': os.path.dirname(os.path.abspath(__file__)), 'dossier': '',
            'slug': ''}
    drapeaux = {'annuler': False, 'empreintes': False, 'reprise': False}
    i = 1
    while i < len(argv):
        a = argv[i]
        if a.startswith('--') and a[2:] in drapeaux:
            drapeaux[a[2:]] = True
            i += 1
            continue
        if a.startswith('--') and a[2:] in opts and i + 1 < len(argv):
            opts[a[2:]] = argv[i + 1]
            i += 2
            continue
        print('argument inattendu : %s' % a, file=sys.stderr)
        usage()
        return 2

    if drapeaux['empreintes']:
        if not opts['dossier'] or not opts['slug']:
            usage()
            return 2
        try:
            ecrire_empreintes(opts['dossier'], opts['slug'], opts['word'])
        except OSError as exc:
            print('[reimport] empreintes non écrites (%s)' % exc, file=sys.stderr)
            return 1
        return 0

    revue = opts['revue']
    if not os.path.isfile(os.path.join(revue, 'ausgabe.yaml')):
        print('[reimport] Ce dossier n\'est pas un numéro de revue : %s. Ouvrez le numéro '
              'depuis le lanceur « Revues SZH », puis recommencez. '
              '[de] Dieser Ordner ist keine Ausgabe: %s. Öffnen Sie die Ausgabe über den '
              'Starter « Revues SZH » und versuchen Sie es erneut.'
              % (os.path.abspath(revue), os.path.abspath(revue)), file=sys.stderr)
        return 2
    journal = opts['journal']
    if journal is None:
        candidat = os.path.join(revue, DOSSIER_WORD, NOM_JOURNAL)
        journal = candidat if os.path.isdir(os.path.join(revue, DOSSIER_WORD)) else None
    voix = Voix(journal)
    resultat = {'resultat': 'echec', 'article': opts['article'], 'fichier': '',
                'rebut': '', 'tableaux': {}, 'biblio': {}, 'images': {},
                'fiche_differente': [], 'preserves': []}

    def rendre(code):
        resultat['resultat'] = CODES.get(code, 'echec')
        resultat['code'] = code
        resultat['avertissements'] = voix.avertissements
        # Ce que ce réimport a décidé, rangé à côté de l'état qu'il a remplacé : le
        # journal d'import de la revue, lui, est remis à zéro à chaque compilation.
        if resultat.get('rebut'):
            try:
                with open(os.path.join(revue, resultat['rebut'], 'journal.txt'), 'w',
                          encoding='utf-8', newline='\r\n') as f:
                    f.write('\n'.join(voix.lignes + [json.dumps(resultat,
                                                                ensure_ascii=False)]) + '\n')
            except OSError:
                pass                      # la sauvegarde compte, son journal est un plus
        print(json.dumps(resultat, ensure_ascii=False))
        return code

    if drapeaux['reprise']:
        reprendre_tout(revue, voix)
        return 0

    # Avant toute décision : un réimport interrompu doit être remis d'aplomb, sans quoi
    # son article resterait introuvable et on lui répondrait qu'il n'existe pas.
    reprendre_tout(revue, voix)

    articles = articles_de_la_revue(revue)
    connus = {slug for slug, _, _ in articles}

    # ---- Appariement -------------------------------------------------------------
    slug, chemin_docx = opts['article'], None
    if slug and slug not in connus:
        voix.avertir(
            'reimport-sans-article', ['article « %s »' % slug],
            "Aucun article ne porte ce nom dans ce numéro : rien n'a été touché. "
            "Choisissez l'article dans la liste du cockpit.",
            'Kein Artikel dieser Ausgabe trägt diesen Namen: es wurde nichts angetastet. '
            'Wählen Sie den Artikel in der Liste des Cockpits.')
        return rendre(4)

    if drapeaux['annuler']:
        if not slug:
            usage()
            return 2
        return rendre(annuler(revue, slug, voix, resultat))

    if opts['word']:
        chemin_docx = trouver_word(revue, opts['word'])
        if not chemin_docx:
            voix.avertir(
                'reimport-sans-word', ['fichier « %s »' % opts['word']],
                "Ce fichier Word n'est pas dans le dossier des documents à convertir : "
                "rien n'a été touché. Déposez-le dans « articles-word », puis "
                "recommencez.",
                'Diese Word-Datei liegt nicht im Ordner der zu konvertierenden Dokumente: '
                'es wurde nichts angetastet. Legen Sie sie in « articles-word » ab und '
                'versuchen Sie es erneut.')
            return rendre(4)
    if not slug:
        # Un Word sans article nommé : c'est le champ `source:` des fiches qui décide.
        nom = os.path.basename(chemin_docx or opts['word'])
        candidats = [s for s, _, src in articles if src and src.lower() == nom.lower()]
        if len(candidats) == 1:
            slug = candidats[0]
            resultat['article'] = slug
        elif not candidats:
            voix.avertir(
                'reimport-sans-article', ['fichier « %s »' % nom],
                "Aucun article de ce numéro ne vient de ce fichier Word : il n'y a rien à "
                "remplacer, et rien n'a été touché. S'il s'agit d'un article nouveau, "
                "enregistrez (Ctrl+S) et il sera importé ; s'il s'agit de la version "
                "corrigée d'un article dont le nom de fichier a changé depuis, ouvrez "
                "« Réimporter cet article » depuis l'article lui-même.",
                'Kein Artikel dieser Ausgabe stammt aus dieser Word-Datei: es gibt nichts '
                'zu ersetzen, und es wurde nichts angetastet. Handelt es sich um einen '
                'neuen Artikel, speichern Sie (Ctrl+S), und er wird importiert; ist es '
                'die korrigierte Fassung eines Artikels, dessen Dateiname sich geändert '
                'hat, starten Sie « Artikel neu importieren » vom Artikel aus.')
            return rendre(4)
        else:
            voix.avertir(
                'reimport-plusieurs-articles',
                ['fichier « %s »' % nom, 'articles : %s' % ', '.join(candidats)],
                "Plusieurs articles de ce numéro disent venir de ce même fichier Word : "
                "on ne peut pas deviner lequel corriger, et rien n'a été touché. Lancez "
                "« Réimporter cet article » depuis l'article concerné.",
                'Mehrere Artikel dieser Ausgabe geben dieselbe Word-Datei als Herkunft an: '
                'es ist nicht erkennbar, welcher gemeint ist, und es wurde nichts '
                'angetastet. Starten Sie « Artikel neu importieren » vom betreffenden '
                'Artikel aus.')
            return rendre(4)

    if chemin_docx is None:
        source = lire_source(os.path.join(revue, 'articles', slug, slug + '.meta.yaml'))
        if not source:
            voix.avertir(
                'reimport-fiche-sans-source', ['article « %s »' % slug],
                "La fiche de cet article ne dit pas de quel fichier Word il vient — elle "
                "est antérieure à ce suivi. Rien n'a été touché : remplacer le texte par "
                "celui d'un document qu'on n'a pas identifié serait un coup de dés. "
                "Déposez le Word corrigé, puis choisissez-le dans la vue « Word ».",
                'Die Metadaten dieses Artikels nennen keine Word-Herkunft — sie sind '
                'älter als diese Nachverfolgung. Es wurde nichts angetastet: den Text '
                'durch den eines nicht identifizierten Dokuments zu ersetzen wäre ein '
                'Glücksspiel. Legen Sie die korrigierte Word-Datei ab und wählen Sie sie '
                'in der Ansicht « Word ».')
            return rendre(4)
        chemin_docx = trouver_word(revue, source)
        if not chemin_docx:
            voix.avertir(
                'reimport-sans-word',
                ['article « %s »' % slug, 'fichier « %s »' % source],
                "Le fichier Word de cet article n'est pas en attente de conversion : il "
                "n'y a rien à réimporter, et rien n'a été touché. Déposez la version "
                "corrigée dans « articles-word » sous ce même nom, puis recommencez.",
                'Die Word-Datei dieses Artikels wartet nicht auf Konvertierung: es gibt '
                'nichts neu zu importieren, und es wurde nichts angetastet. Legen Sie die '
                'korrigierte Fassung unter demselben Namen in « articles-word » ab und '
                'versuchen Sie es erneut.')
            return rendre(4)

    resultat['article'] = slug
    resultat['fichier'] = os.path.basename(chemin_docx)
    try:
        code = reimporter(revue, slug, chemin_docx, opts['pipeline'], voix, resultat)
    except OSError as exc:
        voix.avertir(
            'reimport-echec', ['article « %s »' % slug, 'détail : %s' % exc],
            "Le réimport s'est arrêté sur une erreur de fichier. L'article est resté "
            "dans l'état où il était, ou a été remis dedans. Vérifiez que le dossier de "
            "la revue n'est pas ouvert ailleurs, puis recommencez.",
            'Der Neuimport wurde durch einen Dateifehler abgebrochen. Der Artikel blieb '
            'im vorherigen Zustand oder wurde dorthin zurückgesetzt. Prüfen Sie, ob der '
            'Ordner der Ausgabe nicht anderswo geöffnet ist, und versuchen Sie es erneut.')
        reprendre_tout(revue, Voix(None))
        code = 1
    if code not in (0, 3) and resultat.get('rebut'):
        # Tentative ratée : ne pas laisser de dossier de sauvegarde vide derrière soi.
        chemin = os.path.join(revue, resultat['rebut'])
        if not os.path.isdir(os.path.join(chemin, 'article-avant')):
            shutil.rmtree(chemin, ignore_errors=True)
            resultat['rebut'] = ''
    return rendre(code)


# Le seul point de sortie du processus. Le code rendu ici est celui que la ligne JSON
# annonce : un appelant qui teste $? et un appelant qui lit le JSON doivent conclure la
# même chose. ⚠ Piège d'appel, mesuré : dans un tube (« … | tail »), $? est le code du
# DERNIER maillon, donc 0 — il faut lire ${PIPESTATUS[0]}, ou ne pas mettre de tube.
#
# `except Exception` n'attrape ni SystemExit ni KeyboardInterrupt (tous deux dérivent de
# BaseException) : le code de sortie de principal() passe donc intact, et Ctrl+C garde sa
# branche à lui. C'est la raison pour laquelle ce filet est ici, et nulle part ailleurs :
# dans le corps du script, seuls des OSError sont attrapés, un par un.
def sortir(code, resultat):
    print(json.dumps(resultat, ensure_ascii=False))
    sys.exit(code)


if __name__ == '__main__':
    try:
        sys.exit(principal(sys.argv))
    except KeyboardInterrupt:
        # Ctrl+C : l'article est intact, ou sous .szh-bascule-<slug> le temps que la
        # reprise le remette en place. On tente le balayage tout de suite ; s'il échoue,
        # la compilation suivante s'en charge (`import` appelle --reprise).
        revue = '.'
        for i, a in enumerate(sys.argv):
            if a == '--revue' and i + 1 < len(sys.argv):
                revue = sys.argv[i + 1]
        voix = Voix(None)
        try:
            reprendre_tout(revue, voix)
        except OSError:
            pass
        voix.avertir(
            'reimport-interrompu', [],
            "Le réimport a été interrompu. Rien n'a été remplacé à moitié : l'article est "
            "resté dans l'état d'avant, ou y a été remis. Vous pouvez recommencer.",
            'Der Neuimport wurde abgebrochen. Nichts wurde halb ersetzt: der Artikel blieb '
            'im vorherigen Zustand oder wurde dorthin zurückgesetzt. Sie können erneut '
            'beginnen.')
        sortir(1, {'resultat': 'echec', 'code': 1, 'article': '', 'fichier': '',
                   'avertissements': ['reimport-interrompu']})
    except Exception:                     # panne imprévue : jamais une trace nue seule
        import traceback
        traceback.print_exc()
        Voix(None).avertir(
            'reimport-panne', [],
            "Le réimport s'est arrêté sur une panne du programme, et non sur quelque chose "
            "que vous auriez fait. L'article n'a pas été remplacé à moitié : la "
            "compilation suivante remet en place ce qui aurait bougé. Signalez cette "
            "ligne et celles qui la précèdent.",
            'Der Neuimport wurde durch einen Programmfehler abgebrochen, nicht durch etwas, '
            'das Sie getan hätten. Der Artikel wurde nicht halb ersetzt: die nächste '
            'Kompilierung setzt zurück, was sich bewegt hätte. Melden Sie diese Zeile und '
            'die davor.')
        sortir(1, {'resultat': 'echec', 'code': 1, 'article': '', 'fichier': '',
                   'avertissements': ['reimport-panne']})
