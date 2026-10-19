const CMKP_URL = "https://www.cmkp.edu.pl/ksztalcenie/postepowania-kwalifikacyjne";

export function HowItWorksCard() {
  return (
    <section className="how-it-works" aria-labelledby="how-it-works-title">
      <h2 className="how-it-works-title" id="how-it-works-title">
        Jak to działa?
      </h2>
      <p className="how-it-works-text">
        Wszystkie progi, wyniki i liczby miejsc pochodzą z list publikowanych przez{" "}
        <a href={CMKP_URL} target="_blank" rel="noopener noreferrer">
          Centrum Medycznego Kształcenia Podyplomowego
        </a>{" "}
        po każdym postępowaniu kwalifikacyjnym. CMKP udostępnia wyniki w plikach PDF. Ta strona jest ich przetworzoną
        wersją: odczytujemy je automatycznie, bez ręcznego przepisywania i bez zmieniania wartości, aby można je było
        filtrować i porównywać między naborami. Przetworzone dane porównaliśmy z oryginalnymi plikami PDF i są z nimi
        zgodne. Jeśli mimo to zauważysz rozbieżność, <a href="mailto:stenzelpawel.t@gmail.com">napisz do nas</a> -
        wiążące pozostają informacje opublikowane przez CMKP.
      </p>
    </section>
  );
}
