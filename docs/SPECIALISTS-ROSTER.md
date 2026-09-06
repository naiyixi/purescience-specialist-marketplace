# 首发医学专家名单（v1，2026-09-06 拍板）

> 顺序即开发顺序。P2 先建公共基础技能包，P3 旗舰，P4 其余专家。
> 每席验收题 ≥3 条（正常/阻断/边界），发布前实测。

## 公共基础技能包（先行，P2）

| slug | 显示名 | 说明 |
|---|---|---|
| `statistical-inference` | 统计推断与检验选择 | 检验选择、假设核查、效应量、功效、贝叶斯替代、透明报告 |
| `uncertainty-units-audit` | 不确定度与单位审计 | 单位/量纲/量级核查、测量不确定度传播（GUM 思路，中文改写） |
| `study-design` | 研究设计（实验/队列） | 随机化/分层/区组、队列与病例对照、伪重复防护 |
| `scientific-visualization` | 科研图表与可视化审计 | 图表真实性/可访问性/出版级导出审计 |
| `literature-search-strategy` | 文献检索策略 | 数据库式检索式构建（PICO→检索式），不等于检索结果 |
| `evidence-grading` | 证据分级与论断校准 | GRADE 思路分级、claim 强度校准 |
| `methods-writing-audit` | 方法与结果写作审计 | 方法/结果章节写作与审计 |
| `citation-integrity` | 引文完整性核查 | DOI/PMID/URL 校验、引用支撑核查 |

## 六席专家

| # | slug | 显示名 | 专长技能组（自研） | 连接器白名单 | 关键验收场景 |
|---|---|---|---|---|---|
| 0（P3 旗舰） | `auto-research-co-scientist` | 自主科研主理人 | 全部基础包 + 全套流程技能（澄清/契约/迭代/审计/写作） | 医学全量 | 一个模糊方向 → 契约 → 小步迭代 → 阻断缺输入 |
| 1 | `evidence-synthesis-specialist` | 循证证据综合专家 | 检索策略/证据分级/写作审计 | literature、pubmed、research_resources | 检索式 → 多库收集 → 质量评价 → Meta 分析设计 |
| 2 | `clinical-study-designer` | 临床研究设计专家 | 研究设计/统计推断/引文完整性 | literature、pubmed、clinical_trials | PICO 澄清 → 终点/设计/样本量 → 无数据不冒充执行 |
| 3 | `omics-biomarker-specialist` | 组学与生物标志物研究专家 | 组学执行八件套（归一化/批次/差异/GSEA/WGCNA/外部验证） | 组学连接器全量 | GEO 数据 → 差异 → 通路 → 只报告有据结论 |
| 4 | `rwe-research-specialist` | 真实世界证据研究专家 | 研究设计/统计推断/不确定度审计 | literature、pubmed、clinical_trials | 观察性方案 → 混杂/偏倚控制 → 处方边界拒绝 |
| 5 | `pkpd-dose-designer` | 药代与剂量建模专家 | pkpd 建模/单位审计 | chembl、pubmed、drug_regulatory | NCA/群体 PK → 剂量探索 → 不输出个体处方 |

## 共享技能组矩阵（去重核算）

- 全部六席复用：`literature-search-strategy`、`evidence-grading`、`uncertainty-units-audit`
- 1/2/4 席复用：`study-design`、`statistical-inference`
- 3/5 席各自持有领域专包（组学八件套 / pkpd 建模包）
- 实际新增专包数 ≈ 基础包 8 + 旗舰流程包 12 + 组学 8 + pkpd 2 ≈ 30 个技能，公共件只写一次
