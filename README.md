# Jigsaw Vite Plugin

[![MIT License](https://img.shields.io/github/license/tighten/jigsaw-vite-plugin)](https://github.com/tightenco/jigsaw-vite-plugin/blob/main/LICENSE)

> **Warning**
>
> This plugin is in alpha stage and may not work as expected. Use at your own risk.

## Alpha notes

Currently we'll also need to add the following to the `bootstrap.php` file:

```php
function vite_tags(array $assets = []): HtmlString
{
    $dev = false;
    try {
        $url = './hot';
        $dev = file_get_contents($url);
    } catch (Exception $e) {
    }

    if ($dev) {
        $devServerUrl = $dev;

        return new HtmlString(<<<HTML
            <script type="module" src="{$devServerUrl}/@vite/client"></script>
            <link rel="stylesheet" href="{$devServerUrl}/source/_assets/css/main.css">
            <script type="module" src="{$devServerUrl}/source/_assets/js/main.js"></script>
        HTML);
    }

    $manifestPath = __DIR__ . '/source/assets/build/manifest.json';

    if (! file_exists($manifestPath)) {
        throw new Exception('The Vite manifest does not exist. Please run `npm run build` first or start the dev server.');
    }

    $manifest = json_decode(file_get_contents($manifestPath), true);

    if (! isset($manifest['source/_assets/js/main.js'])) {
        throw new Exception('Main entry point not found in Vite manifest.');
    }

    $entry = $manifest['source/_assets/js/main.js'];
    $css = $manifest['source/_assets/css/main.css'];

    return new HtmlString(<<<HTML
        <link rel="stylesheet" href="/assets/build/{$css['file']}">
        <script type="module" src="/assets/build/{$entry['file']}"></script>
    HTML);
}
```

And then in the head of your `layouts/main.blade.php` file:

```php
{!! vite_tags() !!}
```

---

`jigsaw-vite-plugin` is a [Vite](https://vite.dev/) plugin for the [Jigsaw](https://github.com/tighten/jigsaw) static site generator. It watches your Jigsaw site's files and triggers a new build when it detects changes.

## Installation

```sh
npm install -D jigsaw-vite-plugin
```

## Usage

Add the plugin to your `vite.config.js` file:

```js
import { defineConfig } from 'vite';
import jigsaw from 'jigsaw-vite-plugin';

export default defineConfig({
    plugins: [
        jigsawPlugin({
            input: ['source/_assets/js/main.js', 'source/_assets/css/main.css'],
            refresh: true,
        }),
    ],
});
```

## Credits

Huge thanks to the [vite-plugin-full-reload](https://github.com/ElMassimo/vite-plugin-full-reload) and [laravel-vite-plugin](https://github.com/laravel/vite-plugin/)

## License

Jigsaw Vite Plugin is provided under the [MIT License](LICENSE).
