# Pageleaf

Turn a text file or folder of text files into a navigable, single-file HTML site.

```bash
npx pageleaf guide.md
npx pageleaf ./docs --title "Project manual" --theme grove
npx pageleaf ./docs --layout sidebar
npx pageleaf notes.txt --out ./public --open
npx pageleaf ./docs --upload my-org/my-docs
```

Requires Node.js 20 or newer.

## Options

| Option | Description |
| --- | --- |
| `--title <text>` | Override the site title |
| `--theme <name>` | Use `paper`, `midnight`, `grove`, `ocean`, or `contrast` |
| `--layout <name>` | Use `standard` (the default horizontal section navigation plus page sidebar) or `sidebar` (a single left hierarchy with non-clickable section groups and page links) |
| `--out <folder>` | Choose the output folder |
| `--upload <[owner/]repo>` | Upload the HTML file to a GitHub repository's root on its default branch |
| `--open` | Open the generated site |
| `--force` | Replace an existing output file |

A file named `guide.md` produces `guide.html`. A folder named `docs` produces `docs.html`. Folder input combines its top-level, non-hidden UTF-8 text files in filename order; each file becomes a section. A folder with one text file behaves like that file alone.

Relative links and images remain unchanged, so they resolve from the generated HTML file. The site needs internet access to load its pinned Markdown-it dependency.

`geomap` code fences render GeoJSON layers as interactive maps with searchable feature tables and Google Maps links for points. Maps load Leaflet and OpenStreetMap tiles online; the table remains usable if the map fails to load. See the [GeoMap guide](https://github.com/asafmor/pageleaf/blob/main/docs/geomap.md) and [example](https://github.com/asafmor/pageleaf/blob/main/examples/geomap.md).

For uploads, install [Git](https://git-scm.com/downloads) and [GitHub CLI](https://cli.github.com/), then run `gh auth login --hostname github.com`. Use `--upload my-docs` for the signed-in user's personal account, or `--upload my-org/my-docs` for an explicit owner. The repository must already exist and permit direct pushes; an empty repository is supported.

Uploads keep the generated filename (`docs.html` in the example), replace that remote file automatically, and leave other files unchanged. Identical content creates no commit. Commits use the signed-in account's GitHub noreply identity. `--force` controls local output replacement only. If an upload fails, the local HTML remains available; fix the reported problem and rerun with `--force`. Uploading stores the file in GitHub; it does not configure GitHub Pages.

## License

[MIT](LICENSE)
