export default function Loading() {
  return <main id="main" tabIndex={-1} className="customer-page" aria-busy="true"><p className="eyebrow">Your visit</p><h1>Making room for you.</h1><p role="status">Checking your space and payment status…</p><div className="booking-panel skeleton" aria-hidden="true"/></main>;
}
