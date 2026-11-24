# 第三方声明与许可范围

根目录 `LICENSE` 中的 MIT 许可证适用于本项目自有源代码、文档及自编示例数据。第三方代码保留其原版权与许可证；本项目不代表第三方权利人授予额外许可。

## ts-fsrs

- 项目：https://github.com/open-spaced-repetition/ts-fsrs
- 固定版本：5.2.3；模型：FSRS-6。
- 版权：Copyright (c) 2025 Open Spaced Repetition。
- 许可证：MIT，完整文本见 [src/vendor/ts-fsrs-LICENSE.txt](src/vendor/ts-fsrs-LICENSE.txt)。
- 分发文件 `src/vendor/ts-fsrs-5.2.3.js` 为该 npm 包的原样 ESM 产物。`package-lock.json` 保留包版本和完整性摘要。

## Liquid Glass 光学适配

- 上游：https://github.com/xiaojiaenen/liquid-glass
- 来源修订：`d61ba1109a62f505b71f517470e8597e6dbfc268`。
- 原作者及贡献者采用 MIT 许可证；上游也注明 Bhavya-Goswami/liquid-glass 的贡献。
- 原有版权、完整许可证和来源说明保留在 [src/liquid-glass.js](src/liquid-glass.js) 文件头。本项目仅对原生 JavaScript 界面进行适配。

## 词汇数据

`data/demo.json` 与 `data/enrichment.json` 是本项目自编的演示学习材料。它们不是第三方完整词表、出版物或官方 IELTS 词库。

`data/vocabulary.json` 是默认完整词库，含 22 章、3631 个去重词条，整理自 [hefengxian/my-ielts](https://github.com/hefengxian/my-ielts) 的词表，关联《雅思词汇真经》，并合并本项目自编的部分音标、翻译及学习提示。

**根目录 MIT 许可证不适用于这份第三方完整词库。**保留上游禁止商业用途的说明，供非商业学习使用；来源说明不代表获得原书权利人的额外授权，使用和再分发须核对原资料的权利范围。详见 [词库说明](docs/词库说明.md)。

仓库不包含原书音频、下载的原始文本或个人学习记录。
