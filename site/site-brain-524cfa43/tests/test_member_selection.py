import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('update_hal', Path(__file__).resolve().parents[1] / 'scripts' / 'update_hal.py')
hal = importlib.util.module_from_spec(spec)
spec.loader.exec_module(hal)

MEMBERS = {171188}
STRUCTURES = {486345, 481355}


def entry(person, struct_id, name='Someone', struct_name='Structure'):
    return f'2508929-{person}_FacetSep_{name}_JoinSep_{struct_id}_FacetSep_{struct_name}'


class MemberSelectionTests(unittest.TestCase):
    def test_brain_structure_is_enough(self):
        doc = {'structId_i': [1149551, 486345], 'authIdHasStructure_fs': []}
        self.assertTrue(hal.is_team_record(doc, MEMBERS, STRUCTURES))

    def test_member_with_lab_affiliation(self):
        doc = {'structId_i': [486345], 'authIdHasStructure_fs': [entry(171188, 486345)]}
        self.assertTrue(hal.is_team_record(doc, MEMBERS, STRUCTURES))

    def test_member_elsewhere_with_lab_coauthor(self):
        # The member is affiliated elsewhere; only a co-author is at IMT Atlantique.
        doc = {'structId_i': [481355, 2], 'authIdHasStructure_fs': [entry(171188, 2), entry(999, 481355)]}
        self.assertFalse(hal.is_team_record(doc, MEMBERS, STRUCTURES))

    def test_non_member_at_lab(self):
        doc = {'structId_i': [486345], 'authIdHasStructure_fs': [entry(999, 486345)]}
        self.assertFalse(hal.is_team_record(doc, MEMBERS, STRUCTURES))

    def test_query_lists_members_and_structures(self):
        query = hal.build_query(MEMBERS, STRUCTURES)
        self.assertIn('authIdHal_i:(171188)', query)
        self.assertIn('structId_i:(481355 OR 486345)', query)

    def test_member_config_loads(self):
        members, structures, first_year = hal.load_members()
        self.assertEqual(len(members), 6)
        self.assertIn(481355, structures)
        self.assertEqual(first_year, 2017)


if __name__ == '__main__':
    unittest.main()
