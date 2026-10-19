// Umami (bez cookies, bez banera zgody). Wklej tu Website ID z panelu Umami;
// przy pustej wartości analityka jest wyłączona.
const UMAMI_WEBSITE_ID = "6e977d2f-3dcd-4a6a-a09e-cec934ec0161";
const UMAMI_SCRIPT_SRC = "https://cloud.umami.is/script.js";

interface UmamiWindow extends Window {
  umami?: { track: (event: string, data?: Record<string, string | number | boolean>) => void };
}

export function initAnalytics() {
  if (!UMAMI_WEBSITE_ID || import.meta.env.DEV) return;
  setupDelegatedTracking();
  const script = document.createElement("script");
  script.defer = true;
  script.src = UMAMI_SCRIPT_SRC;
  script.dataset.websiteId = UMAMI_WEBSITE_ID;
  document.head.appendChild(script);
}

export function trackEvent(event: string, data?: Record<string, string | number | boolean>) {
  try {
    (window as UmamiWindow).umami?.track(event, data);
  } catch {
    // analityka nie może psuć aplikacji
  }
}

const trackedOnce = new Set<string>();

/** Wysyła zdarzenie tylko raz na sesję strony (np. pierwsze użycie kalkulatora). */
export function trackEventOnce(event: string, data?: Record<string, string | number | boolean>) {
  if (trackedOnce.has(event)) return;
  trackedOnce.add(event);
  trackEvent(event, data);
}

const SPONSOR_HOST = "start.poz1.pl";

function setupDelegatedTracking() {
  // Linki wychodzące (poza linkami sponsora, które mają własne zdarzenia).
  document.addEventListener("click", (event) => {
    const link = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
    if (!link || !/^https?:$/.test(link.protocol)) return;
    if (link.host === window.location.host || link.host === SPONSOR_HOST) return;
    trackEvent("outbound-click", { host: link.host, url: link.href });
  });

  // Rozwinięcie pytania w FAQ. "toggle" nie bąbelkuje, więc nasłuch w fazie przechwytywania.
  document.addEventListener(
    "toggle",
    (event) => {
      const details = event.target;
      if (!(details instanceof HTMLDetailsElement) || !details.open || !details.closest(".seo-faq")) return;
      const question = details.querySelector("summary")?.textContent?.trim();
      if (question) trackEvent("faq-open", { question });
    },
    true,
  );
}

/** Zdarzenie `section-view` przy pierwszym przewinięciu do sekcji (selektor CSS -> nazwa). */
export function observeSectionViews(sections: Record<string, string>) {
  if (typeof IntersectionObserver === "undefined") return;
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        observer.unobserve(entry.target);
        trackEvent("section-view", { section: (entry.target as HTMLElement).dataset.analyticsSection ?? "" });
      }
    },
    { threshold: 0.25 },
  );
  for (const [selector, name] of Object.entries(sections)) {
    const element = document.querySelector<HTMLElement>(selector);
    if (!element) continue;
    element.dataset.analyticsSection = name;
    observer.observe(element);
  }
}
