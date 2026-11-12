"""ALL-228 local installer safety checks, no network or credentials."""
import importlib.util
import pathlib
import sys
import tempfile
import unittest
from unittest.mock import patch

PATH = pathlib.Path(__file__).with_name("provision-v2-ingredient-temp-login.py")
spec = importlib.util.spec_from_file_location("all228_installer", PATH)
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)


class ProvisionSafety(unittest.TestCase):
    def test_only_temporary_project_is_targeted(self):
        self.assertEqual(module.PROJECT, "fbtgknlxjyeqrxemskbl")
        self.assertEqual(module.ENVIRONMENT, "all251-temporary-staging")
        self.assertEqual(module.LOGIN, "allin_ing_workload_temp_all228")

    def test_database_password_is_not_supplied_on_cli(self):
        class FakeInput:
            def isatty(self):
                return True
        calls = []

        def run(argv, **kwargs):
            calls.append((argv, kwargs))
            return type("Success", (), {"returncode": 0})()

        with patch.object(module, "require_tools"), \
             patch.object(module, "safe_environment", return_value={"PGSSLMODE": "verify-full"}), \
             patch.object(module.subprocess, "run", side_effect=run), \
             patch.object(module.sys, "stdin", FakeInput()), \
             patch("builtins.input", side_effect=["aws-0-us-east-1.pooler.supabase.com","TEMP"]), \
             patch("builtins.print"):
            module.provision()

        self.assertEqual(len(calls), 3)
        secret_command, secret_io = calls[0]
        sql_command, sql_io = calls[1]
        workflow_command, _ = calls[2]
        self.assertEqual(secret_command[:3], ["gh", "secret", "set"])
        self.assertIn("--env", secret_command)
        self.assertIn(module.ENVIRONMENT, secret_command)
        self.assertTrue(secret_io["input"].startswith("aws-0-us-east-1.pooler.supabase.com:5432:postgres:" + module.LOGIN + "." + module.PROJECT + ":"))
        self.assertEqual(sql_command[0], "psql")
        self.assertIn("postgres." + module.PROJECT,sql_command)
        self.assertIn("session_pooler_host=aws-0-us-east-1.pooler.supabase.com",workflow_command)
        self.assertEqual(sql_command[-2:], ["-f", "-"])
        self.assertEqual(sql_io["env"]["PGSSLMODE"], "verify-full")
        self.assertIn("ALTER ROLE " + module.LOGIN, sql_io["input"])
        self.assertIn("enabled=true", sql_io["input"])
        self.assertIn("credential_expires_at", sql_io["input"])
        self.assertEqual(workflow_command[:3], ["gh", "workflow", "run"])
        combined_args = " ".join(" ".join(cmd) for cmd, _ in calls)
        generated = secret_io["input"].split(":")[-1].strip()
        self.assertNotIn(generated, combined_args)
        self.assertNotIn(generated, str(workflow_command))

    def test_cancelled_before_secret_or_database_mutation(self):
        with patch.object(module, "require_tools"), \
             patch.object(module, "safe_environment", return_value={}), \
             patch.object(module.sys.stdin, "isatty", return_value=True), \
             patch("builtins.input", side_effect=["aws-0-us-east-1.pooler.supabase.com","no"]), \
             patch.object(module.subprocess, "run") as command, \
             patch("builtins.print"):
            with self.assertRaisesRegex(RuntimeError, "Cancelled"):
                module.provision()
        command.assert_not_called()


if __name__ == "__main__":
    unittest.main()
