"""Repository URL normalization checks (no network access)."""
import unittest

from aegis_daemon.research_connectors import _split_repo


class RepositoryUrlTests(unittest.TestCase):
    def test_accepts_github_urls_and_tree_paths(self):
        self.assertEqual(_split_repo({"repo": "https://github.com/owner/repo"}), ("owner", "repo"))
        self.assertEqual(_split_repo({"repo": "https://github.com/owner/repo/tree/main/src"}), ("owner", "repo"))
        self.assertEqual(_split_repo({"repo": "owner/repo.git"}), ("owner", "repo"))

    def test_rejects_non_github_urls(self):
        self.assertIsNone(_split_repo({"repo": "https://evil.example/owner/repo"}))


if __name__ == "__main__":
    unittest.main()
