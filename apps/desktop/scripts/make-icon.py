#!/usr/bin/env python3
"""Draw the Aegis shield icon set with no external dependencies.

The product rule is code/SVG art only: this script rasterises the same shield
geometry used by the wordmark and the mascot into `assets/icon.png` (256px) and
`assets/tray.png` (32px) using nothing but the standard library.
"""
from __future__ import annotations

import math
import struct
import zlib
from pathlib import Path

ASSETS = Path(__file__).resolve().parent.parent / "assets"

# Shield outline in a 48x48 box, sampled from the SVG path used in the app.
OUTLINE = [
    (24, 3.5),
    (40.5, 9.8),
    (40.5, 23.2),
    (39.4, 29.0),
    (36.2, 34.2),
    (31.0, 38.8),
    (24, 44.5),
    (17.0, 38.8),
    (11.8, 34.2),
    (8.6, 29.0),
    (7.5, 23.2),
    (7.5, 9.8),
]

# AEGIS: icons follow the aegis-mark.svg brand rust, not the old
# cyan→violet gradient. Electron trays cannot load SVG, so the mark's
# silhouette is rasterised in brand colours for icon.png / tray.png.
CYAN = (186, 91, 69)
VIOLET = (214, 122, 98)


def inside_polygon(x: float, y: float, points: list[tuple[float, float]]) -> bool:
    inside = False
    j = len(points) - 1
    for i, (xi, yi) in enumerate(points):
        xj, yj = points[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def shade(size: int) -> list[list[tuple[int, int, int, int]]]:
    rows = []
    for py in range(size):
        row = []
        for px in range(size):
            # Work in the 48x48 design space.
            x = (px + 0.5) * 48 / size
            y = (py + 0.5) * 48 / size
            if not inside_polygon(x, y, OUTLINE):
                row.append((0, 0, 0, 0))
                continue
            # Diagonal cyan -> violet gradient.
            t = max(0.0, min(1.0, (x + y - 6) / 84))
            r = round(CYAN[0] + (VIOLET[0] - CYAN[0]) * t)
            g = round(CYAN[1] + (VIOLET[1] - CYAN[1]) * t)
            b = round(CYAN[2] + (VIOLET[2] - CYAN[2]) * t)
            # Aperture ring and pupil, white.
            d = math.hypot(x - 24, y - 22.5)
            if 5.2 <= d <= 7.6 or d <= 2.6:
                row.append((255, 255, 255, 255))
            else:
                row.append((r, g, b, 255))
        rows.append(row)
    return rows


def write_png(path: Path, rows: list[list[tuple[int, int, int, int]]]) -> None:
    height = len(rows)
    width = len(rows[0])
    raw = b"".join(
        b"\x00" + bytes(channel for pixel in row for channel in pixel) for row in rows
    )

    def chunk(tag: bytes, payload: bytes) -> bytes:
        return (
            struct.pack(">I", len(payload))
            + tag
            + payload
            + struct.pack(">I", zlib.crc32(tag + payload) & 0xFFFFFFFF)
        )

    header = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    path.write_bytes(
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )


def main() -> None:
    ASSETS.mkdir(parents=True, exist_ok=True)
    for name, size in (("icon.png", 256), ("tray.png", 32)):
        write_png(ASSETS / name, shade(size))
        print(f"wrote {ASSETS / name}")


if __name__ == "__main__":
    main()
