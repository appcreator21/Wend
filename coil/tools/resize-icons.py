"""Builds the asset catalogs from the two master renders made by make-icons.js (no alpha channel, as the App Store requires)."""
import json, os
from PIL import Image

here = os.path.dirname(os.path.abspath(__file__))
root = os.path.dirname(here)
def load(name, size):
    # The WebKit render comes out at 2x on a retina Mac; bring it to the exact master size.
    im = Image.open(os.path.join(here, name)).convert('RGB')
    return im if im.size == size else im.resize(size, Image.LANCZOS)

square = load('icon-1024.png', (1024, 1024))
wide = load('icon-1024x768.png', (1024, 768))

def write(folder, name, obj):
    os.makedirs(folder, exist_ok=True)
    with open(os.path.join(folder, name), 'w') as f:
        json.dump(obj, f, indent=2)
        f.write('\n')

info = {'author': 'xcode', 'version': 1}

# Home-screen app: one 1024 icon per appearance (Xcode makes the other sizes). Dark and tinted are what iOS 18+
# shows in dark mode and when the user picks a tinted or clear home screen; the tinted one is plain grey.
app = os.path.join(root, 'App', 'Assets.xcassets')
write(app, 'Contents.json', {'info': info})
icon_dir = os.path.join(app, 'AppIcon.appiconset')
write(icon_dir, 'Contents.json', {'images': [
    {'filename': 'icon-1024.png', 'idiom': 'universal', 'platform': 'ios', 'size': '1024x1024'},
    {'appearances': [{'appearance': 'luminosity', 'value': 'dark'}], 'filename': 'icon-1024-dark.png', 'idiom': 'universal', 'platform': 'ios', 'size': '1024x1024'},
    {'appearances': [{'appearance': 'luminosity', 'value': 'tinted'}], 'filename': 'icon-1024-tinted.png', 'idiom': 'universal', 'platform': 'ios', 'size': '1024x1024'},
], 'info': info})
square.save(os.path.join(icon_dir, 'icon-1024.png'))
load('icon-1024-dark.png', (1024, 1024)).save(os.path.join(icon_dir, 'icon-1024-dark.png'))
load('icon-1024-tinted.png', (1024, 1024)).convert('L').convert('RGB').save(os.path.join(icon_dir, 'icon-1024-tinted.png'))

# iMessage extension: the icon set Messages uses in the apps row and in Settings.
ext = os.path.join(root, 'MessagesExtension', 'Assets.xcassets')
write(ext, 'Contents.json', {'info': info})
entries = [  # idiom, width, height, scales, platform
    ('iphone', 29, 29, (2, 3), None), ('iphone', 60, 45, (2, 3), None),
    ('ipad', 29, 29, (2,), None), ('ipad', 67, 50, (2,), None), ('ipad', 74, 55, (2,), None),
    ('ios-marketing', 1024, 1024, (1,), None),
    ('universal', 27, 20, (2, 3), 'ios'), ('universal', 32, 24, (2, 3), 'ios'),
    ('ios-marketing', 1024, 768, (1,), 'ios'),
]
images, done = [], set()
folder = os.path.join(ext, 'iMessage App Icon.stickersiconset')
os.makedirs(folder, exist_ok=True)
for idiom, w, h, scales, platform in entries:
    for scale in scales:
        name = 'icon-%dx%d@%dx.png' % (w, h, scale)
        if name not in done:
            (square if w == h else wide).resize((w * scale, h * scale), Image.LANCZOS).save(os.path.join(folder, name))
            done.add(name)
        item = {'filename': name, 'idiom': idiom, 'scale': '%dx' % scale, 'size': '%dx%d' % (w, h)}
        if platform:
            item['platform'] = platform
        images.append(item)
write(folder, 'Contents.json', {'images': images, 'info': info})
print('wrote', len(done) + 1, 'icons')

# The web game's apple-touch icons (Add to Home Screen on iOS) use the snake mascot, at the three sizes iOS asks for.
mascot = load('snake-1024.png', (1024, 1024))
web_icons = os.path.join(os.path.dirname(root), 'icons')
for size, name in ((180, 'apple-touch-icon.png'), (167, 'apple-touch-icon-167.png'), (152, 'apple-touch-icon-152.png')):
    mascot.resize((size, size), Image.LANCZOS).save(os.path.join(web_icons, name))
print('wrote 3 apple-touch icons')

# The app's own logo spots (Web/coil.css): the snake alone where the yellow spiral used to be, the full icon on
# the home screen, and the crown and X that go over the finished board in the end-of-duel message (tools/result-art). Embedded as data URIs so no new files have to be added to the Xcode project.
import base64, io, re
def data_uri(image):
    buf = io.BytesIO(); image.save(buf, 'PNG', optimize=True)
    return 'data:image/png;base64,' + base64.b64encode(buf.getvalue()).decode()
snake = Image.open(os.path.join(here, 'snake-mark.png')).convert('RGBA')
snake = snake.crop(snake.getbbox())
side = max(snake.size)
square_mark = Image.new('RGBA', (side, side), (0, 0, 0, 0))
square_mark.paste(snake, ((side - snake.size[0]) // 2, (side - snake.size[1]) // 2))
mark = data_uri(square_mark.resize((360, 360), Image.LANCZOS))
hero = data_uri(mascot.resize((300, 300), Image.LANCZOS))
css_path = os.path.join(root, 'Web', 'coil.css')
css = open(css_path).read()
crown = data_uri(Image.open(os.path.join(here, 'result-art', 'crown.png')).convert('RGBA'))
cross = data_uri(Image.open(os.path.join(here, 'result-art', 'cross.png')).convert('RGBA'))
block = '/* logo:start (written by tools/resize-icons.py) */\n:root { --mark: url(%s); --hero-logo: url(%s); --crown: url(%s); --cross: url(%s); }\n/* logo:end */' % (mark, hero, crown, cross)
css = re.sub(r'/\* logo:start.*?logo:end \*/', lambda _: block, css, flags=re.S) if 'logo:start' in css else block + '\n' + css
open(css_path, 'w').write(css)
print('embedded logo images in coil.css')
