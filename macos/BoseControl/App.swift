import SwiftUI

@main
struct BoseControlApp: App {
    var body: some Scene {
        Window("耳机", id: "wide") {
            WebScreen()
                .frame(minWidth: 900, minHeight: 720)
        }
        .defaultSize(width: 980, height: 900)
        .windowResizability(.automatic)
    }
}
