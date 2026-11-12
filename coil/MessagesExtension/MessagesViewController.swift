import UIKit
import UIKit.UIGestureRecognizerSubclass
import Messages

/// The iMessage app. It shows the game and moves turns in and out of the conversation:
/// a tapped message is handed to the page, and a finished turn comes back as a new message.
final class MessagesViewController: MSMessagesAppViewController, GameHostDelegate, UIGestureRecognizerDelegate {
    private lazy var host: GameHost = {
        let host = GameHost(environment: "messages")
        host.delegate = self
        return host
    }()

    private let claim = TouchClaimGesture()
    private var tamed = Set<ObjectIdentifier>()

    override func viewDidLoad() {
        super.viewDidLoad()
        host.attach(to: view)
        // Dragging a word down the board must not read as pulling the Messages sheet closed. The sheet resizes
        // with a pan recognizer (a UIDropShadowView's, driven by _UISheetInteraction); ours claims every touch
        // the moment it lands, and the sheet's has to wait for ours to fail, which it never does. The top
        // pill is outside this view, so the sheet still closes from there.
        claim.delegate = self
        host.webView.addGestureRecognizer(claim)
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        tameSheetGestures()
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        tameSheetGestures()
    }

    override func didTransition(to presentationStyle: MSMessagesAppPresentationStyle) {
        super.didTransition(to: presentationStyle)
        tameSheetGestures()
    }

    /// Makes every pan recognizer above the game wait for the touch claim. Run again after each layout and
    /// presentation change: Messages swaps the sheet's recognizer when it goes between compact and expanded.
    private func tameSheetGestures() {
        var ancestor: UIView? = view
        while let current = ancestor {
            for recognizer in current.gestureRecognizers ?? [] where recognizer !== claim && recognizer is UIPanGestureRecognizer {
                if tamed.insert(ObjectIdentifier(recognizer)).inserted {
                    recognizer.require(toFail: claim)
                }
            }
            ancestor = current.superview
        }
    }

    // MARK: - Conversation

    override func willBecomeActive(with conversation: MSConversation) {
        super.willBecomeActive(with: conversation)
        open(conversation.selectedMessage, in: conversation, live: false)
    }

    override func didSelect(_ message: MSMessage, conversation: MSConversation) {
        super.didSelect(message, conversation: conversation)
        open(message, in: conversation, live: false)
    }

    override func didReceive(_ message: MSMessage, conversation: MSConversation) {
        super.didReceive(message, conversation: conversation)
        // A turn arrived while the game is on screen. The page decides whether to show it now.
        open(message, in: conversation, live: true)
    }

    override func willTransition(to presentationStyle: MSMessagesAppPresentationStyle) {
        super.willTransition(to: presentationStyle)
        host.send(["type": "presentation", "style": name(of: presentationStyle)])
    }

    private func name(of style: MSMessagesAppPresentationStyle) -> String {
        return style == .compact ? "compact" : "expanded"
    }

    private func open(_ message: MSMessage?, in conversation: MSConversation, live: Bool) {
        #if DEBUG
        let remote = conversation.remoteParticipantIdentifiers
        Diag.write("open live=\(live) message=\(message != nil) sender=\(String(describing: message?.senderParticipantIdentifier)) local=\(conversation.localParticipantIdentifier) remote=\(remote.map { $0.uuidString }) senderIsLocal=\(message?.senderParticipantIdentifier == conversation.localParticipantIdentifier)")
        #endif
        var event: [String: Any] = ["type": "open", "style": name(of: presentationStyle), "live": live]
        if let url = message?.url,
           let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems,
           let match = items.first(where: { $0.name == "m" })?.value {
            event["match"] = match
            event["fromMe"] = message?.senderParticipantIdentifier == conversation.localParticipantIdentifier
        }
        host.send(event)
    }

    // MARK: - GameHostDelegate

    func gameHost(_ host: GameHost, didReceive type: String, body: [String: Any]) {
        switch type {
        case "expand":
            requestPresentationStyle(.expanded)
        case "send":
            insertTurn(body)
        default:
            break
        }
    }

    /// Puts the turn into the text field as a message bubble. The player sends it with the usual send arrow.
    private func insertTurn(_ body: [String: Any]) {
        guard let conversation = activeConversation else {
            host.send(["type": "sent", "ok": false])
            return
        }
        // Reusing the session makes Messages keep one bubble per duel and move it down as turns are played.
        let startsNewSession = body["newSession"] as? Bool ?? false
        let session = (startsNewSession ? nil : conversation.selectedMessage?.session) ?? MSSession()
        // "$<participant id>" is replaced by Messages with that person's contact name on each device.
        let me = "$" + conversation.localParticipantIdentifier.uuidString
        guard let message = GameHost.makeMessage(from: body, session: session, me: me) else {
            host.send(["type": "sent", "ok": false])
            return
        }

        // Inside Messages a finished turn is sent straight away, like GamePigeon. If Messages will not send it
        // for us, it goes into the text field instead and the player taps the send arrow.
        let finish: (Bool, Bool) -> Void = { [weak self] ok, inserted in
            Task { @MainActor in
                guard let self = self else { return }
                self.host.send(["type": "sent", "ok": ok, "inserted": inserted])
                if ok {
                    self.requestPresentationStyle(.compact)
                }
            }
        }
        if body["auto"] as? Bool == true {
            conversation.send(message) { error in
                if error == nil {
                    finish(true, false)
                } else {
                    conversation.insert(message) { insertError in finish(insertError == nil, true) }
                }
            }
        } else {
            conversation.insert(message) { error in finish(error == nil, true) }
        }
    }
}

extension MessagesViewController {
    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer,
                           shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool {
        return true
    }
}

/// Starts the instant a finger touches down and lasts until it lifts. It never cancels the touches, so the
/// web page still gets every one; it only makes the game, not the Messages sheet, the owner of the drag.
final class TouchClaimGesture: UIGestureRecognizer {
    override init(target: Any?, action: Selector?) {
        super.init(target: target, action: action)
        cancelsTouchesInView = false
        delaysTouchesBegan = false
        delaysTouchesEnded = false
    }

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent) {
        if state == .possible { state = .began }
    }

    override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent) {
        if state == .began || state == .changed { state = .changed }
    }

    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent) {
        state = .ended
    }

    override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent) {
        state = .cancelled
    }
}


#if DEBUG
/// Debug trace, appended to Documents/diag.log in the extension's container (pulled over USB while testing).
enum Diag {
    private static let url = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("diag.log")
    static func write(_ text: String) {
        let line = String(format: "%.3f ", Date().timeIntervalSince1970.truncatingRemainder(dividingBy: 100000)) + text + "\n"
        guard let data = line.data(using: .utf8) else { return }
        if let handle = try? FileHandle(forWritingTo: url) {
            handle.seekToEndOfFile(); handle.write(data); try? handle.close()
        } else {
            try? data.write(to: url)
        }
    }
}
#endif
