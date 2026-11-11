import UIKit
import Messages

/// The iMessage app. It shows the game and moves turns in and out of the conversation:
/// a tapped message is handed to the page, and a finished turn comes back as a new message.
final class MessagesViewController: MSMessagesAppViewController, GameHostDelegate {
    /// Where a message leads when it is opened somewhere the app is not installed (a Mac, for example).
    /// The turn itself travels in the "m" query item.
    private static let messageBaseURL = "https://wend-92k.pages.dev/"

    private lazy var host: GameHost = {
        let host = GameHost(environment: "messages")
        host.delegate = self
        return host
    }()

    override func viewDidLoad() {
        super.viewDidLoad()
        host.attach(to: view)
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
        guard let conversation = activeConversation,
              let match = body["match"] as? String,
              var components = URLComponents(string: MessagesViewController.messageBaseURL) else {
            host.send(["type": "sent", "ok": false])
            return
        }
        components.queryItems = [URLQueryItem(name: "m", value: match)]

        // Reusing the session makes Messages keep one bubble per duel and move it down as turns are played.
        let startsNewSession = body["newSession"] as? Bool ?? false
        let session = (startsNewSession ? nil : conversation.selectedMessage?.session) ?? MSSession()
        let message = MSMessage(session: session)
        message.url = components.url
        message.summaryText = body["summary"] as? String

        // "$<participant id>" is replaced by Messages with that person's contact name on each device.
        let me = "$" + conversation.localParticipantIdentifier.uuidString
        let layout = MSMessageTemplateLayout()
        layout.caption = (body["caption"] as? String)?.replacingOccurrences(of: "{me}", with: me)
        layout.subcaption = (body["subcaption"] as? String)?.replacingOccurrences(of: "{me}", with: me)
        if let dataURL = body["image"] as? String,
           let comma = dataURL.firstIndex(of: ","),
           let data = Data(base64Encoded: String(dataURL[dataURL.index(after: comma)...])) {
            layout.image = UIImage(data: data)
        }
        message.layout = layout

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
