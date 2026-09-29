#!/usr/bin/env python3
"""Preview or apply a reviewed, one-way source export. Requires Python 3.9+."""

import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys
from urllib.parse import unquote, urlsplit


class SyncError(Exception):
    """Actionable messages which never include configuration values."""


def digest(data):
    return hashlib.sha256(data).hexdigest()


def git(root, *args):
    return subprocess.check_output(["git", "-C", str(root), *args], stderr=subprocess.PIPE).decode().strip()


def safe_path(root, relative):
    parts = PurePosixPath(relative).parts
    if not parts or PurePosixPath(relative).is_absolute() or any(p in ("..", ".git") for p in parts):
        raise SyncError("Unsafe relative path")
    path = root.joinpath(*parts)
    if any(parent.is_symlink() for parent in [path, *path.parents] if parent != root.parent):
        raise SyncError("Symlink paths require manual review: " + relative)
    if root not in path.resolve().parents:
        raise SyncError("Path escapes repository")
    return path


def forbidden(relative):
    parts = PurePosixPath(relative).parts
    name = parts[-1]
    return (
        any(p in {".git", "node_modules", ".next", ".secrets", "output", "tmp", "logs", "coverage", "data", "data.lock"} or p.startswith(".next-") for p in parts)
        or (name.startswith(".env") and not name.endswith(".example"))
        or bool(re.search(r"\.(?:pem|key|p12|pfx|db|sqlite|sqlite3|log|tsbuildinfo)$", name))
        or relative.startswith(("src/generated/", "public/storage/"))
        or bool(re.search(r"(?:credentials?|service-account|secret|key|payment).*\.json$", name, re.I))
        or name in {"gpt5.json", "nano_banana.json", "hi-models.json", "seedance.json", "happy_horse.json"}
    )


def known_secrets(source, credential_source_files=()):
    values = set()
    for name in (".env", ".env.test", ".env.production", ".env.local"):
        path = safe_path(source, name)
        if not path.is_file():
            continue
        for line in path.read_text().splitlines():
            match = re.match(r"\s*(?:export\s+)?([A-Za-z_][A-Za-z_0-9]*)\s*=\s*(.*?)\s*$", line)
            if not match:
                continue
            key, value = match.groups()
            value = value.strip().strip("\"'")
            if not re.search(r"SECRET|PASSWORD|TOKEN|API_KEY|ACCESS_KEY|JSON_B64|DATABASE_URL|^dsn$|^DSN$", key):
                continue
            if len(value) >= 8 and not re.search(r"example|placeholder|change[-_]?me|your[-_]|^<", value, re.I):
                values.add(value.encode())
            if value.startswith("mysql://"):
                password = unquote(urlsplit(value).password or "")
                if len(password) >= 8:
                    values.add(password.encode())
    for name in credential_source_files:
        candidate = safe_path(source, name)
        if candidate.is_file():
            for value in re.findall(r"accessKey(?:Id|Secret):[^\n]*?\|\|\s*'([^']+)'", candidate.read_text()):
                if len(value) >= 8:
                    values.add(value.encode())
    return values


def findings(relative, data, secrets, blocked_patterns=()):
    result = []
    if forbidden(relative):
        result.append("forbidden runtime/configuration path")
    if any(value in data for value in secrets):
        result.append("matches a credential from the source environment")
    patterns = {
        "Aliyun access key": rb"\bLTAI[0-9A-Za-z]{12,}\b",
        "API secret": rb"\bsk-[A-Za-z0-9_-]{20,}\b",
        "Google API key": rb"\bAIza[0-9A-Za-z_-]{30,}\b",
        "GitHub token": rb"\bgh[pousr]_[A-Za-z0-9]{30,}\b",
        "private key material": rb"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----\s+[A-Za-z0-9+/=\s]{64,}-----END",
    }
    for label, pattern in patterns.items():
        if re.search(pattern, data):
            result.append(label)
    for pattern in blocked_patterns:
        if re.search(pattern.encode(), data):
            result.append("unreviewed internal infrastructure reference")
    return [relative + ": " + label for label in result]


def transform(data, replacements):
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        return data
    for old, new in sorted(replacements.items(), key=lambda item: len(item[0]), reverse=True):
        text = text.replace(old, new)
    return text.encode()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Write after all safety and conflict checks pass")
    parser.add_argument("--include", action="append", default=[], metavar="PATH", help="Review a newly tracked source file for inclusion")
    parser.add_argument("--remove", action="append", default=[], metavar="PATH", help="Confirm deletion of a managed file removed upstream")
    args = parser.parse_args()
    destination = Path(__file__).resolve().parent.parent
    state_path = destination / ".git" / "open-source-sync.json"
    if not state_path.is_file():
        raise SyncError("Local .git/open-source-sync.json is missing. Re-establish a reviewed export configuration first.")
    state = json.loads(state_path.read_text())
    source = Path(state["source"]).resolve()
    if source == destination or source in destination.parents or destination in source.parents:
        raise SyncError("Source and destination must be separate repositories")
    if Path(git(source, "rev-parse", "--show-toplevel")).resolve() != source:
        raise SyncError("Configured source is not a repository root")
    if git(source, "status", "--porcelain", "--untracked-files=no"):
        raise SyncError("Commit or resolve tracked changes in the source before syncing. No exported files changed.")
    tracked = set(git(source, "ls-files", "-z").split("\0")) - {""}
    managed = state["files"]
    protected = state["protected"]
    excluded = set(state["excluded"])
    includes = set(args.include)
    removes = set(args.remove)
    problems = []
    pending = []
    updates = []
    deletions = []
    secrets = known_secrets(source, state.get("credential_source_files", ()))

    for relative in sorted(includes):
        safe_path(source, relative)
        if relative not in tracked or relative in protected or relative in excluded or forbidden(relative):
            problems.append(relative + ": cannot be included without updating the reviewed local policy")
    for relative in sorted(removes):
        if relative not in managed or relative in tracked:
            problems.append(relative + ": removal requires a managed file deleted upstream")
    for relative in sorted(tracked - set(managed) - set(protected) - excluded - includes):
        pending.append(relative + ": new source file; review and use --include PATH or update exclusions")
    for relative, baseline in sorted(protected.items()):
        path = safe_path(source, relative)
        if relative not in tracked or not path.is_file() or digest(path.read_bytes()) != baseline:
            pending.append(relative + ": protected export file; merge manually and update the local baseline")

    for relative in sorted(set(managed) | includes):
        if relative in protected or relative in excluded or forbidden(relative):
            problems.append(relative + ": forbidden by export policy")
            continue
        original = safe_path(source, relative)
        target = safe_path(destination, relative)
        baseline = managed.get(relative)
        if relative not in tracked:
            if relative not in removes:
                pending.append(relative + ": removed upstream; review and use --remove PATH")
            elif target.exists() and digest(target.read_bytes()) != baseline["exported"]:
                problems.append(relative + ": locally modified; deletion refused")
            else:
                deletions.append(relative)
            continue
        if not original.is_file():
            problems.append(relative + ": source file missing")
            continue
        data = original.read_bytes()
        if baseline and digest(data) == baseline["source"]:
            continue
        exported = transform(data, state["replacements"])
        problems.extend(findings(relative, exported, secrets, state.get("blocked_patterns", ())))
        if target.exists():
            current = target.read_bytes()
            if current != exported and (not baseline or digest(current) != baseline["exported"]):
                problems.append(relative + ": modified on both sides; merge manually")
        elif baseline:
            problems.append(relative + ": deleted locally; merge manually")
        updates.append((relative, data, exported, original.stat().st_mode & 0o777))

    # Scan the entire publishable working tree, including export-owned edits.
    for relative in set(git(destination, "ls-files", "--cached", "--others", "--exclude-standard", "-z").split("\0")) - {""}:
        path = safe_path(destination, relative)
        if path.is_file() and relative not in deletions:
            problems.extend(findings(relative, path.read_bytes(), secrets, state.get("blocked_patterns", ())))

    for relative, _, _, _ in updates:
        print("UPDATE " + relative)
    for relative in deletions:
        print("DELETE " + relative)
    for message in pending:
        print("REVIEW " + message)
    for message in sorted(set(problems)):
        print("BLOCKED " + message)
    if problems or pending:
        print("No files changed. Resolve the listed review items before applying.")
        return 1
    if not args.apply:
        print(f"Preview: {len(updates)} updates, {len(deletions)} deletions. No files changed.")
        return 0

    for relative, original, exported, mode in updates:
        target = safe_path(destination, relative)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(exported)
        target.chmod(mode)
        managed[relative] = {"source": digest(original), "exported": digest(exported)}
    for relative in deletions:
        safe_path(destination, relative).unlink(missing_ok=True)
        del managed[relative]
    state["source_commit"] = git(source, "rev-parse", "HEAD")
    temporary = state_path.with_suffix(".tmp")
    temporary.write_text(json.dumps(state, ensure_ascii=False, indent=2) + "\n")
    os.replace(temporary, state_path)
    print(f"Applied {len(updates)} updates and {len(deletions)} deletions. Review git diff before committing.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except SyncError as error:
        print("Sync stopped: " + str(error), file=sys.stderr)
        sys.exit(2)
    except (ValueError, OSError, KeyError, subprocess.CalledProcessError):
        # Never echo exception data: paths, config contents or Git output may contain credentials.
        print("Sync stopped: invalid/missing local configuration, unsafe path, source changes, or filesystem/Git error. No commit or push was performed.", file=sys.stderr)
        sys.exit(2)
