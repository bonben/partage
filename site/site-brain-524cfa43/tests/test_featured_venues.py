import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('update_hal', Path(__file__).resolve().parents[1] / 'scripts' / 'update_hal.py')
hal = importlib.util.module_from_spec(spec)
spec.loader.exec_module(hal)


class FeaturedVenueTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.rules = hal.load_venues()

    def test_main_venues_and_exclusions(self):
        cases = [
            ('COMM', 'conferenceTitle_s', 'NeurIPS 2025: Annual Conference on Neural Information Processing Systems', 'NeurIPS'),
            ('COMM', 'conferenceTitle_s', 'CVPR 2025: Conference on Computer Vision and Pattern Recognition', 'CVPR'),
            ('COMM', 'conferenceTitle_s', 'CVPR 2025 Workshops', None),
            ('COMM', 'conferenceTitle_s', 'Proceedings of CVPR Findings', None),
            ('COMM', 'conferenceTitle_s', 'ICMLW 2025', None),
            ('COMM', 'conferenceTitle_s', 'ICMLA 2025', None),
            ('ART', 'journalTitle_s', 'Transactions on Machine Learning Research', 'TMLR'),
            ('ART', 'journalTitle_s', 'Nature Communications', 'Nature Comms'),
            ('ART', 'journalTitle_s', 'Scientific Reports', None),
            ('UNDEFINED', 'conferenceTitle_s', 'NeurIPS 2025', None),
        ]
        for kind, field, name, expected in cases:
            with self.subTest(venue=name):
                self.assertEqual(hal.featured_venue({'docType_s': kind, field: name}, self.rules), expected)

    def test_all_venue_types_get_badges(self):
        doc = {'docType_s': 'COMM', 'conferenceTitle_s': 'EUSIPCO 2024: Signal Processing Conference'}
        later = {'docType_s': 'COMM', 'conferenceTitle_s': 'EUSIPCO 2025: Signal Processing Conference'}
        self.assertEqual(hal.venue_badge(doc, self.rules)[1], hal.venue_badge(later, self.rules)[1])
        self.assertEqual(hal.venue_badge({'docType_s': 'ART', 'journalTitle_s': 'Scientific Reports'}, self.rules)[0], 'Scientific Reports')
        self.assertIsNone(hal.venue_badge({'docType_s': 'UNDEFINED'}, self.rules))

    def test_arxiv_identifiers_and_override(self):
        doc = {'halId_s': 'hal-1', 'arxivId_s': '2401.12345v2'}
        self.assertEqual(hal.arxiv_id(doc, {'hal-1': '2301.11111'}), '2401.12345v2')
        self.assertEqual(hal.arxiv_id({'halId_s': 'hal-1'}, {'hal-1': '2301.11111'}), '2301.11111')
        self.assertEqual(hal.arxiv_id({'halId_s': 'hal-2'}, {}), '')
        with self.assertRaises(ValueError):
            hal.arxiv_id({'halId_s': 'hal-3', 'arxivId_s': 'https://bad.example/'}, {})

    def test_eusipco_aliases_share_badge_without_highlight(self):
        docs = [
            {'docType_s': 'COMM', 'conferenceTitle_s': 'EUSIPCO 2024: 32nd European Signal Processing Conference'},
            {'docType_s': 'COMM', 'conferenceTitle_s': '34th European Signal Processing Conference (EUSIPCO)'},
        ]
        self.assertEqual(hal.venue_badge(docs[0], self.rules), hal.venue_badge(docs[1], self.rules))
        self.assertEqual(hal.venue_badge(docs[0], self.rules)[0], 'EUSIPCO')
        self.assertIsNone(hal.featured_venue(docs[0], self.rules))
        workshop = {'docType_s': 'COMM', 'conferenceTitle_s': 'EUSIPCO Workshop 2024'}
        self.assertNotEqual(hal.venue_badge(workshop, self.rules)[0], 'EUSIPCO')

    def test_annotates_by_hal_id_and_detects_mismatches(self):
        bib = '@article{b,\n  HAL_ID = {hal-2},\n}\n\n@inproceedings{a,\n  HAL_ID = {hal-1},\n}'
        docs = [
            {'halId_s': 'hal-1', 'docType_s': 'COMM', 'conferenceTitle_s': 'CVPR 2025'},
            {'halId_s': 'hal-2', 'docType_s': 'ART', 'journalTitle_s': 'Scientific Reports'},
        ]
        result = hal.annotate_bibtex(bib, docs, self.rules)
        self.assertIn('HALTYPE = {ART}', result.split('@inproceedings')[0])
        self.assertIn('HALTYPE = {COMM}', result.split('@inproceedings')[1])
        self.assertNotIn('FEATURED', result.split('@inproceedings')[0])
        self.assertIn('ABBR = {CVPR}', result.split('@inproceedings')[1])
        with self.assertRaises(ValueError):
            hal.annotate_bibtex(bib.replace('hal-2', 'hal-3'), docs, self.rules)


if __name__ == '__main__':
    unittest.main()
