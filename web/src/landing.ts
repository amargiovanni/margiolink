/**
 * The landing page's only script.
 *
 * Everything here is an enhancement of a page that is already complete
 * without it: the copy, the screenshots, the ledger and the install steps are
 * all in the HTML, and `index.html`'s inline bootstrap removes the `js` class
 * again if this module never loads, so a failure here costs a theme button
 * and two animations rather than the page.
 *
 * No framework: the dashboard is React because it is an application, and this
 * is a document.
 */

import "./styles/landing.css";

/** Read by the inline bootstrap in `index.html` — see the failsafe there. */
declare global {
  interface Window {
    __margiolinkLanding?: true;
  }
}
window.__margiolinkLanding = true;

const root = document.documentElement;
const THEME_KEY = "margiolink:theme";

/* ------------------------------------------------------------------ theme */

type Theme = "dark" | "light";

/** The theme actually in force: an explicit choice if one is stored, and
 *  otherwise whatever the OS is asking for — which is what `tokens.css`'s
 *  media query is already honouring. */
function activeTheme(): Theme {
  const stamped = root.getAttribute("data-theme");
  if (stamped === "dark" || stamped === "light") return stamped;
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function applyTheme(theme: Theme): void {
  root.setAttribute("data-theme", theme);
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Not remembering the choice is survivable; the page still switches.
  }
  paintToggle(theme);
}

const toggle = document.querySelector<HTMLButtonElement>("#theme-toggle");
const themeLabel = document.querySelector<HTMLElement>("[data-theme-label]");
const themeGlyph = document.querySelector<HTMLElement>("[data-theme-glyph]");

function paintToggle(theme: Theme): void {
  if (themeLabel) themeLabel.textContent = theme === "dark" ? "Dark" : "Light";
  if (themeGlyph) themeGlyph.textContent = theme === "dark" ? "☾" : "☀";
}

if (toggle) {
  toggle.hidden = false;
  paintToggle(activeTheme());
  toggle.addEventListener("click", () => {
    applyTheme(activeTheme() === "dark" ? "light" : "dark");
  });
}

/* ----------------------------------------------------------------- reveal */

const wantsLessMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const revealable = [...document.querySelectorAll<HTMLElement>(".reveal")];

if (wantsLessMotion || !("IntersectionObserver" in window)) {
  root.classList.remove("js");
} else {
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add("shown");
        observer.unobserve(entry.target);
      }
    },
    // A little before the element's top edge arrives, so the animation is
    // finishing as it comes into view rather than starting once it is
    // already being read.
    { rootMargin: "0px 0px -12% 0px", threshold: 0.05 },
  );

  for (const element of revealable) observer.observe(element);
}

/* -------------------------------------------------------------- hash demo */

/**
 * The figure in section 02, ticking.
 *
 * It advances the daily key by one day every few seconds and shows the
 * completely different code the same visitor gets under it — the one claim on
 * the page that is much easier to see than to read. The codes are
 * `crypto.getRandomValues`, not a real HMAC: the point being demonstrated is
 * that consecutive days share nothing, and computing a genuine hash of a
 * fictional IP would suggest the visitor is looking at their own.
 */
const dayElement = document.querySelector<HTMLElement>("[data-hash-day]");
const codeElement = document.querySelector<HTMLElement>("[data-hash-code]");
const noteElement = document.querySelector<HTMLElement>("[data-hash-note]");

if (dayElement && codeElement && !wantsLessMotion) {
  const start = new Date();
  let offset = 0;

  const randomCode = () => {
    const bytes = crypto.getRandomValues(new Uint8Array(8));
    return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  };

  const tick = () => {
    offset += 1;
    const day = new Date(start.getTime() + offset * 86_400_000).toISOString().slice(0, 10);
    dayElement.textContent = `secret : ${day}`;
    codeElement.textContent = randomCode();
    if (noteElement) {
      noteElement.textContent =
        offset === 1 ? "Midnight UTC — same visitor, new code" : "Rotates at 00:00 UTC";
    }
  };

  dayElement.textContent = `secret : ${start.toISOString().slice(0, 10)}`;

  let timer = window.setInterval(tick, 3200);

  // A demo nobody is looking at is a timer nobody needs.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      window.clearInterval(timer);
    } else {
      timer = window.setInterval(tick, 3200);
    }
  });
}
