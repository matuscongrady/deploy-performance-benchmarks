"""Extract native Lambda ZIPs, retaining safe POSIX links and executable modes."""

import pathlib
import shutil
import stat
import sys
import zipfile


def unpack_zip(archive, destination):
    root = pathlib.Path(destination).resolve()
    root.mkdir(parents=True, exist_ok=True)

    def contained(path):
        if not path.resolve(strict=False).is_relative_to(root):
            raise ValueError("ZIP entry or link escapes extraction root")
        return path

    with zipfile.ZipFile(archive) as source:
        entries, links, directories, seen = [], [], [], set()
        for info in source.infolist():
            name = pathlib.PurePosixPath(info.filename)
            mode = info.external_attr >> 16
            kind = stat.S_IFMT(mode)
            # Native archivers may include the extraction root itself. It has
            # no output path or content; accepting it must not allow root files
            # or symbolic links to overwrite the extraction directory.
            if info.filename == "./" and info.is_dir() and kind in (0, stat.S_IFDIR) and info.file_size == 0:
                if "." in seen:
                    raise ValueError("ZIP contains duplicate entry paths")
                seen.add(".")
                continue
            if not name.parts or name.is_absolute() or ".." in name.parts or "\\" in info.filename or any(":" in part for part in name.parts):
                raise ValueError("ZIP entry has an unsafe path")
            if str(name) in seen:
                raise ValueError("ZIP contains duplicate entry paths")
            seen.add(str(name))
            target = contained(root.joinpath(*name.parts))
            if kind == stat.S_IFLNK:
                link = source.read(info).decode("utf-8")
                link_path = pathlib.PurePosixPath(link)
                if not link or "\0" in link or link_path.is_absolute() or "\\" in link or any(":" in part for part in link_path.parts):
                    raise ValueError("ZIP symbolic link has an unsafe target")
                contained(target.parent.joinpath(*link_path.parts))
                links.append((target, link))
            elif info.is_dir() or kind == stat.S_IFDIR:
                directories.append((target, mode & 0o777 or 0o755))
            elif kind in (0, stat.S_IFREG):
                entries.append((info, target, mode & 0o777 or 0o644))
            else:
                raise ValueError("ZIP contains a non-file POSIX entry")

        # Materialize file bytes before links so ZIP order cannot route writes
        # through a link that appeared earlier in the same archive.
        for target, _ in directories:
            contained(target)
            if target.is_symlink():
                raise ValueError("ZIP directory would overwrite a symbolic link")
            target.mkdir(parents=True, exist_ok=True)
        for info, target, mode in entries:
            contained(target.parent).mkdir(parents=True, exist_ok=True)
            if target.is_symlink():
                target.unlink()
            contained(target)
            with source.open(info) as incoming, target.open("wb") as outgoing:
                shutil.copyfileobj(incoming, outgoing)
            target.chmod(mode)
        for target, link in links:
            contained(target.parent).mkdir(parents=True, exist_ok=True)
            contained(target.parent / link)
            if target.is_symlink():
                target.unlink()
            elif target.exists():
                raise ValueError("ZIP symbolic link conflicts with a regular entry")
            target.symlink_to(link)
        for target, _ in links:
            contained(target)
        for target, mode in sorted(directories, key=lambda item: len(item[0].parts), reverse=True):
            contained(target).chmod(mode)


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("Usage: unpack-zip.py ARCHIVE EXTRACTION_ROOT")
    unpack_zip(sys.argv[1], sys.argv[2])
