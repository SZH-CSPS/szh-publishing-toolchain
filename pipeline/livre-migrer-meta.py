#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Déplace le titre et les auteurs d'un chapitre du .md vers sa fiche <slug>.meta.yaml.

Dans le .md : « # Titre » puis « ::: {.szh-auteurs} … ::: ». Dans la fiche : title.<lang>
et author (même schéma que les articles), que le gabarit imprime (szh-livre-titre.lua,
szh-livre-auteurs.lua).

Appel : python3 livre-migrer-meta.py <dossier-livre> [--simuler] [--chapitre <slug>]

  --simuler   n'écrit rien, dit ce qui serait fait.
  --chapitre  un seul chapitre (appel de l'import Word et de livre-scinder.py).

Règles :
  * un livre `locked: true` est refusé (code 1), rien n'est modifié ;
  * une valeur déjà présente dans la fiche n'est pas écrasée. Identique au .md, elle est
    retirée du .md ; différente, le .md reste tel quel et le conflit est signalé ;
  * idempotent ;
  * un .md à plusieurs titres de niveau 1 est un manuscrit à scinder : laissé tel quel
    (livre-scinder.py écrit les fiches des morceaux) ;
  * un titre qui n'est pas la première ligne du .md, ou qui porte des attributs pandoc,
    est laissé et signalé : le déplacer changerait l'ordre du texte.

Les noms sont découpés (« A & B », « A, B et C », « A und B ») par auteurs_depuis_byline
de docx-meta.py. L'italien « A e B » est traité ici.

Sortie : un rapport sur stdout, une ligne par message. Code 0, ou 1 si le livre est refusé
ou illisible.
"""

import importlib.util
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import szh_commun

PREFIXE = '[livre-migrer-meta]'

RE_TITRE1 = re.compile(r'^#[ \t]+(.+?)[ \t]*#*[ \t]*$')
RE_ATTRIBUTS = re.compile(r'\s\{[^{}]*\}\s*$')
RE_OUVRE_AUTEURS = re.compile(r'^(:{3,})[ \t]*(?:\{[ \t]*\.szh-auteurs[ \t]*\}|szh-auteurs)[ \t]*$')
RE_FERME = re.compile(r'^:{3,}[ \t]*$')
RE_CLOTURE = re.compile(r'^\s*(```|~~~)')


# --------------------------------------------------------------------------------------
# Le découpeur de noms de l'import Word (docx-meta.py), chargé tel quel.
# --------------------------------------------------------------------------------------
_decoupeur = None


def _charger_decoupeur():
    global _decoupeur
    if _decoupeur is None:
        chemin = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'docx-meta.py')
        spec = importlib.util.spec_from_file_location('docx_meta_noms', chemin)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        _decoupeur = module.auteurs_depuis_byline
    return _decoupeur


def decouper_auteurs(ligne, lang='fr'):
    """« Lena E. & Tabea Ullmann » -> [{'prenom': 'Lena', 'nom': 'E.'}, …]."""
    ligne = ' '.join(ligne.replace('\\', ' ').split())
    if lang == 'it':
        # « A e B » : le « e » italien est aussi une particule de nom dans docx-meta.py.
        ligne = re.sub(r'\s+e\s+', ' et ', ligne)
    return _charger_decoupeur()(ligne)


# --------------------------------------------------------------------------------------
# Lecture du .md
# --------------------------------------------------------------------------------------
def lire_md(chemin):
    """(lignes, eol) : le texte coupé en lignes, et le séparateur d'origine."""
    with open(chemin, 'rb') as f:
        brut = f.read()
    texte = brut.decode('utf-8')
    eol = '\r\n' if '\r\n' in texte else '\n'
    return texte.replace('\r\n', '\n').split('\n'), eol


def titres_niveau_1(lignes):
    """[(rang, texte)] des « # Titre » hors blocs de code."""
    trouves, dans_code = [], False
    for i, l in enumerate(lignes):
        if RE_CLOTURE.match(l):
            dans_code = not dans_code
            continue
        if dans_code:
            continue
        m = RE_TITRE1.match(l)
        if m:
            trouves.append((i, m.group(1).strip()))
    return trouves


def bloc_auteurs_apres(lignes, rang_titre):
    """(debut, fin_exclue, texte) du bloc .szh-auteurs qui suit le titre, lignes vides
    admises entre les deux ; None s'il n'y en a pas."""
    i = rang_titre + 1
    while i < len(lignes) and not lignes[i].strip():
        i += 1
    if i >= len(lignes) or not RE_OUVRE_AUTEURS.match(lignes[i]):
        return None
    j = i + 1
    corps = []
    while j < len(lignes) and not RE_FERME.match(lignes[j]):
        corps.append(lignes[j].strip())
        j += 1
    if j >= len(lignes):
        return None
    return i, j + 1, ' '.join(c for c in corps if c)


# --------------------------------------------------------------------------------------
# Édition de la fiche comme texte : pas de PyYAML dans l'image, et les commentaires de la
# fiche sont gardés.
# --------------------------------------------------------------------------------------
def _echappe(valeur):
    """Valeur YAML entre guillemets doubles ; simples si le texte contient des guillemets
    droits sans apostrophe, car le lecteur de szh_commun ne défait pas les échappements.
    Avec les deux : doubles échappés, que pandoc lit."""
    if '"' not in valeur and '\\' not in valeur:
        return '"' + valeur + '"'
    if "'" not in valeur and '\\' not in valeur:
        return "'" + valeur + "'"
    return '"' + valeur.replace('\\', '\\\\').replace('"', '\\"') + '"'


def _bloc_cle(lignes, cle):
    """(debut, fin_exclue) du bloc de la clé de premier niveau, ou None. Le bloc couvre
    les lignes indentées ou les items « - » qui suivent."""
    motif = re.compile(r'^' + re.escape(cle) + r'[ \t]*:(.*)$')
    for i, l in enumerate(lignes):
        if motif.match(l):
            j = i + 1
            while j < len(lignes) and (lignes[j].startswith((' ', '\t', '- '))
                                       or lignes[j].strip() == '-'
                                       or not lignes[j].strip()):
                if not lignes[j].strip():
                    # une ligne vide ne ferme le bloc que si la suite n'en fait pas partie
                    k = j
                    while k < len(lignes) and not lignes[k].strip():
                        k += 1
                    if k >= len(lignes) or not lignes[k].startswith((' ', '\t', '- ')):
                        break
                j += 1
            return i, j
    return None


def ajouter_titre(lignes, lang, titre):
    """Pose title.<lang> dans les lignes de la fiche. Rend False si `title` a une forme que
    ce script ne sait pas compléter."""
    ligne_lang = '  %s: %s' % (lang, _echappe(titre))
    bloc = _bloc_cle(lignes, 'title')
    if bloc is None:
        lignes.extend(['title:', ligne_lang])
        return True
    debut, fin = bloc
    reste = lignes[debut].split(':', 1)[1].strip()
    if reste in ('""', "''"):
        lignes[debut] = 'title:'
    elif reste and not reste.startswith('#'):
        return False
    # Un `lang:` vide dans le bloc est remplacé, sinon la ligne est ajoutée en fin de bloc.
    motif = re.compile(r'^[ \t]+' + re.escape(lang) + r'[ \t]*:[ \t]*(?:""|\'\')?[ \t]*$')
    for k in range(debut + 1, fin):
        if motif.match(lignes[k]):
            lignes[k] = ligne_lang
            return True
    fin_reelle = fin
    while fin_reelle > debut + 1 and not lignes[fin_reelle - 1].strip():
        fin_reelle -= 1
    lignes.insert(fin_reelle, ligne_lang)
    return True


def ajouter_auteurs(lignes, personnes):
    """Pose `author:` (liste de personnes), en remplaçant une clé vide (`author:`,
    `author: []`). N'est appelée que si la clé n'est pas remplie."""
    bloc = _bloc_cle(lignes, 'author')
    if bloc is not None:
        del lignes[bloc[0]:bloc[1]]
    lignes.append('author:')
    for p in personnes:
        premiere = True
        for cle in ('prenom', 'nom'):
            if p.get(cle):
                lignes.append('%s%s: %s' % ('- ' if premiere else '  ', cle, _echappe(p[cle])))
                premiere = False


def lire_fiche(chemin):
    """(lignes, eol, existe). Une fiche absente est une liste vide."""
    if not os.path.isfile(chemin):
        return [], '\n', False
    with open(chemin, 'rb') as f:
        texte = f.read().decode('utf-8-sig')
    eol = '\r\n' if '\r\n' in texte else '\n'
    lignes = texte.replace('\r\n', '\n').split('\n')
    if lignes and lignes[-1] == '':
        lignes.pop()
    return lignes, eol, True


def ecrire_texte(chemin, lignes, eol):
    texte = eol.join(lignes) + eol
    with open(chemin, 'wb') as f:
        f.write(texte.encode('utf-8'))


def ecrire_titre_fiche(chemin_fiche, lang, titre):
    """Pose title.<lang> dans la fiche (créée si besoin). Rend False, sans rien écrire, si
    la fiche a déjà un titre dans cette langue ou une forme non prise en charge. Utilisé
    par livre-scinder.py."""
    lignes, eol, existe = lire_fiche(chemin_fiche)
    if existe and _titre_existant(szh_commun.lire_yaml(chemin_fiche), lang):
        return False
    if not ajouter_titre(lignes, lang, titre):
        return False
    ecrire_texte(chemin_fiche, lignes, eol)
    return True


# --------------------------------------------------------------------------------------
# Un chapitre
# --------------------------------------------------------------------------------------
def _nom_complet(p):
    return ' '.join(x for x in (p.get('prenom'), p.get('nom')) if x).strip().lower()


def _titre_existant(fiche, lang):
    t = fiche.get('title')
    if isinstance(t, dict):
        return (t.get(lang) or '').strip()
    return (t or '').strip() if isinstance(t, str) else ''


def _auteurs_existants(fiche):
    a = fiche.get('author')
    if not isinstance(a, list):
        return []
    return [x for x in a if (isinstance(x, dict) and (x.get('nom') or x.get('prenom')))
            or (isinstance(x, str) and x.strip())]


def _constat(code, slug, fr, de):
    return szh_commun.formater_avertissement(PREFIXE, code, ['chapitre « %s »' % slug], fr, de)


def migrer_chapitre(dossier_livre, slug, lang_livre='fr', simuler=False):
    """Rend la liste des lignes de rapport. Écrit le .md et la fiche sauf en simulation."""
    rapport = []
    dossier = os.path.join(dossier_livre, 'chapitres', slug)
    chemin_md = os.path.join(dossier, slug + '.md')
    chemin_fiche = os.path.join(dossier, slug + '.meta.yaml')
    if not os.path.isfile(chemin_md):
        return [_constat('md-introuvable', slug, "Le fichier %s.md est introuvable." % slug,
                         'Die Datei %s.md fehlt.' % slug)]

    md, eol_md = lire_md(chemin_md)
    titres = titres_niveau_1(md)
    if len(titres) >= 2:
        return ['%s %s : %d titres de niveau 1, manuscrit à scinder, laissé tel quel'
                % (PREFIXE, slug, len(titres))]

    fiche_lignes, eol_fiche, fiche_existe = lire_fiche(chemin_fiche)
    fiche = szh_commun.lire_yaml(chemin_fiche) if fiche_existe else {}
    lang = str(fiche.get('lang') or lang_livre or 'fr').strip().lower()[:2] or 'fr'

    a_retirer = []          # plages [debut, fin) du .md à retirer
    modif_fiche = False
    rang = -1               # ligne du titre ; -1 : le .md n'en porte plus

    if titres:
        rang, titre = titres[0]
        if any(md[k].strip() for k in range(rang)):
            # Titre qui n'ouvre pas le .md : le retirer changerait l'ordre du texte.
            rapport.append(_constat(
                'titre-pas-en-tete', slug,
                "Le titre « %s » n'est pas la première ligne du .md : laissé en place." % titre,
                'Der Titel « %s » steht nicht am Anfang der .md-Datei: bleibt unverändert.' % titre))
            rang = None
        elif RE_ATTRIBUTS.search(md[rang]):
            rapport.append(_constat(
                'titre-attributs', slug,
                "Le titre « %s » porte des attributs pandoc : laissé en place." % titre,
                'Der Titel « %s » trägt Pandoc-Attribute: bleibt unverändert.' % titre))
        else:
            existant = _titre_existant(fiche, lang)
            if not existant:
                if ajouter_titre(fiche_lignes, lang, titre):
                    modif_fiche = True
                    a_retirer.append((rang, rang + 1))
                    rapport.append('%s %s : titre -> title.%s « %s »' % (PREFIXE, slug, lang, titre))
                else:
                    rapport.append(_constat(
                        'title-forme', slug,
                        "La clé `title` de la fiche a une forme que ce script ne complète pas : titre laissé dans le .md.",
                        'Der Schlüssel `title` der Fiche hat eine Form, die das Skript nicht ergänzt: Titel bleibt in der .md-Datei.'))
            elif ' '.join(existant.split()) == ' '.join(titre.split()):
                a_retirer.append((rang, rang + 1))
                rapport.append('%s %s : titre déjà en fiche (identique), retiré du .md' % (PREFIXE, slug))
            else:
                rapport.append(_constat(
                    'titre-conflit', slug,
                    "La fiche porte déjà un titre (« %s ») différent de celui du .md (« %s ») : rien n'est écrasé, le .md garde le sien."
                    % (existant, titre),
                    'Die Fiche enthält schon einen anderen Titel (« %s ») als die .md-Datei (« %s »): nichts wird überschrieben.'
                    % (existant, titre)))

    # Le bloc auteurs n'est cherché que juste sous le titre (ou en tête si le .md n'a plus
    # de titre).
    bloc = bloc_auteurs_apres(md, rang) if rang is not None else None
    if bloc is not None:
        debut, fin_b, ligne = bloc
        personnes = decouper_auteurs(ligne, lang) if ligne else []
        existants = _auteurs_existants(fiche)
        if not personnes:
            a_retirer.append((debut, fin_b))
            rapport.append('%s %s : bloc auteurs vide, retiré du .md' % (PREFIXE, slug))
        elif not existants:
            ajouter_auteurs(fiche_lignes, personnes)
            modif_fiche = True
            a_retirer.append((debut, fin_b))
            rapport.append('%s %s : auteurs -> author (%s)'
                           % (PREFIXE, slug, ' ; '.join(' '.join(x for x in (p.get('prenom'), p.get('nom')) if x) for p in personnes)))
        else:
            noms_fiche = sorted(
                _nom_complet(x) if isinstance(x, dict) else str(x).strip().lower()
                for x in existants)
            noms_md = sorted(_nom_complet(p) for p in personnes)
            if noms_fiche == noms_md:
                a_retirer.append((debut, fin_b))
                rapport.append('%s %s : auteurs déjà en fiche (identiques), retirés du .md'
                               % (PREFIXE, slug))
            else:
                rapport.append(_constat(
                    'auteurs-conflit', slug,
                    "La fiche porte déjà des auteur·e·s (%s) différents du bloc du .md (%s) : rien n'est écrasé, le .md garde son bloc."
                    % (', '.join(noms_fiche), ', '.join(noms_md)),
                    'Die Fiche enthält schon andere Autor:innen (%s) als der Block in der .md-Datei (%s): nichts wird überschrieben.'
                    % (', '.join(noms_fiche), ', '.join(noms_md))))

    if fiche.get('auteurs') and not fiche.get('author'):
        rapport.append(_constat(
            'cle-auteurs', slug,
            "La fiche écrit `auteurs:` : la clé d'un chapitre est `author:` (`auteurs:` est celle de buch.yaml). Non renommée ici.",
            'Die Fiche schreibt `auteurs:`: der Schlüssel eines Kapitels ist `author:` (`auteurs:` gehört zu buch.yaml). Hier nicht umbenannt.'))

    if not a_retirer and not modif_fiche:
        if not rapport:
            rapport.append('%s %s : rien à migrer' % (PREFIXE, slug))
        return rapport

    if not simuler:
        if modif_fiche:
            ecrire_texte(chemin_fiche, fiche_lignes, eol_fiche)
        if a_retirer:
            reste = list(md)
            for debut, fin in sorted(a_retirer, reverse=True):
                del reste[debut:fin]
                # Pas de ligne vide en tête, ni de double ligne vide au raccord.
                while (debut < len(reste) and not reste[debut].strip()
                       and (debut == 0 or not reste[debut - 1].strip())):
                    del reste[debut]
            with open(chemin_md, 'wb') as f:
                f.write(eol_md.join(reste).encode('utf-8'))
    return rapport


# --------------------------------------------------------------------------------------
# Un livre
# --------------------------------------------------------------------------------------
def chapitres_du_livre(dossier_livre):
    base = os.path.join(dossier_livre, 'chapitres')
    if not os.path.isdir(base):
        return []
    return sorted(d for d in os.listdir(base)
                  if not d.startswith('_')
                  and os.path.isfile(os.path.join(base, d, d + '.md')))


def migrer_livre(dossier_livre, simuler=False, chapitre=None):
    """Rend (code_de_sortie, lignes_de_rapport)."""
    buch = os.path.join(dossier_livre, 'buch.yaml')
    if not os.path.isfile(buch):
        return 1, ['%s %s n\'est pas un livre (buch.yaml introuvable).' % (PREFIXE, dossier_livre)]
    config = szh_commun.lire_yaml(buch)
    if config.get('locked') is True:
        return 1, [szh_commun.formater_avertissement(
            PREFIXE, 'livre-verrouille', [],
            'Ce livre est verrouillé (`locked: true`) : rien n\'est modifié.',
            'Dieses Buch ist gesperrt (`locked: true`): nichts wird verändert.')]
    lang = str(config.get('lang') or 'fr').strip().lower()[:2]
    slugs = [chapitre] if chapitre else chapitres_du_livre(dossier_livre)
    rapport = []
    if simuler:
        rapport.append('%s simulation : rien n\'est écrit.' % PREFIXE)
    for slug in slugs:
        rapport.extend(migrer_chapitre(dossier_livre, slug, lang, simuler))
    return 0, rapport


def main(argv=None):
    try:
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    except Exception:
        pass
    argv = list(sys.argv[1:] if argv is None else argv)
    simuler = '--simuler' in argv
    argv = [a for a in argv if a != '--simuler']
    chapitre = None
    if '--chapitre' in argv:
        k = argv.index('--chapitre')
        if k + 1 >= len(argv):
            print('Usage: livre-migrer-meta.py <dossier-livre> [--simuler] [--chapitre <slug>]')
            return 1
        chapitre = argv[k + 1]
        del argv[k:k + 2]
    if len(argv) != 1:
        print('Usage: livre-migrer-meta.py <dossier-livre> [--simuler] [--chapitre <slug>]')
        return 1
    code, rapport = migrer_livre(os.path.abspath(argv[0]), simuler, chapitre)
    for ligne in rapport:
        print(ligne)
    return code


if __name__ == '__main__':
    sys.exit(main())
