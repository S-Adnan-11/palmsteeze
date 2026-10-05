export function UiIcon({name}:{name:string}) {
  const paths:Record<string,string>={overview:'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',bookings:'M4 5h16v16H4zM8 3v4M16 3v4M4 11h16',spaces:'M4 10h16v3H4zM6 13v7M18 13v7M8 4h8v6',availability:'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M12 7v5l3 2',recovery:'M5 7a8 8 0 1 1-1 9M5 3v5h5',audit:'M5 3h14v18H5zM9 8h6M9 12h6M9 16h4'};
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]||paths.overview}/></svg>;
}
