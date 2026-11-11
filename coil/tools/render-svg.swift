// Renders an SVG file to an opaque PNG with WebKit: swift render-svg.swift in.svg out.png width height
import AppKit
import WebKit

let args = CommandLine.arguments
guard args.count == 5, let w = Int(args[3]), let h = Int(args[4]) else { print("usage: render-svg in.svg out.png w h"); exit(2) }
let svg = try String(contentsOfFile: args[1], encoding: .utf8)

final class Renderer: NSObject, WKNavigationDelegate {
    let w: Int, h: Int, svg: String, out: String
    let view: WKWebView
    init(w: Int, h: Int, svg: String, out: String) {
        self.w = w; self.h = h; self.svg = svg; self.out = out
        view = WKWebView(frame: NSRect(x: 0, y: 0, width: w, height: h))
    }
    func start() {
        view.navigationDelegate = self
        view.setValue(false, forKey: "drawsBackground")
        view.loadHTMLString("<html><body style='margin:0;background:#000'>\(svg)</body></html>", baseURL: nil)
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [self] in
            let cfg = WKSnapshotConfiguration()
            cfg.rect = NSRect(x: 0, y: 0, width: w, height: h)
            cfg.snapshotWidth = NSNumber(value: w)
            webView.takeSnapshot(with: cfg) { image, error in
                guard let image = image, let tiff = image.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff),
                      let png = rep.representation(using: .png, properties: [:]) else { print("snapshot failed: \(String(describing: error))"); exit(1) }
                try? png.write(to: URL(fileURLWithPath: out))
                print("wrote \(out) \(rep.pixelsWide)x\(rep.pixelsHigh)")
                exit(0)
            }
        }
    }
}
let app = NSApplication.shared
app.setActivationPolicy(.prohibited)
let renderer = Renderer(w: w, h: h, svg: svg, out: args[2])
renderer.start()
app.run()
