export default function Loading() {
  return <main id="main" tabIndex={-1} className="customer-page" aria-busy="true"><p className="eyebrow">Your visit</p><h1>Checking your visit.</h1><p role="status">Loading your space and verified status. Please wait before making another payment.</p><div className="booking-panel skeleton" aria-hidden="true"/></main>;
}
