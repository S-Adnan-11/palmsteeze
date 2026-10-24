export function UiIcon({name}:{name:string}) {
  const paths:Record<string,string>={overview:'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',bookings:'M4 5h16v16H4zM8 3v4M16 3v4M4 11h16',spaces:'M4 10h16v3H4zM6 13v7M18 13v7M8 4h8v6',availability:'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M12 7v5l3 2',recovery:'M5 7a8 8 0 1 1-1 9M5 3v5h5',audit:'M5 3h14v18H5zM9 8h6M9 12h6M9 16h4'};
  Object.assign(paths,{
    'chevron-down':'M6 9l6 6 6-6','chevron-up':'M6 15l6-6 6 6',
    'chevron-left':'M15 6l-6 6 6 6','chevron-right':'M9 6l6 6-6 6',
    check:'M5 12l4 4L19 6',close:'M6 6l12 12M18 6L6 18',
    calendar:'M7 3v4M17 3v4M3 11h18M6 5h12a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3Z',
    search:'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
    copy:'M8 8h12v12H8zM16 8V4H4v12h4',
  });
  return <svg className="ui-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d={paths[name]||paths.overview}/></svg>;
}
