# Jigsaw Vite Plugin

[![MIT License](https://img.shields.io/github/license/tighten/jigsaw-vite-plugin)](https://github.com/tightenco/jigsaw-vite-plugin/blob/main/LICENSE)

`@tighten/jigsaw-vite-plugin` is a [Vite](https://vite.dev/) plugin for the [Jigsaw](https://github.com/tighten/jigsaw) static site generator. It watches your Jigsaw site's files and triggers a new build when it detects changes.

> You'll want to ensure you are in Jigsaw version 1.8.0 or later before installing this plugin.

## Installation

```sh
npm install -D @tighten/jigsaw-vite-plugin
```

## Usage

Make sure the head of your `layouts/main.blade.php` file:

```php
@viteRefresh()
<link rel="stylesheet" href="{{ vite('source/_assets/css/main.css') }}">
<script defer type="module" src="{{ vite('source/_assets/js/main.js') }}"></script>
```

Add the plugin to your `vite.config.js` file:

```js
import { defineConfig } from 'vite';
import jigsaw from '@tighten/jigsaw-vite-plugin';

export default defineConfig({
    plugins: [
        jigsaw({
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
