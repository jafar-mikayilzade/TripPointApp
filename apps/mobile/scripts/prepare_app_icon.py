"""Crop white margins from source art and emit Play/Expo-ready icon assets."""

from __future__ import annotations

import os

from PIL import Image

SRC = r"C:\Users\user\.cursor\projects\c-Users-user-TripPointApp-apps-mobile\assets\c__Users_user_AppData_Roaming_Cursor_User_workspaceStorage_90df5f97984de6c8f63af28cb7b2de10_images_Gemini_Generated_Image_cqsgjvcqsgjvcqsg-92461645-4ed2-4bf4-8a4e-4b83f91a99fe.png"
OUT = r"c:\Users\user\TripPointApp\apps\mobile\assets"
FOREST = (13, 44, 36)  # #0D2C24 — matches adaptiveIcon.backgroundColor
WHITE_T = 235


def main() -> None:
    im = Image.open(SRC).convert("RGBA")
    px = im.load()
    assert px is not None
    w, h = im.size

    minx, miny, maxx, maxy = w, h, 0, 0
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a < 8:
                continue
            if r >= WHITE_T and g >= WHITE_T and b >= WHITE_T:
                continue
            minx = min(minx, x)
            miny = min(miny, y)
            maxx = max(maxx, x)
            maxy = max(maxy, y)

    pad = 2
    minx = max(0, minx - pad)
    miny = max(0, miny - pad)
    maxx = min(w - 1, maxx + pad)
    maxy = min(h - 1, maxy + pad)
    cropped = im.crop((minx, miny, maxx + 1, maxy + 1))
    print("bbox", minx, miny, maxx, maxy, "cropped", cropped.size)

    cpx = cropped.load()
    assert cpx is not None
    cw, ch = cropped.size
    for y in range(ch):
        for x in range(cw):
            r, g, b, a = cpx[x, y]
            if r >= WHITE_T and g >= WHITE_T and b >= WHITE_T:
                cpx[x, y] = (r, g, b, 0)

    samples: list[tuple[int, int, int]] = []
    for y in range(ch // 4, ch // 2):
        for x in range(cw // 4, 3 * cw // 4):
            r, g, b, a = cpx[x, y]
            if a > 200 and g > r and g > b and g < 130:
                samples.append((r, g, b))
    fill = FOREST
    if samples:
        samples.sort(key=lambda t: t[1])
        fill = samples[len(samples) // 2]
    print("fill", fill)

    def make_full_bleed(size: int = 1024) -> Image.Image:
        """Master / Play listing: full-bleed, no white margins (masks clip corners)."""
        canvas = Image.new("RGBA", (size, size), (*fill, 255))
        scale = max(size / cw, size / ch) * 1.03
        nw, nh = int(cw * scale), int(ch * scale)
        art = cropped.resize((nw, nh), Image.Resampling.LANCZOS)
        ox = (size - nw) // 2
        oy = (size - nh) // 2
        canvas.alpha_composite(art, (ox, oy))
        bg = Image.new("RGB", (size, size), fill)
        bg.paste(canvas, mask=canvas.split()[3])
        # Kill residual light fringe in outer ring (Play listing / launcher masks)
        px = bg.load()
        assert px is not None
        band = 10
        for y in range(size):
            for x in range(size):
                if x >= band and x < size - band and y >= band and y < size - band:
                    continue
                r, g, b = px[x, y]
                if r > 200 and g > 200 and b > 200:
                    px[x, y] = fill
                elif r > 180 and g > 180 and b > 170 and abs(r - g) < 25 and abs(g - b) < 25:
                    px[x, y] = fill
        return bg

    def make_adaptive_foreground(size: int = 1024, safe: float = 0.74) -> Image.Image:
        """Foreground layer: key art inside ~66–74% safe zone for circle/squircle masks."""
        canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        target = int(size * safe)
        scale = min(target / cw, target / ch)
        nw, nh = int(cw * scale), int(ch * scale)
        art = cropped.resize((nw, nh), Image.Resampling.LANCZOS)
        ox = (size - nw) // 2
        oy = (size - nh) // 2
        canvas.alpha_composite(art, (ox, oy))
        return canvas

    def make_adaptive_background(size: int = 1024) -> Image.Image:
        return Image.new("RGB", (size, size), fill)

    def make_monochrome(size: int = 1024) -> Image.Image:
        fg = make_adaptive_foreground(size, safe=0.70)
        alpha = fg.split()[3].point(lambda p: 255 if p > 40 else 0)
        out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        white = Image.new("RGBA", (size, size), (255, 255, 255, 255))
        out.paste(white, mask=alpha)
        return out

    icon = make_full_bleed(1024)
    fg = make_adaptive_foreground(1024, safe=0.74)
    bg = make_adaptive_background(1024)
    mono = make_monochrome(1024)
    favicon = icon.resize((48, 48), Image.Resampling.LANCZOS)
    splash = make_adaptive_foreground(512, safe=0.85)

    paths = {
        "icon.png": icon,
        "android-icon-foreground.png": fg,
        "android-icon-background.png": bg,
        "android-icon-monochrome.png": mono,
        "favicon.png": favicon,
        "splash-icon.png": splash,
    }
    for name, img in paths.items():
        path = os.path.join(OUT, name)
        img.save(path, "PNG", optimize=True)
        print("wrote", name, img.size, img.mode, os.path.getsize(path))

    ic = Image.open(os.path.join(OUT, "icon.png")).convert("RGB")
    for xy in [(0, 0), (1023, 0), (0, 1023), (1023, 1023), (512, 40)]:
        print("icon", xy, ic.getpixel(xy))


if __name__ == "__main__":
    main()
