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

# Home-screen app: a single 1024 icon (Xcode 14+ makes the other sizes).
app = os.path.join(root, 'App', 'Assets.xcassets')
write(app, 'Contents.json', {'info': info})
write(os.path.join(app, 'AppIcon.appiconset'), 'Contents.json',
      {'images': [{'filename': 'icon-1024.png', 'idiom': 'universal', 'platform': 'ios', 'size': '1024x1024'}], 'info': info})
square.save(os.path.join(app, 'AppIcon.appiconset', 'icon-1024.png'))

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
