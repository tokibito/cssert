# Recipe: Django

cssert compares built CSS with HTML. Django templates are not HTML until they
are rendered, so the reliable approach is to **render the pages you care
about to files, then check the files**. Checking the raw templates also works
but reports every `{% if %}`/`{{ }}` inside a `class` attribute as a
dynamic-suspect token.

## 1. Dump rendered HTML

Two ways to do this. **Prefer the pytest one** if you already have tests: it
reuses your existing fixtures, so there is no demo dataset to keep in sync, and
it fails on a 500 before cssert ever runs.

### 1a. From the test suite (recommended)

Render the pages inside a test. The assertion on the status code is not a
bonus check — it is the thing that stops a broken page from reaching cssert as
a valid-looking 500 error page.

```python
# tests/test_rendered_pages.py
from pathlib import Path

import pytest
from django.test import Client

OUT = Path("build/rendered")

PAGES = [
    ("index.html", "/"),
    ("pricing.html", "/pricing/"),
    ("account/settings.html", "/account/settings/"),
]


@pytest.fixture
def demo_data(db, django_user_model):
    """Reuse the fixtures the rest of the suite already builds."""
    user = django_user_model.objects.create_user("demo", password="x")
    # ... create the objects the pages need, both branches of each condition
    return user


@pytest.mark.parametrize("name,url", PAGES)
def test_page_renders_for_cssert(client: Client, demo_data, name, url):
    client.force_login(demo_data)
    response = client.get(url)
    assert response.status_code == 200, f"{url} returned {response.status_code}"

    target = OUT / name
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(response.content)
```

```sh
pytest tests/test_rendered_pages.py      # writes build/rendered/
```

Keep `PAGES` in one place and count it: passing `--min-documents` with that
count turns "the render step silently produced nothing" into a failed check
rather than a green one.

### Render both branches of every condition

Rendering a page is not the same as covering it. `{% if %}` only emits the
branch your data happened to take, so the other branch's classes stay
unverified forever:

```html
<span class="badge {% if invitation.is_expired %}badge-error{% else %}badge-success{% endif %}">
```

With only unexpired invitations in the fixture, `badge-error` is never checked
— and it is exactly the kind of rarely rendered class a content-path mistake
drops. Build fixture data that exercises both sides of each condition that
affects a class: expired and current, checked and unchecked, permitted and
denied, empty list and populated list. Where a page has many such states,
render it several times under different names (`orders--empty.html`,
`orders--full.html`).

### 1b. From a management command

When there is no test suite to hang this off, add a command that renders URLs
with the test client and writes the responses to `build/rendered/`:

```python
# myproject/core/management/commands/dump_rendered.py
from pathlib import Path

from django.core.management.base import BaseCommand
from django.test import Client
from django.contrib.auth import get_user_model


PAGES = {
    "index.html": "/",
    "pricing.html": "/pricing/",
    "account/settings.html": "/account/settings/",
}


class Command(BaseCommand):
    help = "Render selected pages to build/rendered/ for cssert"

    def handle(self, *args, **options):
        out = Path("build/rendered")
        client = Client()
        user = get_user_model().objects.filter(is_staff=False).first()
        if user:
            client.force_login(user)  # render authenticated variants too
        for name, url in PAGES.items():
            response = client.get(url, HTTP_HOST="localhost")
            if response.status_code != 200:
                self.stderr.write(f"{url}: HTTP {response.status_code}")
                continue
            target = out / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(response.content)
            self.stdout.write(f"wrote {target}")
```

Run it against a database with representative fixtures (the CI database is
fine):

```sh
python manage.py migrate
python manage.py loaddata fixtures/demo.json
python manage.py dump_rendered
```

This needs a demo dataset that CI can load and that someone has to maintain
alongside the test fixtures — which is why 1a is the better default when a test
suite exists.

Alternatively, render templates directly when a view needs no request state:

```python
from django.template.loader import render_to_string
Path("build/rendered/email.html").write_text(render_to_string("email/welcome.html", ctx))
```

## 2. Build the CSS

Whatever your pipeline is (Tailwind CLI, django-tailwind, Vite, PostCSS),
make sure the **production** build runs before cssert, with the same
`content`/`@source` configuration you deploy with. That configuration is
exactly what cssert is checking.

```sh
npx @tailwindcss/cli -i static/src/app.css -o static/dist/app.css --minify
```

## 3. Check

```sh
npx @cssert/cli check --css "static/dist/**/*.css" --html "build/rendered/**/*.html"
```

Or with a config file at the project root:

```ts
// cssert.config.ts
import { defineConfig } from "@cssert/cli";

export default defineConfig({
  css: ["static/dist/**/*.css"],
  html: ["build/rendered/**/*.html"],
  ignore: [/^js-/, /^admin-/, /^djdt-/],   // Django admin / debug toolbar classes
  minDocuments: 27,                        // as many pages as PAGES has entries
});
```

These globs are relative to the config file, so put it at the repository root
next to `manage.py` and the command works from anywhere — including from a
`frontend/` subdirectory where `node_modules` lives:

```json
// frontend/package.json
{ "scripts": { "cssert": "cssert check --config ../cssert.config.ts" } }
```

## 4. Render templates as a safety net

Passing the raw templates *as well as* the rendered pages catches screens you
forgot to render. Their `{% %}` expressions come back as dynamic-suspect rather
than verified, but a plain `missing` finding that appears only in the template
glob is a page that was never rendered:

```ts
export default defineConfig({
  css: ["static/dist/**/*.css"],
  html: ["build/rendered/**/*.html", "templates/**/*.html"],
  minDocuments: 27,
});
```

Each finding in the JSON report carries the input glob it was seen under:

```sh
cssert check --format json | jq '.findings[]
  | select(.sources == ["templates/**/*.html"]) | .className'
```

Anything that lists prints a template whose rendered output is missing from
`build/rendered/`.

## 5. GitHub Actions

The CSS comes out of a Node job and the HTML out of a Python job with a
database, so the check is a third job that collects both artefacts:

```yaml
jobs:
  test:                     # renders the pages
    runs-on: ubuntu-latest
    services:
      postgres: { image: postgres:17, env: { POSTGRES_PASSWORD: postgres } }
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-python@v6
        with: { python-version: "3.13" }
      - run: pip install -r requirements-dev.txt
      - run: pytest                       # writes build/rendered/
      - uses: actions/upload-artifact@v5
        with: { name: rendered-html, path: build/rendered, if-no-files-found: error }

  frontend-build:           # builds the CSS
    runs-on: ubuntu-latest
    defaults: { run: { working-directory: frontend } }
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with: { node-version: 22, cache: npm, cache-dependency-path: frontend/package-lock.json }
      - run: npm ci
      - run: npm run build
      - uses: actions/upload-artifact@v5
        with: { name: built-css, path: frontend/dist/assets, if-no-files-found: error }

  cssert:
    runs-on: ubuntu-latest
    needs: [test, frontend-build]
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with: { node-version: 22 }
      - uses: actions/download-artifact@v5
        with: { name: rendered-html, path: build/rendered }
      - uses: actions/download-artifact@v5
        with: { name: built-css, path: frontend/dist/assets }
      - run: npx @cssert/cli check --format github
```

Two details worth copying:

- `if-no-files-found: error` on the uploads, and `minDocuments` /
  `--min-documents` in the check. Between them, a render step or a download
  that produced nothing fails the job instead of reporting a green run over
  zero documents.
- The config file sits at the repository root and its globs
  (`frontend/dist/assets/*.css`, `build/rendered/**/*.html`) are resolved
  relative to it, so the same command works from the root, from `frontend/`,
  and from an `npm run` script inside `frontend/package.json`.

## Tips

- Classes toggled from JavaScript (`is-open`, `active`) never appear in server
  HTML and are ignored by default; add your own with `ignore`. For a class that
  only exists as a `querySelector` handle and is *supposed* to have no styles,
  use `hooks` instead — it keeps the reason in the config file.
- If a Tailwind class shows up as missing, the fix is almost always in
  `@source`/`content`: the template directory (or an installed app's
  templates) is not being scanned.
- For classes that are genuinely built at runtime, add them to Tailwind's
  safelist and assert them explicitly:

  ```ts
  import { expectClass, loadStylesheet } from "@cssert/cli";
  const sheet = loadStylesheet(readFileSync("static/dist/app.css", "utf8"));
  for (const level of ["info", "warning", "error"]) {
    expectClass(sheet, `alert-${level}`).toExist();
  }
  ```
