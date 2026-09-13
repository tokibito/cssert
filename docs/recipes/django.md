# Recipe: Django

cssert compares built CSS with HTML. Django templates are not HTML until they
are rendered, so the reliable approach is to **render the pages you care
about to files, then check the files**. Checking the raw templates also works
but reports every `{% if %}`/`{{ }}` inside a `class` attribute as a
dynamic-suspect token.

## 1. Dump rendered HTML

Add a management command that renders URLs with the test client and writes
the responses to `build/rendered/`:

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
npx cssert check --css "static/dist/**/*.css" --html "build/rendered/**/*.html"
```

Or with a config file at the project root:

```ts
// cssert.config.ts
import { defineConfig } from "cssert";

export default defineConfig({
  css: ["static/dist/**/*.css"],
  html: ["build/rendered/**/*.html"],
  ignore: [/^js-/, /^admin-/, /^djdt-/],   // Django admin / debug toolbar classes
});
```

## 4. GitHub Actions

```yaml
- run: python manage.py migrate && python manage.py loaddata fixtures/demo.json
- run: python manage.py dump_rendered
- run: npx @tailwindcss/cli -i static/src/app.css -o static/dist/app.css --minify
- run: npx cssert check --format github
```

## Tips

- Classes toggled from JavaScript (`is-open`, `active`) never appear in server
  HTML and are ignored by default; add your own with `ignore`.
- If a Tailwind class shows up as missing, the fix is almost always in
  `@source`/`content`: the template directory (or an installed app's
  templates) is not being scanned.
- For classes that are genuinely built at runtime, add them to Tailwind's
  safelist and assert them explicitly:

  ```ts
  import { expectClass, loadStylesheet } from "cssert";
  const sheet = loadStylesheet(readFileSync("static/dist/app.css", "utf8"));
  for (const level of ["info", "warning", "error"]) {
    expectClass(sheet, `alert-${level}`).toExist();
  }
  ```
