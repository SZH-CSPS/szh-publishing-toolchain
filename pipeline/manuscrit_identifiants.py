# -*- coding: utf-8 -*-
# pipeline/manuscrit_identifiants.py — ROR et ORCID des autrices et auteurs de l'en-tête
# (nettoyeur de manuscrit, contrat §5.5 sexies). Module PUR : des dicts `auteur` (forme de
# manuscrit_entete._nouvel_auteur) en entrée, les mêmes dicts complétés en sortie, plus des
# alertes de rapport. Jamais de .docx ici.
#
# Ce que le module fait :
#  - ROR : pour chaque auteur qui porte une institution et pas de ROR, requête « affiliation »
#    de l'API ROR ; seul l'item `chosen` est retenu (les autres sont souvent faux, mesuré).
#  - ORCID absent du manuscrit : recherche par nom, retenue SEULEMENT si le nom concorde ET si
#    une institution publique du candidat concorde avec celle de l'auteur. Un nom seul ne
#    suffit pas (homonymes) : un candidat unique mais d'une autre institution ne remplit rien,
#    il est signalé comme « candidat possible ».
#  - ORCID donné par l'auteur : jamais remplacé ; clé ISO 7064 mod 11-2 contrôlée sans réseau,
#    nom contrôlé contre l'enregistrement public en réseau.
# Toute valeur TROUVÉE (pas lue dans le manuscrit) est inscrite dans `auteur['a_verifier']`
# (liste de champs) : le gabarit l'écrit en révision Word suivie.
#
# Réseau facultatif : `reseau=False` ne tente rien ; une panne ne remplit rien et ne lève
# jamais. Seuls nom, prénom et institution partent sur le réseau. `_requete()` est le seul
# endroit qui touche le réseau, les tests le remplacent.

import difflib
import json
import re
import urllib.error
import urllib.parse
import urllib.request

import pronto_modele

CONTACT_DEPOT = 'redaction@csps.ch'
USER_AGENT = 'SZH-Publishing-manuscrit-identifiants/1.0 (mailto:%s)' % CONTACT_DEPOT
DELAI_RESEAU_DEFAUT = 4

ROR_BASE = 'https://api.ror.org/v2/organizations'
ORCID_BASE = 'https://pub.orcid.org/v3.0'

SEUIL_INSTITUTION = 0.85     # ratio difflib entre deux noms d'institution aplatis
LONGUEUR_INCLUSION = 8       # le plus court des deux noms aplatis, pour l'inclusion
LONGUEUR_MAX_AFFILIATION = 300

RE_ORCID = re.compile(r'(\d{4})-?(\d{4})-?(\d{4})-?(\d{3}[\dxX])')
RE_ROR = re.compile(r'^(?:https?://)?(?:ror\.org/)?(0[0-9a-hj-km-np-tv-z]{6}[0-9]{2})$', re.I)


# ---------------------------------------------------------------------------------
# Réseau — le seul endroit qui le touche.

def _requete(url, delai):
    req = urllib.request.Request(url, headers={'User-Agent': USER_AGENT,
                                               'Accept': 'application/json'})
    with urllib.request.urlopen(req, timeout=delai) as reponse:
        return reponse.read()


class _Introuvable(Exception):
    """L'enregistrement demandé n'existe pas (HTTP 404) : ce n'est pas une panne."""


def _json(url, delai):
    try:
        brut = _requete(url, delai)
    except urllib.error.HTTPError as e:
        if e.code == 404:
            raise _Introuvable()
        raise
    return json.loads(brut.decode('utf-8') if isinstance(brut, bytes) else brut)


# ---------------------------------------------------------------------------------
# ORCID — forme et clé.

def orcid_forme(texte):
    """L'identifiant sous la forme 0000-0000-0000-000X, ou '' si le texte n'en contient pas."""
    m = RE_ORCID.search(texte or '')
    if not m:
        return ''
    return '-'.join(m.groups()).upper()


def orcid_cle_valide(identifiant):
    """Clé ISO 7064 mod 11-2 (le dernier caractère de l'identifiant), sans réseau."""
    chiffres = identifiant.replace('-', '')
    if len(chiffres) != 16 or not chiffres[:15].isdigit():
        return False
    total = 0
    for c in chiffres[:15]:
        total = (total + int(c)) * 2
    reste = (12 - total % 11) % 11
    attendue = 'X' if reste == 10 else str(reste)
    return chiffres[15].upper() == attendue


# ---------------------------------------------------------------------------------
# ROR.

def ror_canonique(valeur):
    m = RE_ROR.match((valeur or '').strip())
    return 'https://ror.org/' + m.group(1).lower() if m else ''


def _nom_affichage(organisation):
    noms = organisation.get('names') or []
    for type_voulu in ('ror_display', 'label'):
        for n in noms:
            if type_voulu in (n.get('types') or []) and n.get('value'):
                return n['value']
    return noms[0].get('value', '') if noms else ''


def chercher_ror(institution, delai=DELAI_RESEAU_DEFAUT):
    """{'id': 'https://ror.org/…', 'nom': affichage, 'noms': [tous les noms]} ou None. Seul
    l'item `chosen` compte. Lève sur panne réseau (l'appelant compte l'indisponibilité)."""
    url = ROR_BASE + '?affiliation=' + urllib.parse.quote(
        institution[:LONGUEUR_MAX_AFFILIATION], safe='')
    for item in (_json(url, delai).get('items') or []):
        if not item.get('chosen'):
            continue
        organisation = item.get('organization') or {}
        identifiant = ror_canonique(organisation.get('id'))
        if not identifiant:
            continue
        return {'id': identifiant, 'nom': _nom_affichage(organisation),
                'noms': [n['value'] for n in (organisation.get('names') or [])
                         if n.get('value')]}
    return None


# ---------------------------------------------------------------------------------
# ORCID — recherche par nom, concordance d'institution.

def _premier_prenom_aplati(prenoms):
    mots = (prenoms or '').split()
    return pronto_modele.aplatir(mots[0]) if mots else ''


def institution_concorde(institution_candidat, institution_auteur, noms_ror):
    """Le nom d'institution d'un candidat ORCID désigne-t-il celle de l'auteur ? Égalité
    aplatie avec l'un des noms de l'organisation ROR trouvée ; sinon ressemblance (ratio
    ≥ SEUIL_INSTITUTION) ou inclusion (le plus court ≥ LONGUEUR_INCLUSION) avec le texte
    d'institution du manuscrit."""
    c = pronto_modele.aplatir(institution_candidat)
    if not c:
        return False
    if c in {pronto_modele.aplatir(n) for n in (noms_ror or [])}:
        return True
    a = pronto_modele.aplatir(institution_auteur)
    if not a:
        return False
    if difflib.SequenceMatcher(None, c, a).ratio() >= SEUIL_INSTITUTION:
        return True
    court, long_ = (c, a) if len(c) <= len(a) else (a, c)
    return len(court) >= LONGUEUR_INCLUSION and court in long_


def _guillemets(t):
    return t.replace('"', ' ').strip()


def chercher_orcid(prenom, nom, institution, noms_ror, delai=DELAI_RESEAU_DEFAUT):
    """('trouve', id, institution_du_candidat) | ('candidat', id, None) | ('rien', None,
    None). Lève sur panne réseau."""
    premier = (prenom or '').split()[0] if (prenom or '').split() else ''
    requete = 'family-name:"%s" AND given-names:"%s"' % (_guillemets(nom), _guillemets(premier))
    url = ORCID_BASE + '/expanded-search/?q=' + urllib.parse.quote(requete, safe='') + '&rows=10'
    resultats = _json(url, delai).get('expanded-result') or []
    nom_plat = pronto_modele.aplatir(nom)
    prenom_plat = _premier_prenom_aplati(prenom)
    nominaux = [r for r in resultats
                if pronto_modele.aplatir(r.get('family-names') or '') == nom_plat
                and _premier_prenom_aplati(r.get('given-names')) == prenom_plat
                and orcid_forme(r.get('orcid-id'))]
    retenus = []
    for r in nominaux:
        for inst in (r.get('institution-name') or []):
            if institution_concorde(inst, institution, noms_ror):
                retenus.append((r, inst))
                break
    if len(retenus) == 1:
        r, inst = retenus[0]
        return 'trouve', orcid_forme(r['orcid-id']), inst
    if not retenus and len(nominaux) == 1:
        return 'candidat', orcid_forme(nominaux[0]['orcid-id']), None
    return 'rien', None, None


def nom_orcid(identifiant, delai=DELAI_RESEAU_DEFAUT):
    """(prénoms, nom) publics d'un ORCID, ('', '') s'ils sont masqués. Lève _Introuvable."""
    donnees = _json('%s/%s/person' % (ORCID_BASE, identifiant), delai)
    nom = donnees.get('name') or {}
    prenoms = (nom.get('given-names') or {}).get('value') or ''
    famille = (nom.get('family-name') or {}).get('value') or ''
    return prenoms, famille


# ---------------------------------------------------------------------------------
# Alertes — schéma à huit champs, comme les alertes manuelles de la CLI.

def _alerte(regle, severite, message, trouve=None, propose=None):
    return {'rule': regle, 'severity': severite, 'action': 'report', 'para': None,
            'span': None, 'found': trouve, 'suggested': propose, 'message': message}


def _qui(auteur):
    return ('%s %s' % (auteur.get('prenom') or '', auteur.get('nom') or '')).strip()


def _msg(langue, fr, de):
    return de if langue == 'de' else fr


def _alerte_ror(auteur, institution, ror, langue):
    return _alerte(
        'Identifiants.RorPropose', 'suggestion',
        _msg(langue,
             'ROR proposé pour « %s » (%s) : %s (%s), trouvé par la recherche '
             'd’affiliation de ror.org — à vérifier.',
             'ROR-Vorschlag für «%s» (%s): %s (%s), gefunden über die Affiliationssuche von '
             'ror.org — bitte prüfen.') % (institution, _qui(auteur), ror['id'],
                                            ror['nom']),
        propose=ror['id'])


def _alerte_orcid(auteur, identifiant, institution_candidat, langue):
    return _alerte(
        'Identifiants.OrcidPropose', 'suggestion',
        _msg(langue,
             'ORCID proposé pour %s : %s — même nom et même institution (« %s ») '
             'dans l’index public d’ORCID ; à vérifier.',
             'ORCID-Vorschlag für %s: %s — gleicher Name und gleiche Institution («%s») im '
             'öffentlichen ORCID-Index; bitte prüfen.')
        % (_qui(auteur), identifiant, institution_candidat), propose=identifiant)


def _alerte_candidat(auteur, identifiant, langue):
    return _alerte(
        'Identifiants.OrcidCandidat', 'suggestion',
        _msg(langue,
             'ORCID possible pour %s : %s — un seul homonyme dans l’index public d’ORCID, '
             'mais rien ne confirme l’institution ; non rempli, à vérifier.',
             'Möglicher ORCID für %s: %s — ein einziger Namensvetter im öffentlichen '
             'ORCID-Index, aber die Institution bestätigt ihn nicht; nicht eingetragen, '
             'bitte prüfen.') % (_qui(auteur), identifiant), propose=identifiant)


def _alerte_orcid_invalide(auteur, identifiant, raison, langue):
    return _alerte(
        'Identifiants.OrcidInvalide', 'warning',
        _msg(langue,
             'ORCID de %s invalide (%s) : %s.',
             'ORCID von %s ungültig (%s): %s.')
        % (_qui(auteur), identifiant,
           _msg(langue, raison[0], raison[1])), trouve=identifiant)


def _alerte_nom_divergent(auteur, identifiant, prenoms, famille, langue):
    return _alerte(
        'Identifiants.OrcidNomDivergent', 'warning',
        _msg(langue,
             'L’ORCID %s de %s appartient, selon ORCID, à « %s %s » : '
             'vérifiez qu’il s’agit bien de la même personne.',
             'Die ORCID %s von %s gehört laut ORCID zu «%s %s»: bitte prüfen, ob es '
             'sich um dieselbe Person handelt.')
        % (identifiant, _qui(auteur), prenoms, famille), trouve=identifiant)


# ---------------------------------------------------------------------------------
# Point d'entrée.

def enrichir_auteurs(auteurs, langue='fr', reseau=True, delai=DELAI_RESEAU_DEFAUT):
    """Complète les dicts `auteurs` sur place (`ror`, `orcid`, `a_verifier`) et rend
    (alertes, stats). Ne remplace JAMAIS un champ déjà rempli. `reseau=False` : seul le
    contrôle de clé des ORCID du manuscrit a lieu."""
    alertes = []
    stats = {'reseau': bool(reseau), 'auteurs': len(auteurs), 'requetes': 0,
             'ror_trouves': 0, 'orcid_trouves': 0, 'orcid_candidats': 0,
             'orcid_invalides': 0, 'orcid_nom_divergent': 0, 'indisponible': 0}
    cache_ror = {}
    en_panne = set()     # un service en panne n'est plus interrogé pour le reste de l'exécution

    def appeler(service, fonction, *args):
        """Résultat de fonction(*args), ou lève _Introuvable ; toute autre panne -> None."""
        if service in en_panne:
            return None
        stats['requetes'] += 1
        try:
            return fonction(*args)
        except _Introuvable:
            raise
        except Exception:
            stats['indisponible'] += 1
            en_panne.add(service)
            return None

    for auteur in auteurs:
        institution = (auteur.get('institution') or '').strip()
        prenom = (auteur.get('prenom') or '').strip()
        nom = (auteur.get('nom') or '').strip()
        a_verifier = list(auteur.get('a_verifier') or [])
        ror = None

        orcid_manuscrit = (auteur.get('orcid') or '').strip()
        if orcid_manuscrit:
            identifiant = orcid_forme(orcid_manuscrit)
            if not identifiant or not orcid_cle_valide(identifiant):
                stats['orcid_invalides'] += 1
                alertes.append(_alerte_orcid_invalide(
                    auteur, orcid_manuscrit,
                    ('la clé de contrôle ne correspond pas, une faute de frappe est probable',
                     'die Prüfziffer stimmt nicht, vermutlich ein Tippfehler'), langue))
            elif reseau:
                try:
                    lu = appeler('orcid', nom_orcid, identifiant, delai)
                except _Introuvable:
                    stats['orcid_invalides'] += 1
                    alertes.append(_alerte_orcid_invalide(
                        auteur, identifiant,
                        ('aucun enregistrement public à cet identifiant',
                         'kein öffentlicher Eintrag unter dieser Kennung'), langue))
                    lu = None
                if lu and (lu[0] or lu[1]):
                    if (pronto_modele.aplatir(lu[1]) != pronto_modele.aplatir(nom)
                            or _premier_prenom_aplati(lu[0]) != _premier_prenom_aplati(prenom)):
                        stats['orcid_nom_divergent'] += 1
                        alertes.append(_alerte_nom_divergent(auteur, identifiant, lu[0], lu[1],
                                                             langue))

        if reseau and institution and not (auteur.get('ror') or '').strip():
            if institution not in cache_ror:
                try:
                    cache_ror[institution] = appeler('ror', chercher_ror, institution, delai)
                except _Introuvable:
                    cache_ror[institution] = None
            ror = cache_ror[institution]
            if ror:
                auteur['ror'] = ror['id']
                a_verifier.append('ror')
                stats['ror_trouves'] += 1
                alertes.append(_alerte_ror(auteur, institution, ror, langue))

        if reseau and prenom and nom and not orcid_manuscrit:
            try:
                verdict = appeler('orcid', chercher_orcid, prenom, nom, institution,
                                  ror['noms'] if ror else [], delai)
            except _Introuvable:
                verdict = None
            if verdict and verdict[0] == 'trouve':
                auteur['orcid'] = verdict[1]
                a_verifier.append('orcid')
                stats['orcid_trouves'] += 1
                alertes.append(_alerte_orcid(auteur, verdict[1], verdict[2], langue))
            elif verdict and verdict[0] == 'candidat':
                stats['orcid_candidats'] += 1
                alertes.append(_alerte_candidat(auteur, verdict[1], langue))

        if a_verifier:
            auteur['a_verifier'] = a_verifier
    return alertes, stats
