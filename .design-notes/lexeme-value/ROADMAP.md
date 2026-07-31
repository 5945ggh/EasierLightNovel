# 分词价值再挖掘：实现路线

更新时间：2026-07-31

## 阶段 0：证伪报告（已验收，度量契约已冻结）

### 目标

在不改数据库 schema 的情况下，验证“学习少量高频词能显著提高阅读覆盖率”是否成立，并检查数值是否被分词噪声污染。

### 交付物

一次性审计脚本：`backend/scripts/lexical_audit.py`。

输出必须包括：

- `coverage_report.json`
- `coverage_report.md`
- 边界词表，至少完整导出 95%–96% 区间的词元
- 词元原形、表层形、词性、出现次数、OOV（若输入是原始 EPUB）
- 表层读音、保守 canonical reading、`(normalized_form, canonical_reading)` 诊断 key 及未解析读音计数
- 80/90/91/95/96/98% 覆盖点
- 末端 hapax 数量和比例
- 固有名词保留/排除的对照
- A/B/C 模式对照（可用 C 结果的 `split()` 派生 A/B）

`coverage_report.json` 必须强制写入：

```json
{
  "denominator_tokens": 0,
  "total_types": 0,
  "hapax_count": 0,
  "filter_spec": {
    "pos_allowlist": [],
    "exclude_oov": false,
    "exclude_proper_nouns": false
  },
  "tokenizer": {},
  "data_quality": {
    "source_sha256": null
  },
  "source_content_version": null
}
```

### 验收条件

- 人工检查 95%–96% 边界词表中至少 50 个词。
- 能区分正常长尾词、OOV 噪声、分词碎片、人名和符号残片。
- 报告中的分母、类型数、hapax 数和过滤口径可复算。
- 以当前数据库的旧 `b` 字段计算的数字只标记为 legacy estimate，不与新 normalized 口径混用。
- 用一部长篇原始 EPUB 完成长篇 benchmark：解析、分词、OOV、ruby、模式、文本段和预估 occurrence 规模。

### 验收结论

`stage0-v2-canonical-reading` 已完成验收。它证明 91% 到 96% 的 normalized-form 覆盖率并非“小词包预习”可轻易达到的区间，并将主曲线与 canonical-reading 诊断明确分开。

阶段 0 产物只能作为同一 tokenizer/filter 契约下的分布测量工具。它不生成生产 `Lexeme`、用户学习目标、Anki GUID 或用户可见 explicit-known 覆盖率。

## 阶段 1：不可变源材料与 ruby 保真

### 目标

为之后可丢弃、可重建的分析层建立明确且可验证的源坐标空间，同时不改变现有阅读器行为、`Chapter.content_json` 或 API 契约。

### 必须交付

- 持久保存原始 EPUB/PDF 副本、SHA-256 和媒体类型。原始文件不可变，且不通过静态 URL 暴露。
- 引入 `SourceContentVersion` 或等价实体，至少记录 book、源文件 hash、parser version、派生内容 hash、创建时间和状态。
- 从 EPUB 提取 ruby 的原始 span：base text、`rt` 原样文本、文档/章节标识以及属于该 `SourceContentVersion` 的可复现定位信息。
- 为普通 ruby、平/片假名 ruby、`本気《マジ》` 类非常规 ruby、无 ruby EPUB、失败导入、重导入和旧 SQLite 数据补回归测试。
- 保持原有 `Chapter.content_json`、前端 token API、当前阅读渲染和既有本地书籍可用。

### Phase 1 非目标

- 不建立 `AnalysisRun`、永久 `Lexeme`、`Occurrence`、`Sentence`、词频统计或用户词汇状态。
- 不把 `normalized_form`、完整 POS、活用、OOV、dictionary id 或 canonical reading 写入持久分析表；这些属于阶段 2 的可丢弃分析层。
- 不把作者 ruby 自动覆盖 Sudachi reading，不以 ruby 直接建立 canonical identity，也不加入罗马音或新的阅读器注音设置。
- 不压缩或重写既有渲染 JSON，不改变当前 API 契约。

### 验收条件

- 导入成功后，原始文件仍可用于后续重解析；失败路径不会错误保留半成品或删除已持久化的有效源文件。
- 每条 ruby span 的 offset/定位都声明其 `SourceContentVersion`；该版本中的 source text 可复现该 span 的 base text 和 raw ruby。
- `本気《マジ》` 保持为原始作者标注，不能被断言为标准词典读音。
- 旧数据库升级后正常启动，且旧 `Chapter.content_json` 和前端 token API 继续兼容。
- parser version 或源内容改变时，必须新建 source content version，不能复用旧 offset。

## 阶段 2：可丢弃的 AnalysisRun 和最小分析索引

### 目标

建立跨书统计需要的稳定词元身份，但不提前实现完整例句推荐系统。

### 首批实体

```text
AnalysisRun
Lexeme
RunLexeme
LexemeAlias / merged_into_id
LexemeOccurrence
ChapterLexemeStat
```

Sentence 暂不阻塞覆盖率 MVP。若 occurrence 的上下文需求明确，再加入 `Sentence`，并物化 `content_lexeme_count`、`has_dialogue`。

### 关键规则

- canonical Lexeme 只使用可信 reading。
- OOV fallback 使用 provisional identity。
- analysis run 失败不能切换 active run。
- run 重建必须幂等。
- 新 run 建立于明确的 `source_content_version`。
- `canonical_reading_kana`、reading provenance 与 OOV provisional identity 的持久化契约在本阶段原型验证后冻结；不得从 Phase 0 报告直接复制为生产主键。

## 阶段 3：单一 explicit-known 覆盖率

### 目标

交付第一项用户可见的深层功能：书籍学习地图。

包括：

- 一个 explicit-known 覆盖率
- 80/90/95/96% 覆盖点
- 章节未知词密度
- 下一章新增词数
- 边际收益排序
- OOV/特色词说明

没有个人已知词集时，显示“尚未建立个人词汇基线”，不显示伪造的 0%。

## 阶段 4：用户状态和外部已知集读取

顺序为：

1. 手动已知/学习中/忽略状态
2. AnkiConnect 只读
3. JLPT 词表导入
4. 可选的分层抽样词汇量估计

AnkiConnect 不可用时，覆盖率仍必须正常工作。

## 阶段 5：查词日志和上下文习得提示

记录书籍、章节、句子/坐标、lexeme、surface、动作和时间。

`acquired_in_context` 只由日志派生，不改写 explicit-known 覆盖率。用户能看到：

```text
你在第 3 页查过一次「安達」，之后又出现 199 次，没有再次查询。
```

## 阶段 6：Sentence、i+1 例句和 Anki 导出

Sentence 和 i+1 例句选择推迟到 occurrence 索引稳定后。

例句排序在导出时按当时的 known set 计算；若缓存，必须以 known-set version 为键。

Anki 导出使用 `AnkiExportLedger` 固定 GUID，不依赖数据库自增 ID。音频另建可缓存、可打包的后端媒体链路，不能直接复用浏览器 `SpeechSynthesis`。

## 当前不进入范围

- 四分类 `BookTermClassification`
- 书架“按可读性”排序
- 没有证据支持的 acquired-in-context 阈值调参
- 外部大规模语料抓取
- 在覆盖率口径稳定前压缩渲染 JSON
