import UIKit

/// The home-screen app. iMessage apps ship inside a normal app; this one lets you practice solo.
/// Duels happen in Messages (see MessagesExtension).
@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?

    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        let window = UIWindow(frame: UIScreen.main.bounds)
        window.rootViewController = GameViewController()
        window.makeKeyAndVisible()
        self.window = window
        return true
    }
}

final class GameViewController: UIViewController {
    private let host = GameHost(environment: "app")

    override func viewDidLoad() {
        super.viewDidLoad()
        host.attach(to: view)
        host.send(["type": "open", "style": "expanded"])
    }

    override var preferredStatusBarStyle: UIStatusBarStyle {
        return .lightContent
    }
}
