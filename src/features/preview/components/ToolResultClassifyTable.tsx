export interface ClassifyPrediction {
  label: string
  score: number
  index: number
}

interface ToolResultClassifyTableProps {
  model: string
  device: string
  timingMs: number
  predictions: ClassifyPrediction[]
}

function formatScore(score: number): string {
  return `${(score * 100).toFixed(2)}%`
}

export function ToolResultClassifyTable({
  model,
  device,
  timingMs,
  predictions,
}: ToolResultClassifyTableProps) {
  return (
    <div className="space-y-3">
      <div className="rounded-md border border-border/80 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
        <p>模型: {model}</p>
        <p>设备: {device}</p>
        <p>耗时: {timingMs.toFixed(1)} ms</p>
      </div>

      {predictions.length > 0 ? (
        <div className="overflow-hidden rounded-md border border-border/80">
          <table className="w-full text-xs">
            <thead className="bg-muted/40 text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">label</th>
                <th className="px-3 py-2 text-right font-medium">score</th>
                <th className="px-3 py-2 text-right font-medium">index</th>
              </tr>
            </thead>
            <tbody>
              {predictions.map((prediction) => (
                <tr key={`${prediction.index}-${prediction.label}`} className="border-t border-border/60">
                  <td className="px-3 py-2">{prediction.label}</td>
                  <td className="px-3 py-2 text-right">{formatScore(prediction.score)}</td>
                  <td className="px-3 py-2 text-right text-muted-foreground">{prediction.index}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="rounded-md border border-border/80 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
          未返回有效预测结果
        </p>
      )}
    </div>
  )
}
