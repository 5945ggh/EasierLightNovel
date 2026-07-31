# 分词价值再挖掘：当前决策

更新时间：2026-07-31

## 已收敛

### Phase 0 已验收：它是度量契约，不是词元主键

Phase 0 的审计工具版本为 `stage0-v2-canonical-reading`。它已完成作为决策工具的职责：用一部长篇原始 EPUB 量化了覆盖率曲线、长尾、OOV、固有名词和 A/B/C 切分差异，并证伪了“预习少量高频词即可从 91% 到 96%”的产品叙事。

当前样例的 source/C/default-filter 基准为：26,145 个分母 token、4,508 个 normalized types、2,283 个 hapax；91% 到 96% 需新增 1,273 个 normalized types。这个数字说明了长尾成本，**不**表示用户需要学习 1,273 个稳定词元。

`coverage_metric = normalized_form_coverage_curve` 是唯一允许的主曲线表述。它可用于比较同一度量契约下的文本分布和筛选效果；它不得直接用作永久 `Lexeme`、用户学习目标数量、Anki GUID、TTS 读音或 explicit-known 覆盖率的输入。

审计中的 `canonical_lookup_key = (normalized_form, canonical_reading)` 只用于诊断跨书词元契约的风险。`canonical_reading = NULL` 的 OOV/未解析读音仍是 provisional identity，永久身份、合并策略和外部词表互操作要在 AnalysisRun 原型验证后再冻结。

每次作为架构决策依据的 benchmark 必须记录：源文件 SHA-256、报告版本、SudachiPy 版本、Sudachi dictionary 版本、split mode、filter spec、source kind 与运行时间。含作品原文或完整边界词表的本地审计产物不作为仓库提交物。

### Kana join key 与作者 ruby 是两层数据

Stage 0 的审计 join key 继续以片假名表示 `canonical_reading`：这是 Sudachi 的原生输出格式，且审计工具已将外部 TSV 的平假名转换为片假名。不得为了统一展示格式而修改既有 Stage 0 benchmark。

生产分析层未来可以使用 `canonical_reading_kana`，建议选择平假名作为规范 join 表示，以兼容现有阅读器的平假名渲染路径。无论选用哪一种，必须以同一、可逆的 kana normalizer 同时处理 Sudachi 和外部词表输入；它不是作者注音的存储格式。

作者 ruby 必须保留原样，例如 `ruby_reading_raw`，并与标准化 join key 分开。`本気《マジ》` 等非常规 ruby 是作者的表达或语义标注，不能自动覆盖词典读音，更不能未经 token 对齐和可信度判定就进入 Lexeme identity。未来读音 provenance 至少区分 `ruby`、`sudachi_registered`、`user_confirmed`、`oov_guess` 和 `none`。

罗马音只可能是未来的派生展示选项；它不是身份键、持久化读音、默认阅读注音或外部词表 join 格式。

### 覆盖率只保留一个主指标

产品主指标是 `explicit known` 覆盖率：用户明确掌握的词元出现次数除以符合筛选口径的词元出现次数。

不同时展示个人覆盖率、阅读覆盖率、学习目标覆盖率三个百分比。上下文习得不进入覆盖率指标，而作为解释性提示，例如“本书有 12 个专有名词/造语，首次出现时自动注音，不计入学习目标”。

### 上下文习得来自观察，不来自调参

`acquired_in_context` 不是阶段 3 的学习状态，也不通过单用户行为拟合阈值。它只能在查词日志完成后，作为可解释的派生信息生成：用户首次查过某词，之后又出现但没有再次查询。

展示应保留证据，例如首次查询位置、后续出现次数和最后一次查询位置。它不自动改变 `explicit known`。

### OOV 分类只保留一个产品行为字段

不建立 `likely_character`、`likely_place`、`likely_worldbuilding` 等四分类。若多个分类不导致不同系统行为，只保留一个布尔/枚举结果：`excluded_from_learning_target`。

OOV、词性、全局频率和书内频率仍作为分析证据保存，但不伪装成精确的人名/地名/术语识别器。

### 词元身份与可修订 reading 分离

`normalized_form` 用于统计正规化，但不表示同义词合并。

可信 reading 才进入 canonical identity。OOV 推测 reading 和 surface fallback 不铸造永久词元；它们归入 `(normalized_form, NULL)` 的 provisional identity，并保留 reading provenance。

词元合并必须有显式路径（如 `merged_into_id` 或 alias 表），并迁移用户状态和导出关系。

### Anki GUID 由导出账本拥有

Anki GUID 不能依赖数据库自增 `lexeme_id`。使用只增的 `AnkiExportLedger`：首次导出时生成稳定 GUID，之后词元合并只更新账本指向，不重新生成 GUID。

### 原始文件不可变，派生层可丢弃

原始 EPUB/PDF 永久保留；`SourceContentVersion` 和 `AnalysisRun` 都是带版本的派生物。所有 source offset 必须声明其 source content version。

### Sentence 保留，但降低优先级

Sentence 对查词上下文、日志解释和未来例句选择仍有价值，但不再作为覆盖率 MVP 的前置核心。先保存 source offset 和 occurrence，Sentence 可以在分析索引稳定后加入。

## 明确拒绝

- 不在没有用户状态基线时显示 0% 作为真实覆盖率。
- 不默认排除固有名词；世界观术语可能正是学习价值最高的内容。
- 不把 OOV 推测读音直接作为 Anki/TTS 的确定读音。
- 不把 Stage 0 的 normalized-form 曲线或诊断 canonical key 直接写入永久 Lexeme schema。
- 不让作者 ruby 静默覆盖 Sudachi/词典读音，也不将 ruby 强制转换成罗马音或单一 kana 后丢失原始写法。
- 不用用户行为调参来决定上下文习得阈值。
