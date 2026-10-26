#!/usr/bin/env python3
"""Exercise reviewed scoped exports using isolated temporary Git repositories."""

import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest


SCRIPT = Path(__file__).with_name('sync-from-internal.py')


def digest(data):
    return hashlib.sha256(data).hexdigest()


class ScopedSyncTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='local-source-export-test-')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.source = self.root / 'source'
        self.destination = self.root / 'export'
        for repository in (self.source, self.destination):
            repository.mkdir()
            self.git(repository, 'init', '-q')
            self.git(repository, 'config', 'user.name', 'Local export test')
            self.git(repository, 'config', 'user.email', 'local-export-test@example.invalid')
            self.git(repository, 'config', 'commit.gpgsign', 'false')
        self.originals = {
            'managed.txt': b'reviewed version one\n',
            'unrelated.txt': b'unrelated version one\n',
            'protected.ts': b'local runtime baseline\n',
            'removed.txt': b'retired version one\n'
        }
        for name, data in self.originals.items():
            (self.source / name).write_bytes(data)
            (self.destination / name).write_bytes(data)
        (self.source / '.gitignore').write_text('.env.local\n')
        self.commit(self.source)
        self.initial_commit = self.git(self.source, 'rev-parse', 'HEAD').stdout.strip()
        scripts = self.destination / 'scripts'
        scripts.mkdir()
        self.script = scripts / SCRIPT.name
        shutil.copyfile(SCRIPT, self.script)
        self.state_path = self.destination / '.git' / 'open-source-sync.json'
        self.initial_state = {
            'source': str(self.source),
            'source_commit': self.initial_commit,
            'files': {
                name: {'source': digest(data), 'exported': digest(data)}
                for name, data in self.originals.items() if name != 'protected.ts'
            },
            'protected': {'protected.ts': digest(self.originals['protected.ts'])},
            'excluded': ['.gitignore'],
            'replacements': {}
        }
        self.state_path.write_text(json.dumps(self.initial_state))
        self.commit(self.destination)

        (self.source / 'managed.txt').write_text('reviewed version two\n')
        (self.source / 'unrelated.txt').write_text('unrelated version two\n')
        (self.source / 'protected.ts').write_text('internal runtime changed\n')
        (self.source / 'new.txt').write_text('new unreviewed feature\n')
        (self.source / 'removed.txt').unlink()
        self.commit(self.source)
        self.latest_commit = self.git(self.source, 'rev-parse', 'HEAD').stdout.strip()

    def git(self, root, *args):
        return subprocess.run(
            ['git', '-c', 'core.hooksPath=/dev/null', '-C', str(root), *args],
            check=True,
            text=True,
            capture_output=True
        )

    def commit(self, root):
        self.git(root, 'add', '--all')
        self.git(root, 'commit', '-q', '-m', 'Local export test snapshot')

    def sync(self, *args):
        return subprocess.run(
            [sys.executable, str(self.script), '--source-ref', 'HEAD', *args],
            text=True,
            capture_output=True,
            timeout=20
        )

    def read_state(self):
        return json.loads(self.state_path.read_text())

    def assert_unmodified(self):
        for name, data in self.originals.items():
            self.assertEqual((self.destination / name).read_bytes(), data)
        self.assertEqual(self.read_state(), self.initial_state)

    def test_scoped_preview_leaves_other_pending_paths_and_all_files_untouched(self):
        result = self.sync('--only', 'managed.txt')
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        self.assertIn('UPDATE managed.txt', result.stdout)
        self.assertIn('Preview: 1 updates, 0 deletions', result.stdout)
        self.assertNotIn('unrelated.txt', result.stdout)
        self.assertNotIn('protected.ts', result.stdout)
        self.assertNotIn('new.txt', result.stdout)
        self.assertNotIn('removed.txt', result.stdout)
        self.assert_unmodified()

    def test_scoped_apply_updates_only_reviewed_file_and_records_separate_snapshot(self):
        result = self.sync('--only', 'managed.txt', '--apply')
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        self.assertEqual((self.destination / 'managed.txt').read_bytes(), (self.source / 'managed.txt').read_bytes())
        for name in ('unrelated.txt', 'protected.ts', 'removed.txt'):
            self.assertEqual((self.destination / name).read_bytes(), self.originals[name])
        self.assertFalse((self.destination / 'new.txt').exists())
        state = self.read_state()
        self.assertEqual(state['source_commit'], self.initial_commit)
        self.assertEqual(state['last_scoped_sync'], {'source_commit': self.latest_commit, 'paths': ['managed.txt']})
        self.assertEqual(state['files']['managed.txt']['source'], digest((self.source / 'managed.txt').read_bytes()))
        self.assertEqual(state['files']['unrelated.txt'], self.initial_state['files']['unrelated.txt'])
        self.assertEqual(state['protected'], self.initial_state['protected'])
        self.assertEqual(self.sync('--only', 'managed.txt').returncode, 0)

    def test_scoped_apply_still_scans_unrelated_local_files_for_source_secrets(self):
        fixture_value = 'local-fixture-' + 'not-a-real-credential-123456'
        (self.source / '.env.local').write_text('API_KEY=' + fixture_value + '\n')
        (self.destination / 'unsafe-local.txt').write_text(fixture_value)
        result = self.sync('--only', 'managed.txt', '--apply')
        self.assertEqual(result.returncode, 1, result.stderr + result.stdout)
        self.assertIn('unsafe-local.txt: matches a credential from the source environment', result.stdout)
        self.assertNotIn(fixture_value, result.stdout + result.stderr)
        self.assert_unmodified()

    def test_includes_and_removals_outside_scope_are_rejected_without_writes(self):
        for option, name in (('--include', 'new.txt'), ('--remove', 'removed.txt')):
            with self.subTest(option=option):
                result = self.sync('--only', 'managed.txt', option, name, '--apply')
                self.assertEqual(result.returncode, 1, result.stderr + result.stdout)
                self.assertIn('Include/remove paths must also appear in --only', result.stdout)
                self.assert_unmodified()

    def test_reviewed_include_and_removal_inside_scope_apply(self):
        result = self.sync('--only', 'new.txt', '--include', 'new.txt', '--only', 'removed.txt', '--remove', 'removed.txt', '--apply')
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        self.assertEqual((self.destination / 'new.txt').read_bytes(), (self.source / 'new.txt').read_bytes())
        self.assertFalse((self.destination / 'removed.txt').exists())
        self.assertEqual((self.destination / 'managed.txt').read_bytes(), self.originals['managed.txt'])
        state = self.read_state()
        self.assertNotIn('removed.txt', state['files'])
        self.assertIn('new.txt', state['files'])
        self.assertEqual(state['source_commit'], self.initial_commit)
        self.assertEqual(state['last_scoped_sync']['paths'], ['new.txt', 'removed.txt'])

    def test_selected_new_and_protected_files_still_require_review(self):
        for name, expected in (('new.txt', 'new source file'), ('protected.ts', 'protected export file')):
            with self.subTest(path=name):
                result = self.sync('--only', name, '--apply')
                self.assertEqual(result.returncode, 1, result.stderr + result.stdout)
                self.assertIn('REVIEW ' + name + ': ' + expected, result.stdout)
                self.assert_unmodified()

    def test_unknown_or_unsafe_scope_is_rejected_without_writes(self):
        result = self.sync('--only', 'unknown.txt', '--apply')
        self.assertEqual(result.returncode, 1, result.stderr + result.stdout)
        self.assertIn('unknown scoped path', result.stdout)
        unsafe = self.sync('--only', '../escape.txt', '--apply')
        self.assertEqual(unsafe.returncode, 2)
        self.assert_unmodified()

    def test_unscoped_preview_still_reports_all_unreviewed_changes(self):
        result = self.sync()
        self.assertEqual(result.returncode, 1, result.stderr + result.stdout)
        self.assertIn('UPDATE managed.txt', result.stdout)
        self.assertIn('UPDATE unrelated.txt', result.stdout)
        self.assertIn('REVIEW new.txt: new source file', result.stdout)
        self.assertIn('REVIEW protected.ts: protected export file', result.stdout)
        self.assertIn('REVIEW removed.txt: removed upstream', result.stdout)
        self.assert_unmodified()


if __name__ == '__main__':
    unittest.main()
