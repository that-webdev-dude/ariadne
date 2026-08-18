# Phase 6 benchmark report

- Benchmark: `<benchmark id>`
- Manifest SHA-256: `<hash>`
- Target commit: `<commit>`
- Ariadne functionality commit: `<commit>`
- Runner: `<exact runner and version>`
- Model/settings: `gpt-5.6-sol; reasoning effort high`
- Run order: `<recorded order>`

| Run | Condition | Diagnosis | Tool calls | Searches | Source reads | Ariadne calls | Source files | Source lines | Source tokens | Total context tokens | Model input tokens | Model output tokens | Resolution ms |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `<run id>` | `<condition>` | `<score/max; pass/fail>` |  |  |  |  |  |  |  |  |  |  |  |

| Condition | Runs | Accuracy passes | Mean score | Mean source lines | Mean source tokens | Mean context tokens | Mean tool calls | Mean model input tokens | Mean model output tokens | Mean resolution ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Control |  |  |  |  |  |  |  |  |  |  |
| Ariadne |  |  |  |  |  |  |  |  |  |  |

## Comparison

- Source-token reduction: `<percent or n/a>`
- Source-line reduction: `<percent>`
- Context-token reduction: `<percent or n/a>`
- Tool-call reduction: `<percent>`
- Time-to-resolution reduction: `<percent>`
- Diagnosis quality preserved: `<yes/no>`
- 40% source-token target met: `<yes/no/n/a>`

## Deviations

`<protocol deviations, failed traces, missing token counts, or none>`

## Conclusion

`<bounded conclusion supported by the recorded runs>`
