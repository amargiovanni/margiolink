/**
 * The landing page's only script.
 *
 * Everything here is an enhancement of a page that is already complete
 * without it: the copy, the screenshots, the privacy details and the setup steps are
 * all in the HTML, and `index.html`'s inline bootstrap removes the `js` class
 * again if this module never loads, so a failure here costs a theme button
 * and entrance animations rather than the page.
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
 *  otherwise whatever the OS is asking for — which is what `landing.css`'s
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
