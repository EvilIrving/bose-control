import SwiftUI

@main
struct BoseControlApp: App {
    init() {
        // 启动最早处就把持久日志准备好，页面还没起来也要有记录
        Diag.start()
    }

    var body: some Scene {
        Window("Bose Connector", id: "wide") {
            // 窗口最小尺寸必须放得进系统分屏的格子，否则拖到边缘只会铺满高度、宽度顶回去：
            // 1512pt 屏的 1/3 格是 504，上下半屏约 470，所以 490×440
            WebScreen()
                .frame(minWidth: 490, minHeight: 440)
        }
        .defaultSize(width: 980, height: 900)
        .windowResizability(.automatic)
    }
}
