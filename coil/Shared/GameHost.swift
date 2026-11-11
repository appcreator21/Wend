import UIKit
import WebKit
import Messages

/// Hosts the game page (Web/index.html and friends, bundled flat into the target's resources) in a web view
/// and passes small JSON events between Swift and the page. All game rules live in Web/coil.js.
///
///   page -> Swift : window.webkit.messageHandlers.host.postMessage({ type: ... })
///   Swift -> page : Host.receive({ type: ... })
@MainActor
protocol GameHostDelegate: AnyObject {
    func gameHost(_ host: GameHost, didReceive type: String, body: [String: Any])
}

@MainActor
final class GameHost: NSObject, WKScriptMessageHandler {
    /// Matches --bg in coil.css, so there is no flash before the page paints and light/dark follow the system.
    static let background = UIColor { traits in
        traits.userInterfaceStyle == .dark
            ? UIColor(red: 8 / 255, green: 8 / 255, blue: 13 / 255, alpha: 1)
            : UIColor(red: 242 / 255, green: 242 / 255, blue: 247 / 255, alpha: 1)
    }

    let webView: WKWebView
    weak var delegate: GameHostDelegate?

    private var pageReady = false
    private var queued: [[String: Any]] = []
    private lazy var selection = UISelectionFeedbackGenerator()
    private lazy var light = UIImpactFeedbackGenerator(style: .light)
    private lazy var medium = UIImpactFeedbackGenerator(style: .medium)
    private lazy var notify = UINotificationFeedbackGenerator()

    /// - Parameter environment: "messages" inside the iMessage extension, "app" in the home-screen app.
    init(environment: String) {
        let configuration = WKWebViewConfiguration()
        configuration.setURLSchemeHandler(BundleSchemeHandler(), forURLScheme: BundleSchemeHandler.scheme)
        configuration.allowsInlineMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = []
        webView = WKWebView(frame: .zero, configuration: configuration)
        super.init()

        configuration.userContentController.add(WeakScriptMessageHandler(self), name: "host")
        webView.isOpaque = false
        webView.backgroundColor = GameHost.background
        webView.scrollView.backgroundColor = GameHost.background
        webView.scrollView.isScrollEnabled = false
        webView.scrollView.bounces = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.allowsLinkPreview = false

        if let url = URL(string: "\(BundleSchemeHandler.scheme)://game/index.html?env=\(environment)") {
            webView.load(URLRequest(url: url))
        }
    }

    /// Fills `view` with the game: the safe area inside Messages, edge to edge in the app (the page pads for the notch itself).
    func attach(to view: UIView, fullBleed: Bool = false) {
        view.backgroundColor = GameHost.background
        webView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(webView)
        if fullBleed {
            NSLayoutConstraint.activate([
                webView.topAnchor.constraint(equalTo: view.topAnchor),
                webView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
                webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
                webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            ])
            return
        }
        let guide = view.safeAreaLayoutGuide
        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: guide.topAnchor),
            webView.bottomAnchor.constraint(equalTo: guide.bottomAnchor),
            webView.leadingAnchor.constraint(equalTo: guide.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: guide.trailingAnchor),
        ])
    }

    /// Delivers an event to the page, or holds it until the page has loaded.
    func send(_ event: [String: Any]) {
        guard pageReady else {
            queued.append(event)
            return
        }
        guard let data = try? JSONSerialization.data(withJSONObject: event),
              let json = String(data: data, encoding: .utf8) else { return }
        webView.evaluateJavaScript("window.Host && Host.receive(\(json));", completionHandler: nil)
    }

    /// Maps the page's feedback kinds onto the system generators. Selection is the light click per tile.
    private func haptic(_ kind: String?) {
        switch kind {
        case "success": notify.notificationOccurred(.success)
        case "error": notify.notificationOccurred(.error)
        case "warning": notify.notificationOccurred(.warning)
        case "select": selection.selectionChanged(); selection.prepare()
        case "medium": medium.impactOccurred()
        default: light.impactOccurred(); light.prepare()
        }
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
        switch type {
        case "ready":
            pageReady = true
            let waiting = queued
            queued = []
            waiting.forEach(send)
        case "haptic":
            haptic(body["kind"] as? String)
        default:
            delegate?.gameHost(self, didReceive: type, body: body)
        }
    }
}

/// WKUserContentController keeps a strong reference to its handlers; this breaks the retain cycle.
private final class WeakScriptMessageHandler: NSObject, WKScriptMessageHandler {
    private weak var target: WKScriptMessageHandler?

    init(_ target: WKScriptMessageHandler) {
        self.target = target
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(userContentController, didReceive: message)
    }
}

/// Serves the bundled game files at coil://game/<file>, which gives the page a real origin
/// (so localStorage works) without any network access.
private final class BundleSchemeHandler: NSObject, WKURLSchemeHandler {
    static let scheme = "coil"

    private static let mimeTypes = [
        "html": "text/html; charset=utf-8",
        "js": "text/javascript; charset=utf-8",
        "css": "text/css; charset=utf-8",
        "png": "image/png",
    ]

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let url = urlSchemeTask.request.url else {
            urlSchemeTask.didFailWithError(URLError(.badURL))
            return
        }
        let name = url.lastPathComponent.isEmpty || url.lastPathComponent == "/" ? "index.html" : url.lastPathComponent
        guard let fileURL = Bundle.main.url(forResource: name, withExtension: nil),
              let data = try? Data(contentsOf: fileURL) else {
            urlSchemeTask.didFailWithError(URLError(.fileDoesNotExist))
            return
        }
        let mime = BundleSchemeHandler.mimeTypes[fileURL.pathExtension.lowercased()] ?? "application/octet-stream"
        let headers = ["Content-Type": mime, "Content-Length": String(data.count), "Cache-Control": "no-cache"]
        let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: headers)
            ?? URLResponse(url: url, mimeType: nil, expectedContentLength: data.count, textEncodingName: nil)
        urlSchemeTask.didReceive(response)
        urlSchemeTask.didReceive(data)
        urlSchemeTask.didFinish()
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {}
}

// MARK: - Turn messages

extension GameHost {
    /// Where a message leads when it is opened somewhere the app is not installed (a Mac, for example).
    /// The turn itself travels in the "m" query item.
    static let messageBaseURL = "https://wend-92k.pages.dev/"

    /// Builds the message bubble for a turn the page wants to send. `me` stands in for the sender's name:
    /// Messages replaces "$<participant id>" with the contact name on each device (the app has no id, so it passes "").
    static func makeMessage(from body: [String: Any], session: MSSession, me: String) -> MSMessage? {
        guard let match = body["match"] as? String,
              var components = URLComponents(string: messageBaseURL) else { return nil }
        components.queryItems = [URLQueryItem(name: "m", value: match)]

        let message = MSMessage(session: session)
        message.url = components.url
        message.summaryText = body["summary"] as? String

        func text(_ key: String) -> String? {
            return (body[key] as? String)?.replacingOccurrences(of: "{me}", with: me).trimmingCharacters(in: .whitespaces)
        }
        let layout = MSMessageTemplateLayout()
        layout.caption = text("caption")
        layout.subcaption = text("subcaption")
        if let dataURL = body["image"] as? String,
           let comma = dataURL.firstIndex(of: ","),
           let data = Data(base64Encoded: String(dataURL[dataURL.index(after: comma)...])) {
            layout.image = UIImage(data: data)
        }
        message.layout = layout
        return message
    }
}
