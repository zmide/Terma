"""Extract a native build artifact into an empty, private packaging workspace."""

from pathlib import Path, PurePosixPath
import shutil
import sys
import tarfile


def extract_staging(archive, destination):
    base = Path(destination).resolve()
    if not base.is_dir() or any(base.iterdir()):
        raise ValueError("Packaging workspace must be empty")
    root = base / "terma"
    members, names, total = [], set(), 0
    with tarfile.open(archive, "r:gz") as source:
        for member in source:
            name = member.name
            parts = PurePosixPath(name).parts
            if (not parts or parts[0] != "terma" or ".." in parts
                    or "\\" in name or ":" in name or any(ord(c) < 32 for c in name)
                    or len(name) > 4096):
                raise ValueError("Invalid staging member path")
            if len(parts) == 1 and not member.isdir():
                raise ValueError("Application root must be a directory")
            normalized = str(PurePosixPath(name))
            if normalized in names:
                raise ValueError("Duplicate staging member")
            names.add(normalized)
            if not (member.isdir() or member.isfile() or member.issym()):
                raise ValueError("Unsupported staging member type")
            total += member.size
            if member.size > 256 * 1024 ** 2 or total > 1024 ** 3 or len(names) > 100000:
                raise ValueError("Native staging archive exceeds size limits")
            if member.issym() and (not member.linkname or PurePosixPath(member.linkname).is_absolute()
                    or "\\" in member.linkname or ":" in member.linkname or any(ord(c) < 32 for c in member.linkname)):
                raise ValueError("Invalid staging link")
            members.append(member)

        # Files are written before links, so extraction cannot follow an archive link.
        for member in members:
            target = base.joinpath(*PurePosixPath(member.name).parts)
            if member.issym():
                continue
            if member.isdir():
                target.mkdir(parents=True, exist_ok=True)
                target.chmod((member.mode & 0o755) | 0o700)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                with source.extractfile(member) as incoming, target.open("xb") as outgoing:
                    shutil.copyfileobj(incoming, outgoing, length=1024 * 1024)
                target.chmod(member.mode & 0o755)
        links = []
        for member in members:
            if not member.issym():
                continue
            target = base.joinpath(*PurePosixPath(member.name).parts)
            if any(parent.is_symlink() for parent in target.parents if parent != base):
                raise ValueError("Staging link has a symlink parent")
            target.parent.mkdir(parents=True, exist_ok=True)
            target.symlink_to(member.linkname)
            links.append(target)
        for target in links:
            if not target.resolve().is_relative_to(root):
                raise ValueError("Staging link escapes application directory")
    if not root.is_dir() or root.is_symlink():
        raise ValueError("Missing application directory")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("Usage: extract-fnos-staging.py ARCHIVE EMPTY_DIRECTORY")
    try:
        extract_staging(sys.argv[1], sys.argv[2])
    except (OSError, ValueError, RuntimeError, tarfile.TarError) as error:
        raise SystemExit(str(error)) from error
