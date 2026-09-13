# Recipe: Rails

Render the pages you care about to files with a Rake task, build the CSS the
way you deploy it, then run cssert on both. Checking raw ERB works too, but
every `<%= %>` inside a `class` attribute is reported as a dynamic-suspect
token instead of being verified.

## 1. Dump rendered HTML

```ruby
# lib/tasks/cssert.rake
namespace :cssert do
  desc "Render selected pages to build/rendered/ for cssert"
  task dump: :environment do
    require "rack/test"

    pages = {
      "index.html"          => "/",
      "pricing.html"        => "/pricing",
      "account/settings.html" => "/account/settings",
    }

    session = ActionDispatch::Integration::Session.new(Rails.application)
    session.host! "localhost"
    if (user = User.first)
      session.post "/session", params: { email: user.email, password: ENV.fetch("SEED_PASSWORD") }
    end

    out = Rails.root.join("build/rendered")
    pages.each do |name, path|
      session.get path
      unless session.response.successful?
        warn "#{path}: HTTP #{session.response.status}"
        next
      end
      target = out.join(name)
      target.dirname.mkpath
      target.write(session.response.body)
      puts "wrote #{target}"
    end
  end
end
```

For views that need no request, render them directly:

```ruby
html = ApplicationController.render(template: "mailers/welcome", assigns: { user: user }, layout: "mailer")
Rails.root.join("build/rendered/welcome.html").write(html)
```

Run against a seeded database:

```sh
bin/rails db:prepare db:seed
bin/rails cssert:dump
```

## 2. Build the CSS

With `tailwindcss-rails`:

```sh
bin/rails tailwindcss:build
# → app/assets/builds/tailwind.css
```

With `cssbundling-rails`/Vite, run the production build (`yarn build:css`,
`bin/vite build`) so the content configuration matches what ships.

## 3. Check

```sh
npx cssert check --css "app/assets/builds/**/*.css" --html "build/rendered/**/*.html"
```

```ts
// cssert.config.ts
import { defineConfig } from "cssert";

export default defineConfig({
  css: ["app/assets/builds/**/*.css"],
  html: ["build/rendered/**/*.html"],
  ignore: [/^js-/, /^turbo-/, /^trix-/],
});
```

## 4. GitHub Actions

```yaml
- run: bin/rails db:prepare db:seed
- run: bin/rails tailwindcss:build
- run: bin/rails cssert:dump
- run: npx cssert check --format github
```

## Tips

- ViewComponent previews (`/rails/view_components/...`) are a convenient set
  of URLs to dump: they exercise components in isolation with known state.
- Hotwire/Turbo adds classes at runtime (`turbo-progress-bar`); ignore them.
- If a helper builds class names (`"btn-#{variant}"`), Tailwind cannot see
  them either. Safelist them and assert explicitly with `expectClass`.
