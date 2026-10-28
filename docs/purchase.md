# 内购：买断 ¥1

截至 2026-10-28。这里只写会影响上架和审核的东西。

## 定价形态

**非消耗型内购（买断），¥1，一次购买永久有效。**

不做订阅。理由写在这里，以后不要再讨论一遍：这个 App 的全部价值在本机，没有服务器成本，也没有需要持续维护的云端服务。订阅会强制定期联网校验，跟「不登录、不联网、数据不出本机」这个立身之本正面冲突。买断没有这个问题。

## 免费版完整可用

**不锁任何功能。** ¥1 是「支持开发」，不是「解锁」。

这不是仁慈，是判断：这类开源替代品的用户对功能阉割极度敏感。锁掉任何一项，用户会直接去 GitHub Release 下免费版——那边本来就免费、无限制。锁功能对收入是负的。

所以：
- 免费版和付费版功能完全一致
- 购买入口只出现在设置页，不弹窗、不拦截、不重复问
- 用户点「以后再说」之后，本次运行不再出现

## 直装版不收费

GitHub Release 的 dmg / apk 是免费的，**里面不存在任何付费代码**。

不是运行时隐藏，是编译期就编不进去：`Purchase.showsStorefront` 由 `APPSTORE` 编译条件决定，直装版 config 没有这个标志。已验证：

```
商店版二进制: 产品 ID 出现 2 次
直装版二进制: 产品 ID 出现 0 次
```

macOS 商店版走 `BoseControl-AppStore` scheme（AppStore 配置，`SWIFT_ACTIVE_COMPILATION_CONDITIONS = APPSTORE`）。iOS 只有商店通道（App Store / TestFlight），所以 Debug / Release 都带 `APPSTORE`。

## 产品配置

**已建好，状态 READY_TO_SUBMIT（2026-10-28 经 asc CLI 核实）。**

| 平台 | App ID | 产品 ID | IAP ID | 类型 | 价格 |
| --- | --- | --- | --- | --- | --- |
| iOS | 6827714242 | `cain.com.bosecontrol.lifetime` | 6827716081 | 非消耗型 | ¥1（CHN） |
| macOS | 6827712763 | `cain.com.bosecontrol.mac.lifetime` | 6827715910 | 非消耗型 | ¥1（CHN） |

两个产品：名字「永久会员」，中英文本地化都已配（en-US「Lifetime」/ zh-Hans「永久会员」），描述「一次性买断，永久使用」。产品 ID 是 `lifetime`，不是 `support`——早期代码写错成 `support`，已修正为按平台取 `lifetime` / `mac.lifetime`。

App 记录也已存在：

| 平台 | App ID | Bundle ID | SKU |
| --- | --- | --- | --- |
| iOS | 6827714242 | `cain.com.bosecontrol` | bose-connector-ios |
| macOS | 6827712763 | `cain.com.bosecontrol.mac` | bose-connector-mac |

## 落地步骤（剩余）

| # | 步骤 | 状态 |
| --- | --- | --- |
| 1 | App Store Connect 建 App 记录 | ✅ 已建（两个都在） |
| 2 | 建内购产品 | ✅ 已建，READY_TO_SUBMIT，¥1 |
| 3 | 上传带正确产品 ID 的 build（TestFlight / App Store） | ⏳ 下一步 |
| 4 | 内购随 build 一起提交审核 | ⏳ 依赖 3 |
| 5 | 审核通过，价格生效 | ⏳ 依赖 4 |

**阻塞已解除。** 之前 `docs/store-submission.md` 写的「唯一阻塞：没有 App 记录」过时了——记录和内购产品都建好了，用 `asc` CLI 直接能查（`asc iap list --app <APP_ID>`）。剩下只是上传 build 把内购带进审核。

本机签发/上传凭据：

- asc CLI 已登录（profile DailyOracle，team 钥 HWJYYY78F9 / 9LR8743L58，Issuer `84d76d9f-…`）
- 签名身份：Developer ID / Apple Distribution `TIANBAO DONG (QZZ878S3NS)`
- CI secrets 在 GitHub Environment `APPLE`（见 local-environment 账本）

## 代码位置

| 文件 | 作用 |
| --- | --- |
| `shared/Purchase.swift` | StoreKit 2 实现，两个工程共用 |
| `web/support.js` | 页面侧状态机，只管「显不显示入口」 |
| `web/app.js` `renderSupport()` | 设置页的入口渲染 |
| `tests/support.test.mjs` | 行为边界，9 条 |

原生桥：`purchase` / `restorePurchase` 两个 handler，页面回执走 `onPurchaseResult(text)`，状态注入走 `onStoreInfo(json)`。

## 本地测试

不需要 App 记录也能验状态机：

```bash
npm test -- tests/support.test.mjs
```

要在真机 / 模拟器上走完整购买流程，需要建一个 `.storekit` 配置文件并在 scheme 里选中它（StoreKit Configuration），或者直接用沙盒账号在 TestFlight build 里购买（内购已 READY_TO_SUBMIT，产品 ID 已对齐）。

## 恢复购买

`Purchase.restore()` 调 `AppStore.sync()` 再查 `currentEntitlements`。换机、重装后用户点这个。

**当前页面没有暴露「恢复购买」按钮。** 因为入口只在未购买时显示，而重装后如果确实买过，`isPurchased()` 会直接返回 true，入口根本不出现。只有「买过但收据丢了」这种边缘情况才需要手动恢复——那时入口会显示，点购买会走到 Apple 的「已购买，免费恢复」流程。如果日后发现有用户卡在这里，再把按钮加上。
