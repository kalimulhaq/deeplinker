const KEY = "deeplinker:guard";
let remembered = false;

/**
 * [has this tab already been redirected (or told to skip)?, does sessionStorage work?]. It throws in some private
 * modes and when site data is blocked; the in-memory flag then still covers the current page.
 */
export function guardState(): [boolean, boolean] {
  try {
    sessionStorage.setItem(KEY + "t", "1");
    sessionStorage.removeItem(KEY + "t");
    return [remembered || sessionStorage.getItem(KEY) === "1", true];
  } catch {
    return [remembered, false];
  }
}

/** Set before every navigation so that coming back (or landing on a page that also runs deeplinker.js) cannot loop. */
export function setGuard(): void {
  remembered = true;
  try {
    sessionStorage.setItem(KEY, "1");
  } catch {
    /* the in-memory flag still covers this page */
  }
}
