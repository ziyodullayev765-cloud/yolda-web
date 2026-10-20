"""Belgidan ilovaning barcha ikonkalarini yasaydi.

    python3 tools/makeIcons.py <belgi.png> icons

Kiruvchi — shaffof fonli belgi (kvadratga yaqin, 512px dan
kichik bo'lmasin). Chiquvchilar `icons/` papkasiga yoziladi va
ilova o'shalarni ishlatadi: brauzer yorlig'i, telefon ekranidagi
ikonka, ilova ichidagi belgi.

Belgi almashsa — shu buyruq qayta ishga tushiriladi, qo'lda
hech narsa kesilmaydi.

IKKI JOYDA FON OQ. Qolgan hamma joyda belgi shaffof fonda
turadi, lekin:

  apple-touch-icon — iOS shaffoflikni bilmaydi: bo'sh joyni
    QORA qilib to'ldiradi va belgining to'q ko'k yoni qora
    ustida yo'qoladi;
  maskable — Android bu rasmni o'z shakliga (doira, kvadrat...)
    qirqadi, ya'ni chetlari kesiladi. Shuning uchun belgi
    kichraytirilib o'rtaga qo'yiladi va orqasi to'ldiriladi.

Oq rang o'ylab topilgani yo'q — belgining o'z taglgi shu rangda
edi.
"""
import sys
from PIL import Image

SRC = sys.argv[1]
OUT = sys.argv[2].rstrip('/')

mark = Image.open(SRC).convert('RGBA')


def square(size, pad=0.06, bg=None):
    """Belgi kvadrat maydonning o'rtasida, chetida bir oz bo'shliq."""
    canvas = Image.new('RGBA', (size, size), bg or (0, 0, 0, 0))
    inner = int(size * (1 - pad * 2))
    w, h = mark.size
    k = min(inner / w, inner / h)
    small = mark.resize((max(1, round(w * k)), max(1, round(h * k))), Image.LANCZOS)
    canvas.alpha_composite(small, ((size - small.width) // 2, (size - small.height) // 2))
    return canvas


# Ranglar soni cheklanadi: belgi gradientli, to'liq rangda 512px
# li nusxa 205 KB chiqadi. 256 rangda esa 33 KB — ekranda esa u
# 28 dan 120 pikselgacha ko'rinadi, ya'ni farqi bilinmaydi.
COLORS = 256

jobs = [
    ('logo.png', 512, 0.02, None),
    ('icon-192.png', 192, 0.06, None),
    ('icon-512.png', 512, 0.06, None),
    ('favicon-32.png', 32, 0.02, None),
    # iOS: shaffoflik yo'q.
    ('apple-touch-icon.png', 180, 0.08, (255, 255, 255, 255)),
    # Android chetini kesadi: belgi kichikroq, o'rtada.
    ('icon-maskable-512.png', 512, 0.20, (255, 255, 255, 255)),
]

for name, size, pad, bg in jobs:
    img = square(size, pad, bg)
    if bg:
        img = img.convert('RGB')
    img = img.quantize(colors=COLORS, method=Image.FASTOCTREE)
    img.save(f'{OUT}/{name}', optimize=True)
    print(name, size, 'fon:', 'oq' if bg else 'shaffof')
