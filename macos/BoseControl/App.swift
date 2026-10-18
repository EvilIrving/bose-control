import SwiftUI

@main
struct BoseControlApp: App {
    var body: some Scene {
        Window("耳机", id: "main") {
            WebScreen()
                .frame(minWidth: 380, minHeight: 560)
        }
        .defaultSize(width: 420, height: 780)
        .windowResizability(.automatic)
    }
}
