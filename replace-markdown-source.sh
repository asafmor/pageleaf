#!/usr/bin/env bash
# Replace the Markdown embedded in index.html with the contents of a file.
# Usage: ./replace-markdown-source.sh path/to/document.md

set -euo pipefail

if [[ $# -ne 1 ]]; then
  printf 'Usage: %s <markdown-file>\n' "${0##*/}" >&2
  exit 64
fi

source_file=$1
if [[ ! -f $source_file ]]; then
  printf 'Input file does not exist or is not a regular file: %s\n' "$source_file" >&2
  exit 66
fi

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
index_file="$script_dir/index.html"
if [[ ! -f $index_file ]]; then
  printf 'Could not find index.html beside this script: %s\n' "$index_file" >&2
  exit 66
fi

temporary_file=$(mktemp "${index_file}.tmp.XXXXXX")
cleanup() {
  rm -f -- "$temporary_file"
}
trap cleanup EXIT

perl -0777 - "$source_file" "$index_file" >"$temporary_file" <<'PERL'
use strict;
use warnings;

my ($source_path, $index_path) = @ARGV;

open my $source, '<', $source_path or die "Cannot read $source_path: $!\n";
my $markdown = do { local $/; <$source> };
close $source or die "Cannot close $source_path: $!\n";

# The content is in an HTML raw-text element. Escape literal closing tags so
# they remain Markdown; index.html's readMarkdown() decodes this form.
$markdown =~ s{</script}{&lt;/script}gi;

open my $index, '<', $index_path or die "Cannot read $index_path: $!\n";
my $html = do { local $/; <$index> };
close $index or die "Cannot close $index_path: $!\n";

my $opening_tag = '<script id="markdown-source" type="text/plain">';
my $replacements = $html =~ s{(\Q$opening_tag\E).*?(</script>)}{
  my ($opening, $closing) = ($1, $2);
  $opening . $markdown . $closing;
}se;
die "Expected exactly one markdown-source script block, found $replacements\n"
  unless $replacements == 1;

print $html;
PERL

chmod --reference="$index_file" "$temporary_file"
mv -- "$temporary_file" "$index_file"
trap - EXIT

printf 'Updated %s from %s\n' "$index_file" "$source_file"
