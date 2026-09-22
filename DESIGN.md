# 招聘工作台设计系统

## 1. Atmosphere & Identity
参考 ../技术方案/智联招聘参考证据 的三张真实视频截图。借鉴账号管理、三栏会话、编号四段任务设置的结构，不作像素复刻。中文桌面操作台，浅灰工作面、白色面板、蓝色操作焦点，自己的“招聘工作台”标识。标题左对齐，辅助信息降层，操作密集但留出阅读空间。
## 2. Color
--canvas #f4f6fa；--surface #ffffff；--sidebar #ffffff；--text #17223b；--muted #667085；--border #e6eaf0；--primary #2563eb；--primary-hover #1d4ed8；--primary-soft #eff5ff；--success #16794b；--warning #9a6700；--danger #c43232。色彩只来自此表。
## 3. Typography
系统中文字体 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif。正文14px/1.6，辅助12px/1.5，卡标题16px/600，页标题24px/650，计数28px/650。无远程字体。
## 4. Spacing & Layout
4px基数：4、8、12、16、20、24、32、40、48。侧栏208px；顶栏64px；正文24px；卡片20px；按钮36px；输入36px；圆角8px（卡12px）。桌面最低窗口960×680，默认1360×900；网页预览小于768px侧栏收为顶部导航，表单单列。主区独立滚动，三栏 min-width/min-height:0，长文本折行。
## 5. Components
PageHeader 标题/描述/右侧操作；Panel 白底边框标题与操作；Metric 横排数值；Status 有文字的状态标签；EmptyState 图标/说明/明确下一步；Field 标签/控件/错误；TaskSection 编号标题与表单；AccountSelector；ConversationList；DraftEditor。按钮 default/hover/focus/disabled/loading，表单 invalid，异步区域 loading/empty/error/content 必须齐备。使用 Ant Design 基础控件统一令牌，Lucide 图标。保留 primitives 展示入口便于状态检查。所有交互可键盘访问，消息提示 aria-live。
## 6. Motion & Interaction
状态切换淡入150ms，抽屉200ms；无装饰性循环动画；prefers-reduced-motion 禁用过渡。危险断开操作二次确认。登录可取消，重复连接按钮锁定。忙碌态不能重复提交。
## 7. Depth & Surface
面板1px border，选中菜单 primary-soft 背景，模态窗使用组件库默认轻阴影。无大面积渐变、品牌装饰图、假统计。真实数据为空时有空状态。
## 8. Accessibility Constraints & Accepted Debt
目标WCAG AA：正文对比4.5:1、可见focus、label、键盘可用、错误与成功不用颜色单独表达。参考视频低分辨率且只展示空状态，因此忠实实现信息结构，不承诺像素一致。外发通道未验证时显示“待接入验证”，草稿功能可用，不显示虚构会话或额度。

## 9. 实现布局补充
768–1100px 的页标题与操作上下排列，智能接管账号栏跨行，资料列表与详情并排，避免中文标签被窄栏拆成孤字。低于768px沿用顶部导航与单列。桌面三栏宽度160/240/自适应；紧凑列表200px。任务状态在1100px以下回到表单下方。
