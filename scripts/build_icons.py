"""Render PNG app icons from the SVG design.

Run: python scripts/build_icons.py

The SVG in public/icons/ is the source of truth. PNGs are generated outputs
referenced by manifest.webmanifest. Re-run this when the SVG changes.
"""

from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public" / "icons"

BG = (10, 10, 12)
SURFACE = (19, 19, 22)
ACCENT = (255, 107, 53)


def _mix(rgb, bg, alpha):
    return tuple(round(alpha * c + (1 - alpha) * b) for c, b in zip(rgb, bg))


def _draw_logo(draw: ImageDraw.ImageDraw, scale: float, ox: float = 0.0, oy: float = 0.0):
    def s(v):
        return v * scale

    body = (ox + s(32), oy + s(22), ox + s(32 + 36), oy + s(22 + 56))
    draw.rounded_rectangle(
        body,
        radius=s(7),
        fill=SURFACE,
        outline=ACCENT,
        width=max(1, round(s(1.5))),
    )

    cx, cy, r = ox + s(50), oy + s(50), s(8)
    draw.ellipse((cx - r, cy - r, cx + r, cy + r), fill=ACCENT)

    bar = (ox + s(40), oy + s(64), ox + s(40 + 20), oy + s(64 + 3))
    draw.rounded_rectangle(bar, radius=s(1.5), fill=_mix(ACCENT, BG, 0.6))


def render_any(size: int, path: Path):
    img = Image.new("RGB", (size, size), BG)
    draw = ImageDraw.Draw(img)
    _draw_logo(draw, scale=size / 100.0)
    img.save(path, "PNG", optimize=True)
    print(f"  wrote {path.relative_to(ROOT)} {size}x{size}")


def render_maskable(size: int, path: Path):
    img = Image.new("RGB", (size, size), BG)
    draw = ImageDraw.Draw(img)
    inner_scale = 0.6
    inner = size * inner_scale
    offset = (size - inner) / 2
    _draw_logo(draw, scale=inner / 100.0, ox=offset, oy=offset)
    img.save(path, "PNG", optimize=True)
    print(f"  wrote {path.relative_to(ROOT)} {size}x{size} (maskable)")


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    render_any(192, OUT / "icon-192.png")
    render_any(512, OUT / "icon-512.png")
    render_maskable(192, OUT / "maskable-192.png")
    render_maskable(512, OUT / "maskable-512.png")


if __name__ == "__main__":
    main()
