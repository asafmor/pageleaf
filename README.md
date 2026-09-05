# Pageleaf

Turn a text file or folder of text files into a navigable, single-file HTML site.

```bash
npx pageleaf guide.md
npx pageleaf ./docs --title "Project manual" --theme grove
npx pageleaf notes.txt --out ./public --open
```

Requires Node.js 20 or newer.

## Options

| Option | Description |
| --- | --- |
| `--title <text>` | Override the site title |
| `--theme <name>` | Use `paper`, `midnight`, `grove`, `ocean`, or `contrast` |
| `--out <folder>` | Choose the output folder |
| `--open` | Open the generated site |
| `--force` | Replace an existing output file |

A file named `guide.md` produces `guide.html`. A folder named `docs` produces `docs.html`. Folder input combines its top-level, non-hidden UTF-8 text files in filename order; each file becomes a section. A folder with one text file behaves like that file alone.

Relative links and images remain unchanged, so they resolve from the generated HTML file. The site needs internet access to load its pinned Markdown-it dependency.

## License

[MIT](LICENSE)
