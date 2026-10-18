import SwiftUI

@main
struct BoseControlApp: App {
    var body: some Scene {
        WindowGroup {
            ZStack {
                Color(red: 11.0 / 255, green: 11.0 / 255, blue: 11.0 / 255).ignoresSafeArea()
                WebScreen()
            }
        }
    }
}
