import SwiftUI

@main
struct BoseControlApp: App {
    init() {
        // 启动最早处准备持久日志
        Diag.start()
    }

    var body: some Scene {
        WindowGroup {
            ZStack {
                Color(red: 10.0 / 255, green: 10.0 / 255, blue: 10.0 / 255).ignoresSafeArea()
                WebScreen()
            }
        }
    }
}
