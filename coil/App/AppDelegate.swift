import UIKit
import MessageUI
import Messages

/// The home-screen app. iMessage apps ship inside a normal app; this one offers solo practice and a shortcut
/// into Messages, where the duels happen (see MessagesExtension).
@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        return true
    }

    // The UIScene lifecycle is required by current iOS SDKs; the scene itself is declared in Info.plist.
    func application(_ application: UIApplication,
                     configurationForConnecting connectingSceneSession: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let configuration = UISceneConfiguration(name: "Default", sessionRole: connectingSceneSession.role)
        configuration.delegateClass = SceneDelegate.self
        return configuration
    }
}

final class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }
        let window = UIWindow(windowScene: windowScene)
        window.rootViewController = GameViewController()
        window.makeKeyAndVisible()
        self.window = window
    }
}

final class GameViewController: UIViewController, GameHostDelegate, MFMessageComposeViewControllerDelegate {
    private let host = GameHost(environment: "app")

    override func viewDidLoad() {
        super.viewDidLoad()
        host.delegate = self
        // -anchored lets the Messages sheet's scroll-view trick be tried in the app, where it can be driven from a simulator.
        host.attach(to: view, fullBleed: true, anchored: ProcessInfo.processInfo.arguments.contains("-anchored"))
        host.send(["type": "open", "style": "expanded"])
    }

    override var preferredStatusBarStyle: UIStatusBarStyle {
        return traitCollection.userInterfaceStyle == .dark ? .lightContent : .darkContent
    }

    func gameHost(_ host: GameHost, didReceive type: String, body: [String: Any]) {
        switch type {
        case "openMessages":
            if let url = URL(string: "sms:") { UIApplication.shared.open(url) }
        case "send":
            presentCompose(for: body)
        default:
            break
        }
    }

    /// A solved board is sent from here: Messages' own compose sheet opens with the challenge already in it,
    /// and the player picks who it goes to there. (Inside Messages the extension puts it in the text field instead.)
    private func presentCompose(for body: [String: Any]) {
        guard MFMessageComposeViewController.canSendText(),
              let message = GameHost.makeMessage(from: body, session: MSSession(), me: "") else {
            host.send(["type": "sent", "ok": false, "reason": "unavailable"])
            return
        }
        let compose = MFMessageComposeViewController()
        compose.message = message
        compose.messageComposeDelegate = self
        present(compose, animated: true)
    }

    func messageComposeViewController(_ controller: MFMessageComposeViewController,
                                      didFinishWith result: MessageComposeResult) {
        controller.dismiss(animated: true)
        switch result {
        case .sent:
            host.send(["type": "sent", "ok": true])
        case .cancelled:
            host.send(["type": "sent", "ok": false, "cancelled": true])
        default:
            host.send(["type": "sent", "ok": false])
        }
    }
}
