# Recipe: Laravel

Blade templates become HTML only when rendered. Render the pages you care
about to files with an Artisan command, build assets with Vite the way you
deploy them, then run cssert on both. Raw Blade files can be checked as well,
but `{{ }}`/`@if` inside `class` attributes are reported as dynamic-suspect
tokens rather than verified.

## 1. Dump rendered HTML

```php
<?php
// app/Console/Commands/DumpRendered.php
namespace App\Console\Commands;

use App\Models\User;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\File;

class DumpRendered extends Command
{
    protected $signature = 'cssert:dump';
    protected $description = 'Render selected pages to build/rendered/ for cssert';

    private const PAGES = [
        'index.html' => '/',
        'pricing.html' => '/pricing',
        'account/settings.html' => '/account/settings',
    ];

    public function handle(): int
    {
        $out = base_path('build/rendered');
        $user = User::query()->first();

        foreach (self::PAGES as $name => $uri) {
            $request = \Illuminate\Http\Request::create($uri, 'GET');
            if ($user) {
                $request->setUserResolver(fn () => $user);
                auth()->setUser($user);
            }
            $response = app()->handle($request);
            if ($response->getStatusCode() !== 200) {
                $this->error("$uri: HTTP {$response->getStatusCode()}");
                continue;
            }
            $target = "$out/$name";
            File::ensureDirectoryExists(dirname($target));
            File::put($target, $response->getContent());
            $this->info("wrote $target");
        }

        return self::SUCCESS;
    }
}
```

Views that need no request can be rendered directly:

```php
File::put(base_path('build/rendered/welcome.html'), view('emails.welcome', ['user' => $user])->render());
```

Run against a seeded database:

```sh
php artisan migrate --seed
php artisan cssert:dump
```

## 2. Build the CSS

```sh
npm run build   # vite build → public/build/assets/app-*.css
```

Use the production build; the `content` (Tailwind v3) or `@source`
(Tailwind v4) configuration is what cssert verifies. Remember that
`resources/views/**/*.blade.php` must be listed there, and so must any
package views you publish or use.

## 3. Check

```sh
npx @cssert/cli check --css "public/build/assets/*.css" --html "build/rendered/**/*.html"
```

```ts
// cssert.config.ts
import { defineConfig } from "@cssert/cli";

export default defineConfig({
  css: ["public/build/assets/*.css"],
  html: ["build/rendered/**/*.html"],
  attributes: ["class", ":class", "x-bind:class"], // Alpine.js bindings
  ignore: [/^js-/, /^fi-/],                          // Filament, etc.
});
```

## 4. GitHub Actions

```yaml
- run: php artisan migrate --seed
- run: npm ci && npm run build
- run: php artisan cssert:dump
- run: npx @cssert/cli check --format github
```

## Tips

- Livewire and Alpine add or toggle classes at runtime. cssert reads string
  literals inside `:class="{ 'bg-red-500': hasError }"` when the attribute is
  listed in `attributes`, so those literal names are checked too.
- `@class(['p-4', 'bg-red-500' => $error])` renders to a plain `class`
  attribute, so it is covered once the page is rendered.
- Blade components that compute class names (`"btn-{$variant}"`) are invisible
  to Tailwind. Safelist them and assert them with `expectClass`.
