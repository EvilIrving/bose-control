import SwiftUI

@main
struct BoseControlApp: App {
    var body: some Scene {
        WindowGroup {
            ZStack {
                Color.black.ignoresSafeArea()
                WebScreen()
            }
        }
    }
}
