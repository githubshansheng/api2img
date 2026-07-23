# 单图相机协议实图验收矩阵

验收日期：2026-07-16

状态：14 / 14 通过。

## 人像参考图

| 测试项 | 控制值 | 通过证据 |
| --- | --- | --- |
| 正视 | Yaw 0°, Pitch 0°, Roll 0° | `2026-07-16-portrait-front-v38/result.png` |
| 右侧视 | Yaw +90°, Pitch 0°, Roll 0° | `2026-07-16-portrait-side-right-90-v39/result.png` |
| 俯视 | Yaw 0°, Pitch +75°, Roll 0° | `2026-07-16-portrait-top-x75-protocol38/result.png` |
| 仰视 | Yaw 0°, Pitch -75°, Roll 0° | `2026-07-16T01-02-01-054Z-portrait-bottom-v34/result.png` |
| 远景 | cameraDistance < 2 | `2026-07-16T01-02-01-071Z-portrait-wide-v34/result.png` |
| 中景 | 2 <= cameraDistance < 6 | `2026-07-16T01-06-40-785Z-portrait-medium-v34/result.png` |
| 特写 | cameraDistance >= 6 | `2026-07-16T01-02-02-913Z-portrait-close-v34/result.png` |

## 风扇参考图

| 测试项 | 控制值 | 通过证据 |
| --- | --- | --- |
| 正视 | Yaw 0°, Pitch 0°, Roll 0° | `2026-07-16-fan-front-v38/result.png` |
| 右侧视 | Yaw +90°, Pitch 0°, Roll 0° | `2026-07-16-fan-side-right-90-v39/result.png` |
| 俯视 | Yaw 0°, Pitch +75°, Roll 0° | `2026-07-16T06-44-00-001Z-fan-top-x75-v40-candidate-l1-calibrated-retry/result.png` |
| 仰视 | Yaw 0°, Pitch -75°, Roll 0° | `2026-07-16T18-45-00-fan-bottom-x-minus75-v44-candidate-l-local-assembly-repair/result.png` |
| 远景 | cameraDistance < 2 | `2026-07-16T00-48-07-037Z-fan-wide-v34/result.png` |
| 中景 | 2 <= cameraDistance < 6 | `2026-07-16T00-57-10-811Z-fan-medium-v34/result.png` |
| 特写 | cameraDistance >= 6 | `2026-07-16T00-48-08-515Z-fan-close-v34/result.png` |

## 严格俯仰复核

- 风扇俯视 L1：网罩短轴 / 长轴估计 `0.22`，五项评分 `4 / 4 / 3 / 4 / 4`，严格通过。审计：`protocol-lab/fan-top-l1-strict-audit-v2.json`。
- 风扇俯视 L3：网罩短轴 / 长轴估计 `0.30`，五项评分 `4 / 4 / 3 / 4 / 4`，严格通过，可作备选证据。审计：`protocol-lab/fan-top-l3-strict-audit-v2.json`。
- 风扇仰视 L：网罩短轴 / 长轴估计 `0.25`，五项评分 `4 / 3 / 4 / 4 / 4`，严格通过。审计：`protocol-lab/fan-bottom-l-strict-audit-v2.json`。
- 旧俯视 K：网罩比例 `0.46`，严格不通过。审计：`protocol-lab/fan-top-k-strict-audit-v2.json`。
- 新候选 M：网罩比例 `0.48`，严格不通过。审计：`protocol-lab/fan-top-m-strict-audit-v2.json`。

五项评分依次为：网罩投影、电机轴、支撑连接、相机视差、Roll 0°。严格通过要求五项均不低于 3，网罩比例位于 `0.20 ~ 0.35`，且无机头主动俯仰、装配断裂或 Roll 错误。

## 已验证的协议结论

1. Yaw / Pitch / Roll 描述的是相机相对固定世界装配的运动，不是把源图像素做二维旋转，也不是让主体主动转身或俯仰迎向相机。
2. “固定世界装配”只锁定真实部件连接、支撑关系和场景位置；最终屏幕轮廓、可见区域、遮挡、透视和新显露结构必须按目标相机重新生成。
3. 对固定竖直圆盘，Pitch `+75°` 或 `-75°` 时投影短轴 / 长轴接近 `abs(cos 75°) = 0.259`。横向窄盘外观本身不是机头放平的证据。
4. 必须用主体类别与图像事实中的具体结构名称描述显露和遮挡，禁止使用“右侧表面”等泛化模板；非人物主体不得出现人体、器官、服装或解剖词。
5. 普通 Yaw / Pitch 不改变 Roll；Roll 只由独立 Z 控制产生。
