// StoreKit 2 买断（非消耗型）。只在商店版 App 里编译进来。
//
// 设计取舍，写在这里省得后面反复问：
//
// 1. **买断，不是订阅。** 这个 App 的价值全在本机，没有服务器成本，
//    也没有理由定期联网校验。非消耗型一次购买永久有效，跟「不联网」的定位一致。
//
// 2. **不锁功能，只做提醒。** 免费版完整可用。¥1 是「支持开发」，不是解锁。
//    理由：这类开源替代品的用户对功能阉割极度敏感，锁掉任何一项都会把他们
//    直接推回 GitHub 页下免费版——那对开发者的收入是负的。
//    所以付费墙只出现在「连接耳机」这一处，且可以跳过。
//
// 3. **直装版不收钱，也不显示任何购买入口。** GitHub Release 的 dmg/apk 是免费的，
//    在直装版里放「立即购买」只会让人困惑。是否商店版由编译期标志决定
//    （见 AppStore 配置），不是运行时判断。
//
// 4. **离线优先。** 用 StoreKit 2 的 `Transaction.currentEntitlements` 本地校验，
//    不依赖自己的服务器。Apple 的签名在设备上离线可验。

import Foundation
import StoreKit

enum Purchase {
    /// 产品 ID。App Store Connect 里的「非消耗型」内购，名称「支持开发」。
    static let productId = "cain.com.bosecontrol.support"

    /// 购买入口是否出现。直装版编译时走不到这个分支。
    static var showsStorefront: Bool {
        #if APPSTORE
        return true
        #else
        return false
        #endif
    }

    /// 当前是否已购买。离线可查：`Transaction.currentEntitlements` 读的是设备上的签名收据。
    static func isPurchased() async -> Bool {
        guard showsStorefront else { return true }
        for await result in Transaction.currentEntitlements {
            guard case .verified(let transaction) = result else { continue }
            if transaction.productID == productId && transaction.revocationDate == nil {
                return true
            }
        }
        return false
    }

    /// 发起购买。返回值是给页面看的字符串状态，不是错误类型：
    /// 页面只关心「买成了 / 用户取消 / 失败」，把 Error 直接塞过去会让
    /// JS 侧要懂 Swift 的错误类型。
    static func purchase() async -> String {
        guard showsStorefront else { return "unsupported" }
        do {
            let products = try await Product.products(for: [productId])
            guard let product = products.first else { return "missing" }
            switch try await product.purchase() {
            case .success(let verification):
                guard case .verified(let transaction) = verification else { return "unverified" }
                await transaction.finish()
                return "purchased"
            case .userCancelled:
                return "cancelled"
            case .pending:
                return "pending"
            @unknown default:
                return "unknown"
            }
        } catch {
            return "failed: \(error.localizedDescription)"
        }
    }

    /// 恢复购买。换机、重装后用户点这个，Apple 会重放已购交易。
    static func restore() async -> Bool {
        guard showsStorefront else { return true }
        do {
            try await AppStore.sync()
        } catch {
            return false
        }
        return await isPurchased()
    }
}
