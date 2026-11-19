"""Focused checks for structured first-person memory relationships."""
import tempfile
import unittest
from pathlib import Path

from aegis_daemon.db import Store
from aegis_daemon.memory import create_capture, forget, graph_query, ingest_document, recall, update_memory


class MemoryGraphTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.store = Store(Path(self.temp_dir.name))

    def tearDown(self):
        self.store.conn.close()
        self.temp_dir.cleanup()

    def test_first_person_project_activity_becomes_user_edge(self):
        created = create_capture(self.store, "I'm working on Aegis desktop and I opened the Orion repo.")
        result = graph_query(self.store, "User")
        self.assertEqual(
            [(edge["relation"], edge["obj"]) for edge in result["edges"]],
            [("working_on", "Aegis desktop"),
             ("opened", "the Orion repo")],
        )
        self.assertGreaterEqual(len(created["edges"]), 2)

    def test_profile_fields_become_typed_relations(self):
        create_capture(self.store, "My name is Mohit. My email is mohit@example.com. My portfolio is https://example.com")
        edges = graph_query(self.store, "User")["edges"]
        self.assertEqual([edge["obj"] for edge in edges], ["name: Mohit", "email: mohit@example.com", "portfolio: https://example.com"])

    def test_graph_can_be_limited_to_a_chat_scope(self):
        create_capture(self.store, "I opened the Orion repo.", scope_id="chat:one")
        create_capture(self.store, "I opened the Vega repo.", scope_id="chat:two")
        one = graph_query(self.store, "User", "chat:one")["edges"]
        self.assertEqual([edge["obj"] for edge in one], ["the Orion repo"])
        self.assertEqual(one[0]["scope_id"], "chat:one")

    def test_recall_includes_global_and_only_the_active_chat_scope(self):
        create_capture(self.store, "The global project uses the cobalt build pipeline.",
                       scope_id="", kind="personal")
        create_capture(self.store, "The task uses the cobalt deployment dashboard.",
                       scope_id="chat:one", kind="task")
        create_capture(self.store, "The other chat uses the cobalt astronomy telescope.",
                       scope_id="chat:two", kind="task")

        result = recall(self.store, "cobalt", scope_id="chat:one")
        texts = [item["text"] for item in result["results"]]
        self.assertTrue(any("build pipeline" in text for text in texts))
        self.assertTrue(any("deployment dashboard" in text for text in texts))
        self.assertFalse(any("astronomy telescope" in text for text in texts))

    def test_unscoped_recall_does_not_return_chat_task_memory(self):
        create_capture(self.store, "The secret cobalt task checkpoint is private.",
                       scope_id="chat:one", kind="task")
        result = recall(self.store, "cobalt checkpoint")
        self.assertFalse(any("private" in item["text"] for item in result["results"]))

    def test_forgetting_a_memory_hides_its_graph_edges(self):
        created = create_capture(self.store, "I opened the Orion repo.")
        self.assertEqual(len(graph_query(self.store, "User")["edges"]), 1)
        result = forget(self.store, capture_id=created["capture_id"])
        self.assertTrue(result["ok"])
        self.assertEqual(graph_query(self.store, "User")["edges"], [])

    def test_explicit_resave_restores_a_forgotten_capture(self):
        text = "I opened the Orion repo."
        created = create_capture(self.store, text, scope_id="chat:one")
        forget(self.store, capture_id=created["capture_id"])
        restored = create_capture(self.store, text, scope_id="chat:one")
        self.assertEqual(created["capture_id"], restored["capture_id"])
        self.assertEqual(len(graph_query(self.store, "User", "chat:one")["edges"]), 1)

    def test_correcting_a_memory_rebuilds_its_graph_and_search_chunks(self):
        created = create_capture(self.store, "I'm working on Orion desktop tools.")
        update_memory(self.store, capture_id=created["capture_id"], text="I'm working on Vega desktop tools.")
        edges = graph_query(self.store, "User")["edges"]
        self.assertEqual([edge["obj"] for edge in edges], ["Vega desktop tools"])
        chunks = [row["text"] for row in self.store.query(
            "SELECT text FROM chunks WHERE capture_id=?", (created["capture_id"],))]
        self.assertTrue(any("Vega" in chunk for chunk in chunks))
        self.assertFalse(any("Orion" in chunk for chunk in chunks))

    def test_markdown_capture_keeps_rag_chunks_without_creating_stair_nodes(self):
        result = ingest_document(
            self.store,
            "# Project Notes\n\n## Decisions\n\nKeep memory local and searchable.",
        )
        self.assertTrue(result["ok"])
        self.assertEqual(result["tree_nodes"], 0)
        self.assertGreater(result["chunks_created"], 0)
        self.assertEqual(
            self.store.query("SELECT id FROM tree_nodes WHERE capture_id=?", (result["capture_id"],)),
            [],
        )
        self.assertGreater(
            self.store.query_one("SELECT COUNT(*) AS count FROM chunks WHERE capture_id=?", (result["capture_id"],))["count"],
            0,
        )


if __name__ == "__main__":
    unittest.main()
