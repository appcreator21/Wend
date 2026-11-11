import UIKit

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

final class GameViewController: UIViewController, GameHostDelegate {
    private let host = GameHost(environment: "app")

    override func viewDidLoad() {
        super.viewDidLoad()
        host.delegate = self
        host.attach(to: view, fullBleed: true)
        host.send(["type": "open", "style": "expanded"])
    }

    override var preferredStatusBarStyle: UIStatusBarStyle {
        return traitCollection.userInterfaceStyle == .dark ? .lightContent : .darkContent
    }

    func gameHost(_ host: GameHost, didReceive type: String, body: [String: Any]) {
        if type == "openMessages", let url = URL(string: "sms:") {
            UIApplication.shared.open(url)
        }
    }
}
