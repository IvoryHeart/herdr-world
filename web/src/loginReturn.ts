/**
 * The login page's address for a page that lost its session: it returns to
 * the same path, query and fragment, without a `token`. The server's
 * `safeReturnPath` validates `next` before the login page uses it.
 */
export function loginReturnUrl(href: string): string {
  const here = new URL(href);
  const login = new URL("/login", here.origin);
  if (here.searchParams.has("token")) here.searchParams.delete("token");
  if (here.pathname !== "/" || here.search)
    login.searchParams.set("next", `${here.pathname}${here.search}`);
  login.hash = here.hash;
  return login.href;
}
