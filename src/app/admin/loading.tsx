export default function Loading() {
  return <section aria-busy="true" aria-label="Loading administration" className="operation-loading"><p className="eyebrow">The workspace desk</p><h1>Loading your workspace.</h1><p role="status">Checking the latest stored records…</p><div className="operation-metrics">{[1,2,3,4].map(i=><div key={i} className="metric-card skeleton" aria-hidden="true"/>)}</div><div className="operation-panel skeleton" aria-hidden="true"/></section>;
}
