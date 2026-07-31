# 2026-07-31 讨论记录

## 本轮修正

- 覆盖率收缩为单一 `explicit known` 指标。
- `acquired_in_context` 后置到查词日志之后，作为可解释提示，不作为百分比。
- 删除四类 OOV 推断，保留一个 `excluded_from_learning_target` 行为字段。
- 阶段 0 必须导出 95%–96% 边界词表，人工检查语义质量。
- `coverage_report.json` 强制包含分母、类型数、hapax 数和过滤口径。
- Anki GUID 由 `AnkiExportLedger` 固定，避免数据库重建导致牌组孤儿化。
- Sentence 和 i+1 例句从覆盖率 MVP 中降级，但不从长期架构中删除。

## 当前证据

仓库实际使用 SudachiPy；当前 tokenizer 使用 `dictionary_form()`，尚未保存 `normalized_form()`、完整 POS、OOV 或 ruby。EPUB parser 会忽略 `rt/rp`，导入完成后临时源文件会被删除。

当前本地数据库的粗略 legacy estimate 使用一级词性 allowlist 和旧 `b` 字段，不能与未来 normalized 口径交叉比较。该结果仅用于推动阶段 0 报告，不作为产品承诺。

## 待验证

- 表记摇摆 fixture 在当前 Sudachi 词典版本下的真实归并率。
- 长篇 EPUB 的 OOV、ruby、occurrence 行数和分词耗时。
- A/B/C 模式与外部已知词集的 join 命中率。
- 95%–96% 边界词是否包含大量碎片、人名或 OOV 噪声。
- source offset 在显示模式变化和高亮迁移中的稳定性。
