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

    override func viewDidLoad() {
        super.viewDidLoad()
        host.attach(to: view, anchored: true)
        // Dragging a word down the board must not read as pulling the sheet closed: claim every touch the
        // moment it lands, so the game owns the drag. The sheet is still closed from its top bar.
        let claim = TouchClaimGesture()
        claim.delegate = self
        host.webView.addGestureRecognizer(claim)
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

        conversation.insert(message) { [weak self] error in
            let ok = error == nil
            Task { @MainActor in
                guard let self = self else { return }
                self.host.send(["type": "sent", "ok": ok])
                if ok {
                    self.requestPresentationStyle(.compact)
                }
            }
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
