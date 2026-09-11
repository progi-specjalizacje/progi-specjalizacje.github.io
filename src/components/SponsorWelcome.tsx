export function SponsorWelcome() {
  return (
    <>
      <div className="sponsor-backdrop" aria-hidden="true" />
      <header className="sponsor-header" aria-label="POZycja pierwsza">
        <a className="sponsor-logo" href="https://start.poz1.pl/" target="_blank" rel="sponsored noopener noreferrer" aria-label="POZycja pierwsza — strona reklamodawcy (nowa karta)">
          <img src="/assets/poz1/logo.png" alt="POZycja pierwsza" width="150" height="78" fetchPriority="high" />
        </a>
      </header>
      <section className="sponsor-hero" aria-labelledby="sponsor-title">
        <h2 className="sponsor-title" id="sponsor-title">Planujesz przed specką dorobić w POZ/NiŚPL<br />{' '}lub idziesz na medycynę rodzinną?</h2>
        <p className="sponsor-description">Wejdź bez stresu w nową pracę<br />{' '}i bądź zawsze na bieżąco<br />{' '}z aplikacją <strong>POZycja pierwsza</strong></p>
        <p className="sponsor-proof">⭐ 13 000+ lekarzy | &gt;5 lat na rynku | tworzona przez lekarzy praktyków</p>
        <a className="sponsor-button" href="https://start.poz1.pl/" target="_blank" rel="sponsored noopener noreferrer">Poznaj aplikację <span aria-hidden="true">↗</span></a>
      </section>
    </>
  );
}
