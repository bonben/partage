import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('update_hal', Path(__file__).resolve().parents[1] / 'scripts' / 'update_hal.py')
hal = importlib.util.module_from_spec(spec)
spec.loader.exec_module(hal)

ENTRY = """@unpublished{pasdeloup:hal-05766655,
  TITLE = {{Convolutional neural networks on irregular domains}},
  YEAR = {2026},
  MONTH = Sep,
  HAL_ID = {hal-05766655},
}"""


class PreprintDateTests(unittest.TestCase):
    def test_preprint_deposited_late_takes_publication_date(self):
        doc = {'docType_s': 'UNDEFINED', 'producedDate_s': '2026-09-28', 'publicationDate_s': '2017', 'producedDateY_i': 2026}
        self.assertEqual(hal.fix_preprint_date(doc), (2017, None))
        self.assertEqual(doc['producedDateY_i'], 2017)

    def test_publication_month_is_kept(self):
        doc = {'docType_s': 'UNDEFINED', 'producedDate_s': '2026-09-28', 'publicationDate_s': '2023-01-16', 'producedDateY_i': 2026}
        self.assertEqual(hal.fix_preprint_date(doc), (2023, 1))

    def test_conference_keeps_its_date(self):
        # For a COMM, producedDate is the conference; publicationDate (proceedings) is later or equal.
        doc = {'docType_s': 'COMM', 'producedDate_s': '2022-09-07', 'publicationDate_s': '2021', 'producedDateY_i': 2022}
        self.assertIsNone(hal.fix_preprint_date(doc))
        self.assertEqual(doc['producedDateY_i'], 2022)

    def test_bibtex_year_and_month_rewritten(self):
        out = hal.redate_bibtex(ENTRY, (2017, None))
        self.assertIn('YEAR = {2017}', out)
        self.assertNotIn('MONTH', out)
        out = hal.redate_bibtex(ENTRY, (2023, 1))
        self.assertIn('YEAR = {2023},\n  MONTH = Jan,', out)


if __name__ == '__main__':
    unittest.main()
