# Third-party licences

Kanjiba ships code and data from the projects below. Their notices are
reproduced here because their licences require it.

## Kanji Canvas — handwriting recognition

`src/input/handwriting/pipeline.js` is a port of
[Kanji Canvas](https://github.com/asdfjkl/kanjicanvas), and the reference
patterns in `public/strokes/` are built from its published data by
`scripts/build-strokes.mjs`.

> Copyright (c) 2019–2024 Dominik Klein
> Copyright (c) 2020 Seth Clydesdale
>
> Permission is hereby granted, free of charge, to any person obtaining a copy
> of this software and associated documentation files (the "Software"), to deal
> in the Software without restriction, including without limitation the rights
> to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
> copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all
> copies or substantial portions of the Software. **The copyright notice must
> include a backlink (hyperlink) to http://github.com/asdfjkl/kanjicanvas**
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
> IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
> FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
> AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
> LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
> OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
> SOFTWARE.

The required backlink appears in the ported source, and in the handwriting panel
itself so that it reaches people using the app rather than only people reading
the repository.

## KanjiVG — stroke data

Kanji Canvas's reference patterns derive from
[KanjiVG](https://kanjivg.tagaini.net/), © Ulrich Apel, released under
[CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/). The patterns in
`public/strokes/` are therefore a derivative work and carry the same terms.

## Tatoeba — example sentences

The sentences in `public/sentences/`, used by the fill-in and listening quizzes,
come from [Tatoeba](https://tatoeba.org) under
[CC-BY 2.0 FR](https://creativecommons.org/licenses/by/2.0/fr/). Every sentence
keeps its Tatoeba id so that it can be traced back to its contributor, and the
fill-in quiz links to the sentence it showed.

## Kanji and vocabulary lists

`data/Kanji.csv` and `data/Vocab.csv` are carried over from
[kanji-practice-app](https://github.com/eduardob999/kanji-practice-app), this
project's predecessor.

## FSRS

The scheduler implements [FSRS](https://github.com/open-spaced-repetition), and
its default weights are the published FSRS-4 values. The implementation came
across from [GHAPP](https://github.com/eduardob999/GHAPP).
