#!/usr/bin/env python3
"""Download BRAIN HAL records and HAL's BibTeX export.

A record is kept when it is attached to the BRAIn HAL structure, or when a
permanent member (data/hal-members.json) is an author and is personally
affiliated with Lab-STICC or IMT Atlantique on it. This recovers work from
before the BRAIn structure existed (2023) or published elsewhere in the lab.
Nothing before the team's creation (`first_year`, 2017) is kept.
"""
import hashlib
import json
import re
import sys
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BRAIN_STRUCTURES = {1149551, 1251172}
API = 'https://api.hal.science/search/'
PAGE_SIZE = 100
BIBTEX_BATCH = 50
FIELDS = ('halId_s,title_s,authFullName_s,producedDateY_i,producedDate_s,publicationDate_s,docType_s,uri_s,'
          'conferenceTitle_s,journalTitle_s,doiId_s,arxivId_s,structId_i,authIdHasStructure_fs,'
          'keyword_s,abstract_s,en_abstract_s')
MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']


def load_members():
    config = json.loads((ROOT / 'data' / 'hal-members.json').read_text(encoding='utf-8'))
    members = {int(v) for v in config['members'].values()}
    structures = {int(k) for k in config['affiliation_structures']}
    first_year = int(config['first_year'])
    return members, structures, first_year


def build_query(members, structures):
    def ors(values):
        return ' OR '.join(str(v) for v in sorted(values))
    return (f'structId_i:({ors(BRAIN_STRUCTURES)}) OR '
            f'(authIdHal_i:({ors(members)}) AND structId_i:({ors(structures)}))')


def member_affiliated(doc, members, structures):
    """True if a member is personally affiliated with one of `structures`.

    authIdHasStructure_fs entries look like
    '<authorform>-<idHal_i>_FacetSep_<name>_JoinSep_<structId>_FacetSep_<structure name>'
    and already list parent structures (team, laboratory, institution).
    """
    for entry in doc.get('authIdHasStructure_fs', []):
        author, _, structure = entry.partition('_JoinSep_')
        person = author.split('_FacetSep_', 1)[0].rsplit('-', 1)[-1]
        struct_id = structure.split('_FacetSep_', 1)[0]
        if person.isdigit() and struct_id.isdigit() and int(person) in members and int(struct_id) in structures:
            return True
    return False


def is_team_record(doc, members, structures):
    return bool(BRAIN_STRUCTURES & set(doc.get('structId_i', []))) or member_affiliated(doc, members, structures)


def fix_preprint_date(doc):
    """Date a preprint by its publication, not by its HAL deposit.

    For a HAL preprint (UNDEFINED), producedDate_s is often the deposit date:
    an arXiv paper of 2017 imported in 2026 would be listed in 2026. Its
    publicationDate_s keeps the real date; take it when it is earlier. Returns
    (year, month or None) when the date changed, else None.
    """
    produced, published = doc.get('producedDate_s', ''), doc.get('publicationDate_s', '')
    if doc.get('docType_s') != 'UNDEFINED' or not re.match(r'\d{4}', published) or published >= produced:
        return None
    year = int(published[:4])
    month = int(published[5:7]) if re.match(r'\d{4}-\d{2}', published) else None
    doc['producedDateY_i'], doc['producedDate_s'] = year, published
    return year, month


def redate_bibtex(entry, date):
    """Rewrite YEAR and MONTH of a HAL BibTeX entry."""
    year, month = date
    entry = re.sub(r'^(\s*YEAR\s*=\s*)\{\d{4}\}', lambda m: f'{m.group(1)}{{{year}}}', entry, flags=re.M | re.I)
    entry = re.sub(r'^\s*MONTH\s*=.*\n', '', entry, flags=re.M | re.I)
    if month:
        entry = re.sub(r'^(\s*)(YEAR\s*=.*\n)', lambda m: f'{m.group(1)}{m.group(2)}{m.group(1)}MONTH = {MONTHS[month - 1].capitalize()},\n',
                       entry, count=1, flags=re.M | re.I)
    return entry


def request(query, **params):
    query = {'q': query, 'sort': 'halId_s asc', **params}
    req = urllib.request.Request(API + '?' + urllib.parse.urlencode(query), headers={'User-Agent': 'brain-bzh-site/1.0 (HAL bibliography)'})
    with urllib.request.urlopen(req, timeout=60) as response:
        return response.read().decode('utf-8')

def load_venues():
    config = json.loads((ROOT / 'data' / 'featured-venues.json').read_text(encoding='utf-8'))
    exclusion = re.compile(config['conference_exclude'], re.IGNORECASE)
    venues = [(item['abbr'], item['type'], re.compile(item['pattern'], re.IGNORECASE)) for item in config['venues']]
    return exclusion, venues


def featured_venue(doc, rules):
    exclusion, venues = rules
    doc_type = doc.get('docType_s')
    field = 'conferenceTitle_s' if doc_type == 'COMM' else 'journalTitle_s' if doc_type == 'ART' else None
    if not field:
        return None
    name = doc.get(field, '').strip()
    if doc_type == 'COMM' and exclusion.search(name):
        return None
    return next((abbr for abbr, kind, pattern in venues if kind == doc_type and pattern.search(name)), None)


def venue_badge(doc, rules):
    """Return a compact label and stable color for a HAL conference or journal."""
    kind = doc.get('docType_s')
    field = {'COMM': 'conferenceTitle_s', 'ART': 'journalTitle_s'}.get(kind)
    if not field:
        return None
    name = ' '.join(doc.get(field, '').split())
    if not name:
        return None
    featured = featured_venue(doc, rules)
    # Normalize known HAL variants without promoting the venue to a highlight.
    is_eusipco = (kind == 'COMM' and not rules[0].search(name)
                   and re.search(r'\beusipco\b|\beuropean signal processing conference\b', name, re.I))
    label = featured or ('EUSIPCO' if is_eusipco else name)
    if not featured and not is_eusipco and kind == 'COMM' and ':' in label:
        prefix = label.split(':', 1)[0].strip()
        if 2 <= len(prefix) <= 34:
            label = prefix
    # Braces and backslashes have special meanings in BibTeX.
    label = re.sub(r'[{}\\]', '', label)
    label = label if len(label) <= 34 else label[:31].rstrip() + '…'
    # Normalize year variants so recurring venues tend to keep their color.
    key = re.sub(r'\b(?:19|20)\d{2}\b', '', label.casefold()).strip()
    palette = ['#dcecfb', '#dbeee6', '#f9e8cd', '#f0e2f6', '#f7e0e3', '#d8eef0', '#e6ead2', '#ece5df']
    color = palette[int(hashlib.sha256(key.encode('utf-8')).hexdigest()[:8], 16) % len(palette)]
    return label, color


def load_themes():
    config = json.loads((ROOT / '_data' / 'themes.json').read_text(encoding='utf-8'))
    return [(item['label'], re.compile(item['pattern'], re.IGNORECASE)) for item in config['themes']]


def record_themes(doc, themes):
    """Tags whose pattern matches the title or keywords, else the abstract."""
    head = ' '.join(doc.get('title_s', []) + doc.get('keyword_s', []))
    tags = [label for label, pattern in themes if pattern.search(head)]
    if not tags:
        abstract = ' '.join(doc.get('en_abstract_s') or doc.get('abstract_s') or [])
        tags = [label for label, pattern in themes if pattern.search(abstract)]
    return tags


def arxiv_id(doc, overrides):
    """Prefer HAL's arXiv identifier; allow verified manual additions."""
    value = doc.get('arxivId_s') or overrides.get(doc['halId_s'], '')
    if value and not re.fullmatch(r'(?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Za-z]{2})?/\d{7})(?:v\d+)?', value):
        raise ValueError('Invalid arXiv ID; existing output preserved')
    return value


def annotate_bibtex(bib, docs, rules, overrides=None, redated=None, themes=None):
    """Add al-folio fields by HAL ID, not by relying on export ordering."""
    overrides = overrides or {}
    redated = redated or {}
    by_id = {doc['halId_s']: doc for doc in docs}
    entries = re.split(r'(?=^@\w+\s*\{)', bib.strip(), flags=re.M)
    annotated, found = [], set()
    for entry in filter(str.strip, entries):
        match = re.search(r'^\s*HAL_ID\s*=\s*\{([^}]+)\}', entry, re.M | re.I)
        if not match or match.group(1) not in by_id or match.group(1) in found:
            raise ValueError('HAL JSON and BibTeX IDs do not agree; existing output preserved')
        hal_id = match.group(1)
        found.add(hal_id)
        if hal_id in redated:
            entry = redate_bibtex(entry, redated[hal_id])
        entry = re.sub(r'^(  URL = \{(https?://[^}]+)\},)$', r'\1\n  HTML = {\2},', entry, flags=re.M)
        doc_type = by_id[hal_id].get('docType_s', '')
        if not re.fullmatch(r'[A-Z_]*', doc_type):
            raise ValueError('Unexpected HAL document type; existing output preserved')
        venue = featured_venue(by_id[hal_id], rules)
        badge = venue_badge(by_id[hal_id], rules)
        fields = f'\n  HALTYPE = {{{doc_type}}},'
        identifier = arxiv_id(by_id[hal_id], overrides)
        if identifier:
            fields += f'\n  ARXIV = {{{identifier}}},'
        tags = record_themes(by_id[hal_id], themes or [])
        if tags:
            fields += '\n  THEMES = {' + '; '.join(tags) + '},'
        if badge:
            label, color = badge
            fields += f'\n  ABBR = {{{label}}},\n  VENUECOLOR = {{{color}}},'
        entry = re.sub(r'\s*}\s*$', lambda _: fields + '\n}', entry)
        annotated.append(entry.strip())
    if found != set(by_id):
        raise ValueError('HAL JSON and BibTeX IDs do not agree; existing output preserved')
    return '\n\n'.join(annotated)


def main():
    members, structures, first_year = load_members()
    query = build_query(members, structures)
    years = f'producedDateY_i:[{first_year} TO *]'
    first = json.loads(request(query, fq=years, wt='json', rows=0))['response']
    total = first['numFound']
    if not total or total > 10000:
        raise ValueError(f'Unexpected HAL result count: {total}; existing output preserved')
    candidates = []
    for start in range(0, total, PAGE_SIZE):
        count = min(PAGE_SIZE, total - start)
        result = json.loads(request(query, fq=years, wt='json', rows=count, start=start, fl=FIELDS))['response']
        if result['numFound'] != total or len(result['docs']) != count:
            raise ValueError('HAL result count changed or page incomplete; existing output preserved')
        candidates.extend(result['docs'])
    docs = [d for d in candidates if is_team_record(d, members, structures)]
    redated = {}
    for d in docs:
        date = fix_preprint_date(d)
        if date:
            redated[d['halId_s']] = date
    # A redated preprint may now predate the team.
    docs = [d for d in docs if d['producedDateY_i'] >= first_year]
    ids = [d.get('halId_s') for d in docs]
    if not docs or None in ids or len(set(ids)) != len(docs):
        raise ValueError('Duplicate or missing HAL IDs; existing output preserved')
    rules = load_venues()
    themes = load_themes()
    overrides = json.loads((ROOT / 'data' / 'arxiv-overrides.json').read_text(encoding='utf-8'))
    chunks = []
    for start in range(0, len(docs), BIBTEX_BATCH):
        batch = docs[start:start + BIBTEX_BATCH]
        bib = request('halId_s:(' + ' OR '.join(f'"{d["halId_s"]}"' for d in batch) + ')',
                      wt='bibtex', rows=len(batch))
        if len(re.findall(r'^@\w+\s*\{', bib, re.M)) != len(batch):
            raise ValueError('HAL BibTeX batch incomplete; existing output preserved')
        chunks.append(annotate_bibtex(bib, batch, rules, overrides, redated, themes))
    untagged = sum(not record_themes(doc, themes) for doc in docs)
    # Keep the JSON export as before: matching logic fields are only needed here.
    for d in docs:
        d.pop('structId_i', None)
        d.pop('authIdHasStructure_fs', None)
        d.pop('producedDate_s', None)
        d.pop('publicationDate_s', None)
        for field in ('keyword_s', 'abstract_s', 'en_abstract_s'):
            d.pop(field, None)
    output = ROOT / 'data'
    output.mkdir(exist_ok=True)
    (output / 'hal-publications.json').write_text(json.dumps(docs, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    (ROOT / '_bibliography').mkdir(exist_ok=True)
    (ROOT / '_bibliography' / 'papers.bib').write_text('\n\n'.join(chunks) + '\n', encoding='utf-8')
    print(f'Downloaded {len(docs)} HAL records since {first_year} ({len(candidates) - len(docs)} candidates rejected); '
          f'badged {sum(bool(venue_badge(doc, rules)) for doc in docs)} matching venues; '
          f'{len(redated)} preprints dated by publication instead of HAL deposit; '
          f'{untagged} records without a thematic tag.')


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        sys.exit(f'HAL update failed: {exc}')
